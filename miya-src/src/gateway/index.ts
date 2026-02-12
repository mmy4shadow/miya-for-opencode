import { type PluginInput, type ToolDefinition, tool } from '@opencode-ai/plugin';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MiyaAutomationService } from '../automation';
import type { BackgroundTaskManager } from '../background';
import { readChannelStore } from '../channels/pairing-store';
import { type ChannelInboundMessage, ChannelRuntime } from '../channels/service';
import type { ChannelName } from '../channels/types';
import {
  activateKillSwitch,
  findApprovalToken,
  listRecentSelfApprovalRecords,
  readKillSwitch,
} from '../safety/store';
import { buildRequestHash, requiredTierForRequest } from '../safety/risk';
import {
  createInvokeRequest,
  createNodePairRequest,
  describeNode,
  listDevices,
  listInvokeRequests,
  listNodePairs,
  listNodes,
  markInvokeSent,
  markNodeDisconnected,
  registerNode,
  resolveInvokeResult,
  resolveNodePair,
} from '../nodes';
import { listMediaItems, getMediaItem, ingestMedia, runMediaGc } from '../media/store';
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
import {
  GatewayMethodRegistry,
  parseIncomingFrame,
  toEventFrame,
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
  channelRuntime: ChannelRuntime;
  nodeSockets: Map<string, Bun.ServerWebSocket<unknown>>;
  wsMeta: WeakMap<Bun.ServerWebSocket<unknown>, GatewayWsData>;
}

