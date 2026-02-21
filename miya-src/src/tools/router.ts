import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  addRouteFeedback,
  buildRouteExecutionPlan,
  classifyIntent,
  getRouteCostSummary,
  getRouterSessionState,
  listRouteCostRecords,
  listRouteUsageRecords,
  readRouterModeConfig,
  summarizeRouteHistory,
  summarizeRouteUsage,
  writeRouterModeConfig,
} from '../router';

const z = tool.schema;
const DEFAULT_AVAILABLE_AGENTS = [
  '1-task-manager',
  '2-code-search',
  '3-docs-helper',
  '4-architecture-advisor',
  '5-code-fixer',
  '6-ui-designer',
  '7-code-simplicity-reviewer',
];

export function createRouterTools(
  projectDir: string,
): Record<string, ToolDefinition> {
  const miya_route_intent = tool({
    description:
      'Classify intent, estimate complexity, and produce runtime routing plan.',
    args: {
      text: z.string().describe('User request text'),
      session_id: z
        .string()
        .optional()
        .describe('Target session id for escalation tracking'),
      available_agents: z
        .array(z.string())
        .optional()
        .describe('Optional available agents list'),
      pinned_agent: z
        .string()
        .optional()
        .describe('Optional fixed agent to force route output'),
      source: z
        .string()
        .optional()
        .describe('Source channel for source-aware routing policy'),
    },
    async execute(args) {
      const text = String(args.text ?? '');
      const availableAgents = Array.isArray(args.available_agents)
        ? args.available_agents.map(String)
        : DEFAULT_AVAILABLE_AGENTS;
      const sessionID = String(args.session_id ?? 'main').trim() || 'main';
      const plan = buildRouteExecutionPlan({
        projectDir,
        sessionID,
        text,
        availableAgents,
        pinnedAgent:
          typeof args.pinned_agent === 'string' ? args.pinned_agent : undefined,
        source: typeof args.source === 'string' ? args.source : undefined,
      });
      const mode = readRouterModeConfig(projectDir);
      const session = getRouterSessionState(projectDir, sessionID);
      return [
        `session=${sessionID}`,
        `intent=${plan.intent}`,
        `complexity=${plan.complexity}`,
        `complexity_score=${plan.complexityScore}`,
        `route_stage=${plan.stage}`,
        `selected_agent=${plan.agent}`,
        `planned_agents=${plan.plannedAgents.join(',')}`,
        `max_agents=${plan.maxAgents}`,
        `context_strategy=${plan.contextStrategy}`,
        `requires_multiple_steps=${plan.requiresMultipleSteps}`,
        `enable_early_exit=${plan.enableEarlyExit}`,
        `preferred_agent=${plan.preferredAgent}`,
        `fallback_agent=${plan.fallbackAgent}`,
        `feedback_score=${plan.feedbackScore}`,
        `feedback_samples=${plan.feedbackSamples}`,
        `eco_mode=${mode.ecoMode}`,
        `execution_mode=${plan.executionMode}`,
        `orchestration_reason=${plan.orchestrationReason}`,
        `forced_stage=${mode.forcedStage ?? '(none)'}`,
        `auto_parallel_enabled=${mode.autoParallelEnabled}`,
        `auto_parallel_min_complexity=${mode.autoParallelMinComplexity}`,
        `auto_parallel_max_agents=${mode.autoParallelMaxAgents}`,
        `source_allowlist=${mode.sourceAllowlist.join(',')}`,
        `consecutive_failures=${session.consecutiveFailures}`,
        `reasons=${plan.reasons.join(',')}`,
      ].join('\n');
    },
  });

  const miya_route_feedback = tool({
    description: 'Record route outcome feedback for routing learning.',
    args: {
      text: z.string(),
      intent: z.string(),
      suggested_agent: z.string(),
      accepted: z.boolean(),
    },
    async execute(args) {
      const intent = classifyIntent(String(args.intent));
      const record = addRouteFeedback(projectDir, {
        text: String(args.text),
        intent,
        suggestedAgent: String(args.suggested_agent),
        accepted: Boolean(args.accepted),
      });
      return [
        `saved=true`,
        `at=${record.at}`,
        `intent=${record.intent}`,
        `accepted=${record.accepted}`,
      ].join('\n');
    },
  });

  const miya_route_stats = tool({
    description:
      'Show routing acceptance stats and runtime token/cost summary.',
    args: {},
    async execute() {
      const summary = summarizeRouteHistory(projectDir);
      const cost = getRouteCostSummary(projectDir, 500);
      const usage = summarizeRouteUsage(projectDir, 500);
      return [
        summary,
        `cost_records=${cost.totalRecords}`,
        `tokens_estimate=${cost.totalTokensEstimate}`,
        `baseline_high_tokens_estimate=${cost.baselineHighTokensEstimate}`,
        `savings_tokens_estimate=${cost.savingsTokensEstimate}`,
        `savings_percent_estimate=${cost.savingsPercentEstimate}`,
        `cost_usd_estimate=${cost.totalCostUsdEstimate}`,
        `stage_low_records=${cost.byStage.low.records}`,
        `stage_medium_records=${cost.byStage.medium.records}`,
        `stage_high_records=${cost.byStage.high.records}`,
        `actual_records=${usage.totalRecords}`,
        `actual_tokens=${usage.actualTokens}`,
        `actual_cost_usd=${usage.actualCostUsd}`,
        `estimate_tokens=${usage.estimatedTokens}`,
        `estimate_cost_usd=${usage.estimatedCostUsd}`,
        `token_delta=${usage.tokenDelta}`,
        `token_delta_percent=${usage.tokenDeltaPercent}`,
        `cost_delta_usd=${usage.costDeltaUsd}`,
      ].join('\n');
    },
  });

  const miya_route_mode = tool({
    description: 'Inspect or update router eco mode and forced stage.',
    args: {
      mode: z.enum(['get', 'set']).default('get'),
      eco_mode: z.boolean().optional(),
      forced_stage: z.enum(['low', 'medium', 'high']).optional(),
      clear_forced_stage: z.boolean().optional(),
      auto_parallel_enabled: z.boolean().optional(),
      auto_parallel_min_complexity: z
        .enum(['low', 'medium', 'high'])
        .optional(),
      auto_parallel_max_agents: z.number().optional(),
      source_allowlist: z.array(z.string()).optional(),
    },
    async execute(args) {
      if (args.mode === 'set') {
        const next = writeRouterModeConfig(projectDir, {
          ecoMode:
            typeof args.eco_mode === 'boolean'
              ? Boolean(args.eco_mode)
              : undefined,
          forcedStage:
            args.clear_forced_stage === true
              ? undefined
              : typeof args.forced_stage === 'string'
                ? args.forced_stage
                : undefined,
          autoParallelEnabled:
            typeof args.auto_parallel_enabled === 'boolean'
              ? Boolean(args.auto_parallel_enabled)
              : undefined,
          autoParallelMinComplexity:
            typeof args.auto_parallel_min_complexity === 'string'
              ? args.auto_parallel_min_complexity
              : undefined,
          autoParallelMaxAgents:
            typeof args.auto_parallel_max_agents === 'number'
              ? Number(args.auto_parallel_max_agents)
              : undefined,
          sourceAllowlist: Array.isArray(args.source_allowlist)
            ? args.source_allowlist.map(String)
            : undefined,
        });
        return [
          'saved=true',
          `eco_mode=${next.ecoMode}`,
          `forced_stage=${next.forcedStage ?? '(none)'}`,
          `token_multiplier_low=${next.stageTokenMultiplier.low}`,
          `token_multiplier_medium=${next.stageTokenMultiplier.medium}`,
          `token_multiplier_high=${next.stageTokenMultiplier.high}`,
          `auto_parallel_enabled=${next.autoParallelEnabled}`,
          `auto_parallel_min_complexity=${next.autoParallelMinComplexity}`,
          `auto_parallel_max_agents=${next.autoParallelMaxAgents}`,
          `source_allowlist=${next.sourceAllowlist.join(',')}`,
        ].join('\n');
      }

      const current = readRouterModeConfig(projectDir);
      return [
        `eco_mode=${current.ecoMode}`,
        `forced_stage=${current.forcedStage ?? '(none)'}`,
        `token_multiplier_low=${current.stageTokenMultiplier.low}`,
        `token_multiplier_medium=${current.stageTokenMultiplier.medium}`,
        `token_multiplier_high=${current.stageTokenMultiplier.high}`,
        `cost_per_1k_low=${current.stageCostUsdPer1k.low}`,
        `cost_per_1k_medium=${current.stageCostUsdPer1k.medium}`,
        `cost_per_1k_high=${current.stageCostUsdPer1k.high}`,
        `auto_parallel_enabled=${current.autoParallelEnabled}`,
        `auto_parallel_min_complexity=${current.autoParallelMinComplexity}`,
        `auto_parallel_max_agents=${current.autoParallelMaxAgents}`,
        `source_allowlist=${current.sourceAllowlist.join(',')}`,
      ].join('\n');
    },
  });

  const miya_route_cost = tool({
    description: 'Show recent route token/cost records.',
    args: {
      limit: z.number().optional(),
    },
    async execute(args) {
      const limit = typeof args.limit === 'number' ? Number(args.limit) : 20;
      const rows = listRouteCostRecords(
        projectDir,
        Math.max(1, Math.min(100, limit)),
      );
      if (rows.length === 0) return 'route_cost=empty';
      return rows
        .slice(-Math.max(1, Math.min(100, limit)))
        .map((row) =>
          [
            `at=${row.at}`,
            `session=${row.sessionID}`,
            `intent=${row.intent}`,
            `complexity=${row.complexity}`,
            `stage=${row.stage}`,
            `agent=${row.agent}`,
            `success=${row.success}`,
            `tokens=${row.totalTokensEstimate}`,
            `cost_usd=${row.costUsdEstimate}`,
          ].join(' | '),
        )
        .join('\n');
    },
  });

  const miya_route_usage = tool({
    description: 'Show recent route estimated-vs-actual usage records.',
    args: {
      limit: z.number().optional(),
    },
    async execute(args) {
      const limit = typeof args.limit === 'number' ? Number(args.limit) : 20;
      const rows = listRouteUsageRecords(
        projectDir,
        Math.max(1, Math.min(100, limit)),
      );
      if (rows.length === 0) return 'route_usage=empty';
      return rows
        .map((row) =>
          [
            `at=${row.at}`,
            `session=${row.sessionID}`,
            `stage=${row.stage}`,
            `agent=${row.agent}`,
            `est_tokens=${row.estimatedTokens}`,
            `act_tokens=${row.actualTotalTokens}`,
            `est_cost=${row.estimatedCostUsd}`,
            `act_cost=${row.actualCostUsd}`,
          ].join(' | '),
        )
        .join('\n');
    },
  });

  return {
    miya_route_intent,
    miya_route_feedback,
    miya_route_stats,
    miya_route_mode,
    miya_route_cost,
    miya_route_usage,
  };
}
