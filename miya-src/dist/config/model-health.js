import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const STRONG_PROVIDER_IDS = new Set([
    'openai',
    'openrouter',
    'anthropic',
    'google',
    'chutes',
    'kimi-for-coding',
    'zai-coding-plan',
    'github-copilot',
]);
const OPPORTUNISTIC_PROVIDER_IDS = new Set(['opencode']);
const PROVIDER_ENV_MAP = {
    openai: ['OPENAI_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    google: ['GOOGLE_GENERATIVE_AI_API_KEY'],
    chutes: ['CHUTES_API_KEY'],
    'kimi-for-coding': ['KIMI_API_KEY'],
    'zai-coding-plan': ['ZAI_API_KEY'],
    'github-copilot': ['GITHUB_TOKEN', 'GITHUB_COPILOT_TOKEN'],
};
function getAuthFileCandidates() {
    const home = os.homedir();
    const candidates = [path.join(home, '.local', 'share', 'opencode', 'auth.json')];
    if (process.env.LOCALAPPDATA) {
        candidates.push(path.join(process.env.LOCALAPPDATA, 'opencode', 'auth.json'));
    }
    if (process.env.APPDATA) {
        candidates.push(path.join(process.env.APPDATA, 'opencode', 'auth.json'));
    }
    return candidates;
}
function readAuthProviders() {
    for (const candidate of getAuthFileCandidates()) {
        try {
            if (!fs.existsSync(candidate))
                continue;
            const raw = fs.readFileSync(candidate, 'utf-8');
            const parsed = JSON.parse(raw);
            return new Set(Object.keys(parsed));
        }
        catch {
            // try next candidate
        }
    }
    return new Set();
}
function hasProviderEnv(providerID) {
    const envNames = PROVIDER_ENV_MAP[providerID] ?? [];
    return envNames.some((name) => (process.env[name] ?? '').trim().length > 0);
}
function normalizeProviderID(providerID) {
    return providerID.trim().toLowerCase();
}
export function getModelProviderID(model) {
    const slash = model.indexOf('/');
    if (slash === -1)
        return normalizeProviderID(model);
    return normalizeProviderID(model.slice(0, slash));
}
export function isStrongProviderAvailable(providerID) {
    const normalized = normalizeProviderID(providerID);
    const authProviders = readAuthProviders();
    return authProviders.has(normalized) || hasProviderEnv(normalized);
}
export function isModelLikelyAvailable(model) {
    const providerID = getModelProviderID(model);
    if (STRONG_PROVIDER_IDS.has(providerID)) {
        return isStrongProviderAvailable(providerID);
    }
    if (OPPORTUNISTIC_PROVIDER_IDS.has(providerID)) {
        return true;
    }
    // Unknown providers are treated as opportunistic.
    return true;
}
export function pickBestAvailableModel(candidates) {
    const deduped = Array.from(new Set(candidates.map((item) => item.trim()).filter((item) => item.length > 0)));
    if (deduped.length === 0)
        return null;
    // Pass 1: strong providers with valid auth/env only.
    for (const model of deduped) {
        const providerID = getModelProviderID(model);
        if (!STRONG_PROVIDER_IDS.has(providerID))
            continue;
        if (isStrongProviderAvailable(providerID))
            return model;
    }
    // Pass 2: any opportunistic/unknown model.
    for (const model of deduped) {
        if (isModelLikelyAvailable(model))
            return model;
    }
    return deduped[0] ?? null;
}
