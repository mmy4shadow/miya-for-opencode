export type RalphStepType = 'task' | 'verify' | 'fix';
export interface RalphCommandResult {
    command: string;
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
}
export interface RalphAttempt {
    iteration: number;
    type: RalphStepType;
    result: RalphCommandResult;
    fingerprint?: string;
    diffHash?: string;
    stderrHash?: string;
    errorSimilarity?: number;
    noProgress?: boolean;
    failureKind?: RalphFailureKind;
    failureSummary?: string;
}
export type RalphFailureKind = 'dependency_missing' | 'type_error' | 'lint_error' | 'test_failure' | 'permission_denied' | 'timeout' | 'unknown';
export interface RalphFailureAnalysis {
    kind: RalphFailureKind;
    summary: string;
    suggestedFixes: string[];
}
export interface RalphLoopInput {
    taskDescription: string;
    verificationCommand: string;
    maxIterations: number;
    timeoutMs: number;
    budgetMs?: number;
    stallWindow?: number;
    errorSimilarityThreshold?: number;
    sameLineTouchLimit?: number;
    taskCommand?: string;
    fixCommands?: string[];
    workingDirectory?: string;
    runCommand?: (command: string, timeoutMs: number, cwd?: string) => RalphCommandResult;
    readDiff?: (cwd?: string) => string;
}
export interface RalphLoopResult {
    success: boolean;
    iterations: number;
    attempts: RalphAttempt[];
    summary: string;
    finalVerification?: RalphCommandResult;
    reason?: 'verified' | 'no_fix_command' | 'cycle_detected' | 'no_progress' | 'same_line_churn' | 'budget_exceeded' | 'max_iterations_reached';
}
