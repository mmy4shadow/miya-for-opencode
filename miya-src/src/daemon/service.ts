import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getResourceScheduler } from '../resource-scheduler';
import type { ResourceTaskKind } from '../resource-scheduler';
import {
  getMiyaAsrModelDir,
  MIYA_MODEL_BRANCH,
  getMiyaFluxKleinModelDir,
  getMiyaFluxModelDir,
  getMiyaModelPath,
  getMiyaSovitsModelDir,
} from '../model/paths';
import { getMiyaRuntimeDir } from '../workflow';
import { maybeAutoReflectCompanionMemory } from '../companion/memory-reflect';
import {
  PsycheConsultService,
  PsycheNativeSignalHub,
  readSlowBrainState,
  retrainSlowBrainPolicy,
  rollbackSlowBrainPolicy,
  maybeAutoRetrainSlowBrain,
  type PsycheConsultRequest,
  type PsycheConsultResult,
  type PsycheOutcomeRequest,
  type PsycheOutcomeResult,
  type PsycheNativeSignalHubStatus,
  type SlowBrainRetrainResult,
  type SlowBrainRollbackResult,
} from './psyche';
import {
  ensurePythonRuntime,
  readPythonRuntimeStatus,
  type PythonRuntimeStatus,
} from './python-runtime';
import { AudioFillerController } from './audio-filler';
import {
  VramMutex,
  classifyTrafficLane,
  shouldPreemptLowLane,
  type VramTrafficLane,
} from './vram-mutex';
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

const EXPECTED_MODEL_VERSION = {
  flux_schnell: '2.0',
  sovits_v2pro: '20250604',
} as const;

const MULTIMODAL_TEST_MODE_ENV = 'MIYA_MULTIMODAL_TEST_MODE';
const ASR_TEST_MODE_ENV = 'MIYA_ASR_TEST_MODE';

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

function useAsrTestMode(): boolean {
  const fromMultimodal = String(process.env[MULTIMODAL_TEST_MODE_ENV] ?? '')
    .trim()
    .toLowerCase();
  if (fromMultimodal === '1' || fromMultimodal === 'true' || fromMultimodal === 'yes') {
    return true;
  }
  const fromAsr = String(process.env[ASR_TEST_MODE_ENV] ?? '')
    .trim()
    .toLowerCase();
  return fromAsr === '1' || fromAsr === 'true' || fromAsr === 'yes';
}

interface TaskRuntimeContext {
  jobID: string;
  setTerminator: (input: {
    terminateSoft?: () => void;
    terminateHard?: () => void;
  }) => void;
}

interface TaskRunHooks {
  onJobRunning?: (context: TaskRuntimeContext) => void;
}

