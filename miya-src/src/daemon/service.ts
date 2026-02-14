import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getResourceScheduler } from '../resource-scheduler';
import type { ResourceTaskKind } from '../resource-scheduler';
import { getMiyaRuntimeDir } from '../workflow';
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

const MAX_VRAM_HARD_LIMIT_MB = 8192;

type ModelTier = 'lora' | 'embedding' | 'reference';

interface ModelProcessResult {
  executed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface TrainingRunResult {
  status: 'completed' | 'degraded' | 'failed';
  tier: ModelTier;
  message: string;
  artifactPath?: string;
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

    const normalizedVramMB = Math.max(0, Math.floor(input.resource?.vramMB ?? 0));
    const normalizedModelVramMB = Math.max(
      0,
      Math.floor(input.resource?.modelVramMB ?? 0),
    );
    if (normalizedVramMB + normalizedModelVramMB > MAX_VRAM_HARD_LIMIT_MB) {
      throw new Error('vram_hard_limit_exceeded_8gb');
    }
    const lease = await scheduler.acquire({
      kind: input.kind,
      priority: input.resource?.priority ?? this.defaultPriority(input.kind),
      vramMB: normalizedVramMB,
      modelID: input.resource?.modelID,
      modelVramMB: normalizedModelVramMB,
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

  async runFluxImageGenerate(input: {
    prompt: string;
    outputPath: string;
    profileDir: string;
    references: string[];
    size: string;
  }): Promise<{
    outputPath: string;
    tier: ModelTier;
    degraded: boolean;
    message: string;
  }> {
    const tier = this.resolveTierByBudget({
      kind: 'image.generate',
      modelID: 'local:flux.1-schnell',
      fullTaskVramMB: 1536,
      fullModelVramMB: 4096,
      embeddingTaskVramMB: 768,
      embeddingModelVramMB: 2048,
    });
    const modelDir = path.join(getMiyaRuntimeDir(this.projectDir), 'model', 'tu pian');
    fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });

    const proc = await this.runModelCommand({
      kind: 'image.generate',
      envKey: 'MIYA_FLUX_GENERATE_CMD',
      resourceByTier: {
        lora: { priority: 100, vramMB: 1536, modelID: 'local:flux.1-schnell', modelVramMB: 4096 },
        embedding: { priority: 100, vramMB: 768, modelID: 'local:flux.1-schnell', modelVramMB: 2048 },
        reference: { priority: 100, vramMB: 256, modelID: 'local:flux.1-schnell', modelVramMB: 0 },
      },
      tier,
      timeoutMs: 180_000,
      env: {
        MIYA_FLUX_PROMPT: input.prompt,
        MIYA_FLUX_OUTPUT_PATH: input.outputPath,
        MIYA_FLUX_PROFILE_DIR: input.profileDir,
        MIYA_FLUX_REFERENCES: JSON.stringify(input.references),
        MIYA_FLUX_SIZE: input.size,
        MIYA_FLUX_TIER: tier,
        MIYA_FLUX_LORA_PATH: path.join(input.profileDir, 'lora', 'lora_weights.safetensors'),
        MIYA_FLUX_EMBED_PATH: path.join(input.profileDir, 'embeddings', 'face_embedding.pt'),
      },
      metadata: { stage: 'daemon.flux.generate', tier },
    });

    if (proc.executed && proc.exitCode === 0 && fs.existsSync(input.outputPath)) {
      return { outputPath: input.outputPath, tier, degraded: tier !== 'lora', message: 'flux_generate_ok' };
    }
    return {
      outputPath: input.outputPath,
      tier: 'reference',
      degraded: true,
      message: proc.executed
        ? `flux_generate_fallback:${proc.stderr || proc.stdout || proc.exitCode}`
        : 'flux_generate_command_not_configured',
    };
  }

  async runSovitsTts(input: {
    text: string;
    outputPath: string;
    profileDir: string;
    voice: string;
    format: 'wav' | 'mp3' | 'ogg';
  }): Promise<{
    outputPath: string;
    tier: ModelTier;
    degraded: boolean;
    message: string;
  }> {
    const tier = this.resolveTierByBudget({
      kind: 'voice.tts',
      modelID: 'local:gpt-sovits-v2pro',
      fullTaskVramMB: 768,
      fullModelVramMB: 3072,
      embeddingTaskVramMB: 384,
      embeddingModelVramMB: 1536,
    });
    fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
    const proc = await this.runModelCommand({
      kind: 'voice.tts',
      envKey: 'MIYA_SOVITS_TTS_CMD',
      resourceByTier: {
        lora: { priority: 100, vramMB: 768, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 3072 },
        embedding: { priority: 100, vramMB: 384, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 1536 },
        reference: { priority: 100, vramMB: 128, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 0 },
      },
      tier,
      timeoutMs: 120_000,
      env: {
        MIYA_SOVITS_TEXT: input.text,
        MIYA_SOVITS_OUTPUT_PATH: input.outputPath,
        MIYA_SOVITS_PROFILE_DIR: input.profileDir,
        MIYA_SOVITS_VOICE: input.voice,
        MIYA_SOVITS_FORMAT: input.format,
        MIYA_SOVITS_TIER: tier,
        MIYA_SOVITS_SPEAKER_EMBED: path.join(input.profileDir, 'voice', 'speaker_embed.pt'),
      },
      metadata: { stage: 'daemon.sovits.tts', tier },
    });
    if (proc.executed && proc.exitCode === 0 && fs.existsSync(input.outputPath)) {
      return { outputPath: input.outputPath, tier, degraded: tier !== 'lora', message: 'sovits_tts_ok' };
    }
    return {
      outputPath: input.outputPath,
      tier: 'reference',
      degraded: true,
      message: proc.executed
        ? `sovits_tts_fallback:${proc.stderr || proc.stdout || proc.exitCode}`
        : 'sovits_tts_command_not_configured',
    };
  }

  async runFluxTraining(input: {
    profileDir: string;
    photosDir: string;
    jobID: string;
  }): Promise<TrainingRunResult> {
    const preferred = this.resolveTierByBudget({
      kind: 'training.image',
      modelID: 'local:flux.1-schnell',
      fullTaskVramMB: 2048,
      fullModelVramMB: 4096,
      embeddingTaskVramMB: 768,
      embeddingModelVramMB: 1024,
    });
    const result = await this.runTieredTraining({
      preferredTier: preferred,
      kind: 'training.image',
      envKey: 'MIYA_FLUX_TRAIN_CMD',
      profileDir: input.profileDir,
      jobID: input.jobID,
      artifactByTier: {
        lora: path.join(input.profileDir, 'lora', 'lora_weights.safetensors'),
        embedding: path.join(input.profileDir, 'embeddings', 'face_embedding.pt'),
        reference: path.join(input.profileDir, 'embeddings', 'face_embedding.pt'),
      },
      envBase: {
        MIYA_FLUX_TRAIN_PHOTOS_DIR: input.photosDir,
      },
      resourceByTier: {
        lora: { priority: 10, vramMB: 2048, modelID: 'local:flux.1-schnell', modelVramMB: 4096 },
        embedding: { priority: 10, vramMB: 768, modelID: 'local:flux.1-schnell', modelVramMB: 1024 },
        reference: { priority: 10, vramMB: 256, modelID: 'local:flux.1-schnell', modelVramMB: 0 },
      },
    });
    return result;
  }

  async runSovitsTraining(input: {
    profileDir: string;
    voiceSamplePath: string;
    jobID: string;
  }): Promise<TrainingRunResult> {
    const preferred = this.resolveTierByBudget({
      kind: 'training.voice',
      modelID: 'local:gpt-sovits-v2pro',
      fullTaskVramMB: 1536,
      fullModelVramMB: 3072,
      embeddingTaskVramMB: 512,
      embeddingModelVramMB: 1024,
    });
    return this.runTieredTraining({
      preferredTier: preferred,
      kind: 'training.voice',
      envKey: 'MIYA_SOVITS_TRAIN_CMD',
      profileDir: input.profileDir,
      jobID: input.jobID,
      artifactByTier: {
        lora: path.join(input.profileDir, 'voice', 'speaker_embed.pt'),
        embedding: path.join(input.profileDir, 'voice', 'speaker_embed.pt'),
        reference: path.join(input.profileDir, 'voice', 'speaker_embed.pt'),
      },
      envBase: {
        MIYA_SOVITS_TRAIN_SAMPLE_PATH: input.voiceSamplePath,
      },
      resourceByTier: {
        lora: { priority: 10, vramMB: 1536, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 3072 },
        embedding: { priority: 10, vramMB: 512, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 1024 },
        reference: { priority: 10, vramMB: 128, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 0 },
      },
    });
  }

  private defaultPriority(kind: ResourceTaskKind): number {
    if (kind === 'training.image' || kind === 'training.voice') return 10;
    if (kind === 'voice.tts' || kind === 'image.generate' || kind === 'vision.analyze') {
      return 100;
    }
    return 50;
  }

  private resolveTierByBudget(input: {
    kind: ResourceTaskKind;
    modelID: string;
    fullTaskVramMB: number;
    fullModelVramMB: number;
    embeddingTaskVramMB: number;
    embeddingModelVramMB: number;
  }): ModelTier {
    const scheduler = getResourceScheduler(this.projectDir);
    const full = scheduler.planVramBudget({
      kind: input.kind,
      vramMB: input.fullTaskVramMB,
      modelID: input.modelID,
      modelVramMB: input.fullModelVramMB,
      priority: this.defaultPriority(input.kind),
    });
    if (full.fit) return 'lora';
    const embedding = scheduler.planVramBudget({
      kind: input.kind,
      vramMB: input.embeddingTaskVramMB,
      modelID: input.modelID,
      modelVramMB: input.embeddingModelVramMB,
      priority: this.defaultPriority(input.kind),
    });
    if (embedding.fit) return 'embedding';
    return 'reference';
  }

  private parseCommandSpec(raw: string): { command: string; args: string[] } | null {
    const input = raw.trim();
    if (!input) return null;
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i] ?? '';
      if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
        quote = quote ? null : (ch as '"' | "'");
        continue;
      }
      if (!quote && /\s/.test(ch)) {
        if (current) tokens.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current) tokens.push(current);
    if (tokens.length === 0) return null;
    return {
      command: tokens[0] as string,
      args: tokens.slice(1),
    };
  }

  private async runModelCommand(input: {
    kind: ResourceTaskKind;
    envKey: string;
    tier: ModelTier;
    timeoutMs: number;
    env: Record<string, string>;
    metadata: Record<string, unknown>;
    resourceByTier: Record<ModelTier, { priority: number; vramMB: number; modelID: string; modelVramMB: number }>;
  }): Promise<ModelProcessResult> {
    const specRaw = process.env[input.envKey]?.trim() ?? '';
    if (!specRaw) {
      return {
        executed: false,
        exitCode: null,
        stdout: '',
        stderr: 'command_not_configured',
        timedOut: false,
      };
    }
    const spec = this.parseCommandSpec(specRaw);
    if (!spec) {
      return {
        executed: false,
        exitCode: null,
        stdout: '',
        stderr: 'invalid_command_spec',
        timedOut: false,
      };
    }
    const resource = input.resourceByTier[input.tier];
    const proc = await this.runIsolatedProcess({
      kind: input.kind,
      command: spec.command,
      args: spec.args,
      cwd: this.projectDir,
      timeoutMs: input.timeoutMs,
      env: input.env,
      metadata: input.metadata,
      resource,
    });
    return {
      ...proc,
      executed: true,
    };
  }

  private async runTieredTraining(input: {
    preferredTier: ModelTier;
    kind: ResourceTaskKind;
    envKey: string;
    profileDir: string;
    jobID: string;
    envBase: Record<string, string>;
    artifactByTier: Record<ModelTier, string>;
    resourceByTier: Record<ModelTier, { priority: number; vramMB: number; modelID: string; modelVramMB: number }>;
  }): Promise<TrainingRunResult> {
    const attempts: ModelTier[] =
      input.preferredTier === 'lora'
        ? ['lora', 'embedding', 'reference']
        : input.preferredTier === 'embedding'
          ? ['embedding', 'reference']
          : ['reference'];

    for (const tier of attempts) {
      const artifactPath = input.artifactByTier[tier];
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      const proc = await this.runModelCommand({
        kind: input.kind,
        envKey: input.envKey,
        tier,
        timeoutMs: 30 * 60 * 1000,
        resourceByTier: input.resourceByTier,
        env: {
          ...input.envBase,
          MIYA_TRAIN_JOB_ID: input.jobID,
          MIYA_TRAIN_TIER: tier,
          MIYA_PROFILE_DIR: input.profileDir,
          MIYA_TRAIN_ARTIFACT_PATH: artifactPath,
        },
        metadata: { stage: 'daemon.training', jobID: input.jobID, tier },
      });
      if (proc.executed && proc.exitCode === 0) {
        if (!fs.existsSync(artifactPath)) {
          fs.writeFileSync(
            artifactPath,
            `${JSON.stringify({ tier, generatedAt: nowIso(), jobID: input.jobID })}\n`,
            'utf-8',
          );
        }
        return {
          status: tier === 'lora' ? 'completed' : 'degraded',
          tier,
          message: tier === 'lora' ? 'training_completed' : 'training_completed_with_degrade',
          artifactPath,
        };
      }
      if (!proc.executed && tier === 'reference') {
        fs.writeFileSync(
          artifactPath,
          `${JSON.stringify({ tier: 'reference', generatedAt: nowIso(), jobID: input.jobID, fallback: true })}\n`,
          'utf-8',
        );
        return {
          status: 'degraded',
          tier: 'reference',
          message: 'training_degraded_reference_command_missing',
          artifactPath,
        };
      }
    }
    return {
      status: 'failed',
      tier: input.preferredTier,
      message: 'training_failed_all_tiers',
    };
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
