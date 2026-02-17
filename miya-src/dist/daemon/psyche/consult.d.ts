import { type SentinelSignals, type SentinelState } from './state-machine';
import { type NativeSentinelSignalSample } from './sensors';
import { type ScreenProbeResult } from './screen-probe';
import { type TrustTier } from './trust';
export type PsycheUrgency = 'low' | 'medium' | 'high' | 'critical';
export type PsycheDecision = 'allow' | 'defer' | 'deny';
export interface PsycheConsultRequest {
    intent: string;
    urgency?: PsycheUrgency;
    channel?: string;
    userInitiated?: boolean;
    allowScreenProbe?: boolean;
    allowSignalOverride?: boolean;
    signals?: SentinelSignals;
    captureLimitations?: string[];
    trust?: {
        target?: string;
        source?: string;
        action?: string;
        evidenceConfidence?: number;
    };
}
export type PsycheApprovalMode = 'silent_audit' | 'toast_gate' | 'modal_approval';
export type PsycheFixability = 'impossible' | 'rewrite' | 'reduce_scope' | 'need_evidence' | 'retry_later';
export interface PsycheRiskSummary {
    falseIdleUncertain: boolean;
    drmCaptureBlocked: boolean;
    probeRateLimited: boolean;
    probeRequested: boolean;
}
export interface PsycheConsultResult {
    auditID: string;
    at: string;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
    state: SentinelState;
    confidence: number;
    decision: PsycheDecision;
    allowed: boolean;
    reason: string;
    nextCheckSec: number;
    retryAfterSec: number;
    shouldProbeScreen: boolean;
    reasons: string[];
    approvalMode: PsycheApprovalMode;
    fixability: PsycheFixability;
    budget: {
        autoRetry: number;
        humanEdit: number;
    };
    trust: {
        target: number;
        source: number;
        action: number;
        minScore: number;
        tier: TrustTier;
    };
    risk: PsycheRiskSummary;
    resonance: {
        score: number;
        semanticFocus: number;
        momentum: number;
        styleTags: string[];
    };
    slowBrain: {
        versionID: string;
        consumeAllowThreshold: number;
        awayAllowThreshold: number;
        deferRetryBaseSec: number;
    };
    insightText: string;
}
export interface PsycheOutcomeRequest {
    consultAuditID: string;
    intent: string;
    urgency?: PsycheUrgency;
    channel?: string;
    userInitiated?: boolean;
    state: SentinelState;
    delivered: boolean;
    blockedReason?: string;
    explicitFeedback?: 'positive' | 'negative' | 'none';
    userReplyWithinSec?: number;
    userInitiatedWithinSec?: number;
    trust?: {
        target?: string;
        source?: string;
        action?: string;
        evidenceConfidence?: number;
        highRiskRollback?: boolean;
    };
}
export interface PsycheOutcomeResult {
    at: string;
    consultAuditID: string;
    reward: 'positive' | 'negative';
    score: number;
    bucket: string;
}
interface RandomSource {
    next(): number;
}
type NativeSignalProvider = () => NativeSentinelSignalSample;
type ScreenProbeProvider = (input: {
    intent: string;
    channel?: string;
    timeoutMs?: number;
}) => ScreenProbeResult;
export declare class PsycheConsultService {
    private readonly projectDir;
    private readonly fastBrainPath;
    private readonly consultLogPath;
    private readonly budgetPath;
    private readonly probeBudgetPath;
    private readonly trainingDataLogPath;
    private readonly trustPath;
    private readonly lifecyclePath;
    private readonly epsilon;
    private readonly shadowModeDays;
    private readonly random;
    private readonly delayedPenaltyApplied;
    private readonly nativeSignalsProvider;
    private readonly screenProbeProvider;
    constructor(projectDir: string, options?: {
        epsilon?: number;
        shadowModeDays?: number;
        random?: RandomSource;
        nativeSignalsProvider?: NativeSignalProvider;
        screenProbeProvider?: ScreenProbeProvider;
    });
    consult(input: PsycheConsultRequest): PsycheConsultResult;
    registerOutcome(input: PsycheOutcomeRequest): PsycheOutcomeResult;
    private pickDecision;
    private resolveFixability;
    private computeResonanceProfile;
    private resolveApprovalMode;
    private resolveNegotiationBudget;
    private buildInsightText;
    private buildReason;
    private appendConsultLog;
    private safeReadNativeSignals;
    private safeRunScreenProbe;
    private resolveProbeTimeoutMs;
    private probeBudgetConfig;
    private resolveEpsilonFromEnv;
    private shouldExplore;
    private resolveShadowModeDays;
    private ensureLifecycleState;
    private readLifecycleState;
    private isShadowModeActive;
    private normalizeCaptureLimitations;
    private resolveRisk;
    private resolveNextCheckSec;
    private applyMissedOpportunityPenalty;
    private findRecentDeferredConsult;
    private outcomeScore;
    private applyInterruptionBudget;
    private readBudgetStore;
}
export {};
