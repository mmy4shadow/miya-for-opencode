import { daemonInvoke, ensureMiyaLauncher } from './launcher';
import type { ResourceTaskKind } from '../resource-scheduler';
import type { PsycheConsultResult, PsycheOutcomeResult, SentinelSignals } from './psyche';

interface IsolatedProcessInput {
  kind: ResourceTaskKind;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  resource?: {
    priority?: number;
    vramMB?: number;
    modelID?: string;
    modelVramMB?: number;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

export class MiyaClient {
  constructor(private readonly projectDir: string) {
    ensureMiyaLauncher(projectDir);
  }

  async runFluxImageGenerate(input: {
    prompt: string;
    outputPath: string;
    profileDir: string;
    model?: string;
    references: string[];
    size: string;
  }): Promise<{ outputPath: string; tier: 'lora' | 'embedding' | 'reference'; degraded: boolean; message: string }> {
    return daemonInvoke(
      this.projectDir,
      'daemon.flux.generate',
      input as unknown as Record<string, unknown>,
      240_000,
    ) as Promise<{ outputPath: string; tier: 'lora' | 'embedding' | 'reference'; degraded: boolean; message: string }>;
  }

  async runSovitsTts(input: {
    text: string;
    outputPath: string;
    profileDir: string;
    voice: string;
    format: 'wav' | 'mp3' | 'ogg';
  }): Promise<{ outputPath: string; tier: 'lora' | 'embedding' | 'reference'; degraded: boolean; message: string }> {
    return daemonInvoke(
      this.projectDir,
      'daemon.sovits.tts',
      input as unknown as Record<string, unknown>,
      180_000,
    ) as Promise<{ outputPath: string; tier: 'lora' | 'embedding' | 'reference'; degraded: boolean; message: string }>;
  }

  async runAsrTranscribe(input: {
    inputPath: string;
    language?: string;
  }): Promise<{
    text: string;
    language?: string;
    confidence?: number;
    model?: string;
    tier: 'lora' | 'embedding' | 'reference';
    degraded: boolean;
    message: string;
  }> {
    return daemonInvoke(
      this.projectDir,
      'daemon.asr.transcribe',
      input as unknown as Record<string, unknown>,
      180_000,
    ) as Promise<{
      text: string;
      language?: string;
      confidence?: number;
      model?: string;
      tier: 'lora' | 'embedding' | 'reference';
      degraded: boolean;
      message: string;
    }>;
  }

  async runFluxTraining(input: {
    profileDir: string;
    photosDir: string;
    jobID: string;
    checkpointPath?: string;
  }): Promise<{
    status: 'completed' | 'degraded' | 'failed' | 'canceled';
    tier: 'lora' | 'embedding' | 'reference';
    message: string;
    artifactPath?: string;
    checkpointPath?: string;
  }> {
    return daemonInvoke(
      this.projectDir,
      'daemon.training.flux',
      input as unknown as Record<string, unknown>,
      35 * 60_000,
    ) as Promise<{
      status: 'completed' | 'degraded' | 'failed' | 'canceled';
      tier: 'lora' | 'embedding' | 'reference';
      message: string;
      artifactPath?: string;
      checkpointPath?: string;
    }>;
  }

  async runSovitsTraining(input: {
    profileDir: string;
    voiceSamplePath: string;
    jobID: string;
    checkpointPath?: string;
  }): Promise<{
    status: 'completed' | 'degraded' | 'failed' | 'canceled';
    tier: 'lora' | 'embedding' | 'reference';
    message: string;
    artifactPath?: string;
    checkpointPath?: string;
  }> {
    return daemonInvoke(
      this.projectDir,
      'daemon.training.sovits',
      input as unknown as Record<string, unknown>,
      35 * 60_000,
    ) as Promise<{
      status: 'completed' | 'degraded' | 'failed' | 'canceled';
      tier: 'lora' | 'embedding' | 'reference';
      message: string;
      artifactPath?: string;
      checkpointPath?: string;
    }>;
  }

  async requestTrainingCancel(jobID: string): Promise<void> {
    await daemonInvoke(this.projectDir, 'daemon.training.cancel', { jobID }, 15_000);
  }

  async getPythonRuntimeStatus(): Promise<unknown> {
    return daemonInvoke(this.projectDir, 'daemon.python.env.get', {}, 15_000);
  }

  async getModelLockStatus(): Promise<unknown> {
    return daemonInvoke(this.projectDir, 'daemon.model.locks.get', {}, 15_000);
  }

  async getModelUpdatePlan(target?: string): Promise<unknown> {
    return daemonInvoke(
      this.projectDir,
      'daemon.model.update.plan',
      target ? { target } : {},
      20_000,
    );
  }

  async applyModelUpdate(target?: string): Promise<unknown> {
    return daemonInvoke(
      this.projectDir,
      'daemon.model.update.apply',
      target ? { target } : {},
      30_000,
    );
  }

  async runIsolatedProcess(input: IsolatedProcessInput): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }> {
    return daemonInvoke(
      this.projectDir,
      'daemon.process.run_isolated',
      input as unknown as Record<string, unknown>,
      Math.max(30_000, input.timeoutMs ?? 120_000) + 10_000,
    ) as Promise<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>;
  }

  async psycheConsult(input: {
    intent: string;
    urgency?: 'low' | 'medium' | 'high' | 'critical';
    channel?: string;
    userInitiated?: boolean;
    allowScreenProbe?: boolean;
    allowSignalOverride?: boolean;
    signals?: SentinelSignals;
    captureLimitations?: string[];
    trust?: {
      target?: string;
      source?: string;
      action?: string;
      evidenceConfidence?: number;
    };
  }): Promise<PsycheConsultResult> {
    return daemonInvoke(
      this.projectDir,
      'daemon.psyche.consult',
      input as unknown as Record<string, unknown>,
      15_000,
    ) as Promise<PsycheConsultResult>;
  }

  async psycheOutcome(input: {
    consultAuditID: string;
    intent: string;
    urgency?: 'low' | 'medium' | 'high' | 'critical';
    channel?: string;
    userInitiated?: boolean;
    state: 'FOCUS' | 'CONSUME' | 'PLAY' | 'AWAY' | 'UNKNOWN';
    delivered: boolean;
    blockedReason?: string;
    explicitFeedback?: 'positive' | 'negative' | 'none';
    userReplyWithinSec?: number;
    userInitiatedWithinSec?: number;
    trust?: {
      target?: string;
      source?: string;
      action?: string;
      evidenceConfidence?: number;
      highRiskRollback?: boolean;
    };
  }): Promise<PsycheOutcomeResult> {
    return daemonInvoke(
      this.projectDir,
      'daemon.psyche.outcome',
      input as unknown as Record<string, unknown>,
      15_000,
    ) as Promise<PsycheOutcomeResult>;
  }

  async psycheSignalsGet(): Promise<unknown> {
    return daemonInvoke(this.projectDir, 'daemon.psyche.signals.get', {}, 10_000);
  }

  async psycheSlowBrainGet(): Promise<unknown> {
    return daemonInvoke(this.projectDir, 'daemon.psyche.slowbrain.get', {}, 10_000);
  }

  async psycheSlowBrainRetrain(input?: {
    force?: boolean;
    minOutcomes?: number;
  }): Promise<unknown> {
    return daemonInvoke(
      this.projectDir,
      'daemon.psyche.slowbrain.retrain',
      {
        force: input?.force === true,
        minOutcomes:
          typeof input?.minOutcomes === 'number' && Number.isFinite(input.minOutcomes)
            ? input.minOutcomes
            : undefined,
      },
      20_000,
    );
  }

  async psycheSlowBrainRollback(versionID?: string): Promise<unknown> {
    return daemonInvoke(
      this.projectDir,
      'daemon.psyche.slowbrain.rollback',
      { versionID: versionID?.trim() || undefined },
      15_000,
    );
  }
}

const clients = new Map<string, MiyaClient>();

export function getMiyaClient(projectDir: string): MiyaClient {
  const existing = clients.get(projectDir);
  if (existing) return existing;
  const created = new MiyaClient(projectDir);
  clients.set(projectDir, created);
  return created;
}
