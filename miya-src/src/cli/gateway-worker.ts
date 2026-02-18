#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureBunNodeCompat } from './bun-node-compat';
import { ensureGatewayRunning, stopGateway } from '../gateway';

interface GatewayWorkerArgs {
  workspace: string;
  verbose: boolean;
}

const LOOPBACK_NO_PROXY = 'localhost,127.0.0.1,::1';

function ensureLoopbackNoProxy(): void {
  const keys = ['NO_PROXY', 'no_proxy'] as const;
  for (const key of keys) {
    const existing = String(process.env[key] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const merged = [...existing];
    for (const host of LOOPBACK_NO_PROXY.split(',')) {
      if (!merged.includes(host)) merged.push(host);
    }
    process.env[key] = merged.join(',');
  }
}

function normalizeWorkspace(input: string): string {
  const resolved = path.resolve(input || process.cwd());
  if (path.basename(resolved).toLowerCase() === '.opencode') {
    return resolved;
  }
  if (path.basename(resolved).toLowerCase() === 'miya-src') {
    const parent = path.dirname(resolved);
    if (path.basename(parent).toLowerCase() === '.opencode') {
      return parent;
    }
  }
  const embeddedOpencode = path.join(resolved, '.opencode');
  if (fs.existsSync(path.join(embeddedOpencode, 'miya-src', 'src', 'index.ts'))) {
    return embeddedOpencode;
  }
  return resolved;
}

function parseArgs(argv: string[]): GatewayWorkerArgs {
  let workspace = '';
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i] ?? '';
    if (current === '--workspace' && i + 1 < argv.length) {
      workspace = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (current.startsWith('--workspace=')) {
      workspace = current.slice('--workspace='.length);
    }
  }
  return {
    workspace: normalizeWorkspace(workspace || process.cwd()),
    verbose: argv.includes('--verbose'),
  };
}

async function main(): Promise<void> {
  ensureLoopbackNoProxy();
  ensureBunNodeCompat();
  const args = parseArgs(process.argv.slice(2));
  const state = ensureGatewayRunning(args.workspace);
  if (args.verbose) {
    console.log(
      `[gateway-worker] running workspace=${args.workspace} url=${state.url} pid=${state.pid}`,
    );
  }

  let shuttingDown = false;
  const pulse = setInterval(() => {
    if (shuttingDown) return;
    try {
      ensureGatewayRunning(args.workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[gateway-worker] keepalive_failed:${message}`);
    }
  }, 2_500);

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(pulse);
    try {
      const result = stopGateway(args.workspace);
      if (args.verbose) {
        console.log(
          `[gateway-worker] received ${signal}; stopped=${result.stopped}`,
        );
      }
    } catch {}
    setTimeout(() => process.exit(0), 20);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGHUP', shutdown);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[gateway-worker] failed:${message}`);
  process.exit(1);
});
