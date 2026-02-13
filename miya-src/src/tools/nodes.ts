import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  getNodeService,
} from '../node';

const z = tool.schema;

export function createNodeTools(
  projectDir: string,
): Record<string, ToolDefinition> {
  const nodeService = getNodeService(projectDir);
  const miya_node_register = tool({
    description: 'Register or update a Miya node record.',
    args: {
      node_id: z.string().describe('Node identifier'),
      device_id: z.string().describe('Device identifier'),
      platform: z.string().optional().describe('Platform name'),
      type: z
        .enum(['cli', 'desktop', 'mobile', 'browser'])
        .optional()
        .describe('Node runtime type'),
      capabilities: z
        .array(z.string())
        .optional()
        .describe('Capability list exposed by this node'),
      token: z.string().optional().describe('Optional node token for registration'),
      permissions: z
        .object({
          screenRecording: z.boolean().optional(),
          accessibility: z.boolean().optional(),
          filesystem: z.enum(['none', 'read', 'full']).optional(),
          network: z.boolean().optional(),
        })
        .optional()
        .describe('Permission mapping metadata'),
    },
    async execute(args) {
      const capabilities = Array.isArray(args.capabilities)
        ? args.capabilities.map(String)
        : [];

      if (args.permissions && typeof args.permissions === 'object') {
        const p = args.permissions as {
          screenRecording?: boolean;
          accessibility?: boolean;
          filesystem?: 'none' | 'read' | 'full';
          network?: boolean;
        };
        if (p.screenRecording) capabilities.push('perm.screenRecording');
        if (p.accessibility) capabilities.push('perm.accessibility');
        if (p.network) capabilities.push('perm.network');
        if (p.filesystem) capabilities.push(`perm.filesystem.${p.filesystem}`);
      }

      const node = nodeService.register({
        nodeID: String(args.node_id),
        deviceID: String(args.device_id),
        type: args.type,
        platform: args.platform ? String(args.platform) : process.platform,
        capabilities: [...new Set(capabilities)],
        token: args.token ? String(args.token) : undefined,
        permissions:
          args.permissions && typeof args.permissions === 'object'
            ? (args.permissions as {
                screenRecording?: boolean;
                accessibility?: boolean;
                filesystem?: 'none' | 'read' | 'full';
                network?: boolean;
              })
            : undefined,
      });

      return [
        `node_id=${node.nodeID}`,
        `device_id=${node.deviceID}`,
        `type=${node.type}`,
        `platform=${node.platform}`,
        `status=${node.status}`,
        `connected=${node.connected}`,
        `paired=${node.paired}`,
        `permissions=${JSON.stringify(node.permissions)}`,
        `last_heartbeat=${node.lastHeartbeatAt}`,
        `capabilities=${node.capabilities.join(',')}`,
      ].join('\n');
    },
  });

  const miya_node_status = tool({
    description:
      'Show node status summary, or details for a specific node id when provided.',
    args: {
      node_id: z.string().optional().describe('Optional node identifier'),
    },
    async execute(args) {
      const nodeID = args.node_id ? String(args.node_id) : '';
      if (nodeID) {
        const node = nodeService.describe(nodeID);
        if (!node) return `node_not_found=${nodeID}`;
        return [
          `node_id=${node.nodeID}`,
          `device_id=${node.deviceID}`,
          `type=${node.type}`,
          `status=${node.status}`,
          `connected=${node.connected}`,
          `paired=${node.paired}`,
          `permissions=${JSON.stringify(node.permissions)}`,
          `last_heartbeat=${node.lastHeartbeatAt}`,
          `last_seen=${node.lastSeenAt}`,
          `capabilities=${node.capabilities.join(',')}`,
        ].join('\n');
      }

      const nodes = nodeService.list();
      const pending = nodeService.listPairRequests('pending').length;
      return [
        `nodes_total=${nodes.length}`,
        `nodes_connected=${nodes.filter((item) => item.connected).length}`,
        `nodes_online=${nodes.filter((item) => item.status === 'online').length}`,
        `nodes_paired=${nodes.filter((item) => item.paired).length}`,
        `nodes_pending_pairs=${pending}`,
      ].join('\n');
    },
  });

  const miya_node_heartbeat = tool({
    description: 'Update node heartbeat timestamp and mark it online.',
    args: {
      node_id: z.string().describe('Node identifier'),
    },
    async execute(args) {
      const nodeID = String(args.node_id);
      const node = nodeService.touchHeartbeat(nodeID);
      if (!node) return `node_not_found=${nodeID}`;
      return [
        `node_id=${node.nodeID}`,
        `status=${node.status}`,
        `last_heartbeat=${node.lastHeartbeatAt}`,
      ].join('\n');
    },
  });

  const miya_node_issue_token = tool({
    description:
      'Issue or rotate node token for a node. Return token once; store hash only.',
    args: {
      node_id: z.string().describe('Node identifier'),
    },
    async execute(args) {
      const nodeID = String(args.node_id);
      const issued = nodeService.issueToken(nodeID);
      if (!issued) return `node_not_found=${nodeID}`;
      return [
        `node_id=${issued.nodeID}`,
        `token=${issued.token}`,
        `issued_at=${issued.issuedAt}`,
      ].join('\n');
    },
  });

  return {
    miya_node_register,
    miya_node_status,
    miya_node_heartbeat,
    miya_node_issue_token,
  };
}
