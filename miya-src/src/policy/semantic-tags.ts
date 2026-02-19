export const SEMANTIC_TAGS = [
  'window_not_found',
  'window_occluded',
  'recipient_mismatch',
  'input_mutex_timeout',
  'input_mutex_timeout_continuation',
  'receipt_uncertain',
  'privilege_barrier',
  'ui_style_mismatch',
  'allowlist_bypass',
  'policy_hash_mismatch',
] as const;

export type SemanticTag = (typeof SEMANTIC_TAGS)[number];

export function isSemanticTag(value: unknown): value is SemanticTag {
  return (
    typeof value === 'string' &&
    (SEMANTIC_TAGS as readonly string[]).includes(value)
  );
}

export function normalizeSemanticTags(value: unknown): SemanticTag[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item))
    .filter((item): item is SemanticTag => isSemanticTag(item));
}

export function assertSemanticTags(
  value: unknown,
): asserts value is SemanticTag[] {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isSemanticTag(item)) {
      throw new Error(`invalid_semantic_tag:${String(item)}`);
    }
  }
}
