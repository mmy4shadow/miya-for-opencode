export type SessionKind = 'opencode' | 'channel' | 'wizard' | 'system';
export type SessionActivation = 'active' | 'queued' | 'muted';
export type SessionReplyMode = 'auto' | 'manual' | 'summary_only';
export type SessionQueueStrategy = 'fifo' | 'priority' | 'cooldown';
export interface MiyaQueuedMessage {
    id: string;
    text: string;
    source: string;
    createdAt: string;
}
export interface MiyaSession {
    id: string;
    kind: SessionKind;
    groupId: string;
    title?: string;
    policy: {
        activation: SessionActivation;
        reply: SessionReplyMode;
        queueStrategy: SessionQueueStrategy;
    };
    routing: {
        opencodeSessionID: string;
        agent: string;
    };
    queue: MiyaQueuedMessage[];
    createdAt: string;
    updatedAt: string;
}
export declare function listSessions(projectDir: string): MiyaSession[];
export declare function getSession(projectDir: string, sessionID: string): MiyaSession | null;
export declare function upsertSession(projectDir: string, input: {
    id: string;
    kind?: SessionKind;
    groupId?: string;
    title?: string;
    routingSessionID?: string;
    agent?: string;
}): MiyaSession;
export declare function setSessionPolicy(projectDir: string, sessionID: string, patch: Partial<MiyaSession['policy']>): MiyaSession | null;
export declare function enqueueSessionMessage(projectDir: string, sessionID: string, input: {
    text: string;
    source: string;
}): MiyaQueuedMessage;
export declare function dequeueSessionMessage(projectDir: string, sessionID: string): MiyaQueuedMessage | null;
