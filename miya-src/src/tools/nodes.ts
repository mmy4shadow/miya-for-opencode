import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { describeNode, listNodePairs, listNodes, registerNode } from '../nodes';

const z = tool.schema;

export function createNodeTools(
  projectDir: string,
): Record<string, ToolDefinition> {
  const miya_node_register = tool({
    description: 'Register or update a Miya node record.',
    args: {
      node_id: z.string().describe('Node identifier'),
      device_id: z.string().describe('Device identifier'),
      platform: z.string().optional().describe('Platform name'),
      capabilities: z
        .array(z.string())
        .optional()
        .describe('Capability list exposed by this node'),
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

      const node = registerNode(projectDir, {
        nodeID: String(args.node_id),
        deviceID: String(args.device_id),
        platform: args.platform ? String(args.platform) : process.platform,
        capabilities: [...new Set(capabilities)],
      });

      return [
        `node_id=${node.nodeID}`,
        `device_id=${node.deviceID}`,
        `platform=${node.platform}`,
        `connected=${node.connected}`,
        `paired=${node.paired}`,
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
        const node = describeNode(projectDir, nodeID);
        if (!node) return `node_not_found=${nodeID}`;
        return [
          `node_id=${node.nodeID}`,
          `device_id=${node.deviceID}`,
          `connected=${node.connected}`,
          `paired=${node.paired}`,
          `last_seen=${node.lastSeenAt}`,
          `capabilities=${node.capabilities.join(',')}`,
        ].join('\n');
      }

      const nodes = listNodes(projectDir);
      const pending = listNodePairs(projectDir, 'pending').length;
      return [
        `nodes_total=${nodes.length}`,
        `nodes_connected=${nodes.filter((item) => item.connected).length}`,
        `nodes_paired=${nodes.filter((item) => item.paired).length}`,
        `nodes_pending_pairs=${pending}`,
      ].join('\n');
    },
  });

  return {
    miya_node_register,
    miya_node_status,
  };
}

