import { type PluginInput, type ToolDefinition, tool } from '@opencode-ai/plugin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readKillSwitch } from '../safety/store';
import { log } from '../utils/logger';
import { getMiyaRuntimeDir } from '../workflow';

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
  autopilot: {
    status: string;
    detail: string;
  };
  killSwitch: {
    active: boolean;
    reason: string;
    traceId: string;
    activatedAt: string;
  };
  gateway: GatewayState;
}

const runtimes = new Map<string, GatewayRuntime>();

function gatewayFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function killAwareStatus(projectDir: string): GatewayStatus {
  const kill = readKillSwitch(projectDir);
  return kill.active ? 'killswitch' : 'running';
}

function gatewayPort(runtime: GatewayRuntime): number {
  return Number(runtime.server.port ?? 0);
}

function toGatewayState(
  projectDir: string,
  runtime: GatewayRuntime,
): GatewayState {
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
  return {
    updatedAt: new Date().toISOString(),
    autopilot: {
      status: 'placeholder',
      detail:
        'Miya Autopilot control surface is online. Full orchestration metrics will be wired into this page incrementally.',
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

function renderConsoleHtml(projectDir: string, runtime: GatewayRuntime): string {
  const payload = buildStatusPayload(projectDir, runtime);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miya Dock</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080b10;
      --bg-soft: #0f141d;
      --panel: #121926;
      --panel-alt: #0f1723;
      --text: #e6edf7;
      --muted: #8f9ab1;
      --ok: #37d67a;
      --warn: #ffb347;
      --danger: #ff6e79;
      --line: #1f2a3d;
      --accent: #4f8cff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(1200px 600px at -18% -30%, rgba(79, 140, 255, 0.20), transparent 55%),
        radial-gradient(900px 560px at 120% 120%, rgba(60, 167, 255, 0.12), transparent 58%),
        var(--bg);
      color: var(--text);
      height: 100vh;
      overflow: hidden;
    }
    main {
      display: grid;
      grid-template-columns: 44px 1fr;
      height: 100vh;
    }
    .rail {
      border-right: 1px solid var(--line);
      background: linear-gradient(180deg, #0b111a 0%, #090e15 100%);
      display: grid;
      align-content: start;
      gap: 10px;
      padding: 10px 8px;
    }
    .rail-dot {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      border: 1px solid var(--line);
      background: #101827;
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 12px;
      font-family: Consolas, "JetBrains Mono", monospace;
      user-select: none;
    }
    .rail-dot.active {
      color: #d7e6ff;
      border-color: #2a4f8e;
      background: #122238;
    }
    .panel {
      padding: 10px;
      display: grid;
      gap: 10px;
      grid-template-rows: auto auto auto 1fr;
      overflow: hidden;
    }
    .header {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
      background: linear-gradient(180deg, #111b2a 0%, #0e1622 100%);
    }
    .kicker {
      color: var(--accent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 700;
    }
    #updatedAt {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .span2 {
      grid-column: 1 / -1;
    }
    .label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .value {
      font-size: 13px;
      line-height: 1.45;
      word-break: break-word;
      font-family: Consolas, "JetBrains Mono", monospace;
    }
    .detail {
      margin-top: 6px;
      color: #c4cee1;
      font-size: 12px;
      line-height: 1.4;
    }
    .badge {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 4px 8px;
      white-space: nowrap;
    }
    .badge-ok {
      color: var(--ok);
      border-color: rgba(55, 214, 122, 0.32);
      background: rgba(55, 214, 122, 0.12);
    }
    .badge-warn {
      color: var(--warn);
      border-color: rgba(255, 179, 71, 0.36);
      background: rgba(255, 179, 71, 0.12);
    }
    .badge-danger {
      color: var(--danger);
      border-color: rgba(255, 110, 121, 0.36);
      background: rgba(255, 110, 121, 0.12);
    }
    .badge-muted {
      color: var(--muted);
      background: #101827;
    }
    .hints {
      margin: 0;
      padding-left: 18px;
      color: #c2ccdf;
      font-size: 12px;
      line-height: 1.55;
    }
    .debug {
      background: var(--panel-alt);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 6px 10px;
      overflow: auto;
    }
    .debug > summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
      user-select: none;
      margin: 4px 0 8px;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      font-size: 12px;
      color: #aeb9cf;
      font-family: Consolas, "JetBrains Mono", monospace;
    }
  </style>
</head>
<body>
  <main>
    <aside class="rail">
      <div class="rail-dot active">M</div>
      <div class="rail-dot">A</div>
      <div class="rail-dot">K</div>
    </aside>
    <section class="panel">
      <header class="header">
        <div class="kicker">Miya Dock</div>
        <div class="title-row">
          <h1>Control Plane</h1>
          <span id="gatewayStateBadge" class="badge badge-muted">booting</span>
        </div>
        <div id="updatedAt">updated: --</div>
      </header>

      <section class="grid">
        <article class="card">
          <div class="label">Autopilot</div>
          <div id="autopilotStatus" class="value">--</div>
          <div id="autopilotDetail" class="detail"></div>
        </article>
        <article class="card">
          <div class="label">Kill Switch</div>
          <div id="killState" class="value">--</div>
          <div id="killMeta" class="detail"></div>
        </article>
        <article class="card span2">
          <div class="label">Gateway</div>
          <div id="gatewayEndpoint" class="value">--</div>
          <div id="gatewayMeta" class="detail"></div>
        </article>
      </section>

      <section class="card">
        <div class="label">Quick Hints</div>
        <ul class="hints">
          <li>Hover the strip to expand.</li>
          <li>Click the inner edge to collapse.</li>
          <li>Focus remains in OpenCode while dock updates.</li>
        </ul>
      </section>

      <details class="debug">
        <summary>Debug Payload</summary>
        <pre id="raw"></pre>
      </details>
    </section>
  </main>
  <script>
    const initial = ${JSON.stringify(payload)};
    function asText(value, fallback = "n/a") {
      if (value === undefined || value === null || value === "") return fallback;
      return String(value);
    }
    function setBadge(tone, text) {
      const el = document.getElementById("gatewayStateBadge");
      el.className = "badge badge-" + tone;
      el.innerText = text;
    }
    function render(data) {
      const ap = data.autopilot || {};
      const kill = data.killSwitch || {};
      const gateway = data.gateway || {};
      const state = asText(gateway.status).toLowerCase();

      let tone = "muted";
      if (kill.active) tone = "danger";
      else if (state === "running") tone = "ok";
      else if (state === "killswitch") tone = "warn";

      setBadge(tone, asText(gateway.status).toUpperCase());
      document.getElementById("updatedAt").innerText = "updated: " + asText(data.updatedAt);

      document.getElementById("autopilotStatus").innerText = asText(ap.status);
      document.getElementById("autopilotDetail").innerText = asText(ap.detail, "No detail");

      document.getElementById("killState").innerText = kill.active ? "ACTIVE" : "INACTIVE";
      document.getElementById("killMeta").innerText =
        "reason=" + asText(kill.reason) + " | trace=" + asText(kill.traceId);

      document.getElementById("gatewayEndpoint").innerText = asText(gateway.url);
      document.getElementById("gatewayMeta").innerText =
        "pid=" + asText(gateway.pid) + " | port=" + asText(gateway.port) + " | started=" + asText(gateway.startedAt);

      document.getElementById("raw").innerText = JSON.stringify(data, null, 2);
    }
    async function pull() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        render(await res.json());
      } catch {}
    }
    render(initial);
    setInterval(pull, 1500);
  </script>
</body>
</html>`;
}

export function ensureGatewayRunning(projectDir: string): GatewayState {
  const running = runtimes.get(projectDir);
  if (running) {
    return syncGatewayState(projectDir, running);
  }

  let runtime!: GatewayRuntime;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, currentServer) {
      const url = new URL(request.url);
      if (url.pathname === '/ws') {
        if (currentServer.upgrade(request)) return;
        return new Response('websocket upgrade failed', { status: 400 });
      }
      if (url.pathname === '/api/status') {
        return Response.json(buildStatusPayload(projectDir, runtime), {
          headers: { 'cache-control': 'no-store' },
        });
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(renderConsoleHtml(projectDir, runtime), {
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
      'Start Miya Gateway (if needed) and persist .opencode/miya/gateway.json for Dock clients.',
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
