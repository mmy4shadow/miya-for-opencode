import { type MemoryDomain, type MemorySemanticLayer } from './memory-vector';
export interface MemoryRecallFixture {
    id?: string;
    text: string;
    domain?: MemoryDomain;
    semanticLayer?: MemorySemanticLayer;
}
export interface MemoryRecallCase {
    id?: string;
    query: string;
    expected: string[];
    domain?: MemoryDomain;
    semanticLayers?: MemorySemanticLayer[];
    k?: number;
}
export interface MemoryRecallDataset {
    name: string;
    fixtures: MemoryRecallFixture[];
    cases: MemoryRecallCase[];
}
export interface MemoryRecallCaseResult {
    id: string;
    query: string;
    k: number;
    expected: string[];
    retrieved: string[];
    hit: boolean;
}
export interface MemoryRecallBenchmarkResult {
    dataset: string;
    cases: number;
    recallAtK: Record<string, number>;
    caseResults: MemoryRecallCaseResult[];
}
export declare function loadMemoryRecallDataset(datasetPath?: string): MemoryRecallDataset;
export declare function runMemoryRecallBenchmark(input?: {
    datasetPath?: string;
    dataset?: MemoryRecallDataset;
    kValues?: number[];
}): MemoryRecallBenchmarkResult;
