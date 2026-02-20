export interface CompanionMemoryVector {
    id: string;
    text: string;
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    source: string;
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
export declare function decayCompanionMemoryVectors(projectDir: string, halfLifeDays?: number): {
    updated: number;
    items: CompanionMemoryVector[];
};
export declare function upsertCompanionMemoryVector(projectDir: string, input: {
    text: string;
    source?: string;
    activate?: boolean;
    confidence?: number;
    tier?: 'L1' | 'L2' | 'L3';
    sourceMessageID?: string;
    sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
}): CompanionMemoryVector;
export declare function searchCompanionMemoryVectors(projectDir: string, query: string, limit?: number, options?: {
    threshold?: number;
    recencyHalfLifeDays?: number;
    alpha?: number;
    beta?: number;
    gamma?: number;
}): Array<CompanionMemoryVector & {
    similarity: number;
    rankScore: number;
}>;
export declare function listCompanionMemoryVectors(projectDir: string): CompanionMemoryVector[];
export declare function listPendingCompanionMemoryVectors(projectDir: string): CompanionMemoryVector[];
export declare function listCompanionMemoryCorrections(projectDir: string): CompanionMemoryCorrection[];
export declare function updateCompanionMemoryVector(projectDir: string, input: {
    memoryID: string;
    text?: string;
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    confidence?: number;
    tier?: 'L1' | 'L2' | 'L3';
    status?: 'pending' | 'active' | 'superseded';
}): CompanionMemoryVector | null;
export declare function archiveCompanionMemoryVector(projectDir: string, input: {
    memoryID: string;
    archived: boolean;
}): CompanionMemoryVector | null;
export declare function confirmCompanionMemoryVector(projectDir: string, input: {
    memoryID: string;
    confirm: boolean;
    supersedeConflicts?: boolean;
}): CompanionMemoryVector | null;
