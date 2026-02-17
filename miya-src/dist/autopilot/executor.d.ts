import { getSessionState } from '../workflow';
import type { AutopilotRunInput, AutopilotRunResult } from './types';
export declare function configureAutopilotSession(input: {
    projectDir: string;
    sessionID: string;
    maxCycles?: number;
    autoContinue?: boolean;
    strictQualityGate?: boolean;
    enabled: boolean;
}): ReturnType<typeof getSessionState>;
export declare function runAutopilot(input: AutopilotRunInput): AutopilotRunResult;
