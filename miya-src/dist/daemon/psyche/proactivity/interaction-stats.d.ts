export type InteractionEventType = 'consult' | 'outcome';
export interface InteractionEvent {
    atMs: number;
    type: InteractionEventType;
    channel?: string;
    userInitiated?: boolean;
    decision?: 'allow' | 'defer' | 'deny';
    delivered?: boolean;
    explicitFeedback?: 'positive' | 'negative' | 'none';
    userReplyWithinSec?: number;
}
export interface InteractionStatsSnapshot {
    generatedAtMs: number;
    window1h: {
        consults: number;
        proactiveAllows: number;
        proactiveDefers: number;
        userInitiatedTurns: number;
    };
    window24h: {
        consults: number;
        proactiveAllows: number;
        proactiveDefers: number;
        userInitiatedTurns: number;
        outcomes: number;
        delivered: number;
        negativeFeedback: number;
        positiveFeedback: number;
        replyRate: number;
        medianReplySec?: number;
        userInitiatedRate: number;
        negativeFeedbackRate: number;
    };
}
export declare function appendInteractionEvent(filePath: string, event: InteractionEvent, nowMs?: number): InteractionStatsSnapshot;
export declare function readInteractionStats(filePath: string, nowMs?: number): InteractionStatsSnapshot;
