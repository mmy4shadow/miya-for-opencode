#!/usr/bin/env bun

function parseArgs(argv: string[]): { url: string; rounds: number; waitMs: number } {
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
    rounds: Math.max(1, Math.min(200, Math.floor(Number(map.get('rounds') || 20)))),
    waitMs: Math.max(50, Math.min(5000, Math.floor(Number(map.get('waitMs') || 250)))),
  };
}

async function probe(url: string, timeoutMs: number): Promise<boolean> {
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  const samples: Array<{ round: number; ok: boolean; at: string }> = [];
  let okCount = 0;
  for (let i = 0; i < options.rounds; i += 1) {
    const ok = await probe(options.url, 1200);
    if (ok) okCount += 1;
    samples.push({
      round: i + 1,
      ok,
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
    samples,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main();
