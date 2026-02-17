export interface TurnEvidencePack {
    turnID: string;
    at: string;
    sessionID: string;
    source: string;
    modeKernel: {
        mode: 'work' | 'chat' | 'mixed';
        confidence: number;
        why: string[];
    };
    arbiter: {
        mode: 'work' | 'chat' | 'mixed';
        executeWork: boolean;
        rightBrainSuppressed: boolean;
        priorityTrail: string[];
        why: string[];
    };
    tracks: {
        work: {
            planned: boolean;
            executed: boolean;
        };
        emotional: {
            planned: boolean;
            executed: boolean;
        };
    };
    outcome: {
        delivered: boolean;
        queued: boolean;
        reason?: string;
    };
    leftBrain?: Record<string, unknown>;
    rightBrain?: Record<string, unknown>;
    routing?: Record<string, unknown>;
    contextPipeline?: {
        lowConfidenceSafeFallback?: boolean;
        personaWorldPromptInjected?: boolean;
        learningInjected?: boolean;
        retryDeltaApplied?: boolean;
        hardCapApplied?: boolean;
    };
}
export declare function appendTurnEvidencePack(projectDir: string, pack: TurnEvidencePack): void;
