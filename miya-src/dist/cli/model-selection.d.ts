export interface ModelSelectionCandidate {
    model: string;
    status?: 'alpha' | 'beta' | 'deprecated' | 'active';
    contextLimit?: number;
    outputLimit?: number;
    reasoning?: boolean;
    toolcall?: boolean;
    attachment?: boolean;
    tags?: string[];
    meta?: Record<string, unknown>;
}
export interface RankedModel<T extends ModelSelectionCandidate> {
    candidate: T;
    score: number;
}
export interface SelectionOptions<T extends ModelSelectionCandidate> {
    excludeModels?: string[];
    tieBreaker?: (left: T, right: T) => number;
}
export type ScoreFunction<T extends ModelSelectionCandidate> = (candidate: T) => number;
export interface RoleScoring<T extends ModelSelectionCandidate> {
    primary: ScoreFunction<T>;
    support: ScoreFunction<T>;
}
export declare function rankModels<T extends ModelSelectionCandidate>(models: T[], scoreFn: ScoreFunction<T>, options?: SelectionOptions<T>): RankedModel<T>[];
export declare function pickBestModel<T extends ModelSelectionCandidate>(models: T[], scoreFn: ScoreFunction<T>, options?: SelectionOptions<T>): T | null;
export declare function pickPrimaryAndSupport<T extends ModelSelectionCandidate>(models: T[], scoring: RoleScoring<T>, preferredPrimaryModel?: string): {
    primary: T | null;
    support: T | null;
};
