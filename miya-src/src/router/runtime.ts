import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { recordStrategyObservation, resolveStrategyVariant } from '../strategy';
import { getMiyaRuntimeDir } from '../workflow';
import {
  analyzeRouteSemantics,
  classifyIntent,
  type RouteIntent,
} from './classifier';
import { resolveAgentWithFeedback, resolveFallbackAgent } from './fallback';
import { addRouteFeedback, rankAgentsByFeedback } from './learner';

export type RouteComplexity = 'low' | 'medium' | 'high';
export type RouteStage = 'low' | 'medium' | 'high';
export type RouteFixability =
  | 'impossible'
  | 'rewrite'
  | 'reduce_scope'
  | 'need_evidence'
  | 'retry_later'
  | 'unknown';

export interface RouterModeConfig {
  ecoMode: boolean;
  forcedStage?: RouteStage;
  stageTokenMultiplier: Record<RouteStage, number>;
  stageCostUsdPer1k: Record<RouteStage, number>;
  contextHardCapTokens: number;
  retryDeltaMaxLines: number;
  retryBudget: {
    autoRetry: number;
    humanEdit: number;
  };
}

export interface RouteComplexitySignals {
  complexity: RouteComplexity;
  score: number;
  reasons: string[];
}

export interface RouteExecutionPlan {
  intent: RouteIntent;
  complexity: RouteComplexity;
  complexityScore: number;
  semanticConfidence: number;
  semanticAmbiguity: number;
  semanticEvidence: string[];
  stage: RouteStage;
  agent: string;
  preferredAgent: string;
  fallbackAgent: string;
  feedbackScore: number;
  feedbackSamples: number;
  ecoMode: boolean;
  reasons: string[];
  fixabilityHint: RouteFixability;
  retryBudget: {
    autoRetry: number;
    autoUsed: number;
    humanEdit: number;
    humanUsed: number;
  };
  executionMode: 'auto' | 'human_gate';
}

export interface RouterCostRecord {
  at: string;
  sessionID: string;
  intent: RouteIntent;
  complexity: RouteComplexity;
  stage: RouteStage;
  agent: string;
  success: boolean;
  inputTokens: number;
  outputTokensEstimate: number;
  totalTokensEstimate: number;
  baselineHighTokensEstimate: number;
  costUsdEstimate: number;
}

interface RouterCostSummary {
  totalRecords: number;
  totalTokensEstimate: number;
  baselineHighTokensEstimate: number;
  savingsTokensEstimate: number;
  savingsPercentEstimate: number;
  totalCostUsdEstimate: number;
  byStage: Record<
    RouteStage,
    { records: number; tokens: number; costUsd: number }
  >;
}

interface RouterSessionState {
  sessionID: string;
  consecutiveFailures: number;
  lastStage: RouteStage;
  autoRetryUsed: number;
  humanEditUsed: number;
  lastFixability: RouteFixability;
  lastFailureReason?: string;
  lastContextHash?: string;
  lastContextText?: string;
  updatedAt: string;
}

interface RouterSessionStore {
  sessions: Record<string, RouterSessionState>;
}

const DEFAULT_MODE: RouterModeConfig = {
  ecoMode: true,
  stageTokenMultiplier: {
    low: 0.62,
    medium: 1,
    high: 1.45,
  },
  stageCostUsdPer1k: {
    low: 0.0009,
    medium: 0.0018,
    high: 0.0032,
  },
  contextHardCapTokens: 1500,
  retryDeltaMaxLines: 14,
  retryBudget: {
    autoRetry: 2,
    humanEdit: 1,
  },
};

function modeFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'router-mode.json');
}

function costFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'router-cost.jsonl');
}

function sessionStateFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'router-session-state.json');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(getMiyaRuntimeDir(projectDir), { recursive: true });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseMode(raw: unknown): RouterModeConfig {
  const input =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const forcedStage =
    input.forcedStage === 'low' ||
    input.forcedStage === 'medium' ||
    input.forcedStage === 'high'
      ? input.forcedStage
      : undefined;
  const stageTokenMultiplierInput =
    input.stageTokenMultiplier && typeof input.stageTokenMultiplier === 'object'
      ? (input.stageTokenMultiplier as Record<string, unknown>)
      : {};
  const stageCostInput =
    input.stageCostUsdPer1k && typeof input.stageCostUsdPer1k === 'object'
      ? (input.stageCostUsdPer1k as Record<string, unknown>)
      : {};
  const retryBudgetInput =
    input.retryBudget && typeof input.retryBudget === 'object'
      ? (input.retryBudget as Record<string, unknown>)
      : {};
  const contextHardCapTokens = Number(
    input.contextHardCapTokens ?? DEFAULT_MODE.contextHardCapTokens,
  );
  const retryDeltaMaxLines = Number(
    input.retryDeltaMaxLines ?? DEFAULT_MODE.retryDeltaMaxLines,
  );
  return {
    ecoMode: input.ecoMode !== false,
    forcedStage,
    stageTokenMultiplier: {
      low: clamp(
        Number(
          stageTokenMultiplierInput.low ??
            DEFAULT_MODE.stageTokenMultiplier.low,
        ),
        0.2,
        2.5,
      ),
      medium: clamp(
        Number(
          stageTokenMultiplierInput.medium ??
            DEFAULT_MODE.stageTokenMultiplier.medium,
        ),
        0.3,
        3,
      ),
      high: clamp(
        Number(
          stageTokenMultiplierInput.high ??
            DEFAULT_MODE.stageTokenMultiplier.high,
        ),
        0.4,
        4,
      ),
    },
    stageCostUsdPer1k: {
      low: clamp(
        Number(stageCostInput.low ?? DEFAULT_MODE.stageCostUsdPer1k.low),
        0.0001,
        0.1,
      ),
      medium: clamp(
        Number(stageCostInput.medium ?? DEFAULT_MODE.stageCostUsdPer1k.medium),
        0.0001,
        0.2,
      ),
      high: clamp(
        Number(stageCostInput.high ?? DEFAULT_MODE.stageCostUsdPer1k.high),
        0.0001,
        0.3,
      ),
    },
    contextHardCapTokens: clamp(
      Number.isFinite(contextHardCapTokens)
        ? contextHardCapTokens
        : DEFAULT_MODE.contextHardCapTokens,
      300,
      8000,
    ),
    retryDeltaMaxLines: clamp(
      Number.isFinite(retryDeltaMaxLines)
        ? retryDeltaMaxLines
        : DEFAULT_MODE.retryDeltaMaxLines,
      4,
      64,
    ),
    retryBudget: {
      autoRetry: clamp(
        Number(
          retryBudgetInput.autoRetry ?? DEFAULT_MODE.retryBudget.autoRetry,
        ),
        0,
        8,
      ),
      humanEdit: clamp(
        Number(
          retryBudgetInput.humanEdit ?? DEFAULT_MODE.retryBudget.humanEdit,
        ),
        0,
        4,
      ),
    },
  };
}

export function readRouterModeConfig(projectDir: string): RouterModeConfig {
  const file = modeFile(projectDir);
  if (!fs.existsSync(file)) return DEFAULT_MODE;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    return parseMode(parsed);
  } catch {
    return DEFAULT_MODE;
  }
}

export function writeRouterModeConfig(
  projectDir: string,
  patch: Partial<RouterModeConfig>,
): RouterModeConfig {
  ensureDir(projectDir);
  const current = readRouterModeConfig(projectDir);
  const next = parseMode({
    ...current,
    ...patch,
    stageTokenMultiplier: {
      ...current.stageTokenMultiplier,
      ...(patch.stageTokenMultiplier ?? {}),
    },
    stageCostUsdPer1k: {
      ...current.stageCostUsdPer1k,
      ...(patch.stageCostUsdPer1k ?? {}),
    },
    retryBudget: {
      ...current.retryBudget,
      ...(patch.retryBudget ?? {}),
    },
  });
  fs.writeFileSync(
    modeFile(projectDir),
    `${JSON.stringify(next, null, 2)}\n`,
    'utf-8',
  );
  return next;
}

