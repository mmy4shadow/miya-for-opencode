export declare const SEMANTIC_TAGS: readonly ["window_not_found", "window_occluded", "recipient_mismatch", "input_mutex_timeout", "receipt_uncertain", "privilege_barrier", "ui_style_mismatch"];
export type SemanticTag = (typeof SEMANTIC_TAGS)[number];
export declare function isSemanticTag(value: unknown): value is SemanticTag;
export declare function normalizeSemanticTags(value: unknown): SemanticTag[];
export declare function assertSemanticTags(value: unknown): asserts value is SemanticTag[];
