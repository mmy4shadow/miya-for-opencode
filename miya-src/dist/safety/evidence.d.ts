import type { SafetyTier } from './tier';
export interface SafetyEvidenceResult {
    pass: boolean;
    checks: string[];
    evidence: string[];
    issues: string[];
}
export declare function collectSafetyEvidence(projectDir: string, tier: SafetyTier): Promise<SafetyEvidenceResult>;
