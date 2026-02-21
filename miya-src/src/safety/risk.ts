import { createHash } from 'node:crypto';
import type { SafetyTier } from './tier';

export interface SafetyPermissionRequest {
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
  toolCallID?: string;
  messageID?: string;
}

export type SideEffectReversibility = 'none' | 'reversible' | 'irreversible';

const IRREVERSIBLE_BASH_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/i,
  /\bgit\s+remote\s+set-url\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b[^\n]*\b-f\b/i,
  /\bgit\s+branch\b[^\n]*\b-D\b/i,
  /\brm\s+-[^\n]*\br\b/i,
  /\brm\s+-[^\n]*\bf\b/i,
  /\brm\s+(-rf|-fr)\b/i,
  /\bdel\s+\/[sfpq]/i,
  /\berase\s+\/[sfpq]/i,
  /\bRemove-Item\b[^\n]*\b(-Recurse|-Force)\b/i,
  /\btruncate\b/i,
  /\bcp\b[^\n]*\b-f\b/i,
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

const READ_ONLY_BASH_PATTERNS: RegExp[] = [
  /^\s*(ls|dir)\b/i,
  /^\s*(cat|type)\b/i,
  /^\s*(grep|rg|findstr)\b/i,
  /^\s*(pwd|cd)\b/i,
  /^\s*(echo)\b/i,
  /^\s*git\s+(status|log|show|diff)\b/i,
];

function normalizePattern(pattern: string): string {
  return pattern.trim().replaceAll('\\', '/');
}

function hasIrreversiblePattern(patterns: string[]): boolean {
  return patterns.some((pattern) =>
    IRREVERSIBLE_BASH_PATTERNS.some((rule) => rule.test(pattern)),
  );
}

function isReadOnlyShellPattern(patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.every((pattern) =>
    READ_ONLY_BASH_PATTERNS.some((rule) => rule.test(pattern.trim())),
  );
}

function hasSensitivePath(patterns: string[]): boolean {
  return patterns.some((pattern) =>
    SENSITIVE_PATH_PATTERNS.some((rule) => rule.test(pattern)),
  );
}

function hasIrreversibleEditPattern(patterns: string[]): boolean {
  return patterns.some(
    (pattern) =>
      /\b(delete|remove|overwrite|truncate|destroy|wipe)\b/i.test(pattern) ||
      pattern.endsWith('.env') ||
      pattern.includes('/.env'),
  );
}

export function isSideEffectPermission(permission: string): boolean {
  return (
    permission === 'edit' ||
    permission === 'bash' ||
    permission === 'external_directory' ||
    permission === 'external_message' ||
    permission === 'desktop_control' ||
    permission === 'node_invoke' ||
    permission === 'skills_install' ||
    permission === 'webhook_outbound'
  );
}

export function classifySideEffect(
  request: Pick<SafetyPermissionRequest, 'permission' | 'patterns'>,
): {
  sideEffect: boolean;
  reversibility: SideEffectReversibility;
} {
  if (!isSideEffectPermission(request.permission)) {
    return { sideEffect: false, reversibility: 'none' };
  }
  const patterns = request.patterns.map(normalizePattern);
  if (request.permission === 'bash') {
    if (isReadOnlyShellPattern(patterns)) {
      return { sideEffect: true, reversibility: 'reversible' };
    }
    return {
      sideEffect: true,
      reversibility: hasIrreversiblePattern(patterns)
        ? 'irreversible'
        : 'reversible',
    };
  }
  if (request.permission === 'edit') {
    return {
      sideEffect: true,
      reversibility: hasIrreversibleEditPattern(patterns)
        ? 'irreversible'
        : 'reversible',
    };
  }
  return { sideEffect: true, reversibility: 'irreversible' };
}

export function requiredTierForRequest(
  request: Pick<SafetyPermissionRequest, 'permission' | 'patterns'>,
): SafetyTier {
  const patterns = request.patterns.map(normalizePattern);
  const sideEffect = classifySideEffect(request);

  if (request.permission === 'external_directory') return 'THOROUGH';
  if (request.permission === 'external_message') return 'THOROUGH';
  if (request.permission === 'desktop_control') return 'THOROUGH';
  if (request.permission === 'node_invoke') {
    const patterns = request.patterns.map(normalizePattern).join(' ');
    if (
      /\b(system\.run|camera\.capture|canvas\.open|canvas\.render|voice\.)\b/i.test(
        patterns,
      )
    ) {
      return 'THOROUGH';
    }
    return 'STANDARD';
  }
  if (request.permission === 'skills_install') return 'THOROUGH';
  if (request.permission === 'webhook_outbound') return 'THOROUGH';
  if (request.permission === 'bash') {
    return sideEffect.reversibility === 'irreversible'
      ? 'THOROUGH'
      : 'STANDARD';
  }
  if (request.permission === 'edit') {
    if (hasSensitivePath(patterns) || hasIrreversibleEditPattern(patterns)) {
      return 'THOROUGH';
    }
    return 'STANDARD';
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
    toolCallID: includeMessageContext ? (request.toolCallID ?? '') : '',
    messageID: includeMessageContext ? (request.messageID ?? '') : '',
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
