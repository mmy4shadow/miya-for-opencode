import { type PluginInput, type ToolDefinition, tool } from '@opencode-ai/plugin';
import { readAutomationState, readHistoryRecords } from '../automation/store';
import {
  applyConfigPatch,
  flattenConfig,
  listSettingEntries,
  readConfig,
  validateConfigPatch,
} from '../settings';
import {
  activateKillSwitch,
  createTraceId,
  listRecentSelfApprovalRecords,
  readKillSwitch,
  releaseKillSwitch,
  writeSelfApprovalRecord,
} from '../safety/store';
import { log } from '../utils/logger';
import { getMiyaRuntimeDir } from '../workflow';
import * as fs from 'node:fs';
import * as path from 'node:path';

const z = tool.schema;

export type GatewayStatus = 'running' | 'killswitch';

export interface GatewayState {
  url: string;
  port: number;
  pid: number;
  startedAt: string;
  status: GatewayStatus;
}

interface GatewayRuntime {
  startedAt: string;
  server: ReturnType<typeof Bun.serve>;
}

interface GatewayStatusPayload {
  updatedAt: string;
  autopilot: Record<string, unknown>;
  runtime: Record<string, unknown>;
  skills: Record<string, unknown>;
  jobs: Record<string, unknown>;
  killSwitch: Record<string, unknown>;
  gateway: GatewayState;
}

const runtimes = new Map<string, GatewayRuntime>();

function gatewayFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNum(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asStr(value: unknown, fallback = 'n/a'): string {
  return typeof value === 'string' ? value : fallback;
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function buildStatusPayload(
  projectDir: string,
  runtime: GatewayRuntime,
): GatewayStatusPayload {
  const kill = readKillSwitch(projectDir);
  const config = flattenConfig(readConfig(projectDir));
  const jobsState = readAutomationState(projectDir);
  const history = readHistoryRecords(projectDir, 5);

  return {
    updatedAt: new Date().toISOString(),
    autopilot: {
      enabled: asBool(config['autopilot.enabled'], true),
      maxCycles: asNum(config['autopilot.maxCycles'], 3),
      noInterruptChat: asBool(config['autopilot.noInterruptChat'], true),
      iterationDoneRequired: asBool(config['autopilot.iterationDoneRequired'], true),
      stallDetectionEnabled: asBool(config['autopilot.stallDetection.enabled'], true),
      maxNoImprovementCycles: asNum(
        config['autopilot.stallDetection.maxNoImprovementCycles'],
        2,
      ),
    },
    runtime: {
      desktopEnabled: asBool(config['desktop.enabled'], false),
      outboundEnabled: asBool(config['outbound.enabled'], false),
      voiceEnabled: asBool(config['voice.enabled'], false),
      gatewayBindHost: asStr(config['gateway.bindHost'], '127.0.0.1'),
      gatewayConfigPort: asNum(config['gateway.port'], 17321),
      gatewayAuthMode: asStr(config['gateway.auth.mode'], 'localToken'),
    },
    skills: {
      enabled: asBool(config['skills.enabled'], true),
      packagesCount: asArr(config['skills.packages']).length,
      versionLockEnabled: asBool(config['skills.versionLock.enabled'], true),
      openCodeNativeCompat: asBool(config['skills.compat.openCodeNative'], true),
    },
    jobs: {
      total: jobsState.jobs.length,
      enabled: jobsState.jobs.filter((item) => item.enabled).length,
      approvalsPending: jobsState.approvals.filter(
        (item) => item.status === 'pending',
      ).length,
      lastRuns: history.map((item) => ({
        startedAt: item.startedAt,
        jobName: item.jobName,
        status: item.status,
        exitCode: item.exitCode,
      })),
    },
    killSwitch: {
      active: kill.active,
      reason: kill.reason ?? 'n/a',
      traceId: kill.trace_id ?? 'n/a',
      activatedAt: kill.activated_at ?? 'n/a',
    },
    gateway: syncGatewayState(projectDir, runtime),
  };
}

function headers(extra?: Record<string, string>): HeadersInit {
  return { 'cache-control': 'no-store', ...(extra ?? {}) };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: headers({ 'content-type': 'application/json; charset=utf-8' }),
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function renderHtml(projectDir: string, runtime: GatewayRuntime): string {
  const status = buildStatusPayload(projectDir, runtime);
  const config = flattenConfig(readConfig(projectDir));
  const registry = listSettingEntries();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Miya 控制台</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;margin:0;background:#0b1020;color:#e4ecff}
main{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
nav{border-right:1px solid #233250;padding:12px;background:#0d1528}
button{display:block;width:100%;margin-bottom:8px;border:1px solid #2b3d61;background:#14213d;color:#e4ecff;padding:8px;border-radius:8px;text-align:left;cursor:pointer}
button.active{background:#1c2d54}
section{padding:12px}
.page{display:none}.page.active{display:block}
.card{background:#131e36;border:1px solid #293b5f;border-radius:10px;padding:10px;margin-bottom:10px}
pre{white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #253758;padding:6px;font-size:12px;vertical-align:top}
input,select,textarea{width:100%;background:#0f1a33;color:#e4ecff;border:1px solid #2c4068;border-radius:6px;padding:5px}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.pill{padding:2px 6px;border-radius:999px;border:1px solid #2c4068;font-size:11px}
.low{color:#37d788}.med{color:#ffc266}.high{color:#ff7f8f}
@media (max-width:900px){main{grid-template-columns:1fr}nav{border-right:none;border-bottom:1px solid #233250}}
</style></head><body><main>
<nav><div class="card"><strong>Miya 控制平面</strong><div style="font-size:12px;opacity:.8">127.0.0.1 本地网页</div></div>
<button class="nav active" data-page="autopilot">Autopilot</button>
<button class="nav" data-page="settings">设置</button>
<button class="nav" data-page="approvals">Self-Approval</button>
<button class="nav" data-page="runtime">Runtime</button>
<button class="nav" data-page="jobs">Jobs</button>
<button class="nav" data-page="skills">Skills</button>
<button class="nav" data-page="killswitch">Kill Switch</button></nav>
<section>
<div class="card"><strong id="title">Autopilot</strong><div id="meta" style="font-size:12px;opacity:.8">更新时间: --</div></div>
<div id="page-autopilot" class="page active"><div class="card"><pre id="apPre">loading...</pre></div></div>
<div id="page-settings" class="page"><div class="card"><div class="toolbar"><input id="q" placeholder="搜索配置..."><button id="btnValidate">校验改动</button><button id="btnSave">保存改动</button><span id="dirty">未提交改动: 0</span></div><pre id="settingsMsg"></pre><div style="max-height:56vh;overflow:auto"><table><thead><tr><th>Key</th><th>风险</th><th>说明</th><th>值</th></tr></thead><tbody id="settingsRows"></tbody></table></div></div></div>
<div id="page-approvals" class="page"><div class="card"><pre id="approvalsPre">loading...</pre></div></div>
<div id="page-runtime" class="page"><div class="card"><pre id="runtimePre">loading...</pre></div></div>
<div id="page-jobs" class="page"><div class="card"><pre id="jobsPre">loading...</pre></div></div>
<div id="page-skills" class="page"><div class="card"><pre id="skillsPre">loading...</pre></div></div>
<div id="page-killswitch" class="page"><div class="card"><div class="toolbar"><button id="killOn">触发急停</button><button id="killOff">释放急停</button></div><pre id="killPre">loading...</pre></div></div>
</section></main>
<script>
let status=${JSON.stringify(status)};
let registry=${JSON.stringify(registry)};
let config=${JSON.stringify(config)};
let dirty={};
const titles={autopilot:'Autopilot',settings:'设置',approvals:'Self-Approval',runtime:'Runtime',jobs:'Jobs',skills:'Skills',killswitch:'Kill Switch'};
async function get(u){const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
async function post(u,b){const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));try{return JSON.parse(t);}catch{return {text:t};}}
function riskClass(r){if(r==='HIGH')return 'high';if(r==='MED')return 'med';return 'low';}
function cast(entry,raw){if(entry.type==='boolean')return !!raw;if(entry.type==='integer'){const n=Number(raw);return Number.isFinite(n)?Math.trunc(n):0;}if(entry.type==='object'||entry.type==='array'){try{return JSON.parse(String(raw));}catch{return entry.type==='object'?{}:[];}}return raw;}
function input(entry,val){const k=entry.key.replaceAll('"','&quot;');if(entry.type==='boolean')return \`<input data-k="\${k}" data-t="boolean" type="checkbox" \${val?'checked':''}>\`;if(entry.type==='integer')return \`<input data-k="\${k}" data-t="integer" type="number" value="\${Number(val??0)}">\`;if(entry.type==='enum'){const opts=(entry.enumValues||[]).map(o=>\`<option value="\${o}" \${String(o)===String(val)?'selected':''}>\${o}</option>\`).join('');return \`<select data-k="\${k}" data-t="enum">\${opts}</select>\`;}if(entry.type==='object'||entry.type==='array')return \`<textarea data-k="\${k}" data-t="\${entry.type}">\${JSON.stringify(val,null,2)}</textarea>\`;return \`<input data-k="\${k}" data-t="string" type="text" value="\${String(val??'').replaceAll('"','&quot;')}">\`;}
function bindInputs(){document.querySelectorAll('[data-k]').forEach(el=>{const key=el.getAttribute('data-k');const type=el.getAttribute('data-t');const h=()=>{const entry=registry.find(i=>i.key===key);if(!entry)return;const raw=type==='boolean'?!!el.checked:el.value;dirty[key]=cast(entry,raw);document.getElementById('dirty').innerText='未提交改动: '+Object.keys(dirty).length;};el.onchange=h;el.oninput=h;});}
function renderSettings(){const q=document.getElementById('q').value.trim().toLowerCase();const rows=[];for(const e of registry){const kw=(e.key+' '+e.description).toLowerCase();if(q&&!kw.includes(q))continue;const v=Object.prototype.hasOwnProperty.call(dirty,e.key)?dirty[e.key]:config[e.key];rows.push('<tr><td><code>'+e.key+'</code></td><td><span class="pill '+riskClass(e.risk)+'">'+e.risk+'</span></td><td>'+e.description+'</td><td>'+input(e,v)+'</td></tr>');}document.getElementById('settingsRows').innerHTML=rows.join('');bindInputs();}
function renderStatus(){document.getElementById('meta').innerText='更新时间: '+status.updatedAt;document.getElementById('apPre').innerText=JSON.stringify(status.autopilot,null,2);document.getElementById('runtimePre').innerText=JSON.stringify(status.runtime,null,2);document.getElementById('skillsPre').innerText=JSON.stringify(status.skills,null,2);document.getElementById('killPre').innerText=JSON.stringify(status.killSwitch,null,2);}
function renderApprovals(records){if(!records.length){document.getElementById('approvalsPre').innerText='暂无审批记录';return;}document.getElementById('approvalsPre').innerText=records.map(i=>'- '+i.created_at+' | '+i.status+' | '+i.tier+' | '+i.reason+'\\n  action='+i.action+' | trace='+i.trace_id).join('\\n');}
function renderJobs(data){const out=[];out.push('jobs_total='+data.jobs.length);out.push('approvals_pending='+data.approvals.filter(i=>i.status==='pending').length);out.push('');out.push('Jobs:');for(const j of data.jobs)out.push('- '+j.id+' | '+j.name+' | enabled='+j.enabled+' | next='+j.nextRunAt);out.push('');out.push('Recent runs:');for(const h of data.history)out.push('- '+h.startedAt+' | '+h.jobName+' | '+h.status+' | exit='+h.exitCode);document.getElementById('jobsPre').innerText=out.join('\\n');}
async function refresh(){status=await get('/api/status');renderStatus();}
async function loadAll(){const cfg=await get('/api/config/get');config=cfg.config||{};const reg=await get('/api/registry/list');registry=reg.settings||[];renderSettings();renderApprovals((await get('/api/approvals?limit=60')).records||[]);renderJobs(await get('/api/jobs'));await refresh();}
document.querySelectorAll('.nav').forEach(btn=>{btn.onclick=async()=>{document.querySelectorAll('.nav').forEach(n=>n.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));const page=btn.dataset.page;document.getElementById('page-'+page).classList.add('active');document.getElementById('title').innerText=titles[page]||'Miya';if(page==='approvals')renderApprovals((await get('/api/approvals?limit=60')).records||[]);if(page==='jobs')renderJobs(await get('/api/jobs'));if(page==='settings'){const cfg=await get('/api/config/get');config=cfg.config||{};renderSettings();}};});
document.getElementById('q').oninput=renderSettings;
document.getElementById('btnValidate').onclick=async()=>{try{const r=await post('/api/config/validate',{patch:{set:dirty}});document.getElementById('settingsMsg').innerText=JSON.stringify(r,null,2);}catch(e){document.getElementById('settingsMsg').innerText=String(e);}};
document.getElementById('btnSave').onclick=async()=>{try{if(Object.keys(dirty).length===0)return;const r=await post('/api/config/patch',{patch:{set:dirty},reason:'ui_save'});document.getElementById('settingsMsg').innerText=JSON.stringify(r,null,2);dirty={};document.getElementById('dirty').innerText='未提交改动: 0';await loadAll();}catch(e){document.getElementById('settingsMsg').innerText=String(e);}};
document.getElementById('killOn').onclick=async()=>{await post('/api/kill-switch/activate',{reason:'ui_manual_activation'});await refresh();renderApprovals((await get('/api/approvals?limit=60')).records||[]);};
document.getElementById('killOff').onclick=async()=>{await post('/api/kill-switch/release',{});await refresh();};
loadAll();setInterval(()=>{refresh().catch(()=>{});},1800);
</script></body></html>`;
}

export function ensureGatewayRunning(projectDir: string): GatewayState {
  const running = runtimes.get(projectDir);
  if (running) return syncGatewayState(projectDir, running);

  let runtime!: GatewayRuntime;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request, currentServer) {
      const url = new URL(request.url);
      if (url.pathname === '/ws') {
        if (currentServer.upgrade(request)) return;
        return new Response('websocket upgrade failed', { status: 400 });
      }

      if (url.pathname === '/api/status') {
        return jsonResponse(buildStatusPayload(projectDir, runtime));
      }
      if (url.pathname === '/api/config/get') {
        const key = url.searchParams.get('key') ?? undefined;
        const config = flattenConfig(readConfig(projectDir));
        return key ? jsonResponse({ key, value: config[key] }) : jsonResponse({ config });
      }
      if (url.pathname === '/api/config/validate' && request.method === 'POST') {
        const body = await readBody(request);
        return jsonResponse(validateConfigPatch(projectDir, body.patch));
      }
      if (url.pathname === '/api/config/patch' && request.method === 'POST') {
        const body = await readBody(request);
        const validation = validateConfigPatch(projectDir, body.patch);
        if (!validation.ok) return jsonResponse(validation, 400);

        const traceID = createTraceId();
        const reason =
          typeof body.reason === 'string' ? body.reason : 'gateway_api_patch';
        if (validation.maxRisk === 'HIGH') {
          activateKillSwitch(
            projectDir,
            'high_risk_patch_requires_thorough_via_chat_tool',
            traceID,
          );
          writeSelfApprovalRecord(projectDir, {
            trace_id: traceID,
            session_id: 'gateway-ui',
            request_hash: `gateway:${traceID}`,
            action: `gateway.config.patch ${reason}`,
            tier: 'THOROUGH',
            status: 'deny',
            reason: 'HIGH risk config patch must run via miya.config.patch tool.',
            checks: ['risk check'],
            evidence: [
              `risk=${validation.maxRisk}`,
              `keys=${validation.changes.map((item) => item.key).join(', ')}`,
            ],
            executor: { agent: 'gateway-ui', plan: 'apply config patch' },
            verifier: {
              agent: 'architect-verifier',
              verdict: 'deny',
              summary: 'Need THOROUGH evidence path through chat tool.',
            },
            rollback: {
              strategy: 'Run miya.config.patch in chat with THOROUGH evidence.',
            },
          });
          return jsonResponse(
            {
              ok: false,
              trace_id: traceID,
              reason:
                'HIGH risk patch denied on web API. Use miya.config.patch in chat.',
            },
            403,
          );
        }

        writeSelfApprovalRecord(projectDir, {
          trace_id: traceID,
          session_id: 'gateway-ui',
          request_hash: `gateway:${traceID}`,
          action: `gateway.config.patch ${reason}`,
          tier: validation.requiredSafetyTier === 'STANDARD' ? 'STANDARD' : 'LIGHT',
          status: 'allow',
          reason: `gateway_api_patch_allowed:${validation.maxRisk}`,
          checks: ['patch schema validation'],
          evidence: [`keys=${validation.changes.map((item) => item.key).join(', ')}`],
          executor: { agent: 'gateway-ui', plan: 'apply config patch' },
          verifier: {
            agent: 'architect-verifier',
            verdict: 'allow',
            summary: 'LOW/MED patch allowed after validation.',
          },
          rollback: { strategy: 'submit reverse patch through settings page' },
        });

        const result = applyConfigPatch(projectDir, validation);
        return jsonResponse({
          ok: true,
          trace_id: traceID,
          risk: validation.maxRisk,
          changed_keys: result.applied.map((item) => item.key),
        });
      }
      if (url.pathname === '/api/registry/list') {
        return jsonResponse({ settings: listSettingEntries() });
      }
      if (url.pathname === '/api/approvals') {
        const raw = Number(url.searchParams.get('limit') ?? '20');
        const limit = Number.isFinite(raw) ? Math.max(1, Math.min(200, raw)) : 20;
        return jsonResponse({
          records: listRecentSelfApprovalRecords(projectDir, limit),
        });
      }
      if (url.pathname === '/api/jobs') {
        const state = readAutomationState(projectDir);
        return jsonResponse({
          jobs: state.jobs,
          approvals: state.approvals,
          history: readHistoryRecords(projectDir, 20),
        });
      }
      if (
        url.pathname === '/api/kill-switch/activate' &&
        request.method === 'POST'
      ) {
        const body = await readBody(request);
        const reason =
          typeof body.reason === 'string' && body.reason.trim().length > 0
            ? body.reason.trim()
            : 'manual_activation_from_gateway_ui';
        const traceID = createTraceId();
        const next = activateKillSwitch(projectDir, reason, traceID);
        return jsonResponse({ ...next, trace_id: traceID });
      }
      if (
        url.pathname === '/api/kill-switch/release' &&
        request.method === 'POST'
      ) {
        return jsonResponse(releaseKillSwitch(projectDir));
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(renderHtml(projectDir, runtime), {
          headers: headers({ 'content-type': 'text/html; charset=utf-8' }),
        });
      }
      return new Response('Not Found', { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify(buildStatusPayload(projectDir, runtime)));
      },
      message(ws, message) {
        if (String(message) === 'status') {
          ws.send(JSON.stringify(buildStatusPayload(projectDir, runtime)));
        }
      },
    },
  });

  runtime = {
    server,
    startedAt: new Date().toISOString(),
  };
  runtimes.set(projectDir, runtime);
  return syncGatewayState(projectDir, runtime);
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

export function createGatewayTools(ctx: PluginInput): Record<string, ToolDefinition> {
  const miya_gateway_start = tool({
    description:
      'Start Miya Gateway (if needed) and persist .opencode/miya/gateway.json for web console.',
    args: {},
    async execute() {
      const state = ensureGatewayRunning(ctx.directory);
      return formatGatewayState(state);
    },
  });

  const miya_gateway_status = tool({
    description: 'Read current Miya Gateway state from runtime memory/file.',
    args: {},
    async execute() {
      const state = ensureGatewayRunning(ctx.directory);
      return formatGatewayState(state);
    },
  });

  return {
    miya_gateway_start,
    miya_gateway_status,
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

