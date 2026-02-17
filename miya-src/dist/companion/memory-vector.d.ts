export type MemoryDomain = 'work' | 'relationship';
export type MemorySemanticLayer = 'episodic' | 'semantic' | 'preference' | 'tool_trace';
export type MemoryLearningStage = 'ephemeral' | 'candidate' | 'persistent';
export interface CompanionMemoryVector {
    id: string;
    text: string;
    domain: MemoryDomain;
    inferredDomain?: MemoryDomain;
    crossDomainWrite?: {
        from: MemoryDomain;
        to: MemoryDomain;
        requiresApproval: boolean;
        evidence: string[];
        approvedAt?: string;
    };
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    semanticLayer: MemorySemanticLayer;
    learningStage: MemoryLearningStage;
    source: string;
    embeddingProvider: string;
    embedding: number[];
    score: number;
    confidence: number;
    tier: 'L1' | 'L2' | 'L3';
    sourceMessageID?: string;
    sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
    status: 'pending' | 'active' | 'superseded';
    conflictKey?: string;
    conflictWizardID?: string;
    supersededBy?: string;
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
export type CompanionMemoryDriftReason = 'stale_low_access' | 'confidence_collapse' | 'pending_timeout' | 'cross_domain_pending_timeout' | 'conflict_parallel_active';
export type CompanionMemoryDriftSeverity = 'low' | 'medium' | 'high';
export type CompanionMemoryDriftAction = 'archive' | 'supersede';
export interface CompanionMemoryDriftSignal {
    memoryID: string;
    reason: CompanionMemoryDriftReason;
    severity: CompanionMemoryDriftSeverity;
    recommendedAction: CompanionMemoryDriftAction;
    ageDays: number;
    idleDays: number;
    domain: MemoryDomain;
    status: CompanionMemoryVector['status'];
    score: number;
    confidence: number;
    detail: string;
    relatedMemoryID?: string;
}
export interface CompanionMemoryDriftAuditOptions {
    staleDays?: number;
    lowAccessCount?: number;
    minScore?: number;
    minConfidence?: number;
    pendingTimeoutDays?: number;
    crossDomainPendingDays?: number;
    limit?: number;
}
export interface CompanionMemoryDriftReport {
    generatedAt: string;
    scanned: number;
    actionableCount: number;
    thresholds: {
        staleDays: number;
        lowAccessCount: number;
        minScore: number;
        minConfidence: number;
        pendingTimeoutDays: number;
        crossDomainPendingDays: number;
    };
    byReason: Record<CompanionMemoryDriftReason, number>;
    bySeverity: Record<CompanionMemoryDriftSeverity, number>;
    items: CompanionMemoryDriftSignal[];
}
export interface CompanionMemoryDriftRecycleOptions extends CompanionMemoryDriftAuditOptions {
    maxActions?: number;
    dryRun?: boolean;
}
export interface CompanionMemoryDriftRecycleResult {
    dryRun: boolean;
    applied: number;
    archivedIDs: string[];
    superseded: Array<{
        memoryID: string;
        supersededBy: string;
        reason: CompanionMemoryDriftReason;
    }>;
    remainingActionable: number;
    report: CompanionMemoryDriftReport;
}
export declare function inferMemoryDomain(text: string): MemoryDomain;
export declare function decayCompanionMemoryVectors(projectDir: string, halfLifeDays?: number): {
    updated: number;
    items: CompanionMemoryVector[];
};
export declare function auditCompanionMemoryDrift(projectDir: string, options?: CompanionMemoryDriftAuditOptions): CompanionMemoryDriftReport;
export declare function recycleCompanionMemoryDrift(projectDir: string, options?: CompanionMemoryDriftRecycleOptions): CompanionMemoryDriftRecycleResult;
export declare function upsertCompanionMemoryVector(projectDir: string, input: {
    text: string;
    domain?: MemoryDomain;
    source?: string;
    activate?: boolean;
    evidence?: string[];
    confidence?: number;
    tier?: 'L1' | 'L2' | 'L3';
    sourceMessageID?: string;
    sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    semanticLayer?: MemorySemanticLayer;
    learningStage?: MemoryLearningStage;
}): CompanionMemoryVector;
export declare function searchCompanionMemoryVectors(projectDir: string, query: string, limit?: number, options?: {
    threshold?: number;
    recencyHalfLifeDays?: number;
    alpha?: number;
    beta?: number;
    gamma?: number;
    domain?: MemoryDomain;
    domains?: MemoryDomain[];
    semanticWeight?: number;
    lexicalWeight?: number;
    semanticLayers?: MemorySemanticLayer[];
    learningStages?: MemoryLearningStage[];
}): Array<CompanionMemoryVector & {
    similarity: number;
    semanticSimilarity: number;
    lexicalSimilarity: number;
    rankScore: number;
    channels: {
        semantic: number;
        lexical: number;
    };
}>;
export declare function listCompanionMemoryVectors(projectDir: string, domain?: MemoryDomain): CompanionMemoryVector[];
export declare function listPendingCompanionMemoryVectors(projectDir: string, domain?: MemoryDomain): CompanionMemoryVector[];
export declare function listCompanionMemoryCorrections(projectDir: string): CompanionMemoryCorrection[];
export declare function mergePendingMemoryConflicts(projectDir: string, input?: {
    maxSupersede?: number;
}): {
    merged: number;
    winners: string[];
};
export declare function confirmCompanionMemoryVector(projectDir: string, input: {
    memoryID: string;
    confirm: boolean;
    supersedeConflicts?: boolean;
    evidence?: string[];
}): CompanionMemoryVector | null;
export declare function getCompanionMemoryVector(projectDir: string, memoryID: string): CompanionMemoryVector | null;
