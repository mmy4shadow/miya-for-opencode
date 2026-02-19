/**
 * Mock Daemon for Testing
 * 
 * Provides a mock implementation of the Daemon execution layer for testing
 * without requiring actual model inference, training, or system automation.
 * 
 * @module test/utils/mock-daemon
 */

import { createSpy } from './test-helpers';

/**
 * Daemon task status
 */
export type DaemonTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Daemon task type
 */
export type DaemonTaskType =
  | 'image_generation'
  | 'voice_training'
  | 'voice_inference'
  | 'asr'
  | 'desktop_control'
  | 'training';

/**
 * Daemon configuration options
 */
export interface MockDaemonConfig {
  /** Enable task logging */
  logTasks?: boolean;
  
  /** Simulate task execution time (milliseconds) */
  executionTime?: number;
  
  /** Simulate random failures (0-1 probability) */
  failureRate?: number;
  
  /** Available VRAM in MB */
  vramAvailable?: number;
  
  /** Simulate human mutex (user active) */
  humanMutex?: boolean;
}

/**
 * Daemon task record
 */
export interface DaemonTask {
  id: string;
  type: DaemonTaskType;
  params: any;
  status: DaemonTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: any;
  vramUsed?: number;
}

/**
 * VRAM allocation record
 */
export interface VRAMAllocation {
  taskId: string;
  amount: number;
  timestamp: number;
}

/**
 * Mock Daemon implementation
 * 
 * @example
 * ```typescript
 * const daemon = createMockDaemon({ vramAvailable: 8192 });
 * 
 * // Submit a task
 * const taskId = await daemon.submitTask('image_generation', {
 *   prompt: 'A beautiful sunset',
 *   model: 'flux-schnell'
 * });
 * 
 * // Wait for completion
 * await daemon.waitForTask(taskId);
 * 
 * // Get result
 * const task = daemon.getTask(taskId);
 * expect(task.status).toBe('completed');
 * ```
 */
export class MockDaemon {
  private tasks = new Map<string, DaemonTask>();
  private vramAllocations: VRAMAllocation[] = [];
  private config: Required<MockDaemonConfig>;
  private connected = true;
  private heartbeatInterval?: Timer;
  
  constructor(config: MockDaemonConfig = {}) {
    this.config = {
      logTasks: config.logTasks ?? false,
      executionTime: config.executionTime ?? 100,
      failureRate: config.failureRate ?? 0,
      vramAvailable: config.vramAvailable ?? 8192,
      humanMutex: config.humanMutex ?? false,
    };
  }
  
  /**
   * Submit a task to the daemon
   * 
   * @param type - Task type
   * @param params - Task parameters
   * @returns Task ID
   */
  async submitTask(type: DaemonTaskType, params: any = {}): Promise<string> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const task: DaemonTask = {
      id: taskId,
      type,
      params,
      status: 'pending',
      createdAt: Date.now(),
    };
    
    this.tasks.set(taskId, task);
    
    if (this.config.logTasks) {
      console.log(`[MockDaemon] Task submitted: ${type}`, params);
    }
    
    // Start execution asynchronously
    this.executeTask(taskId).catch(() => {
      // Error handling is done in executeTask
    });
    
