/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import {
  generateAntigravityMixedPreset,
  generateLiteConfig,
  MODEL_MAPPINGS,
} from './providers';

describe('providers', () => {
  test('generateLiteConfig generates kimi config when only kimi selected', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: true,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    expect(config.preset).toBe('kimi');
    const agents = (config.presets as any).kimi;
    expect(agents).toBeDefined();
    expect(agents['1-task-manager'].model).toBe('kimi-for-coding/k2p5');
    expect(agents['1-task-manager'].variant).toBeUndefined();
    expect(agents['5-code-fixer'].model).toBe('kimi-for-coding/k2p5');
    expect(agents['5-code-fixer'].variant).toBe('low');
    // Should NOT include other presets
    expect((config.presets as any).openai).toBeUndefined();
    expect((config.presets as any)['zen-free']).toBeUndefined();
  });

  test('generateLiteConfig generates kimi-openai preset when both selected', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: true,
      hasOpenAI: true,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    expect(config.preset).toBe('kimi');
    const agents = (config.presets as any).kimi;
    expect(agents).toBeDefined();
    expect(agents['1-task-manager'].model).toBe('kimi-for-coding/k2p5');
    expect(agents['1-task-manager'].variant).toBeUndefined();
    // Oracle uses OpenAI when both kimi and openai are enabled
    expect(agents['4-architecture-advisor'].model).toBe('openai/gpt-5.3-codex');
    expect(agents['4-architecture-advisor'].variant).toBe('high');
    // Should NOT include other presets
    expect((config.presets as any).openai).toBeUndefined();
    expect((config.presets as any)['zen-free']).toBeUndefined();
  });

  test('generateLiteConfig generates openai preset when only openai selected', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: true,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    expect(config.preset).toBe('openai');
    const agents = (config.presets as any).openai;
    expect(agents).toBeDefined();
    expect(agents['1-task-manager'].model).toBe(
      MODEL_MAPPINGS.openai.orchestrator.model,
    );
    expect(agents['1-task-manager'].variant).toBeUndefined();
    // Should NOT include other presets
    expect((config.presets as any).kimi).toBeUndefined();
    expect((config.presets as any)['zen-free']).toBeUndefined();
  });

  test('generateLiteConfig generates chutes preset when only chutes selected', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: false,
      hasChutes: true,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
      selectedChutesPrimaryModel: 'chutes/kimi-k2.5',
      selectedChutesSecondaryModel: 'chutes/minimax-m2.1',
    });

    expect(config.preset).toBe('chutes');
    const agents = (config.presets as any).chutes;
    expect(agents).toBeDefined();
    expect(agents['1-task-manager'].model).toBe('chutes/kimi-k2.5');
    expect(agents['4-architecture-advisor'].model).toBe('chutes/kimi-k2.5');
    expect(agents['6-ui-designer'].model).toBe('chutes/kimi-k2.5');
    expect(agents['2-code-search'].model).toBe('chutes/minimax-m2.1');
    expect(agents['3-docs-helper'].model).toBe('chutes/minimax-m2.1');
    expect(agents['5-code-fixer'].model).toBe('chutes/minimax-m2.1');
  });

  test('generateLiteConfig generates anthropic preset when only anthropic selected', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: false,
      hasAnthropic: true,
      hasCopilot: false,
      hasZaiPlan: false,
      hasChutes: false,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    expect(config.preset).toBe('anthropic');
    const agents = (config.presets as any).anthropic;
    expect(agents['1-task-manager'].model).toBe('anthropic/claude-opus-4-6');
    expect(agents['4-architecture-advisor'].model).toBe('anthropic/claude-opus-4-6');
    expect(agents['2-code-search'].model).toBe('anthropic/claude-haiku-4-5');
  });

  test('generateLiteConfig prefers Chutes Kimi in mixed openai/antigravity when chutes is enabled', () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasKimi: false,
      hasOpenAI: true,
      hasChutes: true,
      hasOpencodeZen: true,
      useOpenCodeFreeModels: true,
      selectedOpenCodePrimaryModel: 'opencode/glm-4.7-free',
      selectedOpenCodeSecondaryModel: 'opencode/gpt-5-nano',
      selectedChutesPrimaryModel: 'chutes/kimi-k2.5',
      selectedChutesSecondaryModel: 'chutes/minimax-m2.1',
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    expect(config.preset).toBe('antigravity-mixed-openai');
    const agents = (config.presets as any)['antigravity-mixed-openai'];
    expect(agents['1-task-manager'].model).toBe('chutes/kimi-k2.5');
    expect(agents['4-architecture-advisor'].model).toBe('openai/gpt-5.3-codex');
    expect(agents['2-code-search'].model).toBe('opencode/gpt-5-nano');
  });

  test('generateLiteConfig emits fallback chains for six agents', () => {
    const config = generateLiteConfig({
      hasAntigravity: true,
      hasKimi: true,
      hasOpenAI: true,
      hasChutes: true,
      hasOpencodeZen: true,
      useOpenCodeFreeModels: true,
      selectedOpenCodePrimaryModel: 'opencode/glm-4.7-free',
      selectedOpenCodeSecondaryModel: 'opencode/gpt-5-nano',
      selectedChutesPrimaryModel: 'chutes/kimi-k2.5',
      selectedChutesSecondaryModel: 'chutes/minimax-m2.1',
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    expect((config.fallback as any).enabled).toBe(true);
    expect((config.fallback as any).timeoutMs).toBe(15000);
    const chains = (config.fallback as any).chains;
    expect(Object.keys(chains).sort()).toEqual([
      '1-task-manager',
      '2-code-search',
      '3-docs-helper',
      '4-architecture-advisor',
      '5-code-fixer',
      '6-ui-designer',
    ]);
    expect(chains['1-task-manager']).toContain('openai/gpt-5.3-codex');
    expect(chains['1-task-manager']).toContain('kimi-for-coding/k2p5');
    expect(chains['1-task-manager']).toContain('google/antigravity-gemini-3-flash');
    expect(chains['1-task-manager']).toContain('chutes/kimi-k2.5');
    expect(chains['1-task-manager']).toContain('opencode/glm-4.7-free');
  });

  test('generateLiteConfig generates zen-free preset when no providers selected', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    expect(config.preset).toBe('zen-free');
    const agents = (config.presets as any)['zen-free'];
    expect(agents).toBeDefined();
    expect(agents['1-task-manager'].model).toBe('opencode/big-pickle');
    expect(agents['1-task-manager'].variant).toBeUndefined();
    // Should NOT include other presets
    expect((config.presets as any).kimi).toBeUndefined();
    expect((config.presets as any).openai).toBeUndefined();
  });

  test('generateLiteConfig uses zen-free big-pickle models', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: false,
      hasOpencodeZen: true,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    expect(config.preset).toBe('zen-free');
    const agents = (config.presets as any)['zen-free'];
    expect(agents['1-task-manager'].model).toBe('opencode/big-pickle');
    expect(agents['4-architecture-advisor'].model).toBe('opencode/big-pickle');
    expect(agents['4-architecture-advisor'].variant).toBe('high');
    expect(agents['3-docs-helper'].model).toBe('opencode/big-pickle');
    expect(agents['3-docs-helper'].variant).toBe('low');
  });

  test('generateLiteConfig enables tmux when requested', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: true,
      installSkills: false,
      installCustomSkills: false,
    });

    expect(config.tmux).toBeDefined();
    expect((config.tmux as any).enabled).toBe(true);
  });

  test('generateLiteConfig includes default skills', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: true,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: true,
      installCustomSkills: false,
    });

    const agents = (config.presets as any).kimi;
    // Orchestrator should always have '*'
    expect(agents['1-task-manager'].skills).toEqual(['*']);

    // Designer should have 'agent-browser'
    expect(agents['6-ui-designer'].skills).toContain('agent-browser');

    // Fixer should have no skills by default (empty recommended list)
    expect(agents['5-code-fixer'].skills).toEqual([]);
  });

  test('generateLiteConfig includes mcps field', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: true,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    const agents = (config.presets as any).kimi;
    expect(agents['1-task-manager'].mcps).toBeDefined();
    expect(Array.isArray(agents['1-task-manager'].mcps)).toBe(true);
    expect(agents['3-docs-helper'].mcps).toBeDefined();
    expect(Array.isArray(agents['3-docs-helper'].mcps)).toBe(true);
  });

  test('generateLiteConfig applies OpenCode free model overrides in hybrid mode', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: true,
      hasOpencodeZen: true,
      useOpenCodeFreeModels: true,
      selectedOpenCodePrimaryModel: 'opencode/glm-4.7-free',
      selectedOpenCodeSecondaryModel: 'opencode/gpt-5-nano',
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    const agents = (config.presets as any).openai;
    expect(agents['1-task-manager'].model).toBe(
      MODEL_MAPPINGS.openai.orchestrator.model,
    );
    expect(agents['4-architecture-advisor'].model).toBe(
      MODEL_MAPPINGS.openai.oracle.model,
    );
    expect(agents['2-code-search'].model).toBe('opencode/gpt-5-nano');
    expect(agents['3-docs-helper'].model).toBe('opencode/gpt-5-nano');
    expect(agents['5-code-fixer'].model).toBe('opencode/gpt-5-nano');
  });

  test('generateLiteConfig applies OpenCode free model overrides in OpenCode-only mode', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: false,
      hasOpencodeZen: true,
      useOpenCodeFreeModels: true,
      selectedOpenCodePrimaryModel: 'opencode/glm-4.7-free',
      selectedOpenCodeSecondaryModel: 'opencode/gpt-5-nano',
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    const agents = (config.presets as any)['zen-free'];
    expect(agents['1-task-manager'].model).toBe('opencode/glm-4.7-free');
    expect(agents['4-architecture-advisor'].model).toBe('opencode/glm-4.7-free');
    expect(agents['6-ui-designer'].model).toBe('opencode/glm-4.7-free');
    expect(agents['2-code-search'].model).toBe('opencode/gpt-5-nano');
    expect(agents['3-docs-helper'].model).toBe('opencode/gpt-5-nano');
    expect(agents['5-code-fixer'].model).toBe('opencode/gpt-5-nano');
  });

  test('generateLiteConfig zen-free includes correct mcps', () => {
    const config = generateLiteConfig({
      hasAntigravity: false,
      hasKimi: false,
      hasOpenAI: false,
      hasOpencodeZen: false,
      hasTmux: false,
      installSkills: false,
      installCustomSkills: false,
    });

    const agents = (config.presets as any)['zen-free'];
    expect(agents['1-task-manager'].mcps).toContain('websearch');
    expect(agents['3-docs-helper'].mcps).toContain('websearch');
    expect(agents['3-docs-helper'].mcps).toContain('context7');
    expect(agents['3-docs-helper'].mcps).toContain('grep_app');
    expect(agents['6-ui-designer'].mcps).toEqual([]);
  });

  // Antigravity tests
  describe('Antigravity presets', () => {
    test('generateLiteConfig generates antigravity-mixed-both preset when all providers selected', () => {
      const config = generateLiteConfig({
        hasKimi: true,
        hasOpenAI: true,
        hasAntigravity: true,
        hasOpencodeZen: false,
        hasTmux: false,
        installSkills: false,
        installCustomSkills: false,
      });

      expect(config.preset).toBe('antigravity-mixed-both');
      const agents = (config.presets as any)['antigravity-mixed-both'];
      expect(agents).toBeDefined();

      // Orchestrator should use Kimi
      expect(agents['1-task-manager'].model).toBe('kimi-for-coding/k2p5');

      // Oracle should use OpenAI
      expect(agents['4-architecture-advisor'].model).toBe('openai/gpt-5.3-codex');
      expect(agents['4-architecture-advisor'].variant).toBe('high');

      // Explorer/Librarian/Designer use Antigravity Flash; Fixer prefers OpenAI
      expect(agents['2-code-search'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['2-code-search'].variant).toBe('low');
      expect(agents['3-docs-helper'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['3-docs-helper'].variant).toBe('low');
      expect(agents['6-ui-designer'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['6-ui-designer'].variant).toBe('medium');
      expect(agents['5-code-fixer'].model).toBe('openai/gpt-5.3-codex');
      expect(agents['5-code-fixer'].variant).toBe('low');
    });

    test('generateLiteConfig generates antigravity-mixed-kimi preset when Kimi + Antigravity', () => {
      const config = generateLiteConfig({
        hasKimi: true,
        hasOpenAI: false,
        hasAntigravity: true,
        hasOpencodeZen: false,
        hasTmux: false,
        installSkills: false,
        installCustomSkills: false,
      });

      expect(config.preset).toBe('antigravity-mixed-kimi');
      const agents = (config.presets as any)['antigravity-mixed-kimi'];
      expect(agents).toBeDefined();

      // Orchestrator should use Kimi
      expect(agents['1-task-manager'].model).toBe('kimi-for-coding/k2p5');

      // Oracle should use Antigravity (no OpenAI)
      expect(agents['4-architecture-advisor'].model).toBe('google/antigravity-gemini-3-pro');

      // Others should use Antigravity Flash
      expect(agents['2-code-search'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['3-docs-helper'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['6-ui-designer'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['5-code-fixer'].model).toBe('google/antigravity-gemini-3-flash');
    });

    test('generateLiteConfig generates antigravity-mixed-openai preset when OpenAI + Antigravity', () => {
      const config = generateLiteConfig({
        hasKimi: false,
        hasOpenAI: true,
        hasAntigravity: true,
        hasOpencodeZen: false,
        hasTmux: false,
        installSkills: false,
        installCustomSkills: false,
      });

      expect(config.preset).toBe('antigravity-mixed-openai');
      const agents = (config.presets as any)['antigravity-mixed-openai'];
      expect(agents).toBeDefined();

      // Orchestrator should use Antigravity (no Kimi)
      expect(agents['1-task-manager'].model).toBe(
        'google/antigravity-gemini-3-flash',
      );

      // Oracle should use OpenAI
      expect(agents['4-architecture-advisor'].model).toBe('openai/gpt-5.3-codex');
      expect(agents['4-architecture-advisor'].variant).toBe('high');

      // Explorer/Librarian/Designer use Antigravity Flash; Fixer prefers OpenAI
      expect(agents['2-code-search'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['3-docs-helper'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['6-ui-designer'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['5-code-fixer'].model).toBe('openai/gpt-5.3-codex');
    });

    test('generateLiteConfig generates pure antigravity preset when only Antigravity', () => {
      const config = generateLiteConfig({
        hasKimi: false,
        hasOpenAI: false,
        hasAntigravity: true,
        hasOpencodeZen: false,
        hasTmux: false,
        installSkills: false,
        installCustomSkills: false,
      });

      expect(config.preset).toBe('antigravity');
      const agents = (config.presets as any).antigravity;
      expect(agents).toBeDefined();

      // All agents should use Antigravity
      expect(agents['1-task-manager'].model).toBe(
        'google/antigravity-gemini-3-flash',
      );
      expect(agents['4-architecture-advisor'].model).toBe('google/antigravity-gemini-3-pro');
      expect(agents['2-code-search'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['3-docs-helper'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['6-ui-designer'].model).toBe('google/antigravity-gemini-3-flash');
      expect(agents['5-code-fixer'].model).toBe('google/antigravity-gemini-3-flash');
    });

    test('generateAntigravityMixedPreset respects Kimi for 1-task-manager', () => {
      const preset = generateAntigravityMixedPreset({
        hasKimi: true,
        hasOpenAI: false,
        hasAntigravity: true,
        hasOpencodeZen: false,
        hasTmux: false,
        installSkills: false,
        installCustomSkills: false,
      });

      expect((preset['1-task-manager'] as any).model).toBe('kimi-for-coding/k2p5');
    });

    test('generateAntigravityMixedPreset respects OpenAI for 4-architecture-advisor', () => {
      const preset = generateAntigravityMixedPreset({
        hasKimi: false,
        hasOpenAI: true,
        hasAntigravity: true,
        hasOpencodeZen: false,
        hasTmux: false,
        installSkills: false,
        installCustomSkills: false,
      });

      expect((preset['4-architecture-advisor'] as any).model).toBe('openai/gpt-5.3-codex');
      expect((preset['4-architecture-advisor'] as any).variant).toBe('high');
    });

    test('generateAntigravityMixedPreset uses OpenAI 5-code-fixer and Antigravity support defaults', () => {
      const preset = generateAntigravityMixedPreset({
        hasKimi: true,
        hasOpenAI: true,
        hasAntigravity: true,
        hasOpencodeZen: false,
        hasTmux: false,
        installSkills: false,
        installCustomSkills: false,
      });

      expect((preset['2-code-search'] as any).model).toBe(
        'google/antigravity-gemini-3-flash',
      );
      expect((preset['3-docs-helper'] as any).model).toBe(
        'google/antigravity-gemini-3-flash',
      );
      expect((preset['6-ui-designer'] as any).model).toBe(
        'google/antigravity-gemini-3-flash',
      );
      expect((preset['5-code-fixer'] as any).model).toBe('openai/gpt-5.3-codex');
    });
  });
});