function readSessionStore(projectDir: string): RouterSessionStore {
  const file = sessionStateFile(projectDir);
  if (!fs.existsSync(file)) return { sessions: {} };
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as RouterSessionStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions)
      return { sessions: {} };
    return {
      sessions: Object.fromEntries(
        Object.entries(parsed.sessions).map(([sessionID, state]) => [
          sessionID,
          {
            sessionID,
            consecutiveFailures: clamp(
              Number(state?.consecutiveFailures ?? 0),
              0,
              10,
            ),
            lastStage:
              state?.lastStage === 'low' ||
              state?.lastStage === 'medium' ||
              state?.lastStage === 'high'
                ? state.lastStage
                : 'medium',
            autoRetryUsed: clamp(Number(state?.autoRetryUsed ?? 0), 0, 20),
            humanEditUsed: clamp(Number(state?.humanEditUsed ?? 0), 0, 20),
            lastFixability:
              state?.lastFixability === 'impossible' ||
              state?.lastFixability === 'rewrite' ||
              state?.lastFixability === 'reduce_scope' ||
              state?.lastFixability === 'need_evidence' ||
              state?.lastFixability === 'retry_later' ||
              state?.lastFixability === 'unknown'
                ? state.lastFixability
                : 'unknown',
            lastFailureReason:
              typeof state?.lastFailureReason === 'string'
                ? state.lastFailureReason.slice(0, 200)
                : undefined,
            lastContextHash:
              typeof state?.lastContextHash === 'string'
                ? state.lastContextHash.slice(0, 128)
                : undefined,
            lastContextText:
              typeof state?.lastContextText === 'string'
                ? state.lastContextText.slice(0, 6000)
                : undefined,
            updatedAt: String(state?.updatedAt ?? nowIso()),
          } satisfies RouterSessionState,
        ]),
      ),
    };
  } catch {
    return { sessions: {} };
  }
}

function writeSessionStore(
  projectDir: string,
  store: RouterSessionStore,
): void {
  ensureDir(projectDir);
  fs.writeFileSync(
    sessionStateFile(projectDir),
    `${JSON.stringify(store, null, 2)}\n`,
    'utf-8',
  );
}

function getSessionState(
  projectDir: string,
  sessionID: string,
): RouterSessionState {
  const store = readSessionStore(projectDir);
  return (
    store.sessions[sessionID] ?? {
      sessionID,
      consecutiveFailures: 0,
      lastStage: 'medium',
      autoRetryUsed: 0,
      humanEditUsed: 0,
      lastFixability: 'unknown',
      lastFailureReason: undefined,
      lastContextHash: undefined,
      lastContextText: undefined,
      updatedAt: nowIso(),
    }
  );
}

function stageLevel(stage: RouteStage): number {
  if (stage === 'low') return 0;
  if (stage === 'medium') return 1;
  return 2;
}

function levelToStage(level: number): RouteStage {
  if (level <= 0) return 'low';
  if (level === 1) return 'medium';
  return 'high';
}

function readCostRows(projectDir: string, limit = 500): RouterCostRecord[] {
  const file = costFile(projectDir);
  if (!fs.existsSync(file)) return [];
  const rows = fs
    .readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RouterCostRecord;
      } catch {
        return null;
      }
    })
    .filter((item): item is RouterCostRecord => Boolean(item));
  return rows.slice(-Math.max(1, limit));
}

function appendCostRow(projectDir: string, row: RouterCostRecord): void {
  ensureDir(projectDir);
  fs.appendFileSync(costFile(projectDir), `${JSON.stringify(row)}\n`, 'utf-8');
}

