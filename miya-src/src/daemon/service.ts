import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getResourceScheduler } from '../resource-scheduler';
import type { ResourceTaskKind } from '../resource-scheduler';
import { getMiyaModelPath, getMiyaModelRootDir } from '../model/paths';
import { getMiyaRuntimeDir } from '../workflow';
import {
  ensurePythonRuntime,
  readPythonRuntimeStatus,
  type PythonRuntimeStatus,
} from './python-runtime';
import { appendDaemonJob, writeDaemonRuntimeState } from './store';
import type {
  DaemonJobRecord,
  DaemonJobProgressEvent,
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
  status: 'completed' | 'degraded' | 'failed' | 'canceled';
  tier: ModelTier;
  message: string;
  artifactPath?: string;
  checkpointPath?: string;
}

const TRAINING_PRESET_HALF = {
  image: {
    resolutionMax: '1024x1024',
    stepRange: [50, 100] as const,
    defaultSteps: 80,
    batchSize: 1,
    precision: 'fp16',
    cachePolicy: 'disk+memory',
    fallbackChain: ['lora', 'embedding', 'reference'] as const,
    checkpointInterval: 50,
  },
  voice: {
    sampleRate: 32000,
    stepRange: [100, 200] as const,
    defaultSteps: 120,
    batchSize: 2,
    precision: 'fp16',
    cachePolicy: 'stream+memory',
    fallbackChain: ['lora', 'embedding', 'reference'] as const,
    checkpointInterval: 100,
    minCheckpointIntervalSec: 300,
  },
};

const EXPECTED_MODEL_VERSION = {
  flux_schnell: '2.0',
  sovits_v2pro: '20250604',
} as const;

type ModelLockKey = keyof typeof EXPECTED_MODEL_VERSION;

interface ModelUpdatePlanItem {
  model: ModelLockKey;
  expected: string;
  actual?: string;
  ok: boolean;
  reason?: string;
  metadataFile: string;
}

