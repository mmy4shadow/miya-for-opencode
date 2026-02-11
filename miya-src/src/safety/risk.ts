import { createHash } from 'node:crypto';
import { type SafetyTier } from './tier';

export interface SafetyPermissionRequest {
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
  toolCallID?: string;
  messageID?: string;
}

const IRREVERSIBLE_BASH_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/i,
  /\bgit\s+remote\s+set-url\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\brm\s+-[^\n]*\br\b/i,
  /\bdel\s+\/[sfpq]/i,
  /\bRemove-Item\b[^\n]*\b(-Recurse|-Force)\b/i,
  />\s*\.env(\.|$)/i,
  /\b(overwrite|truncate)\b/i,
];

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /cookie/i,
  /credential/i,
  /secret/i,
  /token/i,
];

function normalizePattern(pattern: string): string {
  return pattern.trim().replaceAll('\\', '/');
}

function hasIrreversiblePattern(patterns: string[]): boolean {
  return patterns.some((pattern) =>
    IRREVERSIBLE_BASH_PATTERNS.some((rule) => rule.test(pattern)),
  );
}

function hasSensitivePath(patterns: string[]): boolean {
  return patterns.some((pattern) =>
    SENSITIVE_PATH_PATTERNS.some((rule) => rule.test(pattern)),
  );
}

export function isSideEffectPermission(permission: string): boolean {
  return (
    permission === 'edit' ||
    permission === 'bash' ||
    permission === 'external_directory'
  );
}

export function requiredTierForRequest(
  request: Pick<SafetyPermissionRequest, 'permission' | 'patterns'>,
): SafetyTier {
  const patterns = request.patterns.map(normalizePattern);

  if (request.permission === 'external_directory') return 'THOROUGH';
  if (request.permission === 'bash') {
    return hasIrreversiblePattern(patterns) ? 'THOROUGH' : 'STANDARD';
  }
  if (request.permission === 'edit') {
    return hasSensitivePath(patterns) ? 'THOROUGH' : 'STANDARD';
  }
  return 'STANDARD';
}

export function buildRequestHash(
  request: Pick<
    SafetyPermissionRequest,
    'permission' | 'patterns' | 'toolCallID' | 'messageID'
  >,
  includeMessageContext = true,
): string {
  const payload = {
    permission: request.permission,
    patterns: [...request.patterns].map(normalizePattern).sort(),
    toolCallID: includeMessageContext ? request.toolCallID ?? '' : '',
    messageID: includeMessageContext ? request.messageID ?? '' : '',
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
