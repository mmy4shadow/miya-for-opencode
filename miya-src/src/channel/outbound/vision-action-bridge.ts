import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
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

const ocrBoxSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  text: z.string().trim().min(1).max(240),
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
  ocrText: z.string().trim().max(4000).optional(),
  ocrBoxes: z.array(ocrBoxSchema).max(200).optional(),
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
      vlmCallsPlanned: z.number().int().min(0).max(2),
      candidates: z.array(somCandidateSchema).max(120),
    }),
    brains: z.object({
      fastBrain: z.object({
        role: z.literal('FAST_ACTION_MEMORY_REPLAY'),
        active: z.boolean(),
        replaySkillId: z.string().trim().max(120).optional(),
      }),
      slowBrain: z.object({
        role: z.literal('SLOW_TASK_PLANNER'),
        active: z.boolean(),
        planningRoute: z.enum(['L1_UIA', 'L2_OCR', 'L3_SOM_VLM']).optional(),
        promoteReplaySkillOnSuccess: z.literal(true),
      }),
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

export interface DesktopReplaySkillRecord {
  id: string;
  key: string;
  channel: DesktopAutomationIntent['channel'];
  appName: DesktopAutomationIntent['appName'];
  destination: string;
  routeLevel: DesktopPerceptionRoute;
  stepKinds: Array<z.infer<typeof actionPlanStepSchema>['kind']>;
  verifyPolicy: string[];
  somCandidateId?: number;
  windowFingerprint?: string;
  successCount: number;
  avgLatencyMs: number;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt?: string;
}

interface DesktopReplaySkillStore {
  records: DesktopReplaySkillRecord[];
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
  acceptance?: DesktopAutomationAcceptanceSnapshot;
}

export interface DesktopAutomationAcceptanceSnapshot {
  pass: boolean;
  thresholds: {
    maxVlmCallRatio: number;
    minSomPathHitRate: number;
    maxReuseTaskP95Ms: number;
    maxHighRiskMisfireRate: number;
  };
  checks: {
    vlmCallRatio: boolean;
    somPathHitRate: boolean;
    reuseTaskP95Ms: boolean;
    highRiskMisfireRate: boolean;
  };
  sample: {
    totalRuns: number;
    somRuns: number;
    reuseRuns: number;
    highRiskRuns: number;
  };
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

function replaySkillFile(projectDir: string): string {
  return path.join(runtimeDir(projectDir), 'desktop-replay-skills.json');
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

function normalizeReplaySkillStore(raw: DesktopReplaySkillStore): DesktopReplaySkillStore {
  if (!raw || !Array.isArray(raw.records)) return { records: [] };
  const normalized = raw.records
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const stepKinds = Array.isArray(row.stepKinds)
        ? row.stepKinds
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
            .filter((item): item is z.infer<typeof actionPlanStepSchema>['kind'] =>
              actionPlanStepSchema.shape.kind.options.includes(
                item as z.infer<typeof actionPlanStepSchema>['kind'],
              ),
            )
        : [];
      const verifyPolicy = Array.isArray(row.verifyPolicy)
        ? [...new Set(row.verifyPolicy.map((item) => String(item ?? '').trim()).filter(Boolean))]
        : [];
      return {
        id: String(row.id ?? randomUUID()),
        key: String(row.key ?? ''),
        channel: (row.channel === 'wechat' ? 'wechat' : 'qq') as DesktopReplaySkillRecord['channel'],
        appName: (row.appName === 'WeChat' ? 'WeChat' : 'QQ') as DesktopReplaySkillRecord['appName'],
        destination: normalizeDestination(String(row.destination ?? '')),
        routeLevel: normalizeRoute(row.routeLevel),
        stepKinds,
        verifyPolicy,
        somCandidateId:
          typeof row.somCandidateId === 'number' && Number.isFinite(row.somCandidateId)
            ? Math.floor(row.somCandidateId)
            : undefined,
        windowFingerprint: row.windowFingerprint ? String(row.windowFingerprint) : undefined,
        successCount: Math.max(0, Math.floor(Number(row.successCount ?? 0) || 0)),
        avgLatencyMs: clamp(Number(row.avgLatencyMs ?? 0), 0, 60_000),
        createdAt: String(row.createdAt ?? nowIso()),
        updatedAt: String(row.updatedAt ?? nowIso()),
        lastSuccessAt: row.lastSuccessAt ? String(row.lastSuccessAt) : undefined,
      } satisfies DesktopReplaySkillRecord;
    })
    .filter((row) => row.key.length > 0)
    .slice(0, 1_000);
  return {
    records: normalized.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  };
}

function readReplaySkills(projectDir: string): DesktopReplaySkillStore {
  const store = readJsonFile<DesktopReplaySkillStore>(replaySkillFile(projectDir), { records: [] });
  const normalized = normalizeReplaySkillStore(store);
  writeJsonFile(replaySkillFile(projectDir), normalized);
  return normalized;
}

function writeReplaySkills(projectDir: string, store: DesktopReplaySkillStore): void {
  writeJsonFile(replaySkillFile(projectDir), normalizeReplaySkillStore(store));
}

function promoteSlowBrainReplaySkill(projectDir: string, input: {
  intent: DesktopAutomationIntent;
  screenState: DesktopScreenState;
  actionPlan: DesktopActionPlan;
  latencyMs: number;
  sent: boolean;
}): void {
  if (!input.sent) return;
  if (input.actionPlan.action_plan.memoryHit) return;
  const replaySkillId = String(input.actionPlan.action_plan.replaySkillId ?? '').trim();
  if (!replaySkillId) return;
  const key = buildMemoryKey(input.intent);
  const routeLevel = input.actionPlan.action_plan.routeLevel;
  const steps = input.actionPlan.action_plan.steps;
  const stepKinds = steps.map((step) => step.kind);
  const verifyPolicy = [...new Set(steps.flatMap((step) => step.verify))];
  const now = nowIso();

  const store = readReplaySkills(projectDir);
  const index = store.records.findIndex((row) => row.id === replaySkillId || row.key === key);
  const existing = index >= 0 ? store.records[index] : undefined;
  const previousRuns = existing?.successCount ?? 0;
  const avgLatencyMs =
    previousRuns <= 0
      ? input.latencyMs
      : Number((((existing?.avgLatencyMs ?? input.latencyMs) * previousRuns + input.latencyMs) / (previousRuns + 1)).toFixed(2));
  const next: DesktopReplaySkillRecord = {
    id: existing?.id ?? replaySkillId,
    key,
    channel: input.intent.channel,
    appName: input.intent.appName,
    destination: normalizeDestination(input.intent.destination),
    routeLevel,
    stepKinds,
    verifyPolicy,
    somCandidateId: input.actionPlan.action_plan.som.selectedCandidateId ?? existing?.somCandidateId,
    windowFingerprint: input.screenState.windowFingerprint ?? existing?.windowFingerprint,
    successCount: previousRuns + 1,
    avgLatencyMs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSuccessAt: now,
  };
  if (index >= 0) store.records[index] = next;
  else store.records.unshift(next);
  writeReplaySkills(projectDir, store);
}

export function listDesktopReplaySkills(projectDir: string, limit = 100): DesktopReplaySkillRecord[] {
  const normalizedLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  return readReplaySkills(projectDir).records.slice(0, normalizedLimit);
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
  const base =
    Array.isArray(input.somCandidates) && input.somCandidates.length > 0
      ? input.somCandidates
      : Array.isArray(input.ocrBoxes) && input.ocrBoxes.length > 0
        ? candidatesFromOcr(input)
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

function normCompact(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function containsNormalized(text: string, target: string): boolean {
  const t = normCompact(text);
  const q = normCompact(target);
  if (!t || !q) return false;
  return t.includes(q);
}

function candidatesFromOcr(input: DesktopScreenState): DesktopSomCandidate[] {
  const boxes = Array.isArray(input.ocrBoxes) ? input.ocrBoxes : [];
  if (boxes.length === 0) return [];
  const width = input.display.width;
  const height = input.display.height;
  let id = 1001;
  return boxes
    .map((box) => {
      const centerX = Math.max(0, Math.min(width - 1, box.x + Math.floor(box.width / 2)));
      const centerY = Math.max(0, Math.min(height - 1, box.y + Math.floor(box.height / 2)));
      const row = Math.max(0, Math.min(9, Math.floor((centerY / Math.max(1, height)) * 10)));
      const col = Math.max(0, Math.min(9, Math.floor((centerX / Math.max(1, width)) * 10)));
      return {
        id: id++,
        label: box.text.slice(0, 120),
        coarse: { row, col },
        roi: {
          x: Math.max(0, Math.min(width - 1, box.x)),
          y: Math.max(0, Math.min(height - 1, box.y)),
          width: Math.max(1, Math.min(box.width, width - box.x)),
          height: Math.max(1, Math.min(box.height, height - box.y)),
        },
        center: { x: centerX, y: centerY },
        confidence: typeof box.confidence === 'number' ? clamp(box.confidence, 0, 1) : undefined,
      } satisfies DesktopSomCandidate;
    })
    .slice(0, 80);
}

function chooseSomCandidateFromOcr(
  candidates: DesktopSomCandidate[],
  intent: DesktopAutomationIntent,
  screenState: DesktopScreenState,
): number | undefined {
  if (!Array.isArray(screenState.ocrBoxes) || screenState.ocrBoxes.length === 0) return undefined;
  const sendHints = ['send', '发送', 'sent', 'deliver', '提交', '确认', '发送给', 'send to'];
  const destination = intent.destination;
  const scored = candidates.map((item) => {
    const label = String(item.label ?? '');
    let score = 0;
    if (containsNormalized(label, destination)) score += 2.2;
    if (sendHints.some((hint) => containsNormalized(label, hint))) score += 1.6;
    // Prefer bottom-right controls for send buttons when OCR signals are weak.
    score += ((item.center.y / Math.max(1, screenState.display.height)) * 0.45);
    score += ((item.center.x / Math.max(1, screenState.display.width)) * 0.25);
    if (typeof item.confidence === 'number') score += item.confidence * 0.4;
    return { id: item.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < 1.35) return undefined;
  return top.id;
}

function parseCommandSpec(raw: string): { command: string; args: string[] } | null {
  const input = raw.trim();
  if (!input) return null;
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? '';
    if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
      quote = quote ? null : (ch as '"' | "'");
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  if (tokens.length === 0) return null;
  return { command: tokens[0] as string, args: tokens.slice(1) };
}

function resolveSomVlmCommand(): { command: string; args: string[]; shell: boolean } | null {
  const explicit = String(process.env.MIYA_VISION_LOCAL_CMD ?? '').trim();
  if (explicit) {
    const parsed = parseCommandSpec(explicit);
    if (parsed) return { ...parsed, shell: false };
    return { command: explicit, args: [], shell: true };
  }
  const backend = String(process.env.MIYA_QWEN3VL_CMD ?? '').trim();
  if (backend) {
    const parsed = parseCommandSpec(backend);
    if (parsed) return { ...parsed, shell: false };
    return { command: backend, args: [], shell: true };
  }
  return null;
}

function runSomVlmSelector(input: {
  intent: DesktopAutomationIntent;
  screenState: DesktopScreenState;
  candidates: DesktopSomCandidate[];
  maxCalls: number;
}): { selectedCandidateId?: number; callsUsed: number } {
  const command = resolveSomVlmCommand();
  if (!command || input.candidates.length === 0 || input.maxCalls <= 0) {
    return { selectedCandidateId: undefined, callsUsed: 0 };
  }
  const timeoutMsRaw = Number(process.env.MIYA_DESKTOP_VLM_SELECTOR_TIMEOUT_MS ?? 2_800);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(600, Math.min(12_000, Math.floor(timeoutMsRaw))) : 2_800;
  const attempts = Math.max(1, Math.min(2, input.maxCalls));
  let callsUsed = 0;
  for (let i = 0; i < attempts; i += 1) {
    callsUsed += 1;
    const candidateWindow = input.candidates.slice(0, i === 0 ? 32 : 16);
    const payload = JSON.stringify({
      mode: 'som_candidate_select',
      protocol: 'vision_action_bridge.v1',
      promptTemplate: 'som_candidate_index_v1',
      schema: {
        type: 'object',
        required: ['candidateId'],
        properties: {
          candidateId: { type: 'integer' },
          confidence: { type: 'number' },
        },
      },
      intent: {
        kind: input.intent.kind,
        channel: input.intent.channel,
        destination: input.intent.destination,
        hasText: input.intent.hasText,
        hasMedia: input.intent.hasMedia,
      },
      screen_state: {
        captureMethod: input.screenState.captureMethod,
        display: input.screenState.display,
        windowFingerprint: input.screenState.windowFingerprint,
        lastOcrFingerprint: input.screenState.lastOcrFingerprint,
        ocrText: String(input.screenState.ocrText ?? '').slice(0, 1200),
      },
      // ROI-only: never send full-screen image in selector mode.
      candidates: candidateWindow.map((row) => ({
        id: row.id,
        label: row.label,
        coarse: row.coarse,
        roi: row.roi,
        center: row.center,
      })),
    });
    try {
      const run = spawnSync(command.command, command.args, {
        input: payload,
        timeout: timeoutMs,
        encoding: 'utf-8',
        shell: command.shell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (run.error || run.signal || run.status !== 0) continue;
      const parsed = JSON.parse(String(run.stdout ?? '').trim()) as {
        candidateId?: number;
        selectedCandidateId?: number;
        id?: number;
      };
      const candidateIdRaw = Number(
        parsed.candidateId ?? parsed.selectedCandidateId ?? parsed.id ?? Number.NaN,
      );
      if (!Number.isFinite(candidateIdRaw)) continue;
      const candidateId = Math.max(1, Math.floor(candidateIdRaw));
      if (candidateWindow.some((item) => item.id === candidateId)) {
        return {
          selectedCandidateId: candidateId,
          callsUsed,
        };
      }
    } catch {
      continue;
    }
  }
  return { selectedCandidateId: undefined, callsUsed };
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
  let vlmCallsPlanned = 0;
  let maxVlmCallsPerStep = 2;
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
  if (routeLevel === 'L2_OCR' && !selectedCandidateId) {
    const ocrSelected = chooseSomCandidateFromOcr(somCandidates, intent, screenState);
    if (ocrSelected) {
      selectedCandidateId = ocrSelected;
      selectionSource = 'heuristic';
    } else {
      // OCR route failed to localize target; escalate to L3 SoM+VLM.
      routeLevel = 'L3_SOM_VLM';
    }
  }
  if (routeLevel === 'L3_SOM_VLM' && !selectedCandidateId) {
    const maxVlmCallsRaw = Number(process.env.MIYA_DESKTOP_VLM_MAX_CALLS ?? 2);
    const maxVlmCalls = Number.isFinite(maxVlmCallsRaw)
      ? Math.max(1, Math.min(2, Math.floor(maxVlmCallsRaw)))
      : 2;
    maxVlmCallsPerStep = maxVlmCalls;
    const vlmSelected = runSomVlmSelector({
      intent,
      screenState,
      candidates: somCandidates,
      maxCalls: maxVlmCalls,
    });
    vlmCallsPlanned = vlmSelected.callsUsed;
    if (vlmSelected.selectedCandidateId) {
      selectedCandidateId = vlmSelected.selectedCandidateId;
      selectionSource = 'vlm';
    }
  }
  const vlmCallsBudget =
    routeLevel === 'L3_SOM_VLM' ? Math.max(0, maxVlmCallsPerStep - vlmCallsPlanned) : 0;
  const replaySkillId =
    matchedMemory?.replaySkillId ||
    `desktop_replay_${intent.channel}_${createHash('sha1').update(memoryKey).digest('hex').slice(0, 8)}`;
  const somCandidatesForPlan =
    routeLevel === 'L2_OCR' || routeLevel === 'L3_SOM_VLM' ? somCandidates : [];
  const fastBrainActive = routeLevel === 'L0_ACTION_MEMORY' && Boolean(matchedMemory);
  const slowBrainRoute = routeLevel === 'L0_ACTION_MEMORY' ? undefined : routeLevel;

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
        maxVlmCallsPerStep,
      },
      som: {
        enabled: routeLevel === 'L2_OCR' || routeLevel === 'L3_SOM_VLM',
        selectionSource,
        selectedCandidateId,
        vlmCallsBudget,
        vlmCallsPlanned,
        candidates: somCandidatesForPlan,
      },
      brains: {
        fastBrain: {
          role: 'FAST_ACTION_MEMORY_REPLAY',
          active: fastBrainActive,
          replaySkillId,
        },
        slowBrain: {
          role: 'SLOW_TASK_PLANNER',
          active: !fastBrainActive,
          planningRoute: slowBrainRoute,
          promoteReplaySkillOnSuccess: true,
        },
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

function readAcceptanceThresholds() {
  const maxVlmCallRatio = clamp(Number(process.env.MIYA_DESKTOP_KPI_MAX_VLM_RATIO ?? 0.2), 0, 1);
  const minSomPathHitRate = clamp(Number(process.env.MIYA_DESKTOP_KPI_MIN_SOM_HIT_RATE ?? 0.95), 0, 1);
  const maxReuseTaskP95Ms = clamp(
    Number(process.env.MIYA_DESKTOP_KPI_MAX_REUSE_P95_MS ?? 1_500),
    200,
    120_000,
  );
  const maxHighRiskMisfireRate = clamp(
    Number(process.env.MIYA_DESKTOP_KPI_MAX_HIGH_RISK_MISFIRE_RATE ?? 0),
    0,
    1,
  );
  return {
    maxVlmCallRatio: Number(maxVlmCallRatio.toFixed(4)),
    minSomPathHitRate: Number(minSomPathHitRate.toFixed(4)),
    maxReuseTaskP95Ms: Math.floor(maxReuseTaskP95Ms),
    maxHighRiskMisfireRate: Number(maxHighRiskMisfireRate.toFixed(4)),
  };
}

function evaluateDesktopAutomationAcceptance(
  metrics: DesktopAutomationMetricsStore,
  kpi: Omit<DesktopAutomationKpiSnapshot, 'acceptance'>,
): DesktopAutomationAcceptanceSnapshot {
  const thresholds = readAcceptanceThresholds();
  const checks = {
    vlmCallRatio: metrics.totalRuns === 0 ? true : kpi.vlmCallRatio <= thresholds.maxVlmCallRatio,
    somPathHitRate: metrics.somRuns === 0 ? true : kpi.somPathHitRate >= thresholds.minSomPathHitRate,
    reuseTaskP95Ms: metrics.reuseRuns === 0 ? true : kpi.reuseTaskP95Ms <= thresholds.maxReuseTaskP95Ms,
    highRiskMisfireRate:
      metrics.highRiskRuns === 0 ? true : kpi.highRiskMisfireRate <= thresholds.maxHighRiskMisfireRate,
  };
  return {
    pass: checks.vlmCallRatio && checks.somPathHitRate && checks.reuseTaskP95Ms && checks.highRiskMisfireRate,
    thresholds,
    checks,
    sample: {
      totalRuns: metrics.totalRuns,
      somRuns: metrics.somRuns,
      reuseRuns: metrics.reuseRuns,
      highRiskRuns: metrics.highRiskRuns,
    },
  };
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
  promoteSlowBrainReplaySkill(projectDir, {
    intent,
    screenState,
    actionPlan: plan,
    latencyMs,
    sent: input.sent,
  });

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
  if (plan.action_plan.routeLevel === 'L2_OCR' || plan.action_plan.routeLevel === 'L3_SOM_VLM') {
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
  const totalRuns = metrics.totalRuns > 0 ? metrics.totalRuns : 1;
  const somRuns = metrics.somRuns > 0 ? metrics.somRuns : 1;
  const highRiskRuns = metrics.highRiskRuns > 0 ? metrics.highRiskRuns : 1;
  const snapshot: Omit<DesktopAutomationKpiSnapshot, 'acceptance'> = {
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
  return {
    ...snapshot,
    acceptance: evaluateDesktopAutomationAcceptance(metrics, snapshot),
  };
}

export function readDesktopAutomationAcceptance(projectDir: string): DesktopAutomationAcceptanceSnapshot {
  return readDesktopAutomationKpi(projectDir).acceptance ?? {
    pass: true,
    thresholds: readAcceptanceThresholds(),
    checks: {
      vlmCallRatio: true,
      somPathHitRate: true,
      reuseTaskP95Ms: true,
      highRiskMisfireRate: true,
    },
    sample: {
      totalRuns: 0,
      somRuns: 0,
      reuseRuns: 0,
      highRiskRuns: 0,
    },
  };
}
