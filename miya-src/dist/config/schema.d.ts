import { z } from 'zod';
declare const FALLBACK_AGENT_NAMES: readonly ["1-task-manager", "2-code-search", "3-docs-helper", "4-architecture-advisor", "5-code-fixer", "6-ui-designer", "7-code-simplicity-reviewer"];
export type FallbackAgentName = (typeof FALLBACK_AGENT_NAMES)[number];
export declare const AgentOverrideConfigSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    variant: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    providerID: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    apiKey: z.ZodOptional<z.ZodString>;
    baseURL: z.ZodOptional<z.ZodString>;
    skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
    mcps: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const TmuxLayoutSchema: z.ZodEnum<{
    "main-horizontal": "main-horizontal";
    "main-vertical": "main-vertical";
    tiled: "tiled";
    "even-horizontal": "even-horizontal";
    "even-vertical": "even-vertical";
}>;
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>;
export declare const TmuxConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    layout: z.ZodDefault<z.ZodEnum<{
        "main-horizontal": "main-horizontal";
        "main-vertical": "main-vertical";
        tiled: "tiled";
        "even-horizontal": "even-horizontal";
        "even-vertical": "even-vertical";
    }>>;
    main_pane_size: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type TmuxConfig = z.infer<typeof TmuxConfigSchema>;
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;
export declare const PresetSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    variant: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    providerID: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    apiKey: z.ZodOptional<z.ZodString>;
    baseURL: z.ZodOptional<z.ZodString>;
    skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
    mcps: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>>;
