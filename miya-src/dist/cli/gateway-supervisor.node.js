#!/usr/bin/env node

// src/cli/gateway-supervisor.ts
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
var START_ATTEMPTS = [
  (workspace) => [
    "run",
    "--model",
    "openrouter/moonshotai/kimi-k2.5",
    "--command",
    "miya-gateway-start",
    "--dir",
    workspace
  ],
  (workspace) => [
    "run",
    "--model",
    "opencode/big-pickle",
    "--command",
    "miya-gateway-start",
    "--dir",
    workspace
  ],
  (workspace) => ["run", "--command", "miya-gateway-start", "--dir", workspace]
];
function nowIso() {
  return new Date().toISOString();
}
function getMiyaRuntimeDir(projectDir) {
  const normalized = path.resolve(projectDir);
  if (path.basename(normalized).toLowerCase() === ".opencode") {
    return path.join(normalized, "miya");
  }
  return path.join(normalized, ".opencode", "miya");
}
function runtimeGatewayFile(workspace) {
  return path.join(getMiyaRuntimeDir(workspace), "gateway.json");
}
function runtimeSupervisorFile(workspace) {
  return path.join(getMiyaRuntimeDir(workspace), "gateway-supervisor.json");
}
function runtimeSupervisorStopFile(workspace) {
  return path.join(getMiyaRuntimeDir(workspace), "gateway-supervisor.stop");
}
function runtimeSupervisorLogFile(workspace) {
  return path.join(getMiyaRuntimeDir(workspace), "gateway-supervisor.log");
}
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0)
    return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function readGatewayState(workspace) {
  const file = runtimeGatewayFile(workspace);
  if (!fs.existsSync(file))
    return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const url = String(parsed.url ?? "").trim();
    const pid = Number(parsed.pid);
    if (!url || !Number.isFinite(pid) || pid <= 0)
      return null;
    return { url, pid: Math.floor(pid) };
  } catch {
    return null;
  }
}
async function probeGateway(url, timeoutMs = 1200) {
  const controller = new AbortController;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/api/status`, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
async function isGatewayHealthy(workspace) {
  const state = readGatewayState(workspace);
  if (!state || !isPidAlive(state.pid))
    return false;
  return await probeGateway(state.url);
}
function appendLog(workspace, message) {
  const runtimeDir = getMiyaRuntimeDir(workspace);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const line = `[${nowIso()}] ${message}
`;
  fs.appendFileSync(runtimeSupervisorLogFile(workspace), line, "utf-8");
}
function writeSupervisorState(workspace, patch, baseline) {
  const runtimeDir = getMiyaRuntimeDir(workspace);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const state = {
    ...baseline,
    status: patch.status,
    updatedAt: nowIso(),
    workspace,
    childPid: patch.childPid,
    restartCount: patch.restartCount ?? baseline.restartCount,
    lastError: patch.lastError
  };
  fs.writeFileSync(runtimeSupervisorFile(workspace), `${JSON.stringify(state, null, 2)}
`, "utf-8");
}
function parseCliArgs(argv) {
  let workspace = "";
  for (let i = 0;i < argv.length; i += 1) {
    const current = argv[i] ?? "";
    if (current === "--workspace" && i + 1 < argv.length) {
      workspace = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (current.startsWith("--workspace=")) {
      workspace = current.slice("--workspace=".length);
    }
  }
  return {
    workspace: path.resolve(workspace || process.cwd()),
    verbose: argv.includes("--verbose")
  };
}
function killPid(pid) {
  if (!isPidAlive(pid))
    return;
  try {
    process.kill(pid, "SIGTERM");
    return;
  } catch {}
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      return;
    } catch {}
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}
function terminateChild(child) {
  if (!child || !child.pid || child.exitCode !== null)
    return;
  killPid(child.pid);
}
async function waitReadyOrExit(workspace, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(runtimeSupervisorStopFile(workspace))) {
      return { ready: false, reason: "stop_signal" };
    }
    if (await isGatewayHealthy(workspace)) {
      return { ready: true, reason: "ready" };
    }
    if (child.exitCode !== null) {
      return { ready: false, reason: `opencode_exit_${child.exitCode}` };
    }
    await sleep(400);
  }
  return { ready: false, reason: "gateway_probe_timeout" };
}
async function main() {
  const { workspace, verbose } = parseCliArgs(process.argv.slice(2));
  const runtimeDir = getMiyaRuntimeDir(workspace);
  const stopFile = runtimeSupervisorStopFile(workspace);
  fs.mkdirSync(runtimeDir, { recursive: true });
  try {
    fs.unlinkSync(stopFile);
  } catch {}
  const baseline = {
    pid: process.pid,
    workspace,
    startedAt: nowIso(),
    childPid: undefined,
    restartCount: 0,
    lastError: undefined
  };
  let child = null;
  let stopping = false;
  let attemptIndex = 0;
  let restartCount = 0;
  const stopRequested = () => stopping || fs.existsSync(runtimeSupervisorStopFile(workspace));
  const onStopSignal = (signal) => {
    stopping = true;
    appendLog(workspace, `received ${signal}, stopping supervisor`);
  };
  process.on("SIGTERM", onStopSignal);
  process.on("SIGINT", onStopSignal);
  process.on("SIGHUP", onStopSignal);
  appendLog(workspace, `supervisor_started pid=${process.pid} workspace=${workspace}`);
  writeSupervisorState(workspace, { status: "starting" }, baseline);
  while (!stopRequested()) {
    if (await isGatewayHealthy(workspace)) {
      writeSupervisorState(workspace, {
        status: "running",
        childPid: child?.pid,
        restartCount,
        lastError: undefined
      }, baseline);
      await sleep(1500);
      continue;
    }
    const argsFactory = START_ATTEMPTS[attemptIndex % START_ATTEMPTS.length];
    attemptIndex += 1;
    const opencodeArgs = argsFactory(workspace);
    writeSupervisorState(workspace, {
      status: "starting",
      childPid: undefined,
      restartCount
    }, baseline);
    appendLog(workspace, `starting_opencode attempt=${attemptIndex} cmd=opencode ${opencodeArgs.join(" ")}`);
    child = spawn("opencode", opencodeArgs, {
      cwd: workspace,
      stdio: verbose ? ["ignore", "pipe", "pipe"] : "ignore",
      windowsHide: true
    });
    if (verbose && child.stdout) {
      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        process.stdout.write(text);
        appendLog(workspace, `opencode.stdout ${text.trim()}`);
      });
    }
    if (verbose && child.stderr) {
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        process.stderr.write(text);
        appendLog(workspace, `opencode.stderr ${text.trim()}`);
      });
    }
    const waited = await waitReadyOrExit(workspace, child, 30000);
    if (waited.ready) {
      restartCount = 0;
      writeSupervisorState(workspace, {
        status: "running",
        childPid: child.pid,
        restartCount,
        lastError: undefined
      }, baseline);
      appendLog(workspace, `gateway_ready pid=${String(child.pid ?? "")} attempt=${attemptIndex}`);
      continue;
    }
    const reason = waited.reason;
    terminateChild(child);
    child = null;
    restartCount += 1;
    const backoffMs = Math.min(30000, 1000 * 2 ** Math.min(restartCount, 5));
    appendLog(workspace, `gateway_start_failed reason=${reason} restartCount=${restartCount} backoffMs=${backoffMs}`);
    writeSupervisorState(workspace, {
      status: "backoff",
      restartCount,
      lastError: reason
    }, baseline);
    await sleep(backoffMs);
  }
  writeSupervisorState(workspace, {
    status: "stopping",
    childPid: child?.pid,
    restartCount
  }, baseline);
  terminateChild(child);
  child = null;
  writeSupervisorState(workspace, {
    status: "stopped",
    restartCount
  }, baseline);
  appendLog(workspace, "supervisor_stopped");
}
main().catch((error) => {
  const { workspace } = parseCliArgs(process.argv.slice(2));
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  appendLog(workspace, `supervisor_failed error=${message}`);
  try {
    const file = runtimeSupervisorFile(workspace);
    fs.writeFileSync(file, `${JSON.stringify({
      pid: process.pid,
      status: "failed",
      workspace,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      restartCount: 0,
      lastError: message
    }, null, 2)}
`, "utf-8");
  } catch {}
  process.exit(1);
});
