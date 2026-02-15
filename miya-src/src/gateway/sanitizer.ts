export type ContextMode = 'work' | 'chat';
export type GatewayMode = ContextMode | 'mixed';

export interface SanitizedGatewayContext {
  mode: GatewayMode;
  payload: string;
  removedSignals: string[];
}

const WORK_INSTRUCTION = 'You are a technical coding assistant. No small talk.';
const CHAT_INSTRUCTION = 'You are Miya, a girlfriend assistant. Be gentle and cute.';
const MIXED_INSTRUCTION =
  'You are Miya. Execute work rigorously and respond with concise emotional warmth in the same turn.';

const WORK_HINTS = [
  /```/,
  /\b(stack trace|traceback|exception|TypeError|ReferenceError)\b/i,
  /\b(function|class|import|npm|pnpm|bun|pip|pytest|docker|sql|api)\b/i,
  /\b(\.ts|\.tsx|\.js|\.py|\.md|package\.json|tsconfig)\b/i,
  /(修复|报错|编译|代码|脚本|函数|接口|性能|测试|部署)/,
];

const CHAT_HINTS = [
  /(亲爱|宝贝|老公|老婆|撒娇|抱抱|晚安|想你|陪我|聊天|温柔)/,
  /\b(love|dear|sweet|cute|hug)\b/i,
];

const WORK_BLOCKED_WORDS = /(亲爱的|宝贝|老公|老婆|撒娇|语气|情绪|可爱|温柔)/g;

const CODE_CONTEXT_LINE = new RegExp(
  [
    '^\\s*```',
    '^\\s*(src|apps?|packages?)[/\\\\]',
    '^\\s*[A-Za-z]:[/\\\\]',
    '^\\s*at\\s+\\S+\\s*\\(',
    '^\\s*File\\s+\".*\",\\s+line\\s+\\d+',
    '\\.(ts|tsx|js|jsx|py|java|go|rs|cpp|c|h|json|yaml|yml|toml|md)\\b',
    '\\b(package\\.json|tsconfig|requirements\\.txt|pnpm-lock|bun\\.lock)\\b',
  ].join('|'),
  'i',
);

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

export function inferContextMode(text: string): ContextMode {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed) return 'work';
  let workScore = 0;
  let chatScore = 0;
  for (const pattern of WORK_HINTS) {
    if (pattern.test(trimmed)) workScore += 1;
  }
  for (const pattern of CHAT_HINTS) {
    if (pattern.test(trimmed)) chatScore += 1;
  }
  return workScore >= chatScore ? 'work' : 'chat';
}

function sanitizeWorkContext(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  let body = normalizeWhitespace(text);
  if (WORK_BLOCKED_WORDS.test(body)) {
    removed.push('persona_words');
    body = body.replace(WORK_BLOCKED_WORDS, '');
  }
  body = body.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: ['[Context Mode: WORK]', WORK_INSTRUCTION, body].filter(Boolean).join('\n'),
    removed,
  };
}

function sanitizeChatContext(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = normalizeWhitespace(text).split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (CODE_CONTEXT_LINE.test(line)) {
      removed.push('code_context_line');
      continue;
    }
    kept.push(line);
  }
  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: ['[Context Mode: CHAT]', CHAT_INSTRUCTION, body].filter(Boolean).join('\n'),
    removed,
  };
}

export function sanitizeGatewayContext(input: {
  text: string;
  modeHint?: GatewayMode;
}): SanitizedGatewayContext {
  const mode = input.modeHint ?? inferContextMode(input.text);
  if (mode === 'chat') {
    const sanitized = sanitizeChatContext(input.text);
    return {
      mode,
      payload: sanitized.text,
      removedSignals: sanitized.removed,
    };
  }
  if (mode === 'mixed') {
    const work = sanitizeWorkContext(input.text);
    return {
      mode,
      payload: ['[Context Mode: MIXED]', MIXED_INSTRUCTION, work.text]
        .filter(Boolean)
        .join('\n'),
      removedSignals: [...work.removed],
    };
  }
  const sanitized = sanitizeWorkContext(input.text);
  return {
    mode,
    payload: sanitized.text,
    removedSignals: sanitized.removed,
  };
}
