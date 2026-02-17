export type PlanBundleBindingStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'canceled';
export interface PlanBundleBindingRecord {
    sessionID: string;
    bundleId: string;
    sourceTool: 'miya_autopilot' | 'miya_autoflow';
    mode: 'work' | 'chat' | 'mixed' | 'subagent';
    riskTier: 'LIGHT' | 'STANDARD' | 'THOROUGH';
    policyHash: string;
    status: PlanBundleBindingStatus;
    createdAt: string;
    updatedAt: string;
}
export declare function readPlanBundleBinding(projectDir: string, sessionID: string): PlanBundleBindingRecord | null;
export declare function preparePlanBundleBinding(projectDir: string, input: {
    sessionID: string;
    bundleId: string;
    sourceTool: 'miya_autopilot' | 'miya_autoflow';
    mode?: 'work' | 'chat' | 'mixed' | 'subagent';
    riskTier?: 'LIGHT' | 'STANDARD' | 'THOROUGH';
    policyHash: string;
}): PlanBundleBindingRecord;
export declare function updatePlanBundleBindingStatus(projectDir: string, input: {
    sessionID: string;
    status: PlanBundleBindingStatus;
    bundleId?: string;
}): PlanBundleBindingRecord | null;
export declare function clearPlanBundleBinding(projectDir: string, sessionID: string): void;
