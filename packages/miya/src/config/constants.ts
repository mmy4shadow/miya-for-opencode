// Agent names
export const AGENT_ALIASES: Record<string, string> = {
  // legacy names -> current names
  orchestrator: '1-task-manager',
  explorer: '2-code-search',
  librarian: '3-docs-helper',
  oracle: '4-architecture-advisor',
  fixer: '5-code-fixer',
  designer: '6-ui-designer',

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

export const ALL_AGENT_NAMES = [ORCHESTRATOR_NAME, ...SUBAGENT_NAMES] as const;

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
};

// Default models for each agent
export const DEFAULT_MODELS: Record<AgentName, string> = {
  '1-task-manager': 'kimi-for-coding/k2p5',
  '2-code-search': 'openai/gpt-5.1-codex-mini',
  '3-docs-helper': 'openai/gpt-5.1-codex-mini',
  '4-architecture-advisor': 'openai/gpt-5.2-codex',
  '5-code-fixer': 'openai/gpt-5.1-codex-mini',
  '6-ui-designer': 'kimi-for-coding/k2p5',
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
