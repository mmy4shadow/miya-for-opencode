import type { GatewayMode } from '../../gateway/sanitizer';

export interface MessageInfo {
  role: string;
  agent?: string;
  sessionID?: string;
}

export interface MessagePart {
  type: string;
  text?: string;
}

export interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

export interface LastUserTextPart {
  message: MessageWithParts;
  partIndex: number;
  sessionID: string;
}

export interface ParsedModeKernelMeta {
  mode: GatewayMode;
  confidence: number;
  why: string[];
}

export function normalizeSessionID(sessionID?: string): string {
  const normalized = String(sessionID ?? '').trim();
  return normalized || 'main';
}

export function findLastUserTextPart(
  messages: MessageWithParts[],
): LastUserTextPart | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.info.role !== 'user') continue;
    const partIndex = message.parts.findIndex(
      (part) => part.type === 'text' && typeof part.text === 'string',
    );
    if (partIndex === -1) continue;
    return {
      message,
      partIndex,
      sessionID: normalizeSessionID(message.info.sessionID),
    };
  }
  return null;
}

export function isCommandBridgeText(text: string): boolean {
  return text.includes('[MIYA COMMAND BRIDGE]');
}

export function hasBlock(text: string, marker: string): boolean {
  return text.includes(marker);
}

export function prependBlock(block: string, text: string): string {
  return `${block}\n\n---\n\n${text}`;
}

export function extractUserIntentText(text: string): string {
  const chunks = String(text ?? '')
    .split(/\n\s*---\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const raw =
    chunks.length > 0 ? chunks[chunks.length - 1] : String(text ?? '');
  const withoutReminder = raw.replace(/<reminder>[\s\S]*?<\/reminder>/gi, ' ');
  const cleaned = withoutReminder
    .split(/\r?\n/g)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('[MIYA')) return false;
      if (trimmed.startsWith('</reminder')) return false;
      return true;
    })
    .join('\n')
    .trim();
  return cleaned;
}

function parseMode(mode: string): GatewayMode | null {
  if (mode === 'work' || mode === 'chat' || mode === 'mixed') return mode;
  return null;
}

export function parseModeKernelMeta(text: string): ParsedModeKernelMeta | null {
  const match = text.match(
    /\[MIYA_MODE_KERNEL v1\]([\s\S]*?)\[\/MIYA_MODE_KERNEL\]/,
  );
  if (!match) return null;
  const body = match[1] ?? '';
  const modeMatch = body.match(/mode=(work|chat|mixed)/);
  const confidenceMatch = body.match(/confidence=([0-9.]+)/);
  const whyMatch = body.match(/why=([^\n]+)/);
  const mode = parseMode(modeMatch?.[1] ?? '');
  if (!mode) return null;
  const confidence = Number(confidenceMatch?.[1] ?? 0);
  const why =
    typeof whyMatch?.[1] === 'string' && whyMatch[1].trim().length > 0
      ? whyMatch[1]
          .split('|')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  return {
    mode,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    why,
  };
}
