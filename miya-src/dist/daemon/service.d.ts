import type { ResourceTaskKind } from '../resource-scheduler';
import { readSlowBrainState, type PsycheConsultRequest, type PsycheConsultResult, type PsycheOutcomeRequest, type PsycheOutcomeResult, type PsycheNativeSignalHubStatus, type SlowBrainRetrainResult, type SlowBrainRollbackResult } from './psyche';
import { type PythonRuntimeStatus } from './python-runtime';
import type { DaemonJobProgressEvent, DaemonJobRequest, DaemonRunResult } from './types';
type ModelTier = 'lora' | 'embedding' | 'reference';
interface TrainingRunResult {
    status: 'completed' | 'degraded' | 'failed' | 'canceled';
    tier: ModelTier;
    message: string;
    artifactPath?: string;
    checkpointPath?: string;
}
declare const EXPECTED_MODEL_VERSION: {
    readonly flux_schnell: "2.0";
    readonly sovits_v2pro: "20250604";
};
type ModelLockKey = keyof typeof EXPECTED_MODEL_VERSION;
interface ModelUpdatePlanItem {
    model: ModelLockKey;
    expected: string;
    actual?: string;
    ok: boolean;
    reason?: string;
    metadataFile: string;
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
export declare class MiyaDaemonService {
    private readonly projectDir;
    private readonly sessionID;
    private readonly onProgress?;
    private readonly signalHub;
    private readonly psyche;
    private readonly audioFiller;
    private readonly vramMutex;
    private readonly activeTrainingJobIDs;
    private started;
    private startedAtIso;
    private pythonRuntime?;
    constructor(projectDir: string, options?: {
        onProgress?: (event: DaemonJobProgressEvent) => void;
    });
    private cancelMarkerPath;
    requestTrainingCancel(jobID: string): void;
    private clearTrainingCancel;
    private isTrainingCanceled;
    private emitProgress;
    private maybeEmitAudioFiller;
    private preemptLowLaneIfNeeded;
    private getPythonRuntime;
    getPythonRuntimeStatus(): PythonRuntimeStatus | null;
    private assertPythonRuntimeReady;
    private assertTrainingAllowed;
    private assertModelVersion;
    start(): void;
    stop(): void;
    runMemoryWorkerTick(): {
        triggered: boolean;
        processedLogs?: number;
        generatedTriplets?: number;
        slowBrain?: SlowBrainRetrainResult;
    };
    consultPsyche(input: PsycheConsultRequest): PsycheConsultResult;
    registerPsycheOutcome(input: PsycheOutcomeRequest): PsycheOutcomeResult;
    getPsycheSignalHubStatus(): PsycheNativeSignalHubStatus;
    getPsycheSlowBrainState(): ReturnType<typeof readSlowBrainState>;
    retrainPsycheSlowBrain(input?: {
        force?: boolean;
        minOutcomes?: number;
    }): SlowBrainRetrainResult;
    rollbackPsycheSlowBrain(versionID?: string): SlowBrainRollbackResult;
    getModelLockStatus(): Record<string, {
        expected: string;
        ok: boolean;
        reason?: string;
    }>;
    getModelUpdatePlan(target?: string): {
        items: ModelUpdatePlanItem[];
        pending: number;
    };
    applyModelUpdate(target?: string): {
        updated: Array<{
            model: ModelLockKey;
            metadataFile: string;
            expected: string;
        }>;
        skipped: Array<{
            model: ModelLockKey;
            reason: string;
        }>;
    };
    runTask<T>(input: DaemonJobRequest, fn: () => Promise<T> | T, hooks?: TaskRunHooks): Promise<DaemonRunResult<T>>;
    runIsolatedProcess(input: {
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
    }>;
    runFluxImageGenerate(input: {
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
    }>;
    runSovitsTts(input: {
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
    }>;
    runAsrTranscribe(input: {
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
    }>;
    runFluxTraining(input: {
        profileDir: string;
        photosDir: string;
        jobID: string;
        checkpointPath?: string;
    }): Promise<TrainingRunResult>;
    runSovitsTraining(input: {
        profileDir: string;
        voiceSamplePath: string;
        jobID: string;
        checkpointPath?: string;
    }): Promise<TrainingRunResult>;
    private defaultPriority;
    private resolveFluxModelTarget;
    private modelLockTargets;
    private resolveTierByBudget;
    private parseCommandSpec;
    private applyCommandTemplate;
    private runModelCommand;
    private runTieredTraining;
    private readCheckpointStep;
    private writeRuntimeState;
}
export {};
