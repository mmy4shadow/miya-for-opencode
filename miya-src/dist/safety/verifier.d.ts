import type { PluginInput } from '@opencode-ai/plugin';
import { type SafetyTier } from './tier';
export interface VerifierInput {
    sessionID: string;
    traceID: string;
    requestHash: string;
    tier: SafetyTier;
    action: string;
    checks: string[];
    evidence: string[];
    issues: string[];
}
export interface VerifierResult {
    verdict: 'allow' | 'deny';
    summary: string;
    raw: string;
}
export declare function runVerifier(ctx: PluginInput, input: VerifierInput): Promise<VerifierResult>;
