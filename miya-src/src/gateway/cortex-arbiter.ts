import type { RouteExecutionPlan } from '../router';
import type { GatewayMode } from './sanitizer';
import type { ModeKernelResult } from './mode-kernel';

export interface SafetySignal {
  blocked: boolean;
  reason?: string;
}

export interface UserExplicitIntent {
  preference: 'none' | 'work' | 'chat' | 'mixed' | 'defer';
  confidence: number;
  why: string[];
}

export interface LeftBrainActionPlan {
  objective: string;
  executeWork: boolean;
  risk: 'low' | 'medium' | 'high';
  requiredGates: string[];
  why: string[];
}

export interface RightBrainResponsePlan {
  tone: 'neutral' | 'warm' | 'supportive';
  suggestions: string[];
  highRiskToolSuggestion: boolean;
  why: string[];
}

export interface CortexArbiterInput {
  modeKernel: ModeKernelResult;
  safety: SafetySignal;
  userExplicit: UserExplicitIntent;
  leftBrain: LeftBrainActionPlan;
  rightBrain: RightBrainResponsePlan;
}

export interface CortexArbiterResult {
  mode: GatewayMode;
  executeWork: boolean;
  rightBrainSuppressed: boolean;
  responseHints: string[];
  priorityTrail: Array<'Safety' | 'User explicit' | 'Work objective' | 'Emotional optimization'>;
  why: string[];
  executionTrack: 'left_brain_single_track';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

export function detectUserExplicitIntent(text: string): UserExplicitIntent {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) return { preference: 'none', confidence: 0, why: [] };

  const why: string[] = [];
  let preference: UserExplicitIntent['preference'] = 'none';
  let confidence = 0;

  if (/(先别执行|不要执行|暂停执行|stop work|hold off)/i.test(normalized)) {
    preference = 'defer';
    confidence = 0.95;
    why.push('explicit_defer');
  } else if (/(边做边聊|一边.*做.*一边.*聊|work and chat|both)/i.test(normalized)) {
    preference = 'mixed';
    confidence = 0.88;
    why.push('explicit_mixed');
  } else if (/(先聊|只聊天|不要写代码|chat only|talk only)/i.test(normalized)) {
    preference = 'chat';
    confidence = 0.85;
    why.push('explicit_chat');
  } else if (/(直接执行|马上做|请修复|start work|do it now|implement)/i.test(normalized)) {
    preference = 'work';
    confidence = 0.82;
    why.push('explicit_work');
  }

  return {
    preference,
    confidence: Number(clamp(confidence, 0, 1).toFixed(3)),
    why,
  };
}

export function buildLeftBrainActionPlan(input: {
  routePlan: Pick<RouteExecutionPlan, 'intent' | 'complexity' | 'stage' | 'executionMode' | 'reasons'>;
  modeKernel: ModeKernelResult;
}): LeftBrainActionPlan {
  const risk: LeftBrainActionPlan['risk'] =
    input.routePlan.stage === 'high'
      ? 'high'
      : input.routePlan.stage === 'medium'
        ? 'medium'
        : 'low';
  const executeWork =
    input.routePlan.executionMode !== 'human_gate' &&
    (input.modeKernel.mode === 'work' ||
      input.modeKernel.mode === 'mixed' ||
      input.routePlan.complexity !== 'low');
  const why = [
    `route_stage=${input.routePlan.stage}`,
    `route_complexity=${input.routePlan.complexity}`,
    ...input.routePlan.reasons.slice(0, 4),
  ];
  return {
    objective: `intent=${input.routePlan.intent}`,
    executeWork,
    risk,
    requiredGates: ['policy_domain_gate', 'gateway_execution_gate'],
    why: normalizeReasonList(why),
  };
}

export function buildRightBrainResponsePlan(input: {
  text: string;
  modeKernel: ModeKernelResult;
}): RightBrainResponsePlan {
  const normalized = String(input.text ?? '').toLowerCase();
  const suggestions: string[] = [];
  if (input.modeKernel.mode === 'chat') {
    suggestions.push('先回应情绪，再给简短行动建议');
    suggestions.push('保持温柔语气，不展开工程细节');
  } else if (input.modeKernel.mode === 'mixed') {
    suggestions.push('执行结果与情绪回应同轮输出，避免分裂上下文');
    suggestions.push('先给结论，再补一句陪伴反馈');
  } else {
    suggestions.push('以执行结论为主，情绪表达保持一行以内');
  }
  const highRiskToolSuggestion =
    /(删库|转账|发给所有人|mass send|delete all|password|secret)/i.test(normalized);
  const tone: RightBrainResponsePlan['tone'] =
    input.modeKernel.mode === 'work'
      ? 'neutral'
      : input.modeKernel.mode === 'mixed'
        ? 'warm'
        : 'supportive';
  return {
    tone,
    suggestions,
    highRiskToolSuggestion,
    why: [
      `mode=${input.modeKernel.mode}`,
      `tone=${tone}`,
      highRiskToolSuggestion ? 'high_risk_tool_suggestion_detected' : 'tool_suggestion_safe',
    ],
  };
}

export function arbitrateCortex(input: CortexArbiterInput): CortexArbiterResult {
  const trail: CortexArbiterResult['priorityTrail'] = [
    'Safety',
    'User explicit',
    'Work objective',
    'Emotional optimization',
  ];
  const reasons: string[] = [];
  let mode: GatewayMode = input.modeKernel.mode;
  let executeWork = input.leftBrain.executeWork;

  if (input.safety.blocked) {
    executeWork = false;
    reasons.push(`safety_blocked:${input.safety.reason ?? 'unspecified'}`);
  }

  if (!input.safety.blocked && input.userExplicit.preference !== 'none' && input.userExplicit.confidence >= 0.55) {
    if (input.userExplicit.preference === 'defer') {
      executeWork = false;
      reasons.push('user_explicit_defer');
    } else {
      mode = input.userExplicit.preference;
      reasons.push(`user_explicit_mode=${mode}`);
    }
  }

  if (!input.safety.blocked && executeWork && mode === 'chat') {
    mode = 'mixed';
    reasons.push('work_objective_promoted_to_mixed');
  }

  if (mode === 'work' && input.rightBrain.tone !== 'neutral' && !input.safety.blocked) {
    reasons.push('emotional_optimization_kept_secondary');
  }

  const rightBrainSuppressed = input.rightBrain.highRiskToolSuggestion;
  if (rightBrainSuppressed) {
    reasons.push('right_brain_high_risk_suggestion_suppressed');
  }

  return {
    mode,
    executeWork,
    rightBrainSuppressed,
    responseHints: rightBrainSuppressed ? [] : input.rightBrain.suggestions.slice(0, 3),
    priorityTrail: trail,
    why: normalizeReasonList([
      ...reasons,
      ...input.modeKernel.why.slice(0, 3),
      ...input.leftBrain.why.slice(0, 3),
      ...input.rightBrain.why.slice(0, 2),
      ...input.userExplicit.why.slice(0, 2),
    ]),
    executionTrack: 'left_brain_single_track',
  };
}

