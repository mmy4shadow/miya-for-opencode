#!/usr/bin/env bun

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
  const command = ['bun', 'test', '--max-concurrency=1', 'src/integration'];
  const proc = Bun.spawn({
    cmd: command,
    cwd: process.cwd(),
    env: {
      ...process.env,
      MIYA_RUN_INTEGRATION: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

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
