import type { CompanionMemoryCorrection, CompanionMemoryVector, MemoryQuoteSpan, MemoryShortTermLog } from './memory-types';
interface SqlStatement {
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
}
interface SqlDatabase {
    exec: (sql: string) => unknown;
    query: (sql: string) => SqlStatement;
    transaction: <T extends (...args: any[]) => unknown>(fn: T) => T;
    close: () => void;
}
export declare function withMemoryDb<T>(projectDir: string, fn: (db: SqlDatabase) => T): T;
export declare function listMemoryCells(projectDir: string): CompanionMemoryVector[];
export declare function getMemoryCell(projectDir: string, id: string): CompanionMemoryVector | null;
export declare function upsertMemoryCell(projectDir: string, item: CompanionMemoryVector): CompanionMemoryVector;
export declare function upsertMemoryCells(projectDir: string, items: CompanionMemoryVector[]): void;
export declare function listMemoryCorrections(projectDir: string): CompanionMemoryCorrection[];
export declare function upsertMemoryCorrection(projectDir: string, correction: CompanionMemoryCorrection): CompanionMemoryCorrection;
export declare function appendRawMemoryLog(projectDir: string, row: MemoryShortTermLog): MemoryShortTermLog | null;
export declare function listRawMemoryLogs(projectDir: string, options?: {
    pendingOnly?: boolean;
    limit?: number;
}): MemoryShortTermLog[];
export declare function markRawLogsProcessed(projectDir: string, logIDs: string[], jobID: string, processedAt?: string): number;
export declare function appendMemoryEvent(projectDir: string, input: {
    eventID: string;
    eventType: string;
    entityType: string;
    entityID: string;
    payload: unknown;
    policyHash?: string;
    createdAt?: string;
}): void;
export declare function listMemoryEvents(projectDir: string, options?: {
    since?: string;
    limit?: number;
}): Array<{
    eventID: string;
    eventType: string;
    entityType: string;
    entityID: string;
    payload: unknown;
    policyHash?: string;
    createdAt: string;
}>;
export declare function upsertEvidencePack(projectDir: string, input: {
    auditID: string;
    meta: Record<string, unknown>;
    payload: Record<string, unknown>;
    createdAt?: string;
}): void;
export interface ReflectCandidateInput {
    kind: 'Fact' | 'Insight' | 'UserPreference';
    subject: 'User' | 'Miya';
    predicate: string;
    object: string;
    confidence: number;
    tier: 'L0' | 'L1' | 'L2';
    domain: 'work' | 'relationship' | 'personal' | 'system';
    sourceLogID: string;
    quotes: MemoryQuoteSpan[];
}
export declare function constructReflectBatch(projectDir: string, input: {
    jobID: string;
    auditID: string;
    processedAt: string;
    policyHash?: string;
    pickedLogs: MemoryShortTermLog[];
    triplets: ReflectCandidateInput[];
    evidenceMeta: Record<string, unknown>;
    evidencePayload: Record<string, unknown>;
    reflectStats?: {
        generatedFacts: number;
        generatedInsights: number;
        generatedPreferences: number;
    };
}): {
    createdMemories: CompanionMemoryVector[];
    processedLogs: number;
};
export declare function getEvidencePack(projectDir: string, auditID: string): {
    auditID: string;
    meta: Record<string, unknown>;
    payload: Record<string, unknown>;
    createdAt: string;
} | null;
export declare function buildMemoryPack(projectDir: string, input: {
    query: string;
    domain?: 'work' | 'relationship' | 'personal' | 'system';
    mode?: 'execution' | 'response' | 'audit';
    l0Limit?: number;
    l1Limit?: number;
}): {
    l0: string[];
    l1: Array<{
        text: string;
        confidence: number;
        at: string;
    }>;
    l2: string[];
};
export declare function resolveContextFsUri(projectDir: string, uri: string): Record<string, unknown> | null;
export declare function getCompanionMemorySqliteStats(projectDir: string): {
    sqlitePath: string;
    memoryCount: number;
    candidateCount: number;
    activeCount: number;
    vectorCount: number;
    graphCount: number;
    rawLogCount: number;
    pendingRawLogCount: number;
    evidenceCount: number;
    eventCount: number;
};
export declare function syncCompanionMemoriesToSqlite(_projectDir: string, _items: CompanionMemoryVector[]): void;
export {};
