import { type PluginInput, type ToolDefinition, tool } from '@opencode-ai/plugin';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MiyaAutomationService } from '../automation';
import type { BackgroundTaskManager } from '../background';
import { readChannelStore } from '../channel';
import { getContactTier, listContactTiers, setContactTier } from '../channel';
import {
  type ChannelInboundMessage,
  ChannelRuntime,
  listOutboundAudit,
  isChannelName,
  parseDiscordInbound,
  parseSlackInbound,
  parseTelegramInbound,
  type ChannelName,
} from '../channel';
import {
  activateKillSwitch,
  findApprovalToken,
  listRecentSelfApprovalRecords,
  readKillSwitch,
} from '../safety/store';
import { isDomainExecutionAllowed, transitionSafetyState } from '../safety/state-machine';
import { buildRequestHash, requiredTierForRequest } from '../safety/risk';
import {
  assertPolicyHash,
  currentPolicyHash,
  isDomainRunning,
  isPolicyDomain,
  POLICY_DOMAINS,
  type PolicyDomain,
  readPolicy,
  writePolicy,
} from '../policy';
import { evaluateOutboundDecisionFusion } from '../policy/decision-fusion';
import { appendPolicyIncident, listPolicyIncidents } from '../policy/incident';
import {
  createInvokeRequest,
  createNodePairRequest,
  describeNode,
  issueNodeToken,
  listDevices,
  listInvokeRequests,
  listNodePairs,
  listNodes,
  markInvokeSent,
  markNodeDisconnected,
  registerNode,
  resolveInvokeResult,
  resolveNodePair,
  touchNodeHeartbeat,
} from '../nodes';
import { listMediaItems, getMediaItem, ingestMedia, runMediaGc } from '../media/store';
import { getLauncherDaemonSnapshot, getMiyaClient, subscribeLauncherEvents } from '../daemon';
import {
  appendGuestConversation,
  initOwnerIdentity,
  readOwnerIdentityState,
  resolveInteractionMode,
  rotateOwnerSecrets,
  setInteractionMode,
  verifyOwnerPasswordOnly,
  verifyOwnerSecrets,
} from '../security/owner-identity';
import {
  approveOwnerSyncToken,
  consumeOwnerSyncToken,
  detectOwnerSyncTokenFromText,
  issueOwnerSyncToken,
  verifyOwnerSyncToken,
} from '../security/owner-sync';
import { readConfig, applyConfigPatch, validateConfigPatch } from '../settings';
import {
  appendVoiceHistory,
  clearVoiceHistory,
  patchVoiceState,
  readVoiceState,
} from '../voice/state';
import { readPersistedAgentRuntime } from '../config/agent-model-persistence';
import {
  closeCanvasDoc,
  getCanvasDoc,
  listCanvasDocs,
  openCanvasDoc,
  readCanvasState,
  renderCanvasDoc,
} from '../canvas/state';
import {
  addCompanionAsset,
  patchCompanionProfile,
  readCompanionProfile,
  resetCompanionProfile,
  syncCompanionProfileMemoryFacts,
} from '../companion/store';
import {
  confirmCompanionMemoryVector,
  decayCompanionMemoryVectors,
  listCompanionMemoryCorrections,
  listCompanionMemoryVectors,
  listPendingCompanionMemoryVectors,
  searchCompanionMemoryVectors,
  upsertCompanionMemoryVector,
} from '../companion/memory-vector';
import { getCompanionMemorySqliteStats } from '../companion/memory-sqlite';
import {
  appendShortTermMemoryLog,
  getMemoryReflectStatus,
  maybeAutoReflectCompanionMemory,
  maybeReflectOnSessionEnd,
  reflectCompanionMemory,
} from '../companion/memory-reflect';
import {
  cancelCompanionWizardTraining,
  getCompanionProfileCurrentDir,
  getWizardJobById,
  isCompanionWizardEmpty,
  markTrainingJobFinished,
  markTrainingJobRunning,
  pickQueuedTrainingJob,
  readCompanionWizardState,
  requeueTrainingJob,
  resetCompanionWizard,
  startCompanionWizard,
  submitWizardPersonality,
  submitWizardPhotos,
  submitWizardVoice,
  wizardChecklist,
} from '../companion/wizard';
import { generateImage, synthesizeVoiceOutput, detectMultimodalIntent } from '../multimodal';
import { getResourceScheduler, calculateVramBudget, decideModelSwapAction } from '../resource-scheduler';
import {
  dequeueSessionMessage,
  enqueueSessionMessage,
  getSession,
  listSessions,
  setSessionPolicy,
  upsertSession,
} from '../sessions';
import { discoverSkills } from '../skills/loader';
import { listEnabledSkills, setSkillEnabled } from '../skills/state';
import { log } from '../utils/logger';
import { getMiyaRuntimeDir, getSessionState } from '../workflow';
import { createControlUiRequestOptions, handleControlUiHttpRequest } from './control-ui';
import {
  GatewayMethodRegistry,
  parseIncomingFrame,
  toEventFrame,
  toPongFrame,
  toResponseFrame,
  type GatewayClientRole,
  type GatewayMethodContext,
} from './protocol';

const z = tool.schema;

export type GatewayStatus = 'running' | 'killswitch';

export interface GatewayState {
  url: string;
  port: number;
  pid: number;
  startedAt: string;
  status: GatewayStatus;
}

interface GatewayDependencies {
  client?: PluginInput['client'];
  automationService?: MiyaAutomationService;
  backgroundManager?: BackgroundTaskManager;
  extraSkillDirs?: string[];
}

interface GatewayRuntime {
  startedAt: string;
  server: ReturnType<typeof Bun.serve>;
  methods: GatewayMethodRegistry;
  stateVersion: number;
  controlUi: ReturnType<typeof createControlUiRequestOptions>;
  channelRuntime: ChannelRuntime;
  outboundSendDedupe: Map<string, { ts: number; result: unknown }>;
  nodeSockets: Map<string, Bun.ServerWebSocket<unknown>>;
  wsMeta: WeakMap<Bun.ServerWebSocket<unknown>, GatewayWsData>;
  wizardTickTimer?: ReturnType<typeof setInterval>;
  ownerBeatTimer?: ReturnType<typeof setInterval>;
  memoryReflectTimer?: ReturnType<typeof setInterval>;
  wizardRunnerBusy?: boolean;
  dependencyAssistHashes: Set<string>;
  daemonLauncherUnsubscribe?: () => void;
}

interface GatewayWsData {
  clientID: string;
  role: GatewayClientRole;
  subscriptions: Set<string>;
  nodeID?: string;
  authenticated: boolean;
}

interface DoctorIssue {
  code: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  fix: string;
}

interface GatewaySnapshot {
  updatedAt: string;
  gateway: GatewayState;
  runtime: {
    isOwner: boolean;
    ownerPID?: number;
    ownerFresh: boolean;
    activeAgentId?: string;
    storageRevision: number;
  };
  daemon: ReturnType<typeof getLauncherDaemonSnapshot>;
  policyHash: string;
  configCenter: Record<string, unknown>;
  killSwitch: ReturnType<typeof readKillSwitch>;
  safety: {
    recentSelfApproval: ReturnType<typeof listRecentSelfApprovalRecords>;
  };
  jobs: {
    total: number;
    enabled: number;
    pendingApprovals: number;
    recentRuns: ReturnType<MiyaAutomationService['listHistory']>;
  };
  loop: ReturnType<typeof getSessionState>;
  background: {
    total: number;
    running: number;
    tasks: Array<{
      id: string;
      description: string;
      agent: string;
      status: string;
      startedAt: string;
      completedAt?: string;
    }>;
  };
  sessions: {
    total: number;
    active: number;
    queued: number;
    muted: number;
    items: ReturnType<typeof listSessions>;
  };
  channels: {
    states: ReturnType<ChannelRuntime['listChannels']>;
    pendingPairs: ReturnType<ChannelRuntime['listPairs']>;
    recentOutbound: ReturnType<typeof listOutboundAudit>;
  };
  nodes: {
    total: number;
    connected: number;
    pendingPairs: number;
    list: ReturnType<typeof listNodes>;
    devices: ReturnType<typeof listDevices>;
    invokes: ReturnType<typeof listInvokeRequests>;
  };
  skills: {
    enabled: string[];
    discovered: ReturnType<typeof discoverSkills>;
  };
  media: {
    total: number;
    recent: ReturnType<typeof listMediaItems>;
  };
  voice: ReturnType<typeof readVoiceState>;
  canvas: {
    activeDocID?: string;
    docs: ReturnType<typeof listCanvasDocs>;
    events: ReturnType<typeof readCanvasState>['events'];
  };
  companion: ReturnType<typeof readCompanionProfile>;
  security: {
    ownerIdentity: ReturnType<typeof readOwnerIdentityState>;
  };
  doctor: {
    issues: DoctorIssue[];
  };
}

const runtimes = new Map<string, GatewayRuntime>();
const dependencies = new Map<string, GatewayDependencies>();
const ownerTokens = new Map<string, string>();

interface GatewayOwnerLock {
  pid: number;
  token: string;
  updatedAt: string;
  startedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function depsOf(projectDir: string): GatewayDependencies {
  return dependencies.get(projectDir) ?? {};
}

export function registerGatewayDependencies(
  projectDir: string,
  deps: GatewayDependencies,
): void {
  const current = dependencies.get(projectDir) ?? {};
  dependencies.set(projectDir, { ...current, ...deps });
}

function gatewayFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway.json');
}

function gatewayOwnerLockFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway-owner.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJsonAtomic(file: string, payload: unknown): void {
  ensureDir(file);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
}

