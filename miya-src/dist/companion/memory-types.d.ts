export type MemoryTier = 'L0' | 'L1' | 'L2' | 'L3';
export type MemoryStatus = 'candidate' | 'pending' | 'active' | 'superseded' | 'archived';
export interface MemoryQuoteSpan {
    logID: string;
    exactText: string;
    charStart: number;
    charEnd: number;
}
export interface MemoryEvidenceRef {
    auditID: string;
    sourceLogIDs: string[];
    quoteSpans: MemoryQuoteSpan[];
}
export interface CompanionMemoryVector {
    id: string;
    text: string;
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    source: string;
    embedding: number[];
    score: number;
    confidence: number;
    tier: MemoryTier;
    domain?: 'work' | 'relationship' | 'personal' | 'system';
    subject?: string;
    predicate?: string;
    object?: string;
    polarity?: 'positive' | 'negative' | 'neutral';
    sourceMessageID?: string;
    sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
    status: MemoryStatus;
    conflictKey?: string;
    conflictWizardID?: string;
    supersededBy?: string;
    evidenceRef?: MemoryEvidenceRef;
    accessCount: number;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
    lastAccessedAt: string;
}
export interface CompanionMemoryCorrection {
    id: string;
    conflictKey: string;
    candidateMemoryID: string;
    existingMemoryIDs: string[];
    status: 'pending' | 'resolved' | 'rejected';
    createdAt: string;
    updatedAt: string;
}
export interface MemoryShortTermLog {
    id: string;
    sessionID: string;
    sender: 'user' | 'assistant' | 'system';
    text: string;
    at: string;
    messageHash: string;
    processedAt?: string;
}
