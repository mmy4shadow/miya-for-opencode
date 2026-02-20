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
export declare class MiyaClient {
    private readonly projectDir;
    constructor(projectDir: string);
    runFluxImageGenerate(input: {
        prompt: string;
        outputPath: string;
        profileDir: string;
        references: string[];
        size: string;
    }): Promise<{
        outputPath: string;
        tier: 'lora' | 'embedding' | 'reference';
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
        tier: 'lora' | 'embedding' | 'reference';
        degraded: boolean;
        message: string;
    }>;
    runFluxTraining(input: {
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
    }>;
    runSovitsTraining(input: {
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
    }>;
    requestTrainingCancel(jobID: string): Promise<void>;
    getPythonRuntimeStatus(): Promise<unknown>;
    getModelLockStatus(): Promise<unknown>;
    getModelUpdatePlan(target?: string): Promise<unknown>;
    applyModelUpdate(target?: string): Promise<unknown>;
    runIsolatedProcess(input: IsolatedProcessInput): Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }>;
    psycheConsult(input: {
        intent: string;
        urgency?: 'low' | 'medium' | 'high' | 'critical';
        channel?: string;
        userInitiated?: boolean;
        allowScreenProbe?: boolean;
        signals?: SentinelSignals;
        captureLimitations?: string[];
        trust?: {
            target?: string;
            source?: string;
            action?: string;
            evidenceConfidence?: number;
        };
    }): Promise<PsycheConsultResult>;
    psycheOutcome(input: {
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
    }): Promise<PsycheOutcomeResult>;
}
export declare function getMiyaClient(projectDir: string): MiyaClient;
export {};
