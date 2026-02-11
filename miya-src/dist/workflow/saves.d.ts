export interface MiyaSaveRecord {
    id: string;
    label: string;
    createdAt: string;
    sessionID: string;
    branch: string | null;
    done: string[];
    missing: string[];
    unresolved: string[];
    notes?: string;
}
export declare function getCurrentBranch(projectDir: string): string | null;
export declare function createSaveRecord(projectDir: string, input: Omit<MiyaSaveRecord, 'id' | 'createdAt' | 'branch'>): MiyaSaveRecord;
export declare function loadSaveRecord(projectDir: string, id: string): MiyaSaveRecord | null;
export declare function listSaveRecords(projectDir: string): MiyaSaveRecord[];
export declare function evaluateSave(record: MiyaSaveRecord): {
    status: 'complete' | 'incomplete';
    reason: string;
};
