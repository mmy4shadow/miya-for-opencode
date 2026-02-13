import { NodeService } from './service';

const nodeServices = new Map<string, NodeService>();

export function getNodeService(projectDir: string): NodeService {
  const existing = nodeServices.get(projectDir);
  if (existing) return existing;
  const created = new NodeService(projectDir);
  nodeServices.set(projectDir, created);
  return created;
}

export { NodeService };
export * from './store';
export type * from './types';
