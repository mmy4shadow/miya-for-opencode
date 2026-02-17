export interface ProbeBudgetConfig {
    capacity: number;
    refillPerSec: number;
}
export declare function consumeProbeBudget(filePath: string, config: ProbeBudgetConfig, nowMs?: number): {
    allowed: boolean;
    remainingTokens: number;
};