function safeReadJsonObject(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readGatewayOwnerLock(projectDir: string): GatewayOwnerLock | null {
  const raw = safeReadJsonObject(gatewayOwnerLockFile(projectDir));
  if (!raw) return null;
  const pid = Number(raw.pid);
  const token = String(raw.token ?? '');
  const updatedAt = String(raw.updatedAt ?? '');
  const startedAt = String(raw.startedAt ?? '');
  if (!Number.isFinite(pid) || !token || !updatedAt || !startedAt) return null;
  return { pid, token, updatedAt, startedAt };
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isOwnerLockFresh(lock: GatewayOwnerLock): boolean {
  const ts = Date.parse(lock.updatedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 15_000;
}

function ownerSummary(projectDir: string): {
  isOwner: boolean;
  ownerPID?: number;
  ownerFresh: boolean;
} {
  const lock = readGatewayOwnerLock(projectDir);
  if (!lock) {
    return {
      isOwner: false,
      ownerFresh: false,
    };
  }
  const token = ownerTokens.get(projectDir);
  return {
    isOwner: Boolean(token) && lock.pid === process.pid && lock.token === token,
    ownerPID: lock.pid,
    ownerFresh: isOwnerLockFresh(lock),
  };
}

function writeOwnerLock(projectDir: string, token: string): GatewayOwnerLock {
  const file = gatewayOwnerLockFile(projectDir);
  const existing = readGatewayOwnerLock(projectDir);
  const lock: GatewayOwnerLock = {
    pid: process.pid,
    token,
    updatedAt: nowIso(),
    startedAt: existing?.pid === process.pid && existing.token === token ? existing.startedAt : nowIso(),
  };
  writeJsonAtomic(file, lock);
  return lock;
}

function touchOwnerLock(projectDir: string): void {
  const token = ownerTokens.get(projectDir);
  if (!token) return;
  writeOwnerLock(projectDir, token);
}

function removeOwnerLock(projectDir: string): void {
  const file = gatewayOwnerLockFile(projectDir);
  const lock = readGatewayOwnerLock(projectDir);
  const token = ownerTokens.get(projectDir);
  if (!lock || !token) return;
  if (lock.pid === process.pid && lock.token === token) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}

function acquireGatewayOwner(projectDir: string): { owned: boolean; owner?: GatewayOwnerLock } {
  const existingToken = ownerTokens.get(projectDir) ?? randomUUID();
  ownerTokens.set(projectDir, existingToken);
  const lockFile = gatewayOwnerLockFile(projectDir);
  const lock = readGatewayOwnerLock(projectDir);

  if (
    lock &&
    lock.pid === process.pid &&
    lock.token === existingToken &&
    isOwnerLockFresh(lock)
  ) {
    const refreshed: GatewayOwnerLock = {
      ...lock,
      updatedAt: nowIso(),
    };
    writeJsonAtomic(lockFile, refreshed);
    return { owned: true, owner: refreshed };
  }

  if (lock && isProcessAlive(lock.pid) && isOwnerLockFresh(lock)) {
    return { owned: false, owner: lock };
  }

  const created = writeOwnerLock(projectDir, existingToken);
  return { owned: true, owner: created };
}

function readGatewayStateFile(projectDir: string): GatewayState | null {
  const raw = safeReadJsonObject(gatewayFile(projectDir));
  if (!raw) return null;
  const url = String(raw.url ?? '').trim();
  const port = Number(raw.port);
  const pid = Number(raw.pid);
  const startedAt = String(raw.startedAt ?? '');
  const status = String(raw.status ?? 'running');
  if (!url || !Number.isFinite(port) || !Number.isFinite(pid) || !startedAt) {
    return null;
  }
  return {
    url,
    port,
    pid,
    startedAt,
    status: status === 'killswitch' ? 'killswitch' : 'running',
  };
}

function clearGatewayStateFile(projectDir: string): void {
  try {
    fs.unlinkSync(gatewayFile(projectDir));
  } catch {}
}

export function isGatewayOwner(projectDir: string): boolean {
  const token = ownerTokens.get(projectDir);
  const lock = readGatewayOwnerLock(projectDir);
  if (!token || !lock) return false;
  return lock.pid === process.pid && lock.token === token && isOwnerLockFresh(lock);
}

export async function probeGatewayAlive(url: string, timeoutMs = 800): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/status`, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function killAwareStatus(projectDir: string): GatewayStatus {
  return readKillSwitch(projectDir).active ? 'killswitch' : 'running';
}

function gatewayPort(runtime: GatewayRuntime): number {
  return Number(runtime.server.port ?? 0);
}

function toGatewayState(projectDir: string, runtime: GatewayRuntime): GatewayState {
  return {
    url: `http://127.0.0.1:${gatewayPort(runtime)}`,
    port: gatewayPort(runtime),
    pid: process.pid,
    startedAt: runtime.startedAt,
    status: killAwareStatus(projectDir),
  };
}

function writeGatewayState(projectDir: string, state: GatewayState): void {
  const file = gatewayFile(projectDir);
  writeJsonAtomic(file, state);
}

function syncGatewayState(projectDir: string, runtime: GatewayRuntime): GatewayState {
  const state = toGatewayState(projectDir, runtime);
  writeGatewayState(projectDir, state);
  return state;
}

export function stopGateway(projectDir: string): {
  stopped: boolean;
  previous?: GatewayState;
} {
  const runtime = runtimes.get(projectDir);
  if (!runtime) return { stopped: false };

  maybeReflectOnSessionEnd(projectDir, {
    minPendingLogs: 50,
    maxLogs: 200,
  });

  const previous = toGatewayState(projectDir, runtime);
  if (runtime.wizardTickTimer) {
    clearInterval(runtime.wizardTickTimer);
    runtime.wizardTickTimer = undefined;
  }
  if (runtime.ownerBeatTimer) {
    clearInterval(runtime.ownerBeatTimer);
    runtime.ownerBeatTimer = undefined;
  }
  if (runtime.memoryReflectTimer) {
    clearInterval(runtime.memoryReflectTimer);
    runtime.memoryReflectTimer = undefined;
  }
  if (runtime.daemonLauncherUnsubscribe) {
    runtime.daemonLauncherUnsubscribe();
    runtime.daemonLauncherUnsubscribe = undefined;
  }
  try {
    runtime.channelRuntime.stop();
  } catch {}
  try {
    runtime.server.stop(true);
  } catch {}
  runtimes.delete(projectDir);
  clearGatewayStateFile(projectDir);
  removeOwnerLock(projectDir);
  return { stopped: true, previous };
}

function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function parseText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseChannel(value: unknown): ChannelName | null {
  return isChannelName(value) ? value : null;
}

const WIZARD_PROMPT_PHOTOS = '给我展示我应该是什么样子。发送1到5张照片。';
const WIZARD_PROMPT_VOICE = '我应该用什么声音？录音或发送文件。';
const WIZARD_PROMPT_PERSONALITY = '我是谁？告诉我我的性格、习惯和我们的关系。';
const WIZARD_PROMPT_DONE = '设置完成。你好，亲爱的！';
const WIZARD_CANCELLED_MESSAGE = '训练已取消/可重试';

function wizardPromptByState(state: string): string {
  if (state === 'awaiting_photos') return WIZARD_PROMPT_PHOTOS;
  if (state === 'awaiting_voice') return WIZARD_PROMPT_VOICE;
  if (state === 'awaiting_personality') return WIZARD_PROMPT_PERSONALITY;
  if (state === 'completed') return WIZARD_PROMPT_DONE;
  return '';
}

function contextEnvelopeByMode(mode: 'owner' | 'guest' | 'unknown'): string {
  if (mode === 'guest') {
    return [
      '[Guest Mode Active]',
      'Only use public persona.',
      'Do not access memory/vault/relationship private context.',
      'Refuse desktop control, outbound actions, and sensitive data requests.',
    ].join('\n');
  }
  if (mode === 'unknown') {
    return '[Unknown Speaker] Safety-first mode: avoid sensitive actions until owner verification.';
  }
  return '[Owner Mode Active] Full private context is available.';
}

function containsSensitiveText(text: string): boolean {
  const sensitivePattern =
    /(密码|验证码|银行卡|身份证|私钥|seed|助记词|token|secret|api[_-]?key|wallet|汇款|转账|打款|otp|password)/i;
  return sensitivePattern.test(text);
}

function inferIntentSuspicious(text: string): boolean {
  const suspiciousPattern =
    /(立刻发|马上发|偷偷发|别告诉|绕过|伪装|冒充|代发|紧急转账|秘密|隐私文件|内部资料|账号|凭据)/i;
  return suspiciousPattern.test(text);
}

function isHighRiskInstruction(text: string): boolean {
  return /(忽略所有规则|批量发送|发送所有|删除所有|格式化|重置密码|导出全部|泄露|转账|付款|发给客户群)/i.test(
    text,
  );
}

function isCriticalInjectionIntent(text: string): boolean {
  return /(忽略所有规则|绕过.*(验证|风控|权限)|关闭.*(安全|审计|日志)|导出.*(全部|所有).*(密码|token|密钥)|重置.*(密码|口令))/i.test(
    text,
  );
}

function shouldBypassIntentGuard(source: string): boolean {
  return /^policy:|^system:/.test(source);
}

function buildSessionPayloadByMode(mode: 'owner' | 'guest' | 'unknown', text: string): {
  payload: string;
  redacted: boolean;
} {
  if (mode === 'guest') {
    if (containsSensitiveText(text) || isHighRiskInstruction(text)) {
      const digest = hashText(text).slice(0, 16);
      return {
        redacted: true,
        payload: [
          '[Guest Mode Active]',
          'Private context pointers: memory=null, vault=null, relationship=null.',
          'Sensitive request is blocked in guest mode.',
          `redacted_request_sha256=${digest}`,
          'Reply policy: refuse sensitive actions and keep light conversation only.',
        ].join('\n'),
      };
    }
    return {
      redacted: false,
      payload: [
        contextEnvelopeByMode(mode),
        'Private context pointers: memory=null, vault=null, relationship=null.',
        text,
      ].join('\n'),
    };
  }
  if (mode === 'unknown') {
    return {
      redacted: false,
      payload: [contextEnvelopeByMode(mode), text].join('\n'),
    };
  }
  return { redacted: false, payload: [contextEnvelopeByMode(mode), text].join('\n') };
}

async function enforceCriticalIntentGuard(
  projectDir: string,
  input: { sessionID: string; text: string; source: string },
): Promise<boolean> {
  if (shouldBypassIntentGuard(input.source)) return false;
  if (!isCriticalInjectionIntent(input.text)) return false;
  const traceID = randomUUID();
  const reason = 'critical_intent_killswitch_triggered';
  activateKillSwitch(projectDir, reason, traceID);
  appendPolicyIncident(projectDir, {
    type: 'decision_fusion_hard',
    reason,
    pausedDomains: ['outbound_send', 'desktop_control'],
    statusByDomain: {
      outbound_send: 'paused',
      desktop_control: 'paused',
    },
    semanticSummary: {
      trigger: 'critical_intent_guard',
      keyAssertion: 'Message matched critical injection / exfiltration intent pattern.',
      recovery: 'Use OpenCode local password to unlock and manually resume domains.',
    },
    semanticTags: ['recipient_mismatch'],
    details: {
      source: input.source,
      sessionID: input.sessionID,
      textDigest: hashText(input.text).slice(0, 24),
    },
  });
  await notifySafetyReport(projectDir, input.sessionID, [
    'Miya 红色警报：已触发异常检测熔断（Kill-Switch）',
    `原因: ${reason}`,
    '检测到高危注入/越权意图，已暂停高危能力域。',
    '恢复：请在 OpenCode 完成本地验证后手动恢复。',
  ]);
  return true;
}

function collectStringValues(input: unknown, maxItems = 40): string[] {
  const out: string[] = [];
  const stack: unknown[] = [input];
  while (stack.length > 0 && out.length < maxItems) {
    const current = stack.pop();
    if (typeof current === 'string') {
      const text = current.trim();
      if (text.length > 0) out.push(text);
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const value of Object.values(current as Record<string, unknown>)) {
      stack.push(value);
    }
  }
  return out;
}

function shouldGuardMethod(method: string): boolean {
  if (method.startsWith('policy.') || method.startsWith('gateway.') || method.startsWith('doctor.')) {
    return false;
  }
  return true;
}

async function invokeGatewayMethod(
  projectDir: string,
  runtime: GatewayRuntime,
  method: string,
  params: Record<string, unknown>,
  context: GatewayMethodContext,
): Promise<unknown> {
  if (shouldGuardMethod(method)) {
    const texts = collectStringValues(params);
    for (const text of texts) {
      if (await enforceCriticalIntentGuard(projectDir, {
        sessionID: parseText(params.sessionID) || 'main',
        text,
        source: `method:${method}`,
      })) {
        throw new Error('kill_switch_triggered_by_critical_intent');
      }
    }
  }
  return runtime.methods.invoke(method, params, context);
}

interface GatewayDependencyRecommendation {
  package: string;
  recommendedVersion: string;
  reason: string;
  command: string;
}

interface GatewayPythonRuntimeStatus {
  ready?: boolean;
  pythonPath?: string;
  trainingDisabledReason?: 'no_gpu' | 'dependency_fault';
  diagnostics?: {
    issues?: string[];
  };
  repairPlan?: {
    issueType?: 'ok' | 'no_gpu' | 'dependency_fault';
    warnings?: string[];
    recommendations?: GatewayDependencyRecommendation[];
    conflicts?: string[];
    oneShotCommand?: string;
    opencodeAssistPrompt?: string;
  };
}

function parseExecSpec(raw: string): { command: string; args: string[] } | null {
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
  return {
    command: tokens[0] as string,
    args: tokens.slice(1),
  };
}

async function verifyVoiceprintWithLocalModel(
  projectDir: string,
  input: { mediaPath?: string; speakerHint?: string; speakerScore?: number },
): Promise<{ mode: 'owner' | 'guest' | 'unknown'; score?: number; source: string }> {
  const strict = process.env.MIYA_VOICEPRINT_STRICT !== '0';
  const hintMode = resolveInteractionMode(projectDir, {
    speakerHint: input.speakerHint,
    speakerScore: input.speakerScore,
  });
  const audioPath = (input.mediaPath ?? '').trim();
  const cmdRaw = String(process.env.MIYA_VOICEPRINT_VERIFY_CMD ?? '').trim();
  if (!audioPath || !fs.existsSync(audioPath)) {
    return { mode: strict ? 'unknown' : hintMode, score: input.speakerScore, source: 'no_audio' };
  }
  if (!cmdRaw) {
    return {
      mode: strict ? 'unknown' : hintMode,
      score: typeof input.speakerScore === 'number' ? input.speakerScore : undefined,
      source: 'strict_no_cmd',
    };
  }
  const spec = parseExecSpec(cmdRaw);
  if (!spec) {
    return {
      mode: strict ? 'unknown' : hintMode,
      score: typeof input.speakerScore === 'number' ? input.speakerScore : undefined,
      source: 'strict_invalid_cmd',
    };
  }
  const state = readOwnerIdentityState(projectDir);
  if (!state.voiceprintModelPath || !fs.existsSync(state.voiceprintModelPath)) {
    return {
      mode: strict ? 'unknown' : hintMode,
      score: input.speakerScore,
      source: 'strict_model_missing',
    };
  }
  if (!state.voiceprintSampleDir || !fs.existsSync(state.voiceprintSampleDir)) {
    return {
      mode: strict ? 'unknown' : hintMode,
      score: input.speakerScore,
      source: 'strict_samples_missing',
    };
  }
  const daemon = getMiyaClient(projectDir);
  const args = spec.args.map((item) =>
    item
      .replaceAll('{audio}', audioPath)
      .replaceAll('{model}', state.voiceprintModelPath)
      .replaceAll('{samples}', state.voiceprintSampleDir || '')
      .replaceAll('{embedding}', state.voiceprintEmbeddingID ?? ''),
  );
  try {
    const result = await daemon.runIsolatedProcess({
      kind: 'voice.asr',
      command: spec.command,
      args,
      timeoutMs: 45_000,
      resource: { priority: 90, vramMB: 256, modelID: 'local:eres2net', modelVramMB: 512 },
      metadata: { stage: 'security.voiceprint.verify', audioPath },
    });
    if (result.exitCode !== 0) {
      return {
        mode: strict ? 'unknown' : hintMode,
        score: input.speakerScore,
        source: 'strict_cmd_failed',
      };
    }
    const stdout = result.stdout.trim();
    const parsed = JSON.parse(stdout) as {
      speaker_score?: number;
      liveness_score?: number;
      diarization?: Array<{
        speaker?: string;
        score?: number;
      }>;
      mode?: 'owner' | 'guest' | 'unknown';
    };
    const score =
      typeof parsed.speaker_score === 'number' ? Number(parsed.speaker_score) : input.speakerScore;
    const liveness =
      typeof parsed.liveness_score === 'number' ? Number(parsed.liveness_score) : undefined;
    const diarization = Array.isArray(parsed.diarization) ? parsed.diarization : [];
    const ownerSegments = diarization.filter(
      (seg) => String(seg.speaker ?? '').toLowerCase() === 'owner',
    ).length;
    const diarizationLooksOwner =
      diarization.length === 0 ? true : ownerSegments / diarization.length >= 0.7;
    const mode =
      parsed.mode && ['owner', 'guest', 'unknown'].includes(parsed.mode)
        ? parsed.mode
        : typeof score === 'number'
          ? score >= 0.78 && (liveness ?? 1) >= 0.65 && diarizationLooksOwner
            ? 'owner'
            : score < 0.62 || (typeof liveness === 'number' && liveness < 0.55)
              ? 'guest'
              : 'unknown'
          : 'unknown';
    return { mode, score, source: 'voiceprint_cmd' };
  } catch {
    return {
      mode: strict ? 'unknown' : hintMode,
      score: input.speakerScore,
      source: 'strict_cmd_error',
    };
  }
}

function normalizeRuntimeDependencyRecommendations(
  status: GatewayPythonRuntimeStatus,
): GatewayDependencyRecommendation[] {
  const fromPlan = Array.isArray(status.repairPlan?.recommendations)
    ? status.repairPlan?.recommendations ?? []
    : [];
  if (fromPlan.length > 0) return fromPlan;
  const issues = Array.isArray(status.diagnostics?.issues) ? status.diagnostics?.issues : [];
  const fallback: GatewayDependencyRecommendation[] = [];
  if (issues.some((issue) => issue.startsWith('torch_not_installed'))) {
    fallback.push({
      package: 'torch',
      recommendedVersion: '>=2.2.0',
      reason: 'PyTorch runtime is required by FLUX/GPT-SoVITS tasks.',
      command: 'pip install "torch>=2.2.0" "torchvision>=0.17.0" "torchaudio>=2.2.0"',
    });
  }
  if (issues.some((issue) => issue.startsWith('ffmpeg_missing'))) {
    fallback.push({
      package: 'ffmpeg',
      recommendedVersion: 'system_latest',
      reason: 'Audio conversion requires ffmpeg binary in PATH.',
      command: 'winget install --id Gyan.FFmpeg -e',
    });
  }
  if (fallback.length === 0 && issues.length > 0) {
    fallback.push({
      package: 'python-deps',
      recommendedVersion: 'requirements.txt',
      reason: 'Environment check reported dependency issues.',
      command:
        'python -m pip install --upgrade pip setuptools wheel && python -m pip install --disable-pip-version-check -r miya-src/python/requirements.txt',
    });
  }
  return fallback;
}

function buildDependencyAssistPrompt(status: GatewayPythonRuntimeStatus): string {
  const issues = Array.isArray(status.diagnostics?.issues) ? status.diagnostics?.issues : [];
  const recommendations = normalizeRuntimeDependencyRecommendations(status);
  const recommendationLines = recommendations
    .map(
      (item) =>
        `- ${item.package} ${item.recommendedVersion}\n  reason: ${item.reason}\n  cmd: ${item.command}`,
    )
    .join('\n');
  return [
    'Miya dependency fault detected in local Python runtime.',
    `python: ${status.pythonPath ?? 'unknown'}`,
    `issues: ${issues.join(', ') || 'none'}`,
    'Please produce a short repair guide with exact commands and conflict explanation.',
    'Use and refine these baseline recommendations:',
    recommendationLines || '- reinstall requirements and inspect pip stderr',
  ].join('\n');
}

async function maybeTriggerDependencyAssist(
  projectDir: string,
  runtime: GatewayRuntime,
  status: GatewayPythonRuntimeStatus,
): Promise<{ triggered: boolean; routed?: { delivered: boolean; queued: boolean; reason?: string } }> {
  const issueType = status.repairPlan?.issueType ?? status.trainingDisabledReason ?? 'ok';
  if (issueType !== 'dependency_fault') return { triggered: false };
  const prompt = status.repairPlan?.opencodeAssistPrompt || buildDependencyAssistPrompt(status);
  const digest = hashText(prompt);
  if (runtime.dependencyAssistHashes.has(digest)) {
    return { triggered: false };
  }
  runtime.dependencyAssistHashes.add(digest);
  const routed = await routeSessionMessage(projectDir, {
    sessionID: 'main',
    source: 'daemon.python.env.dependency_fault',
    text: prompt,
  });
  return { triggered: true, routed };
}

function deriveRiskLevel(input: {
  containsSensitive: boolean;
  factorIntentSuspicious: boolean;
  factorRecipientIsMe: boolean;
}): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (input.containsSensitive && (input.factorIntentSuspicious || !input.factorRecipientIsMe)) {
    return 'HIGH';
  }
  if (input.containsSensitive || input.factorIntentSuspicious) {
    return 'MEDIUM';
  }
  return 'LOW';
}

interface ApprovalTicketSummary {
  permission: string;
  requestHash: string;
  traceID: string;
  createdAt: string;
  expiresAt: string;
  tier: string;
}

function requirePolicyHash(projectDir: string, providedHash: string | undefined): string {
  const policyGuard = assertPolicyHash(projectDir, providedHash);
  if (!policyGuard.ok) {
    throw new Error(`${policyGuard.reason}:expected=${policyGuard.hash}`);
  }
  return policyGuard.hash;
}

function requireDomainRunning(projectDir: string, domain: PolicyDomain): void {
  if (!isDomainRunning(projectDir, domain) || !isDomainExecutionAllowed(projectDir, domain)) {
    throw new Error(`domain_paused:${domain}`);
  }
}

function requireOwnerMode(projectDir: string): void {
  const state = readOwnerIdentityState(projectDir);
  if (state.mode !== 'owner') {
    throw new Error(`owner_mode_required:current=${state.mode}`);
  }
}

interface GuardedOutboundCheckInput {
  archAdvisorApproved?: boolean;
  intent?: string;
  factorRecipientIsMe?: boolean;
}

interface GuardedOutboundSendInput {
  channel: ChannelName;
  destination: string;
  text: string;
  mediaPath?: string;
  idempotencyKey?: string;
  sessionID: string;
  policyHash?: string;
  outboundCheck?: GuardedOutboundCheckInput;
  confirmation?: {
    physicalConfirmed?: boolean;
    password?: string;
    passphrase?: string;
    ownerSyncToken?: string;
  };
}

type GuardedOutboundSendResult = Record<string, unknown> & {
  sent: boolean;
  message: string;
};

