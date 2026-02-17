export interface OwnerSyncTokenRecord {
    token: string;
    action: string;
    payloadHash: string;
    status: 'pending' | 'approved' | 'consumed';
    createdAt: string;
    expiresAt: string;
    approvedAt?: string;
    approvedBy?: {
        channel: 'qq' | 'wechat';
        senderID: string;
    };
    consumedAt?: string;
}
export declare function issueOwnerSyncToken(projectDir: string, input: {
    action: string;
    payloadHash: string;
    ttlMs?: number;
}): OwnerSyncTokenRecord;
export declare function approveOwnerSyncToken(projectDir: string, input: {
    token: string;
    channel: 'qq' | 'wechat';
    senderID: string;
}): {
    ok: boolean;
    reason?: string;
    record?: OwnerSyncTokenRecord;
};
export declare function verifyOwnerSyncToken(projectDir: string, input: {
    token: string;
    action: string;
    payloadHash: string;
}): {
    ok: boolean;
    reason?: string;
    record?: OwnerSyncTokenRecord;
};
export declare function consumeOwnerSyncToken(projectDir: string, tokenInput: string): {
    ok: boolean;
    reason?: string;
};
export declare function detectOwnerSyncTokenFromText(text: string): string | null;
