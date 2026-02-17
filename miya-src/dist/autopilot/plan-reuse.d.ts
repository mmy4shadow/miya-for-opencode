import type { AutopilotPlan, PlanBundleMode, PlanBundleRiskTier } from './types';
export declare function buildPlanBundleTaskSignature(input: {
    goal: string;
    commands: string[];
    verificationCommand?: string;
    workingDirectory?: string;
    mode?: PlanBundleMode;
    riskTier?: PlanBundleRiskTier;
}): string;
export declare function loadReusablePlanTemplate(input: {
    projectDir: string;
    signature: string;
    goal: string;
}): {
    plan: AutopilotPlan;
    templateId: string;
    hits: number;
} | null;
export declare function saveReusablePlanTemplate(input: {
    projectDir: string;
    signature: string;
    plan: AutopilotPlan;
    commandCount: number;
    verificationEnabled: boolean;
    bundleId: string;
}): void;
