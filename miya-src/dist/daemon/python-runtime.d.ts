export interface PythonRuntimeDiagnostics {
    ok: boolean;
    issues: string[];
    torch?: Record<string, unknown>;
    paths?: Record<string, unknown>;
    binaries?: Record<string, unknown>;
    min_vram_mb?: number;
}
export interface PythonDependencyRecommendation {
    package: string;
    recommendedVersion: string;
    reason: string;
    command: string;
}
export interface PythonRuntimeRepairPlan {
    issueType: 'ok' | 'no_gpu' | 'dependency_fault';
    warnings: string[];
    recommendations: PythonDependencyRecommendation[];
    conflicts: string[];
    oneShotCommand?: string;
    opencodeAssistPrompt?: string;
}
export type PythonBootstrapStage = 'venv' | 'pip' | 'check_env';
export interface PythonRuntimeBootstrapState {
    state: 'idle' | 'running' | 'ok' | 'failed';
    stage: PythonBootstrapStage;
    attempts: number;
    history: Array<{
        stage: PythonBootstrapStage;
        ok: boolean;
        at: string;
        error?: string;
    }>;
    lastError?: string;
}
export interface PythonRuntimeStatus {
    ready: boolean;
    venvPath: string;
    pythonPath: string;
    diagnostics?: PythonRuntimeDiagnostics;
    bootstrap?: PythonRuntimeBootstrapState;
    trainingDisabledReason?: 'no_gpu' | 'dependency_fault';
    repairPlan?: PythonRuntimeRepairPlan;
    updatedAt: string;
}
export declare function venvDir(projectDir: string): string;
export declare function venvPythonPath(projectDir: string): string;
export declare function readPythonRuntimeStatus(projectDir: string): PythonRuntimeStatus | null;
export declare function ensurePythonRuntime(projectDir: string): PythonRuntimeStatus;
