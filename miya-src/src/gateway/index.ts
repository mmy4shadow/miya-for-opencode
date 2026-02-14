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
import { getLauncherDaemonSnapshot } from '../daemon';
import { readConfig, applyConfigPatch, validateConfigPatch } from '../settings';
import {
  appendVoiceHistory,
  clearVoiceHistory,
  patchVoiceState,
  readVoiceState,
} from '../voice/state';
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
  addCompanionMemoryFact,
  patchCompanionProfile,
  readCompanionProfile,
  resetCompanionProfile,
} from '../companion/store';
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
  daemon: ReturnType<typeof getLauncherDaemonSnapshot>;
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
  doctor: {
    issues: DoctorIssue[];
  };
}

const runtimes = new Map<string, GatewayRuntime>();
const dependencies = new Map<string, GatewayDependencies>();

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

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
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
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
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

  const previous = toGatewayState(projectDir, runtime);
  try {
    runtime.channelRuntime.stop();
  } catch {}
  try {
    runtime.server.stop(true);
  } catch {}
  runtimes.delete(projectDir);
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

function requirePolicyHash(projectDir: string, providedHash: string | undefined): string {
  const policyGuard = assertPolicyHash(projectDir, providedHash);
  if (!policyGuard.ok) {
    throw new Error(`${policyGuard.reason}:expected=${policyGuard.hash}`);
  }
  return policyGuard.hash;
}

