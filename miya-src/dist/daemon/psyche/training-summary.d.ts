export interface PsycheTrainingSummary {
    windowRows: number;
    observations: number;
    outcomes: number;
    decisions: {
        allow: number;
        defer: number;
        deny: number;
    };
    outcomesSummary: {
        positive: number;
        negative: number;
        avgScore: number;
        positiveRate: number;
    };
    resonance: {
        safeHoldDefers: number;
        probeRequested: number;
        falseIdleRiskSignals: number;
        drmCaptureBlockedSignals: number;
    };
    generatedAt: string;
}
export declare function readPsycheTrainingSummary(projectDir: string, limit?: number): PsycheTrainingSummary;