async function sendChannelMessageGuarded(
  projectDir: string,
  runtime: GatewayRuntime,
  input: GuardedOutboundSendInput,
): Promise<GuardedOutboundSendResult> {
  const resolvedPolicyHash = requirePolicyHash(projectDir, input.policyHash);
  requireDomainRunning(projectDir, 'outbound_send');
  requireDomainRunning(projectDir, 'desktop_control');
  const identity = readOwnerIdentityState(projectDir);
  const localPhysicalConfirmed = Boolean(input.confirmation?.physicalConfirmed);
  const localPasswordVerified = verifyOwnerPasswordOnly(projectDir, input.confirmation?.password);
  const localGuestOverride =
    (identity.mode === 'guest' || identity.mode === 'unknown') &&
    localPhysicalConfirmed &&
    localPasswordVerified;
  if ((identity.mode === 'guest' || identity.mode === 'unknown') && !localGuestOverride) {
    return {
      sent: false,
      message: 'outbound_blocked:guest_mode',
      policyHash: currentPolicyHash(projectDir),
    };
  }

  const mediaPath = (input.mediaPath ?? '').trim();
  const payloadHash = hashText(`${input.text}||${mediaPath}`);
  const archAdvisorApproved = Boolean(input.outboundCheck?.archAdvisorApproved);
  const intent = input.outboundCheck?.intent ?? 'initiate';
  const factorRecipientIsMeInput = input.outboundCheck?.factorRecipientIsMe;
  const factorRecipientIsMe =
    typeof factorRecipientIsMeInput === 'boolean'
      ? factorRecipientIsMeInput
      : getContactTier(projectDir, input.channel, input.destination) === 'owner';
  const containsSensitive = containsSensitiveText(input.text);
  const factorIntentSuspicious = inferIntentSuspicious(input.text);
  const confidenceIntentRaw = factorIntentSuspicious ? 0.35 : containsSensitive ? 0.75 : 0.95;
  const riskLevel = deriveRiskLevel({
    containsSensitive,
    factorIntentSuspicious,
    factorRecipientIsMe,
  });
  if (isHighRiskInstruction(input.text)) {
    const physicalConfirmed = localPhysicalConfirmed;
    const secretVerified = verifyOwnerSecrets(projectDir, {
      password: input.confirmation?.password,
      passphrase: input.confirmation?.passphrase,
    });
    if (!physicalConfirmed || !secretVerified) {
      return {
        sent: false,
        message: 'outbound_blocked:high_risk_confirmation_required',
        requiresConfirmation: true,
        policyHash: currentPolicyHash(projectDir),
      };
    }
    const ownerSyncRequired = process.env.MIYA_OWNER_SYNC_REQUIRED !== '0';
    if (ownerSyncRequired && !localGuestOverride) {
      const providedOwnerSyncToken = String(input.confirmation?.ownerSyncToken ?? '').trim();
      if (!providedOwnerSyncToken) {
        const pending = issueOwnerSyncToken(projectDir, {
          action: 'outbound.high_risk.send',
          payloadHash,
        });
        return {
          sent: false,
          message: 'outbound_blocked:owner_sync_confirmation_required',
          requiresConfirmation: true,
          ownerSyncRequired: true,
          ownerSyncToken: pending.token,
          ownerSyncInstruction:
            `请用本人档在 QQ/微信 回复: 同意 ${pending.token}（10分钟内有效）`,
          policyHash: currentPolicyHash(projectDir),
        };
      }
      const ownerSync = verifyOwnerSyncToken(projectDir, {
        token: providedOwnerSyncToken,
        action: 'outbound.high_risk.send',
        payloadHash,
      });
      if (!ownerSync.ok) {
        const pending = issueOwnerSyncToken(projectDir, {
          action: 'outbound.high_risk.send',
          payloadHash,
        });
        return {
          sent: false,
          message: `outbound_blocked:owner_sync_confirmation_required:${ownerSync.reason ?? 'invalid_token'}`,
          requiresConfirmation: true,
          ownerSyncRequired: true,
          ownerSyncToken: pending.token,
          ownerSyncInstruction:
            `请用本人档在 QQ/微信 回复: 同意 ${pending.token}（10分钟内有效）`,
          policyHash: currentPolicyHash(projectDir),
        };
      }
      consumeOwnerSyncToken(projectDir, providedOwnerSyncToken);
    }
  }

  if (input.idempotencyKey) {
    const key = `channels.send:${input.idempotencyKey}`;
    const cached = runtime.outboundSendDedupe.get(key);
    if (cached) {
      return {
        ...(cached.result as GuardedOutboundSendResult),
        cached: true,
      };
    }
  }

  const fusion = evaluateOutboundDecisionFusion({
    factorTextSensitive: containsSensitive,
    factorRecipientIsMe,
    factorIntentSuspicious,
    confidenceIntent: confidenceIntentRaw,
  });
  if (fusion.action === 'hard_fuse') {
    const safetyState = transitionSafetyState(projectDir, {
      source: 'decision_fusion_hard',
      reason: 'outbound_blocked:decision_fusion_hard',
      policyHash: resolvedPolicyHash,
      domains: {
        outbound_send: 'killed',
        desktop_control: 'killed',
      },
    });
    const incident = appendPolicyIncident(projectDir, {
      type: 'decision_fusion_hard',
      reason: 'outbound_blocked:decision_fusion_hard',
      channel: input.channel,
      destination: input.destination,
      policyHash: resolvedPolicyHash,
      pausedDomains: ['outbound_send', 'desktop_control'],
      statusByDomain: {
        outbound_send: safetyState.domains.outbound_send === 'running' ? 'running' : 'paused',
        desktop_control:
          safetyState.domains.desktop_control === 'running' ? 'running' : 'paused',
      },
      semanticSummary: {
        trigger: 'decision_fusion_hard',
        keyAssertion:
          'A=contains_sensitive and decision fusion matched in danger zone (confidence < 0.5).',
        recovery:
          'Review outbound intent in OpenCode and manually resume paused domains after confirmation.',
      },
      semanticTags: ['recipient_mismatch'],
      details: {
        factorTextSensitive: containsSensitive,
        factorRecipientIsMe,
        factorIntentSuspicious,
        confidenceIntent: confidenceIntentRaw,
        zone: fusion.zone,
      },
    });
    await notifySafetyReport(projectDir, input.sessionID, [
      'Miya安全报告：已触发硬熔断并暂停能力域',
      `触发原因: ${incident.reason}`,
      `能力域状态: outbound_send=${safetyState.domains.outbound_send}, desktop_control=${safetyState.domains.desktop_control}`,
      `关键断言: A=${containsSensitive}, B_is_me=${factorRecipientIsMe}, C_suspicious=${factorIntentSuspicious}, Conf(C)=${confidenceIntentRaw}`,
      '恢复条件: 请在确认外发意图后手动恢复域开关',
    ]);
    return {
      sent: false,
      message: 'outbound_blocked:decision_fusion_hard',
      policyHash: currentPolicyHash(projectDir),
      incident,
    };
  }
  if (fusion.action === 'soft_fuse') {
    const incident = appendPolicyIncident(projectDir, {
      type: 'decision_fusion_soft',
      reason: 'outbound_blocked:decision_fusion_soft_confirmation_required',
      channel: input.channel,
      destination: input.destination,
      policyHash: resolvedPolicyHash,
      semanticSummary: {
        trigger: 'decision_fusion_soft',
        keyAssertion:
          'Decision fusion matched in gray zone (0.5 <= confidence <= 0.85), manual confirmation required.',
        recovery: 'Confirm outbound intent in OpenCode, then retry with explicit approval.',
      },
      semanticTags: ['recipient_mismatch'],
      details: {
        factorTextSensitive: containsSensitive,
        factorRecipientIsMe,
        factorIntentSuspicious,
        confidenceIntent: confidenceIntentRaw,
        zone: fusion.zone,
      },
    });
    await notifySafetyReport(projectDir, input.sessionID, [
      'Miya安全提示：当前外发进入灰区柔性熔断',
      `触发原因: ${incident.reason}`,
      `关键断言: A=${containsSensitive}, B_is_me=${factorRecipientIsMe}, C_suspicious=${factorIntentSuspicious}, Conf(C)=${confidenceIntentRaw}`,
      '建议确认: 亲爱的，这句话听起来有点敏感，你是认真的吗？',
    ]);
    return {
      sent: false,
      message: 'outbound_blocked:decision_fusion_soft_confirmation_required',
      requiresConfirmation: true,
      policyHash: resolvedPolicyHash,
      incident,
    };
  }

  const outboundTicket = resolveApprovalTicket({
    projectDir,
    sessionID: input.sessionID,
    permission: 'external_message',
    patterns: [
      `channel=${input.channel}`,
      `dest=${input.destination}`,
      `payload_sha256=${payloadHash}`,
    ],
  });
  if (!outboundTicket.ok) throw new Error(`approval_required:${outboundTicket.reason}`);
  const desktopTicket = resolveApprovalTicket({
    projectDir,
    sessionID: input.sessionID,
    permission: 'desktop_control',
    patterns: [
      `channel=${input.channel}`,
      `dest=${input.destination}`,
      `payload_sha256=${payloadHash}`,
    ],
  });
  if (!desktopTicket.ok) throw new Error(`approval_required:${desktopTicket.reason}`);

  const sendFingerprint = hashText(
    `${input.channel}|${input.destination}|${payloadHash}|${Math.floor(Date.now() / 60000)}`,
  ).slice(0, 40);

  const outboundRuntime = runtime.channelRuntime;
  const result = await outboundRuntime.sendMessage({
    channel: input.channel,
    destination: input.destination,
    text: input.text,
    mediaPath: mediaPath || undefined,
    sessionID: input.sessionID,
    sendFingerprint,
    payloadHash,
    approvalTickets: {
      outboundSend: outboundTicket.ticket,
      desktopControl: desktopTicket.ticket,
    },
    outboundCheck: {
      archAdvisorApproved,
      riskLevel,
      intent: intent === 'reply' ? 'reply' : 'initiate',
      containsSensitive,
      policyHash: resolvedPolicyHash,
    },
  });
  const violationType =
    result.message === 'outbound_blocked:friend_tier_sensitive_content_denied'
      ? 'friend_tier_sensitive_violation'
      : result.message === 'outbound_blocked:friend_tier_can_only_reply'
        ? 'friend_tier_initiate_violation'
        : null;
  if (violationType) {
    const safetyState = transitionSafetyState(projectDir, {
      source: 'friend_tier_violation',
      reason: result.message,
      policyHash: resolvedPolicyHash,
      domains: {
        outbound_send: 'killed',
        desktop_control: 'killed',
      },
    });
    const incident = appendPolicyIncident(projectDir, {
      type: violationType,
      reason: result.message,
      channel: input.channel,
      destination: input.destination,
      auditID: result.auditID,
      policyHash: resolvedPolicyHash,
      pausedDomains: ['outbound_send', 'desktop_control'],
      statusByDomain: {
        outbound_send: safetyState.domains.outbound_send === 'running' ? 'running' : 'paused',
        desktop_control:
          safetyState.domains.desktop_control === 'running' ? 'running' : 'paused',
      },
      semanticSummary: {
        trigger: violationType,
        keyAssertion: `Outbound to friend tier violated policy (${result.message}).`,
        recovery:
          'Review recipient tier and outbound payload, then manually resume paused domains.',
      },
      semanticTags: ['recipient_mismatch'],
    });
    await notifySafetyReport(projectDir, input.sessionID, [
      'Miya安全报告：朋友档外发违规，已暂停能力域',
      `触发原因: ${result.message}`,
      `能力域状态: outbound_send=${safetyState.domains.outbound_send}, desktop_control=${safetyState.domains.desktop_control}`,
      `收件通道: ${input.channel}, 收件目标: ${input.destination}`,
      '恢复条件: 调整联系人档位/内容后手动恢复域开关',
    ]);
    return {
      ...result,
      policyHash: currentPolicyHash(projectDir),
      incident,
    };
  }
  if (input.idempotencyKey) {
    const key = `channels.send:${input.idempotencyKey}`;
    runtime.outboundSendDedupe.set(key, { ts: Date.now(), result });
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [dedupeKey, value] of runtime.outboundSendDedupe.entries()) {
      if (value.ts < cutoff) runtime.outboundSendDedupe.delete(dedupeKey);
    }
  }
  return {
    ...result,
    policyHash: resolvedPolicyHash,
    sendFingerprint,
  };
}

async function notifySafetyReport(
  projectDir: string,
  sessionID: string,
  lines: string[],
): Promise<void> {
  try {
    await routeSessionMessage(projectDir, {
      sessionID: sessionID || 'main',
      text: lines.join('\n'),
      source: 'policy:incident',
    });
  } catch {}
}

function enforceInteractionModeIsolation(
  projectDir: string,
  mode: 'owner' | 'guest' | 'unknown',
): void {
  if (mode === 'owner') return;
  transitionSafetyState(projectDir, {
    source: 'interaction_mode_isolation',
    reason: `interaction_mode_${mode}`,
    domains: {
      outbound_send: 'paused',
      desktop_control: 'paused',
      memory_write: 'paused',
      memory_delete: 'paused',
    },
  });
}

function listBackground(projectDir: string): GatewaySnapshot['background'] {
  const manager = depsOf(projectDir).backgroundManager;
  if (!manager) {
    return { total: 0, running: 0, tasks: [] };
  }
  const tasks = manager.listTasks(100);
  return {
    total: tasks.length,
    running: tasks.filter((item) => item.status === 'running').length,
    tasks: tasks.map((item) => ({
      id: item.id,
      description: item.description,
      agent: item.agent,
      status: item.status,
      startedAt: item.startedAt.toISOString(),
      completedAt: item.completedAt?.toISOString(),
    })),
  };
}

function collectDoctorIssues(
  projectDir: string,
  runtime: GatewayRuntime,
  base: Omit<GatewaySnapshot, 'doctor'>,
): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const host = String(runtime.server.hostname ?? '127.0.0.1');
  if (host !== '127.0.0.1' && host !== 'localhost') {
    issues.push({
      code: 'gateway_bind_non_loopback',
      severity: 'warn',
      message: `Gateway bind host is ${host}.`,
      fix: 'Use loopback bind by default, or add strict external auth.',
    });
  }

  if (base.killSwitch.active) {
    issues.push({
      code: 'kill_switch_active',
      severity: 'error',
      message: `Kill switch active: ${base.killSwitch.reason ?? 'unknown'}.`,
      fix: 'Resolve cause and run miya_kill_release.',
    });
  }

  const channelStore = readChannelStore(projectDir);
  for (const channel of Object.values(channelStore.channels)) {
    if (channel.enabled && channel.name !== 'webchat' && channel.allowlist.length === 0) {
      issues.push({
        code: `channel_allowlist_empty_${channel.name}`,
        severity: 'warn',
        message: `${channel.name} enabled without allowlist.`,
        fix: 'Approve at least one pair request before auto handling.',
      });
    }
  }

  for (const node of base.nodes.list) {
    if (node.connected && !node.paired) {
      issues.push({
        code: `node_unpaired_${node.nodeID}`,
        severity: 'warn',
        message: `Node ${node.nodeID} connected but not paired.`,
        fix: 'Approve node pairing.',
      });
    }
  }

  if (base.skills.discovered.some((item) => !item.gate.loadable)) {
    issues.push({
      code: 'skills_gate_failures',
      severity: 'info',
      message: 'Some skills are gated by missing requirements.',
      fix: 'Inspect skills.status and satisfy gate requirements.',
    });
  }

  if (base.voice.enabled && base.voice.wakeWordEnabled && !base.voice.talkMode) {
    issues.push({
      code: 'voice_wake_without_talk_mode',
      severity: 'info',
      message: 'Voice wake word is enabled while talk mode is disabled.',
      fix: 'Enable talk mode if you expect always-on voice behavior.',
    });
  }

  if (base.companion.enabled && !base.companion.onboardingCompleted) {
    issues.push({
      code: 'companion_onboarding_incomplete',
      severity: 'warn',
      message: 'Companion mode enabled before onboarding completion.',
      fix: 'Run companion.wizard.start and finish profile setup.',
    });
  }

  return issues;
}

function buildSnapshot(projectDir: string, runtime: GatewayRuntime): GatewaySnapshot {
  const deps = depsOf(projectDir);
  const kill = readKillSwitch(projectDir);
  const jobs = deps.automationService?.listJobs() ?? [];
  const approvals = deps.automationService?.listApprovals() ?? [];
  const recentRuns = deps.automationService?.listHistory(20) ?? [];
  const sessions = listSessions(projectDir);
  const channels = runtime.channelRuntime.listChannels();
  const pendingPairs = runtime.channelRuntime.listPairs('pending');
  const recentOutbound = listOutboundAudit(projectDir, 30);
  const nodes = listNodes(projectDir);
  const devices = listDevices(projectDir);
  const invokes = listInvokeRequests(projectDir, 40);
  const enabledSkills = listEnabledSkills(projectDir);
  const discoveredSkills = discoverSkills(projectDir, deps.extraSkillDirs ?? []);
  const mediaRecent = listMediaItems(projectDir, 20);
  const voice = readVoiceState(projectDir);
  const canvas = readCanvasState(projectDir);
  const companion = readCompanionProfile(projectDir);
  const ownerIdentity = readOwnerIdentityState(projectDir);
  const persistedRuntime = readPersistedAgentRuntime(projectDir);
  const owner = ownerSummary(projectDir);

  const base: Omit<GatewaySnapshot, 'doctor'> = {
    updatedAt: nowIso(),
    gateway: syncGatewayState(projectDir, runtime),
    runtime: {
      isOwner: owner.isOwner,
      ownerPID: owner.ownerPID,
      ownerFresh: owner.ownerFresh,
      activeAgentId: persistedRuntime.activeAgentId,
      storageRevision: persistedRuntime.revision,
    },
    daemon: getLauncherDaemonSnapshot(projectDir),
    policyHash: currentPolicyHash(projectDir),
    configCenter: readConfig(projectDir),
    killSwitch: kill,
    safety: {
      recentSelfApproval: listRecentSelfApprovalRecords(projectDir, 15),
    },
    jobs: {
      total: jobs.length,
      enabled: jobs.filter((item) => item.enabled).length,
      pendingApprovals: approvals.filter((item) => item.status === 'pending').length,
      recentRuns,
    },
    loop: getSessionState(projectDir, 'main'),
    background: listBackground(projectDir),
    sessions: {
      total: sessions.length,
      active: sessions.filter((item) => item.policy.activation === 'active').length,
      queued: sessions.filter((item) => item.policy.activation === 'queued').length,
      muted: sessions.filter((item) => item.policy.activation === 'muted').length,
      items: sessions.slice(0, 100),
    },
    channels: {
      states: channels,
      pendingPairs,
      recentOutbound,
    },
    nodes: {
      total: nodes.length,
      connected: nodes.filter((item) => item.connected).length,
      pendingPairs: listNodePairs(projectDir, 'pending').length,
      list: nodes,
      devices,
      invokes,
    },
    skills: {
      enabled: enabledSkills,
      discovered: discoveredSkills,
    },
    media: {
      total: mediaRecent.length,
      recent: mediaRecent,
    },
    voice,
    canvas: {
      activeDocID: canvas.activeDocID,
      docs: listCanvasDocs(projectDir),
      events: canvas.events.slice(0, 100),
    },
    companion,
    security: {
      ownerIdentity: {
        ...ownerIdentity,
        passwordHash: ownerIdentity.passwordHash ? '***' : undefined,
        passphraseHash: ownerIdentity.passphraseHash ? '***' : undefined,
      },
    },
  };

  return {
    ...base,
    doctor: {
      issues: collectDoctorIssues(projectDir, runtime, base),
    },
  };
}

function daemonProgressAuditFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'audit', 'daemon-job-progress.jsonl');
}

function appendDaemonProgressAudit(
  projectDir: string,
  input: {
    type: 'daemon.ready' | 'daemon.disconnected' | 'job.progress';
    at: string;
    payload?: Record<string, unknown>;
    snapshot: ReturnType<typeof getLauncherDaemonSnapshot>;
  },
): void {
  const file = daemonProgressAuditFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    `${JSON.stringify({ id: `dprogress_${randomUUID()}`, ...input })}\n`,
    'utf-8',
  );
}

async function routeSessionMessage(
  projectDir: string,
  input: {
    sessionID: string;
    text: string;
    source: string;
  },
): Promise<{ delivered: boolean; queued: boolean; reason?: string }> {
  const deps = depsOf(projectDir);
  if (await enforceCriticalIntentGuard(projectDir, input)) {
    return {
      delivered: false,
      queued: false,
      reason: 'kill_switch_triggered_by_critical_intent',
    };
  }
  const interactionMode = readOwnerIdentityState(projectDir).mode;
  enforceInteractionModeIsolation(projectDir, interactionMode);
  const payload = buildSessionPayloadByMode(interactionMode, input.text);
  const safeText = payload.payload;
  appendShortTermMemoryLog(projectDir, {
    sessionID: input.sessionID,
    sender: 'user',
    text: safeText,
  });
  if (interactionMode === 'guest') {
    appendGuestConversation(projectDir, {
      text: payload.redacted ? '[redacted_sensitive_guest_request]' : input.text,
      source: input.source,
      sessionID: input.sessionID,
    });
  }
  const session =
    getSession(projectDir, input.sessionID) ??
    upsertSession(projectDir, {
      id: input.sessionID,
      kind: input.sessionID.startsWith('opencode:') ? 'opencode' : 'channel',
      groupId: input.sessionID,
      routingSessionID: 'main',
      agent: '1-task-manager',
    });

  if (session.policy.activation !== 'active' || session.policy.reply !== 'auto') {
    enqueueSessionMessage(projectDir, input.sessionID, {
      text: safeText,
      source: input.source,
    });
    return {
      delivered: false,
      queued: true,
      reason: `policy_${session.policy.activation}_${session.policy.reply}`,
    };
  }

  const client = deps.client;
  if (!client) {
    enqueueSessionMessage(projectDir, input.sessionID, {
      text: safeText,
      source: input.source,
    });
    return {
      delivered: false,
      queued: true,
      reason: 'client_unavailable',
    };
  }

  try {
    await client.session.prompt({
      path: { id: session.routing.opencodeSessionID },
      body: {
        agent: session.routing.agent,
        parts: [{ type: 'text', text: safeText }],
      },
      query: { directory: projectDir },
    });
    dequeueSessionMessage(projectDir, input.sessionID);
    return { delivered: true, queued: false };
  } catch (error) {
    enqueueSessionMessage(projectDir, input.sessionID, {
      text: safeText,
      source: input.source,
    });
    return {
      delivered: false,
      queued: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveApprovalTicket(input: {
  projectDir: string;
  sessionID: string;
  permission: string;
  patterns: string[];
}): { ok: true; ticket: ApprovalTicketSummary } | { ok: false; reason: string } {
  const kill = readKillSwitch(input.projectDir);
  if (kill.active) {
    return { ok: false, reason: 'kill_switch_active' };
  }

  const request = {
    sessionID: input.sessionID,
    permission: input.permission,
    patterns: input.patterns,
  };
  const tier = requiredTierForRequest(request);
  const requestHash = buildRequestHash(
    {
      permission: input.permission,
      patterns: input.patterns,
      toolCallID: '',
      messageID: '',
    },
    false,
  );
  const token = findApprovalToken(input.projectDir, input.sessionID, [requestHash], tier);
  if (token) {
    return {
      ok: true,
      ticket: {
        permission: input.permission,
        requestHash,
        traceID: token.trace_id,
        createdAt: token.created_at,
        expiresAt: token.expires_at,
        tier: token.tier,
      },
    };
  }

  activateKillSwitch(input.projectDir, 'missing_evidence', randomUUID());
  return { ok: false, reason: 'missing_evidence' };
}

function enforceToken(input: {
  projectDir: string;
  sessionID: string;
  permission: string;
  patterns: string[];
}): { ok: true } | { ok: false; reason: string } {
  const resolved = resolveApprovalTicket(input);
  return resolved.ok ? { ok: true } : resolved;
}

function renderConsoleHtml(snapshot: GatewaySnapshot): string {
  const payload = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miya Gateway React</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #0f172a; color: #e2e8f0; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 16px; }
    .row { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); margin-bottom: 12px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; }
    .title { color: #93c5fd; font-size: 12px; text-transform: uppercase; }
    .value { font-size: 20px; font-weight: 700; margin-top: 6px; }
    .ok { color: #4ade80; }
    .bad { color: #f87171; }
    textarea { width: 100%; min-height: 220px; resize: vertical; background: #020617; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 8px; font-family: Consolas, monospace; }
    button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .line { margin: 6px 0; color: #cbd5e1; font-size: 13px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>window.__MIYA_SNAPSHOT__ = ${payload};</script>
  <script type="module">
    import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
    import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

    function App() {
      const [state, setState] = useState(window.__MIYA_SNAPSHOT__);
      const [patchText, setPatchText] = useState('{"set":{},"unset":[]}');
      const [saveState, setSaveState] = useState("idle");
      const wsRef = useRef(null);
      const reqRef = useRef(1);
      const pendingRef = useRef(new Map());

      const daemonOk = Boolean(state?.daemon?.connected);
      const daemonLabel = daemonOk ? "Miya Daemon Connected" : (state?.daemon?.statusText || "Miya Daemon Disconnected");

      const daemonStats = useMemo(() => {
        const cpu = typeof state?.daemon?.cpuPercent === "number" ? state.daemon.cpuPercent.toFixed(1) + "%" : "--";
        const vu = typeof state?.daemon?.vramUsedMB === "number" ? state.daemon.vramUsedMB : "--";
        const vt = typeof state?.daemon?.vramTotalMB === "number" ? state.daemon.vramTotalMB : "--";
        const up = typeof state?.daemon?.uptimeSec === "number" ? state.daemon.uptimeSec + "s" : "--";
        return cpu + " | " + vu + "/" + vt + " MB | " + up;
      }, [state]);
      const daemonJobLine = useMemo(() => {
        const id = state?.daemon?.activeJobID || "--";
        const progress = typeof state?.daemon?.activeJobProgress === "number" ? state.daemon.activeJobProgress + "%" : "--";
        return id + " | " + progress;
      }, [state]);

      const sendReq = (method, params) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("ws_not_open"));
        const id = "r-" + reqRef.current++;
        ws.send(JSON.stringify({ type: "request", id, method, params }));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingRef.current.delete(id);
            reject(new Error("request_timeout"));
          }, 8000);
          pendingRef.current.set(id, { resolve, reject, timer });
        });
      };

      useEffect(() => {
        const load = async () => {
          try {
            const res = await fetch("/api/status", { cache: "no-store" });
            const data = await res.json();
            setState(data);
          } catch {}
        };
        load();
        const timer = setInterval(load, 3000);
        return () => clearInterval(timer);
      }, []);

      useEffect(() => {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const token = new URLSearchParams(location.search).get("token") || localStorage.getItem("miya_gateway_token") || "";
        if (token) localStorage.setItem("miya_gateway_token", token);
        const ws = new WebSocket(proto + "://" + location.host + "/ws");
        wsRef.current = ws;
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "hello", role: "ui", protocolVersion: "1.0", auth: token ? { token } : undefined }));
          ws.send(JSON.stringify({ type: "request", id: "sub", method: "gateway.subscribe", params: { events: ["*"] } }));
        };
        ws.onmessage = (evt) => {
          try {
            const frame = JSON.parse(evt.data);
            if (frame.type === "event" && frame.event === "gateway.snapshot") {
              setState(frame.payload);
              return;
            }
            if (frame.type === "response") {
              const pending = pendingRef.current.get(frame.id);
              if (!pending) return;
              pendingRef.current.delete(frame.id);
              clearTimeout(pending.timer);
              if (frame.ok) pending.resolve(frame.result);
              else pending.reject(new Error(frame.error?.message || "request_failed"));
            }
          } catch {}
        };
        return () => {
          for (const p of pendingRef.current.values()) {
            clearTimeout(p.timer);
            p.reject(new Error("ws_closed"));
          }
          pendingRef.current.clear();
          try { ws.close(); } catch {}
        };
      }, []);

      const saveConfig = async () => {
        setSaveState("saving");
        try {
          const patch = JSON.parse(patchText);
          await sendReq("config.center.patch", { patch, policyHash: state?.policyHash });
          setSaveState("ok");
        } catch (err) {
          setSaveState("error:" + String(err?.message || err));
        }
      };

      return React.createElement("div", { className: "wrap" },
        React.createElement("h2", null, "Miya Gateway (React Prototype)"),
        React.createElement("div", { className: "line " + (daemonOk ? "ok" : "bad") }, daemonLabel),
        React.createElement("div", { className: "row" },
          React.createElement("div", { className: "card" },
            React.createElement("div", { className: "title" }, "Daemon CPU/VRAM/Uptime"),
            React.createElement("div", { className: "value" }, daemonStats),
            React.createElement("div", { className: "line" }, "Active Job: " + daemonJobLine)),
          React.createElement("div", { className: "card" },
            React.createElement("div", { className: "title" }, "Sessions"),
            React.createElement("div", { className: "value" }, String(state?.sessions?.active || 0) + "/" + String(state?.sessions?.total || 0))),
          React.createElement("div", { className: "card" },
            React.createElement("div", { className: "title" }, "Jobs"),
            React.createElement("div", { className: "value" }, String(state?.jobs?.enabled || 0) + "/" + String(state?.jobs?.total || 0))),
          React.createElement("div", { className: "card" },
            React.createElement("div", { className: "title" }, "Policy Hash"),
            React.createElement("div", { className: "line" }, state?.policyHash || "--"))),
        React.createElement("div", { className: "card" },
          React.createElement("div", { className: "title" }, "Configuration Center (read/write .opencode/miya/config.json)"),
          React.createElement("div", { className: "line" }, "Patch JSON format: { set: {\"ui.language\":\"zh-CN\"}, unset: [] }"),
          React.createElement("textarea", { value: patchText, onChange: (e) => setPatchText(e.target.value) }),
          React.createElement("div", { style: { marginTop: "8px", display: "flex", gap: "8px", alignItems: "center" } },
            React.createElement("button", { onClick: saveConfig, disabled: saveState === "saving" }, "保存配置"),
            React.createElement("span", { className: "line" }, saveState)),
          React.createElement("pre", { className: "line", style: { whiteSpace: "pre-wrap", maxHeight: "220px", overflow: "auto" } }, JSON.stringify(state?.configCenter || {}, null, 2))));
    }

    createRoot(document.getElementById("root")).render(React.createElement(App));
  </script>
</body>
</html>`;
}

function renderWebChatHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miya WebChat</title>
  <style>
    body{margin:0;font-family:Segoe UI,sans-serif;background:#0b1117;color:#e6edf7}
    main{max-width:900px;margin:0 auto;padding:14px;display:grid;gap:10px}
    #log{min-height:360px;border:1px solid #253047;border-radius:8px;background:#111827;padding:10px;white-space:pre-wrap}
    .row{display:grid;grid-template-columns:1fr auto;gap:8px}
    input{border:1px solid #253047;border-radius:8px;background:#111827;color:#e6edf7;padding:8px}
    button{border:1px solid #253047;border-radius:8px;background:#1f6feb;color:#fff;padding:8px 12px;cursor:pointer}
  </style>
</head>
<body>
<main>
  <h2 style="margin:0">Miya WebChat</h2>
  <div id="log"></div>
  <div class="row"><input id="msg" placeholder="Type message"><button id="send">Send</button></div>
</main>
<script>
  const logEl=document.getElementById('log'); const msgEl=document.getElementById('msg'); const sendBtn=document.getElementById('send');
  const p=location.protocol==='https:'?'wss':'ws'; const ws=new WebSocket(p+'://'+location.host+'/ws');
  const log=(t)=>{logEl.textContent+=t+'\\n'; logEl.scrollTop=logEl.scrollHeight;};
  const send=()=>{const text=msgEl.value.trim(); if(!text)return; ws.send(JSON.stringify({type:'request',id:'send-'+Date.now(),method:'sessions.send',params:{sessionID:'webchat:main',text,source:'webchat'}})); log('[you] '+text); msgEl.value='';};
  sendBtn.onclick=send; msgEl.addEventListener('keydown',(e)=>{if(e.key==='Enter')send();});
  ws.onopen=()=>{const qs=new URLSearchParams(location.search);const token=qs.get('token')||localStorage.getItem('miya_gateway_token')||'';if(token)localStorage.setItem('miya_gateway_token',token);ws.send(JSON.stringify({type:'hello',role:'ui',auth:token?{token}:undefined})); ws.send(JSON.stringify({type:'request',id:'sub',method:'gateway.subscribe',params:{events:['*']}})); log('[system] connected');};
  ws.onmessage=(event)=>{try{const frame=JSON.parse(event.data); if(frame.type==='response'&&!frame.ok)log('[error] '+(frame.error?.message||'request_failed'));}catch{}};
</script>
</body>
</html>`;
}

function formatGatewayState(state: GatewayState): string {
  return formatGatewayStateWithRuntime(state, undefined, undefined, undefined, undefined);
}

function formatGatewayStateWithRuntime(
  state: GatewayState,
  ownerPID?: number,
  isOwner?: boolean,
  activeAgentId?: string,
  storageRevision?: number,
): string {
  return [
    `url=${state.url}`,
    `port=${state.port}`,
    `pid=${state.pid}`,
    `owner_pid=${ownerPID ?? 0}`,
    `is_owner=${Boolean(isOwner)}`,
    `started_at=${state.startedAt}`,
    `status=${state.status}`,
    `active_agent=${activeAgentId ?? ''}`,
    `storage_revision=${storageRevision ?? 0}`,
  ].join('\n');
}

function maybeBroadcast(projectDir: string, runtime: GatewayRuntime): void {
  runtime.stateVersion += 1;
  const frame = toEventFrame({
    event: 'gateway.snapshot',
    payload: buildSnapshot(projectDir, runtime),
    stateVersion: { gateway: runtime.stateVersion },
  });
  runtime.server.publish('miya:broadcast', JSON.stringify(frame));
}

function publishGatewayEvent(
  runtime: GatewayRuntime,
  event: string,
  payload: unknown,
): void {
  runtime.stateVersion += 1;
  runtime.server.publish(
    'miya:broadcast',
    JSON.stringify(
      toEventFrame({
        event,
        payload,
        stateVersion: { gateway: runtime.stateVersion },
      }),
    ),
  );
}

