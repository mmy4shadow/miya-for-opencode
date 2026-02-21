#!/usr/bin/env node

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface IntegrationReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  ok: boolean;
  command: string[];
  reportFile: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureReportDir(cwd: string): string {
  const dir = path.join(cwd, '.opencode', 'miya', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function patchBrokenOpencodePluginSpecifier(cwd: string): string | null {
  const pluginIndex = path.join(
    cwd,
    'node_modules',
    '@opencode-ai',
    'plugin',
    'dist',
    'index.js',
  );
  if (!fs.existsSync(pluginIndex)) {
    return null;
  }
  const original = fs.readFileSync(pluginIndex, 'utf-8');
  if (original.includes('export * from "./tool.js";')) {
    return 'already_patched';
  }
  const patched = original.replace(
    'export * from "./tool";',
    'export * from "./tool.js";',
  );
  if (patched === original) {
    return 'unexpected_format';
  }
  fs.writeFileSync(pluginIndex, patched, 'utf-8');
  return 'patched';
}

async function main(): Promise<void> {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const cwd = process.cwd();
  const patchStatus = patchBrokenOpencodePluginSpecifier(cwd);
  if (patchStatus) {
    process.stdout.write(
      `[integration-suite] plugin-index-fix=${patchStatus}\n`,
    );
  }
  const command = [
    process.execPath,
    'node_modules/vitest/vitest.mjs',
    'run',
    'src/integration',
  ];
  const proc = spawn(command[0], command.slice(1), {
    cwd,
    env: { ...process.env, MIYA_RUN_INTEGRATION: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  proc.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve) => {
    proc.on('close', (code) => resolve(code ?? -1));
  });

  const reportDir = ensureReportDir(cwd);
  const reportFile = path.join(reportDir, 'integration-latest.json');
  const report: IntegrationReport & {
    stdout: string;
    stderr: string;
  } = {
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startedMs,
    exitCode,
    ok: exitCode === 0,
    command,
    reportFile,
    stdout,
    stderr,
  };
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.stdout.write(
    `\n[integration-report] file=${reportFile}\n[integration-report] ok=${report.ok}\n`,
  );
  process.exitCode = exitCode;
}

void main();
