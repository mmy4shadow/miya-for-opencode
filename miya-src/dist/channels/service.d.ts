import { sendQqDesktopMessage } from '../channel/outbound/qq';
import { sendWechatDesktopMessage } from '../channel/outbound/wechat';
import { analyzeDesktopOutboundEvidence } from '../multimodal/vision';
import { type SemanticTag } from '../policy/semantic-tags';
import { ensurePairRequest } from './pairing-store';
import type { ChannelName } from './types';
export interface ChannelInboundMessage {
    channel: ChannelName;
    senderID: string;
    displayName?: string;
    conversationID: string;
    text: string;
    raw?: unknown;
}
export interface ChannelRuntimeCallbacks {
    onInbound: (message: ChannelInboundMessage) => Promise<void> | void;
    onPairRequested: (pair: ReturnType<typeof ensurePairRequest>) => Promise<void> | void;
}
export interface ChannelRuntimeDependencies {
    sendQqDesktopMessage?: typeof sendQqDesktopMessage;
    sendWechatDesktopMessage?: typeof sendWechatDesktopMessage;
    analyzeDesktopOutboundEvidence?: typeof analyzeDesktopOutboundEvidence;
}
export interface ChannelOutboundAudit {
    id: string;
    at: string;
    channel: ChannelName;
    destination: string;
    textPreview: string;
    sent: boolean;
    message: string;
    mediaPath?: string;
    reason?: 'sent' | 'channel_blocked' | 'arch_advisor_denied' | 'allowlist_denied' | 'throttled' | 'duplicate_payload' | 'desktop_send_failed';
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    archAdvisorApproved?: boolean;
    targetInAllowlist?: boolean;
    contactTier?: 'owner' | 'friend' | null;
    intent?: 'reply' | 'initiate';
    containsSensitive?: boolean;
    policyHash?: string;
    sendFingerprint?: string;
    ticketSummary?: {
        outboundSendTraceId: string;
        desktopControlTraceId: string;
        expiresAt: string;
    };
    visualPrecheck?: string;
    visualPostcheck?: string;
    automationPath?: 'uia' | 'sendkeys' | 'mixed';
    uiaPath?: 'valuepattern' | 'clipboard_sendkeys' | 'none';
    targetHwnd?: string;
    foregroundBefore?: string;
    foregroundAfter?: string;
    fallbackReason?: string;
    simulationStatus?: 'captured' | 'not_available';
    simulationRiskHints?: string[];
    receiptStatus?: 'confirmed' | 'uncertain';
    semanticTags?: SemanticTag[];
    payloadHash?: string;
    windowFingerprint?: string;
    recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
    sendStatusCheck?: 'sent' | 'failed' | 'uncertain';
    preSendScreenshotPath?: string;
    postSendScreenshotPath?: string;
    failureStep?: string;
    routeLevel?: 'L0_ACTION_MEMORY' | 'L1_UIA' | 'L2_OCR' | 'L3_SOM_VLM';
    somSelectionSource?: 'memory' | 'heuristic' | 'vlm' | 'none';
    somSelectedCandidateId?: number;
    vlmCallsUsed?: number;
    actionPlanMemoryHit?: boolean;
    automationLatencyMs?: number;
    automationKpi?: {
        totalRuns: number;
        successfulRuns: number;
        vlmCallRatio: number;
        somPathHitRate: number;
        reuseTaskP95Ms: number;
        firstTaskP95Ms: number;
        highRiskMisfireRate: number;
        reuseRuns: number;
        firstRuns: number;
    };
    ocrSource?: 'remote_vlm' | 'tesseract' | 'none';
    ocrPreview?: string;
    captureMethod?: 'wgc_hwnd' | 'print_window' | 'dxgi_duplication' | 'uia_only' | 'unknown';
    evidenceConfidence?: number;
    evidenceLimitations?: string[];
    evidenceBundle?: {
        kind: 'desktop_outbound';
        version: 'v5';
        destination: string;
        payloadHash?: string;
        ticketTraceIds?: string[];
        screenshots: string[];
        checks: {
            recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
            sendStatusCheck?: 'sent' | 'failed' | 'uncertain';
            receiptStatus?: 'confirmed' | 'uncertain';
        };
        diagnostics: {
            windowFingerprint?: string;
            failureStep?: string;
            targetHwnd?: string;
            foregroundBefore?: string;
            foregroundAfter?: string;
            uiaPath?: 'valuepattern' | 'clipboard_sendkeys' | 'none';
            fallbackReason?: string;
            routeLevel?: 'L0_ACTION_MEMORY' | 'L1_UIA' | 'L2_OCR' | 'L3_SOM_VLM';
            somSelectionSource?: 'memory' | 'heuristic' | 'vlm' | 'none';
            somSelectedCandidateId?: string;
            vlmCallsUsed?: string;
            ocrSource?: 'remote_vlm' | 'tesseract' | 'none';
            ocrPreview?: string;
        };
        meta: {
            captureMethod: 'wgc_hwnd' | 'print_window' | 'dxgi_duplication' | 'uia_only' | 'unknown';
            confidence: number;
            limitations: string[];
            policyHash?: string;
        };
        simulation: {
            status: 'captured' | 'not_available';
            clickTargets?: Array<{
                x: number;
                y: number;
                label?: string;
            }>;
            reason?: string;
            riskHints?: string[];
        };
    };
    semanticSummary?: {
        conclusion: string;
        keyAssertion: string;
        recovery: string;
    };
}
export declare function listOutboundAudit(projectDir: string, limit?: number): ChannelOutboundAudit[];
export interface ChannelGovernanceSummary {
    generatedAt: string;
    windowRows: number;
    outboundSent: number;
    outboundBlocked: number;
    inboundOnlyViolationAttempts: number;
    inboundOnlyInvariantMaintained: boolean;
    highRiskBlocked: number;
    topBlockedReasons: Array<{
        reason: string;
        count: number;
    }>;
    channelBreakdown: Array<{
        channel: ChannelName;
        attempts: number;
        sent: number;
        blocked: number;
        outboundAllowed: boolean;
    }>;
}
export declare function summarizeChannelGovernance(projectDir: string, limit?: number): ChannelGovernanceSummary;
export declare class ChannelRuntime {
    private readonly projectDir;
    private readonly callbacks;
    private readonly sendQqDesktopMessageImpl;
    private readonly sendWechatDesktopMessageImpl;
    private readonly analyzeDesktopOutboundEvidenceImpl;
    private telegramPolling;
    private telegramOffset;
    private slackSocketModeRunning;
    private slackSocket?;
    private slackReconnectTimer?;
    private readonly outboundThrottle;
    private readonly outboundPayloadHistory;
    private readonly inputMutexStrike;
    private readonly inputMutexCooldownUntil;
    private readonly sendFingerprintHistory;
    constructor(projectDir: string, callbacks: ChannelRuntimeCallbacks, deps?: ChannelRuntimeDependencies);
    listChannels(): import("./types").ChannelState[];
    listPairs(status?: 'pending' | 'approved' | 'rejected'): import("./types").ChannelPairRequest[];
    approvePair(pairID: string): import("./types").ChannelPairRequest | null;
    rejectPair(pairID: string): import("./types").ChannelPairRequest | null;
    markChannelEnabled(channel: ChannelName, enabled: boolean): void;
    start(): Promise<void>;
    private syncPassiveChannelStates;
    private startSlackSocketMode;
    private scheduleSlackReconnect;
    private handleSlackSocketMessage;
    private startTelegramPolling;
    stop(): void;
    handleInbound(message: ChannelInboundMessage): Promise<void>;
    private recordOutboundAttempt;
    private checkThrottle;
    private checkDuplicatePayload;
    private isDesktopChannel;
    private inMutexCooldown;
    private markMutexTimeout;
    private clearMutexStrike;
    private checkSendFingerprint;
    private normalizeDesktopRuntimeError;
    private recordDesktopRuntimeFailure;
    sendMessage(input: {
        channel: ChannelName;
        destination: string;
        text?: string;
        mediaPath?: string;
        sessionID?: string;
        sendFingerprint?: string;
        payloadHash?: string;
        approvalTickets?: {
            outboundSend: {
                traceID: string;
                expiresAt: string;
            };
            desktopControl: {
                traceID: string;
                expiresAt: string;
            };
        };
        outboundCheck?: {
            archAdvisorApproved?: boolean;
            riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
            intent?: 'reply' | 'initiate';
            containsSensitive?: boolean;
            bypassAllowlist?: boolean;
            bypassThrottle?: boolean;
            bypassDuplicateGuard?: boolean;
            policyHash?: string;
        };
    }): Promise<{
        sent: boolean;
        message: string;
        auditID?: string;
    }>;
    private sendPairingMessage;
}
