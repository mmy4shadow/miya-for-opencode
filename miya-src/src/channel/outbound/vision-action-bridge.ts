import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { getMiyaRuntimeDir } from '../../workflow';

export type DesktopPerceptionRoute = 'L0_ACTION_MEMORY' | 'L1_UIA' | 'L2_OCR' | 'L3_SOM_VLM';
export type AutomationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

const desktopIntentSchema = z.object({
  kind: z.literal('desktop_outbound_send'),
  channel: z.enum(['qq', 'wechat']),
  appName: z.enum(['QQ', 'WeChat']),
  destination: z.string().trim().min(1),
  payloadHash: z.string().trim().min(8),
  hasText: z.boolean(),
  hasMedia: z.boolean(),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('LOW'),
});

const somCandidateSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().trim().max(120).optional(),
  coarse: z.object({
    row: z.number().int().min(0).max(9),
    col: z.number().int().min(0).max(9),
  }),
  roi: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  }),
  center: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  }),
  confidence: z.number().min(0).max(1).optional(),
});

const desktopScreenStateSchema = z.object({
  windowFingerprint: z.string().trim().max(240).optional(),
  captureMethod: z.enum(['wgc_hwnd', 'print_window', 'dxgi_duplication', 'uia_only', 'unknown']).default('unknown'),
  display: z.object({
    width: z.number().int().min(640).max(16_384),
    height: z.number().int().min(480).max(16_384),
  }),
  uiaAvailable: z.boolean(),
  ocrAvailable: z.boolean(),
  somCandidates: z.array(somCandidateSchema).max(120).optional(),
  lastOcrFingerprint: z.string().trim().max(240).optional(),
});

const actionPlanStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'focus_window',
    'resolve_target',
    'prepare_media',
    'commit_media',
    'prepare_text',
    'commit_text',
    'submit_send',
    'verify_receipt',
  ]),
  via: z.enum(['L0_ACTION_MEMORY', 'L1_UIA', 'L2_OCR', 'L3_SOM_VLM']),
  verify: z.array(z.enum(['uia_hit_test', 'pixel_fingerprint', 'window_fingerprint'])).max(3),
});

const desktopActionPlanSchema = z.object({
  protocol: z.literal('vision_action_bridge.v1'),
  intent: desktopIntentSchema,
  screen_state: desktopScreenStateSchema,
  action_plan: z.object({
    routeLevel: z.enum(['L0_ACTION_MEMORY', 'L1_UIA', 'L2_OCR', 'L3_SOM_VLM']),
    replaySkillId: z.string().trim().max(120).optional(),
    memoryHit: z.boolean(),
    tokenPolicy: z.object({
      defaultNoVlm: z.literal(true),
      roiOnlyWhenVlm: z.literal(true),
      promptTemplate: z.literal('som_candidate_index_v1'),
      schemaMode: z.literal('json_only'),
      maxVlmCallsPerStep: z.number().int().min(1).max(2),
    }),
    som: z.object({
      enabled: z.boolean(),
      selectionSource: z.enum(['memory', 'heuristic', 'vlm', 'none']),
      selectedCandidateId: z.number().int().positive().optional(),
      vlmCallsBudget: z.number().int().min(0).max(2),
      candidates: z.array(somCandidateSchema).max(120),
    }),
    steps: z.array(actionPlanStepSchema).min(3).max(12),
  }),
});

export type DesktopAutomationIntent = z.infer<typeof desktopIntentSchema>;
export type DesktopSomCandidate = z.infer<typeof somCandidateSchema>;
export type DesktopScreenState = z.infer<typeof desktopScreenStateSchema>;
export type DesktopActionPlan = z.infer<typeof desktopActionPlanSchema>;

interface ActionMemoryRecord {
  id: string;
  key: string;
  channel: DesktopAutomationIntent['channel'];
  appName: DesktopAutomationIntent['appName'];
  destination: string;
  routeLevel: DesktopPerceptionRoute;
  replaySkillId: string;
  windowFingerprint?: string;
  somCandidateId?: number;
  successCount: number;
  failCount: number;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt?: string;
  avgLatencyMs: number;
}

interface ActionMemoryStore {
  records: ActionMemoryRecord[];
}

interface DesktopAutomationMetricsStore {
  createdAt: string;
  updatedAt: string;
  totalRuns: number;
  successfulRuns: number;
  vlmCalls: number;
  somRuns: number;
  somSuccessRuns: number;
  highRiskRuns: number;
  highRiskMisfireRuns: number;
  reuseRuns: number;
  firstRuns: number;
  reuseLatencyMs: number[];
  firstLatencyMs: number[];
}

