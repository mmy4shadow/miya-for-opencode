export interface UltraworkTaskInput {
  id?: string;
  agent: string;
  prompt: string;
  description: string;
  dependsOn?: string[];
  timeoutMs?: number;
  maxRetries?: number;
}

export interface UltraworkLaunchResult {
  nodeID: string;
  taskID: string;
  agent: string;
  status: string;
}
