#!/usr/bin/env bun

interface ProbeOptions {
  url: string;
  rounds: number;
  waitMs: number;
  strictDaemon: boolean;
}

function parseArgs(argv: string[]): ProbeOptions {
  const map = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      map.set(key, 'true');
    } else {
      map.set(key, value);
      i += 1;
    }
  }
  return {
    url: map.get('url') || 'http://127.0.0.1:17321',
    rounds: Math.max(
      1,
      Math.min(200, Math.floor(Number(map.get('rounds') || 20))),
    ),
    waitMs: Math.max(
      50,
      Math.min(5000, Math.floor(Number(map.get('waitMs') || 250))),
    ),
    strictDaemon: map.get('strictDaemon') === 'true',
  };
}

async function fetchJson(
  url: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/status`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUiOk(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/`, {
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  const samples: Array<{
    round: number;
    ok: boolean;
    checks: Record<string, boolean>;
    reasons: string[];
    at: string;
  }> = [];
  let okCount = 0;
  let uiOpenCount = 0;
  for (let i = 0; i < options.rounds; i += 1) {
    const status = await fetchJson(options.url, 1800);
    const uiOpen = await fetchUiOk(options.url, 1800);
    if (uiOpen) uiOpenCount += 1;
    const gateway = status?.gateway as Record<string, unknown> | undefined;
    const daemon = status?.daemon as Record<string, unknown> | undefined;
    const runtime = status?.runtime as Record<string, unknown> | undefined;

    const checks = {
      gateway_alive: Boolean(status),
      owner_follower_lock_fresh: Boolean(
        runtime && runtime.ownerFresh === true,
      ),
      daemon_connected:
        !options.strictDaemon || Boolean(daemon && daemon.connected === true),
      gateway_running: Boolean(
        gateway &&
          (gateway.status === 'running' || gateway.status === 'killswitch'),
      ),
      miya_ui_open: uiOpen,
    };
    const reasons = Object.entries(checks)
      .filter((entry) => !entry[1])
      .map((entry) => entry[0]);
    const ok = reasons.length === 0;
    if (ok) okCount += 1;
    samples.push({
      round: i + 1,
      ok,
      checks,
      reasons,
      at: new Date().toISOString(),
    });
    if (i < options.rounds - 1) {
      await new Promise((resolve) => setTimeout(resolve, options.waitMs));
    }
  }
  const result = {
    url: options.url,
    rounds: options.rounds,
    success: okCount,
    failure: options.rounds - okCount,
    successRate: Number(((okCount / options.rounds) * 100).toFixed(2)),
    uiOpenRate: Number(((uiOpenCount / options.rounds) * 100).toFixed(2)),
    strictDaemon: options.strictDaemon,
    samples,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main();