export type Preset = z.infer<typeof PresetSchema>;
export declare const McpNameSchema: z.ZodEnum<{
    websearch: "websearch";
    context7: "context7";
    grep_app: "grep_app";
}>;
export type McpName = z.infer<typeof McpNameSchema>;
export declare const BackgroundTaskConfigSchema: z.ZodObject<{
    maxConcurrentStarts: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>;
export declare const UiConfigSchema: z.ZodObject<{
    dashboard: z.ZodOptional<z.ZodObject<{
        openOnStart: z.ZodOptional<z.ZodBoolean>;
        dockAutoLaunch: z.ZodOptional<z.ZodBoolean>;
        autoOpenCooldownMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type UiConfig = z.infer<typeof UiConfigSchema>;
export declare const SlimCompatConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    useSlimOrchestratorPrompt: z.ZodDefault<z.ZodBoolean>;
    enableCodeSimplicityReviewer: z.ZodDefault<z.ZodBoolean>;
    enablePostWriteSimplicityNudge: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type SlimCompatConfig = z.infer<typeof SlimCompatConfigSchema>;
export declare const ContextGovernanceConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    toolOutputMaxChars: z.ZodDefault<z.ZodNumber>;
    toolOutputHeadChars: z.ZodDefault<z.ZodNumber>;
    toolOutputTailChars: z.ZodDefault<z.ZodNumber>;
    recordTtlMs: z.ZodDefault<z.ZodNumber>;
    maxRecordsPerSession: z.ZodDefault<z.ZodNumber>;
    maxInjectedRecords: z.ZodDefault<z.ZodNumber>;
    maxInjectedChars: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type ContextGovernanceConfig = z.infer<typeof ContextGovernanceConfigSchema>;
export declare const FailoverConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    chains: z.ZodDefault<z.ZodObject<{
        '1-task-manager': z.ZodOptional<z.ZodArray<z.ZodString>>;
        '2-code-search': z.ZodOptional<z.ZodArray<z.ZodString>>;
        '3-docs-helper': z.ZodOptional<z.ZodArray<z.ZodString>>;
        '4-architecture-advisor': z.ZodOptional<z.ZodArray<z.ZodString>>;
        '5-code-fixer': z.ZodOptional<z.ZodArray<z.ZodString>>;
        '6-ui-designer': z.ZodOptional<z.ZodArray<z.ZodString>>;
        '7-code-simplicity-reviewer': z.ZodOptional<z.ZodArray<z.ZodString>>;
        orchestrator: z.ZodOptional<z.ZodArray<z.ZodString>>;
        explorer: z.ZodOptional<z.ZodArray<z.ZodString>>;
        librarian: z.ZodOptional<z.ZodArray<z.ZodString>>;
        oracle: z.ZodOptional<z.ZodArray<z.ZodString>>;
        fixer: z.ZodOptional<z.ZodArray<z.ZodString>>;
        designer: z.ZodOptional<z.ZodArray<z.ZodString>>;
        'code-simplicity-reviewer': z.ZodOptional<z.ZodArray<z.ZodString>>;
        simplicity_reviewer: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strip>;
export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;
export declare const PluginConfigSchema: z.ZodObject<{
    preset: z.ZodOptional<z.ZodString>;
    presets: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        variant: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        providerID: z.ZodOptional<z.ZodString>;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        apiKey: z.ZodOptional<z.ZodString>;
        baseURL: z.ZodOptional<z.ZodString>;
        skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
        mcps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>>;
    agents: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        temperature: z.ZodOptional<z.ZodNumber>;
        variant: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        providerID: z.ZodOptional<z.ZodString>;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        apiKey: z.ZodOptional<z.ZodString>;
        baseURL: z.ZodOptional<z.ZodString>;
        skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
        mcps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>;
    provider: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    disabled_mcps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    tmux: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        layout: z.ZodDefault<z.ZodEnum<{
            "main-horizontal": "main-horizontal";
            "main-vertical": "main-vertical";
            tiled: "tiled";
            "even-horizontal": "even-horizontal";
            "even-vertical": "even-vertical";
        }>>;
        main_pane_size: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    ui: z.ZodOptional<z.ZodObject<{
        dashboard: z.ZodOptional<z.ZodObject<{
            openOnStart: z.ZodOptional<z.ZodBoolean>;
            dockAutoLaunch: z.ZodOptional<z.ZodBoolean>;
            autoOpenCooldownMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    background: z.ZodOptional<z.ZodObject<{
        maxConcurrentStarts: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    fallback: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        chains: z.ZodDefault<z.ZodObject<{
            '1-task-manager': z.ZodOptional<z.ZodArray<z.ZodString>>;
            '2-code-search': z.ZodOptional<z.ZodArray<z.ZodString>>;
            '3-docs-helper': z.ZodOptional<z.ZodArray<z.ZodString>>;
            '4-architecture-advisor': z.ZodOptional<z.ZodArray<z.ZodString>>;
            '5-code-fixer': z.ZodOptional<z.ZodArray<z.ZodString>>;
            '6-ui-designer': z.ZodOptional<z.ZodArray<z.ZodString>>;
            '7-code-simplicity-reviewer': z.ZodOptional<z.ZodArray<z.ZodString>>;
            orchestrator: z.ZodOptional<z.ZodArray<z.ZodString>>;
            explorer: z.ZodOptional<z.ZodArray<z.ZodString>>;
            librarian: z.ZodOptional<z.ZodArray<z.ZodString>>;
            oracle: z.ZodOptional<z.ZodArray<z.ZodString>>;
            fixer: z.ZodOptional<z.ZodArray<z.ZodString>>;
            designer: z.ZodOptional<z.ZodArray<z.ZodString>>;
            'code-simplicity-reviewer': z.ZodOptional<z.ZodArray<z.ZodString>>;
            simplicity_reviewer: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
    }, z.core.$strip>>;
    slimCompat: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        useSlimOrchestratorPrompt: z.ZodDefault<z.ZodBoolean>;
        enableCodeSimplicityReviewer: z.ZodDefault<z.ZodBoolean>;
        enablePostWriteSimplicityNudge: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    contextGovernance: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        toolOutputMaxChars: z.ZodDefault<z.ZodNumber>;
        toolOutputHeadChars: z.ZodDefault<z.ZodNumber>;
        toolOutputTailChars: z.ZodDefault<z.ZodNumber>;
        recordTtlMs: z.ZodDefault<z.ZodNumber>;
        maxRecordsPerSession: z.ZodDefault<z.ZodNumber>;
        maxInjectedRecords: z.ZodDefault<z.ZodNumber>;
        maxInjectedChars: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type { AgentName } from './constants';
