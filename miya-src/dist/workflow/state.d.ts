export interface MiyaSessionState {
    loopEnabled: boolean;
    autoContinue: boolean;
    maxIterationsPerWindow: number;
    iterationCompleted: number;
    windowStartIteration: number;
    awaitingConfirmation: boolean;
    strictQualityGate: boolean;
    lastDone: string[];
    lastMissing: string[];
    lastUnresolved: string[];
    autoContinueIteration: number;
    autoContinueAt: string;
    updatedAt: string;
}
export declare function getMiyaRuntimeDir(projectDir: string): string;
export declare function getSessionState(projectDir: string, sessionID: string): MiyaSessionState;
export declare function setSessionState(projectDir: string, sessionID: string, sessionState: MiyaSessionState): void;
export declare function resetSessionState(projectDir: string, sessionID: string): void;
export declare function isPositiveConfirmation(text: string): boolean;
export declare function isNegativeConfirmation(text: string): boolean;
export declare function shouldEnableStrictQualityGate(text: string): boolean;
