import { z } from 'zod';

const FALLBACK_AGENT_NAMES = [
  '1-task-manager',
  '2-code-search',
  '3-docs-helper',
  '4-architecture-advisor',
  '5-code-fixer',
  '6-ui-designer',
  '7-code-simplicity-reviewer',
] as const;

const AgentModelChainSchema = z.array(z.string()).min(1);

const FallbackChainsSchema = z
  .object({
    // New agent names
    '1-task-manager': AgentModelChainSchema.optional(),
    '2-code-search': AgentModelChainSchema.optional(),
    '3-docs-helper': AgentModelChainSchema.optional(),
    '4-architecture-advisor': AgentModelChainSchema.optional(),
    '5-code-fixer': AgentModelChainSchema.optional(),
    '6-ui-designer': AgentModelChainSchema.optional(),
    '7-code-simplicity-reviewer': AgentModelChainSchema.optional(),

    // Legacy names (backward compatibility)
    orchestrator: AgentModelChainSchema.optional(),
    explorer: AgentModelChainSchema.optional(),
    librarian: AgentModelChainSchema.optional(),
    oracle: AgentModelChainSchema.optional(),
    fixer: AgentModelChainSchema.optional(),
    designer: AgentModelChainSchema.optional(),
    'code-simplicity-reviewer': AgentModelChainSchema.optional(),
    simplicity_reviewer: AgentModelChainSchema.optional(),
  })
  .strict();

export type FallbackAgentName = (typeof FALLBACK_AGENT_NAMES)[number];

// Agent override configuration (distinct from SDK's AgentConfig)
export const AgentOverrideConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  variant: z.string().optional().catch(undefined),
  providerID: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  skills: z.array(z.string()).optional(), // skills this agent can use ("*" = all, "!item" = exclude)
  mcps: z.array(z.string()).optional(), // MCPs this agent can use ("*" = all, "!item" = exclude)
});

// Tmux layout options
export const TmuxLayoutSchema = z.enum([
  'main-horizontal', // Main pane on top, agents stacked below
  'main-vertical', // Main pane on left, agents stacked on right
  'tiled', // All panes equal size grid
  'even-horizontal', // All panes side by side
  'even-vertical', // All panes stacked vertically
]);

export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>;

// Tmux integration configuration
export const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  layout: TmuxLayoutSchema.default('main-vertical'),
  main_pane_size: z.number().min(20).max(80).default(60), // percentage for main pane
});

export type TmuxConfig = z.infer<typeof TmuxConfigSchema>;

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;

export const PresetSchema = z.record(z.string(), AgentOverrideConfigSchema);

export type Preset = z.infer<typeof PresetSchema>;

// MCP names
export const McpNameSchema = z.enum(['websearch', 'context7', 'grep_app']);
export type McpName = z.infer<typeof McpNameSchema>;

// Background task configuration
export const BackgroundTaskConfigSchema = z.object({
  maxConcurrentStarts: z.number().min(1).max(50).default(10),
});

export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>;

export const UiConfigSchema = z.object({
  dashboard: z
    .object({
      openOnStart: z.boolean().optional(),
      dockAutoLaunch: z.boolean().optional(),
      autoOpenCooldownMs: z.number().min(10_000).max(24 * 60_000).optional(),
    })
    .optional(),
});

export type UiConfig = z.infer<typeof UiConfigSchema>;

export const SlimCompatConfigSchema = z.object({
  enabled: z.boolean().default(false),
  useSlimOrchestratorPrompt: z.boolean().default(false),
  enableCodeSimplicityReviewer: z.boolean().default(false),
  enablePostWriteSimplicityNudge: z.boolean().default(false),
});

export type SlimCompatConfig = z.infer<typeof SlimCompatConfigSchema>;

export const ContextGovernanceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  toolOutputMaxChars: z.number().min(1200).max(200000).default(12000),
  toolOutputHeadChars: z.number().min(200).max(100000).default(4200),
  toolOutputTailChars: z.number().min(100).max(100000).default(2800),
  recordTtlMs: z.number().min(10000).max(86_400_000).default(12 * 60 * 1000),
  maxRecordsPerSession: z.number().min(5).max(200).default(30),
  maxInjectedRecords: z.number().min(1).max(20).default(3),
  maxInjectedChars: z.number().min(400).max(20_000).default(2400),
});

export type ContextGovernanceConfig = z.infer<typeof ContextGovernanceConfigSchema>;

export const FailoverConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().min(1000).max(120000).default(15000),
  chains: FallbackChainsSchema.default({}),
});

export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;

// Main plugin config
export const PluginConfigSchema = z.object({
  preset: z.string().optional(),
  presets: z.record(z.string(), PresetSchema).optional(),
  agents: z.record(z.string(), AgentOverrideConfigSchema).optional(),
  provider: z.record(z.string(), z.unknown()).optional(),
  disabled_mcps: z.array(z.string()).optional(),
  tmux: TmuxConfigSchema.optional(),
  ui: UiConfigSchema.optional(),
  background: BackgroundTaskConfigSchema.optional(),
  fallback: FailoverConfigSchema.optional(),
  slimCompat: SlimCompatConfigSchema.optional(),
  contextGovernance: ContextGovernanceConfigSchema.optional(),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// Agent names - re-exported from constants for convenience
export type { AgentName } from './constants';
