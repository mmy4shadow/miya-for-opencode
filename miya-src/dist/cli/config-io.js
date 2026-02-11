import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync, } from 'node:fs';
import { ensureConfigDir, getConfigDir, getExistingConfigPath, getExistingLiteConfigPath, getLiteConfig, } from './paths';
import { generateLiteConfig } from './providers';
const PACKAGE_NAME = 'miya';
/**
 * Strip JSON comments (single-line // and multi-line) and trailing commas for JSONC support.
 */
export function stripJsonComments(json) {
    const commentPattern = /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g;
    const trailingCommaPattern = /\\"|"(?:\\"|[^"])*"|(,)(\s*[}\]])/g;
    return json
        .replace(commentPattern, (match, commentGroup) => commentGroup ? '' : match)
        .replace(trailingCommaPattern, (match, comma, closing) => comma ? closing : match);
}
export function parseConfigFile(path) {
    try {
        if (!existsSync(path))
            return { config: null };
        const stat = statSync(path);
        if (stat.size === 0)
            return { config: null };
        const content = readFileSync(path, 'utf-8');
        if (content.trim().length === 0)
            return { config: null };
        return { config: JSON.parse(stripJsonComments(content)) };
    }
    catch (err) {
        return { config: null, error: String(err) };
    }
}
export function parseConfig(path) {
    const result = parseConfigFile(path);
    if (result.config || result.error)
        return result;
    if (path.endsWith('.json')) {
        const jsoncPath = path.replace(/\.json$/, '.jsonc');
        return parseConfigFile(jsoncPath);
    }
    return { config: null };
}
/**
 * Write config to file atomically.
 */
