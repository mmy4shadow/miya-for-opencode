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
  <title>Miya Gateway Console</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --text: #10243a;
      --muted: #5d7288;
      --ok: #0d8a46;
      --warn: #b64a00;
      --border: #d8e0e8;
    }
    body {
      margin: 0;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      background: linear-gradient(180deg, #e8eef3 0%, var(--bg) 45%, #eef3f7 100%);
      color: var(--text);
    }
    main {
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: 0 2px 10px rgba(16, 36, 58, 0.08);
    }
    .label {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .value {
      font-size: 14px;
      line-height: 1.45;
      word-break: break-word;
    }
    .status-ok {
      color: var(--ok);
      font-weight: 600;
    }
    .status-warn {
      color: var(--warn);
      font-weight: 600;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      font-size: 12px;
      color: #223649;
    }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <div class="label">Autopilot</div>
      <div id="autopilot" class="value"></div>
    </section>
    <section class="card">
      <div class="label">Kill Switch</div>
      <div id="killswitch" class="value"></div>
    </section>
    <section class="card">
      <div class="label">Gateway</div>
      <div id="gateway" class="value"></div>
    </section>
    <section class="card">
      <div class="label">Raw Status (debug)</div>
      <pre id="raw"></pre>
    </section>
  </main>
  <script>
    const initial = ${JSON.stringify(payload)};
    function render(data) {
      const ap = data.autopilot || {};
      const kill = data.killSwitch || {};
      const gateway = data.gateway || {};
      const killClass = kill.active ? "status-warn" : "status-ok";
      document.getElementById("autopilot").innerText = ap.status + " | " + (ap.detail || "");
      document.getElementById("killswitch").innerHTML =
        '<span class="' + killClass + '">' + (kill.active ? "ACTIVE" : "INACTIVE") + "</span>" +
        " | reason=" + (kill.reason || "n/a") +
        " | trace=" + (kill.traceId || "n/a");
      document.getElementById("gateway").innerText =
        "status=" + (gateway.status || "n/a") +
        " | url=" + (gateway.url || "n/a") +
        " | pid=" + (gateway.pid || "n/a");
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