export interface DesktopActionOutcomeInput {
  intent: DesktopAutomationIntent;
  screenState: DesktopScreenState;
  actionPlan: DesktopActionPlan;
  sent: boolean;
  latencyMs: number;
  vlmCallsUsed?: number;
  somSucceeded?: boolean;
  highRiskMisfire?: boolean;
}

export interface DesktopAutomationKpiSnapshot {
  totalRuns: number;
  successfulRuns: number;
  vlmCallRatio: number;
  somPathHitRate: number;
  reuseTaskP95Ms: number;
  firstTaskP95Ms: number;
  highRiskMisfireRate: number;
  reuseRuns: number;
  firstRuns: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeDestination(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function runtimeDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'channels');
}

function actionMemoryFile(projectDir: string): string {
  return path.join(runtimeDir(projectDir), 'desktop-action-memory.json');
}

function metricsFile(projectDir: string): string {
  return path.join(runtimeDir(projectDir), 'desktop-automation-metrics.json');
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJsonFile<T>(file: string, value: T): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function buildMemoryKey(intent: DesktopAutomationIntent): string {
  return [
    intent.channel,
    intent.appName.toLowerCase(),
    createHash('sha1').update(normalizeDestination(intent.destination)).digest('hex').slice(0, 10),
  ].join('|');
}

function normalizeMemoryStore(raw: ActionMemoryStore): ActionMemoryStore {
  if (!raw || !Array.isArray(raw.records)) return { records: [] };
  const normalized = raw.records
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      id: String(row.id ?? randomUUID()),
      key: String(row.key ?? ''),
      channel: (row.channel === 'wechat' ? 'wechat' : 'qq') as ActionMemoryRecord['channel'],
      appName: (row.appName === 'WeChat' ? 'WeChat' : 'QQ') as ActionMemoryRecord['appName'],
      destination: String(row.destination ?? ''),
      routeLevel: normalizeRoute(row.routeLevel),
      replaySkillId: String(row.replaySkillId ?? ''),
      windowFingerprint: row.windowFingerprint ? String(row.windowFingerprint) : undefined,
      somCandidateId:
        typeof row.somCandidateId === 'number' && Number.isFinite(row.somCandidateId)
          ? Math.floor(row.somCandidateId)
          : undefined,
      successCount: Math.max(0, Math.floor(Number(row.successCount ?? 0) || 0)),
      failCount: Math.max(0, Math.floor(Number(row.failCount ?? 0) || 0)),
      createdAt: String(row.createdAt ?? nowIso()),
      updatedAt: String(row.updatedAt ?? nowIso()),
      lastSuccessAt: row.lastSuccessAt ? String(row.lastSuccessAt) : undefined,
      avgLatencyMs: clamp(Number(row.avgLatencyMs ?? 0), 0, 60_000),
    }))
    .filter((row) => row.key.length > 0);
  return {
    records: normalized.slice(0, 800),
  };
}

function normalizeRoute(value: unknown): DesktopPerceptionRoute {
  if (value === 'L0_ACTION_MEMORY') return 'L0_ACTION_MEMORY';
  if (value === 'L1_UIA') return 'L1_UIA';
  if (value === 'L2_OCR') return 'L2_OCR';
  return 'L3_SOM_VLM';
}

function readActionMemory(projectDir: string): ActionMemoryStore {
  const store = readJsonFile<ActionMemoryStore>(actionMemoryFile(projectDir), { records: [] });
  const normalized = normalizeMemoryStore(store);
  writeJsonFile(actionMemoryFile(projectDir), normalized);
  return normalized;
}

function writeActionMemory(projectDir: string, store: ActionMemoryStore): void {
  writeJsonFile(actionMemoryFile(projectDir), normalizeMemoryStore(store));
}

function memoryExpiryMs(): number {
  const raw = Number(process.env.MIYA_DESKTOP_ACTION_MEMORY_TTL_MS ?? 30 * 24 * 3600 * 1000);
  if (!Number.isFinite(raw)) return 30 * 24 * 3600 * 1000;
  return Math.max(3_600_000, Math.min(180 * 24 * 3600 * 1000, Math.floor(raw)));
}

function isMemoryRecordHot(record: ActionMemoryRecord, screen: DesktopScreenState): boolean {
  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  if (Date.now() - updatedAt > memoryExpiryMs()) return false;
  if (record.failCount > record.successCount + 1) return false;
  if (record.windowFingerprint && screen.windowFingerprint && record.windowFingerprint !== screen.windowFingerprint) {
    return false;
  }
  return true;
}