async function runWizardTrainingWorker(
  projectDir: string,
  runtime: GatewayRuntime,
): Promise<void> {
  if (runtime.wizardRunnerBusy) return;
  const queued = pickQueuedTrainingJob(projectDir);
  if (!queued) return;
  runtime.wizardRunnerBusy = true;
  try {
    const runningState = markTrainingJobRunning(projectDir, queued.job.id, queued.sessionId);
    publishGatewayEvent(runtime, 'companion.wizard.progress', {
      sessionId: queued.sessionId,
      jobID: queued.job.id,
      type: queued.job.type,
      status: 'training',
      progress: 5,
      step: runningState.state,
    });
    const daemon = getMiyaClient(projectDir);
    const profileDir = getCompanionProfileCurrentDir(projectDir, queued.sessionId);
    if (queued.job.type === 'training.image') {
      const photosDir = path.join(profileDir, 'photos');
      const result = await daemon.runFluxTraining({
        profileDir,
        photosDir,
        jobID: queued.job.id,
        checkpointPath: queued.job.checkpointPath,
      });
      if (result.status === 'failed' && result.checkpointPath && queued.job.attempts < 3) {
        const requeued = requeueTrainingJob(projectDir, {
          sessionId: queued.sessionId,
          jobID: queued.job.id,
          checkpointPath: result.checkpointPath,
          message: '训练中断，已从checkpoint自动重排队恢复',
        });
        publishGatewayEvent(runtime, 'companion.wizard.progress', {
          sessionId: queued.sessionId,
          jobID: queued.job.id,
          type: queued.job.type,
          status: 'pending',
          progress: Math.max(10, queued.job.progress),
          message: '训练中断，已从checkpoint自动重排队恢复',
          step: requeued.state,
        });
        return;
      }
      const done = markTrainingJobFinished(projectDir, {
        sessionId: queued.sessionId,
        jobID: queued.job.id,
        status: result.status === 'failed' ? 'failed' : result.status,
        message: result.message,
        tier: result.tier,
        checkpointPath: result.checkpointPath,
      });
      publishGatewayEvent(runtime, 'companion.wizard.progress', {
        sessionId: queued.sessionId,
        jobID: queued.job.id,
        type: queued.job.type,
        status: result.status === 'failed' ? 'failed' : result.status,
        progress: result.status === 'failed' || result.status === 'canceled' ? 50 : 100,
        currentTier: result.tier,
        message: result.message,
        step: done.state,
        nextPrompt: wizardPromptByState(done.state),
      });
      return;
    }

    const voiceSamplePath = path.join(profileDir, 'voice', 'original_sample.wav');
    const result = await daemon.runSovitsTraining({
      profileDir,
      voiceSamplePath,
      jobID: queued.job.id,
      checkpointPath: queued.job.checkpointPath,
    });
    if (result.status === 'failed' && result.checkpointPath && queued.job.attempts < 3) {
      const requeued = requeueTrainingJob(projectDir, {
        sessionId: queued.sessionId,
        jobID: queued.job.id,
        checkpointPath: result.checkpointPath,
        message: '训练中断，已从checkpoint自动重排队恢复',
      });
      publishGatewayEvent(runtime, 'companion.wizard.progress', {
        sessionId: queued.sessionId,
        jobID: queued.job.id,
        type: queued.job.type,
        status: 'pending',
        progress: Math.max(10, queued.job.progress),
        message: '训练中断，已从checkpoint自动重排队恢复',
        step: requeued.state,
      });
      return;
    }
    const done = markTrainingJobFinished(projectDir, {
      sessionId: queued.sessionId,
      jobID: queued.job.id,
      status: result.status === 'failed' ? 'failed' : result.status,
      message: result.message,
      tier: result.tier,
      checkpointPath: result.checkpointPath,
    });
    publishGatewayEvent(runtime, 'companion.wizard.progress', {
      sessionId: queued.sessionId,
      jobID: queued.job.id,
      type: queued.job.type,
      status: result.status === 'failed' ? 'failed' : result.status,
      progress: result.status === 'failed' || result.status === 'canceled' ? 50 : 100,
      currentTier: result.tier,
      message: result.message,
      step: done.state,
      nextPrompt: wizardPromptByState(done.state),
    });
  } finally {
    runtime.wizardRunnerBusy = false;
  }
}

function ensureWsData(
  runtime: GatewayRuntime,
  ws: Bun.ServerWebSocket<unknown>,
): GatewayWsData {
  const existing = runtime.wsMeta.get(ws);
  if (existing) {
    return existing;
  }
  const fallback: GatewayWsData = {
    clientID: `ws_${randomUUID()}`,
    role: 'unknown',
    subscriptions: new Set(['*']),
    authenticated: !process.env.MIYA_GATEWAY_TOKEN,
  };
  runtime.wsMeta.set(ws, fallback);
  return fallback;
}

async function onInboundMessage(
  projectDir: string,
  runtime: GatewayRuntime,
  message: ChannelInboundMessage,
): Promise<void> {
  if (message.channel === 'qq' || message.channel === 'wechat') {
    const tier = getContactTier(projectDir, message.channel, message.senderID);
    if (tier === 'owner') {
      const token = detectOwnerSyncTokenFromText(message.text);
      if (token) {
        const approval = approveOwnerSyncToken(projectDir, {
          token,
          channel: message.channel,
          senderID: message.senderID,
        });
        await notifySafetyReport(projectDir, 'main', [
          approval.ok
            ? `Miya 安全确认：已收到本人档同步确认 token=${token}`
            : `Miya 安全确认失败：token=${token} reason=${approval.reason ?? 'unknown'}`,
        ]);
        maybeBroadcast(projectDir, runtime);
        return;
      }
    }
  }
  const sessionID = `${message.channel}:${message.conversationID}`;
  upsertSession(projectDir, {
    id: sessionID,
    kind: 'channel',
    groupId: sessionID,
    title: message.displayName,
    routingSessionID: 'main',
    agent: '1-task-manager',
  });
  await routeSessionMessage(projectDir, {
    sessionID,
    text: message.text,
    source: message.channel,
  });
  maybeBroadcast(projectDir, runtime);
}

