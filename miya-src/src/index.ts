import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ToolDefinition } from '@opencode-ai/plugin';
import { getAgentConfigs } from './agents';
import { MiyaAutomationService } from './automation';
import { preparePlanBundleBinding, readPlanBundleBinding } from './autopilot';
import { BackgroundTaskManager, TmuxSessionManager } from './background';
import { loadPluginConfig, type TmuxConfig } from './config';
import { parseList } from './config/agent-mcps';
import {
  extractAgentModelSelectionsFromEvent,
  extractAgentRuntimeSelectionsFromCommandEvent,
  persistAgentRuntimeSelection,
  readPersistedAgentRuntime,
  syncPersistedAgentRuntimeFromOpenCodeState,
} from './config/agent-model-persistence';
import { appendProviderOverrideAudit } from './config/provider-override-audit';
import { mergePluginAgentConfigs } from './config/runtime-merge';
import { assertRequiredHookHandlers } from './contracts/hook-contract';
import {
  adaptPermissionLifecycle,
  PERMISSION_OBSERVED_HOOK,
} from './contracts/permission-events';
import {
  ensureMiyaLauncher,
  getLauncherDaemonSnapshot,
  subscribeLauncherEvents,
} from './daemon';
import {
  buildGatewayLaunchUrl,
  createGatewayTools,
  ensureGatewayRunning,
  type GatewayState,
  isGatewayOwner,
  probeGatewayAlive,
  registerGatewayDependencies,
} from './gateway';
import {
  createContextGovernorHook,
  createLoopGuardHook,
  createMemoryWeaverHook,
  createModeKernelHook,
  createPersistentAutoflowHook,
  createPhaseReminderHook,
  createPostReadNudgeHook,
  createPostWriteSimplicityHook,
  createPsycheToneHook,
  createSlashCommandBridgeHook,
} from './hooks';
import { createIntakeTools } from './intake';
import {
  shouldInterceptWriteAfterWebsearch,
  trackWebsearchToolOutput,
} from './intake/websearch-guard';
import { createBuiltinMcps } from './mcp';
import { createSafetyTools, handlePermissionAsk } from './safety';
import { createConfigTools } from './settings';
import {
  ast_grep_replace,
  ast_grep_search,
  createAutoflowTools,
  createAutomationTools,
  createAutopilotTools,
  createBackgroundTools,
  createCapabilityTools,
  createLearningTools,
  createMcpTools,
  createMultimodalTools,
  createNodeTools,
  createRalphTools,
  createRouterTools,
  createSoulTools,
  createUltraworkTools,
  createWorkflowTools,
  grep,
  lsp_diagnostics,
  lsp_find_references,
  lsp_goto_definition,
  lsp_rename,
} from './tools';
import { startTmuxCheck } from './utils';
import { log } from './utils/logger';
import { getMiyaRuntimeDir } from './workflow';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shouldSyncModelStateFromEventType(eventType: string): boolean {
  if (!eventType) return false;
  // Avoid high-frequency message streams while still covering command/session/settings/model/agent updates.
  return /(^|\.)(command|session|agent|settings|config|model)(\.|$)/i.test(
    eventType,
  );
}

function deepMergeObject(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMergeObject(baseValue, overrideValue);
      continue;
    }
    result[key] = overrideValue;
  }
  return result;
}

const autoUiOpenAtByDir = new Map<string, number>();
const dockLaunchAtByDir = new Map<string, number>();
const gatewayConsoleLaunchAtByDir = new Map<string, number>();

function autoUiOpenGuardFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'ui-auto-open.guard.json');
}

function dockLaunchGuardFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'dock-launch.guard.json');
}

function readLastAutoUiOpenAt(projectDir: string): number {
  const file = autoUiOpenGuardFile(projectDir);
  if (!fs.existsSync(file)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      atMs?: unknown;
    };
    const atMs = Number(parsed?.atMs ?? 0);
    return Number.isFinite(atMs) ? atMs : 0;
  } catch {
    return 0;
  }
}