function defaultSomCandidates(screen: DesktopScreenState): DesktopSomCandidate[] {
  const width = screen.display.width;
  const height = screen.display.height;
  const cellW = Math.max(1, Math.floor(width / 10));
  const cellH = Math.max(1, Math.floor(height / 10));
  const candidates: DesktopSomCandidate[] = [];
  let id = 1;
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const x = col * cellW;
      const y = row * cellH;
      candidates.push({
        id,
        coarse: { row, col },
        roi: {
          x,
          y,
          width: Math.max(1, Math.min(cellW, width - x)),
          height: Math.max(1, Math.min(cellH, height - y)),
        },
        center: {
          x: Math.max(0, Math.min(width - 1, x + Math.floor(cellW / 2))),
          y: Math.max(0, Math.min(height - 1, y + Math.floor(cellH / 2))),
        },
      });
      id += 1;
    }
  }
  return candidates;
}

function normalizeSomCandidates(input: DesktopScreenState): DesktopSomCandidate[] {
  const base = Array.isArray(input.somCandidates) && input.somCandidates.length > 0
    ? input.somCandidates
    : defaultSomCandidates(input);
  return base
    .filter((row) => row && Number.isFinite(row.id))
    .sort((a, b) => a.id - b.id)
    .slice(0, 120);
}

function chooseSomCandidateByHeuristic(
  candidates: DesktopSomCandidate[],
  intent: DesktopAutomationIntent,
): number | undefined {
  const destination = normalizeDestination(intent.destination);
  const sendHints = ['send', '发送', '发 送', 'sent', 'deliver', '提交', '确认'];
  const destinationMatch = candidates.find((item) => {
    const label = normalizeDestination(item.label ?? '');
    return label.length > 0 && destination.length > 0 && label.includes(destination);
  });
  if (destinationMatch) return destinationMatch.id;
  const sendMatch = candidates.find((item) => {
    const label = String(item.label ?? '').toLowerCase();
    return sendHints.some((hint) => label.includes(hint));
  });
  if (sendMatch) return sendMatch.id;
  return undefined;
}

function buildSteps(route: DesktopPerceptionRoute, intent: DesktopAutomationIntent) {
  const steps: z.infer<typeof actionPlanStepSchema>[] = [
    {
      id: 'focus_window',
      kind: 'focus_window',
      via: route,
      verify: ['window_fingerprint'],
    },
    {
      id: 'resolve_target',
      kind: 'resolve_target',
      via: route,
      verify: ['uia_hit_test', 'pixel_fingerprint'],
    },
  ];
  if (intent.hasMedia) {
    steps.push({
      id: 'prepare_media',
      kind: 'prepare_media',
      via: route,
      verify: ['window_fingerprint'],
    });
    steps.push({
      id: 'commit_media',
      kind: 'commit_media',
      via: route,
      verify: ['uia_hit_test'],
    });
  }
  if (intent.hasText) {
    steps.push({
      id: 'prepare_text',
      kind: 'prepare_text',
      via: route,
      verify: ['window_fingerprint'],
    });
    steps.push({
      id: 'commit_text',
      kind: 'commit_text',
      via: route,
      verify: ['uia_hit_test'],
    });
  }
  steps.push({
    id: 'submit_send',
    kind: 'submit_send',
    via: route,
    verify: ['uia_hit_test', 'pixel_fingerprint'],
  });
  steps.push({
    id: 'verify_receipt',
    kind: 'verify_receipt',
    via: route,
    verify: ['window_fingerprint'],
  });
  return steps;
}