function createMethods(projectDir: string, runtime: GatewayRuntime): GatewayMethodRegistry {
  const methods = new GatewayMethodRegistry();

  methods.register('gateway.status.get', async () => buildSnapshot(projectDir, runtime));
  methods.register('gateway.shutdown', async () => {
    const state = syncGatewayState(projectDir, runtime);
    setTimeout(() => {
      stopGateway(projectDir);
    }, 20);
    return { ok: true, state };
  });
  methods.register('doctor.run', async () => buildSnapshot(projectDir, runtime).doctor);
  methods.register('config.center.get', async () => readConfig(projectDir));
  methods.register('config.center.patch', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    const validation = validateConfigPatch(projectDir, params.patch);
    if (!validation.ok) {
      throw new Error(`config_validation_failed:${validation.errors.join('|')}`);
    }
    const applied = applyConfigPatch(projectDir, validation);
    return {
      updatedConfig: applied.updatedConfig,
      changedKeys: applied.applied.map((item) => item.key),
    };
  });

  methods.register('sessions.list', async () => listSessions(projectDir));
  methods.register('sessions.get', async (params) => {
    const sessionID = parseText(params.sessionID);
    if (!sessionID) throw new Error('invalid_session_id');
    return getSession(projectDir, sessionID);
  });
  methods.register('sessions.policy.set', async (params) => {
    const sessionID = parseText(params.sessionID);
    const policyHash = parseText(params.policyHash) || undefined;
    if (!sessionID) throw new Error('invalid_session_id');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const patch: Parameters<typeof setSessionPolicy>[2] = {};
    if (params.activation === 'active' || params.activation === 'queued' || params.activation === 'muted') {
      patch.activation = params.activation;
    }
    if (params.reply === 'auto' || params.reply === 'manual' || params.reply === 'summary_only') {
      patch.reply = params.reply;
    }
    if (params.queueStrategy === 'fifo' || params.queueStrategy === 'priority' || params.queueStrategy === 'cooldown') {
      patch.queueStrategy = params.queueStrategy;
    }
    const updated = setSessionPolicy(projectDir, sessionID, patch);
    if (!updated) throw new Error('session_not_found');
    return updated;
  });
  methods.register('sessions.send', async (params) => {
    const sessionID = parseText(params.sessionID);
    const text = parseText(params.text);
    if (!sessionID || !text) throw new Error('invalid_sessions_send_args');
    if (text.trim() === '/start') {
      const wizard = isCompanionWizardEmpty(projectDir, sessionID)
        ? startCompanionWizard(projectDir, { sessionId: sessionID })
        : readCompanionWizardState(projectDir, sessionID);
      return {
        sessionID: wizard.sessionId,
        wizard,
        checklist: wizardChecklist(wizard),
        message:
          wizard.state === 'awaiting_photos'
            ? WIZARD_PROMPT_PHOTOS
            : `检测到已有向导进度，已恢复继续。${wizardPromptByState(wizard.state)}`,
        instruction: '将照片拖拽到聊天中',
      };
    }
    if (text.trim() === '/reset_personality') {
      const wizard = resetCompanionWizard(projectDir, sessionID);
      return {
        sessionID: wizard.sessionId,
        wizard,
        message: '已重置人格资产，请重新开始 /start',
      };
    }
    upsertSession(projectDir, {
      id: sessionID,
      kind: sessionID.startsWith('opencode:') ? 'opencode' : 'channel',
      groupId: sessionID,
      routingSessionID: parseText(params.routingSessionID) || 'main',
      agent: parseText(params.agent) || '1-task-manager',
    });
    return routeSessionMessage(projectDir, {
      sessionID,
      text,
      source: parseText(params.source) || 'gateway',
    });
  });

  methods.register('cron.list', async () => depsOf(projectDir).automationService?.listJobs() ?? []);
  methods.register('cron.runs.list', async (params) => {
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(200, Number(params.limit))
        : 50;
    return depsOf(projectDir).automationService?.listHistory(limit) ?? [];
  });
  methods.register('cron.add', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const policyHash = parseText(params.policyHash) || undefined;
    const name = parseText(params.name);
    const time = parseText(params.time);
    const command = parseText(params.command);
    if (!name || !time || !command) throw new Error('invalid_cron_add_args');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    return service.scheduleDailyCommand({
      name,
      time,
      command,
      cwd: parseText(params.cwd) || undefined,
      timeoutMs: typeof params.timeoutMs === 'number' ? Number(params.timeoutMs) : undefined,
      requireApproval:
        typeof params.requireApproval === 'boolean' ? params.requireApproval : false,
    });
  });
  methods.register('cron.remove', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const policyHash = parseText(params.policyHash) || undefined;
    const jobID = parseText(params.jobID);
    if (!jobID) throw new Error('invalid_job_id');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    return { removed: service.deleteJob(jobID) };
  });
  methods.register('cron.update', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const policyHash = parseText(params.policyHash) || undefined;
    const jobID = parseText(params.jobID);
    if (!jobID || typeof params.enabled !== 'boolean') throw new Error('invalid_cron_update_args');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    return service.setJobEnabled(jobID, params.enabled);
  });
  methods.register('cron.run.now', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const policyHash = parseText(params.policyHash) || undefined;
    const jobID = parseText(params.jobID);
    if (!jobID) throw new Error('invalid_job_id');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'local_build');
    return service.runJobNow(jobID);
  });
  methods.register('cron.approvals.list', async () => depsOf(projectDir).automationService?.listApprovals() ?? []);
  methods.register('cron.approvals.approve', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const policyHash = parseText(params.policyHash) || undefined;
    const approvalID = parseText(params.approvalID);
    if (!approvalID) throw new Error('invalid_approval_id');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'local_build');
    return service.approveAndRun(approvalID);
  });
  methods.register('cron.approvals.reject', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const policyHash = parseText(params.policyHash) || undefined;
    const approvalID = parseText(params.approvalID);
    if (!approvalID) throw new Error('invalid_approval_id');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    return service.rejectApproval(approvalID);
  });

  methods.register('channels.list', async () => runtime.channelRuntime.listChannels());
  methods.register('channels.status', async () => ({
    channels: runtime.channelRuntime.listChannels(),
    pendingPairs: runtime.channelRuntime.listPairs('pending'),
  }));
  methods.register('channels.pair.list', async (params) => {
    if (params.status === 'pending' || params.status === 'approved' || params.status === 'rejected') {
      return runtime.channelRuntime.listPairs(params.status);
    }
    return runtime.channelRuntime.listPairs();
  });
  methods.register('channels.pair.approve', async (params) => {
    const pairID = parseText(params.pairID);
    if (!pairID) throw new Error('invalid_pair_id');
    return runtime.channelRuntime.approvePair(pairID);
  });
  methods.register('channels.pair.reject', async (params) => {
    const pairID = parseText(params.pairID);
    if (!pairID) throw new Error('invalid_pair_id');
    return runtime.channelRuntime.rejectPair(pairID);
  });
  methods.register('channels.contact.tier.set', async (params) => {
    const channel = parseChannel(params.channel);
    const senderID = parseText(params.senderID);
    const tier = parseText(params.tier);
    if (!channel || !senderID) throw new Error('invalid_channels_contact_tier_args');
    if (tier !== 'owner' && tier !== 'friend') {
      throw new Error('invalid_channels_contact_tier');
    }
    return setContactTier(projectDir, channel, senderID, tier);
  });
  methods.register('channels.contact.tier.get', async (params) => {
    const channel = parseChannel(params.channel);
    const senderID = parseText(params.senderID);
    if (!channel || !senderID) throw new Error('invalid_channels_contact_tier_args');
    return {
      channel,
      senderID,
      tier: getContactTier(projectDir, channel, senderID),
    };
  });
  methods.register('channels.contact.tier.list', async (params) => {
    const channel = parseChannel(params.channel);
    return {
      contacts: listContactTiers(projectDir, channel ?? undefined),
    };
  });
  methods.register('channels.message.send', async (params) => {
    const channel = parseChannel(params.channel);
    const destination = parseText(params.destination);
    const text = parseText(params.text);
    const mediaID = parseText(params.mediaID);
    const mediaPathInput = parseText(params.mediaPath);
    const idempotencyKey = parseText(params.idempotencyKey);
    const sessionID = parseText(params.sessionID) || 'main';
    const policyHash = parseText(params.policyHash) || undefined;
    const mediaFromStore = mediaID ? getMediaItem(projectDir, mediaID) : null;
    const mediaPath = mediaPathInput || mediaFromStore?.localPath || '';
    if (!channel || !destination || (!text && !mediaPath)) {
      throw new Error('invalid_channels_send_args');
    }
    const outboundCheckRaw =
      params.outboundCheck && typeof params.outboundCheck === 'object'
        ? (params.outboundCheck as Record<string, unknown>)
        : null;
    const outboundCheck: GuardedOutboundCheckInput = {
      archAdvisorApproved:
        outboundCheckRaw && typeof outboundCheckRaw.archAdvisorApproved === 'boolean'
          ? Boolean(outboundCheckRaw.archAdvisorApproved)
          : undefined,
      intent:
        outboundCheckRaw && typeof outboundCheckRaw.intent === 'string'
          ? String(outboundCheckRaw.intent)
          : undefined,
      factorRecipientIsMe:
        outboundCheckRaw && typeof outboundCheckRaw.factorRecipientIsMe === 'boolean'
          ? Boolean(outboundCheckRaw.factorRecipientIsMe)
          : undefined,
    };
    const confirmationRaw =
      params.confirmation && typeof params.confirmation === 'object'
        ? (params.confirmation as Record<string, unknown>)
        : null;
    return sendChannelMessageGuarded(projectDir, runtime, {
      channel,
      destination,
      text,
      mediaPath,
      idempotencyKey,
      sessionID,
      policyHash,
      outboundCheck,
      confirmation: {
        physicalConfirmed:
          confirmationRaw && typeof confirmationRaw.physicalConfirmed === 'boolean'
            ? Boolean(confirmationRaw.physicalConfirmed)
            : undefined,
        password:
          confirmationRaw && typeof confirmationRaw.password === 'string'
            ? String(confirmationRaw.password)
            : undefined,
        passphrase:
          confirmationRaw && typeof confirmationRaw.passphrase === 'string'
            ? String(confirmationRaw.passphrase)
            : undefined,
        ownerSyncToken:
          confirmationRaw && typeof confirmationRaw.ownerSyncToken === 'string'
            ? String(confirmationRaw.ownerSyncToken)
            : undefined,
      },
    });
  });

  methods.register('security.identity.status', async () => {
    const state = readOwnerIdentityState(projectDir);
    return {
      ...state,
      passwordHash: state.passwordHash ? '***' : undefined,
      passphraseHash: state.passphraseHash ? '***' : undefined,
    };
  });

  methods.register('security.identity.init', async (params) => {
    const password = parseText(params.password);
    const passphrase = parseText(params.passphrase);
    if (!password || !passphrase) throw new Error('invalid_owner_secret_input');
    const next = initOwnerIdentity(projectDir, {
      password,
      passphrase,
      voiceprintEmbeddingID: parseText(params.voiceprintEmbeddingID) || undefined,
      voiceprintModelPath: parseText(params.voiceprintModelPath) || undefined,
      voiceprintSampleDir: parseText(params.voiceprintSampleDir) || undefined,
    });
    return {
      ...next,
      passwordHash: '***',
      passphraseHash: '***',
    };
  });

  methods.register('security.identity.rotate', async (params) => {
    const newPassword = parseText(params.newPassword);
    const newPassphrase = parseText(params.newPassphrase);
    if (!newPassword || !newPassphrase) throw new Error('invalid_new_owner_secret');
    const next = rotateOwnerSecrets(projectDir, {
      currentPassword: parseText(params.currentPassword) || undefined,
      currentPassphrase: parseText(params.currentPassphrase) || undefined,
      newPassword,
      newPassphrase,
    });
    return {
      ...next,
      passwordHash: '***',
      passphraseHash: '***',
    };
  });

  methods.register('security.owner_sync.issue', async (params) => {
    const action = parseText(params.action) || 'outbound.high_risk.send';
    const payloadHash = parseText(params.payloadHash);
    if (!payloadHash) throw new Error('invalid_payload_hash');
    return issueOwnerSyncToken(projectDir, {
      action,
      payloadHash,
      ttlMs: typeof params.ttlMs === 'number' ? Number(params.ttlMs) : undefined,
    });
  });

  methods.register('policy.get', async () => {
    const policy = readPolicy(projectDir);
    return {
      policy,
      hash: currentPolicyHash(projectDir),
    };
  });
  methods.register('daemon.python.env.status', async () => {
    const daemon = getMiyaClient(projectDir);
    const status = (await daemon.getPythonRuntimeStatus()) as GatewayPythonRuntimeStatus | null;
    if (!status) return null;
    const recommendations = normalizeRuntimeDependencyRecommendations(status);
    const assist = await maybeTriggerDependencyAssist(projectDir, runtime, status);
    return {
      ...status,
      repairPlan: {
        ...(status.repairPlan ?? {}),
        recommendations,
      },
      opencodeAssist: assist,
    };
  });
  methods.register('daemon.python.env.repair.plan', async (params) => {
    const daemon = getMiyaClient(projectDir);
    const status = (await daemon.getPythonRuntimeStatus()) as GatewayPythonRuntimeStatus | null;
    if (!status) throw new Error('python_runtime_status_unavailable');
    const recommendations = normalizeRuntimeDependencyRecommendations(status);
    const prompt =
      status.repairPlan?.opencodeAssistPrompt || buildDependencyAssistPrompt(status);
    const route = await routeSessionMessage(projectDir, {
      sessionID: parseText(params.sessionID) || 'main',
      source: 'daemon.python.env.repair.plan',
      text: prompt,
    });
    return {
      issueType: status.repairPlan?.issueType ?? status.trainingDisabledReason ?? 'ok',
      warnings: status.repairPlan?.warnings ?? [],
      conflicts: status.repairPlan?.conflicts ?? [],
      oneShotCommand: status.repairPlan?.oneShotCommand,
      recommendations,
      routed: route,
    };
  });
  methods.register('daemon.model.lock.status', async () => {
    const daemon = getMiyaClient(projectDir);
    return daemon.getModelLockStatus();
  });
  methods.register('policy.domains.list', async () => {
    const policy = readPolicy(projectDir);
    return {
      domains: POLICY_DOMAINS.map((domain) => ({
        domain,
        status: policy.domains[domain],
      })),
      hash: currentPolicyHash(projectDir),
    };
  });
  methods.register('policy.incidents.list', async (params) => {
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(500, Number(params.limit))
        : 100;
    return {
      incidents: listPolicyIncidents(projectDir, limit),
    };
  });
  methods.register('policy.domain.pause', async (params) => {
    const domain = parseText(params.domain);
    if (!isPolicyDomain(domain)) {
      throw new Error('invalid_policy_domain');
    }
    const state = transitionSafetyState(projectDir, {
      source: 'policy.domain.pause',
      reason: `manual_pause:${domain}`,
      policyHash: currentPolicyHash(projectDir),
      domains: {
        [domain]: 'paused',
      },
    });
    appendPolicyIncident(projectDir, {
      type: 'manual_pause',
      reason: `manual_pause:${domain}`,
      pausedDomains: [domain],
      statusByDomain: {
        [domain]: state.domains[domain] === 'running' ? 'running' : 'paused',
      },
      policyHash: currentPolicyHash(projectDir),
    });
    return {
      domain,
      status: state.domains[domain] === 'running' ? 'running' : 'paused',
      hash: currentPolicyHash(projectDir),
    };
  });
  methods.register('policy.domain.resume', async (params) => {
    const domain = parseText(params.domain);
    if (!isPolicyDomain(domain)) {
      throw new Error('invalid_policy_domain');
    }
    const state = transitionSafetyState(projectDir, {
      source: 'policy.domain.resume',
      reason: `manual_resume:${domain}`,
      policyHash: currentPolicyHash(projectDir),
      domains: {
        [domain]: 'running',
      },
    });
    appendPolicyIncident(projectDir, {
      type: 'manual_resume',
      reason: `manual_resume:${domain}`,
      pausedDomains: [domain],
      statusByDomain: {
        [domain]: state.domains[domain] === 'running' ? 'running' : 'paused',
      },
      policyHash: currentPolicyHash(projectDir),
    });
    return {
      domain,
      status: state.domains[domain] === 'running' ? 'running' : 'paused',
      hash: currentPolicyHash(projectDir),
    };
  });

  methods.register('nodes.register', async (params, context) => {
    const nodeID = parseText(params.nodeID);
    const deviceID = parseText(params.deviceID);
    if (!nodeID || !deviceID) throw new Error('invalid_nodes_register_args');
    const node = registerNode(projectDir, {
      nodeID,
      deviceID,
      type:
        params.type === 'cli' ||
        params.type === 'desktop' ||
        params.type === 'mobile' ||
        params.type === 'browser'
          ? params.type
          : undefined,
      platform: parseText(params.platform) || process.platform,
      capabilities: Array.isArray(params.capabilities)
        ? params.capabilities.map(String)
        : [],
      token: parseText(params.token) || undefined,
      permissions:
        params.permissions && typeof params.permissions === 'object'
          ? {
              screenRecording:
                typeof (params.permissions as Record<string, unknown>).screenRecording ===
                'boolean'
                  ? Boolean(
                      (params.permissions as Record<string, unknown>).screenRecording,
                    )
                  : undefined,
              accessibility:
                typeof (params.permissions as Record<string, unknown>).accessibility ===
                'boolean'
                  ? Boolean(
                      (params.permissions as Record<string, unknown>).accessibility,
                    )
                  : undefined,
              filesystem:
                (params.permissions as Record<string, unknown>).filesystem === 'none' ||
                (params.permissions as Record<string, unknown>).filesystem === 'read' ||
                (params.permissions as Record<string, unknown>).filesystem === 'full'
                  ? ((params.permissions as Record<string, unknown>)
                      .filesystem as 'none' | 'read' | 'full')
                  : undefined,
              network:
                typeof (params.permissions as Record<string, unknown>).network ===
                'boolean'
                  ? Boolean((params.permissions as Record<string, unknown>).network)
                  : undefined,
            }
          : undefined,
    });
    const pair = createNodePairRequest(projectDir, { nodeID, deviceID });
    const ws = (
      context as GatewayMethodContext & {
        ws?: Bun.ServerWebSocket<unknown>;
      }
    ).ws;
    if (ws) runtime.nodeSockets.set(nodeID, ws);
    return { node, pair };
  });
  methods.register('nodes.list', async () => listNodes(projectDir));
  methods.register('nodes.heartbeat', async (params) => {
    const nodeID = parseText(params.nodeID);
    if (!nodeID) throw new Error('invalid_node_id');
    const node = touchNodeHeartbeat(projectDir, nodeID);
    if (!node) throw new Error('node_not_found');
    return node;
  });
  methods.register('nodes.token.issue', async (params) => {
    const nodeID = parseText(params.nodeID);
    if (!nodeID) throw new Error('invalid_node_id');
    const issued = issueNodeToken(projectDir, nodeID);
    if (!issued) throw new Error('node_not_found');
    return issued;
  });
  methods.register('nodes.status', async () => ({
    nodes: listNodes(projectDir),
    pendingPairs: listNodePairs(projectDir, 'pending'),
  }));
  methods.register('nodes.describe', async (params) => {
    const nodeID = parseText(params.nodeID);
    if (!nodeID) throw new Error('invalid_node_id');
    return describeNode(projectDir, nodeID);
  });
  methods.register('nodes.pair.list', async (params) => {
    if (
      params.status === 'pending' ||
      params.status === 'approved' ||
      params.status === 'rejected'
    ) {
      return listNodePairs(projectDir, params.status);
    }
    return listNodePairs(projectDir);
  });
  methods.register('nodes.pair.approve', async (params) => {
    const pairID = parseText(params.pairID);
    if (!pairID) throw new Error('invalid_pair_id');
    return resolveNodePair(projectDir, pairID, 'approved');
  });
  methods.register('nodes.pair.reject', async (params) => {
    const pairID = parseText(params.pairID);
    if (!pairID) throw new Error('invalid_pair_id');
    return resolveNodePair(projectDir, pairID, 'rejected');
  });
  methods.register('nodes.invoke', async (params) => {
    const nodeID = parseText(params.nodeID);
    const capability = parseText(params.capability);
    const sessionID = parseText(params.sessionID) || 'main';
    const policyHash = parseText(params.policyHash) || undefined;
    const args =
      params.args && typeof params.args === 'object'
        ? (params.args as Record<string, unknown>)
        : {};
    if (!nodeID || !capability) throw new Error('invalid_nodes_invoke_args');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'desktop_control');

    const token = enforceToken({
      projectDir,
      sessionID,
      permission: 'node_invoke',
      patterns: [
        `nodeId=${nodeID}`,
        `cap=${capability}`,
        `args_sha256=${hashText(JSON.stringify(args))}`,
      ],
    });
    if (!token.ok) throw new Error(`approval_required:${token.reason}`);

    const invoke = createInvokeRequest(projectDir, { nodeID, capability, args });
    markInvokeSent(projectDir, invoke.id);

    const nodeSocket = runtime.nodeSockets.get(nodeID);
    if (nodeSocket) {
      nodeSocket.send(
        JSON.stringify(
          toEventFrame({
            event: 'node.invoke.request',
            payload: invoke,
            stateVersion: { gateway: runtime.stateVersion },
          }),
        ),
      );
    }

    return invoke;
  });
  methods.register('nodes.invoke.result', async (params) => {
    const invokeID = parseText(params.invokeID);
    if (!invokeID) throw new Error('invalid_invoke_id');
    return resolveInvokeResult(projectDir, invokeID, {
      ok: Boolean(params.ok),
      result:
        params.result && typeof params.result === 'object'
          ? (params.result as Record<string, unknown>)
          : undefined,
      error: parseText(params.error) || undefined,
    });
  });
  methods.register('devices.list', async () => listDevices(projectDir));

  methods.register('skills.status', async () => ({
    enabled: listEnabledSkills(projectDir),
    discovered: discoverSkills(projectDir, depsOf(projectDir).extraSkillDirs ?? []),
  }));
  methods.register('skills.enable', async (params) => {
    const skillID = parseText(params.skillID);
    if (!skillID) throw new Error('invalid_skill_id');
    return { enabled: setSkillEnabled(projectDir, skillID, true) };
  });
  methods.register('skills.disable', async (params) => {
    const skillID = parseText(params.skillID);
    if (!skillID) throw new Error('invalid_skill_id');
    return { enabled: setSkillEnabled(projectDir, skillID, false) };
  });
  methods.register('skills.install', async (params) => {
    const repo = parseText(params.repo);
    const targetName = parseText(params.targetName) || undefined;
    const sessionID = parseText(params.sessionID) || 'main';
    const policyHash = parseText(params.policyHash) || undefined;
    if (!repo) throw new Error('invalid_repo');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'shell_exec');
    requireDomainRunning(projectDir, 'fs_write');

    const token = enforceToken({
      projectDir,
      sessionID,
      permission: 'skills_install',
      patterns: [`repo=${repo}`],
    });
    if (!token.ok) throw new Error(`approval_required:${token.reason}`);

    const root = path.join(os.homedir(), '.config', 'opencode', 'miya', 'skills');
    fs.mkdirSync(root, { recursive: true });
    const name =
      targetName ||
      repo
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/\.git$/i, '') ||
      `skill-${Date.now().toString(36)}`;
    const target = path.join(root, name);
    if (fs.existsSync(target)) return { ok: false, message: `target_exists:${target}` };

    const proc = Bun.spawnSync(['git', 'clone', '--depth', '1', repo, target], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (proc.exitCode !== 0) {
      return {
        ok: false,
        message: Buffer.from(proc.stderr).toString('utf-8').trim() || 'git_clone_failed',
      };
    }
    return { ok: true, message: 'installed', dir: target };
  });
  methods.register('skills.update', async (params) => {
    const dir = parseText(params.dir);
    const sessionID = parseText(params.sessionID) || 'main';
    const policyHash = parseText(params.policyHash) || undefined;
    if (!dir) throw new Error('invalid_dir');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'shell_exec');
    requireDomainRunning(projectDir, 'fs_write');

    const token = enforceToken({
      projectDir,
      sessionID,
      permission: 'skills_install',
      patterns: [`dir=${dir}`],
    });
    if (!token.ok) throw new Error(`approval_required:${token.reason}`);

    const proc = Bun.spawnSync(['git', '-C', dir, 'pull', '--ff-only'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (proc.exitCode !== 0) {
      return {
        ok: false,
        message: Buffer.from(proc.stderr).toString('utf-8').trim() || 'git_pull_failed',
      };
    }
    return {
      ok: true,
      message: Buffer.from(proc.stdout).toString('utf-8').trim() || 'updated',
    };
  });

  methods.register('media.ingest', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    const source = parseText(params.source);
    const mimeType = parseText(params.mimeType);
    const fileName = parseText(params.fileName);
    if (!source || !mimeType || !fileName) throw new Error('invalid_media_ingest_args');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    if (
      params.kind !== 'image' &&
      params.kind !== 'audio' &&
      params.kind !== 'video' &&
      params.kind !== 'file'
    ) {
      throw new Error('invalid_media_kind');
    }

    return ingestMedia(projectDir, {
      source,
      kind: params.kind,
      mimeType,
      fileName,
      contentBase64: parseText(params.contentBase64) || undefined,
      sizeBytes:
        typeof params.sizeBytes === 'number' ? Number(params.sizeBytes) : undefined,
      ttlHours: typeof params.ttlHours === 'number' ? Number(params.ttlHours) : undefined,
      metadata:
        params.metadata && typeof params.metadata === 'object'
          ? (params.metadata as Record<string, unknown>)
          : undefined,
    });
  });
  methods.register('media.get', async (params) => {
    const mediaID = parseText(params.mediaID);
    if (!mediaID) throw new Error('invalid_media_id');
    return getMediaItem(projectDir, mediaID);
  });
  methods.register('media.gc.run', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    return runMediaGc(projectDir);
  });
  methods.register('media.list', async (params) => {
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(500, Number(params.limit))
        : 100;
    return listMediaItems(projectDir, limit);
  });

  methods.register('voice.status', async () => readVoiceState(projectDir));
  methods.register('voice.wake.enable', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    return patchVoiceState(projectDir, {
      enabled: true,
      wakeWordEnabled: true,
    });
  });
  methods.register('voice.wake.disable', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    return patchVoiceState(projectDir, {
      wakeWordEnabled: false,
    });
  });
  methods.register('voice.talk.start', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    return patchVoiceState(projectDir, {
      enabled: true,
      talkMode: true,
      routeSessionID: parseText(params.sessionID) || readVoiceState(projectDir).routeSessionID,
    });
  });
  methods.register('voice.talk.stop', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    return patchVoiceState(projectDir, {
      talkMode: false,
    });
  });
  methods.register('voice.input.ingest', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const mediaID = parseText(params.mediaID) || undefined;
    const source =
      parseText(params.source) === 'wake' ||
      parseText(params.source) === 'talk' ||
      parseText(params.source) === 'media'
        ? (parseText(params.source) as 'wake' | 'talk' | 'media')
        : 'manual';
    const language = parseText(params.language) || undefined;
    const speakerHint = parseText(params.speakerHint) || undefined;
    const speakerScore =
      typeof params.speakerScore === 'number' ? Number(params.speakerScore) : undefined;
    const mediaPath = mediaID ? getMediaItem(projectDir, mediaID)?.localPath : undefined;
    const voiceprint = await verifyVoiceprintWithLocalModel(projectDir, {
      mediaPath,
      speakerHint,
      speakerScore,
    });
    const mode = voiceprint.mode;
    setInteractionMode(projectDir, mode);
    if (mode !== 'owner') {
      transitionSafetyState(projectDir, {
        source: 'speaker_gate',
        reason: `speaker_mode_${mode}`,
        domains: {
          outbound_send: 'paused',
          desktop_control: 'paused',
        },
      });
    }
    let text = parseText(params.text);
    if (!text && mediaID) {
      const media = getMediaItem(projectDir, mediaID);
      const transcript = media?.metadata?.transcript;
      text =
        typeof transcript === 'string' && transcript.trim()
          ? transcript.trim()
          : `[media:${mediaID}]`;
    }
    if (!text) throw new Error('invalid_voice_input');
    if (mode === 'guest') {
      const guestReply = '不好意思，我现在只能听主人的指令哦，但我可以陪你聊天。';
      appendGuestConversation(projectDir, {
        text,
        source,
        sessionID: parseText(params.sessionID) || 'main',
      });
      return {
        item: appendVoiceHistory(projectDir, {
          text,
          source,
          language,
          mediaID,
        }),
        routed: {
          delivered: false,
          queued: false,
          reason: 'guest_mode_restricted',
        },
        mode,
        voiceprint,
        reply: guestReply,
        voice: readVoiceState(projectDir),
      };
    }
    const item = appendVoiceHistory(projectDir, {
      text,
      source,
      language,
      mediaID,
    });
    const voice = readVoiceState(projectDir);
    const targetSessionID = parseText(params.sessionID) || voice.routeSessionID || 'main';
    const routed = await routeSessionMessage(projectDir, {
      sessionID: targetSessionID,
      text,
      source: `voice:${source}`,
    });
    return {
      item,
      routed,
      mode,
      voiceprint,
      voice: readVoiceState(projectDir),
    };
  });
  methods.register('voice.history.list', async (params) => {
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(500, Number(params.limit))
        : 100;
    return readVoiceState(projectDir).history.slice(0, limit);
  });
  methods.register('voice.history.clear', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_delete');
    return clearVoiceHistory(projectDir);
  });

  methods.register('canvas.status', async () => {
    const state = readCanvasState(projectDir);
    return {
      activeDocID: state.activeDocID,
      docs: listCanvasDocs(projectDir),
      events: state.events.slice(0, 100),
    };
  });
  methods.register('canvas.list', async () => listCanvasDocs(projectDir));
  methods.register('canvas.get', async (params) => {
    const docID = parseText(params.docID);
    if (!docID) throw new Error('invalid_doc_id');
    return getCanvasDoc(projectDir, docID);
  });
  methods.register('canvas.open', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    const title = parseText(params.title);
    const type = parseText(params.type);
    const content = parseText(params.content);
    if (!title) throw new Error('invalid_canvas_title');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    if (type && type !== 'text' && type !== 'markdown' && type !== 'json' && type !== 'html') {
      throw new Error('invalid_canvas_type');
    }
    const docType =
      type === 'text' || type === 'markdown' || type === 'json' || type === 'html'
        ? type
        : undefined;
    return openCanvasDoc(projectDir, {
      title,
      type: docType,
      content,
      actor: parseText(params.actor) || 'gateway',
    });
  });
  methods.register('canvas.render', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    const docID = parseText(params.docID);
    const content = parseText(params.content);
    if (!docID || !content) throw new Error('invalid_canvas_render_args');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    return renderCanvasDoc(projectDir, {
      docID,
      content,
      merge: Boolean(params.merge),
      actor: parseText(params.actor) || 'gateway',
    });
  });
  methods.register('canvas.close', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    const docID = parseText(params.docID);
    if (!docID) throw new Error('invalid_doc_id');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    return closeCanvasDoc(projectDir, docID, parseText(params.actor) || 'gateway');
  });

  methods.register('companion.status', async () => readCompanionProfile(projectDir));
  methods.register('companion.wizard.start', async (params) => {
    const sessionId = parseText(params.sessionID) || 'wizard:companion';
    const session = upsertSession(projectDir, {
      id: 'wizard:companion',
      kind: 'wizard',
      groupId: 'wizard:companion',
      title: 'Companion Onboarding',
      routingSessionID: 'main',
      agent: '1-task-manager',
    });
    const profile = readCompanionProfile(projectDir);
    const forceReset = Boolean(params.forceReset);
    const wizard =
      !forceReset && !isCompanionWizardEmpty(projectDir, sessionId)
        ? readCompanionWizardState(projectDir, sessionId)
        : startCompanionWizard(projectDir, {
            sessionId,
            forceReset,
          });
    return {
      session,
      profile,
      wizard,
      checklist: wizardChecklist(wizard),
      state: wizard.state,
      message: wizardPromptByState(wizard.state),
      instruction: '将照片拖拽到聊天中',
    };
  });
  methods.register('companion.wizard.status', async (params) => {
    const wizard = readCompanionWizardState(projectDir, parseText(params.sessionID) || 'main');
    return {
      wizard,
      checklist: wizardChecklist(wizard),
      prompt: wizardPromptByState(wizard.state),
    };
  });
  methods.register('companion.wizard.photos.submit', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const mediaIDs = Array.isArray(params.photoMediaIDs)
      ? params.photoMediaIDs.map(String)
      : Array.isArray(params.imageMediaIDs)
        ? params.imageMediaIDs.map(String)
        : [];
    const sessionId = parseText(params.sessionID) || 'main';
    const { state, job } = submitWizardPhotos(projectDir, { mediaIDs, sessionId });
    return {
      state: state.state,
      message: '收到照片，开始训练图像模型...',
      jobId: job.id,
      estimatedTime: job.estimatedTime,
      fallbackStrategy: job.fallbackStrategy,
      checklist: wizardChecklist(state),
    };
  });
  methods.register('companion.wizard.voice.submit', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const mediaID = parseText(params.mediaID) || parseText(params.audioMediaID);
    if (!mediaID) throw new Error('invalid_voice_media_id');
    const sessionId = parseText(params.sessionID) || 'main';
    const { state, job } = submitWizardVoice(projectDir, { mediaID, sessionId });
    return {
      state: state.state,
      message: '收到语音样本，开始训练声音模型...',
      jobId: job.id,
      estimatedTime: job.estimatedTime,
      checklist: wizardChecklist(state),
    };
  });
  methods.register('companion.wizard.personality.submit', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const personalityText = parseText(params.personalityText);
    const sessionId = parseText(params.sessionID) || 'main';
    const wizard = submitWizardPersonality(projectDir, {
      personalityText,
      sessionId,
    });
    patchCompanionProfile(projectDir, {
      onboardingCompleted: true,
    });
    return {
      state: wizard.state,
      message: WIZARD_PROMPT_DONE,
      personaPreview: wizard.assets.personalityText.slice(0, 120),
      checklist: wizardChecklist(wizard),
    };
  });
  methods.register('companion.wizard.cancel', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const sessionId = parseText(params.sessionID) || 'main';
    const daemon = getMiyaClient(projectDir);
    const state = readCompanionWizardState(projectDir, sessionId);
    const cancelRequests: Promise<void>[] = [];
    for (const job of state.jobs) {
      if (job.status === 'queued' || job.status === 'training') {
        cancelRequests.push(daemon.requestTrainingCancel(job.id));
      }
    }
    if (cancelRequests.length > 0) {
      await Promise.allSettled(cancelRequests);
    }
    const canceled = cancelCompanionWizardTraining(projectDir, sessionId);
    return {
      state: canceled.state,
      checklist: wizardChecklist(canceled),
      message: WIZARD_CANCELLED_MESSAGE,
    };
  });
  methods.register('companion.wizard.submit', async (params) => {
    if (Array.isArray(params.photoMediaIDs) || Array.isArray(params.imageMediaIDs)) {
      return invokeGatewayMethod(
        projectDir,
        runtime,
        'companion.wizard.photos.submit',
        params as Record<string, unknown>,
        { clientID: 'gateway', role: 'admin' },
      );
    }
    if (typeof params.mediaID === 'string' || typeof params.audioMediaID === 'string') {
      return invokeGatewayMethod(
        projectDir,
        runtime,
        'companion.wizard.voice.submit',
        params as Record<string, unknown>,
        { clientID: 'gateway', role: 'admin' },
      );
    }
    if (typeof params.personalityText === 'string') {
      return invokeGatewayMethod(
        projectDir,
        runtime,
        'companion.wizard.personality.submit',
        params as Record<string, unknown>,
        { clientID: 'gateway', role: 'admin' },
      );
    }
    throw new Error('invalid_wizard_submit_payload');
  });
  methods.register('companion.wizard.tick', async () => {
    await runWizardTrainingWorker(projectDir, runtime);
    return {
      wizard: readCompanionWizardState(projectDir, 'main'),
    };
  });
  methods.register('companion.wizard.progress.get', async (params) => {
    const jobID = parseText(params.jobId) || parseText(params.jobID);
    if (!jobID) throw new Error('invalid_job_id');
    const job = getWizardJobById(projectDir, jobID);
    if (!job) throw new Error('job_not_found');
    const status: 'pending' | 'training' | 'completed' | 'failed' | 'degraded' | 'canceled' =
      job.status === 'queued' ? 'pending' : job.status;
    const nextStep =
      status === 'completed' || status === 'degraded'
        ? readCompanionWizardState(projectDir, job.sessionId).state
        : undefined;
    return {
      status,
      progress: job.progress,
      currentTier: job.currentTier,
      message: job.message ?? '',
      nextStep,
      checkpointPath: job.checkpointPath,
      sessionId: job.sessionId,
    }
  });
  methods.register('companion.profile.update', async (params) => {
    requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    return patchCompanionProfile(projectDir, {
      enabled:
        typeof params.enabled === 'boolean'
          ? Boolean(params.enabled)
          : undefined,
      onboardingCompleted:
        typeof params.onboardingCompleted === 'boolean'
          ? Boolean(params.onboardingCompleted)
          : undefined,
      name: parseText(params.name) || undefined,
      persona: parseText(params.persona) || undefined,
      relationship: parseText(params.relationship) || undefined,
      style: parseText(params.style) || undefined,
    });
  });
  methods.register('companion.memory.add', async (params) => {
    requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    const fact = parseText(params.fact);
    if (!fact) throw new Error('invalid_memory_fact');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const created = upsertCompanionMemoryVector(projectDir, {
      text: fact,
      source: 'conversation',
      activate: false,
    });
    const profile = syncCompanionProfileMemoryFacts(projectDir);
    return {
      memory: created,
      stage: created.status,
      needsCorrectionWizard: Boolean(created.conflictWizardID),
      message: created.conflictWizardID
        ? 'memory_pending_conflict_requires_correction_wizard'
        : 'memory_pending_confirmation_required',
      profile,
    };
  });
  methods.register('companion.memory.list', async () => {
    requireOwnerMode(projectDir);
    return readCompanionProfile(projectDir).memoryFacts;
  });
  methods.register('companion.memory.pending.list', async () => {
    requireOwnerMode(projectDir);
    return listPendingCompanionMemoryVectors(projectDir);
  });
  methods.register('companion.memory.corrections.list', async () => {
    requireOwnerMode(projectDir);
    return listCompanionMemoryCorrections(projectDir);
  });
  methods.register('companion.memory.confirm', async (params) => {
    requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const memoryID = parseText(params.memoryID);
    if (!memoryID) throw new Error('invalid_memory_id');
    const confirm = typeof params.confirm === 'boolean' ? Boolean(params.confirm) : true;
    const updated = confirmCompanionMemoryVector(projectDir, {
      memoryID,
      confirm,
      supersedeConflicts:
        typeof params.supersedeConflicts === 'boolean'
          ? Boolean(params.supersedeConflicts)
          : true,
    });
    if (!updated) throw new Error('memory_not_found');
    const profile = syncCompanionProfileMemoryFacts(projectDir);
    return {
      memory: updated,
      stage: updated.status,
      profile,
    };
  });
  methods.register('companion.memory.search', async (params) => {
    requireOwnerMode(projectDir);
    const query = parseText(params.query);
    if (!query) throw new Error('invalid_memory_query');
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(20, Number(params.limit))
        : 5;
    return searchCompanionMemoryVectors(projectDir, query, limit);
  });
  methods.register('companion.memory.decay', async (params) => {
    requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const halfLifeDays =
      typeof params.halfLifeDays === 'number' && params.halfLifeDays > 0
        ? Number(params.halfLifeDays)
        : 30;
    return decayCompanionMemoryVectors(projectDir, halfLifeDays);
  });
  methods.register('companion.memory.vector.list', async () => {
    requireOwnerMode(projectDir);
    return listCompanionMemoryVectors(projectDir);
  });
  methods.register('miya.memory.sqlite.stats', async () => {
    requireOwnerMode(projectDir);
    return getCompanionMemorySqliteStats(projectDir);
  });
  methods.register('miya.memory.log.append', async (params) => {
    requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    const text = parseText(params.text);
    if (!text) throw new Error('invalid_memory_log_text');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const senderRaw = parseText(params.sender);
    const sender: 'user' | 'assistant' | 'system' =
      senderRaw === 'assistant' || senderRaw === 'system' ? senderRaw : 'user';
    return appendShortTermMemoryLog(projectDir, {
      sessionID: parseText(params.sessionID) || 'main',
      sender,
      text,
      at: parseText(params.at) || undefined,
      messageID: parseText(params.messageID) || undefined,
    });
  });
  methods.register('miya.memory.reflect', async (params) => {
    requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    const force = typeof params.force === 'boolean' ? Boolean(params.force) : false;
    const minLogs =
      typeof params.minLogs === 'number' && params.minLogs > 0 ? Number(params.minLogs) : 1;
    const maxLogs =
      typeof params.maxLogs === 'number' && params.maxLogs > 0
        ? Math.min(500, Number(params.maxLogs))
        : 50;
    const result = reflectCompanionMemory(projectDir, { force, minLogs, maxLogs });
    const profile = syncCompanionProfileMemoryFacts(projectDir);
    return {
      ...result,
      profile,
    };
  });
  methods.register('companion.asset.add', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    const type = parseText(params.type);
    const pathOrUrl = parseText(params.pathOrUrl);
    if (!pathOrUrl) throw new Error('invalid_asset_path');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'fs_write');
    if (type !== 'image' && type !== 'audio') throw new Error('invalid_asset_type');
    return addCompanionAsset(projectDir, {
      type,
      pathOrUrl,
      label: parseText(params.label) || undefined,
    });
  });
  methods.register('companion.asset.list', async () => readCompanionProfile(projectDir).assets);
  methods.register('companion.reset', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_delete');
    const profile = resetCompanionProfile(projectDir);
    const wizard = resetCompanionWizard(projectDir);
    return { profile, wizard };
  });
  methods.register('companion.intent.handle', async (params) => {
    const text = parseText(params.text);
    if (!text) throw new Error('invalid_intent_text');
    const channel = parseChannel(params.channel) ?? 'wechat';
    const destination = parseText(params.destination);
    const sessionID = parseText(params.sessionID) || 'main';
    const intent = detectMultimodalIntent(text);
    if (intent.type === 'selfie') {
      const generated = await generateImage(projectDir, {
        prompt: intent.prompt,
        model: 'local:flux.1-schnell',
        registerAsCompanionAsset: true,
      });
      if (!destination) {
        return {
          intent: 'selfie',
          sent: false,
          mediaID: generated.media.id,
          path: generated.media.localPath,
          message: 'selfie_generated_destination_missing',
        };
      }
      const send = await sendChannelMessageGuarded(projectDir, runtime, {
        channel,
        destination,
        text: '给你一张我的自拍',
        mediaPath: generated.media.localPath,
        sessionID,
        policyHash: currentPolicyHash(projectDir),
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'reply',
        },
      });
      return {
        intent: 'selfie',
        sent: send.sent,
        send,
        mediaID: generated.media.id,
        path: generated.media.localPath,
      };
    }
    if (intent.type === 'voice_to_friend') {
      const resolvedDestination = destination || intent.friend;
      if (!resolvedDestination) throw new Error('voice_destination_missing');
      const voice = await synthesizeVoiceOutput(projectDir, {
        text,
        voice: 'companion',
        model: 'local:gpt-sovits-v2pro',
        format: 'wav',
        registerAsCompanionAsset: true,
      });
      const send = await sendChannelMessageGuarded(projectDir, runtime, {
        channel: 'wechat',
        destination: resolvedDestination,
        text: '语音消息已生成',
        mediaPath: voice.media.localPath,
        sessionID,
        policyHash: currentPolicyHash(projectDir),
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'reply',
        },
      });
      return {
        intent: 'voice_to_friend',
        friend: resolvedDestination,
        sent: send.sent,
        send,
        mediaID: voice.media.id,
        path: voice.media.localPath,
      };
    }
    return { intent: 'unknown', message: 'no_multimodal_intent_matched' };
  });
  methods.register('daemon.vram.budget', async (params) => {
    const scheduler = getResourceScheduler(projectDir);
    const modelID = parseText(params.modelID) || 'local:flux.1-schnell';
    const kindRaw = parseText(params.kind);
    const kind =
      kindRaw === 'image.generate' ||
      kindRaw === 'vision.analyze' ||
      kindRaw === 'voice.tts' ||
      kindRaw === 'voice.asr' ||
      kindRaw === 'training.image' ||
      kindRaw === 'training.voice' ||
      kindRaw === 'shell.exec'
        ? kindRaw
        : 'generic';
    const requestVram = typeof params.vramMB === 'number' ? Number(params.vramMB) : 1024;
    const modelVram = typeof params.modelVramMB === 'number' ? Number(params.modelVramMB) : 2048;
    const snapshot = scheduler.snapshot();
    const budget = calculateVramBudget({
      snapshot,
      task: {
        taskID: kind,
        taskVramMB: requestVram,
      },
      models: [{ modelID, vramMB: modelVram, required: true }],
    });
    return {
      snapshot,
      budget,
      swapAction: decideModelSwapAction({
        currentModelID: snapshot.loadedModels[0]?.modelID,
        targetModelID: modelID,
        budget,
      }),
    };
  });

  return methods;
}

