import type { CompanionMemoryCorrection, CompanionMemoryVector } from './memory-types';
export type { CompanionMemoryVector } from './memory-types';
export declare function decayCompanionMemoryVectors(projectDir: string, halfLifeDays?: number): {
    updated: number;
    items: CompanionMemoryVector[];
};
export declare function autoCleanupCompanionMemoryVectors(projectDir: string, input?: {
    maxActive?: number;
    maxPendingAgeDays?: number;
    minQualityToKeep?: number;
}): {
    archived: number;
    superseded: number;
    retained: number;
};
export declare function upsertCompanionMemoryVector(projectDir: string, input: {
    text: string;
    source?: string;
    activate?: boolean;
    confidence?: number;
    tier?: 'L0' | 'L1' | 'L2' | 'L3';
    sourceMessageID?: string;
    sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    domain?: 'work' | 'relationship' | 'personal' | 'system';
    evidenceRef?: CompanionMemoryVector['evidenceRef'];
}): CompanionMemoryVector;
export declare function searchCompanionMemoryVectors(projectDir: string, query: string, limit?: number, options?: {
    threshold?: number;
    recencyHalfLifeDays?: number;
    alpha?: number;
    beta?: number;
    gamma?: number;
    domain?: 'work' | 'relationship' | 'personal' | 'system';
    mode?: 'hybrid' | 'vector' | 'keyword';
}): Array<CompanionMemoryVector & {
    similarity: number;
    rankScore: number;
    quality: number;
    vectorScore: number;
    lexicalScore: number;
    relationScore: number;
}>;
export declare function listCompanionMemoryVectors(projectDir: string): CompanionMemoryVector[];
export declare function listPendingCompanionMemoryVectors(projectDir: string): CompanionMemoryVector[];
export declare function listCompanionMemoryCorrections(projectDir: string): CompanionMemoryCorrection[];
export declare function updateCompanionMemoryVector(projectDir: string, input: {
    memoryID: string;
    text?: string;
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    confidence?: number;
    tier?: 'L0' | 'L1' | 'L2' | 'L3';
    status?: 'pending' | 'candidate' | 'active' | 'superseded' | 'archived';
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
