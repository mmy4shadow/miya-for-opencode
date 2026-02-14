import type { UltraworkLaunchResult, UltraworkTaskInput } from './types';

type RuntimeTaskStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface BackgroundTaskLike {
  id: string;
  agent: string;
  status: RuntimeTaskStatus | string;
  completedAt?: Date;
}

interface UltraworkManagerLike {
  launch(input: {
    agent: string;
    prompt: string;
    description: string;
    parentSessionId: string;
  }): BackgroundTaskLike;
  waitForCompletion(
    taskID: string,
    timeoutMs?: number,
  ): Promise<BackgroundTaskLike | null>;
  getResult(taskID: string): BackgroundTaskLike | null;
  cancel(taskID?: string): number;
}

interface UltraworkNode {
  nodeID: string;
  agent: string;
  prompt: string;
  description: string;
  dependsOn: string[];
  timeoutMs: number;
  maxRetries: number;
}

export interface UltraworkDagNodeResult {
  nodeID: string;
  agent: string;
  status: RuntimeTaskStatus | 'blocked_dependency' | 'timeout';
  retries: number;
  taskID?: string;
  error?: string;
}

export interface UltraworkDagResult {
  total: number;
  completed: number;
  failed: number;
  blocked: number;
  nodes: UltraworkDagNodeResult[];
}

function buildNodes(tasks: UltraworkTaskInput[]): UltraworkNode[] {
  const normalized = tasks
    .filter((task) => task.agent.trim() && task.prompt.trim())
    .slice(0, 40);
  return normalized.map((task, index) => ({
    nodeID: task.id?.trim() || `node_${index + 1}`,
    agent: task.agent.trim(),
    prompt: task.prompt.trim(),
    description: task.description.trim() || task.prompt.trim().slice(0, 80),
    dependsOn: Array.isArray(task.dependsOn)
      ? task.dependsOn.map(String).map((item) => item.trim()).filter(Boolean)
      : [],
    timeoutMs: Math.max(5_000, Math.min(20 * 60_000, Number(task.timeoutMs ?? 120_000))),
    maxRetries: Math.max(0, Math.min(3, Math.floor(Number(task.maxRetries ?? 0)))),
  }));
}

