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
    native: boolean;
    authMode: 'none' | 'header' | 'oauth';
    ecosystem: 'core' | 'community';
    tags: string[];
    authConfigured: boolean;
  }>;
  summary: {
    total: number;
    serviceExpose: number;
    native: number;
    authConfigured: number;
    byEcosystem: {
      core: number;
      community: number;
    };
  };
  controlPlaneEndpoints: string[];
} {
  const builtins = createBuiltinMcps(disabledMcps);
  const mcps = Object.entries(builtins).map(([name, config]) => {
    const caps =
      'capabilities' in config
        ? config.capabilities
        : undefined;
    const headers =
      'headers' in config && config.headers && typeof config.headers === 'object'
        ? Object.values(config.headers).filter((value) => String(value ?? '').trim().length > 0)
        : [];
    return {
      name,
      type: config.type,
      sampling: Boolean(caps?.sampling),
      mcpUi: Boolean(caps?.mcpUi),
      serviceExpose: Boolean(caps?.serviceExpose),
      native: caps?.native !== false,
      authMode: caps?.authMode ?? (config.type === 'remote' ? 'header' : 'none'),
      ecosystem: caps?.ecosystem ?? 'core',
      tags: Array.isArray(caps?.tags) ? caps?.tags.map(String) : [],
      authConfigured: headers.length > 0 || caps?.authMode === 'none',
    };
  });
  const summary = {
    total: mcps.length,
    serviceExpose: mcps.filter((item) => item.serviceExpose).length,
    native: mcps.filter((item) => item.native).length,
    authConfigured: mcps.filter((item) => item.authConfigured).length,
    byEcosystem: {
      core: mcps.filter((item) => item.ecosystem === 'core').length,
      community: mcps.filter((item) => item.ecosystem === 'community').length,
    },
  };
  return {
    service: 'miya-control-plane',
    version: 2,
    generatedAt: new Date().toISOString(),
    mcps,
    summary,
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

export function summarizeMcpEcosystem(disabledMcps: readonly string[] = []): string {
  const manifest = buildMcpServiceManifest(disabledMcps);
  const lines = [
    `mcp_total=${manifest.summary.total}`,
    `mcp_service_expose=${manifest.summary.serviceExpose}`,
    `mcp_native=${manifest.summary.native}`,
    `mcp_auth_configured=${manifest.summary.authConfigured}`,
    `mcp_core=${manifest.summary.byEcosystem.core}`,
    `mcp_community=${manifest.summary.byEcosystem.community}`,
  ];
  return lines.join('\n');
}
