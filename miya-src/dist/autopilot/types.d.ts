export interface AutopilotPlanStep {
    id: string;
    title: string;
    kind: 'analysis' | 'execution' | 'verification';
    command?: string;
    done: boolean;
    note?: string;
}
export interface AutopilotPlan {
    goal: string;
    createdAt: string;
    steps: AutopilotPlanStep[];
}
export interface AutopilotCommandResult {
    command: string;
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
}
export interface AutopilotRunInput {
    goal: string;
    commands: string[];
    verificationCommand?: string;
    timeoutMs: number;
    workingDirectory?: string;
}
export interface AutopilotRunResult {
    success: boolean;
    summary: string;
    plan: AutopilotPlan;
    execution: AutopilotCommandResult[];
    verification?: AutopilotCommandResult;
}