function hasCycle(nodes: UltraworkNode[]): boolean {
  const edges = new Map(nodes.map((node) => [node.nodeID, node.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of edges.get(id) ?? []) {
      if (edges.has(dep) && dfs(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const node of nodes) {
    if (dfs(node.nodeID)) return true;
  }
  return false;
}

export function launchUltraworkTasks(input: {
  manager: UltraworkManagerLike;
  parentSessionID: string;
  tasks: UltraworkTaskInput[];
}): UltraworkLaunchResult[] {
  const nodes = buildNodes(input.tasks);
  return nodes.map((task) => {
    const launched = input.manager.launch({
      agent: task.agent,
      prompt: task.prompt,
      description: task.description,
      parentSessionId: input.parentSessionID,
    });
    return {
      nodeID: task.nodeID,
      taskID: launched.id,
      agent: launched.agent,
      status: String(launched.status),
    };
  });
}

export async function runUltraworkDag(input: {
  manager: UltraworkManagerLike;
  parentSessionID: string;
  tasks: UltraworkTaskInput[];
  maxParallel?: number;
}): Promise<UltraworkDagResult> {
  const nodes = buildNodes(input.tasks);
  if (nodes.length === 0) {
    return { total: 0, completed: 0, failed: 0, blocked: 0, nodes: [] };
  }
  if (hasCycle(nodes)) {
    return {
      total: nodes.length,
      completed: 0,
      failed: 0,
      blocked: nodes.length,
      nodes: nodes.map((item) => ({
        nodeID: item.nodeID,
        agent: item.agent,
        status: 'blocked_dependency',
        retries: 0,
        error: 'dag_cycle_detected',
      })),
    };
  }
  const maxParallel = Math.max(1, Math.min(8, Math.floor(Number(input.maxParallel ?? 3))));
  const nodeMap = new Map(nodes.map((node) => [node.nodeID, node]));
  const pending = new Set(nodes.map((item) => item.nodeID));
  const running = new Set<string>();
  const results = new Map<string, UltraworkDagNodeResult>();
  const retries = new Map<string, number>();

  const canRun = (node: UltraworkNode): boolean => {
    for (const dependency of node.dependsOn) {
      const status = results.get(dependency)?.status;
      if (!status) return false;
      if (status !== 'completed') return false;
    }
    return true;
  };

  const runNode = async (node: UltraworkNode): Promise<void> => {
    const launched = input.manager.launch({
      agent: node.agent,
      prompt: node.prompt,
      description: node.description,
      parentSessionId: input.parentSessionID,
    });
    const task = await input.manager.waitForCompletion(launched.id, node.timeoutMs);
    const status = String(task?.status ?? 'timeout') as RuntimeTaskStatus | 'timeout';
    const attempts = retries.get(node.nodeID) ?? 0;
    if ((status === 'failed' || status === 'timeout' || status === 'cancelled') && attempts < node.maxRetries) {
      retries.set(node.nodeID, attempts + 1);
      pending.add(node.nodeID);
      return;
    }
    results.set(node.nodeID, {
      nodeID: node.nodeID,
      agent: node.agent,
      status,
      retries: attempts,
      taskID: launched.id,
      error:
        status === 'failed' || status === 'timeout' || status === 'cancelled'
          ? `task_${status}`
          : undefined,
    });
  };

  while (pending.size > 0 || running.size > 0) {
    const ready = [...pending]
      .map((nodeID) => nodeMap.get(nodeID))
      .filter((node): node is UltraworkNode => Boolean(node))
      .filter((node) => canRun(node));
    for (const node of ready) {
      if (running.size >= maxParallel) break;
      pending.delete(node.nodeID);
      running.add(node.nodeID);
      void runNode(node).finally(() => {
        running.delete(node.nodeID);
      });
    }
    const blocked = [...pending]
      .map((nodeID) => nodeMap.get(nodeID))
      .filter((node): node is UltraworkNode => Boolean(node))
      .filter((node) => node.dependsOn.some((dep) => {
        const depStatus = results.get(dep)?.status;
        return depStatus === 'failed' || depStatus === 'cancelled' || depStatus === 'timeout' || depStatus === 'blocked_dependency';
      }));
    for (const node of blocked) {
      pending.delete(node.nodeID);
      results.set(node.nodeID, {
        nodeID: node.nodeID,
        agent: node.agent,
        status: 'blocked_dependency',
        retries: retries.get(node.nodeID) ?? 0,
        error: 'dependency_failed',
      });
    }
    if (running.size === 0 && ready.length === 0 && blocked.length === 0 && pending.size > 0) {
      // Unknown dependency node id blocks execution.
      for (const nodeID of pending) {
        const node = nodeMap.get(nodeID);
        if (!node) continue;
        results.set(node.nodeID, {
          nodeID: node.nodeID,
          agent: node.agent,
          status: 'blocked_dependency',
          retries: retries.get(node.nodeID) ?? 0,
          error: 'dependency_missing',
        });
      }
      pending.clear();
      break;
    }
    if (running.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  const nodeResults = nodes.map((node) => {
    const result = results.get(node.nodeID);
    return (
      result ?? {
        nodeID: node.nodeID,
        agent: node.agent,
        status: 'blocked_dependency',
        retries: retries.get(node.nodeID) ?? 0,
        error: 'unknown_state',
      }
    );
  });
  const completed = nodeResults.filter((item) => item.status === 'completed').length;
  const failed = nodeResults.filter(
    (item) =>
      item.status === 'failed' ||
      item.status === 'cancelled' ||
      item.status === 'timeout',
  ).length;
  const blocked = nodeResults.filter((item) => item.status === 'blocked_dependency').length;

  return {
    total: nodeResults.length,
    completed,
    failed,
    blocked,
    nodes: nodeResults,
  };
}
