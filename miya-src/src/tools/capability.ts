import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { buildToolCapabilitySchemas } from '../capability/schema';

const z = tool.schema;

export function createCapabilityTools(
  getToolNames: () => string[],
): Record<string, ToolDefinition> {
  const miya_capability_schema = tool({
    description:
      'Export Miya tool capability schema catalog (id/version/inputs/outputs/sideEffects/permissions/auditFields/fallbackPlan).',
    args: {
      id: z
        .string()
        .optional()
        .describe('Optional capability id, e.g. tool.miya_gateway_start'),
      limit: z.number().optional().describe('Max rows, default 500'),
    },
    async execute(args) {
      const limitRaw =
        typeof args.limit === 'number' ? Number(args.limit) : 500;
      const limit = Math.max(1, Math.min(5000, Math.floor(limitRaw)));
      const schemas = buildToolCapabilitySchemas(
        getToolNames().filter((name) => name !== 'miya_capability_schema'),
      );
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (id) {
        const hit = schemas.find((item) => item.id === id);
        if (!hit)
          return JSON.stringify(
            { ok: false, error: `capability_not_found:${id}` },
            null,
            2,
          );
        return JSON.stringify({ ok: true, capability: hit }, null, 2);
      }
      return JSON.stringify(
        {
          ok: true,
          total: Math.min(limit, schemas.length),
          capabilities: schemas.slice(0, limit),
        },
        null,
        2,
      );
    },
  });

  return {
    miya_capability_schema,
  };
}