function requireDomainRunning(projectDir: string, domain: PolicyDomain): void {
  if (!isDomainRunning(projectDir, domain)) {
    throw new Error(`domain_paused:${domain}`);
  }
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

  const base: Omit<GatewaySnapshot, 'doctor'> = {
    updatedAt: nowIso(),
    gateway: syncGatewayState(projectDir, runtime),
    daemon: getLauncherDaemonSnapshot(projectDir),
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
  };

  return {
    ...base,
    doctor: {
      issues: collectDoctorIssues(projectDir, runtime, base),
    },
  };
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
      text: input.text,
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
      text: input.text,
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
        parts: [{ type: 'text', text: input.text }],
      },
      query: { directory: projectDir },
    });
    dequeueSessionMessage(projectDir, input.sessionID);
    return { delivered: true, queued: false };
  } catch (error) {
    enqueueSessionMessage(projectDir, input.sessionID, {
      text: input.text,
      source: input.source,
    });
    return {
      delivered: false,
      queued: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function enforceToken(input: {
  projectDir: string;
  sessionID: string;
  permission: string;
  patterns: string[];
}): { ok: true } | { ok: false; reason: string } {
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
  if (token) return { ok: true };

  activateKillSwitch(input.projectDir, 'missing_evidence', randomUUID());
  return { ok: false, reason: 'missing_evidence' };
}

function renderConsoleHtml(snapshot: GatewaySnapshot): string {
  const payload = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miya 控制面板 | Control Plane</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border-color: #30363d;
      --text-primary: #e6edf3;
      --text-secondary: #7d8590;
      --accent-blue: #2f81f7;
      --accent-green: #3fb950;
      --accent-red: #f85149;
      --accent-yellow: #d29922;
      --accent-purple: #a371f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
    }
    
    /* Top Navigation Bar - OpenCode Style */
    .top-nav {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 0 24px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .nav-brand h1 {
      font-size: 20px;
      font-weight: 600;
    }
    .nav-brand .subtitle {
      font-size: 12px;
      color: var(--text-secondary);
    }
    .nav-tabs {
      display: flex;
      gap: 4px;
      flex: 1;
      justify-content: center;
      max-width: 800px;
    }
    .nav-tab {
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 14px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
    }
    .nav-tab:hover { 
      background: var(--bg-tertiary); 
      color: var(--text-primary);
    }
    .nav-tab.active { 
      background: var(--accent-blue); 
      color: white;
    }
    .nav-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 12px;
      font-size: 12px;
      background: var(--bg-tertiary);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .status-online { background: var(--accent-green); }
    .status-warning { background: var(--accent-yellow); }
    .status-error { background: var(--accent-red); }
    
    /* Main Content */
    .main-content {
      padding: 24px;
      max-width: 1400px;
      margin: 0 auto;
    }
    
    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }
    .header-left h2 { font-size: 24px; font-weight: 600; }
    .header-actions { display: flex; gap: 12px; }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background: var(--bg-secondary);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover { background: var(--bg-tertiary); }
    .btn-primary { 
      background: var(--accent-blue); 
      border-color: var(--accent-blue);
      color: white;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-danger { 
      background: var(--accent-red); 
      border-color: var(--accent-red);
      color: white;
    }
    
    /* Cards Grid */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 20px;
      transition: all 0.2s;
    }
    .stat-card:hover { border-color: var(--accent-blue); }
    .stat-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .stat-card-title {
      font-size: 13px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-card-icon { font-size: 20px; }
    .stat-card-value {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .stat-card-subtitle {
      font-size: 13px;
      color: var(--text-secondary);
    }
    
    /* Content Sections */
    .section {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    .section-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-content {
      padding: 20px;
      font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-x: auto;
      max-height: 500px;
      overflow-y: auto;
    }
    
    /* Agent Status */
    .agent-list {
      display: grid;
      gap: 12px;
    }
    .agent-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-radius: 8px;
      border: 1px solid transparent;
    }
    .agent-item:hover { border-color: var(--border-color); }
    .agent-avatar {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: var(--accent-blue);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
    }
    .agent-info { flex: 1; }
    .agent-name { font-weight: 500; margin-bottom: 2px; }
    .agent-desc { font-size: 12px; color: var(--text-secondary); }
    .agent-status {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      background: var(--bg-secondary);
    }
    .agent-status.active { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
    
    /* Loop Progress */
    .loop-indicator {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .loop-dot {
      width: 32px;
      height: 6px;
      border-radius: 3px;
      background: var(--bg-tertiary);
      transition: all 0.3s;
    }
    .loop-dot.active { background: var(--accent-blue); }
    .loop-dot.completed { background: var(--accent-green); }
    
    /* Kill Switch Banner */
    .killswitch-banner {
      background: var(--accent-red);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 500;
    }
    
    /* Responsive */
    @media (max-width: 768px) {
      .main-content { padding: 16px; }
      .cards-grid { grid-template-columns: repeat(2, 1fr); }
      .nav-tabs { display: none; }
    }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: var(--bg-secondary); }
    ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); }
  </style>
</head>
<body>
  <!-- Top Navigation - OpenCode Style -->
  <nav class="top-nav">
    <div class="nav-brand">
      <h1>🤖 Miya <span style="font-size: 12px; color: var(--text-secondary); font-weight: normal;">| Control Plane</span></h1>
    </div>
    <div class="nav-tabs">
      <button class="nav-tab active" data-tab="overview" onclick="switchTab('overview')">📊 总览</button>
      <button class="nav-tab" data-tab="agents" onclick="switchTab('agents')">👥 代理</button>
      <button class="nav-tab" data-tab="autopilot" onclick="switchTab('autopilot')">🚀 自动运行</button>
      <button class="nav-tab" data-tab="approval" onclick="switchTab('approval')">🔒 安全</button>
      <button class="nav-tab" data-tab="jobs" onclick="switchTab('jobs')">⏰ 任务</button>
      <button class="nav-tab" data-tab="nodes" onclick="switchTab('nodes')">🖥️ 节点</button>
      <button class="nav-tab" data-tab="logs" onclick="switchTab('logs')">📋 日志</button>
    </div>
    <div class="nav-actions">
      <div class="status-badge">
        <span class="status-dot status-online" id="status-dot"></span>
        <span id="status-text">运行中</span>
      </div>
      <button class="btn" onclick="refreshStatus()">🔄 刷新</button>
      <button class="btn btn-danger" onclick="activateKillSwitch()">🛑 紧急停止</button>
    </div>
  </nav>

  <!-- Main Content -->
  <main class="main-content">
    <div id="killswitch-banner" style="display:none" class="killswitch-banner">
      <span>⚠️ KILL SWITCH 已激活 - 所有副作用操作已被阻止</span>
      <button class="btn" onclick="releaseKillSwitch()">解除 | Release</button>
    </div>
    
    <div class="header">
      <div class="header-left">
        <h2 id="page-title">系统总览 | Overview</h2>
      </div>
      <div class="header-actions">
        <!-- Actions moved to top nav -->
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="cards-grid">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">活跃会话</span>
          <span class="stat-card-icon">💬</span>
        </div>
        <div class="stat-card-value" id="stat-sessions">0</div>
        <div class="stat-card-subtitle">Active Sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">定时任务</span>
          <span class="stat-card-icon">⏰</span>
        </div>
        <div class="stat-card-value" id="stat-jobs">0</div>
        <div class="stat-card-subtitle">Scheduled Jobs</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">已连接节点</span>
          <span class="stat-card-icon">🖥️</span>
        </div>
        <div class="stat-card-value" id="stat-nodes">0</div>
        <div class="stat-card-subtitle">Connected Nodes</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">Daemon 状态</span>
          <span class="stat-card-icon">🧠</span>
        </div>
        <div class="stat-card-value" id="stat-daemon">--</div>
        <div class="stat-card-subtitle">CPU / VRAM / Uptime</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">循环次数</span>
          <span class="stat-card-icon">🔄</span>
        </div>
        <div class="stat-card-value" id="stat-iterations">0/3</div>
        <div class="loop-indicator">
          <div class="loop-dot" id="loop-1"></div>
          <div class="loop-dot" id="loop-2"></div>
          <div class="loop-dot" id="loop-3"></div>
        </div>
      </div>
    </div>

    <!-- Agents Section -->
    <div id="agents-section" class="section">
      <div class="section-header">
        <div class="section-title">
          <span>👥</span>
          <span>六代理状态 | Agent Status</span>
        </div>
      </div>
      <div class="section-content">
        <div class="agent-list" id="agent-list"></div>
      </div>
    </div>

    <!-- Main Panel -->
    <div class="section">
      <div class="section-header">
        <div class="section-title">
          <span id="panel-icon">📊</span>
          <span id="panel-title">详细信息 | Details</span>
        </div>
      </div>
      <div class="section-content" id="panel-content">Loading...</div>
    </div>
  </main>

<script>
  const stateData = ${payload};
  let currentTab = 'overview';
  let state = stateData;

  const tabs = {
    overview: { title: '系统总览 | Overview', icon: '📊' },
    agents: { title: '代理状态 | Agents', icon: '👥' },
    autopilot: { title: '自动运行 | Autopilot', icon: '🚀' },
    approval: { title: '安全状态 | Safety', icon: '🔒' },
    jobs: { title: '定时任务 | Jobs', icon: '⏰' },
    nodes: { title: '节点管理 | Nodes', icon: '🖥️' },
    logs: { title: '系统日志 | Logs', icon: '📋' }
  };

  const agents = [
    { id: '1-task-manager', name: 'Task Manager', desc: '指挥 - 任务分解与协调', color: '#2f81f7' },
    { id: '2-code-search', name: 'Code Search', desc: '侦察 - 代码定位与现状分析', color: '#3fb950' },
    { id: '3-docs-helper', name: 'Docs Helper', desc: '查证 - 文档证据与依据', color: '#d29922' },
    { id: '4-architecture-advisor', name: 'Arch Advisor', desc: '决策 - 风险评估与方案选择', color: '#a371f7' },
    { id: '5-code-fixer', name: 'Code Fixer', desc: '执行 - 代码实现与落地', color: '#f778ba' },
    { id: '6-ui-designer', name: 'UI Designer', desc: '呈现 - 界面设计与交互', color: '#56d364' }
  ];

  function renderAgentList() {
    const container = document.getElementById('agent-list');
    if (!container) return;
    
    container.innerHTML = agents.map(agent => \`
      <div class="agent-item">
        <div class="agent-avatar" style="background: \${agent.color}">\${agent.id.split('-')[0]}</div>
        <div class="agent-info">
          <div class="agent-name">\${agent.name}</div>
          <div class="agent-desc">\${agent.desc}</div>
        </div>
        <span class="agent-status active">就绪</span>
      </div>
    \`).join('');
  }

  function updateStats() {
    document.getElementById('stat-sessions').textContent = state.sessions?.total || 0;
    document.getElementById('stat-jobs').textContent = (state.jobs?.enabled || 0) + '/' + (state.jobs?.total || 0);
    document.getElementById('stat-nodes').textContent = (state.nodes?.connected || 0) + '/' + (state.nodes?.total || 0);
    const daemonConnected = Boolean(state.daemon?.connected);
    const daemonCpu = typeof state.daemon?.cpuPercent === 'number' ? state.daemon.cpuPercent.toFixed(1) + '%' : '--';
    const daemonVramUsed = typeof state.daemon?.vramUsedMB === 'number' ? state.daemon.vramUsedMB : '--';
    const daemonVramTotal = typeof state.daemon?.vramTotalMB === 'number' ? state.daemon.vramTotalMB : '--';
    const daemonUptime = typeof state.daemon?.uptimeSec === 'number' ? state.daemon.uptimeSec + 's' : '--';
    document.getElementById('stat-daemon').textContent =
      daemonConnected ? (daemonCpu + ' | ' + daemonVramUsed + '/' + daemonVramTotal + 'MB | ' + daemonUptime) : 'Offline';
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    if (statusDot) statusDot.className = daemonConnected ? 'status-dot status-online' : 'status-dot status-error';
    if (statusText) statusText.textContent = daemonConnected ? 'Miya Daemon Connected' : (state.daemon?.statusText || 'Miya Daemon Disconnected');
    
    const iter = state.loop?.iterationCompleted || 0;
    const maxIter = state.loop?.maxIterationsPerWindow || 3;
    document.getElementById('stat-iterations').textContent = iter + '/' + maxIter;
    
    // Update loop dots
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById('loop-' + i);
      if (dot) {
        dot.className = 'loop-dot';
        if (i <= iter) dot.classList.add('completed');
        else if (i === iter + 1) dot.classList.add('active');
      }
    }
    
    // Update kill switch banner
    const ksBanner = document.getElementById('killswitch-banner');
    if (ksBanner) {
      ksBanner.style.display = state.killSwitch?.active ? 'flex' : 'none';
    }
  }

  function renderPanel() {
    const icon = document.getElementById('panel-icon');
    const title = document.getElementById('panel-title');
    const content = document.getElementById('panel-content');
    
    if (icon) icon.textContent = tabs[currentTab].icon;
    if (title) title.textContent = tabs[currentTab].title;
    
    let data = {};
    switch(currentTab) {
      case 'overview':
        data = {
          gateway: state.gateway,
          daemon: state.daemon,
          configCenter: state.configCenter,
          sessions: { total: state.sessions?.total, active: state.sessions?.active },
          jobs: { enabled: state.jobs?.enabled, pending: state.jobs?.pendingApprovals },
          loop: { 
            enabled: state.loop?.loopEnabled,
            iteration: state.loop?.iterationCompleted,
            max: state.loop?.maxIterationsPerWindow
          }
        };
        break;
      case 'autopilot':
        data = state.loop || {};
        break;
      case 'approval':
        data = {
          killSwitch: state.killSwitch,
          safety: state.safety,
          doctor: state.doctor
        };
        break;
      case 'jobs':
        data = state.jobs || {};
        break;
      case 'nodes':
        data = state.nodes || {};
        break;
      case 'logs':
        data = {
          background: state.background,
          channel: state.channels,
          daemon: state.daemon,
          recentRuns: state.jobs?.recentRuns?.slice(0, 5)
        };
        break;
    }
    
    if (content) content.textContent = JSON.stringify(data, null, 2);
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
    document.getElementById('page-title').textContent = tabs[tab].title;
    
    const agentsSection = document.getElementById('agents-section');
    if (agentsSection) {
      agentsSection.style.display = tab === 'agents' ? 'block' : 'none';
    }
    
    renderPanel();
  }

  function refreshStatus() {
    fetch('/api/status', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => { state = data; updateStats(); renderPanel(); })
      .catch(console.error);
  }

  function activateKillSwitch() {
    if (confirm('确定要激活 Kill Switch 吗？这将阻止所有副作用操作。')) {
      fetch('/api/killswitch/activate', { method: 'POST' })
        .then(() => refreshStatus())
        .catch(console.error);
    }
  }

  function releaseKillSwitch() {
    fetch('/api/killswitch/release', { method: 'POST' })
      .then(() => refreshStatus())
      .catch(console.error);
  }

  // Initialize
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  renderAgentList();
  updateStats();
  renderPanel();

  // WebSocket connection
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(proto + '://' + location.host + '/ws');
  
  ws.onopen = () => {
    const token = new URLSearchParams(location.search).get('token') || 
                  localStorage.getItem('miya_gateway_token') || '';
    if (token) localStorage.setItem('miya_gateway_token', token);
    
    ws.send(JSON.stringify({
      type: 'hello',
      role: 'ui',
      protocolVersion: '1.0',
      auth: token ? { token } : undefined
    }));
    ws.send(JSON.stringify({
      type: 'request',
      id: 'sub',
      method: 'gateway.subscribe',
      params: { events: ['*'] }
    }));
  };

  ws.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data);
      if (frame.type === 'event' && frame.event === 'gateway.snapshot') {
        state = frame.payload;
        updateStats();
        renderPanel();
      }
    } catch (e) {}
  };

  // Auto refresh every 3 seconds
  setInterval(refreshStatus, 3000);
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
  return [
    `url=${state.url}`,
    `port=${state.port}`,
    `pid=${state.pid}`,
    `started_at=${state.startedAt}`,
    `status=${state.status}`,
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
    const idempotencyKey = parseText(params.idempotencyKey);
    const sessionID = parseText(params.sessionID) || 'main';
    const policyHash = parseText(params.policyHash) || undefined;
    if (!channel || !destination || !text) throw new Error('invalid_channels_send_args');
    const resolvedPolicyHash = requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'outbound_send');
    const outboundCheckRaw =
      params.outboundCheck && typeof params.outboundCheck === 'object'
        ? (params.outboundCheck as Record<string, unknown>)
        : null;
    const archAdvisorApproved =
      outboundCheckRaw && typeof outboundCheckRaw.archAdvisorApproved === 'boolean'
        ? Boolean(outboundCheckRaw.archAdvisorApproved)
        : false;
    const riskLevelInput =
      outboundCheckRaw && typeof outboundCheckRaw.riskLevel === 'string'
        ? String(outboundCheckRaw.riskLevel)
        : 'HIGH';
    const riskLevel =
      riskLevelInput === 'LOW' || riskLevelInput === 'MEDIUM' || riskLevelInput === 'HIGH'
        ? riskLevelInput
        : 'HIGH';
    const intent =
      outboundCheckRaw && typeof outboundCheckRaw.intent === 'string'
        ? String(outboundCheckRaw.intent)
        : 'initiate';
    const containsSensitive =
      outboundCheckRaw && typeof outboundCheckRaw.containsSensitive === 'boolean'
        ? Boolean(outboundCheckRaw.containsSensitive)
        : false;
    const factorRecipientIsMeInput =
      outboundCheckRaw && typeof outboundCheckRaw.factorRecipientIsMe === 'boolean'
        ? Boolean(outboundCheckRaw.factorRecipientIsMe)
        : null;
    const factorIntentSuspicious =
      outboundCheckRaw && typeof outboundCheckRaw.factorIntentSuspicious === 'boolean'
        ? Boolean(outboundCheckRaw.factorIntentSuspicious)
        : false;
    const confidenceIntentRaw =
      outboundCheckRaw && typeof outboundCheckRaw.confidenceIntent === 'number'
        ? Number(outboundCheckRaw.confidenceIntent)
        : 0.5;
    const factorRecipientIsMe =
      factorRecipientIsMeInput !== null
        ? factorRecipientIsMeInput
        : getContactTier(projectDir, channel, destination) === 'owner';

    if (idempotencyKey) {
      const key = `channels.send:${idempotencyKey}`;
      const cached = runtime.outboundSendDedupe.get(key);
      if (cached) {
        return {
          ...(cached.result as Record<string, unknown>),
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
      const policy = writePolicy(projectDir, {
        domains: {
          ...readPolicy(projectDir).domains,
          outbound_send: 'paused',
          desktop_control: 'paused',
        },
      });
      const incident = appendPolicyIncident(projectDir, {
        type: 'decision_fusion_hard',
        reason: 'outbound_blocked:decision_fusion_hard',
        channel,
        destination,
        policyHash: resolvedPolicyHash,
        pausedDomains: ['outbound_send', 'desktop_control'],
        statusByDomain: {
          outbound_send: policy.domains.outbound_send,
          desktop_control: policy.domains.desktop_control,
        },
        semanticSummary: {
          trigger: 'decision_fusion_hard',
          keyAssertion:
            'A=contains_sensitive and decision fusion matched in danger zone (confidence < 0.5).',
          recovery:
            'Review outbound intent in OpenCode and manually resume paused domains after confirmation.',
        },
        details: {
          factorTextSensitive: containsSensitive,
          factorRecipientIsMe,
          factorIntentSuspicious,
          confidenceIntent: confidenceIntentRaw,
          zone: fusion.zone,
        },
      });
      await notifySafetyReport(projectDir, sessionID, [
        'Miya安全报告：已触发硬熔断并暂停能力域',
        `触发原因: ${incident.reason}`,
        `能力域状态: outbound_send=${policy.domains.outbound_send}, desktop_control=${policy.domains.desktop_control}`,
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
        channel,
        destination,
        policyHash: resolvedPolicyHash,
        semanticSummary: {
          trigger: 'decision_fusion_soft',
          keyAssertion:
            'Decision fusion matched in gray zone (0.5 <= confidence <= 0.85), manual confirmation required.',
          recovery: 'Confirm outbound intent in OpenCode, then retry with explicit approval.',
        },
        details: {
          factorTextSensitive: containsSensitive,
          factorRecipientIsMe,
          factorIntentSuspicious,
          confidenceIntent: confidenceIntentRaw,
          zone: fusion.zone,
        },
      });
      await notifySafetyReport(projectDir, sessionID, [
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

    const token = enforceToken({
      projectDir,
      sessionID,
      permission: 'external_message',
      patterns: [
        `channel=${channel}`,
        `dest=${destination}`,
        `payload_sha256=${hashText(text)}`,
      ],
    });
    if (!token.ok) throw new Error(`approval_required:${token.reason}`);

    const result = await runtime.channelRuntime.sendMessage({
      channel,
      destination,
      text,
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
      const policy = writePolicy(projectDir, {
        domains: {
          ...readPolicy(projectDir).domains,
          outbound_send: 'paused',
          desktop_control: 'paused',
        },
      });
      const incident = appendPolicyIncident(projectDir, {
        type: violationType,
        reason: result.message,
        channel,
        destination,
        auditID: result.auditID,
        policyHash: resolvedPolicyHash,
        pausedDomains: ['outbound_send', 'desktop_control'],
        statusByDomain: {
          outbound_send: policy.domains.outbound_send,
          desktop_control: policy.domains.desktop_control,
        },
        semanticSummary: {
          trigger: violationType,
          keyAssertion: `Outbound to friend tier violated policy (${result.message}).`,
          recovery:
            'Review recipient tier and outbound payload, then manually resume paused domains.',
        },
      });
      await notifySafetyReport(projectDir, sessionID, [
        'Miya安全报告：朋友档外发违规，已暂停能力域',
        `触发原因: ${result.message}`,
        `能力域状态: outbound_send=${policy.domains.outbound_send}, desktop_control=${policy.domains.desktop_control}`,
        `收件通道: ${channel}, 收件目标: ${destination}`,
        '恢复条件: 调整联系人档位/内容后手动恢复域开关',
      ]);
      return {
        ...result,
        policyHash: currentPolicyHash(projectDir),
        incident,
      };
    }
    if (idempotencyKey) {
      const key = `channels.send:${idempotencyKey}`;
      runtime.outboundSendDedupe.set(key, { ts: Date.now(), result });
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [dedupeKey, value] of runtime.outboundSendDedupe.entries()) {
        if (value.ts < cutoff) runtime.outboundSendDedupe.delete(dedupeKey);
      }
    }
    return {
      ...result,
      policyHash: resolvedPolicyHash,
    };
  });

  methods.register('policy.get', async () => {
    const policy = readPolicy(projectDir);
    return {
      policy,
      hash: currentPolicyHash(projectDir),
    };
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
    const policy = writePolicy(projectDir, {
      domains: {
        ...readPolicy(projectDir).domains,
        [domain]: 'paused',
      },
    });
    appendPolicyIncident(projectDir, {
      type: 'manual_pause',
      reason: `manual_pause:${domain}`,
      pausedDomains: [domain],
      statusByDomain: {
        [domain]: policy.domains[domain],
      },
      policyHash: currentPolicyHash(projectDir),
    });
    return {
      domain,
      status: policy.domains[domain],
      hash: currentPolicyHash(projectDir),
    };
  });
  methods.register('policy.domain.resume', async (params) => {
    const domain = parseText(params.domain);
    if (!isPolicyDomain(domain)) {
      throw new Error('invalid_policy_domain');
    }
    const policy = writePolicy(projectDir, {
      domains: {
        ...readPolicy(projectDir).domains,
        [domain]: 'running',
      },
    });
    appendPolicyIncident(projectDir, {
      type: 'manual_resume',
      reason: `manual_resume:${domain}`,
      pausedDomains: [domain],
      statusByDomain: {
        [domain]: policy.domains[domain],
      },
      policyHash: currentPolicyHash(projectDir),
    });
    return {
      domain,
      status: policy.domains[domain],
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
  methods.register('companion.wizard.start', async () => {
    const session = upsertSession(projectDir, {
      id: 'wizard:companion',
      kind: 'wizard',
      groupId: 'wizard:companion',
      title: 'Companion Onboarding',
      routingSessionID: 'main',
      agent: '1-task-manager',
    });
    const profile = readCompanionProfile(projectDir);
    return {
      session,
      profile,
      checklist: [
        'Set relationship and persona',
        'Upload reference image(s)',
        'Upload voice sample(s)',
        'Add memory facts',
        'Enable companion mode',
      ],
    };
  });
  methods.register('companion.profile.update', async (params) => {
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
    const policyHash = parseText(params.policyHash) || undefined;
    const fact = parseText(params.fact);
    if (!fact) throw new Error('invalid_memory_fact');
    requirePolicyHash(projectDir, policyHash);
    requireDomainRunning(projectDir, 'memory_write');
    return addCompanionMemoryFact(projectDir, fact);
  });
  methods.register('companion.memory.list', async () =>
    readCompanionProfile(projectDir).memoryFacts,
  );
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
    return resetCompanionProfile(projectDir);
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
    return syncGatewayState(projectDir, existing);
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
      if (controlUiResponse) return controlUiResponse;

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
          const result = await runtime.methods.invoke(
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
  };

  runtime.methods = createMethods(projectDir, runtime);
  runtimes.set(projectDir, runtime);
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
      return formatGatewayState(state);
    },
  });

  const miya_gateway_status = tool({
    description: 'Read current Miya Gateway state.',
    args: {},
    async execute() {
      registerGatewayDependencies(ctx.directory, { client: ctx.client });
      const state = ensureGatewayRunning(ctx.directory);
      return formatGatewayState(state);
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
    log('[gateway] failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
