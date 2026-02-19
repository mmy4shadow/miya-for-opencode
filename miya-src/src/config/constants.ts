// Agent names
export const AGENT_ALIASES: Record<string, string> = {
  // legacy names -> current names
  orchestrator: '1-task-manager',
  explorer: '2-code-search',
  librarian: '3-docs-helper',
  oracle: '4-architecture-advisor',
  fixer: '5-code-fixer',
  designer: '6-ui-designer',
  'code-simplicity-reviewer': '7-code-simplicity-reviewer',
  simplicity_reviewer: '7-code-simplicity-reviewer',

  // extra compatibility aliases
  explore: '2-code-search',
  'frontend-ui-ux-engineer': '6-ui-designer',
  '4-code-fixer': '5-code-fixer',
  '5-ui-designer': '6-ui-designer',
  '6-architecture-advisor': '4-architecture-advisor',
};

export const SUBAGENT_NAMES = [
  '2-code-search',
  '3-docs-helper',
  '4-architecture-advisor',
  '5-code-fixer',
  '6-ui-designer',
] as const;

export const ORCHESTRATOR_NAME = '1-task-manager' as const;
export const CODE_SIMPLICITY_REVIEWER_NAME = '7-code-simplicity-reviewer' as const;

export const ALL_AGENT_NAMES = [
  ORCHESTRATOR_NAME,
  ...SUBAGENT_NAMES,
  CODE_SIMPLICITY_REVIEWER_NAME,
] as const;

// Agent name type (for use in DEFAULT_MODELS)
export type AgentName = (typeof ALL_AGENT_NAMES)[number];

// Subagent delegation rules: which agents can spawn which subagents
// orchestrator: can spawn all subagents (full delegation)
// fixer: can spawn explorer (for research during implementation)
// designer: can spawn explorer (for research during design)
// explorer/librarian/oracle: cannot spawn any subagents (leaf nodes)
// Unknown agent types not listed here default to explorer-only access
export const SUBAGENT_DELEGATION_RULES: Record<AgentName, readonly string[]> = {
  '1-task-manager': SUBAGENT_NAMES,
  '2-code-search': [],
  '3-docs-helper': [],
  '4-architecture-advisor': [],
  '5-code-fixer': ['2-code-search'],
  '6-ui-designer': ['2-code-search'],
  '7-code-simplicity-reviewer': [],
};

// Default models for each agent
// Using openrouter providers as default
export const DEFAULT_MODELS: Record<AgentName, string> = {
  '1-task-manager': 'openrouter/moonshotai/kimi-k2.5',
  '2-code-search': 'openrouter/moonshotai/kimi-k2.5',
  '3-docs-helper': 'openrouter/moonshotai/kimi-k2.5',
  '4-architecture-advisor': 'openrouter/moonshotai/kimi-k2.5',
  '5-code-fixer': 'openrouter/z-ai/glm-5',
  '6-ui-designer': 'openrouter/z-ai/glm-5',
  '7-code-simplicity-reviewer': 'openrouter/z-ai/glm-5',
};

// Polling configuration
export const POLL_INTERVAL_MS = 500;
export const POLL_INTERVAL_SLOW_MS = 1000;
export const POLL_INTERVAL_BACKGROUND_MS = 2000;

// Timeouts
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
export const MAX_POLL_TIME_MS = 5 * 60 * 1000; // 5 minutes
export const FALLBACK_FAILOVER_TIMEOUT_MS = 15_000;

// Polling stability
export const STABLE_POLLS_THRESHOLD = 3;

// Miya security/runtime guardrails
export const MIYA_SECURITY_CONSTANTS = {
  INPUT_MUTEX_TIMEOUT_MS: 20_000, // 20 seconds patience threshold
  DECAY_STRATEGY: 'EXPONENTIAL',
  DEFAULT_LAMBDA: 0.05,
  WHITESPACE_PROTECTION: true, // physical input mutex protection
} as const;