export function analyzeRouteComplexity(text: string): RouteComplexitySignals {
  const normalized = String(text ?? '').trim();
  const reasons: string[] = [];
  let score = 0;

  if (normalized.length > 1600) {
    score += 2;
    reasons.push('long_request');
  } else if (normalized.length > 700) {
    score += 1;
    reasons.push('medium_length');
  }

  if (/```[\s\S]*```/.test(normalized)) {
    score += 2;
    reasons.push('contains_code_block');
  }

  if (
    /(架构|tradeoff|风险|risk|migration|重构|performance|性能|security|安全)/i.test(
      normalized,
    )
  ) {
    score += 1;
    reasons.push('architecture_or_risk');
  }

  if (
    /(并行|多步骤|pipeline|workflow|验证|verify|修复|fix|loop)/i.test(
      normalized,
    )
  ) {
    score += 1;
    reasons.push('multi_step_execution');
  }

  if (/(今天|马上|紧急|critical|p0|severe)/i.test(normalized)) {
    score += 1;
    reasons.push('urgency_signal');
  }

  const complexity: RouteComplexity =
    score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
  return { complexity, score, reasons };
}

function stageFromComplexity(complexity: RouteComplexity): RouteStage {
  if (complexity === 'high') return 'high';
  if (complexity === 'medium') return 'medium';
  return 'low';
}

function inferFixabilityFromReason(reason?: string): RouteFixability {
  const text = String(reason ?? '').toLowerCase();
  if (!text) return 'unknown';
  if (/permission|unauthorized|forbidden|policy_|kill_switch/.test(text)) {
    return 'impossible';
  }
  if (/invalid_|bad_request|parse|schema|syntax/.test(text)) {
    return 'rewrite';
  }
  if (/timeout|temporar|network|overload|rate_limit/.test(text)) {
    return 'retry_later';
  }
  if (
    /missing_evidence|receipt_uncertain|ui_style_mismatch|mismatch/.test(text)
  ) {
    return 'need_evidence';
  }
  if (/too_long|budget|scope/.test(text)) {
    return 'reduce_scope';
  }
  return 'unknown';
}

function inferRiskScore(input: {
  success: boolean;
  failureReason?: string;
  stage: RouteStage;
}): number {
  if (input.success) {
    return input.stage === 'high'
      ? 0.22
      : input.stage === 'medium'
        ? 0.16
        : 0.1;
  }
  const reason = String(input.failureReason ?? '').toLowerCase();
  if (/permission|forbidden|policy_|kill_switch|security/.test(reason))
    return 0.95;
  if (/timeout|overload|network|rate_limit/.test(reason)) return 0.75;
  if (/invalid_|schema|parse|bad_request/.test(reason)) return 0.62;
  return input.stage === 'high' ? 0.7 : input.stage === 'medium' ? 0.6 : 0.55;
}

function hashText(text: string): string {
  return createHash('sha256')
    .update(String(text ?? ''))
    .digest('hex');
}

function compressTextByStage(
  text: string,
  stage: RouteStage,
): { text: string; compressed: boolean } {
  const normalized = String(text ?? '').trim();
  if (!normalized) return { text: '', compressed: false };
  if (stage === 'high') return { text: normalized, compressed: false };
  if (stage === 'medium' && normalized.length <= 4200)
    return { text: normalized, compressed: false };
  if (stage === 'low' && normalized.length <= 1600)
    return { text: normalized, compressed: false };

  if (stage === 'medium') {
    const head = normalized.slice(0, 2600);
    const tail = normalized.slice(-1200);
    return {
      text: `${head}\n\n[MIYA_ROUTER_COMPRESSION stage=medium]\n...\n${tail}`,
      compressed: true,
    };
  }

  const head = normalized.slice(0, 900);
  const bulletLines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*0-9.]/.test(line))
    .slice(0, 8)
    .join('\n');
  const tail = normalized.slice(-480);
  const merged = [head, bulletLines, tail].filter(Boolean).join('\n');
  return {
    text: `${merged}\n\n[MIYA_ROUTER_COMPRESSION stage=low reason=eco_mode]`,
    compressed: true,
  };
}