export function buildDesktopActionPlan(input: {
  projectDir: string;
  intent: DesktopAutomationIntent;
  screenState: DesktopScreenState;
}): DesktopActionPlan {
  const intent = desktopIntentSchema.parse(input.intent);
  const screenState = desktopScreenStateSchema.parse(input.screenState);
  const memory = readActionMemory(input.projectDir);
  const memoryKey = buildMemoryKey(intent);
  const matchedMemory = memory.records.find((row) => row.key === memoryKey && isMemoryRecordHot(row, screenState));
  const somCandidates = normalizeSomCandidates(screenState);

  let routeLevel: DesktopPerceptionRoute = 'L3_SOM_VLM';
  if (matchedMemory) routeLevel = 'L0_ACTION_MEMORY';
  else if (screenState.uiaAvailable) routeLevel = 'L1_UIA';
  else if (screenState.ocrAvailable) routeLevel = 'L2_OCR';

  let selectedCandidateId: number | undefined = undefined;
  let selectionSource: 'memory' | 'heuristic' | 'vlm' | 'none' = 'none';
  if (routeLevel === 'L0_ACTION_MEMORY' && matchedMemory?.somCandidateId) {
    selectedCandidateId = matchedMemory.somCandidateId;
    selectionSource = 'memory';
  } else {
    const heuristic = chooseSomCandidateByHeuristic(somCandidates, intent);
    if (heuristic) {
      selectedCandidateId = heuristic;
      selectionSource = 'heuristic';
    }
  }

  const vlmCallsBudget = routeLevel === 'L3_SOM_VLM' && !selectedCandidateId ? 2 : 0;
  const replaySkillId =
    matchedMemory?.replaySkillId ||
    `desktop_replay_${intent.channel}_${createHash('sha1').update(memoryKey).digest('hex').slice(0, 8)}`;
  const somCandidatesForPlan = routeLevel === 'L3_SOM_VLM' ? somCandidates : [];

  return desktopActionPlanSchema.parse({
    protocol: 'vision_action_bridge.v1',
    intent,
    screen_state: screenState,
    action_plan: {
      routeLevel,
      replaySkillId,
      memoryHit: Boolean(matchedMemory),
      tokenPolicy: {
        defaultNoVlm: true,
        roiOnlyWhenVlm: true,
        promptTemplate: 'som_candidate_index_v1',
        schemaMode: 'json_only',
        maxVlmCallsPerStep: 2,
      },
      som: {
        enabled: routeLevel === 'L3_SOM_VLM',
        selectionSource,
        selectedCandidateId,
        vlmCallsBudget,
        candidates: somCandidatesForPlan,
      },
      steps: buildSteps(routeLevel, intent),
    },
  });
}

function normalizeMetrics(raw: DesktopAutomationMetricsStore): DesktopAutomationMetricsStore {
  const fallbackNow = nowIso();
  const asNumArray = (rows: unknown): number[] =>
    Array.isArray(rows)
      ? rows
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item) && item >= 0)
          .map((item) => Math.floor(item))
      : [];
  return {
    createdAt: String(raw.createdAt ?? fallbackNow),
    updatedAt: String(raw.updatedAt ?? fallbackNow),
    totalRuns: Math.max(0, Math.floor(Number(raw.totalRuns ?? 0) || 0)),
    successfulRuns: Math.max(0, Math.floor(Number(raw.successfulRuns ?? 0) || 0)),
    vlmCalls: Math.max(0, Math.floor(Number(raw.vlmCalls ?? 0) || 0)),
    somRuns: Math.max(0, Math.floor(Number(raw.somRuns ?? 0) || 0)),
    somSuccessRuns: Math.max(0, Math.floor(Number(raw.somSuccessRuns ?? 0) || 0)),
    highRiskRuns: Math.max(0, Math.floor(Number(raw.highRiskRuns ?? 0) || 0)),
    highRiskMisfireRuns: Math.max(0, Math.floor(Number(raw.highRiskMisfireRuns ?? 0) || 0)),
    reuseRuns: Math.max(0, Math.floor(Number(raw.reuseRuns ?? 0) || 0)),
    firstRuns: Math.max(0, Math.floor(Number(raw.firstRuns ?? 0) || 0)),
    reuseLatencyMs: asNumArray(raw.reuseLatencyMs).slice(-500),
    firstLatencyMs: asNumArray(raw.firstLatencyMs).slice(-500),
  };
}

function readMetrics(projectDir: string): DesktopAutomationMetricsStore {
  const fallback: DesktopAutomationMetricsStore = {
    createdAt: nowIso(),
    updatedAt: nowIso(),
    totalRuns: 0,
    successfulRuns: 0,
    vlmCalls: 0,
    somRuns: 0,
    somSuccessRuns: 0,
    highRiskRuns: 0,
    highRiskMisfireRuns: 0,
    reuseRuns: 0,
    firstRuns: 0,
    reuseLatencyMs: [],
    firstLatencyMs: [],
  };
  const parsed = readJsonFile<DesktopAutomationMetricsStore>(metricsFile(projectDir), fallback);
  const normalized = normalizeMetrics(parsed);
  writeJsonFile(metricsFile(projectDir), normalized);
  return normalized;
}

function writeMetrics(projectDir: string, metrics: DesktopAutomationMetricsStore): void {
  writeJsonFile(metricsFile(projectDir), normalizeMetrics(metrics));
}

function pushLatency(rows: number[], value: number): number[] {
  const next = [...rows, Math.max(0, Math.floor(value))];
  return next.slice(-500);
}

