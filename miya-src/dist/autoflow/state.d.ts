import type { AutoflowFixStep, AutoflowPhase, AutoflowSessionState } from './types';
export declare function loadAutoflowSession(projectDir: string, sessionID: string): AutoflowSessionState | null;
export declare function listAutoflowSessions(projectDir: string, limit?: number): AutoflowSessionState[];
export declare function getAutoflowSession(projectDir: string, sessionID: string): AutoflowSessionState;
export declare function saveAutoflowSession(projectDir: string, session: AutoflowSessionState): AutoflowSessionState;
export declare function appendAutoflowHistory(session: AutoflowSessionState, event: string, summary: string): AutoflowSessionState;
export declare function configureAutoflowSession(projectDir: string, input: {
    sessionID: string;
    goal?: string;
    tasks?: AutoflowSessionState['planTasks'];
    verificationCommand?: string;
    fixCommands?: string[];
    fixSteps?: AutoflowFixStep[];
    maxFixRounds?: number;
    phase?: AutoflowPhase;
}): AutoflowSessionState;
export declare function stopAutoflowSession(projectDir: string, sessionID: string): AutoflowSessionState;
