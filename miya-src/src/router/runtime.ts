import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { classifyIntent, type RouteIntent } from './classifier';
import { resolveAgentWithFeedback, resolveFallbackAgent } from './fallback';
import { rankAgentsByFeedback } from './learner';

export type RouteComplexity = 'low' | 'medium' | 'high';
export type RouteStage = 'low' | 'medium' | 'high';
export type RouteContextStrategy = 'minimal' | 'summary' | 'full';

export interface RouterModeConfig {
  ecoMode: boolean;
  forcedStage?: RouteStage;
  stageTokenMultiplier: Record<RouteStage, number>;
  stageCostUsdPer1k: Record<RouteStage, number>;
  autoParallelEnabled: boolean;
  autoParallelMinComplexity: RouteComplexity;
  autoParallelMaxAgents: number;
  sourceAllowlist: string[];
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
  stage: RouteStage;
  agent: string;
  plannedAgents: string[];
  maxAgents: number;
  contextStrategy: RouteContextStrategy;
  requiresMultipleSteps: boolean;
  enableEarlyExit: boolean;
  preferredAgent: string;
  fallbackAgent: string;
  feedbackScore: number;
  feedbackSamples: number;
  ecoMode: boolean;
  executionMode: 'sequential' | 'auto_parallel';
  orchestrationReason: string;
  reasons: string[];
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
  autoParallelEnabled: true,
  autoParallelMinComplexity: 'high',
  autoParallelMaxAgents: 5,
  sourceAllowlist: ['main', 'opencode', 'automation', 'daemon.'],
};

const ORCHESTRATION_ORDER = [
  '1-task-manager',
  '2-code-search',
  '3-docs-helper',
  '4-architecture-advisor',
  '5-code-fixer',
  '6-ui-designer',
  '7-code-simplicity-reviewer',
] as const;

function getComplexityProfile(complexity: RouteComplexity): {
  maxAgents: number;
  contextStrategy: RouteContextStrategy;
  enableEarlyExit: boolean;
} {
  if (complexity === 'low') {
    return { maxAgents: 1, contextStrategy: 'minimal', enableEarlyExit: true };
  }
  if (complexity === 'medium') {
    return { maxAgents: 3, contextStrategy: 'summary', enableEarlyExit: true };
  }
  return { maxAgents: 7, contextStrategy: 'full', enableEarlyExit: false };
}

function primaryAgentForIntent(intent: RouteIntent): string {
  if (intent === 'code_fix') return '5-code-fixer';
  if (intent === 'code_search') return '2-code-search';
  if (intent === 'docs_research') return '3-docs-helper';
  if (intent === 'architecture') return '4-architecture-advisor';
  if (intent === 'ui_design') return '6-ui-designer';
  return '1-task-manager';
}

function buildAgentPlan(input: {
  complexity: RouteComplexity;
  intent: RouteIntent;
  selectedAgent: string;
  availableAgents: string[];
  pinnedAgent?: string;
}): {
  plannedAgents: string[];
  maxAgents: number;
  contextStrategy: RouteContextStrategy;
  requiresMultipleSteps: boolean;
  enableEarlyExit: boolean;
} {
  const profile = getComplexityProfile(input.complexity);
  const include = (target: string, list: string[]): string[] => {
    if (
      !target ||
      !input.availableAgents.includes(target) ||
      list.includes(target)
    )
      return list;
    return [...list, target];
  };

  if (input.pinnedAgent) {
    return {
      plannedAgents: [input.selectedAgent],
      maxAgents: 1,
      contextStrategy: 'minimal',
      requiresMultipleSteps: false,
      enableEarlyExit: true,
    };
  }

  if (input.complexity === 'low') {
    return {
      plannedAgents: [input.selectedAgent],
      maxAgents: profile.maxAgents,
      contextStrategy: profile.contextStrategy,
      requiresMultipleSteps: false,
      enableEarlyExit: profile.enableEarlyExit,
    };
  }

  if (input.complexity === 'medium') {
    let plan: string[] = [];
    plan = include('1-task-manager', plan);
    plan = include(input.selectedAgent, plan);
    plan = include(primaryAgentForIntent(input.intent), plan);
    plan = include('5-code-fixer', plan);
    return {
      plannedAgents: plan.slice(0, profile.maxAgents),
      maxAgents: profile.maxAgents,
      contextStrategy: profile.contextStrategy,
      requiresMultipleSteps: true,
      enableEarlyExit: profile.enableEarlyExit,
    };
  }

  const highPlan = [
    '1-task-manager',
    input.selectedAgent,
    primaryAgentForIntent(input.intent),
    ...ORCHESTRATION_ORDER,
  ]
    .filter((agent, index, arr) => arr.indexOf(agent) === index)
    .filter((agent) => input.availableAgents.includes(agent))
    .slice(0, profile.maxAgents);

  return {
    plannedAgents: highPlan,
    maxAgents: profile.maxAgents,
    contextStrategy: profile.contextStrategy,
    requiresMultipleSteps: true,
    enableEarlyExit: profile.enableEarlyExit,
  };
}

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
  const autoParallelMinComplexity =
    input.autoParallelMinComplexity === 'low' ||
    input.autoParallelMinComplexity === 'medium' ||
    input.autoParallelMinComplexity === 'high'
      ? input.autoParallelMinComplexity
      : DEFAULT_MODE.autoParallelMinComplexity;
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
    autoParallelEnabled: input.autoParallelEnabled !== false,
    autoParallelMinComplexity,
    autoParallelMaxAgents: clamp(
      Number(input.autoParallelMaxAgents ?? DEFAULT_MODE.autoParallelMaxAgents),
      1,
      7,
    ),
    sourceAllowlist: Array.isArray(input.sourceAllowlist)
      ? input.sourceAllowlist
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : DEFAULT_MODE.sourceAllowlist,
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

