import { getLearningStats } from '../learning';
export interface CompanionLearningMetricsTargets {
    maxModeMisclassificationRate: number;
    minCorrectionConvergenceRate: number;
    minMemoryHitRate: number;
}
export interface CompanionLearningMetricsSnapshot {
    generatedAt: string;
    totals: {
        memories: number;
        activeMemories: number;
        pendingMemories: number;
        preferenceMemories: number;
        corrections: number;
        correctionsResolved: number;
        correctionsRejected: number;
        correctionsPending: number;
    };
    rates: {
        modeMisclassificationRate: number;
        correctionConvergenceRate: number;
        memoryHitRate: number;
        negativeFeedbackRate: number;
    };
    learningDrafts: ReturnType<typeof getLearningStats>;
    targets: CompanionLearningMetricsTargets;
    checks: {
        modeMisclassificationRate: boolean;
        correctionConvergenceRate: boolean;
        memoryHitRate: boolean;
        pass: boolean;
    };
}
interface CompanionLearningMetricsInput {
    maxModeMisclassificationRate?: number;
    minCorrectionConvergenceRate?: number;
    minMemoryHitRate?: number;
}
export declare function readCompanionLearningMetrics(projectDir: string, input?: CompanionLearningMetricsInput): CompanionLearningMetricsSnapshot;
export {};
