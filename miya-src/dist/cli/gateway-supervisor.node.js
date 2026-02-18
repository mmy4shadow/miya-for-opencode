#!/usr/bin/env node

// src/cli/gateway-supervisor.ts
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
function resolveGatewayWorkerScript(workspace) {
  const bundled = fileURLToPath(new URL("./gateway-worker.node.js", import.meta.url));
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  const fallbackCandidates = [
    path.join(workspace, "miya-src", "src", "cli", "gateway-worker.ts"),
    path.join(workspace, "src", "cli", "gateway-worker.ts")
  ];
  for (const candidate of fallbackCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
function resolveBunBin() {
  const bunBin = String(process.env.MIYA_GATEWAY_BUN_BIN ?? "bun").trim();
  if (!bunBin)
    return null;
  const probe = spawnSync(bunBin, ["--version"], {
    stdio: "ignore",
    windowsHide: true
  });
  if (probe.error || probe.status !== 0) {
    return null;
  }
  return bunBin;
}
function resolveStartAttempts(workspace, verbose) {
  const attempts = [];
  const workerScript = resolveGatewayWorkerScript(workspace);
  const bunBin = resolveBunBin();
  if (workerScript && bunBin) {
    attempts.push({
      bin: bunBin,
      args: [
        workerScript,
        "--workspace",
        workspace,
        ...verbose ? ["--verbose"] : []
      ],
      label: `bun ${workerScript} --workspace ${workspace}${verbose ? " --verbose" : ""}`
    });
  }
  attempts.push({
    bin: "opencode",
    args: [
      "run",
      "--model",
      "openrouter/moonshotai/kimi-k2.5",
      "--command",
      "miya-gateway-start",
      "--dir",
      workspace
    ],
    label: `opencode run --model openrouter/moonshotai/kimi-k2.5 --command miya-gateway-start --dir ${workspace}`
  }, {
    bin: "opencode",
    args: [
      "run",
      "--model",
      "opencode/big-pickle",
      "--command",
      "miya-gateway-start",
      "--dir",
      workspace
    ],
    label: `opencode run --model opencode/big-pickle --command miya-gateway-start --dir ${workspace}`
  }, {
    bin: "opencode",
    args: ["run", "--command", "miya-gateway-start", "--dir", workspace],
    label: `opencode run --command miya-gateway-start --dir ${workspace}`
  });
  return attempts;
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
  const resolvedInput = path.resolve(workspace || process.cwd());
  let resolvedWorkspace = resolvedInput;
  if (path.basename(resolvedInput).toLowerCase() === "miya-src") {
    const parent = path.dirname(resolvedInput);
    if (path.basename(parent).toLowerCase() === ".opencode") {
      resolvedWorkspace = parent;
    }
  } else {
    const embeddedOpencode = path.join(resolvedInput, ".opencode");
    if (fs.existsSync(path.join(embeddedOpencode, "miya-src", "src", "index.ts"))) {
      resolvedWorkspace = embeddedOpencode;
    }
  }
  return {
    workspace: resolvedWorkspace,
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
      return { ready: false, reason: `child_exit_${child.exitCode}` };
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
  const startAttempts = resolveStartAttempts(workspace, verbose);
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
    if (child && child.exitCode === null) {
      appendLog(workspace, `gateway_unhealthy_with_live_child pid=${child.pid ?? 0} -> restarting worker`);
      terminateChild(child);
      child = null;
      await sleep(500);
    }
    const attempt = startAttempts[attemptIndex % startAttempts.length];
    attemptIndex += 1;
    writeSupervisorState(workspace, {
      status: "starting",
      childPid: undefined,
      restartCount
    }, baseline);
    appendLog(workspace, `starting_gateway attempt=${attemptIndex} cmd=${attempt.label}`);
    child = spawn(attempt.bin, attempt.args, {
      cwd: workspace,
      stdio: verbose ? ["ignore", "pipe", "pipe"] : "ignore",
      windowsHide: true
    });
    if (verbose && child.stdout) {
      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        process.stdout.write(text);
        appendLog(workspace, `child.stdout ${text.trim()}`);
      });
    }
    if (verbose && child.stderr) {
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        process.stderr.write(text);
        appendLog(workspace, `child.stderr ${text.trim()}`);
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
