import type { UltraworkDagResult } from '../ultrawork/scheduler';
import type { UltraworkTaskInput } from '../ultrawork/types';

export type AutoflowPhase =
  | 'planning'
  | 'execution'
  | 'verification'
  | 'fixing'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface AutoflowRuntimeTask {
  id: string;
  agent: string;
  status: string;
  completedAt?: Date;
}

export interface AutoflowManager {
  launch(input: {
    agent: string;
    prompt: string;
    description: string;
    parentSessionId: string;
  }): AutoflowRuntimeTask;
  waitForCompletion(taskID: string, timeoutMs?: number): Promise<AutoflowRuntimeTask | null>;
  getResult(taskID: string): AutoflowRuntimeTask | null;
  cancel(taskID?: string): number;
}

export interface AutoflowCommandResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AutoflowHistoryRecord {
  at: string;
  phase: AutoflowPhase;
  event: string;
  summary: string;
}

export interface AutoflowDagSummary {
  total: number;
  completed: number;
  failed: number;
  blocked: number;
}

export interface AutoflowSessionState {
  sessionID: string;
  goal: string;
  phase: AutoflowPhase;
  createdAt: string;
  updatedAt: string;
  maxFixRounds: number;
  fixRound: number;
  verificationCommand?: string;
  fixCommands: string[];
  planTasks: UltraworkTaskInput[];
  recentVerificationHashes: string[];
  lastError?: string;
  lastDag?: AutoflowDagSummary;
  history: AutoflowHistoryRecord[];
}

export interface AutoflowStateFile {
  sessions: Record<string, AutoflowSessionState>;
}

export interface AutoflowRunInput {
  projectDir: string;
  sessionID: string;
  manager: AutoflowManager;
  goal?: string;
  tasks?: UltraworkTaskInput[];
  verificationCommand?: string;
  fixCommands?: string[];
  maxFixRounds?: number;
  maxParallel?: number;
  timeoutMs?: number;
  workingDirectory?: string;
  forceRestart?: boolean;
  runDag?: (input: {
    manager: AutoflowManager;
    parentSessionID: string;
    tasks: UltraworkTaskInput[];
    maxParallel?: number;
  }) => Promise<UltraworkDagResult>;
  runCommand?: (
    command: string,
    timeoutMs: number,
    cwd?: string,
  ) => AutoflowCommandResult;
}

export interface AutoflowRunResult {
  success: boolean;
  phase: AutoflowPhase;
  summary: string;
  state: AutoflowSessionState;
  dagResult?: UltraworkDagResult;
  verification?: AutoflowCommandResult;
  fixResult?: AutoflowCommandResult;
}
