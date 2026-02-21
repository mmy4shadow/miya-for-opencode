#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface StrictStepResult {
  name: string;
  command: string;
  exitCode: number;
  ok: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

interface StrictGateReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  steps: StrictStepResult[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function reportFile(cwd: string): string {
  return path.join(
    cwd,
    '.opencode',
    'miya',
    'reports',
    'strict-gate-latest.json',
  );
}

function ensureReportDir(cwd: string): void {
  fs.mkdirSync(path.dirname(reportFile(cwd)), { recursive: true });
}

function runStep(
  step: {
    name: string;
    command: string;
    cwdRelative?: string;
    quiet?: boolean;
    env?: Record<string, string>;
  },
  cwd: string,
): StrictStepResult {
  const started = Date.now();
  const stepCwd = step.cwdRelative ? path.resolve(cwd, step.cwdRelative) : cwd;
  const shellArgs =
    process.platform === 'win32'
      ? ['powershell', '-NoProfile', '-Command', step.command]
      : ['sh', '-lc', step.command];
  const result = step.quiet
    ? spawnSync(shellArgs[0], shellArgs.slice(1), {
        cwd: stepCwd,
        stdio: 'ignore',
        timeout: 5 * 60 * 1000,
        env: { ...process.env, ...(step.env ?? {}) },
      })
    : spawnSync(shellArgs[0], shellArgs.slice(1), {
        cwd: stepCwd,
        encoding: 'utf-8',
        timeout: 5 * 60 * 1000,
        env: { ...process.env, ...(step.env ?? {}) },
      });
  return {
    name: step.name,
    command: step.command,
    exitCode: result.status ?? -1,
    ok: result.status === 0,
    durationMs: Date.now() - started,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function printStep(step: StrictStepResult): void {
  const MAX_LOG_CHARS = 4000;
  const trimForLog = (value: string): string => {
    const text = value.trim();
    if (!text) return '';
    if (text.length <= MAX_LOG_CHARS) return text;
    return `${text.slice(0, MAX_LOG_CHARS)}\n...[truncated ${text.length - MAX_LOG_CHARS} chars]`;
  };
  process.stdout.write(
    `[strict-gate] ${step.name} ok=${step.ok} exit=${step.exitCode} duration_ms=${step.durationMs}\n`,
  );
  const stdout = trimForLog(step.stdout);
  const stderr = trimForLog(step.stderr);
  if (stdout) process.stdout.write(`${stdout}\n`);
  if (stderr) process.stderr.write(`${stderr}\n`);
}

function main(): void {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const cwd = process.cwd();
  const stepsDef = [
    { name: 'typecheck', command: 'npm run -s typecheck' },
    { name: 'core', command: 'npm run -s test:core' },
    {
      name: 'gateway_milestone',
      command: 'npm exec vitest run src/gateway/milestone-acceptance.test.ts',
    },
    { name: 'integration', command: 'npm run -s test:integration' },
    { name: 'ui', command: 'npm run -s test:ui' },
    { name: 'contracts', command: 'npm run -s check:contracts' },
    { name: 'doc_lint', command: 'npm run -s doc:lint' },
    {
      name: 'opencode_debug_config',
      command: 'opencode debug config',
      cwdRelative: '..',
      quiet: true,
      env: {
        MIYA_GATEWAY_LIFECYCLE_MODE: 'service_only',
        MIYA_AUTO_UI_OPEN: '0',
        MIYA_DOCK_AUTO_LAUNCH: '0',
      },
    },
    {
      name: 'opencode_debug_skill',
      command: 'opencode debug skill',
      cwdRelative: '..',
      quiet: true,
      env: {
        MIYA_GATEWAY_LIFECYCLE_MODE: 'service_only',
        MIYA_AUTO_UI_OPEN: '0',
        MIYA_DOCK_AUTO_LAUNCH: '0',
      },
    },
    {
      name: 'opencode_debug_paths',
      command: 'opencode debug paths',
      cwdRelative: '..',
      quiet: true,
      env: {
        MIYA_GATEWAY_LIFECYCLE_MODE: 'service_only',
        MIYA_AUTO_UI_OPEN: '0',
        MIYA_DOCK_AUTO_LAUNCH: '0',
      },
    },
  ];

  const steps: StrictStepResult[] = [];
  for (const step of stepsDef) {
    process.stdout.write(`[strict-gate] running=${step.name}\n`);
    const output = runStep(step, cwd);
    steps.push(output);
    printStep(output);
    if (!output.ok) break;
  }

  const report: StrictGateReport = {
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startedMs,
    ok: steps.every((step) => step.ok),
    steps,
  };
  ensureReportDir(cwd);
  fs.writeFileSync(
    reportFile(cwd),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf-8',
  );
  process.stdout.write(
    `[strict-gate] report=${reportFile(cwd)} ok=${report.ok}\n`,
  );
  process.exitCode = report.ok ? 0 : 1;
}

main();
