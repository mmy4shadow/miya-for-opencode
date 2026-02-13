import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getResourceScheduler } from '../resource-scheduler';
import type { ResourceTaskKind } from '../resource-scheduler';
import { appendDaemonJob, writeDaemonRuntimeState } from './store';
import type {
  DaemonJobRecord,
  DaemonJobRequest,
  DaemonRunResult,
  DaemonRuntimeState,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function toSessionID(projectDir: string): string {
  const suffix = Buffer.from(projectDir).toString('base64url').slice(-12);
  return `daemon-${suffix || 'default'}`;
}

export class MiyaDaemonService {
  private readonly projectDir: string;
  private readonly sessionID: string;
  private started = false;
  private startedAtIso = '';

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.sessionID = toSessionID(projectDir);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.startedAtIso = nowIso();
    this.writeRuntimeState('running');
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.writeRuntimeState('stopped');
  }

  async runTask<T>(
    input: DaemonJobRequest,
    fn: () => Promise<T> | T,
  ): Promise<DaemonRunResult<T>> {
    if (!this.started) this.start();
    const scheduler = getResourceScheduler(this.projectDir);
    const job: DaemonJobRecord = {
      id: `djob_${randomUUID()}`,
      kind: input.kind,
      status: 'queued',
      createdAt: nowIso(),
      metadata: input.metadata,
    };
    appendDaemonJob(this.projectDir, job);

    const lease = await scheduler.acquire({
      kind: input.kind,
      priority: input.resource?.priority ?? this.defaultPriority(input.kind),
      vramMB: input.resource?.vramMB ?? 0,
      modelID: input.resource?.modelID,
      modelVramMB: input.resource?.modelVramMB,
      timeoutMs: input.resource?.timeoutMs ?? 15_000,
      metadata: input.resource?.metadata,
    });

    const runningJob: DaemonJobRecord = {
      ...job,
      status: 'running',
      startedAt: nowIso(),
    };
    appendDaemonJob(this.projectDir, runningJob);

    try {
      const result = await fn();
      const done: DaemonJobRecord = {
        ...runningJob,
        status: 'completed',
        endedAt: nowIso(),
      };
      appendDaemonJob(this.projectDir, done);
      return { job: done, result };
    } catch (error) {
      const failed: DaemonJobRecord = {
        ...runningJob,
        status: 'failed',
        endedAt: nowIso(),
        error: error instanceof Error ? error.message : String(error),
      };
      appendDaemonJob(this.projectDir, failed);
      throw error;
    } finally {
      lease.release();
    }
  }

  async runIsolatedProcess(input: {
    kind: ResourceTaskKind;
    command: string;
    args?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    resource?: DaemonJobRequest['resource'];
    metadata?: Record<string, unknown>;
  }): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }> {
    const wrapped = await this.runTask(
      {
        kind: input.kind,
        resource: input.resource,
        metadata: {
          command: input.command,
          args: input.args ?? [],
          ...(input.metadata ?? {}),
        },
      },
      async () =>
        new Promise<{
          exitCode: number | null;
          stdout: string;
          stderr: string;
          timedOut: boolean;
        }>((resolve) => {
          const child = spawn(input.command, input.args ?? [], {
            cwd: input.cwd,
            env: { ...process.env, ...(input.env ?? {}) },
            stdio: ['ignore', 'pipe', 'pipe'],
          });

          let stdout = '';
          let stderr = '';
          let timedOut = false;

          child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
          });

          const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
          }, Math.max(1000, input.timeoutMs ?? 10 * 60 * 1000));

          child.on('close', (code) => {
            clearTimeout(timeout);
            resolve({ exitCode: code, stdout, stderr, timedOut });
          });

          child.on('error', (error) => {
            clearTimeout(timeout);
            resolve({
              exitCode: null,
              stdout,
              stderr: `${stderr}\n${error.message}`,
              timedOut,
            });
          });
        }),
    );
    return wrapped.result;
  }

  private defaultPriority(kind: ResourceTaskKind): number {
    if (kind === 'training.image' || kind === 'training.voice') return 10;
    if (kind === 'voice.tts' || kind === 'image.generate' || kind === 'vision.analyze') {
      return 100;
    }
    return 50;
  }

  private writeRuntimeState(status: DaemonRuntimeState['status']): void {
    const state: DaemonRuntimeState = {
      status,
      pid: process.pid,
      startedAt: this.startedAtIso || nowIso(),
      updatedAt: nowIso(),
      sessionID: this.sessionID,
    };
    writeDaemonRuntimeState(this.projectDir, state);
  }
}