    return taskId;
  }
  
  /**
   * Execute a task
   * 
   * @param taskId - Task ID
   */
  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    // Check human mutex for desktop control
    if (task.type === 'desktop_control' && this.config.humanMutex) {
      task.status = 'failed';
      task.error = 'Human mutex active';
      task.completedAt = Date.now();
      return;
    }
    
    // Check VRAM for training/inference tasks
    const vramRequired = this.estimateVRAM(task.type, task.params);
    if (vramRequired > 0) {
      const vramUsed = this.getTotalVRAMUsed();
      if (vramUsed + vramRequired > this.config.vramAvailable) {
        task.status = 'failed';
        task.error = 'Insufficient VRAM';
        task.completedAt = Date.now();
        return;
      }
      
      // Allocate VRAM
      this.vramAllocations.push({
        taskId,
        amount: vramRequired,
        timestamp: Date.now(),
      });
      task.vramUsed = vramRequired;
    }
    
    // Start execution
    task.status = 'running';
    task.startedAt = Date.now();
    
    try {
      // Simulate execution time
      await new Promise(resolve => setTimeout(resolve, this.config.executionTime));
      
      // Simulate random failures
      if (Math.random() < this.config.failureRate) {
        throw new Error('Simulated task failure');
      }
      
      // Generate result based on task type
      task.result = this.generateResult(task.type, task.params);
      task.status = 'completed';
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
    } finally {
      task.completedAt = Date.now();
      
      // Release VRAM
      if (vramRequired > 0) {
        this.vramAllocations = this.vramAllocations.filter(a => a.taskId !== taskId);
      }
    }
  }
  
  /**
   * Estimate VRAM required for a task
   * 
   * @param type - Task type
   * @param params - Task parameters
   * @returns VRAM in MB
   */
  private estimateVRAM(type: DaemonTaskType, params: any): number {
    switch (type) {
      case 'image_generation':
        return params.model === 'flux-large' ? 4096 : 2048;
      case 'voice_training':
        return 3072;
      case 'voice_inference':
        return 1024;
      case 'asr':
        return 512;
      case 'training':
        return params.vramBudget || 2048;
      default:
        return 0;
    }
  }
  
  /**
   * Generate mock result for a task
   * 
   * @param type - Task type
   * @param params - Task parameters
   * @returns Task result
   */
  private generateResult(type: DaemonTaskType, params: any): any {
    switch (type) {
      case 'image_generation':
        return {
          imagePath: `/tmp/image-${Date.now()}.png`,
          model: params.model,
          prompt: params.prompt,
        };
      
      case 'voice_training':
        return {
          checkpointPath: `/tmp/checkpoint-${Date.now()}.pth`,
          steps: params.steps || 100,
        };
      
      case 'voice_inference':
        return {
          audioPath: `/tmp/audio-${Date.now()}.wav`,
          duration: 5.2,
        };
      
      case 'asr':
        return {
          text: 'Transcribed text from audio',
          confidence: 0.95,
        };
      
      case 'desktop_control':
        return {
          success: true,
          screenshots: {
            before: `/tmp/before-${Date.now()}.png`,
            after: `/tmp/after-${Date.now()}.png`,
          },
        };
      
      case 'training':
        return {
          checkpointPath: `/tmp/checkpoint-${Date.now()}.pth`,
          loss: 0.123,
          steps: params.steps || 1000,
        };
      
      default:
        return { success: true };
    }
  }
  
  /**
   * Get a task by ID
   * 
   * @param taskId - Task ID
   * @returns Task or undefined
   */
  getTask(taskId: string): DaemonTask | undefined {
    return this.tasks.get(taskId);
  }
  
  /**
   * Get all tasks
   * 
   * @returns Array of tasks
   */
  getAllTasks(): DaemonTask[] {
    return Array.from(this.tasks.values());
  }
  
  /**
   * Get tasks by status
   * 
   * @param status - Task status
   * @returns Array of tasks
   */
  getTasksByStatus(status: DaemonTaskStatus): DaemonTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === status);
  }
  
  /**
   * Get tasks by type
   * 
   * @param type - Task type
   * @returns Array of tasks
   */
  getTasksByType(type: DaemonTaskType): DaemonTask[] {
    return Array.from(this.tasks.values()).filter(t => t.type === type);
  }
  
  /**
   * Wait for a task to complete
   * 
   * @param taskId - Task ID
   * @param timeout - Timeout in milliseconds (default: 10000)
   * @returns Task
   */
  async waitForTask(taskId: string, timeout = 10000): Promise<DaemonTask> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const task = this.tasks.get(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        return task;
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    throw new Error(`Timeout waiting for task ${taskId}`);
  }
  
  /**
   * Cancel a task
   * 
   * @param taskId - Task ID
   * @returns True if cancelled
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    
    if (task.status === 'pending' || task.status === 'running') {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      
      // Release VRAM
      this.vramAllocations = this.vramAllocations.filter(a => a.taskId !== taskId);
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Get total VRAM currently in use
   * 
   * @returns VRAM in MB
   */
  getTotalVRAMUsed(): number {
    return this.vramAllocations.reduce((sum, a) => sum + a.amount, 0);
  }
  
  /**
   * Get available VRAM
   * 
   * @returns VRAM in MB
   */
  getAvailableVRAM(): number {
    return this.config.vramAvailable - this.getTotalVRAMUsed();
  }
  
  /**
   * Set human mutex state
   * 
   * @param active - True if user is active
   */
  setHumanMutex(active: boolean): void {
    this.config.humanMutex = active;
  }
  
  /**
   * Check if daemon is connected
   * 
   * @returns True if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
  
  /**
   * Simulate connection loss
   */
  disconnect(): void {
    this.connected = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }
  
  /**
   * Simulate reconnection
   */
  reconnect(): void {
    this.connected = true;
    this.startHeartbeat();
  }
  
  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    
    this.heartbeatInterval = setInterval(() => {
      if (this.config.logTasks) {
        console.log('[MockDaemon] Heartbeat');
      }
    }, 10000);
  }
  
  /**
   * Clear all tasks
   */
  clear(): void {
    this.tasks.clear();
    this.vramAllocations = [];
  }
  
  /**
   * Reset the daemon
   */
  reset(): void {
    this.clear();
    this.connected = true;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }
  
  /**
   * Get task statistics
   * 
   * @returns Statistics object
   */
  getStatistics() {
    const tasks = Array.from(this.tasks.values());
    
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      running: tasks.filter(t => t.status === 'running').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      cancelled: tasks.filter(t => t.status === 'cancelled').length,
      averageExecutionTime: this.getAverageExecutionTime(),
      successRate: this.getSuccessRate(),
      vramUsed: this.getTotalVRAMUsed(),
      vramAvailable: this.getAvailableVRAM(),
    };
  }
  
  /**
   * Get average execution time
   * 
   * @returns Average time in milliseconds
   */
  private getAverageExecutionTime(): number {
    const completed = Array.from(this.tasks.values()).filter(
      t => t.status === 'completed' && t.startedAt && t.completedAt
    );
    
    if (completed.length === 0) return 0;
    
    const total = completed.reduce(
      (sum, t) => sum + (t.completedAt! - t.startedAt!),
      0
    );
    
    return total / completed.length;
  }
  
  /**
   * Get success rate
   * 
   * @returns Success rate (0-1)
   */
  private getSuccessRate(): number {
    const finished = Array.from(this.tasks.values()).filter(
      t => t.status === 'completed' || t.status === 'failed'
    );
    
    if (finished.length === 0) return 1;
    
    const successes = finished.filter(t => t.status === 'completed').length;
    return successes / finished.length;
  }
}

/**
 * Create a mock Daemon instance
 * 
 * @param config - Daemon configuration
 * @returns Mock Daemon instance
 * 
 * @example
 * ```typescript
 * const daemon = createMockDaemon({ vramAvailable: 8192 });
 * ```
 */
export function createMockDaemon(config?: MockDaemonConfig): MockDaemon {
  return new MockDaemon(config);
}