function buildRetryDeltaContext(input: {
  text: string;
  previousText?: string;
  previousHash?: string;
  failureReason?: string;
  maxLines: number;
}): { text: string; applied: boolean } {
  const current = String(input.text ?? '').trim();
  const previous = String(input.previousText ?? '').trim();
  if (!current || !previous) return { text: current, applied: false };
  const previousLines = new Set(
    previous
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  let deltaLines = current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !previousLines.has(line))
    .slice(0, Math.max(4, input.maxLines));
  if (deltaLines.length === 0) {
    deltaLines = current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-Math.max(4, input.maxLines));
  }
  if (deltaLines.length === 0) return { text: current, applied: false };
  const baselineHash = (input.previousHash?.trim() || hashText(previous)).slice(
    0,
    16,
  );
  const reason = (input.failureReason ?? '').trim() || 'retry';
  const retryText = [
    '[MIYA_RETRY_DELTA]',
    `baseline_hash=${baselineHash}`,
    `reason=${reason.slice(0, 120)}`,
    ...deltaLines.map((line) => `+ ${line}`),
    '[MIYA_RETRY_DELTA_END]',
  ].join('\n');
  return { text: retryText, applied: true };
}

function applyContextHardCap(input: { text: string; capTokens: number }): {
  text: string;
  hardCapped: boolean;
} {
  const text = String(input.text ?? '').trim();
  const capTokens = Math.max(300, Math.floor(input.capTokens));
  const maxChars = Math.max(900, Math.floor(capTokens * 3.6));
  if (text.length <= maxChars) return { text, hardCapped: false };
  const reserve = 180;
  const headBudget = Math.max(300, Math.floor((maxChars - reserve) * 0.62));
  const tailBudget = Math.max(220, maxChars - reserve - headBudget);
  const head = text.slice(0, headBudget);
  const tail = text.slice(-tailBudget);
  const droppedChars = Math.max(0, text.length - head.length - tail.length);
  const ref = hashText(text).slice(0, 16);
  const cappedText = [
    head,
    '',
    `[MIYA_CONTEXT_HARD_CAP ref=${ref} cap_tokens=${capTokens} dropped_chars=${droppedChars}]`,
    '',
    tail,
  ].join('\n');
  return { text: cappedText, hardCapped: true };
}

function estimateInputTokens(text: string): number {
  const length = String(text ?? '').length;
  return Math.max(20, Math.ceil(length / 3.6));
}

function estimateOutputTokens(inputTokens: number, stage: RouteStage): number {
  if (stage === 'low') return Math.max(60, Math.ceil(inputTokens * 0.35));
  if (stage === 'medium') return Math.max(100, Math.ceil(inputTokens * 0.55));
  return Math.max(140, Math.ceil(inputTokens * 0.9));
}

