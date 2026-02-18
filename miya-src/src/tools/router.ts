import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  addRouteFeedback,
  buildRouteExecutionPlan,
  classifyIntent,
  getRouteCostSummary,
  getRouterSessionState,
  listRouteCostRecords,
  readRouteLearningWeights,
  readRouterModeConfig,
  summarizeRouteHistory,
  writeRouteLearningWeights,
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
      });
      const mode = readRouterModeConfig(projectDir);
      const session = getRouterSessionState(projectDir, sessionID);
      return [
        `session=${sessionID}`,
        `intent=${plan.intent}`,
        `complexity=${plan.complexity}`,
        `complexity_score=${plan.complexityScore}`,
        `semantic_confidence=${plan.semanticConfidence}`,
        `semantic_ambiguity=${plan.semanticAmbiguity}`,
        `semantic_evidence=${plan.semanticEvidence.join(',')}`,
        `route_stage=${plan.stage}`,
        `selected_agent=${plan.agent}`,
        `preferred_agent=${plan.preferredAgent}`,
        `fallback_agent=${plan.fallbackAgent}`,
        `feedback_score=${plan.feedbackScore}`,
        `feedback_samples=${plan.feedbackSamples}`,
        `eco_mode=${mode.ecoMode}`,
        `forced_stage=${mode.forcedStage ?? '(none)'}`,
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
      success: z.boolean().optional(),
      cost_usd: z.number().optional(),
      risk_score: z.number().optional(),
      stage: z.enum(['low', 'medium', 'high']).optional(),
      failure_reason: z.string().optional(),
    },
    async execute(args) {
      const intent = classifyIntent(String(args.intent));
      const record = addRouteFeedback(projectDir, {
        text: String(args.text),
        intent,
        suggestedAgent: String(args.suggested_agent),
        accepted: Boolean(args.accepted),
        success:
          typeof args.success === 'boolean' ? Boolean(args.success) : undefined,
        costUsdEstimate:
          typeof args.cost_usd === 'number' ? Number(args.cost_usd) : undefined,
        riskScore:
          typeof args.risk_score === 'number'
            ? Number(args.risk_score)
            : undefined,
        stage: typeof args.stage === 'string' ? args.stage : undefined,
        failureReason:
          typeof args.failure_reason === 'string'
            ? String(args.failure_reason)
            : undefined,
      });
      return [
        `saved=true`,
        `at=${record.at}`,
        `intent=${record.intent}`,
        `accepted=${record.accepted}`,
        `success=${record.success ?? '(unknown)'}`,
        `cost_usd=${record.costUsdEstimate ?? '(n/a)'}`,
        `risk_score=${record.riskScore ?? '(n/a)'}`,
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
      const weights = readRouteLearningWeights(projectDir);
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
        `learning_weight_accept=${weights.accept}`,
        `learning_weight_success=${weights.success}`,
        `learning_weight_cost=${weights.cost}`,
        `learning_weight_risk=${weights.risk}`,
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
      learning_accept_weight: z.number().optional(),
      learning_success_weight: z.number().optional(),
      learning_cost_weight: z.number().optional(),
      learning_risk_weight: z.number().optional(),
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
        });
        const weights = writeRouteLearningWeights(projectDir, {
          accept:
            typeof args.learning_accept_weight === 'number'
              ? Number(args.learning_accept_weight)
              : undefined,
          success:
            typeof args.learning_success_weight === 'number'
              ? Number(args.learning_success_weight)
              : undefined,
          cost:
            typeof args.learning_cost_weight === 'number'
              ? Number(args.learning_cost_weight)
              : undefined,
          risk:
            typeof args.learning_risk_weight === 'number'
              ? Number(args.learning_risk_weight)
              : undefined,
        });
        return [
          'saved=true',
          `eco_mode=${next.ecoMode}`,
          `forced_stage=${next.forcedStage ?? '(none)'}`,
          `token_multiplier_low=${next.stageTokenMultiplier.low}`,
          `token_multiplier_medium=${next.stageTokenMultiplier.medium}`,
          `token_multiplier_high=${next.stageTokenMultiplier.high}`,
          `learning_weight_accept=${weights.accept}`,
          `learning_weight_success=${weights.success}`,
          `learning_weight_cost=${weights.cost}`,
          `learning_weight_risk=${weights.risk}`,
        ].join('\n');
      }

      const current = readRouterModeConfig(projectDir);
      const weights = readRouteLearningWeights(projectDir);
      return [
        `eco_mode=${current.ecoMode}`,
        `forced_stage=${current.forcedStage ?? '(none)'}`,
        `token_multiplier_low=${current.stageTokenMultiplier.low}`,
        `token_multiplier_medium=${current.stageTokenMultiplier.medium}`,
        `token_multiplier_high=${current.stageTokenMultiplier.high}`,
        `cost_per_1k_low=${current.stageCostUsdPer1k.low}`,
        `cost_per_1k_medium=${current.stageCostUsdPer1k.medium}`,
        `cost_per_1k_high=${current.stageCostUsdPer1k.high}`,
        `learning_weight_accept=${weights.accept}`,
        `learning_weight_success=${weights.success}`,
        `learning_weight_cost=${weights.cost}`,
        `learning_weight_risk=${weights.risk}`,
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

  return {
    miya_route_intent,
    miya_route_feedback,
    miya_route_stats,
    miya_route_mode,
    miya_route_cost,
  };
}
