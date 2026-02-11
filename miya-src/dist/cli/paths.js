import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function getConfigDir() {
    // Keep this aligned with OpenCode itself and the plugin config loader:
    // base dir is $XDG_CONFIG_HOME (if set) else ~/.config, and OpenCode config lives under /opencode.
    const userConfigDir = process.env.XDG_CONFIG_HOME
        ? process.env.XDG_CONFIG_HOME
        : join(homedir(), '.config');
    return join(userConfigDir, 'opencode');
}
export function getOpenCodeConfigPaths() {
    const configDir = getConfigDir();
    return [join(configDir, 'opencode.json'), join(configDir, 'opencode.jsonc')];
}
export function getConfigJson() {
    return join(getConfigDir(), 'opencode.json');
}
export function getConfigJsonc() {
    return join(getConfigDir(), 'opencode.jsonc');
}
export function getLiteConfig() {
    return join(getConfigDir(), 'miya.json');
}
export function getLiteConfigCandidates() {
    const configDir = getConfigDir();
    return [join(configDir, 'miya.json')];
}
export function getExistingLiteConfigPath() {
    const candidates = getLiteConfigCandidates();
    for (const candidate of candidates) {
        if (existsSync(candidate))
            return candidate;
    }
    return getLiteConfig();
}
export function getExistingConfigPath() {
    const jsonPath = getConfigJson();
    if (existsSync(jsonPath))
        return jsonPath;
    const jsoncPath = getConfigJsonc();
    if (existsSync(jsoncPath))
        return jsoncPath;
    return jsonPath;
}
export function ensureConfigDir() {
    const configDir = getConfigDir();
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }
}