export function buildRouteExecutionPlan(input: {
  projectDir: string;
  sessionID: string;
  text: string;
  availableAgents: string[];
  pinnedAgent?: string;
}): RouteExecutionPlan {
  const semantic = analyzeRouteSemantics(input.text);
  const intent = semantic.intent || classifyIntent(input.text);
  const complexity = analyzeRouteComplexity(input.text);
  const mode = readRouterModeConfig(input.projectDir);
  const session = getSessionState(input.projectDir, input.sessionID);
  const ranked = rankAgentsByFeedback(
    input.projectDir,
    intent,
    input.availableAgents,
  );
  const preferredAgent = resolveFallbackAgent(intent, input.availableAgents);
  const fallbackAgent = resolveFallbackAgent(intent, input.availableAgents);
  const selectedByFeedback = resolveAgentWithFeedback(
    intent,
    input.availableAgents,
    ranked,
  );
  const pinnedAgent = input.pinnedAgent?.trim();
  const selectedAgent =
    pinnedAgent && input.availableAgents.includes(pinnedAgent)
      ? pinnedAgent
      : selectedByFeedback;
  const feedbackScore =
    ranked.find((item) => item.agent === selectedAgent)?.score ?? 0;
  const feedbackSamples =
    ranked.find((item) => item.agent === selectedAgent)?.samples ?? 0;

  let stage = stageFromComplexity(complexity.complexity);
  const reasons = [...complexity.reasons];
  if (semantic.ambiguity >= 0.75) reasons.push('semantic_ambiguity_high');
  if (semantic.evidence.length > 0) {
    reasons.push(
      ...semantic.evidence.slice(0, 3).map((item) => `semantic_${item}`),
    );
  }
  let executionMode: 'auto' | 'human_gate' = 'auto';
  const fixabilityHint = session.lastFixability;
  const autoBudget = mode.retryBudget.autoRetry;
  const humanBudget = mode.retryBudget.humanEdit;

  if (mode.forcedStage) {
    stage = mode.forcedStage;
    reasons.push('forced_stage');
  } else {
    if (mode.ecoMode) {
      stage = levelToStage(stageLevel(stage) - 1);
      reasons.push('eco_mode_downshift');
    }
    if (session.consecutiveFailures >= 1) {
      stage = levelToStage(stageLevel(stage) + 1);
      reasons.push('failure_escalation_1');
    }
    if (session.consecutiveFailures >= 2) {
      stage = levelToStage(stageLevel(stage) + 1);
      reasons.push('failure_escalation_2');
    }
  }

  if (fixabilityHint === 'impossible') {
    executionMode = 'human_gate';
    stage = 'high';
    reasons.push('fixability_impossible_human_gate');
  } else if (session.autoRetryUsed >= autoBudget && autoBudget >= 0) {
    executionMode = 'human_gate';
    stage = 'high';
    reasons.push('auto_retry_budget_exhausted');
  } else if (session.lastFixability === 'need_evidence') {
    stage = 'high';
    reasons.push('evidence_recovery_escalation');
  }

  return {
    intent,
    complexity: complexity.complexity,
    complexityScore: complexity.score,
    semanticConfidence: semantic.confidence,
    semanticAmbiguity: semantic.ambiguity,
    semanticEvidence: semantic.evidence,
    stage,
    agent: selectedAgent,
    preferredAgent,
    fallbackAgent,
    feedbackScore,
    feedbackSamples,
    ecoMode: mode.ecoMode,
    reasons,
    fixabilityHint,
    retryBudget: {
      autoRetry: autoBudget,
      autoUsed: session.autoRetryUsed,
      humanEdit: humanBudget,
      humanUsed: session.humanEditUsed,
    },
    executionMode,
  };
}

