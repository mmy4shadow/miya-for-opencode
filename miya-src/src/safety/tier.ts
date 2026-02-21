export const SAFETY_TIERS = ['LIGHT', 'STANDARD', 'THOROUGH'] as const;

export type SafetyTier = (typeof SAFETY_TIERS)[number];

const SAFETY_RANK: Record<SafetyTier, number> = {
  LIGHT: 1,
  STANDARD: 2,
  THOROUGH: 3,
};

export function normalizeTier(value: string | undefined): SafetyTier {
  const normalized = String(value ?? 'STANDARD')
    .trim()
    .toUpperCase();
  if (normalized === 'LIGHT') return 'LIGHT';
  if (normalized === 'THOROUGH') return 'THOROUGH';
  return 'STANDARD';
}

export function tierAtLeast(
  current: SafetyTier,
  required: SafetyTier,
): boolean {
  return SAFETY_RANK[current] >= SAFETY_RANK[required];
}
