import { sendQqDesktopMessage } from '../channel/outbound/qq';
import { sendWechatDesktopMessage } from '../channel/outbound/wechat';
import { analyzeDesktopOutboundEvidence } from '../multimodal/vision';
import type { ChannelName } from './types';
import { ensurePairRequest } from './pairing-store';
import { type SemanticTag } from '../policy/semantic-tags';
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
    receiptStatus?: 'confirmed' | 'uncertain';
    semanticTags?: SemanticTag[];
    payloadHash?: string;
    windowFingerprint?: string;
    recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
    sendStatusCheck?: 'sent' | 'failed' | 'uncertain';
    preSendScreenshotPath?: string;
    postSendScreenshotPath?: string;
    failureStep?: string;
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
        };
    };
    semanticSummary?: {
        conclusion: string;
        keyAssertion: string;
        recovery: string;
    };
}
export declare function listOutboundAudit(projectDir: string, limit?: number): ChannelOutboundAudit[];
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
