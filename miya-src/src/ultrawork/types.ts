export interface UltraworkTaskInput {
  agent: string;
  prompt: string;
  description: string;
}

export interface UltraworkLaunchResult {
  taskID: string;
  agent: string;
  status: string;
}