export function prepareRoutePayload(
  projectDir: string,
  input: {
    text: string;
    stage: RouteStage;
    retry?: {
      attempt?: number;
      previousContextText?: string;
      previousContextHash?: string;
      failureReason?: string;
    };
  },
): {
  text: string;
  compressed: boolean;
  hardCapped: boolean;
  retryDeltaApplied: boolean;
  contextHash: string;
  inputTokens: number;
  outputTokensEstimate: number;
  totalTokensEstimate: number;
  baselineHighTokensEstimate: number;
  costUsdEstimate: number;
} {
  const mode = readRouterModeConfig(projectDir);
  const retryAttempt = Math.max(
    0,
    Math.floor(Number(input.retry?.attempt ?? 0)),
  );
  const retryDelta =
    retryAttempt > 0
      ? buildRetryDeltaContext({
          text: input.text,
          previousText: input.retry?.previousContextText,
          previousHash: input.retry?.previousContextHash,
          failureReason: input.retry?.failureReason,
          maxLines: mode.retryDeltaMaxLines,
        })
      : { text: input.text, applied: false };
  const compressed = compressTextByStage(retryDelta.text, input.stage);
  const hardCap = applyContextHardCap({
    text: compressed.text,
    capTokens: mode.contextHardCapTokens,
  });
  const inputTokens = estimateInputTokens(hardCap.text);
  const outputTokensEstimate = estimateOutputTokens(inputTokens, input.stage);
  const totalTokensEstimate = Math.ceil(
    (inputTokens + outputTokensEstimate) *
      mode.stageTokenMultiplier[input.stage],
  );
  const baselineHighTokensEstimate = Math.ceil(
    (inputTokens + estimateOutputTokens(inputTokens, 'high')) *
      mode.stageTokenMultiplier.high,
  );
  const costUsdEstimate = Number(
    (
      (totalTokensEstimate / 1000) *
      mode.stageCostUsdPer1k[input.stage]
    ).toFixed(6),
  );
  return {
    text: hardCap.text,
    compressed: compressed.compressed,
    hardCapped: hardCap.hardCapped,
    retryDeltaApplied: retryDelta.applied,
    contextHash: hashText(hardCap.text),
    inputTokens,
    outputTokensEstimate,
    totalTokensEstimate,
    baselineHighTokensEstimate,
    costUsdEstimate,
  };
}

export function recordRouteExecutionOutcome(input: {
  projectDir: string;
  sessionID: string;
  intent: RouteIntent;
  complexity: RouteComplexity;
  stage: RouteStage;
  agent: string;
  success: boolean;
  inputTokens: number;
  outputTokensEstimate: number;
  totalTokensEstimate: number;
  baselineHighTokensEstimate: number;
  costUsdEstimate: number;
  failureReason?: string;
  attemptType?: 'auto' | 'human';
  contextHash?: string;
  contextText?: string;
}): RouterCostRecord {
  const row: RouterCostRecord = {
    at: nowIso(),
    sessionID: input.sessionID,
    intent: input.intent,
    complexity: input.complexity,
    stage: input.stage,
    agent: input.agent,
    success: input.success,
    inputTokens: input.inputTokens,
    outputTokensEstimate: input.outputTokensEstimate,
    totalTokensEstimate: input.totalTokensEstimate,
    baselineHighTokensEstimate: input.baselineHighTokensEstimate,
    costUsdEstimate: input.costUsdEstimate,
  };
  appendCostRow(input.projectDir, row);

  const store = readSessionStore(input.projectDir);
  const mode = readRouterModeConfig(input.projectDir);
  const current = store.sessions[input.sessionID] ?? {
    sessionID: input.sessionID,
    consecutiveFailures: 0,
    lastStage: input.stage,
    autoRetryUsed: 0,
    humanEditUsed: 0,
    lastFixability: 'unknown' as RouteFixability,
    lastFailureReason: undefined,
    lastContextHash: undefined,
    lastContextText: undefined,
    updatedAt: nowIso(),
  };
  const inferredFixability = input.success
    ? 'unknown'
    : inferFixabilityFromReason(input.failureReason);
  const attemptType = input.attemptType ?? 'auto';
  const nextAutoUsed = input.success
    ? 0
    : attemptType === 'auto'
      ? clamp(current.autoRetryUsed + 1, 0, 20)
      : current.autoRetryUsed;
  const nextHumanUsed = input.success
    ? 0
    : attemptType === 'human'
      ? clamp(current.humanEditUsed + 1, 0, 20)
      : current.humanEditUsed;
  const next: RouterSessionState = {
    sessionID: input.sessionID,
    consecutiveFailures: input.success
      ? 0
      : clamp(current.consecutiveFailures + 1, 0, 10),
    lastStage: input.stage,
    autoRetryUsed: Math.min(nextAutoUsed, mode.retryBudget.autoRetry + 6),
    humanEditUsed: Math.min(nextHumanUsed, mode.retryBudget.humanEdit + 4),
    lastFixability: inferredFixability,
    lastFailureReason: input.success
      ? undefined
      : String(input.failureReason ?? '').slice(0, 200),
    lastContextHash:
      typeof input.contextHash === 'string'
        ? input.contextHash.slice(0, 128)
        : undefined,
    lastContextText:
      typeof input.contextText === 'string'
        ? input.contextText.slice(0, 6000)
        : undefined,
    updatedAt: nowIso(),
  };
  store.sessions[input.sessionID] = next;
  writeSessionStore(input.projectDir, store);
  addRouteFeedback(input.projectDir, {
    text: `${input.intent}|${input.agent}|${input.stage}`,
    intent: input.intent,
    suggestedAgent: input.agent,
    accepted: input.success,
    success: input.success,
    costUsdEstimate: input.costUsdEstimate,
    riskScore: inferRiskScore({
      success: input.success,
      failureReason: input.failureReason,
      stage: input.stage,
    }),
    failureReason: input.failureReason,
    stage: input.stage,
  });
  const variant = resolveStrategyVariant(
    input.projectDir,
    'routing',
    input.sessionID,
  );
  recordStrategyObservation(input.projectDir, {
    experiment: 'routing',
    variant,
    subjectID: input.sessionID,
    success: input.success,
    costUsd: input.costUsdEstimate,
    riskScore: inferRiskScore({
      success: input.success,
      failureReason: input.failureReason,
      stage: input.stage,
    }),
    metadata: {
      intent: input.intent,
      stage: input.stage,
      agent: input.agent,
    },
  });
  return row;
}