function p95(rows: number[]): number {
  if (rows.length === 0) return 0;
  const sorted = [...rows].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

export function recordDesktopActionOutcome(projectDir: string, input: DesktopActionOutcomeInput): void {
  const intent = desktopIntentSchema.parse(input.intent);
  const screenState = desktopScreenStateSchema.parse(input.screenState);
  const plan = desktopActionPlanSchema.parse(input.actionPlan);
  const latencyMs = Math.max(0, Math.floor(Number(input.latencyMs) || 0));

  const memory = readActionMemory(projectDir);
  const key = buildMemoryKey(intent);
  const existingIndex = memory.records.findIndex((row) => row.key === key);
  const now = nowIso();
  const existing = existingIndex >= 0 ? memory.records[existingIndex] : undefined;
  const successCount = (existing?.successCount ?? 0) + (input.sent ? 1 : 0);
  const failCount = (existing?.failCount ?? 0) + (input.sent ? 0 : 1);
  const previousAvg = existing?.avgLatencyMs ?? latencyMs;
  const previousRuns = Math.max(0, (existing?.successCount ?? 0) + (existing?.failCount ?? 0));
  const avgLatencyMs =
    previousRuns <= 0 ? latencyMs : Number(((previousAvg * previousRuns + latencyMs) / (previousRuns + 1)).toFixed(2));
  const nextRecord: ActionMemoryRecord = {
    id: existing?.id ?? randomUUID(),
    key,
    channel: intent.channel,
    appName: intent.appName,
    destination: normalizeDestination(intent.destination),
    routeLevel: plan.action_plan.routeLevel,
    replaySkillId:
      plan.action_plan.replaySkillId ??
      existing?.replaySkillId ??
      `desktop_replay_${intent.channel}_${createHash('sha1').update(key).digest('hex').slice(0, 8)}`,
    windowFingerprint: screenState.windowFingerprint || existing?.windowFingerprint,
    somCandidateId:
      plan.action_plan.som.selectedCandidateId ??
      existing?.somCandidateId,
    successCount,
    failCount,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSuccessAt: input.sent ? now : existing?.lastSuccessAt,
    avgLatencyMs,
  };
  if (existingIndex >= 0) memory.records[existingIndex] = nextRecord;
  else memory.records.unshift(nextRecord);
  memory.records = memory.records
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 800);
  writeActionMemory(projectDir, memory);

  const metrics = readMetrics(projectDir);
  metrics.updatedAt = now;
  metrics.totalRuns += 1;
  if (input.sent) metrics.successfulRuns += 1;
  const vlmCallsUsed = Math.max(0, Math.min(2, Math.floor(Number(input.vlmCallsUsed ?? 0) || 0)));
  metrics.vlmCalls += vlmCallsUsed;
  if (intent.risk === 'HIGH') {
    metrics.highRiskRuns += 1;
    if (input.highRiskMisfire) metrics.highRiskMisfireRuns += 1;
  }
  if (plan.action_plan.routeLevel === 'L3_SOM_VLM') {
    metrics.somRuns += 1;
    if (input.somSucceeded) metrics.somSuccessRuns += 1;
  }
  if (plan.action_plan.memoryHit) {
    metrics.reuseRuns += 1;
    metrics.reuseLatencyMs = pushLatency(metrics.reuseLatencyMs, latencyMs);
  } else {
    metrics.firstRuns += 1;
    metrics.firstLatencyMs = pushLatency(metrics.firstLatencyMs, latencyMs);
  }
  writeMetrics(projectDir, metrics);
}

export function readDesktopAutomationKpi(projectDir: string): DesktopAutomationKpiSnapshot {
  const metrics = readMetrics(projectDir);
  const totalRuns = Math.max(1, metrics.totalRuns);
  const somRuns = Math.max(1, metrics.somRuns);
  const highRiskRuns = Math.max(1, metrics.highRiskRuns);
  return {
    totalRuns: metrics.totalRuns,
    successfulRuns: metrics.successfulRuns,
    vlmCallRatio: Number((metrics.vlmCalls / totalRuns).toFixed(4)),
    somPathHitRate: Number((metrics.somSuccessRuns / somRuns).toFixed(4)),
    reuseTaskP95Ms: p95(metrics.reuseLatencyMs),
    firstTaskP95Ms: p95(metrics.firstLatencyMs),
    highRiskMisfireRate: Number((metrics.highRiskMisfireRuns / highRiskRuns).toFixed(4)),
    reuseRuns: metrics.reuseRuns,
    firstRuns: metrics.firstRuns,
  };
}
