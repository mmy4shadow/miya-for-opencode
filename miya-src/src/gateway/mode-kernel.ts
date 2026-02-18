import { inferSentinelState, type SentinelSignals } from '../daemon/psyche';
import { type GatewayMode, inferContextMode } from './sanitizer';

export interface ModeKernelSessionState {
  activation?: 'active' | 'queued' | 'muted';
  reply?: 'auto' | 'manual' | 'summary_only';
  queueLength?: number;
  awaitingConfirmation?: boolean;
  loopEnabled?: boolean;
}

export interface ModeKernelInput {
  text: string;
  sanitizerModeHint?: GatewayMode;
  routeComplexity?: {
    complexity: 'low' | 'medium' | 'high';
    score: number;
    reasons: string[];
  };
  psycheSignals?: SentinelSignals;
  sessionState?: ModeKernelSessionState;
  lastMode?: GatewayMode;
}

export interface ModeKernelResult {
  mode: GatewayMode;
  confidence: number;
  why: string[];
  scores: {
    work: number;
    chat: number;
    mixed: number;
  };
}

const WORK_HINT = [
  /(修复|报错|代码|接口|脚本|编译|测试|部署|重构|性能|debug|fix|error|build|run|test|deploy)/i,
  /```[\s\S]*```/,
  /\b(src|package\.json|tsconfig|traceback|stack trace|TypeError|ReferenceError)\b/i,
];

const CHAT_HINT = [
  /(宝贝|亲爱|陪我|晚安|抱抱|想你|撒娇|聊天|情绪|安慰)/,
  /\b(love|hug|dear|chat|lonely|comfort)\b/i,
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isWorkHint(text: string): boolean {
  return WORK_HINT.some((pattern) => pattern.test(text));
}

function isChatHint(text: string): boolean {
  return CHAT_HINT.some((pattern) => pattern.test(text));
}

function normalizeReasonList(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const reason of input) {
    const normalized = reason.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, 10);
}

function inferSignalMode(text: string): 'work' | 'chat' | 'mixed' {
  const work = isWorkHint(text);
  const chat = isChatHint(text);
  if (work && chat) return 'mixed';
  return work ? 'work' : chat ? 'chat' : 'work';
}

export function evaluateModeKernel(input: ModeKernelInput): ModeKernelResult {
  const text = String(input.text ?? '').trim();
  const normalized = text.toLowerCase();
  const reasons: string[] = [];
  let workScore = 0;
  let chatScore = 0;
  let explicitMixed = false;

  const sanitizerMode =
    input.sanitizerModeHint && input.sanitizerModeHint !== 'mixed'
      ? input.sanitizerModeHint
      : inferContextMode(text);
  if (sanitizerMode === 'work') {
    workScore += 2;
    reasons.push('sanitizer=work');
  } else {
    chatScore += 2;
    reasons.push('sanitizer=chat');
  }

  const signalMode = inferSignalMode(text);
  if (signalMode === 'work') {
    workScore += 1.3;
    reasons.push('text_signal=work');
  } else if (signalMode === 'chat') {
    chatScore += 1.3;
    reasons.push('text_signal=chat');
  } else {
    workScore += 0.9;
    chatScore += 0.9;
    reasons.push('text_signal=mixed');
  }

  const complexity = input.routeComplexity;
  if (complexity) {
    if (complexity.complexity === 'high') {
      workScore += 1.4;
      reasons.push('route_complexity=high');
    } else if (complexity.complexity === 'medium') {
      workScore += 0.8;
      reasons.push('route_complexity=medium');
    } else {
      reasons.push('route_complexity=low');
    }
  }

  if (input.psycheSignals) {
    const sentinel = inferSentinelState(input.psycheSignals);
    if (sentinel.state === 'FOCUS') {
      workScore += 1.1;
      reasons.push('psyche=focus');
    } else if (sentinel.state === 'CONSUME' || sentinel.state === 'AWAY') {
      chatScore += 0.9;
      reasons.push(`psyche=${sentinel.state.toLowerCase()}`);
    } else if (sentinel.state === 'PLAY') {
      chatScore += 0.7;
      reasons.push('psyche=play');
    } else {
      workScore += 0.5;
      reasons.push('psyche=unknown_safe_work');
    }
  }

  const session = input.sessionState;
  if (session) {
    if (session.activation === 'queued' || session.awaitingConfirmation) {
      workScore += 0.8;
      reasons.push('session=pending_workflow');
    }
    if (session.reply === 'manual' || session.activation === 'muted') {
      chatScore += 0.2;
      reasons.push('session=manual_reply_bias');
    }
    if ((session.queueLength ?? 0) > 0) {
      workScore += 0.4;
      reasons.push('session=queue_backlog');
    }
  }

  if (/(先聊|先别执行|不要执行|只聊天|chat only|talk only)/i.test(normalized)) {
    chatScore += 1;
    reasons.push('explicit_chat_preference');
  }
  if (/(直接执行|马上做|请修复|start work|do it now)/i.test(normalized)) {
    workScore += 1;
    reasons.push('explicit_work_preference');
  }
  if (/(边做边聊|一边.*做.*一边.*聊|work and chat)/i.test(normalized)) {
    explicitMixed = true;
    workScore += 0.8;
    chatScore += 0.8;
    reasons.push('explicit_mixed_preference');
  }

  const mixedScore =
    Math.min(workScore, chatScore) +
    (workScore >= 1 && chatScore >= 1 ? 0.75 : 0) +
    (signalMode === 'mixed' ? 0.55 : 0);

  const primary = Math.max(workScore, chatScore, mixedScore);
  const ranked: Array<[GatewayMode, number]> = [
    ['work', workScore] as [GatewayMode, number],
    ['chat', chatScore] as [GatewayMode, number],
    ['mixed', mixedScore] as [GatewayMode, number],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const second = ranked[1]?.[1] ?? 0;
  const margin = primary - second;
  const signalDensity = normalizeReasonList(reasons).length;
  const confidence = clamp(
    0.45 +
      clamp(margin / Math.max(primary, 1), 0, 1) * 0.4 +
      Math.min(0.15, signalDensity * 0.015),
    0.35,
    0.99,
  );

  let mode: GatewayMode;
  if (explicitMixed && workScore >= 1 && chatScore >= 1) {
    mode = 'mixed';
  } else if (
    mixedScore >= workScore - 0.15 &&
    mixedScore >= chatScore - 0.15 &&
    workScore >= 1 &&
    chatScore >= 1
  ) {
    mode = 'mixed';
  } else {
    mode = workScore >= chatScore ? 'work' : 'chat';
  }

  if (input.lastMode && margin <= 0.08) {
    mode = input.lastMode;
    reasons.push('mode_hysteresis');
  }

  return {
    mode,
    confidence: Number(confidence.toFixed(3)),
    why: normalizeReasonList(reasons),
    scores: {
      work: Number(workScore.toFixed(3)),
      chat: Number(chatScore.toFixed(3)),
      mixed: Number(mixedScore.toFixed(3)),
    },
  };
}