interface GatewayWsData {
  clientID: string;
  role: GatewayClientRole;
  subscriptions: Set<string>;
  nodeID?: string;
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

function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function parseText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseChannel(value: unknown): ChannelName | null {
  if (value === 'telegram' || value === 'slack' || value === 'webchat') {
    return value;
  }
  return null;
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
  const nodes = listNodes(projectDir);
  const devices = listDevices(projectDir);
  const invokes = listInvokeRequests(projectDir, 40);
  const enabledSkills = listEnabledSkills(projectDir);
  const discoveredSkills = discoverSkills(projectDir, deps.extraSkillDirs ?? []);
  const mediaRecent = listMediaItems(projectDir, 20);

  const base: Omit<GatewaySnapshot, 'doctor'> = {
    updatedAt: nowIso(),
    gateway: syncGatewayState(projectDir, runtime),
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
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miya Control Plane</title>
  <style>
    body { margin:0; font-family:Segoe UI,Microsoft YaHei,sans-serif; background:#0b1117; color:#e6edf7; }
    main { padding:12px; display:grid; gap:10px; height:100vh; box-sizing:border-box; }
    #tabs { display:flex; gap:8px; flex-wrap:wrap; }
    button { background:#111827; color:#9fb0ca; border:1px solid #253047; border-radius:8px; padding:6px 10px; cursor:pointer; }
    button.active { color:#e6edf7; border-color:#4a8de8; }
    #head { display:flex; justify-content:space-between; align-items:center; border:1px solid #253047; border-radius:10px; padding:10px; background:#111827; }
    #cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
    .card { border:1px solid #253047; border-radius:10px; padding:10px; background:#111827; }
    .k { color:#9fb0ca; font-size:12px; } .v { font-size:20px; font-weight:700; margin-top:2px; }
    #panel { border:1px solid #253047; border-radius:10px; padding:10px; background:#111827; white-space:pre-wrap; font-family:Consolas,monospace; font-size:12px; overflow:auto; min-height:0; }
    @media (max-width: 900px) { #cards { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  </style>
</head>
<body>
<main>
  <div id="head"><div><b>Miya Control Plane</b></div><div id="badge">LOADING</div></div>
  <div id="tabs"></div>
  <div id="cards"></div>
  <div id="panel"></div>
</main>
<script>
  const tabs=[['autopilot','Autopilot'],['approval','Approval'],['runtime','Runtime'],['jobs','Jobs'],['skills','Skills'],['kill','Kill']];
  let state=${payload}; let tab='autopilot';
  const tabsEl=document.getElementById('tabs'); const cardsEl=document.getElementById('cards'); const panelEl=document.getElementById('panel'); const badgeEl=document.getElementById('badge');
  const view=(t)=>{ if(t==='autopilot') return {loop:state.loop,background:state.background,sessions:state.sessions}; if(t==='approval') return {killSwitch:state.killSwitch,safety:state.safety,doctor:state.doctor}; if(t==='runtime') return {channels:state.channels,nodes:state.nodes,media:state.media}; if(t==='jobs') return state.jobs; if(t==='skills') return state.skills; return {gateway:state.gateway,killSwitch:state.killSwitch}; };
  function render(){ const kill=!!state.killSwitch?.active; badgeEl.textContent=kill?'KILL-SWITCH':String(state.gateway?.status||'unknown').toUpperCase(); tabsEl.innerHTML=''; for(const [id,label] of tabs){const b=document.createElement('button'); b.textContent=label; if(id===tab)b.className='active'; b.onclick=()=>{tab=id;render();}; tabsEl.appendChild(b);} cardsEl.innerHTML=[['Sessions',state.sessions?.total],['Jobs',state.jobs?.enabled+'/'+state.jobs?.total],['Nodes',state.nodes?.connected+'/'+state.nodes?.total],['Issues',state.doctor?.issues?.length||0]].map(([k,v])=>'<div class=\"card\"><div class=\"k\">'+k+'</div><div class=\"v\">'+v+'</div></div>').join(''); panelEl.textContent=JSON.stringify(view(tab),null,2); }
  render();
  const proto=location.protocol==='https:'?'wss':'ws'; const ws=new WebSocket(proto+'://'+location.host+'/ws');
  ws.onopen=()=>{ws.send(JSON.stringify({type:'hello',role:'ui',protocolVersion:'1.0'}));ws.send(JSON.stringify({type:'request',id:'sub',method:'gateway.subscribe',params:{events:['*']}}));ws.send(JSON.stringify({type:'request',id:'snap',method:'gateway.status.get',params:{}}));};
  ws.onmessage=(event)=>{try{const frame=JSON.parse(event.data); if(frame.type==='event'&&frame.event==='gateway.snapshot'){state=frame.payload; render();} if(frame.type==='response'&&frame.ok&&frame.result?.updatedAt){state=frame.result; render();}}catch{}};
  setInterval(async()=>{try{const r=await fetch('/api/status',{cache:'no-store'}); if(r.ok){state=await r.json(); render();}}catch{}},3000);
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
  ws.onopen=()=>{ws.send(JSON.stringify({type:'hello',role:'ui'})); ws.send(JSON.stringify({type:'request',id:'sub',method:'gateway.subscribe',params:{events:['*']}})); log('[system] connected');};
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
  methods.register('doctor.run', async () => buildSnapshot(projectDir, runtime).doctor);

  methods.register('sessions.list', async () => listSessions(projectDir));
  methods.register('sessions.get', async (params) => {
    const sessionID = parseText(params.sessionID);
    if (!sessionID) throw new Error('invalid_session_id');
    return getSession(projectDir, sessionID);
  });
  methods.register('sessions.policy.set', async (params) => {
    const sessionID = parseText(params.sessionID);
    if (!sessionID) throw new Error('invalid_session_id');
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
    const name = parseText(params.name);
    const time = parseText(params.time);
    const command = parseText(params.command);
    if (!name || !time || !command) throw new Error('invalid_cron_add_args');
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
    const jobID = parseText(params.jobID);
    if (!jobID) throw new Error('invalid_job_id');
    return { removed: service.deleteJob(jobID) };
  });
  methods.register('cron.update', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const jobID = parseText(params.jobID);
    if (!jobID || typeof params.enabled !== 'boolean') throw new Error('invalid_cron_update_args');
    return service.setJobEnabled(jobID, params.enabled);
  });
  methods.register('cron.run.now', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const jobID = parseText(params.jobID);
    if (!jobID) throw new Error('invalid_job_id');
    return service.runJobNow(jobID);
  });
  methods.register('cron.approvals.list', async () => depsOf(projectDir).automationService?.listApprovals() ?? []);
  methods.register('cron.approvals.approve', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const approvalID = parseText(params.approvalID);
    if (!approvalID) throw new Error('invalid_approval_id');
    return service.approveAndRun(approvalID);
  });
  methods.register('cron.approvals.reject', async (params) => {
    const service = depsOf(projectDir).automationService;
    if (!service) throw new Error('automation_service_unavailable');
    const approvalID = parseText(params.approvalID);
    if (!approvalID) throw new Error('invalid_approval_id');
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
  methods.register('channels.message.send', async (params) => {
    const channel = parseChannel(params.channel);
    const destination = parseText(params.destination);
    const text = parseText(params.text);
    const sessionID = parseText(params.sessionID) || 'main';
    if (!channel || !destination || !text) throw new Error('invalid_channels_send_args');

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

    return runtime.channelRuntime.sendMessage({
      channel,
      destination,
      text,
    });
  });

  methods.register('nodes.register', async (params, context) => {
    const nodeID = parseText(params.nodeID);
    const deviceID = parseText(params.deviceID);
    if (!nodeID || !deviceID) throw new Error('invalid_nodes_register_args');
    const node = registerNode(projectDir, {
      nodeID,
      deviceID,
      platform: parseText(params.platform) || process.platform,
      capabilities: Array.isArray(params.capabilities)
        ? params.capabilities.map(String)
        : [],
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
    const args =
      params.args && typeof params.args === 'object'
        ? (params.args as Record<string, unknown>)
        : {};
    if (!nodeID || !capability) throw new Error('invalid_nodes_invoke_args');

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
    if (!repo) throw new Error('invalid_repo');

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
    if (!dir) throw new Error('invalid_dir');

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
    const source = parseText(params.source);
    const mimeType = parseText(params.mimeType);
    const fileName = parseText(params.fileName);
    if (!source || !mimeType || !fileName) throw new Error('invalid_media_ingest_args');
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
  methods.register('media.gc.run', async () => runMediaGc(projectDir));
  methods.register('media.list', async (params) => {
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(500, Number(params.limit))
        : 100;
    return listMediaItems(projectDir, limit);
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
      const body = (await request.json()) as {
        message?: {
          chat?: { id?: string | number };
          from?: { id?: string | number; username?: string; first_name?: string };
          text?: string;
        };
      };
      const message = body.message;
      if (!message?.text || !message?.chat?.id || !message.from?.id) {
        return Response.json({ ok: true, ignored: true });
      }
      await runtime.channelRuntime.handleInbound({
        channel: 'telegram',
        senderID: String(message.from.id),
        displayName:
          message.from.username ?? message.from.first_name ?? String(message.from.id),
        conversationID: String(message.chat.id),
        text: message.text,
        raw: body,
      });
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
      if (
        body.event?.type === 'message' &&
        body.event.user &&
        body.event.text &&
        body.event.channel
      ) {
        await runtime.channelRuntime.handleInbound({
          channel: 'slack',
          senderID: body.event.user,
          displayName: body.event.user,
          conversationID: body.event.channel,
          text: body.event.text,
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
        if (frame.type === 'hello') {
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
    channelRuntime,
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

  return {
    miya_gateway_start,
    miya_gateway_status,
    miya_gateway_doctor,
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
