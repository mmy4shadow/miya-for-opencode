export type StrategyExperimentKey = 'routing' | 'memory_write' | 'approval_threshold';
export type StrategyVariant = 'control' | 'treatment' | 'disabled';
export interface StrategyExperimentRule {
    enabled: boolean;
    rolloutPercent: number;
}
export interface StrategyExperimentConfig {
    routing: StrategyExperimentRule;
    memory_write: StrategyExperimentRule;
    approval_threshold: StrategyExperimentRule;
}
export interface StrategyObservation {
    at: string;
    experiment: StrategyExperimentKey;
    variant: StrategyVariant;
    subjectID: string;
    success: boolean;
    costUsd?: number;
    riskScore?: number;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
}
export declare function readStrategyExperimentConfig(projectDir: string): StrategyExperimentConfig;
export declare function writeStrategyExperimentConfig(projectDir: string, patch: Partial<StrategyExperimentConfig>): StrategyExperimentConfig;
export declare function resolveStrategyVariant(projectDir: string, experiment: StrategyExperimentKey, subjectID: string): StrategyVariant;
export declare function recordStrategyObservation(projectDir: string, input: Omit<StrategyObservation, 'at'> & {
    at?: string;
}): StrategyObservation;
export declare function summarizeStrategyObservations(projectDir: string, limit?: number): Record<StrategyExperimentKey, {
    total: number;
    byVariant: Record<StrategyVariant, {
        total: number;
        successRate: number;
        avgCostUsd: number;
        avgRisk: number;
    }>;
}>;
export declare function replayStrategyOffline(projectDir: string, input?: {
    limit?: number;
}): {
    config: StrategyExperimentConfig;
    summary: ReturnType<typeof summarizeStrategyObservations>;
};