function writeLastAutoUiOpenAt(projectDir: string, atMs: number): void {
  const file = autoUiOpenGuardFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ atMs, pid: process.pid, at: new Date(atMs).toISOString() }, null, 2)}\n`,
    'utf-8',
  );
}

function readLastDockLaunchAt(projectDir: string): number {
  const file = dockLaunchGuardFile(projectDir);
  if (!fs.existsSync(file)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      atMs?: unknown;
    };
    const atMs = Number(parsed?.atMs ?? 0);
    return Number.isFinite(atMs) ? atMs : 0;
  } catch {
    return 0;
  }
}

function writeLastDockLaunchAt(projectDir: string, atMs: number): void {
  const file = dockLaunchGuardFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ atMs, pid: process.pid, at: new Date(atMs).toISOString() }, null, 2)}\n`,
    'utf-8',
  );
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function openUrlSilently(url: string): void {
  if (process.platform === 'win32') {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    const child = spawn('open', [url], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function normalizeServerUrl(serverUrl: URL | string | undefined): URL | null {
  if (!serverUrl) return null;
  try {
    if (serverUrl instanceof URL) return new URL(serverUrl.toString());
    return new URL(String(serverUrl));
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1'
  );
}

async function probeHttpUrl(url: string, timeoutMs = 1_200): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
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

async function isServerUrlReachable(serverUrl: URL): Promise<boolean> {
  const protocol = serverUrl.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  const host = serverUrl.hostname.toLowerCase();
  if (host === 'opencode.internal') return false;
  if (isLoopbackHost(host)) {
    return probeHttpUrl(new URL('/health', serverUrl).toString(), 1_200);
  }
  return probeHttpUrl(new URL('/health', serverUrl).toString(), 1_800);
}

async function resolveAutoUiLaunchUrl(input: {
  serverUrl?: URL | string;
  gatewayUiUrl: string;
  gatewayAuthToken?: string;
}): Promise<{ launchUrl: string; publicUrl: string }> {
  const mode = String(process.env.MIYA_UI_LAUNCH_MODE ?? 'proxy')
    .trim()
    .toLowerCase();
  const server = normalizeServerUrl(input.serverUrl);
  if (mode !== 'gateway' && server && (await isServerUrlReachable(server))) {
    const proxyUrl = new URL('/miya/', server).toString();
    return { launchUrl: proxyUrl, publicUrl: proxyUrl };
  }
  const launchUrl = buildGatewayLaunchUrl({
    url: input.gatewayUiUrl,
    authToken: input.gatewayAuthToken,
  });
  return {
    launchUrl,
    publicUrl: input.gatewayUiUrl,
  };
}

function launchDockSilently(projectDir: string): void {
  if (process.platform !== 'win32') return;
  const now = Date.now();
  const lastAtInProcess = dockLaunchAtByDir.get(projectDir) ?? 0;
  const lastAtCrossProcess = readLastDockLaunchAt(projectDir);
  const lastAt = Math.max(lastAtInProcess, lastAtCrossProcess);
  if (now - lastAt < 30_000) return;
  const pidFile = path.join(
    projectDir,
    'miya-src',
    'tools',
    'miya-dock',
    'miya-dock.pid',
  );
  if (fs.existsSync(pidFile)) {
    try {
      const pid = Number(fs.readFileSync(pidFile, 'utf-8').trim());
      if (isPidAlive(pid)) return;
    } catch {}
  }
  const ps1 = path.join(
    projectDir,
    'miya-src',
    'tools',
    'miya-dock',
    'miya-dock.ps1',
  );
  if (!fs.existsSync(ps1)) return;
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      ps1,
      '-ProjectRoot',
      projectDir,
    ],
    {
      cwd: projectDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  dockLaunchAtByDir.set(projectDir, now);
  writeLastDockLaunchAt(projectDir, now);
  child.unref();
}

function canAutoOpenUi(projectDir: string, cooldownMs: number): boolean {
  const last = autoUiOpenAtByDir.get(projectDir) ?? 0;
  const persistedLast = readLastAutoUiOpenAt(projectDir);
  const now = Date.now();
  const minCooldownMs = Math.max(10_000, Math.min(cooldownMs, 24 * 60_000));
  if (now - last < 10_000) return false;
  if (now - persistedLast < minCooldownMs) return false;
  return true;
}

function markAutoUiOpened(projectDir: string, atMs = Date.now()): void {
  autoUiOpenAtByDir.set(projectDir, atMs);
  writeLastAutoUiOpenAt(projectDir, atMs);
}

function scheduleAutoUiOpen(
  projectDir: string,
  launchUrl: string,
  publicUrl: string,
  url: string,
  cooldownMs: number,
  dockAutoLaunch: boolean,
): void {
  const maxAttempts = 6;
  const retryDelayMs = 1_000;
  const openWhenHealthy = async (attempt: number): Promise<void> => {
    const healthy = await probeGatewayAlive(url, 1_500);
    if (!healthy) {
      if (attempt < maxAttempts) {
        log('[miya] auto ui open deferred: gateway unhealthy', {
          url,
          attempt,
          maxAttempts,
          retryDelayMs,
        });
        setTimeout(() => {
          void openWhenHealthy(attempt + 1);
        }, retryDelayMs);
      } else {
        log('[miya] auto ui open skipped: gateway unhealthy after retries', {
          url,
          attempt,
          maxAttempts,
        });
      }
      return;
    }
    if (dockAutoLaunch) {
      launchDockSilently(projectDir);
    }
    openUrlSilently(launchUrl);
    markAutoUiOpened(projectDir);
    log('[miya] auto ui open triggered', {
      url: publicUrl,
      dockAutoLaunch,
      cooldownMs,
      attempt,
      maxAttempts,
    });
  };
  setTimeout(() => {
    void openWhenHealthy(1).catch((error) => {
      log('[miya] auto ui open failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 1_200);
}

function scheduleAutoUiOpenFromRuntimeState(
  projectDir: string,
  cooldownMs: number,
  dockAutoLaunch: boolean,
  serverUrl?: URL | string,
): void {
  const maxAttempts = 20;
  const retryDelayMs = 1_500;
  const poll = async (attempt: number): Promise<void> => {
    const state = readRuntimeGatewayState(projectDir);
    if (state) {
      const healthy = await probeGatewayAlive(state.url, 1_200);
      if (healthy && shouldAutoOpenUi(projectDir, cooldownMs)) {
        const resolvedLaunch = await resolveAutoUiLaunchUrl({
          serverUrl,
          gatewayUiUrl: state.uiUrl,
          gatewayAuthToken: state.authToken,
        });
        scheduleAutoUiOpen(
          projectDir,
          resolvedLaunch.launchUrl,
          resolvedLaunch.publicUrl,
          state.url,
          cooldownMs,
          dockAutoLaunch,
        );
        return;
      }
    }
    if (attempt >= maxAttempts) {
      log('[miya] deferred auto ui open skipped: gateway never became ready', {
        projectDir,
        cooldownMs,
        maxAttempts,
      });
      return;
    }
    setTimeout(() => {
      void poll(attempt + 1);
    }, retryDelayMs);
  };
  setTimeout(() => {
    void poll(1).catch((error) => {
      log('[miya] deferred auto ui open failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 800);
}

function shouldAutoOpenUi(projectDir: string, cooldownMs: number): boolean {
  return canAutoOpenUi(projectDir, cooldownMs);
}

function isInteractiveSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRuntimeGatewayState(projectDir: string): GatewayState | null {
  const file = path.join(getMiyaRuntimeDir(projectDir), 'gateway.json');
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      url?: unknown;
      uiUrl?: unknown;
      port?: unknown;
      pid?: unknown;
      startedAt?: unknown;
      status?: unknown;
      authToken?: unknown;
    };
    const url = String(parsed.url ?? '').trim();
    if (!url) return null;
    const uiUrl = String(parsed.uiUrl ?? url).trim() || url;
    const port = Number(parsed.port);
    const pid = Number(parsed.pid);
    const startedAt = String(parsed.startedAt ?? '').trim();
    const status = String(parsed.status ?? '').trim().toLowerCase();
    const authToken =
      typeof parsed.authToken === 'string' && parsed.authToken.trim().length > 0
        ? parsed.authToken.trim()
        : undefined;
    if (
      !Number.isFinite(port) ||
      !Number.isFinite(pid) ||
      !startedAt ||
      (status !== 'running' && status !== 'killswitch')
    ) {
      return null;
    }
    return {
      url,
      uiUrl,
      port: Math.floor(port),
      pid: Math.floor(pid),
      startedAt,
      status: status === 'killswitch' ? 'killswitch' : 'running',
      authToken,
    };
  } catch {
    return null;
  }
}

interface GatewaySupervisorState {
  pid: number;
  status: string;
}

function runtimeGatewaySupervisorFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway-supervisor.json');
}

function runtimeGatewaySupervisorStopFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway-supervisor.stop');
}

function runtimeGatewayBootstrapLogFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway-bootstrap.log');
}

function appendGatewayBootstrapLog(projectDir: string, message: string): void {
  try {
    fs.mkdirSync(getMiyaRuntimeDir(projectDir), { recursive: true });
    fs.appendFileSync(
      runtimeGatewayBootstrapLogFile(projectDir),
      `[${new Date().toISOString()}] ${message}\n`,
      'utf-8',
    );
  } catch {}
}

function gatewayGlobalStateFile(): string {
  if (process.platform === 'win32') {
    const appData =
      String(process.env.APPDATA ?? '').trim() ||
      path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'miya', 'gateway.json');
  }
  return path.join(os.homedir(), '.config', 'miya', 'gateway.json');
}

function readGlobalGatewayState(): GatewayState | null {
  const file = gatewayGlobalStateFile();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      http?: unknown;
      pid?: unknown;
      startedAt?: unknown;
    };
    const url = String(parsed.http ?? '').trim();
    const pid = Number(parsed.pid);
    const startedAt = String(parsed.startedAt ?? '').trim();
    if (!url || !Number.isFinite(pid) || pid <= 0 || !startedAt) return null;
    const parsedUrl = new URL(url);
    const port = Number(parsedUrl.port);
    if (!Number.isFinite(port) || port <= 0) return null;
    return {
      url,
      uiUrl: url,
      port: Math.floor(port),
      pid: Math.floor(pid),
      startedAt,
      status: 'running',
      authToken: undefined,
    };
  } catch {
    return null;
  }
}

function readGatewaySupervisorState(
  projectDir: string,
): GatewaySupervisorState | null {
  const file = runtimeGatewaySupervisorFile(projectDir);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      pid?: unknown;
      status?: unknown;
    };
    const pid = Number(parsed.pid);
    const status = String(parsed.status ?? '').trim().toLowerCase();
    if (!Number.isFinite(pid) || pid <= 0 || !status) return null;
    return { pid: Math.floor(pid), status };
  } catch {
    return null;
  }
}

function resolveGatewaySupervisorScript(projectDir: string): string | null {
  const bundled = fileURLToPath(
    new URL('./cli/gateway-supervisor.node.js', import.meta.url),
  );
  if (fs.existsSync(bundled)) return bundled;
  const candidates = [
    path.join(projectDir, 'miya-src', 'dist', 'cli', 'gateway-supervisor.node.js'),
    path.join(projectDir, 'dist', 'cli', 'gateway-supervisor.node.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveGatewaySupervisorNodeBin(): string | null {
  const candidates = [
    String(process.env.MIYA_GATEWAY_NODE_BIN ?? '').trim(),
    'node',
    'bun',
    /(node|bun)(\.exe)?$/i.test(path.basename(process.execPath))
      ? process.execPath
      : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate, ['-e', 'process.exit(0)'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if (!probe.error && probe.status === 0) return candidate;
    } catch {}
  }
  return null;
}

function startGatewaySupervisorDetached(projectDir: string): boolean {
  const script = resolveGatewaySupervisorScript(projectDir);
  const nodeBin = resolveGatewaySupervisorNodeBin();
  if (!script || !nodeBin) {
    appendGatewayBootstrapLog(
      projectDir,
      `detached_start_skipped script=${Boolean(script)} node=${nodeBin ?? 'missing'}`,
    );
    return false;
  }
  try {
    fs.unlinkSync(runtimeGatewaySupervisorStopFile(projectDir));
  } catch {}
  const child = spawn(nodeBin, [script, '--workspace', projectDir], {
    cwd: projectDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  appendGatewayBootstrapLog(
    projectDir,
    `detached_start pid=${child.pid ?? 0} cmd=${nodeBin} ${script} --workspace ${projectDir}`,
  );
  return true;
}

function shouldUseVisibleGatewayConsole(): boolean {
  if (process.platform !== 'win32') return false;
  const raw = String(process.env.MIYA_GATEWAY_CONSOLE_VISIBLE ?? '1')
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function startGatewaySupervisorVisibleConsole(projectDir: string): boolean {
  if (!shouldUseVisibleGatewayConsole()) return false;
  const script = resolveGatewaySupervisorScript(projectDir);
  const nodeBin = resolveGatewaySupervisorNodeBin();
  if (!script || !nodeBin) {
    appendGatewayBootstrapLog(
      projectDir,
      `visible_console_skipped script=${Boolean(script)} node=${nodeBin ?? 'missing'}`,
    );
    return false;
  }

  const now = Date.now();
  const lastAt = gatewayConsoleLaunchAtByDir.get(projectDir) ?? 0;
  if (now - lastAt < 15_000) return false;

  try {
    fs.unlinkSync(runtimeGatewaySupervisorStopFile(projectDir));
  } catch {}

  try {
    const inner = `title miya-gateway && "${nodeBin}" "${script}" --workspace "${projectDir}" --verbose`;
    const child = spawn(
      'cmd.exe',
      ['/d', '/c', 'start', '"miya-gateway"', 'cmd.exe', '/d', '/k', inner],
      {
        cwd: projectDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      },
    );
    child.unref();
    gatewayConsoleLaunchAtByDir.set(projectDir, now);
    appendGatewayBootstrapLog(
      projectDir,
      `visible_console_start pid=${child.pid ?? 0} cmd=${nodeBin} ${script} --workspace ${projectDir} --verbose`,
    );
    return true;
  } catch (error) {
    appendGatewayBootstrapLog(
      projectDir,
      `visible_console_failed error=${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function waitGatewayRuntimeHealthy(
  projectDir: string,
  timeoutMs = 12_000,
): Promise<GatewayState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readRuntimeGatewayState(projectDir);
    if (state && isPidAlive(state.pid)) {
      const healthy = await probeGatewayAlive(state.url, 1_000);
      if (healthy) return state;
    }
    const globalState = readGlobalGatewayState();
    if (globalState && isPidAlive(globalState.pid)) {
      const healthy = await probeGatewayAlive(globalState.url, 1_000);
      if (healthy) return globalState;
    }
    await sleep(400);
  }
  return null;
}

function terminatePid(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
    return;
  } catch {}
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    } catch {}
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}

async function ensureGatewayBackgroundSupervisor(
  projectDir: string,
): Promise<GatewayState | null> {
  if (process.env.MIYA_GATEWAY_BACKGROUND_ENABLE === '0') return null;
  const existing = await waitGatewayRuntimeHealthy(projectDir, 1_000);
  if (existing) return existing;

  const supervisor = readGatewaySupervisorState(projectDir);
  let restartSupervisor = false;
  if (supervisor && isPidAlive(supervisor.pid)) {
    const lateHealthy = await waitGatewayRuntimeHealthy(projectDir, 3_000);
    if (lateHealthy) return lateHealthy;
    appendGatewayBootstrapLog(
      projectDir,
      `stale_supervisor_detected pid=${supervisor.pid} status=${supervisor.status}`,
    );
    terminatePid(supervisor.pid);
    restartSupervisor = true;
  }
  if (restartSupervisor || !supervisor || !isPidAlive(supervisor.pid)) {
    const started =
      startGatewaySupervisorVisibleConsole(projectDir) ||
      startGatewaySupervisorDetached(projectDir);
    if (!started) {
      appendGatewayBootstrapLog(projectDir, 'supervisor_start_failed');
      return null;
    }
  }

  return await waitGatewayRuntimeHealthy(projectDir, 15_000);
}

async function attachGatewayWithRetry(projectDir: string): Promise<{
  attached: boolean;
  owner: boolean;
  state?: GatewayState;
  error?: string;
}> {
  const externalState = await ensureGatewayBackgroundSupervisor(projectDir);
  if (externalState) {
    return {
      attached: true,
      owner: false,
      state: externalState,
    };
  }
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const state = ensureGatewayRunning(projectDir);
      return {
        attached: true,
        owner: isGatewayOwner(projectDir),
        state,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const ownerRace =
        message === 'gateway_owned_by_other_process' ||
        message.includes('gateway-owner.json.tmp') ||
        message.includes('EPERM: operation not permitted');

      if (!ownerRace || attempt >= maxAttempts) {
        return {
          attached: false,
          owner: false,
          error: message,
        };
      }

      const fallbackState = readRuntimeGatewayState(projectDir);
      if (fallbackState) {
        const healthy = await probeGatewayAlive(fallbackState.url, 1_000);
        if (healthy) {
          return {
            attached: true,
            owner: false,
            state: fallbackState,
          };
        }
      }

      await sleep(800);
    }
  }
  return {
    attached: false,
    owner: false,
    error: 'gateway_attach_retry_exhausted',
  };
}

function parseToolMode(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  const value = (args as Record<string, unknown>).mode;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isAutonomousTool(tool: string): boolean {
  return tool === 'miya_autopilot' || tool === 'miya_autoflow';
}

function isAutonomousReadOnlyMode(tool: string, args: unknown): boolean {
  const mode = parseToolMode(args);
  if (tool === 'miya_autopilot') {
    return mode === 'status' || mode === 'stats';
  }
  if (tool === 'miya_autoflow') {
    return mode === 'status';
  }
  return false;
}

function isAutonomousRunTool(tool: string, args: unknown): boolean {
  if (!isAutonomousTool(tool)) return false;
  const mode = parseToolMode(args);
  if (tool === 'miya_autopilot') {
    return mode === 'run';
  }
  // miya_autoflow defaults to run mode when omitted.
  return mode === '' || mode === 'run';
}

const MiyaPlugin: Plugin = async (ctx) => {
  try {
    const synced = syncPersistedAgentRuntimeFromOpenCodeState(ctx.directory);
    if (synced) {
      log('[model-persistence] synchronized from opencode state on startup');
    }
  } catch (error) {
    log('[model-persistence] startup sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const config = loadPluginConfig(ctx.directory);
  const agents = getAgentConfigs(config, ctx.directory);

  // Parse tmux config with defaults
  const tmuxConfig: TmuxConfig = {
    enabled: config.tmux?.enabled ?? false,
    layout: config.tmux?.layout ?? 'main-vertical',
    main_pane_size: config.tmux?.main_pane_size ?? 60,
  };

  log('[plugin] initialized with tmux config', {
    tmuxConfig,
    rawTmuxConfig: config.tmux,
    directory: ctx.directory,
  });

  // Start background tmux check if enabled
  if (tmuxConfig.enabled) {
    startTmuxCheck();
  }

  const backgroundManager = new BackgroundTaskManager(ctx, tmuxConfig, config);
  const gatewayAttach = await attachGatewayWithRetry(ctx.directory);
  const gatewayOwner = gatewayAttach.owner;
  const gatewayState = gatewayAttach.state;
  if (gatewayAttach.attached && gatewayState) {
    log('[gateway] startup attached', {
      directory: ctx.directory,
      gatewayOwner,
      gatewayUrl: gatewayState.url,
    });
  } else {
    log('[gateway] startup attach failed', {
      directory: ctx.directory,
      error: gatewayAttach.error ?? 'gateway_attach_unknown_failure',
    });
  }
  const dashboardConfig =
    ((config.ui as Record<string, unknown> | undefined)?.dashboard as
      | Record<string, unknown>
      | undefined) ?? {};
  const autoOpenEnabled = dashboardConfig.openOnStart !== false;
  const autoOpenEnabledResolved = autoOpenEnabled;
  const autoOpenBlockedByEnv = process.env.MIYA_AUTO_UI_OPEN === '0';
  const autoOpenCooldownMs =
    typeof dashboardConfig.autoOpenCooldownMs === 'number'
      ? Math.max(
          10_000,
          Math.min(
            24 * 60_000,
            Math.floor(Number(dashboardConfig.autoOpenCooldownMs)),
          ),
        )
      : 15_000;
  const dockAutoLaunch =
    process.env.MIYA_DOCK_AUTO_LAUNCH === '1' ||
    (process.env.MIYA_DOCK_AUTO_LAUNCH !== '0' &&
      dashboardConfig.dockAutoLaunch !== false);
  const interactiveSession = isInteractiveSession();

  if (
    autoOpenEnabled &&
    autoOpenEnabledResolved &&
    !autoOpenBlockedByEnv &&
    shouldAutoOpenUi(ctx.directory, autoOpenCooldownMs) &&
    gatewayState
  ) {
    const resolvedLaunch = await resolveAutoUiLaunchUrl({
      serverUrl: ctx.serverUrl,
      gatewayUiUrl: gatewayState.uiUrl,
      gatewayAuthToken: gatewayState.authToken,
    });
    scheduleAutoUiOpen(
      ctx.directory,
      resolvedLaunch.launchUrl,
      resolvedLaunch.publicUrl,
      gatewayState.url,
      autoOpenCooldownMs,
      dockAutoLaunch,
    );
  } else {
    log('[miya] auto ui open skipped', {
      autoOpenEnabled,
      autoOpenEnabledResolved,
      autoOpenBlockedByEnv,
      interactiveSession,
      cooldownMs: autoOpenCooldownMs,
      hasGatewayState: Boolean(gatewayState),
      gatewayOwner,
    });
    if (
      autoOpenEnabled &&
      autoOpenEnabledResolved &&
      !autoOpenBlockedByEnv &&
      !gatewayState
    ) {
      scheduleAutoUiOpenFromRuntimeState(
        ctx.directory,
        autoOpenCooldownMs,
        dockAutoLaunch,
        ctx.serverUrl,
      );
    }
  }

  if (gatewayOwner) {
    const daemonLaunch = ensureMiyaLauncher(ctx.directory);
    log('[miya-launcher] daemon bootstrap', daemonLaunch);
    setTimeout(async () => {
      try {
        const daemon = getLauncherDaemonSnapshot(ctx.directory);
        await ctx.client.tui.showToast({
          query: { directory: ctx.directory },
          body: {
            title: 'Miya',
            message: daemon.connected
              ? 'Miya Daemon Connected'
              : daemon.statusText || 'Miya Daemon Connecting',
            variant: daemon.connected ? 'success' : 'info',
            duration: 3000,
          },
        });
      } catch {}
    }, 4000);
    subscribeLauncherEvents(ctx.directory, (event) => {
      if (event.type !== 'job.progress') return;
      const status = String(event.payload?.status ?? '')
        .trim()
        .toLowerCase();
      if (
        status !== 'completed' &&
        status !== 'failed' &&
        status !== 'degraded' &&
        status !== 'canceled'
      ) {
        return;
      }
      const jobID = String(
        event.payload?.jobID ?? event.snapshot.activeJobID ?? '',
      ).trim();
      const phase = String(event.payload?.phase ?? '').trim();
      const progress = Number(event.payload?.progress ?? 0);
      const messageParts = [`job=${jobID || 'unknown'}`, `status=${status}`];
      if (phase) messageParts.push(`phase=${phase}`);
      if (Number.isFinite(progress))
        messageParts.push(`progress=${Math.floor(progress)}%`);
      void ctx.client.tui
        .showToast({
          query: { directory: ctx.directory },
          body: {
            title: 'Miya Job',
            message: messageParts.join(' | '),
            variant:
              status === 'completed'
                ? 'success'
                : status === 'failed'
                  ? 'error'
                  : 'info',
            duration: 3500,
          },
        })
        .catch(() => {});
    });
  } else {
    log('[miya] follower instance detected; skip daemon bootstrap/toast', {
      directory: ctx.directory,
    });
  }
  const automationService = new MiyaAutomationService(ctx.directory);
  if (gatewayOwner) {
    automationService.start();
  }
  registerGatewayDependencies(ctx.directory, {
    client: ctx.client,
    backgroundManager,
    automationService,
    extraSkillDirs: [],
  });

  const backgroundTools = createBackgroundTools(
    ctx,
    backgroundManager,
    tmuxConfig,
    config,
  );
  const automationTools = createAutomationTools(automationService);
  const workflowTools = createWorkflowTools(ctx.directory);
  const learningTools = createLearningTools(ctx.directory);
  const autopilotTools = createAutopilotTools(ctx.directory);
  const autoflowTools = createAutoflowTools(ctx.directory, backgroundManager);
  const ralphTools = createRalphTools(ctx.directory);
  const nodeTools = createNodeTools(ctx.directory);
  const multimodalTools = createMultimodalTools(ctx.directory);
  const soulTools = createSoulTools(ctx.directory);
  const ultraworkTools = createUltraworkTools(ctx, backgroundManager);
  const routerTools = createRouterTools(ctx.directory);
  const mcpTools = createMcpTools();
  const safetyTools = createSafetyTools(ctx);
  const configTools = createConfigTools(ctx);
  const intakeTools = createIntakeTools(ctx);
  const gatewayTools = createGatewayTools(ctx);
  let toolCatalog: Record<string, ToolDefinition> = {
    ...backgroundTools,
    ...automationTools,
    ...workflowTools,
    ...learningTools,
    ...autopilotTools,
    ...autoflowTools,
    ...ralphTools,
    ...nodeTools,
    ...multimodalTools,
    ...soulTools,
    ...ultraworkTools,
    ...routerTools,
    ...mcpTools,
    ...safetyTools,
    ...configTools,
    ...intakeTools,
    ...gatewayTools,
    lsp_goto_definition,
    lsp_find_references,
    lsp_diagnostics,
    lsp_rename,
    grep,
    ast_grep_search,
    ast_grep_replace,
  };
  const capabilityTools = createCapabilityTools(() => Object.keys(toolCatalog));
  toolCatalog = {
    ...toolCatalog,
    ...capabilityTools,
  };
  // Stability-first default: keep plugin-hosted remote MCPs disabled unless explicitly enabled
  // by setting disabled_mcps in config (remove entries you want to use).
  const defaultDisabledMcps: string[] = [];
  const disabledMcps = config.disabled_mcps ?? defaultDisabledMcps;
  const mcps = createBuiltinMcps(disabledMcps);

  // Initialize TmuxSessionManager to handle OpenCode's built-in Task tool sessions
  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig);

  // Initialize loop guard hook for hard iteration limits and strict mode.
  const loopGuardHook = createLoopGuardHook(ctx.directory);
  const persistentAutoflowHook = createPersistentAutoflowHook(
    ctx.directory,
    backgroundManager,
  );

  // Initialize phase reminder hook for workflow compliance
  const phaseReminderHook = createPhaseReminderHook();

  // Bridge typed slash commands (eg. /miya-gateway-start) in case they are sent as plain prompts.
  const slashCommandBridgeHook = createSlashCommandBridgeHook();

  // Initialize post-read nudge hook
  const postReadNudgeHook = createPostReadNudgeHook();
  const postWriteSimplicityHook = createPostWriteSimplicityHook();
  const modeKernelHook = createModeKernelHook();
  const memoryWeaverHook = createMemoryWeaverHook(ctx.directory);
  const psycheToneHook = createPsycheToneHook();
  const contextGovernorHook = createContextGovernorHook(
    config.contextGovernance,
  );
  const chatTransformPipeline = [
    slashCommandBridgeHook,
    loopGuardHook,
    phaseReminderHook,
    modeKernelHook,
    memoryWeaverHook,
    psycheToneHook,
    contextGovernorHook,
  ];
  const slimCompatEnabled = config.slimCompat?.enabled ?? false;
  const postWriteSimplicityEnabled =
    slimCompatEnabled &&
    (config.slimCompat?.enablePostWriteSimplicityNudge ?? false);

  const onPermissionAsked = async (
    input: {
      sessionID?: string;
      type?: string;
      pattern?: string[] | string;
      metadata?: unknown;
      messageID?: string;
      callID?: string;
    },
    output: { status?: 'allow' | 'ask' | 'deny' },
  ) => {
    const lifecycle = adaptPermissionLifecycle(input, output);
    log('[miya] permission.asked adapted', lifecycle.asked);
    log('[miya] permission.replied adapted', lifecycle.replied);
  };

  const onToolExecuteBefore = async (
    input: {
      tool?: string;
      sessionID?: string;
      callID?: string;
    },
    output: { args?: unknown },
  ) => {
    const tool = String(input.tool ?? '');
    const sessionID = String(input.sessionID ?? 'main');
    const callID = typeof input.callID === 'string' ? input.callID : undefined;
    const argObject =
      output.args &&
      typeof output.args === 'object' &&
      !Array.isArray(output.args)
        ? (output.args as Record<string, unknown>)
        : undefined;
    const autonomousTool = isAutonomousTool(tool);
    const autonomousRun = isAutonomousRunTool(tool, argObject);
    let effectivePermission = tool;
    if (autonomousTool) {
      effectivePermission = isAutonomousReadOnlyMode(tool, argObject)
        ? 'read_only'
        : 'bash';
    }
    if (autonomousRun) {
      if (!argObject) {
        throw new Error(
          'miya_plan_bundle_required:autonomous_run_requires_object_args',
        );
      }
      const sourceTool =
        tool === 'miya_autoflow' ? 'miya_autoflow' : 'miya_autopilot';
      const modeLabel = parseToolMode(argObject) || 'run';
      const existingBinding = readPlanBundleBinding(ctx.directory, sessionID);
      const bindingLocked =
        existingBinding &&
        (existingBinding.status === 'prepared' ||
          existingBinding.status === 'running');
      const providedBundleID =
        typeof argObject.plan_bundle_id === 'string'
          ? argObject.plan_bundle_id.trim()
          : '';
      const providedPolicyHash =
        typeof argObject.policy_hash === 'string'
          ? argObject.policy_hash.trim()
          : '';
      const providedRiskTier =
        argObject.risk_tier === 'LIGHT' ||
        argObject.risk_tier === 'STANDARD' ||
        argObject.risk_tier === 'THOROUGH'
          ? String(argObject.risk_tier)
          : '';
      if (bindingLocked) {
        if (existingBinding.sourceTool !== sourceTool) {
          throw new Error(
            `miya_plan_bundle_binding_source_mismatch:expected=${existingBinding.sourceTool}:got=${sourceTool}`,
          );
        }
        if (providedBundleID && providedBundleID !== existingBinding.bundleId) {
          throw new Error(
            `miya_plan_bundle_frozen_field_mismatch:bundle_id:${providedBundleID}->${existingBinding.bundleId}`,
          );
        }
        if (
          providedPolicyHash &&
          providedPolicyHash !== existingBinding.policyHash
        ) {
          throw new Error('miya_plan_bundle_frozen_field_mismatch:policy_hash');
        }
        if (providedRiskTier && providedRiskTier !== existingBinding.riskTier) {
          throw new Error('miya_plan_bundle_frozen_field_mismatch:risk_tier');
        }
      }
      const canUseBinding = Boolean(
        existingBinding && existingBinding.sourceTool === sourceTool,
      );
      const bundleId =
        providedBundleID || (canUseBinding ? existingBinding!.bundleId : '');
      const policyHash =
        providedPolicyHash ||
        (canUseBinding ? existingBinding!.policyHash : '');
      if (!bundleId || !policyHash) {
        throw new Error(
          'miya_plan_bundle_required:autonomous_run_requires_plan_bundle_id_and_policy_hash',
        );
      }
      const riskTier =
        providedRiskTier ||
        (canUseBinding ? existingBinding!.riskTier : 'THOROUGH');
      const normalizedArgs = {
        ...argObject,
        plan_bundle_id: bundleId,
        policy_hash: policyHash,
        risk_tier: riskTier,
      };
      output.args = normalizedArgs;
      preparePlanBundleBinding(ctx.directory, {
        sessionID,
        bundleId,
        sourceTool,
        mode: 'work',
        riskTier: riskTier as 'LIGHT' | 'STANDARD' | 'THOROUGH',
        policyHash,
      });
      const preparedBinding = readPlanBundleBinding(ctx.directory, sessionID);
      if (
        !preparedBinding ||
        preparedBinding.sourceTool !== sourceTool ||
        preparedBinding.bundleId !== bundleId ||
        preparedBinding.policyHash !== policyHash ||
        preparedBinding.riskTier !== riskTier
      ) {
        throw new Error('miya_plan_bundle_binding_not_effective');
      }
      log('[miya] autonomous tool plan bundle prepared', {
        sessionID,
        tool,
        mode: modeLabel,
        bundleId,
        policyHash,
        riskTier,
      });
    }
    const argSummary: string[] = [];
    if (output.args && typeof output.args === 'object') {
      for (const [key, value] of Object.entries(
        output.args as Record<string, unknown>,
      )) {
        if (typeof value === 'string') {
          argSummary.push(`${key}=${value.slice(0, 180)}`);
          continue;
        }
        if (Array.isArray(value)) {
          const items = value
            .map((item) => (typeof item === 'string' ? item : ''))
            .filter(Boolean)
            .slice(0, 8)
            .join(',');
          if (items) argSummary.push(`${key}=[${items.slice(0, 180)}]`);
        }
      }
    }

    const intakeGate = shouldInterceptWriteAfterWebsearch(ctx.directory, {
      sessionID,
      permission: effectivePermission,
    });
    if (intakeGate.intercept) {
      throw new Error(
        'miya_intake_gate_blocked:write_after_websearch_requires_revalidation',
      );
    }

    const safety = await handlePermissionAsk(ctx.directory, {
      sessionID,
      permission: effectivePermission,
      patterns: argSummary,
      metadata:
        output.args && typeof output.args === 'object'
          ? (output.args as Record<string, unknown>)
          : {},
      toolCallID: callID,
    });
    if (safety.status === 'deny') {
      throw new Error(`miya_safety_gate_denied:${safety.reason}`);
    }
  };

  const onToolExecuteAfter = async (
    input: {
      tool: string;
      sessionID: string;
      callID: string;
    },
    output: {
      title: string;
      output: string;
      metadata: Record<string, unknown>;
    },
  ) => {
    await postReadNudgeHook['tool.execute.after'](input, output);
    if (postWriteSimplicityEnabled) {
      await postWriteSimplicityHook['tool.execute.after'](input, output);
    }
    await contextGovernorHook['tool.execute.after'](input, output);
    trackWebsearchToolOutput(
      typeof input.sessionID === 'string' ? input.sessionID : 'main',
      String(input.tool ?? ''),
      String(output.output ?? ''),
    );
  };

  assertRequiredHookHandlers({
    'tool.execute.before': onToolExecuteBefore,
    'tool.execute.after': onToolExecuteAfter,
    [PERMISSION_OBSERVED_HOOK]: onPermissionAsked,
  });

  return {
    name: 'miya',

    agent: agents,

    tool: toolCatalog,

    mcp: mcps,

    config: async (opencodeConfig: Record<string, unknown>) => {
      try {
        const synced = syncPersistedAgentRuntimeFromOpenCodeState(
          ctx.directory,
        );
        if (synced) {
          log(
            '[model-persistence] synchronized from opencode state on config merge',
          );
        }
      } catch (error) {
        log('[model-persistence] config merge sync failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const persistedRuntime = readPersistedAgentRuntime(ctx.directory);
      (opencodeConfig as { default_agent?: string }).default_agent =
        persistedRuntime.activeAgentId ?? '1-task-manager';

      // Register Miya control-plane commands in the command palette.
      const commandConfig = (opencodeConfig.command ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      opencodeConfig.command = commandConfig;

      if (!commandConfig.miya) {
        commandConfig.miya = {
          description: 'Open Miya control plane panel',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_status_panel` exactly once. Return only the tool output verbatim. If tool invocation fails, return the exact error text only.',
        };
      }

      if (!commandConfig['miya-schedule']) {
        commandConfig['miya-schedule'] = {
          description: 'Create daily schedule from natural language',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_schedule_from_text` with request="$ARGUMENTS". Return only tool output.',
        };
      }

      if (!commandConfig['miya-jobs']) {
        commandConfig['miya-jobs'] = {
          description: 'List Miya jobs',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_list_jobs` once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-approvals']) {
        commandConfig['miya-approvals'] = {
          description: 'List pending Miya approvals',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_list_approvals` once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-history']) {
        commandConfig['miya-history'] = {
          description: 'Show recent Miya automation history',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_job_history` with limit=20. Return only tool output.',
        };
      }

      if (!commandConfig['miya-safety']) {
        commandConfig['miya-safety'] = {
          description: 'Show Miya safety status (kill-switch and approvals)',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_kill_status` once. Then summarize latest `miya_status_panel` in 5 lines max.',
        };
      }
      if (!commandConfig['miya-security-audit']) {
        commandConfig['miya-security-audit'] = {
          description: 'Run Miya security baseline audit',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_security_audit` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-gateway-start']) {
        commandConfig['miya-gateway-start'] = {
          description: 'Start Miya Gateway and print runtime URL',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_gateway_start` exactly once. Return only tool output. If tool call fails, return exact error text only.',
        };
      }

      if (!commandConfig['miya-gateway-shutdown']) {
        commandConfig['miya-gateway-shutdown'] = {
          description: 'Stop Miya Gateway runtime',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_gateway_shutdown` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-ui-open']) {
        commandConfig['miya-ui-open'] = {
          description: 'Open Miya web control console in default browser',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_ui_open` exactly once. Return only tool output.',
        };
      }

      if (!commandConfig['miya-config-get']) {
        commandConfig['miya-config-get'] = {
          description: 'Read Miya config key',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_config_get` with key="$ARGUMENTS". Return only tool output.',
        };
      }

      if (!commandConfig['miya-config-validate']) {
        commandConfig['miya-config-validate'] = {
          description: 'Validate Miya config patch JSON',
          agent: '1-task-manager',
          template:
            'MANDATORY: Parse $ARGUMENTS as JSON patch payload, then call tool `miya_config_validate`. Return only tool output.',
        };
      }

      if (!commandConfig['miya-intake']) {
        commandConfig['miya-intake'] = {
          description: 'List intake gate pending/allow/deny records',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_intake_list` with target="all". Return only tool output.',
        };
      }

      if (!commandConfig['miya-intake-pending']) {
        commandConfig['miya-intake-pending'] = {
          description: 'List pending intake proposals',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_intake_list` with target="pending". Return only tool output.',
        };
      }

      // Aliases for users/IMEs that prefer underscore or dot command styles.
      if (!commandConfig.miya_gateway_start) {
        commandConfig.miya_gateway_start = {
          ...commandConfig['miya-gateway-start'],
        };
      }
      if (!commandConfig.miya_gateway_shutdown) {
        commandConfig.miya_gateway_shutdown = {
          ...commandConfig['miya-gateway-shutdown'],
        };
      }
      if (!commandConfig['miya.gateway.start']) {
        commandConfig['miya.gateway.start'] = {
          description: 'Alias of miya-gateway-start',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_gateway_start` exactly once. Return only tool output. If tool call fails, return exact error text only.',
        };
      }
      if (!commandConfig['miya.gateway.shutdown']) {
        commandConfig['miya.gateway.shutdown'] = {
          description: 'Alias of miya-gateway-shutdown',
          agent: '1-task-manager',
          template:
            'MANDATORY: Call tool `miya_gateway_shutdown` exactly once. Return only tool output.',
        };
      }

      // Merge Agent configs
      opencodeConfig.agent = mergePluginAgentConfigs(
        opencodeConfig.agent as Record<string, unknown> | undefined,
        agents as Record<string, Record<string, unknown>>,
      );
      const configAgent = opencodeConfig.agent as Record<string, unknown>;

      // Merge provider configs with runtime overrides (active-agent provider has highest priority).
      const existingProvider = isPlainObject(opencodeConfig.provider)
        ? (opencodeConfig.provider as Record<string, unknown>)
        : {};
      const pluginProvider = isPlainObject(config.provider)
        ? (config.provider as Record<string, unknown>)
        : {};
      opencodeConfig.provider = deepMergeObject(
        existingProvider,
        pluginProvider,
      );

      // Merge MCP configs
      const configMcp = opencodeConfig.mcp as
        | Record<string, unknown>
        | undefined;
      if (!configMcp) {
        opencodeConfig.mcp = { ...mcps };
      } else {
        Object.assign(configMcp, mcps);
      }

      // Get all MCP names from our config
      const allMcpNames = Object.keys(mcps);

      // For each agent, create permission rules based on their mcps list
      for (const [agentName, agentConfig] of Object.entries(agents)) {
        const agentMcps = (agentConfig as { mcps?: string[] })?.mcps;
        if (!agentMcps) continue;

        // Get or create agent permission config
        if (!configAgent[agentName]) {
          configAgent[agentName] = { ...agentConfig };
        }
        const agentConfigEntry = configAgent[agentName] as Record<
          string,
          unknown
        >;
        const agentPermission = (agentConfigEntry.permission ?? {}) as Record<
          string,
          unknown
        >;

        // Parse mcps list with wildcard and exclusion support
        const allowedMcps = parseList(agentMcps, allMcpNames);

        // Create permission rules for each MCP
        // MCP tools are named as <server>_<tool>, so we use <server>_*
        for (const mcpName of allMcpNames) {
          const sanitizedMcpName = mcpName.replace(/[^a-zA-Z0-9_-]/g, '_');
          const permissionKey = `${sanitizedMcpName}_*`;
          const action = allowedMcps.includes(mcpName) ? 'allow' : 'deny';

          // Only set if not already defined by user
          if (!(permissionKey in agentPermission)) {
            agentPermission[permissionKey] = action;
          }
        }

        // Update agent config with permissions
        agentConfigEntry.permission = agentPermission;
      }
    },

    event: async (input) => {
      const eventType = isPlainObject(input.event)
        ? String(input.event.type ?? '')
        : '';
      if (shouldSyncModelStateFromEventType(eventType)) {
        try {
          const synced = syncPersistedAgentRuntimeFromOpenCodeState(
            ctx.directory,
          );
          if (synced) {
            log(
              '[model-persistence] synchronized from opencode state on event',
              {
                eventType,
              },
            );
          }
        } catch (error) {
          log('[model-persistence] event sync failed', {
            eventType,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const runtimeBefore = readPersistedAgentRuntime(ctx.directory);
      const commandSelections = extractAgentRuntimeSelectionsFromCommandEvent(
        input.event,
        runtimeBefore.activeAgentId,
      );
      for (const commandSelection of commandSelections) {
        const changed = persistAgentRuntimeSelection(
          ctx.directory,
          commandSelection,
        );
        if (changed) {
          log('[model-persistence] updated from command event', {
            eventType,
            agent: commandSelection.agentName,
            model: commandSelection.model,
          });
        }
      }

      // Handle model/runtime persistence from message, agent switch, and settings-save events.
      const selections = extractAgentModelSelectionsFromEvent(input.event);
      for (const modelSelection of selections) {
        const changed = persistAgentRuntimeSelection(ctx.directory, {
          agentName: modelSelection.agentName,
          model: modelSelection.model,
          variant: modelSelection.variant,
          providerID: modelSelection.providerID,
          options: modelSelection.options,
          apiKey: modelSelection.apiKey,
          baseURL: modelSelection.baseURL,
          activeAgentId: modelSelection.activeAgentId,
        });
        if (changed) {
          log(`[model-persistence] updated from ${modelSelection.source}`, {
            agent: modelSelection.agentName,
            model: modelSelection.model,
          });
          const optionKeys =
            modelSelection.options &&
            typeof modelSelection.options === 'object' &&
            !Array.isArray(modelSelection.options)
              ? Object.keys(modelSelection.options as Record<string, unknown>)
              : [];
          if (
            optionKeys.length > 0 ||
            (typeof modelSelection.providerID === 'string' &&
              modelSelection.providerID.trim().length > 0) ||
            (typeof modelSelection.apiKey === 'string' &&
              modelSelection.apiKey.trim().length > 0) ||
            (typeof modelSelection.baseURL === 'string' &&
              modelSelection.baseURL.trim().length > 0)
          ) {
            appendProviderOverrideAudit(ctx.directory, {
              source: modelSelection.source,
              agentName: modelSelection.agentName,
              model: modelSelection.model,
              providerID: modelSelection.providerID,
              activeAgentId: modelSelection.activeAgentId,
              hasApiKey:
                typeof modelSelection.apiKey === 'string' &&
                modelSelection.apiKey.trim().length > 0,
              hasBaseURL:
                typeof modelSelection.baseURL === 'string' &&
                modelSelection.baseURL.trim().length > 0,
              optionKeys,
            });
          }
        }
      }

      // Handle tmux pane spawning for OpenCode's Task tool sessions
      await tmuxSessionManager.onSessionCreated(
        input.event as {
          type: string;
          properties?: {
            info?: { id?: string; parentID?: string; title?: string };
          };
        },
      );

      // Handle session.status events for:
      // 1. BackgroundTaskManager: completion detection
      // 2. TmuxSessionManager: pane cleanup
      await backgroundManager.handleSessionStatus(
        input.event as {
          type: string;
          properties?: { sessionID?: string; status?: { type: string } };
        },
      );
      await persistentAutoflowHook.onEvent(
        input.event as {
          type?: string;
          properties?: {
            sessionID?: string;
            status?: { type?: string; reason?: string; source?: string };
            reason?: string;
            source?: string;
          };
        },
      );
      await tmuxSessionManager.onSessionStatus(
        input.event as {
          type: string;
          properties?: { sessionID?: string; status?: { type: string } };
        },
      );
      await tmuxSessionManager.onSessionDeleted(
        input.event as {
          type: string;
          properties?: { sessionID?: string };
        },
      );

      // Drive scheduler ticks from plugin lifecycle events as backup to timer.
      // Use fire-and-forget to avoid delaying session event processing.
      void automationService.tick();
    },

    // Inject loop guard + phase reminder before sending to API.
    'experimental.chat.messages.transform': async (input, output) => {
      for (const hook of chatTransformPipeline) {
        await hook['experimental.chat.messages.transform'](input, output);
      }
    },

    // Nudge after file reads to encourage delegation + track websearch usage for intake gate
    'tool.execute.before': async (input, output) => {
      await onToolExecuteBefore(input, output);
    },

    // Nudge after file reads to encourage delegation + track websearch usage for intake gate
    'tool.execute.after': onToolExecuteAfter,

    // OpenCode currently emits permission.ask; Miya adapts it to permission.asked/replied.
    [PERMISSION_OBSERVED_HOOK]: onPermissionAsked,
  };
};

export default MiyaPlugin;

export type {
  AgentName,
  AgentOverrideConfig,
  McpName,
  PluginConfig,
  TmuxConfig,
  TmuxLayout,
} from './config';
export type { RemoteMcpConfig } from './mcp';
