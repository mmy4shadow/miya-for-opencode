import type { InstallConfig } from './types';
export declare const MODEL_MAPPINGS: {
    readonly kimi: {
        readonly orchestrator: {
            readonly model: "kimi-for-coding/k2p5";
        };
        readonly oracle: {
            readonly model: "kimi-for-coding/k2p5";
            readonly variant: "high";
        };
        readonly librarian: {
            readonly model: "kimi-for-coding/k2p5";
            readonly variant: "low";
        };
        readonly explorer: {
            readonly model: "kimi-for-coding/k2p5";
            readonly variant: "low";
        };
        readonly designer: {
            readonly model: "kimi-for-coding/k2p5";
            readonly variant: "medium";
        };
        readonly fixer: {
            readonly model: "kimi-for-coding/k2p5";
            readonly variant: "low";
        };
    };
    readonly openai: {
        readonly orchestrator: {
            readonly model: "openai/gpt-5.3-codex";
        };
        readonly oracle: {
            readonly model: "openai/gpt-5.3-codex";
            readonly variant: "high";
        };
        readonly librarian: {
            readonly model: "openai/gpt-5.1-codex-mini";
            readonly variant: "low";
        };
        readonly explorer: {
            readonly model: "openai/gpt-5.1-codex-mini";
            readonly variant: "low";
        };
        readonly designer: {
            readonly model: "openai/gpt-5.1-codex-mini";
            readonly variant: "medium";
        };
        readonly fixer: {
            readonly model: "openai/gpt-5.1-codex-mini";
            readonly variant: "low";
        };
    };
    readonly anthropic: {
        readonly orchestrator: {
            readonly model: "anthropic/claude-opus-4-6";
        };
        readonly oracle: {
            readonly model: "anthropic/claude-opus-4-6";
            readonly variant: "high";
        };
        readonly librarian: {
            readonly model: "anthropic/claude-sonnet-4-5";
            readonly variant: "low";
        };
        readonly explorer: {
            readonly model: "anthropic/claude-haiku-4-5";
            readonly variant: "low";
        };
        readonly designer: {
            readonly model: "anthropic/claude-sonnet-4-5";
            readonly variant: "medium";
        };
        readonly fixer: {
            readonly model: "anthropic/claude-sonnet-4-5";
            readonly variant: "low";
        };
    };
    readonly copilot: {
        readonly orchestrator: {
            readonly model: "github-copilot/grok-code-fast-1";
        };
        readonly oracle: {
            readonly model: "github-copilot/grok-code-fast-1";
            readonly variant: "high";
        };
        readonly librarian: {
            readonly model: "github-copilot/grok-code-fast-1";
            readonly variant: "low";
        };
        readonly explorer: {
            readonly model: "github-copilot/grok-code-fast-1";
            readonly variant: "low";
        };
        readonly designer: {
            readonly model: "github-copilot/grok-code-fast-1";
            readonly variant: "medium";
        };
        readonly fixer: {
            readonly model: "github-copilot/grok-code-fast-1";
            readonly variant: "low";
        };
    };
    readonly 'zai-plan': {
        readonly orchestrator: {
            readonly model: "zai-coding-plan/glm-4.7";
        };
        readonly oracle: {
            readonly model: "zai-coding-plan/glm-4.7";
            readonly variant: "high";
        };
        readonly librarian: {
            readonly model: "zai-coding-plan/glm-4.7";
            readonly variant: "low";
        };
        readonly explorer: {
            readonly model: "zai-coding-plan/glm-4.7";
            readonly variant: "low";
        };
        readonly designer: {
            readonly model: "zai-coding-plan/glm-4.7";
            readonly variant: "medium";
        };
        readonly fixer: {
            readonly model: "zai-coding-plan/glm-4.7";
            readonly variant: "low";
        };
    };
    readonly antigravity: {
        readonly orchestrator: {
            readonly model: "google/antigravity-gemini-3-flash";
        };
        readonly oracle: {
            readonly model: "google/antigravity-gemini-3-pro";
        };
        readonly librarian: {
            readonly model: "google/antigravity-gemini-3-flash";
            readonly variant: "low";
        };
        readonly explorer: {
            readonly model: "google/antigravity-gemini-3-flash";
            readonly variant: "low";
        };
        readonly designer: {
            readonly model: "google/antigravity-gemini-3-flash";
            readonly variant: "medium";
        };
        readonly fixer: {
            readonly model: "google/antigravity-gemini-3-flash";
            readonly variant: "low";
        };
    };
    readonly chutes: {
        readonly orchestrator: {
            readonly model: "chutes/kimi-k2.5";
        };
        readonly oracle: {
            readonly model: "chutes/kimi-k2.5";
            readonly variant: "high";
        };
        readonly librarian: {
            readonly model: "chutes/minimax-m2.1";
            readonly variant: "low";
        };
        readonly explorer: {
            readonly model: "chutes/minimax-m2.1";
            readonly variant: "low";
        };
        readonly designer: {
            readonly model: "chutes/kimi-k2.5";
            readonly variant: "medium";
        };
        readonly fixer: {
            readonly model: "chutes/minimax-m2.1";
            readonly variant: "low";
        };
    };
    readonly 'zen-free': {
        readonly orchestrator: {
            readonly model: "opencode/big-pickle";
        };
        readonly oracle: {
            readonly model: "opencode/big-pickle";
            readonly variant: "high";
        };
        readonly librarian: {
            readonly model: "opencode/big-pickle";
            readonly variant: "low";
        };
        readonly explorer: {
            readonly model: "opencode/big-pickle";
            readonly variant: "low";
        };
        readonly designer: {
            readonly model: "opencode/big-pickle";
            readonly variant: "medium";
        };
        readonly fixer: {
            readonly model: "opencode/big-pickle";
            readonly variant: "low";
        };
    };
};
export declare function generateAntigravityMixedPreset(config: InstallConfig, existingPreset?: Record<string, unknown>): Record<string, unknown>;
export declare function generateLiteConfig(installConfig: InstallConfig): Record<string, unknown>;