export function getRouteCostSummary(
  projectDir: string,
  limit = 300,
): RouterCostSummary {
  const rows = readCostRows(projectDir, limit);
  const byStage: RouterCostSummary['byStage'] = {
    low: { records: 0, tokens: 0, costUsd: 0 },
    medium: { records: 0, tokens: 0, costUsd: 0 },
    high: { records: 0, tokens: 0, costUsd: 0 },
  };
  let totalTokensEstimate = 0;
  let baselineHighTokensEstimate = 0;
  let totalCostUsdEstimate = 0;

  for (const row of rows) {
    byStage[row.stage].records += 1;
    byStage[row.stage].tokens += row.totalTokensEstimate;
    byStage[row.stage].costUsd += row.costUsdEstimate;
    totalTokensEstimate += row.totalTokensEstimate;
    baselineHighTokensEstimate += row.baselineHighTokensEstimate;
    totalCostUsdEstimate += row.costUsdEstimate;
  }
  const savingsTokensEstimate = Math.max(
    0,
    baselineHighTokensEstimate - totalTokensEstimate,
  );
  const savingsPercentEstimate =
    baselineHighTokensEstimate > 0
      ? Number(
          ((savingsTokensEstimate / baselineHighTokensEstimate) * 100).toFixed(
            2,
          ),
        )
      : 0;

  return {
    totalRecords: rows.length,
    totalTokensEstimate,
    baselineHighTokensEstimate,
    savingsTokensEstimate,
    savingsPercentEstimate,
    totalCostUsdEstimate: Number(totalCostUsdEstimate.toFixed(6)),
    byStage: {
      low: {
        ...byStage.low,
        costUsd: Number(byStage.low.costUsd.toFixed(6)),
      },
      medium: {
        ...byStage.medium,
        costUsd: Number(byStage.medium.costUsd.toFixed(6)),
      },
      high: {
        ...byStage.high,
        costUsd: Number(byStage.high.costUsd.toFixed(6)),
      },
    },
  };
}

export function listRouteCostRecords(
  projectDir: string,
  limit = 40,
): RouterCostRecord[] {
  return readCostRows(projectDir, limit);
}

export function getRouterSessionState(
  projectDir: string,
  sessionID: string,
): RouterSessionState {
  return getSessionState(projectDir, sessionID);
}
