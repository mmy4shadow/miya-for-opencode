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

async function main(): Promise<void> {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const command = ['bun', 'test', 'src/integration'];
  const proc = spawn(command[0], command.slice(1), {
    cwd: process.cwd(),
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

  const reportDir = ensureReportDir(process.cwd());
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