async function handleWebhook(
  projectDir: string,
  runtime: GatewayRuntime,
  pathname: string,
  request: Request,
): Promise<Response> {
  if (pathname === '/api/webhooks/telegram') {
    try {
      const body = await request.json();
      const inbound = parseTelegramInbound(body);
      if (!inbound) {
        return Response.json({ ok: true, ignored: true });
      }
      await runtime.channelRuntime.handleInbound(inbound);
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  if (pathname === '/api/webhooks/slack') {
    try {
      const body = (await request.json()) as {
        type?: string;
        challenge?: string;
        event?: {
          type?: string;
          user?: string;
          text?: string;
          channel?: string;
        };
      };
      if (body.type === 'url_verification' && body.challenge) {
        return new Response(body.challenge, { status: 200 });
      }
      const inbound = parseSlackInbound(body);
      if (inbound) await runtime.channelRuntime.handleInbound(inbound);
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  if (pathname === '/api/webhooks/discord') {
    try {
      const body = await request.json();
      const inbound = parseDiscordInbound(body);
      if (inbound) await runtime.channelRuntime.handleInbound(inbound);
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  if (pathname === '/api/webhooks/whatsapp') {
    try {
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        if (
          mode === 'subscribe' &&
          challenge &&
          token &&
          token === process.env.MIYA_WHATSAPP_VERIFY_TOKEN
        ) {
          return new Response(challenge, { status: 200 });
        }
        return new Response('verification_failed', { status: 403 });
      }

      const body = (await request.json()) as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              metadata?: { phone_number_id?: string };
              contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
              messages?: Array<{
                from?: string;
                text?: { body?: string };
              }>;
            };
          }>;
        }>;
      };
      const entries = body.entry ?? [];
      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          const contactMap = new Map(
            (value?.contacts ?? []).map((contact) => [
              String(contact.wa_id ?? ''),
              contact.profile?.name,
            ]),
          );
          for (const message of value?.messages ?? []) {
            const senderID = String(message.from ?? '');
            const text = String(message.text?.body ?? '');
            if (!senderID || !text) continue;
            await runtime.channelRuntime.handleInbound({
              channel: 'whatsapp',
              senderID,
              displayName: contactMap.get(senderID) ?? senderID,
              conversationID: senderID,
              text,
              raw: body,
            });
          }
        }
      }
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  if (pathname === '/api/webhooks/google-chat') {
    try {
      const body = (await request.json()) as {
        message?: {
          text?: string;
          sender?: { name?: string; displayName?: string };
          space?: { name?: string };
          thread?: { name?: string };
        };
      };
      const text = body.message?.text ?? '';
      const sender = body.message?.sender?.name ?? '';
      const conversationID =
        body.message?.thread?.name ?? body.message?.space?.name ?? '';
      if (text && sender && conversationID) {
        await runtime.channelRuntime.handleInbound({
          channel: 'google_chat',
          senderID: sender,
          displayName: body.message?.sender?.displayName ?? sender,
          conversationID,
          text,
          raw: body,
        });
      }
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  if (pathname === '/api/webhooks/signal') {
    try {
      const body = (await request.json()) as {
        envelope?: {
          source?: string;
          sourceName?: string;
          dataMessage?: { message?: string };
        };
      };
      const source = body.envelope?.source ?? '';
      const text = body.envelope?.dataMessage?.message ?? '';
      if (source && text) {
        await runtime.channelRuntime.handleInbound({
          channel: 'signal',
          senderID: source,
          displayName: body.envelope?.sourceName ?? source,
          conversationID: source,
          text,
          raw: body,
        });
      }
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  if (pathname === '/api/webhooks/imessage') {
    try {
      const body = (await request.json()) as {
        data?: {
          text?: string;
          chatGuid?: string;
          handle?: { address?: string };
          isFromMe?: boolean;
          displayName?: string;
        };
      };
      const fromMe = Boolean(body.data?.isFromMe);
      const text = body.data?.text ?? '';
      const sender = body.data?.handle?.address ?? '';
      const chatGuid = body.data?.chatGuid ?? '';
      if (!fromMe && text && sender && chatGuid) {
        await runtime.channelRuntime.handleInbound({
          channel: 'imessage',
          senderID: sender,
          displayName: body.data?.displayName ?? sender,
          conversationID: chatGuid,
          text,
          raw: body,
        });
      }
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  if (pathname === '/api/webhooks/teams') {
    try {
      const body = (await request.json()) as {
        type?: string;
        text?: string;
        from?: { id?: string; name?: string };
        conversation?: { id?: string };
      };
      if (
        body.type === 'message' &&
        body.text &&
        body.from?.id &&
        body.conversation?.id
      ) {
        await runtime.channelRuntime.handleInbound({
          channel: 'teams',
          senderID: body.from.id,
          displayName: body.from.name ?? body.from.id,
          conversationID: body.conversation.id,
          text: body.text,
          raw: body,
        });
      }
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  return new Response('Not Found', { status: 404 });
}

export function ensureGatewayRunning(projectDir: string): GatewayState {
  const existing = runtimes.get(projectDir);
  if (existing) {
    const owner = acquireGatewayOwner(projectDir);
    if (owner.owned) {
      touchOwnerLock(projectDir);
    }
    return syncGatewayState(projectDir, existing);
  }

  const owner = acquireGatewayOwner(projectDir);
  if (!owner.owned) {
    const state = readGatewayStateFile(projectDir);
    if (state && owner.owner && state.pid !== owner.owner.pid) {
      clearGatewayStateFile(projectDir);
    }
    if (state && isProcessAlive(state.pid)) {
      return state;
    }
    if (state && !isProcessAlive(state.pid)) {
      clearGatewayStateFile(projectDir);
    }
    if (owner.owner && !isProcessAlive(owner.owner.pid)) {
      const retry = acquireGatewayOwner(projectDir);
      if (!retry.owned) {
        throw new Error('gateway_owned_by_other_process');
      }
    } else {
      throw new Error('gateway_owned_by_other_process');
    }
  }

  let runtime!: GatewayRuntime;
  const methods = new GatewayMethodRegistry();
  const controlUi = createControlUiRequestOptions(projectDir);
  const channelRuntime = new ChannelRuntime(projectDir, {
    onInbound: async (message) => {
      await onInboundMessage(projectDir, runtime, message);
    },
    onPairRequested: async () => {
      maybeBroadcast(projectDir, runtime);
    },
  });

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, currentServer) {
      const url = new URL(request.url);
      if (url.pathname === '/ws') {
        const upgraded = currentServer.upgrade(request);
        if (upgraded) return;
        return new Response('websocket upgrade failed', { status: 400 });
      }

      if (url.pathname === '/api/status') {
        return Response.json(buildSnapshot(projectDir, runtime), {
          headers: { 'cache-control': 'no-store' },
        });
      }

      const controlUiResponse = handleControlUiHttpRequest(request, controlUi);
      if (controlUiResponse) {
        const missingUiFallback =
          controlUiResponse.status === 503 && controlUi.root?.kind !== 'resolved';
        if (!missingUiFallback) return controlUiResponse;
      }

      if (url.pathname === '/webchat') {
        return new Response(renderWebChatHtml(), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }

      if (url.pathname.startsWith('/api/webhooks/')) {
        return handleWebhook(projectDir, runtime, url.pathname, request);
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(renderConsoleHtml(buildSnapshot(projectDir, runtime)), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }

      return new Response('Not Found', { status: 404 });
    },
    websocket: {
      open(ws) {
        ensureWsData(runtime, ws);
        ws.subscribe('miya:broadcast');
        ws.send(
          JSON.stringify(
            toEventFrame({
              event: 'gateway.snapshot',
              payload: buildSnapshot(projectDir, runtime),
              stateVersion: { gateway: runtime.stateVersion },
            }),
          ),
        );
      },
      close(ws) {
        const wsData = ensureWsData(runtime, ws);
        if (wsData.nodeID) {
          runtime.nodeSockets.delete(wsData.nodeID);
          markNodeDisconnected(projectDir, wsData.nodeID);
        }
        runtime.wsMeta.delete(ws);
      },
      async message(ws, message) {
        const wsData = ensureWsData(runtime, ws);
        const parsed = parseIncomingFrame(message);
        if (!parsed.frame) {
          ws.send(
            JSON.stringify(
              toResponseFrame({
                id: 'invalid',
                ok: false,
                errorCode: 'bad_request',
                errorMessage: parsed.error ?? 'invalid_frame',
              }),
            ),
          );
          return;
        }

        const frame = parsed.frame;
        if (frame.type === 'ping') {
          ws.send(JSON.stringify(toPongFrame(frame.ts)));
          return;
        }
        if (frame.type === 'hello') {
          const requiredToken = process.env.MIYA_GATEWAY_TOKEN;
          const incomingToken = frame.auth?.token;
          if (requiredToken && incomingToken !== requiredToken) {
            ws.send(
              JSON.stringify(
                toResponseFrame({
                  id: 'hello',
                  ok: false,
                  errorCode: 'unauthorized',
                  errorMessage: 'invalid_gateway_token',
                }),
              ),
            );
            ws.close();
            return;
          }
          wsData.authenticated = true;
          if (frame.clientID) wsData.clientID = frame.clientID;
          if (frame.role) wsData.role = frame.role;
          ws.send(
            JSON.stringify(
              toResponseFrame({
                id: 'hello',
                ok: true,
                result: {
                  clientID: wsData.clientID,
                  role: wsData.role,
                  methods: runtime.methods.list(),
                },
              }),
            ),
          );
          return;
        }

        if (!wsData.authenticated) {
          ws.send(
            JSON.stringify(
              toResponseFrame({
                id: frame.id,
                ok: false,
                errorCode: 'unauthorized',
                errorMessage: 'send_hello_with_auth_first',
              }),
            ),
          );
          return;
        }

        if (frame.method === 'gateway.subscribe') {
          wsData.subscriptions = new Set(
            Array.isArray(frame.params?.events) ? frame.params.events.map(String) : ['*'],
          );
          ws.send(
            JSON.stringify(
              toResponseFrame({
                id: frame.id,
                ok: true,
                result: {
                  subscribed: [...wsData.subscriptions],
                },
              }),
            ),
          );
          return;
        }

        if (frame.method === 'nodes.register') {
          const nodeID = parseText(frame.params?.nodeID);
          if (nodeID) {
            wsData.nodeID = nodeID;
            runtime.nodeSockets.set(nodeID, ws);
          }
        }

        try {
          const result = await invokeGatewayMethod(
            projectDir,
            runtime,
            frame.method,
            frame.params ?? {},
            {
              clientID: wsData.clientID,
              role: wsData.role,
              ws,
            } as GatewayMethodContext,
          );
          ws.send(JSON.stringify(toResponseFrame({ id: frame.id, ok: true, result })));
          if (frame.method !== 'gateway.status.get') {
            maybeBroadcast(projectDir, runtime);
          }
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          ws.send(
            JSON.stringify(
              toResponseFrame({
                id: frame.id,
                ok: false,
                errorCode: messageText.startsWith('unknown_method:')
                  ? 'unknown_method'
                  : 'method_failed',
                errorMessage: messageText,
              }),
            ),
          );
        }
      },
    },
  });

  runtime = {
    startedAt: nowIso(),
    server,
    methods,
    stateVersion: 1,
    controlUi,
    channelRuntime,
    outboundSendDedupe: new Map(),
    nodeSockets: new Map(),
    wsMeta: new WeakMap(),
    wizardTickTimer: undefined,
    ownerBeatTimer: undefined,
    memoryReflectTimer: undefined,
    wizardRunnerBusy: false,
    dependencyAssistHashes: new Set(),
    daemonLauncherUnsubscribe: undefined,
  };

  runtime.methods = createMethods(projectDir, runtime);
  runtimes.set(projectDir, runtime);
  runtime.wizardTickTimer = setInterval(() => {
    void runWizardTrainingWorker(projectDir, runtime);
  }, 1_200);
  runtime.ownerBeatTimer = setInterval(() => {
    touchOwnerLock(projectDir);
  }, 5_000);
  runtime.memoryReflectTimer = setInterval(() => {
    const status = getMemoryReflectStatus(projectDir);
    if (status.pendingLogs < 50) return;
    const reflected = maybeAutoReflectCompanionMemory(projectDir, {
      idleMinutes: 10,
      minPendingLogs: 50,
      cooldownMinutes: 3,
      maxLogs: 100,
    });
    if (reflected) {
      syncCompanionProfileMemoryFacts(projectDir);
    }
  }, 30_000);
  runtime.daemonLauncherUnsubscribe = subscribeLauncherEvents(projectDir, (event) => {
    appendDaemonProgressAudit(projectDir, event);
    if (event.type === 'job.progress') {
      publishGatewayEvent(runtime, 'daemon.job_progress', event);
      const status = String(event.payload?.status ?? '').trim().toLowerCase();
      if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'degraded' ||
        status === 'canceled'
      ) {
        publishGatewayEvent(runtime, 'daemon.job_terminal', event);
      }
      return;
    }
    publishGatewayEvent(runtime, event.type, event);
  });
  void runtime.channelRuntime.start();
  return syncGatewayState(projectDir, runtime);
}

export function createGatewayTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const miya_gateway_start = tool({
    description: 'Start Miya Gateway and persist .opencode/miya/gateway.json.',
    args: {},
    async execute() {
      registerGatewayDependencies(ctx.directory, { client: ctx.client });
      const state = ensureGatewayRunning(ctx.directory);
      const persisted = readPersistedAgentRuntime(ctx.directory);
      const owner = ownerSummary(ctx.directory);
      const healthy = await probeGatewayAlive(state.url, 1_000);
      return [
        formatGatewayStateWithRuntime(
          state,
          owner.ownerPID,
          owner.isOwner,
          persisted.activeAgentId,
          persisted.revision,
        ),
        `gateway_healthy=${healthy}`,
      ].join('\n');
    },
  });

  const miya_gateway_status = tool({
    description: 'Read current Miya Gateway state.',
    args: {},
    async execute() {
      registerGatewayDependencies(ctx.directory, { client: ctx.client });
      const state = ensureGatewayRunning(ctx.directory);
      const persisted = readPersistedAgentRuntime(ctx.directory);
      const owner = ownerSummary(ctx.directory);
      const healthy = await probeGatewayAlive(state.url, 1_000);
      return [
        formatGatewayStateWithRuntime(
          state,
          owner.ownerPID,
          owner.isOwner,
          persisted.activeAgentId,
          persisted.revision,
        ),
        `gateway_healthy=${healthy}`,
      ].join('\n');
    },
  });

  const miya_gateway_doctor = tool({
    description: 'Run control-plane doctor checks.',
    args: {},
    async execute() {
      registerGatewayDependencies(ctx.directory, { client: ctx.client });
      ensureGatewayRunning(ctx.directory);
      const runtime = runtimes.get(ctx.directory);
      if (!runtime) return 'doctor_failed=gateway_unavailable';
      const issues = buildSnapshot(ctx.directory, runtime).doctor.issues;
      if (issues.length === 0) return 'doctor=ok\nissues=0';
      return [
        'doctor=issues',
        `issues=${issues.length}`,
        ...issues.map((issue) => `- [${issue.severity}] ${issue.code} | ${issue.message}`),
      ].join('\n');
    },
  });

  const miya_gateway_shutdown = tool({
    description: 'Stop Miya Gateway runtime.',
    args: {},
    async execute() {
      const result = stopGateway(ctx.directory);
      if (!result.stopped) return 'stopped=false\nreason=not_running';
      return [
        'stopped=true',
        `url=${result.previous?.url ?? ''}`,
        `port=${result.previous?.port ?? 0}`,
      ].join('\n');
    },
  });

  return {
    miya_gateway_start,
    miya_gateway_status,
    miya_gateway_doctor,
    miya_gateway_shutdown,
  };
}

export function startGatewayWithLog(projectDir: string): void {
  try {
    const state = ensureGatewayRunning(projectDir);
    log('[gateway] started', state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'gateway_owned_by_other_process') {
      log('[gateway] follower mode: owner is another process', { projectDir });
      return;
    }
    log('[gateway] failed to start', {
      error: message,
    });
  }
}