export function writeConfig(configPath, config) {
    if (configPath.endsWith('.jsonc')) {
        console.warn('[config-manager] Writing to .jsonc file - comments will not be preserved');
    }
    const tmpPath = `${configPath}.tmp`;
    const bakPath = `${configPath}.bak`;
    const content = `${JSON.stringify(config, null, 2)}\n`;
    // Backup existing config if it exists
    if (existsSync(configPath)) {
        copyFileSync(configPath, bakPath);
    }
    // Atomic write pattern: write to tmp, then rename
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, configPath);
}
export async function addPluginToOpenCodeConfig() {
    try {
        ensureConfigDir();
    }
    catch (err) {
        return {
            success: false,
            configPath: getConfigDir(),
            error: `Failed to create config directory: ${err}`,
        };
    }
    const configPath = getExistingConfigPath();
    try {
        const { config: parsedConfig, error } = parseConfig(configPath);
        if (error) {
            return {
                success: false,
                configPath,
                error: `Failed to parse config: ${error}`,
            };
        }
        const config = parsedConfig ?? {};
        const plugins = config.plugin ?? [];
        // Remove existing miya entries
        const filteredPlugins = plugins.filter((p) => p !== PACKAGE_NAME &&
            !p.startsWith(`${PACKAGE_NAME}@`));
        // Add fresh entry
        filteredPlugins.push(PACKAGE_NAME);
        config.plugin = filteredPlugins;
        writeConfig(configPath, config);
        return { success: true, configPath };
    }
    catch (err) {
        return {
            success: false,
            configPath,
            error: `Failed to update opencode config: ${err}`,
        };
    }
}
// Removed: addAuthPlugins - no longer needed with cliproxy
// Removed: addProviderConfig - default opencode now has kimi provider config
export function writeLiteConfig(installConfig) {
    const configPath = getLiteConfig();
    try {
        ensureConfigDir();
        const config = generateLiteConfig(installConfig);
        // Atomic write for lite config too
        const tmpPath = `${configPath}.tmp`;
        const bakPath = `${configPath}.bak`;
        const content = `${JSON.stringify(config, null, 2)}\n`;
        // Backup existing config if it exists
        if (existsSync(configPath)) {
            copyFileSync(configPath, bakPath);
        }
        writeFileSync(tmpPath, content);
        renameSync(tmpPath, configPath);
        return { success: true, configPath };
    }
    catch (err) {
        return {
            success: false,
            configPath,
            error: `Failed to write lite config: ${err}`,
        };
    }
}
export function disableDefaultAgents() {
    const configPath = getExistingConfigPath();
    try {
        ensureConfigDir();
        const { config: parsedConfig, error } = parseConfig(configPath);
        if (error) {
            return {
                success: false,
                configPath,
                error: `Failed to parse config: ${error}`,
            };
        }
        const config = parsedConfig ?? {};
        const agent = (config.agent ?? {});
        agent.explore = { disable: true };
        agent.general = { disable: true };
        config.agent = agent;
        writeConfig(configPath, config);
        return { success: true, configPath };
    }
    catch (err) {
        return {
            success: false,
            configPath,
            error: `Failed to disable default agents: ${err}`,
        };
    }
}
export function canModifyOpenCodeConfig() {
    try {
        const configPath = getExistingConfigPath();
        if (!existsSync(configPath))
            return true; // Will be created
        const stat = statSync(configPath);
        // Check if writable - simple check for now
        return !!(stat.mode & 0o200);
    }
    catch {
        return false;
    }
}
export function addAntigravityPlugin() {
    const configPath = getExistingConfigPath();
    try {
        const { config: parsedConfig, error } = parseConfig(configPath);
        if (error) {
            return {
                success: false,
                configPath,
                error: `Failed to parse config: ${error}`,
            };
        }
        const config = parsedConfig ?? {};
        const plugins = config.plugin ?? [];
        const pluginName = 'opencode-antigravity-auth@latest';
        if (!plugins.includes(pluginName)) {
            plugins.push(pluginName);
        }
        config.plugin = plugins;
        writeConfig(configPath, config);
        return { success: true, configPath };
    }
    catch (err) {
        return {
            success: false,
            configPath,
            error: `Failed to add antigravity plugin: ${err}`,
        };
    }
}
export function addGoogleProvider() {
    const configPath = getExistingConfigPath();
    try {
        const { config: parsedConfig, error } = parseConfig(configPath);
        if (error) {
            return {
                success: false,
                configPath,
                error: `Failed to parse config: ${error}`,
            };
        }
        const config = parsedConfig ?? {};
        const providers = (config.provider ?? {});
        providers.google = {
            models: {
                'antigravity-gemini-3-pro': {
                    name: 'Gemini 3 Pro (Antigravity)',
                    limit: { context: 1048576, output: 65535 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                    variants: {
                        low: { thinkingLevel: 'low' },
                        high: { thinkingLevel: 'high' },
                    },
                },
                'antigravity-gemini-3-flash': {
                    name: 'Gemini 3 Flash (Antigravity)',
                    limit: { context: 1048576, output: 65536 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                    variants: {
                        minimal: { thinkingLevel: 'minimal' },
                        low: { thinkingLevel: 'low' },
                        medium: { thinkingLevel: 'medium' },
                        high: { thinkingLevel: 'high' },
                    },
                },
                'antigravity-claude-sonnet-4-5': {
                    name: 'Claude Sonnet 4.5 (Antigravity)',
                    limit: { context: 200000, output: 64000 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                },
                'antigravity-claude-sonnet-4-5-thinking': {
                    name: 'Claude Sonnet 4.5 Thinking (Antigravity)',
                    limit: { context: 200000, output: 64000 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                    variants: {
                        low: { thinkingConfig: { thinkingBudget: 8192 } },
                        max: { thinkingConfig: { thinkingBudget: 32768 } },
                    },
                },
                'antigravity-claude-opus-4-5-thinking': {
                    name: 'Claude Opus 4.5 Thinking (Antigravity)',
                    limit: { context: 200000, output: 64000 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                    variants: {
                        low: { thinkingConfig: { thinkingBudget: 8192 } },
                        max: { thinkingConfig: { thinkingBudget: 32768 } },
                    },
                },
                'gemini-2.5-flash': {
                    name: 'Gemini 2.5 Flash (Gemini CLI)',
                    limit: { context: 1048576, output: 65536 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                },
                'gemini-2.5-pro': {
                    name: 'Gemini 2.5 Pro (Gemini CLI)',
                    limit: { context: 1048576, output: 65536 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                },
                'gemini-3-flash-preview': {
                    name: 'Gemini 3 Flash Preview (Gemini CLI)',
                    limit: { context: 1048576, output: 65536 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                },
                'gemini-3-pro-preview': {
                    name: 'Gemini 3 Pro Preview (Gemini CLI)',
                    limit: { context: 1048576, output: 65535 },
                    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                },
            },
        };
        config.provider = providers;
        writeConfig(configPath, config);
        return { success: true, configPath };
    }
    catch (err) {
        return {
            success: false,
            configPath,
            error: `Failed to add google provider: ${err}`,
        };
    }
}
export function addChutesProvider() {
    const configPath = getExistingConfigPath();
    try {
        const { config: parsedConfig, error } = parseConfig(configPath);
        if (error) {
            return {
                success: false,
                configPath,
                error: `Failed to parse config: ${error}`,
            };
        }
        const config = parsedConfig ?? {};
        const providers = (config.provider ?? {});
        providers.chutes = {
            npm: '@ai-sdk/openai-compatible',
            name: 'Chutes',
            options: {
                baseURL: 'https://llm.chutes.ai/v1',
                apiKey: '{env:CHUTES_API_KEY}',
            },
        };
        config.provider = providers;
        writeConfig(configPath, config);
        return { success: true, configPath };
    }
    catch (err) {
        return {
            success: false,
            configPath,
            error: `Failed to add chutes provider: ${err}`,
        };
    }
}
export function detectAntigravityConfig() {
    const { config } = parseConfig(getExistingConfigPath());
    if (!config)
        return false;
    const providers = config.provider;
    if (providers?.google)
        return true;
    const plugins = config.plugin ?? [];
    return plugins.some((p) => p.startsWith('opencode-antigravity-auth'));
}
export function detectCurrentConfig() {
    const result = {
        isInstalled: false,
        hasKimi: false,
        hasOpenAI: false,
        hasAnthropic: false,
        hasCopilot: false,
        hasZaiPlan: false,
        hasAntigravity: false,
        hasChutes: false,
        hasOpencodeZen: false,
        hasTmux: false,
    };
    const { config } = parseConfig(getExistingConfigPath());
    if (!config)
        return result;
    const plugins = config.plugin ?? [];
    result.isInstalled = plugins.some((p) => p.startsWith(PACKAGE_NAME));
    result.hasAntigravity = plugins.some((p) => p.startsWith('opencode-antigravity-auth'));
    // Check for providers
    const providers = config.provider;
    result.hasKimi = !!providers?.kimi;
    result.hasAnthropic = !!providers?.anthropic;
    result.hasCopilot = !!providers?.['github-copilot'];
    result.hasZaiPlan = !!providers?.['zai-coding-plan'];
    result.hasChutes = !!providers?.chutes;
    if (providers?.google)
        result.hasAntigravity = true;
    // Try to detect from lite config
    const { config: liteConfig } = parseConfig(getExistingLiteConfigPath());
    if (liteConfig && typeof liteConfig === 'object') {
        const configObj = liteConfig;
        const presetName = configObj.preset;
        const presets = configObj.presets;
        const agents = presets?.[presetName];
        if (agents) {
            const models = Object.values(agents)
                .map((a) => a?.model)
                .filter(Boolean);
            result.hasOpenAI = models.some((m) => m?.startsWith('openai/'));
            result.hasAnthropic = models.some((m) => m?.startsWith('anthropic/'));
            result.hasCopilot = models.some((m) => m?.startsWith('github-copilot/'));
            result.hasZaiPlan = models.some((m) => m?.startsWith('zai-coding-plan/'));
            result.hasOpencodeZen = models.some((m) => m?.startsWith('opencode/'));
            if (models.some((m) => m?.startsWith('google/'))) {
                result.hasAntigravity = true;
            }
            if (models.some((m) => m?.startsWith('chutes/'))) {
                result.hasChutes = true;
            }
        }
        if (configObj.tmux && typeof configObj.tmux === 'object') {
            const tmuxConfig = configObj.tmux;
            result.hasTmux = tmuxConfig.enabled === true;
        }
    }
    return result;
}
