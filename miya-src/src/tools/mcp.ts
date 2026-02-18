import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  buildMcpServiceManifest,
  createBuiltinMcps,
  summarizeMcpEcosystem,
} from '../mcp';

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
          `native=${(caps as { native?: boolean } | undefined)?.native !== false}`,
          `auth_mode=${(caps as { authMode?: string } | undefined)?.authMode ?? 'none'}`,
          `ecosystem=${(caps as { ecosystem?: string } | undefined)?.ecosystem ?? 'core'}`,
          `tags=${Array.isArray((caps as { tags?: string[] } | undefined)?.tags) ? (caps as { tags?: string[] } | undefined)?.tags?.join(',') : ''}`,
        ].join(' | ');
      });
      return lines.length > 0 ? lines.join('\n') : 'no_mcp_available';
    },
  });

  const miya_mcp_service_manifest = tool({
    description:
      'Return Miya MCP service exposure manifest used for control-plane integration.',
    args: {
      disabled_mcps: z
        .array(z.string())
        .optional()
        .describe('Optional disabled MCP names'),
    },
    async execute(args) {
      return JSON.stringify(
        buildMcpServiceManifest(
          Array.isArray(args.disabled_mcps)
            ? args.disabled_mcps.map(String)
            : [],
        ),
        null,
        2,
      );
    },
  });

  const miya_mcp_summary = tool({
    description: 'Return aggregated MCP ecosystem summary metrics.',
    args: {
      disabled_mcps: z
        .array(z.string())
        .optional()
        .describe('Optional disabled MCP names'),
    },
    async execute(args) {
      return summarizeMcpEcosystem(
        Array.isArray(args.disabled_mcps) ? args.disabled_mcps.map(String) : [],
      );
    },
  });

  return {
    miya_mcp_capabilities,
    miya_mcp_service_manifest,
    miya_mcp_summary,
  };
}
