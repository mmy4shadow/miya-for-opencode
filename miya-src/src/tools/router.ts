import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  addRouteFeedback,
  classifyIntent,
  recommendedAgent,
  resolveFallbackAgent,
  summarizeRouteHistory,
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
    description: 'Classify intent and recommend best Miya agent.',
    args: {
      text: z.string().describe('User request text'),
      available_agents: z
        .array(z.string())
        .optional()
        .describe('Optional available agents list'),
    },
    async execute(args) {
      const text = String(args.text ?? '');
      const intent = classifyIntent(text);
      const availableAgents = Array.isArray(args.available_agents)
        ? args.available_agents.map(String)
        : DEFAULT_AVAILABLE_AGENTS;
      const preferred = recommendedAgent(intent);
      const selected = resolveFallbackAgent(intent, availableAgents);
      return [
        `intent=${intent}`,
        `preferred_agent=${preferred}`,
        `selected_agent=${selected}`,
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
    description: 'Show historical routing acceptance stats.',
    args: {},
    async execute() {
      return summarizeRouteHistory(projectDir);
    },
  });

  return {
    miya_route_intent,
    miya_route_feedback,
    miya_route_stats,
  };
}