export class MiyaDaemonService {
  private readonly projectDir: string;
  private readonly sessionID: string;
  private readonly onProgress?: (event: DaemonJobProgressEvent) => void;
  private readonly signalHub: PsycheNativeSignalHub;
  private readonly psyche: PsycheConsultService;
  private readonly audioFiller: AudioFillerController;
  private readonly vramMutex = new VramMutex();
  private readonly activeTrainingJobIDs = new Set<string>();
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
    this.signalHub = new PsycheNativeSignalHub();
    this.psyche = new PsycheConsultService(projectDir, {
      nativeSignalsProvider: () => this.signalHub.readSnapshot(),
    });
    this.audioFiller = new AudioFillerController(projectDir);
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
    audioCue?: DaemonJobProgressEvent['audioCue'];
  }): void {
    this.onProgress?.({
      jobID: input.jobID,
      kind: input.kind,
      progress: Math.max(0, Math.min(100, Math.floor(input.progress))),
      status: input.status,
      phase: input.phase,
      etaSec: input.etaSec,
      audioCue: input.audioCue,
      updatedAt: nowIso(),
    });
  }

  private maybeEmitAudioFiller(input: {
    jobID: string;
    kind: ResourceTaskKind;
    timeoutMs?: number;
  }): void {
    const decision = this.audioFiller.decide({ kind: input.kind, timeoutMs: input.timeoutMs });
    if (!decision.shouldFill || !decision.cue) return;
    this.emitProgress({
      jobID: input.jobID,
      kind: input.kind,
      progress: 3,
      status: 'AudioFiller',
      phase: 'audio.filler',
      audioCue: {
        cueID: decision.cue.cueID,
        text: decision.cue.text,
        clipPath: decision.cue.clipPath,
        source: decision.cue.source,
        expectedLatencyMs: decision.cue.expectedLatencyMs,
      },
    });
  }

  private async preemptLowLaneIfNeeded(input: {
    kind: ResourceTaskKind;
    lane: VramTrafficLane;
  }): Promise<void> {
    if (!shouldPreemptLowLane(input.lane)) return;
    for (const trainingJobID of this.activeTrainingJobIDs) {
      this.requestTrainingCancel(trainingJobID);
    }
    const targets = this.vramMutex.lowLaneTargets();
    if (targets.length === 0) return;
    for (const target of targets) {
      this.emitProgress({
        jobID: target.daemonJobID,
        kind: target.kind,
        progress: 99,
        status: 'Preempting',
        phase: `preempt.soft_by_${input.kind}`,
      });
      try {
        target.terminateSoft?.();
      } catch {}
      if (target.trainingJobID) {
        this.requestTrainingCancel(target.trainingJobID);
      }
    }
    for (let probe = 0; probe < 8; probe += 1) {
      const pending = targets.some((target) => this.vramMutex.hasActiveJob(target.daemonJobID));
      if (!pending) return;
      await delay(150);
    }
    for (const target of targets) {
      if (!this.vramMutex.hasActiveJob(target.daemonJobID)) continue;
      this.emitProgress({
        jobID: target.daemonJobID,
        kind: target.kind,
        progress: 100,
        status: 'Preempted',
        phase: `preempt.hard_by_${input.kind}`,
      });
      try {
        target.terminateHard?.();
      } catch {}
      if (target.trainingJobID) {
        this.requestTrainingCancel(target.trainingJobID);
      }
    }
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
    this.signalHub.start();
    this.writeRuntimeState('running');
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.signalHub.stop();
    this.writeRuntimeState('stopped');
  }

  runMemoryWorkerTick(): {
    triggered: boolean;
    processedLogs?: number;
    generatedTriplets?: number;
    slowBrain?: SlowBrainRetrainResult;
  } {
    const slowBrain = maybeAutoRetrainSlowBrain(this.projectDir, {
      minIntervalSec: 45 * 60,
      minOutcomes: 30,
      trainingWindow: 800,
    });
    const reflected = maybeAutoReflectCompanionMemory(this.projectDir, {
      idleMinutes: 5,
      minPendingLogs: 1,
      cooldownMinutes: 3,
      maxLogs: 120,
    });
    if (!reflected) return { triggered: false, slowBrain };
    return {
      triggered: true,
      processedLogs: reflected.processedLogs,
      generatedTriplets: reflected.generatedTriplets,
      slowBrain,
    };
  }

  consultPsyche(input: PsycheConsultRequest): PsycheConsultResult {
    return this.psyche.consult(input);
  }

  registerPsycheOutcome(input: PsycheOutcomeRequest): PsycheOutcomeResult {
    return this.psyche.registerOutcome(input);
  }

  getPsycheSignalHubStatus(): PsycheNativeSignalHubStatus {
    return this.signalHub.getStatus();
  }

  getPsycheSlowBrainState(): ReturnType<typeof readSlowBrainState> {
    return readSlowBrainState(this.projectDir);
  }

  retrainPsycheSlowBrain(input?: { force?: boolean; minOutcomes?: number }): SlowBrainRetrainResult {
    return retrainSlowBrainPolicy(this.projectDir, {
      force: input?.force === true,
      minOutcomes: input?.minOutcomes,
      trainingWindow: 800,
    });
  }

  rollbackPsycheSlowBrain(versionID?: string): SlowBrainRollbackResult {
    return rollbackSlowBrainPolicy(this.projectDir, versionID);
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
    hooks?: TaskRunHooks,
  ): Promise<DaemonRunResult<T>> {
    if (!this.started) this.start();
    const scheduler = getResourceScheduler(this.projectDir);
    const lane = classifyTrafficLane(input.kind);
    const trainingJobID =
      typeof input.metadata?.jobID === 'string' ? String(input.metadata.jobID) : undefined;
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
    this.maybeEmitAudioFiller({
      jobID: job.id,
      kind: input.kind,
      timeoutMs:
        typeof input.resource?.timeoutMs === 'number' ? Number(input.resource.timeoutMs) : undefined,
    });
    await this.preemptLowLaneIfNeeded({
      kind: input.kind,
      lane,
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
    this.vramMutex.register({
      daemonJobID: runningJob.id,
      kind: input.kind,
      trainingJobID,
    });
    hooks?.onJobRunning?.({
      jobID: runningJob.id,
      setTerminator: ({ terminateSoft, terminateHard }) => {
        this.vramMutex.updateTerminators(runningJob.id, {
          terminateSoft,
          terminateHard,
        });
      },
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
      this.vramMutex.unregister(runningJob.id);
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
    let childRef: ChildProcess | null = null;
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
          childRef = child;

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
            child.kill('SIGTERM');
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
      {
        onJobRunning: ({ setTerminator }) => {
          setTerminator({
            terminateSoft: () => {
              if (!childRef || childRef.killed) return;
              childRef.kill('SIGTERM');
            },
            terminateHard: () => {
              if (!childRef || childRef.killed) return;
              childRef.kill('SIGKILL');
            },
          });
        },
      },
    );
    return wrapped.result;
  }

  async runFluxImageGenerate(input: {
    prompt: string;
    outputPath: string;
    profileDir: string;
    references: string[];
    size: string;
    model?: string;
  }): Promise<{
    outputPath: string;
    tier: ModelTier;
    degraded: boolean;
    message: string;
  }> {
    const runtime = this.assertPythonRuntimeReady();
    const fluxTarget = this.resolveFluxModelTarget(input.model);
    const tier = this.resolveTierByBudget({
      kind: 'image.generate',
      modelID: fluxTarget.modelID,
      fullTaskVramMB: 1536,
      fullModelVramMB: fluxTarget.fullModelVramMB,
      embeddingTaskVramMB: 768,
      embeddingModelVramMB: fluxTarget.embeddingModelVramMB,
    });
    const modelDir = getMiyaModelPath(this.projectDir, MIYA_MODEL_BRANCH.image);
    const fluxModelDir = fluxTarget.modelDir;
    if (fluxTarget.requiresLock) {
      this.assertModelVersion('flux_schnell', fluxModelDir);
    }
    fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });

    const proc = await this.runModelCommand({
      kind: 'image.generate',
      envKey: 'MIYA_FLUX_GENERATE_CMD',
      pythonPath: runtime.pythonPath,
      scriptPath: path.join(this.projectDir, 'miya-src', 'python', 'infer_flux.py'),
      scriptArgs: [],
      resourceByTier: {
        lora: {
          priority: 100,
          vramMB: 1536,
          modelID: fluxTarget.modelID,
          modelVramMB: fluxTarget.fullModelVramMB,
        },
        embedding: {
          priority: 100,
          vramMB: 768,
          modelID: fluxTarget.modelID,
          modelVramMB: fluxTarget.embeddingModelVramMB,
        },
        reference: { priority: 100, vramMB: 256, modelID: fluxTarget.modelID, modelVramMB: 0 },
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
        MIYA_FLUX_MODEL_ID: fluxTarget.modelID,
        MIYA_FLUX_MODEL_DIR: fluxModelDir,
        MIYA_FLUX2_MODEL_DIR: getMiyaFluxKleinModelDir(this.projectDir),
        MIYA_FLUX_LORA_PATH: path.join(input.profileDir, 'lora', 'lora_weights.safetensors'),
        MIYA_FLUX_EMBED_PATH: path.join(input.profileDir, 'embeddings', 'face_embedding.pt'),
      },
      metadata: { stage: 'daemon.flux.generate', tier, modelID: fluxTarget.modelID },
      progress: {
        jobID: `flux-generate-${Date.now()}`,
        phase: 'image.generate',
        startProgress: 20,
        endProgress: 95,
      },
    });

    if (proc.executed && proc.exitCode === 0 && fs.existsSync(input.outputPath)) {
      return {
        outputPath: input.outputPath,
        tier,
        degraded: tier !== 'lora',
        message: `flux_generate_ok:${fluxTarget.modelID}`,
      };
    }
    throw new Error(
      proc.executed
        ? `flux_generate_failed:${proc.stderr || proc.stdout || proc.exitCode}`
        : 'flux_generate_command_not_configured',
    );
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
    const sovitsModelDir = getMiyaSovitsModelDir(this.projectDir);
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
    throw new Error(
      proc.executed
        ? `sovits_tts_failed:${proc.stderr || proc.stdout || proc.exitCode}`
        : 'sovits_tts_command_not_configured',
    );
  }

  async runAsrTranscribe(input: {
    inputPath: string;
    language?: string;
  }): Promise<{
    text: string;
    language?: string;
    confidence?: number;
    model?: string;
    tier: ModelTier;
    degraded: boolean;
    message: string;
  }> {
    const inputPath = path.resolve(String(input.inputPath ?? '').trim());
    if (!inputPath) throw new Error('asr_input_required');
    if (!fs.existsSync(inputPath)) throw new Error(`asr_input_missing:${inputPath}`);

    if (useAsrTestMode()) {
      return {
        text: `[asr:${path.basename(inputPath)}]`,
        language: input.language?.trim() || 'unknown',
        confidence: 0.81,
        model: 'test:whisper',
        tier: 'reference',
        degraded: true,
        message: 'asr_test_mode',
      };
    }

    const runtime = this.assertPythonRuntimeReady();
    const tier = this.resolveTierByBudget({
      kind: 'voice.asr',
      modelID: 'local:whisper-small',
      fullTaskVramMB: 512,
      fullModelVramMB: 1536,
      embeddingTaskVramMB: 256,
      embeddingModelVramMB: 768,
    });
    const asrModelDir = getMiyaAsrModelDir(this.projectDir);
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    const proc = await this.runModelCommand({
      kind: 'voice.asr',
      envKey: 'MIYA_ASR_CMD',
      pythonPath: runtime.pythonPath,
      scriptPath: path.join(this.projectDir, 'miya-src', 'python', 'infer_asr.py'),
      scriptArgs: ['--input', inputPath],
      resourceByTier: {
        lora: { priority: 95, vramMB: 512, modelID: 'local:whisper-small', modelVramMB: 1536 },
        embedding: { priority: 95, vramMB: 256, modelID: 'local:whisper-small', modelVramMB: 768 },
        reference: { priority: 95, vramMB: 96, modelID: 'local:whisper-small', modelVramMB: 0 },
      },
      tier,
      timeoutMs: 180_000,
      env: {
        MIYA_PARENT_STDIN_MONITOR: '1',
        MIYA_ASR_INPUT_PATH: inputPath,
        MIYA_ASR_LANGUAGE: input.language?.trim() || '',
        MIYA_ASR_MODEL_DIR: asrModelDir,
      },
      metadata: { stage: 'daemon.asr.transcribe', tier },
      progress: {
        jobID: `asr-${Date.now()}`,
        phase: 'voice.asr',
        startProgress: 12,
        endProgress: 95,
      },
    });

    if (!proc.executed || proc.exitCode !== 0) {
      throw new Error(
        proc.executed
          ? `asr_transcribe_failed:${proc.stderr || proc.stdout || proc.exitCode}`
          : 'asr_transcribe_command_not_configured',
      );
    }

    const lines = proc.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    let payload: Record<string, unknown> | null = null;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index] ?? '') as Record<string, unknown>;
        if (typeof parsed === 'object' && parsed && 'ok' in parsed) {
          payload = parsed;
          break;
        }
      } catch {}
    }
    if (!payload || payload.ok !== true) {
      const message =
        typeof payload?.message === 'string'
          ? payload.message
          : proc.stderr || proc.stdout || 'asr_invalid_output';
      throw new Error(`asr_transcribe_failed:${message}`);
    }

    const text = String(payload.text ?? '').trim();
    if (!text) throw new Error('asr_transcribe_failed:empty_text');
    const confidenceRaw = Number(payload.confidence ?? Number.NaN);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, Number(confidenceRaw.toFixed(3))))
      : undefined;
    const language = typeof payload.language === 'string' ? payload.language : undefined;
    const model = typeof payload.model === 'string' ? payload.model : undefined;
    const message =
      typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : 'asr_ok';
    return {
      text,
      language,
      confidence,
      model,
      tier,
      degraded: tier !== 'lora',
      message,
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
    const fluxModelDir = getMiyaFluxModelDir(this.projectDir);
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
    const sovitsModelDir = getMiyaSovitsModelDir(this.projectDir);
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
    });
  }

  private defaultPriority(kind: ResourceTaskKind): number {
    if (kind === 'training.image' || kind === 'training.voice') return 10;
    if (kind === 'voice.tts' || kind === 'image.generate' || kind === 'vision.analyze') {
      return 100;
    }
    return 50;
  }

  private resolveFluxModelTarget(model?: string): {
    variant: 'flux1' | 'flux2';
    modelID: string;
    modelDir: string;
    fullModelVramMB: number;
    embeddingModelVramMB: number;
    requiresLock: boolean;
  } {
    const raw = String(model ?? '').trim().toLowerCase();
    const wantsFlux2 =
      raw.includes('flux.2') || raw.includes('flux2') || raw.includes('klein');
    if (wantsFlux2) {
      return {
        variant: 'flux2',
        modelID: 'local:flux.2-klein',
        modelDir: getMiyaFluxKleinModelDir(this.projectDir),
        fullModelVramMB: 3584,
        embeddingModelVramMB: 1792,
        requiresLock: false,
      };
    }
    return {
      variant: 'flux1',
      modelID: 'local:flux.1-schnell',
      modelDir: getMiyaFluxModelDir(this.projectDir),
      fullModelVramMB: 4096,
      embeddingModelVramMB: 2048,
      requiresLock: true,
    };
  }

  private modelLockTargets(target?: string): Array<{ key: ModelLockKey; dir: string }> {
    const all: Array<{ key: ModelLockKey; dir: string }> = [
      { key: 'flux_schnell', dir: getMiyaFluxModelDir(this.projectDir) },
      { key: 'sovits_v2pro', dir: getMiyaSovitsModelDir(this.projectDir) },
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

  private applyCommandTemplate(
    raw: string,
    placeholders: Record<string, string>,
  ): string {
    let rendered = raw;
    for (const [key, value] of Object.entries(placeholders)) {
      rendered = rendered.replaceAll(`{${key}}`, value);
    }
    return rendered;
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
    const defaultSpec = {
      command: input.pythonPath,
      args: [input.scriptPath, ...(input.scriptArgs ?? [])],
    };
    const commandOverrideRaw = String(process.env[input.envKey] ?? '').trim();
    const overrideSpec =
      commandOverrideRaw.length > 0
        ? this.parseCommandSpec(
            this.applyCommandTemplate(commandOverrideRaw, {
              python: input.pythonPath,
              script: input.scriptPath,
              tier: input.tier,
              projectDir: this.projectDir,
            }),
          )
        : null;
    const command = overrideSpec?.command || defaultSpec.command;
    const args = overrideSpec?.args || defaultSpec.args;
    const resource = input.resourceByTier[input.tier];
    let currentProgress = input.progress?.startProgress ?? 12;
    const proc = await this.runIsolatedProcess({
      kind: input.kind,
      command,
      args,
      cwd: this.projectDir,
      timeoutMs: input.timeoutMs,
      env: input.env,
      metadata: {
        ...input.metadata,
        envKey: input.envKey,
        commandOverride: commandOverrideRaw || undefined,
      },
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
    artifactByTier: Record<ModelTier, string>;
    resourceByTier: Record<ModelTier, { priority: number; vramMB: number; modelID: string; modelVramMB: number }>;
  }): Promise<TrainingRunResult> {
    this.clearTrainingCancel(input.jobID);
    this.activeTrainingJobIDs.add(input.jobID);
    try {
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
            throw new Error(`training_artifact_missing:${artifactPath}`);
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
        if (this.isTrainingCanceled(input.jobID)) {
          return {
            status: 'canceled',
            tier,
            message: 'training_canceled_by_request',
            checkpointPath,
          };
        }
        resumeStep = this.readCheckpointStep(checkpointPath);
      }
      return {
        status: 'failed',
        tier: input.preferredTier,
        message: 'training_failed_all_tiers:external_runner_required',
        checkpointPath,
      };
    } finally {
      this.activeTrainingJobIDs.delete(input.jobID);
    }
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
