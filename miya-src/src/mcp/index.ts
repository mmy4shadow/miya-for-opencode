import type { McpName } from '../config';
import { context7 } from './context7';
import { grep_app } from './grep-app';
import type { McpConfig } from './types';
import { websearch } from './websearch';

export type { LocalMcpConfig, McpConfig, RemoteMcpConfig } from './types';

const allBuiltinMcps: Record<McpName, McpConfig> = {
  websearch,
  context7,
  grep_app,
};

/**
 * Creates MCP configurations, excluding disabled ones
 */
export function createBuiltinMcps(
  disabledMcps: readonly string[] = [],
): Record<string, McpConfig> {
  return Object.fromEntries(
    Object.entries(allBuiltinMcps).filter(
      ([name]) => !disabledMcps.includes(name),
    ),
  );
}

export function buildMcpServiceManifest(
  disabledMcps: readonly string[] = [],
): {
  service: string;
  version: number;
  generatedAt: string;
  mcps: Array<{
    name: string;
    type: string;
    sampling: boolean;
    mcpUi: boolean;
    serviceExpose: boolean;
  }>;
  controlPlaneEndpoints: string[];
} {
  const builtins = createBuiltinMcps(disabledMcps);
  const mcps = Object.entries(builtins).map(([name, config]) => {
    const caps =
      'capabilities' in config
        ? (config.capabilities as {
            sampling?: boolean;
            mcpUi?: boolean;
            serviceExpose?: boolean;
          })
        : undefined;
    return {
      name,
      type: config.type,
      sampling: Boolean(caps?.sampling),
      mcpUi: Boolean(caps?.mcpUi),
      serviceExpose: Boolean(caps?.serviceExpose),
    };
  });
  return {
    service: 'miya-control-plane',
    version: 2,
    generatedAt: new Date().toISOString(),
    mcps,
    controlPlaneEndpoints: [
      'gateway.status.get',
      'gateway.backpressure.stats',
      'daemon.backpressure.stats',
      'provider.override.audit.list',
      'mcp.capabilities.list',
      'mcp.service.expose',
    ],
  };
}
