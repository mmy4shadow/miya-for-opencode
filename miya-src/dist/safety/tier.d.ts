export declare const SAFETY_TIERS: readonly ["LIGHT", "STANDARD", "THOROUGH"];
export type SafetyTier = (typeof SAFETY_TIERS)[number];
export declare function normalizeTier(value: string | undefined): SafetyTier;
export declare function tierAtLeast(current: SafetyTier, required: SafetyTier): boolean;
