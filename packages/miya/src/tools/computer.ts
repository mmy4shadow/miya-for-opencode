import {
  type PluginInput,
  type ToolDefinition,
  tool,
} from '@opencode-ai/plugin';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const z = tool.schema;

const DANGEROUS_PATTERNS = [
  /(^|\s)rm\s+-rf\s+\/(\s|$)/i,
  /(^|\s)rd\s+\/s\s+\/q(\s|$)/i,
  /(^|\s)del\s+\/f\s+\/s\s+\/q(\s|$)/i,
  /(^|\s)shutdown(\s|$)/i,
  /(^|\s)reboot(\s|$)/i,
  /(^|\s)poweroff(\s|$)/i,
  /(^|\s)mkfs(\s|$)/i,
  /(^|\s)format(\s|$)/i,
  /(^|\s)diskpart(\s|$)/i,
  /(^|\s)reg\s+delete(\s|$)/i,
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-fdx/i,
  /:\(\)\s*\{\s*:\|\:&\s*\};:/,
];

function isDangerousCommand(command: string) {
  const text = command.trim();
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(text));
}

function isPathInside(parent: string, child: string) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function runShell(command: string, cwd: string, timeoutMs: number) {
  return await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (stdout.length > 20_000) stdout = `${stdout.slice(0, 20_000)}\n...[truncated]`;
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
      if (stderr.length > 20_000) stderr = `${stderr.slice(0, 20_000)}\n...[truncated]`;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });
  });
}

async function openTarget(target: string) {
  const normalized = target.trim();
  if (!normalized) throw new Error('target is required');

  if (process.platform === 'win32') {
    await runShell(`start "" "${normalized.replace(/"/g, '""')}"`, process.cwd(), 5000);
    return;
  }
  if (process.platform === 'darwin') {
    await runShell(`open "${normalized.replace(/"/g, '\\"')}"`, process.cwd(), 5000);
    return;
  }
  await runShell(`xdg-open "${normalized.replace(/"/g, '\\"')}"`, process.cwd(), 5000);
}

export function createComputerTools(
  ctx: PluginInput,
): Record<string, ToolDefinition> {
  const miya_computer_shell = tool({
    description:
      'Run a safe computer command inside workspace with guardrails. Blocks destructive patterns.',
    args: {
      command: z.string().describe('Shell command to run'),
      cwd: z
        .string()
        .optional()
        .describe('Working directory (must stay inside project workspace)'),
      timeout_ms: z
        .number()
        .optional()
        .describe('Timeout in milliseconds, default 60_000, max 120_000'),
    },
    async execute(args) {
      const command = String(args.command ?? '').trim();
      if (!command) return 'missing command';
      if (isDangerousCommand(command)) {
        return `blocked by safety policy: command looks destructive\ncommand=${command}`;
      }

      const cwdInput = typeof args.cwd === 'string' && args.cwd.trim()
        ? args.cwd.trim()
        : ctx.directory;
      const resolvedCwd = path.resolve(cwdInput);
      if (!isPathInside(ctx.directory, resolvedCwd)) {
        return `blocked by safety policy: cwd must be inside workspace\nworkspace=${ctx.directory}\ncwd=${resolvedCwd}`;
      }

      const timeout = typeof args.timeout_ms === 'number'
        ? Math.max(1000, Math.min(120_000, Math.floor(args.timeout_ms)))
        : 60_000;

      const result = await runShell(command, resolvedCwd, timeout);
      return [
        `command=${command}`,
        `cwd=${resolvedCwd}`,
        `timeout_ms=${timeout}`,
        `exit_code=${result.code ?? 'null'}`,
        `timed_out=${result.timedOut}`,
        'stdout:',
        result.stdout || '(empty)',
        'stderr:',
        result.stderr || '(empty)',
      ].join('\n');
    },
  });

  const miya_computer_open = tool({
    description:
      'Open URL/file/app with system default handler (generic computer control entry).',
    args: {
      target: z
        .string()
        .describe('URL, local file path, or app URI to open'),
    },
    async execute(args) {
      const target = String(args.target ?? '').trim();
      if (!target) return 'missing target';
      await openTarget(target);
      return `opened target=${target}`;
    },
  });

  const miya_self_heal_doctor = tool({
    description:
      'Run self-check diagnostics for miya/opencode/app typechecks with safe command execution.',
    args: {
      scope: z
        .enum(['miya', 'opencode', 'app', 'all'])
        .optional()
        .describe('Scope to check'),
    },
    async execute(args) {
      const scope = (args.scope ?? 'all') as 'miya' | 'opencode' | 'app' | 'all';
      const tasks: Array<{ name: string; cwd: string; cmd: string }> = [];
      if (scope === 'miya' || scope === 'all') {
        tasks.push({
          name: 'miya',
          cwd: path.join(ctx.directory, 'packages', 'miya'),
          cmd: process.platform === 'win32'
            ? '.\\node_modules\\.bin\\tsgo.exe --noEmit'
            : './node_modules/.bin/tsgo --noEmit',
        });
      }
      if (scope === 'opencode' || scope === 'all') {
        tasks.push({
          name: 'opencode',
          cwd: path.join(ctx.directory, 'packages', 'opencode'),
          cmd: process.platform === 'win32'
            ? '.\\node_modules\\.bin\\tsgo.exe --noEmit'
            : './node_modules/.bin/tsgo --noEmit',
        });
      }
      if (scope === 'app' || scope === 'all') {
        tasks.push({
          name: 'app',
          cwd: path.join(ctx.directory, 'packages', 'app'),
          cmd: process.platform === 'win32'
            ? '.\\node_modules\\.bin\\tsc.exe -p tsconfig.json --noEmit'
            : './node_modules/.bin/tsc -p tsconfig.json --noEmit',
        });
      }

      const reports: string[] = [];
      for (const task of tasks) {
        const output = await runShell(task.cmd, task.cwd, 120_000);
        reports.push(
          [
            `[${task.name}]`,
            `cwd=${task.cwd}`,
            `cmd=${task.cmd}`,
            `exit=${output.code ?? 'null'}`,
            `timed_out=${output.timedOut}`,
            `stderr=${output.stderr || '(empty)'}`,
          ].join('\n'),
        );
      }
      return reports.join('\n\n');
    },
  });

  return {
    miya_computer_shell,
    miya_computer_open,
    miya_self_heal_doctor,
  };
}

