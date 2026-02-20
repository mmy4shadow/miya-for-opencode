import type { CompanionMemoryVector } from './memory-vector';
export declare function syncCompanionMemoriesToSqlite(projectDir: string, items: CompanionMemoryVector[]): void;
export declare function getCompanionMemorySqliteStats(projectDir: string): {
    sqlitePath: string;
    memoryCount: number;
    vectorCount: number;
    graphCount: number;
};
