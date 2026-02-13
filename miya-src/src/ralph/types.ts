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
  failureKind?: RalphFailureKind;
  failureSummary?: string;
}

export type RalphFailureKind =
  | 'dependency_missing'
  | 'type_error'
  | 'lint_error'
  | 'test_failure'
  | 'permission_denied'
  | 'timeout'
  | 'unknown';

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
  taskCommand?: string;
  fixCommands?: string[];
  workingDirectory?: string;
}

export interface RalphLoopResult {
  success: boolean;
  iterations: number;
  attempts: RalphAttempt[];
  summary: string;
  finalVerification?: RalphCommandResult;
}