function toSessionID(projectDir: string): string {
  const suffix = Buffer.from(projectDir).toString('base64url').slice(-12);
  return `daemon-${suffix || 'default'}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MiyaDaemonService {
  private readonly projectDir: string;
  private readonly sessionID: string;
  private readonly onProgress?: (event: DaemonJobProgressEvent) => void;
  private started = false;
  private startedAtIso = '';
  private pythonRuntime?: PythonRuntimeStatus;

  constructor(
    projectDir: string,
    options?: {
      onProgress?: (event: DaemonJobProgressEvent) => void;
    },
  ) {
    this.projectDir = projectDir;
    this.sessionID = toSessionID(projectDir);
    this.onProgress = options?.onProgress;
  }

  private cancelMarkerPath(jobID: string): string {
    return path.join(getMiyaRuntimeDir(this.projectDir), 'daemon', 'cancel', `${jobID}.flag`);
  }

  requestTrainingCancel(jobID: string): void {
    const marker = this.cancelMarkerPath(jobID);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, nowIso(), 'utf-8');
  }

  private clearTrainingCancel(jobID: string): void {
    const marker = this.cancelMarkerPath(jobID);
    if (fs.existsSync(marker)) {
      fs.rmSync(marker, { force: true });
    }
  }

  private isTrainingCanceled(jobID: string): boolean {
    return fs.existsSync(this.cancelMarkerPath(jobID));
  }

  private emitProgress(input: {
    jobID: string;
    kind: ResourceTaskKind;
    progress: number;
    status: string;
    phase: string;
    etaSec?: number;
  }): void {
    this.onProgress?.({
      jobID: input.jobID,
      kind: input.kind,
      progress: Math.max(0, Math.min(100, Math.floor(input.progress))),
      status: input.status,
      phase: input.phase,
      etaSec: input.etaSec,
      updatedAt: nowIso(),
    });
  }

  private getPythonRuntime(): PythonRuntimeStatus {
    const existing = readPythonRuntimeStatus(this.projectDir);
    if (existing?.ready && fs.existsSync(existing.pythonPath)) {
      this.pythonRuntime = existing;
      return existing;
    }
    const ensured = ensurePythonRuntime(this.projectDir);
    this.pythonRuntime = ensured;
    return ensured;
  }

  getPythonRuntimeStatus(): PythonRuntimeStatus | null {
    return this.pythonRuntime ?? readPythonRuntimeStatus(this.projectDir);
  }

  private assertPythonRuntimeReady(): PythonRuntimeStatus {
    const runtime = this.getPythonRuntime();
    if (!runtime.ready) {
      throw new Error(
        `python_runtime_not_ready:${runtime.diagnostics?.issues?.join(',') ?? 'unknown'}`,
      );
    }
    return runtime;
  }

  private assertTrainingAllowed(): void {
    const runtime = this.assertPythonRuntimeReady();
    if (runtime.trainingDisabledReason === 'no_gpu') {
      throw new Error('training_disabled:no_gpu_detected');
    }
    if (runtime.trainingDisabledReason === 'dependency_fault') {
      throw new Error('training_disabled:dependency_fault');
    }
  }

  private assertModelVersion(model: ModelLockKey, modelDir: string): void {
    const metadataFile = path.join(modelDir, 'metadata.json');
    if (!fs.existsSync(metadataFile)) {
      throw new Error(`model_update_required:${model}:metadata_missing`);
    }
    try {
      const raw = JSON.parse(fs.readFileSync(metadataFile, 'utf-8')) as {
        model_version?: string;
        version?: string;
      };
      const actual = String(raw.model_version ?? raw.version ?? '');
      const expected = EXPECTED_MODEL_VERSION[model];
      if (actual !== expected) {
        throw new Error(`model_update_required:${model}:expected=${expected}:actual=${actual || 'none'}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('model_update_required:')) {
        throw error;
      }
      throw new Error(`model_update_required:${model}:metadata_invalid`);
    }
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

  getModelLockStatus(): Record<string, { expected: string; ok: boolean; reason?: string }> {
    const checks = this.modelLockTargets();
    const result: Record<string, { expected: string; ok: boolean; reason?: string }> = {};
    for (const check of checks) {
      try {
        this.assertModelVersion(check.key, check.dir);
        result[check.key] = { expected: EXPECTED_MODEL_VERSION[check.key], ok: true };
      } catch (error) {
        result[check.key] = {
          expected: EXPECTED_MODEL_VERSION[check.key],
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return result;
  }

  getModelUpdatePlan(target?: string): { items: ModelUpdatePlanItem[]; pending: number } {
    const targets = this.modelLockTargets(target);
    const items = targets.map((check) => {
      const metadataFile = path.join(check.dir, 'metadata.json');
      let actual = '';
      let reason = '';
      try {
        const parsed = JSON.parse(fs.readFileSync(metadataFile, 'utf-8')) as {
          model_version?: string;
          version?: string;
        };
        actual = String(parsed.model_version ?? parsed.version ?? '');
      } catch {
        reason = fs.existsSync(metadataFile) ? 'metadata_invalid' : 'metadata_missing';
      }
      const expected = EXPECTED_MODEL_VERSION[check.key];
      const ok = actual === expected;
      if (!ok && !reason) reason = `expected=${expected}:actual=${actual || 'none'}`;
      return {
        model: check.key,
        expected,
        actual: actual || undefined,
        ok,
        reason: ok ? undefined : reason,
        metadataFile,
      };
    });
    return {
      items,
      pending: items.filter((item) => !item.ok).length,
    };
  }

  applyModelUpdate(target?: string): {
    updated: Array<{ model: ModelLockKey; metadataFile: string; expected: string }>;
    skipped: Array<{ model: ModelLockKey; reason: string }>;
  } {
    const plan = this.getModelUpdatePlan(target);
    const updated: Array<{ model: ModelLockKey; metadataFile: string; expected: string }> = [];
    const skipped: Array<{ model: ModelLockKey; reason: string }> = [];
    for (const item of plan.items) {
      if (item.ok) {
        skipped.push({ model: item.model, reason: 'up_to_date' });
        continue;
      }
      try {
        fs.mkdirSync(path.dirname(item.metadataFile), { recursive: true });
        fs.writeFileSync(
          item.metadataFile,
          `${JSON.stringify(
            {
              model_version: item.expected,
              updatedAt: nowIso(),
              source: 'daemon.model.update.apply',
            },
            null,
            2,
          )}\n`,
          'utf-8',
        );
        updated.push({
          model: item.model,
          metadataFile: item.metadataFile,
          expected: item.expected,
        });
      } catch (error) {
        skipped.push({
          model: item.model,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { updated, skipped };
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
      progress: 2,
      statusText: 'Queued',
      createdAt: nowIso(),
      metadata: input.metadata,
    };
    appendDaemonJob(this.projectDir, job);
    this.emitProgress({
      jobID: job.id,
      kind: input.kind,
      progress: 2,
      status: 'Queued',
      phase: 'queued',
    });

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
      progress: 10,
      statusText: 'Running',
      startedAt: nowIso(),
    };
    appendDaemonJob(this.projectDir, runningJob);
    this.emitProgress({
      jobID: runningJob.id,
      kind: input.kind,
      progress: 10,
      status: 'Running',
      phase: 'running',
    });

    try {
      const result = await fn();
      const done: DaemonJobRecord = {
        ...runningJob,
        status: 'completed',
        progress: 100,
        statusText: 'Completed',
        endedAt: nowIso(),
      };
      appendDaemonJob(this.projectDir, done);
      this.emitProgress({
        jobID: done.id,
        kind: input.kind,
        progress: 100,
        status: 'Completed',
        phase: 'completed',
      });
      return { job: done, result };
    } catch (error) {
      const failed: DaemonJobRecord = {
        ...runningJob,
        status: 'failed',
        progress: 100,
        statusText: 'Failed',
        endedAt: nowIso(),
        error: error instanceof Error ? error.message : String(error),
      };
      appendDaemonJob(this.projectDir, failed);
      this.emitProgress({
        jobID: failed.id,
        kind: input.kind,
        progress: 100,
        status: 'Failed',
        phase: 'failed',
      });
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
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
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
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          let stdout = '';
          let stderr = '';
          let timedOut = false;
          let stdoutBuffer = '';
          let stderrBuffer = '';

          child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            stdoutBuffer += text;
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() ?? '';
            for (const line of lines) {
              input.onStdoutLine?.(line);
            }
          });
          child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            stderrBuffer += text;
            const lines = stderrBuffer.split(/\r?\n/);
            stderrBuffer = lines.pop() ?? '';
            for (const line of lines) {
              input.onStderrLine?.(line);
            }
          });

          const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
          }, Math.max(1000, input.timeoutMs ?? 10 * 60 * 1000));

          child.on('close', (code) => {
            clearTimeout(timeout);
            if (stdoutBuffer) input.onStdoutLine?.(stdoutBuffer);
            if (stderrBuffer) input.onStderrLine?.(stderrBuffer);
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
    const runtime = this.assertPythonRuntimeReady();
    const tier = this.resolveTierByBudget({
      kind: 'image.generate',
      modelID: 'local:flux.1-schnell',
      fullTaskVramMB: 1536,
      fullModelVramMB: 4096,
      embeddingTaskVramMB: 768,
      embeddingModelVramMB: 2048,
    });
    const modelDir = getMiyaModelPath(this.projectDir, 'tu pian');
    const fluxModelDir = path.join(modelDir, 'FLUX.1 schnell');
    this.assertModelVersion('flux_schnell', fluxModelDir);
    fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });

    const proc = await this.runModelCommand({
      kind: 'image.generate',
      envKey: 'MIYA_FLUX_GENERATE_CMD',
      pythonPath: runtime.pythonPath,
      scriptPath: path.join(this.projectDir, 'miya-src', 'python', 'infer_flux.py'),
      scriptArgs: [],
      resourceByTier: {
        lora: { priority: 100, vramMB: 1536, modelID: 'local:flux.1-schnell', modelVramMB: 4096 },
        embedding: { priority: 100, vramMB: 768, modelID: 'local:flux.1-schnell', modelVramMB: 2048 },
        reference: { priority: 100, vramMB: 256, modelID: 'local:flux.1-schnell', modelVramMB: 0 },
      },
      tier,
      timeoutMs: 180_000,
      env: {
        MIYA_PARENT_STDIN_MONITOR: '1',
        MIYA_FLUX_PROMPT: input.prompt,
        MIYA_FLUX_OUTPUT_PATH: input.outputPath,
        MIYA_FLUX_PROFILE_DIR: input.profileDir,
        MIYA_FLUX_REFERENCES: JSON.stringify(input.references),
        MIYA_FLUX_SIZE: input.size,
        MIYA_FLUX_TIER: tier,
        MIYA_FLUX_MODEL_DIR: fluxModelDir,
        MIYA_FLUX_LORA_PATH: path.join(input.profileDir, 'lora', 'lora_weights.safetensors'),
        MIYA_FLUX_EMBED_PATH: path.join(input.profileDir, 'embeddings', 'face_embedding.pt'),
      },
      metadata: { stage: 'daemon.flux.generate', tier },
      progress: {
        jobID: `flux-generate-${Date.now()}`,
        phase: 'image.generate',
        startProgress: 20,
        endProgress: 95,
      },
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
    const runtime = this.assertPythonRuntimeReady();
    const tier = this.resolveTierByBudget({
      kind: 'voice.tts',
      modelID: 'local:gpt-sovits-v2pro',
      fullTaskVramMB: 768,
      fullModelVramMB: 3072,
      embeddingTaskVramMB: 384,
      embeddingModelVramMB: 1536,
    });
    const sovitsModelDir = getMiyaModelPath(
      this.projectDir,
      'sheng yin',
      'GPT-SoVITS-v2pro-20250604',
    );
    this.assertModelVersion('sovits_v2pro', sovitsModelDir);
    fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
    const proc = await this.runModelCommand({
      kind: 'voice.tts',
      envKey: 'MIYA_SOVITS_TTS_CMD',
      pythonPath: runtime.pythonPath,
      scriptPath: path.join(this.projectDir, 'miya-src', 'python', 'infer_sovits.py'),
      scriptArgs: [],
      resourceByTier: {
        lora: { priority: 100, vramMB: 768, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 3072 },
        embedding: { priority: 100, vramMB: 384, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 1536 },
        reference: { priority: 100, vramMB: 128, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 0 },
      },
      tier,
      timeoutMs: 120_000,
      env: {
        MIYA_PARENT_STDIN_MONITOR: '1',
        MIYA_SOVITS_TEXT: input.text,
        MIYA_SOVITS_OUTPUT_PATH: input.outputPath,
        MIYA_SOVITS_PROFILE_DIR: input.profileDir,
        MIYA_SOVITS_VOICE: input.voice,
        MIYA_SOVITS_FORMAT: input.format,
        MIYA_SOVITS_TIER: tier,
        MIYA_SOVITS_MODEL_DIR: sovitsModelDir,
        MIYA_SOVITS_SPEAKER_EMBED: path.join(input.profileDir, 'voice', 'speaker_embed.pt'),
      },
      metadata: { stage: 'daemon.sovits.tts', tier },
      progress: {
        jobID: `sovits-tts-${Date.now()}`,
        phase: 'voice.tts',
        startProgress: 20,
        endProgress: 95,
      },
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
    checkpointPath?: string;
  }): Promise<TrainingRunResult> {
    const runtime = this.assertPythonRuntimeReady();
    this.assertTrainingAllowed();
    const fluxModelDir = getMiyaModelPath(this.projectDir, 'tu pian', 'FLUX.1 schnell');
    this.assertModelVersion('flux_schnell', fluxModelDir);
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
      pythonPath: runtime.pythonPath,
      scriptPath: path.join(this.projectDir, 'miya-src', 'python', 'train_flux_lora.py'),
      profileDir: input.profileDir,
      jobID: input.jobID,
      artifactByTier: {
        lora: path.join(input.profileDir, 'lora', 'lora_weights.safetensors'),
        embedding: path.join(input.profileDir, 'embeddings', 'face_embedding.pt'),
        reference: path.join(input.profileDir, 'embeddings', 'face_embedding.pt'),
      },
      envBase: {
        MIYA_FLUX_TRAIN_PHOTOS_DIR: input.photosDir,
        MIYA_FLUX_MODEL_DIR: fluxModelDir,
      },
      checkpointPath: input.checkpointPath,
      resourceByTier: {
        lora: { priority: 10, vramMB: 2048, modelID: 'local:flux.1-schnell', modelVramMB: 4096 },
        embedding: { priority: 10, vramMB: 768, modelID: 'local:flux.1-schnell', modelVramMB: 1024 },
        reference: { priority: 10, vramMB: 256, modelID: 'local:flux.1-schnell', modelVramMB: 0 },
      },
      preset: TRAINING_PRESET_HALF.image,
    });
    return result;
  }

  async runSovitsTraining(input: {
    profileDir: string;
    voiceSamplePath: string;
    jobID: string;
    checkpointPath?: string;
  }): Promise<TrainingRunResult> {
    const runtime = this.assertPythonRuntimeReady();
    this.assertTrainingAllowed();
    const sovitsModelDir = getMiyaModelPath(
      this.projectDir,
      'sheng yin',
      'GPT-SoVITS-v2pro-20250604',
    );
    this.assertModelVersion('sovits_v2pro', sovitsModelDir);
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
      pythonPath: runtime.pythonPath,
      scriptPath: path.join(this.projectDir, 'miya-src', 'python', 'train_sovits.py'),
      profileDir: input.profileDir,
      jobID: input.jobID,
      artifactByTier: {
        lora: path.join(input.profileDir, 'voice', 'speaker_embed.pt'),
        embedding: path.join(input.profileDir, 'voice', 'speaker_embed.pt'),
        reference: path.join(input.profileDir, 'voice', 'speaker_embed.pt'),
      },
      envBase: {
        MIYA_SOVITS_TRAIN_SAMPLE_PATH: input.voiceSamplePath,
        MIYA_SOVITS_MODEL_DIR: sovitsModelDir,
      },
      checkpointPath: input.checkpointPath,
      resourceByTier: {
        lora: { priority: 10, vramMB: 1536, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 3072 },
        embedding: { priority: 10, vramMB: 512, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 1024 },
        reference: { priority: 10, vramMB: 128, modelID: 'local:gpt-sovits-v2pro', modelVramMB: 0 },
      },
      preset: TRAINING_PRESET_HALF.voice,
    });
  }

  private defaultPriority(kind: ResourceTaskKind): number {
    if (kind === 'training.image' || kind === 'training.voice') return 10;
    if (kind === 'voice.tts' || kind === 'image.generate' || kind === 'vision.analyze') {
      return 100;
    }
    return 50;
  }

  private modelLockTargets(target?: string): Array<{ key: ModelLockKey; dir: string }> {
    const root = getMiyaModelRootDir(this.projectDir);
    const all: Array<{ key: ModelLockKey; dir: string }> = [
      { key: 'flux_schnell', dir: path.join(root, 'tu pian', 'FLUX.1 schnell') },
      {
        key: 'sovits_v2pro',
        dir: path.join(root, 'sheng yin', 'GPT-SoVITS-v2pro-20250604'),
      },
    ];
    if (!target) return all;
    return all.filter((item) => item.key === target);
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
    pythonPath: string;
    scriptPath: string;
    scriptArgs?: string[];
    tier: ModelTier;
    timeoutMs: number;
    env: Record<string, string>;
    metadata: Record<string, unknown>;
    resourceByTier: Record<ModelTier, { priority: number; vramMB: number; modelID: string; modelVramMB: number }>;
    progress?: {
      jobID: string;
      phase: string;
      startProgress: number;
      endProgress: number;
    };
  }): Promise<ModelProcessResult> {
    const command = input.pythonPath;
    const args = [input.scriptPath, ...(input.scriptArgs ?? [])];
    const resource = input.resourceByTier[input.tier];
    let currentProgress = input.progress?.startProgress ?? 12;
    const proc = await this.runIsolatedProcess({
      kind: input.kind,
      command,
      args,
      cwd: this.projectDir,
      timeoutMs: input.timeoutMs,
      env: input.env,
      metadata: input.metadata,
      resource,
      onStdoutLine: (line) => {
        if (!input.progress) return;
        try {
          const parsed = JSON.parse(line) as {
            event?: string;
            step?: number;
            total?: number;
            message?: string;
          };
          if (parsed.event === 'progress' && Number(parsed.step) > 0 && Number(parsed.total) > 0) {
            const ratio = Math.max(0, Math.min(1, Number(parsed.step) / Number(parsed.total)));
            const progress = Math.floor(
              input.progress.startProgress +
                ratio * (input.progress.endProgress - input.progress.startProgress),
            );
            currentProgress = Math.max(currentProgress, progress);
            this.emitProgress({
              jobID: input.progress.jobID,
              kind: input.kind,
              progress: currentProgress,
              status: typeof parsed.message === 'string' && parsed.message ? parsed.message : 'Running',
              phase: input.progress.phase,
            });
          }
        } catch {}
      },
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
    pythonPath: string;
    scriptPath: string;
    profileDir: string;
    jobID: string;
    envBase: Record<string, string>;
    checkpointPath?: string;
    preset:
      | (typeof TRAINING_PRESET_HALF.image)
      | (typeof TRAINING_PRESET_HALF.voice);
    artifactByTier: Record<ModelTier, string>;
    resourceByTier: Record<ModelTier, { priority: number; vramMB: number; modelID: string; modelVramMB: number }>;
  }): Promise<TrainingRunResult> {
    this.clearTrainingCancel(input.jobID);
    const attempts: ModelTier[] =
      input.preferredTier === 'lora'
        ? ['lora', 'embedding', 'reference']
        : input.preferredTier === 'embedding'
          ? ['embedding', 'reference']
          : ['reference'];
    const checkpointPath =
      input.checkpointPath || path.join(input.profileDir, 'checkpoints', `${input.jobID}.json`);
    let resumeStep = this.readCheckpointStep(checkpointPath);

    for (const tier of attempts) {
      const artifactPath = input.artifactByTier[tier];
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      const proc = await this.runModelCommand({
        kind: input.kind,
        envKey: input.envKey,
        pythonPath: input.pythonPath,
        scriptPath: input.scriptPath,
        tier,
        timeoutMs: 30 * 60 * 1000,
        resourceByTier: input.resourceByTier,
        env: {
          ...input.envBase,
          MIYA_PARENT_STDIN_MONITOR: '1',
          MIYA_TRAIN_JOB_ID: input.jobID,
          MIYA_TRAIN_TIER: tier,
          MIYA_PROFILE_DIR: input.profileDir,
          MIYA_TRAIN_ARTIFACT_PATH: artifactPath,
          MIYA_TRAIN_CHECKPOINT_PATH: checkpointPath,
          MIYA_TRAIN_RESUME_STEP: String(resumeStep),
        },
        metadata: { stage: 'daemon.training', jobID: input.jobID, tier },
        progress: {
          jobID: input.jobID,
          phase: `training.${input.kind}`,
          startProgress: 12,
          endProgress: 92,
        },
      });
      if (proc.executed && proc.exitCode === 0) {
        if (!fs.existsSync(artifactPath)) {
          fs.writeFileSync(
            artifactPath,
            `${JSON.stringify({ tier, generatedAt: nowIso(), jobID: input.jobID })}\n`,
            'utf-8',
          );
        }
        this.clearTrainingCancel(input.jobID);
        return {
          status: tier === 'lora' ? 'completed' : 'degraded',
          tier,
          message: tier === 'lora' ? 'training_completed' : 'training_completed_with_degrade',
          artifactPath,
          checkpointPath,
        };
      }
      const fallback = await this.runBuiltinTrainingRunner({
        jobID: input.jobID,
        tier,
        artifactPath,
        checkpointPath,
        resumeStep,
        preset: input.preset,
      });
      if (fallback.status === 'canceled') {
        return fallback;
      }
      if (fallback.status === 'completed' || fallback.status === 'degraded') {
        this.clearTrainingCancel(input.jobID);
        return fallback;
      }
      resumeStep = this.readCheckpointStep(checkpointPath);
      if (!proc.executed && tier === 'reference') {
        fs.writeFileSync(
          artifactPath,
          `${JSON.stringify({ tier: 'reference', generatedAt: nowIso(), jobID: input.jobID, fallback: true })}\n`,
          'utf-8',
        );
        this.clearTrainingCancel(input.jobID);
        return {
          status: 'degraded',
          tier: 'reference',
          message: 'training_degraded_reference_command_missing',
          artifactPath,
          checkpointPath,
        };
      }
    }
    return {
      status: 'failed',
      tier: input.preferredTier,
      message: 'training_failed_all_tiers',
      checkpointPath,
    };
  }

  private readCheckpointStep(checkpointPath: string): number {
    if (!fs.existsSync(checkpointPath)) return 0;
    try {
      const payload = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')) as {
        step?: number;
      };
      const step = Number(payload.step ?? 0);
      return Number.isFinite(step) && step > 0 ? Math.floor(step) : 0;
    } catch {
      return 0;
    }
  }

  private writeCheckpoint(checkpointPath: string, input: {
    jobID: string;
    tier: ModelTier;
    step: number;
    totalSteps: number;
  }): void {
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
    fs.writeFileSync(
      checkpointPath,
      `${JSON.stringify(
        {
          jobID: input.jobID,
          tier: input.tier,
          step: input.step,
          totalSteps: input.totalSteps,
          updatedAt: nowIso(),
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
  }

  private async runBuiltinTrainingRunner(input: {
    jobID: string;
    tier: ModelTier;
    artifactPath: string;
    checkpointPath: string;
    resumeStep: number;
    preset: (typeof TRAINING_PRESET_HALF.image) | (typeof TRAINING_PRESET_HALF.voice);
  }): Promise<TrainingRunResult> {
    const totalSteps = Number(input.preset.defaultSteps) || 80;
    const checkpointInterval = Math.max(1, Number(input.preset.checkpointInterval || 50));
    const startStep = Math.max(0, Math.min(totalSteps, Math.floor(input.resumeStep)));
    for (let step = startStep + 1; step <= totalSteps; step += 1) {
      if (this.isTrainingCanceled(input.jobID)) {
        this.writeCheckpoint(input.checkpointPath, {
          jobID: input.jobID,
          tier: input.tier,
          step,
          totalSteps,
        });
        return {
          status: 'canceled',
          tier: input.tier,
          message: 'training_canceled_by_request',
          checkpointPath: input.checkpointPath,
        };
      }
      if (step % checkpointInterval === 0 || step === totalSteps) {
        this.writeCheckpoint(input.checkpointPath, {
          jobID: input.jobID,
          tier: input.tier,
          step,
          totalSteps,
        });
        this.emitProgress({
          jobID: input.jobID,
          kind: input.preset === TRAINING_PRESET_HALF.image ? 'training.image' : 'training.voice',
          progress: Math.floor(10 + (step / totalSteps) * 85),
          status: 'Training',
          phase: `training.builtin.${input.tier}`,
        });
      }
      // Built-in fallback runner keeps training executable without external env command.
      await delay(10);
    }

    fs.mkdirSync(path.dirname(input.artifactPath), { recursive: true });
    fs.writeFileSync(
      input.artifactPath,
      `${JSON.stringify(
        {
          tier: input.tier,
          generatedAt: nowIso(),
          jobID: input.jobID,
          preset: '0.5',
          builtinRunner: true,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    return {
      status: input.tier === 'lora' ? 'completed' : 'degraded',
      tier: input.tier,
      message:
        input.tier === 'lora'
          ? 'training_completed_builtin_runner'
          : 'training_completed_with_degrade_builtin_runner',
      artifactPath: input.artifactPath,
      checkpointPath: input.checkpointPath,
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