function complexityLevel(complexity: RouteComplexity): number {
  if (complexity === 'low') return 0;
  if (complexity === 'medium') return 1;
  return 2;
}

function isSourceAllowed(
  source: string | undefined,
  allowlist: string[],
): boolean {
  const normalized = String(source ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  const blockedPrefixes = [
    'qq',
    'wechat',
    'policy:',
    'outbound',
    'desktop_control',
  ];
  if (blockedPrefixes.some((prefix) => normalized.startsWith(prefix)))
    return false;
  if (allowlist.length === 0) return true;
  return allowlist.some((entry) => {
    const expected = entry.toLowerCase();
    return normalized === expected || normalized.startsWith(expected);
  });
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
  source?: string;
}): RouteExecutionPlan {
  const intent = classifyIntent(input.text);
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

  const agentPlan = buildAgentPlan({
    complexity: complexity.complexity,
    intent,
    selectedAgent,
    availableAgents: input.availableAgents,
    pinnedAgent:
      pinnedAgent && input.availableAgents.includes(pinnedAgent)
        ? pinnedAgent
        : undefined,
  });
  if (agentPlan.plannedAgents.length > 1) {
    reasons.push('multi_agent_plan');
  }
  if (pinnedAgent && input.availableAgents.includes(pinnedAgent)) {
    reasons.push('pinned_agent_lock');
  }

  const minComplexityLevel = complexityLevel(mode.autoParallelMinComplexity);
  const currentComplexityLevel = complexityLevel(complexity.complexity);
  const sourceAllowed = isSourceAllowed(input.source, mode.sourceAllowlist);
  const autoParallelReady =
    mode.autoParallelEnabled &&
    currentComplexityLevel >= minComplexityLevel &&
    sourceAllowed &&
    !pinnedAgent;
  const executionMode = autoParallelReady ? 'auto_parallel' : 'sequential';
  const orchestrationReason = autoParallelReady
    ? 'auto_parallel_by_router_policy'
    : sourceAllowed
      ? 'sequential_by_complexity_or_pin'
      : 'sequential_by_source_policy';
  if (autoParallelReady) {
    reasons.push('auto_parallel_enabled');
  } else if (!sourceAllowed) {
    reasons.push('auto_parallel_blocked_by_source');
  }

  return {
    intent,
    complexity: complexity.complexity,
    complexityScore: complexity.score,
    stage,
    agent: selectedAgent,
    plannedAgents: agentPlan.plannedAgents,
    maxAgents: agentPlan.maxAgents,
    contextStrategy: agentPlan.contextStrategy,
    requiresMultipleSteps: agentPlan.requiresMultipleSteps,
    enableEarlyExit: agentPlan.enableEarlyExit,
    preferredAgent,
    fallbackAgent,
    feedbackScore,
    feedbackSamples,
    ecoMode: mode.ecoMode,
    executionMode,
    orchestrationReason,
    reasons,
  };
}

export function prepareRoutePayload(
  projectDir: string,
  input: {
    text: string;
    stage: RouteStage;
  },
): {
  text: string;
  compressed: boolean;
  inputTokens: number;
  outputTokensEstimate: number;
  totalTokensEstimate: number;
  baselineHighTokensEstimate: number;
  costUsdEstimate: number;
} {
  const mode = readRouterModeConfig(projectDir);
  const compressed = compressTextByStage(input.text, input.stage);
  const inputTokens = estimateInputTokens(compressed.text);
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
    text: compressed.text,
    compressed: compressed.compressed,
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
  const current = store.sessions[input.sessionID] ?? {
    sessionID: input.sessionID,
    consecutiveFailures: 0,
    lastStage: input.stage,
    updatedAt: nowIso(),
  };
  const next: RouterSessionState = {
    sessionID: input.sessionID,
    consecutiveFailures: input.success
      ? 0
      : clamp(current.consecutiveFailures + 1, 0, 10),
    lastStage: input.stage,
    updatedAt: nowIso(),
  };
  store.sessions[input.sessionID] = next;
  writeSessionStore(input.projectDir, store);
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
