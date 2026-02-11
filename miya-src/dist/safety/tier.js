export const SAFETY_TIERS = ['LIGHT', 'STANDARD', 'THOROUGH'];
const SAFETY_RANK = {
    LIGHT: 1,
    STANDARD: 2,
    THOROUGH: 3,
};
export function normalizeTier(value) {
    const normalized = String(value ?? 'STANDARD').trim().toUpperCase();
    if (normalized === 'LIGHT')
        return 'LIGHT';
    if (normalized === 'THOROUGH')
        return 'THOROUGH';
    return 'STANDARD';
}
export function tierAtLeast(current, required) {
    return SAFETY_RANK[current] >= SAFETY_RANK[required];
}
