export interface CompanionMemoryGraphEdge {
    memoryID: string;
    subject: string;
    predicate: string;
    object: string;
    memoryKind: string;
    semanticLayer: string;
    domain: string;
    confidence: number;
    sourceMessageID?: string;
    updatedAt: string;
    score: number;
}
export declare function searchCompanionMemoryGraph(projectDir: string, query: string, limit?: number, options?: {
    minConfidence?: number;
    semanticLayer?: string;
    domain?: string;
}): CompanionMemoryGraphEdge[];
export declare function listCompanionMemoryGraphNeighbors(projectDir: string, entity: string, limit?: number): CompanionMemoryGraphEdge[];
export declare function getCompanionMemoryGraphStats(projectDir: string): {
    sqlitePath: string;
    edgeCount: number;
    avgConfidence: number;
    byLayer: Record<string, number>;
    updatedAt?: string;
};
