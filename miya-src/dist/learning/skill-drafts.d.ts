import type { CompanionMemoryVector } from '../companion/memory-vector';
import type { RalphLoopResult } from '../ralph';
export type SkillDraftStatus = 'draft' | 'recommended' | 'accepted' | 'rejected';
export type SkillDraftSource = 'ralph' | 'reflect';
export interface SkillDraft {
    id: string;
    source: SkillDraftSource;
    status: SkillDraftStatus;
    title: string;
    problemPattern: string;
    solutionPattern: string;
    commands: string[];
    tags: string[];
    confidence: number;
    uses: number;
    pendingUses: number;
    hits: number;
    misses: number;
    createdAt: string;
    updatedAt: string;
}
export interface LearningStats {
    total: number;
    byStatus: Record<SkillDraftStatus, number>;
    totalUses: number;
    totalPendingUses: number;
    hitRate: number;
}
export declare function listSkillDrafts(projectDir: string, input?: {
    limit?: number;
    status?: SkillDraftStatus;
}): SkillDraft[];
export declare function setSkillDraftStatus(projectDir: string, draftID: string, status?: SkillDraftStatus, usage?: {
    hit: boolean;
    settlePending?: boolean;
}): SkillDraft | null;
export declare function markSkillDraftPendingUsage(projectDir: string, draftID: string): SkillDraft | null;
export declare function settleSkillDraftUsage(projectDir: string, draftID: string, hit: boolean): SkillDraft | null;
export declare function getLearningStats(projectDir: string): LearningStats;
export declare function buildLearningInjection(projectDir: string, query: string, input?: {
    threshold?: number;
    limit?: number;
}): {
    snippet?: string;
    matchedDraftIDs: string[];
};
export declare function createSkillDraftFromRalph(projectDir: string, input: {
    taskDescription: string;
    result: RalphLoopResult;
}): SkillDraft | null;
export declare function createSkillDraftsFromReflect(projectDir: string, input: {
    createdMemories: CompanionMemoryVector[];
}): SkillDraft[];
