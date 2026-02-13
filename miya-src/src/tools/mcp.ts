import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { createBuiltinMcps } from '../mcp';

const z = tool.schema;

export function createMcpTools(): Record<string, ToolDefinition> {
  const miya_mcp_capabilities = tool({
    description:
      'List builtin MCPs with capability flags (MCP-UI/sampling/service exposure).',
    args: {
      disabled_mcps: z
        .array(z.string())
        .optional()
        .describe('Optional disabled MCP names'),
    },
    async execute(args) {
      const mcps = createBuiltinMcps(
        Array.isArray(args.disabled_mcps) ? args.disabled_mcps.map(String) : [],
      );
      const lines = Object.entries(mcps).map(([name, config]) => {
        const caps = 'capabilities' in config ? config.capabilities : undefined;
        return [
          `name=${name}`,
          `type=${config.type}`,
          `sampling=${Boolean(caps?.sampling)}`,
          `mcp_ui=${Boolean(caps?.mcpUi)}`,
          `service_expose=${Boolean((caps as { serviceExpose?: boolean } | undefined)?.serviceExpose)}`,
        ].join(' | ');
      });
      return lines.length > 0 ? lines.join('\n') : 'no_mcp_available';
    },
  });

  const miya_mcp_service_manifest = tool({
    description:
      'Return Miya MCP service exposure manifest used for control-plane integration.',
    args: {},
    async execute() {
      return JSON.stringify(
        {
          service: 'miya-control-plane',
          version: 1,
          endpoints: [
            'gateway.status.get',
            'nodes.status',
            'channels.status',
            'skills.status',
          ],
          capabilities: {
            sampling: false,
            mcpUi: true,
            serviceExpose: true,
          },
        },
        null,
        2,
      );
    },
  });

  return {
    miya_mcp_capabilities,
    miya_mcp_service_manifest,
  };
}

