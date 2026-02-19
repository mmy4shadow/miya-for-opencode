/**
 * Mock Gateway for Testing
 * 
 * Provides a mock implementation of the Gateway control plane for testing
 * without requiring a real WebSocket connection or daemon process.
 * 
 * @module test/utils/mock-gateway
 */

import { createSpy } from './test-helpers';

/**
 * Gateway RPC method handler type
 */
export type GatewayMethodHandler = (params: any) => Promise<any>;

/**
 * Gateway configuration options
 */
export interface MockGatewayConfig {
  /** Enable request logging */
  logRequests?: boolean;
  
  /** Simulate network latency (milliseconds) */
  latency?: number;
  
  /** Simulate random failures (0-1 probability) */
  failureRate?: number;
  
  /** Maximum in-flight requests */
  maxInFlight?: number;
  
  /** Maximum queue size */
  maxQueue?: number;
  
  /** Request timeout (milliseconds) */
  timeout?: number;
}

/**
 * Gateway request record
 */
export interface GatewayRequest {
  id: string;
  method: string;
  params: any;
  timestamp: number;
}

/**
 * Gateway response record
 */
export interface GatewayResponse {
  id: string;
  result?: any;
  error?: any;
  duration: number;
}

/**
 * Mock Gateway implementation
 * 
 * @example
 * ```typescript
 * const gateway = createMockGateway();
 * 
 * // Register method handlers
 * gateway.registerMethod('channels.send', async (params) => {
 *   return { success: true, messageId: '123' };
 * });
 * 
 * // Call methods
 * const result = await gateway.call('channels.send', {
 *   recipient: 'user@example.com',
 *   message: 'Hello'
 * });
 * 
 * // Verify calls
 * expect(gateway.getRequests()).toHaveLength(1);
 * expect(gateway.getRequests()[0].method).toBe('channels.send');
 * ```
 */
export class MockGateway {
  private methods = new Map<string, GatewayMethodHandler>();
  private requests: GatewayRequest[] = [];
  private responses: GatewayResponse[] = [];
  private inFlight = 0;
  private queue: Array<() => void> = [];
  private config: Required<MockGatewayConfig>;
  
  constructor(config: MockGatewayConfig = {}) {
    this.config = {
      logRequests: config.logRequests ?? false,
      latency: config.latency ?? 0,
      failureRate: config.failureRate ?? 0,
      maxInFlight: config.maxInFlight ?? 10,
      maxQueue: config.maxQueue ?? 100,
      timeout: config.timeout ?? 30000,
    };
  }
  
  /**
   * Register a method handler
   * 
   * @param method - Method name (e.g., 'channels.send')
   * @param handler - Handler function
   */
  registerMethod(method: string, handler: GatewayMethodHandler): void {
    this.methods.set(method, handler);
  }
  
  /**
   * Unregister a method handler
   * 
   * @param method - Method name
   */
  unregisterMethod(method: string): void {
    this.methods.delete(method);
  }
  
  /**
   * Check if a method is registered
   * 
   * @param method - Method name
   * @returns True if method is registered
   */
  hasMethod(method: string): boolean {
    return this.methods.has(method);
  }
  
  /**
   * Call a Gateway method
   * 
   * @param method - Method name
   * @param params - Method parameters
   * @returns Method result
   */
  async call(method: string, params: any = {}): Promise<any> {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const request: GatewayRequest = {
      id: requestId,
      method,
      params,
      timestamp: Date.now(),
    };
    
    this.requests.push(request);
    
    if (this.config.logRequests) {
      console.log(`[MockGateway] ${method}`, params);
    }
    
    // Check backpressure
    if (this.inFlight >= this.config.maxInFlight) {
      if (this.queue.length >= this.config.maxQueue) {
        throw new Error('Gateway queue full');
      }
      
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    
    this.inFlight++;
    
    try {
      const startTime = performance.now();
      
      // Simulate latency
      if (this.config.latency > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.latency));
      }
      
      // Simulate random failures
      if (Math.random() < this.config.failureRate) {
        throw new Error('Simulated gateway failure');
      }
      
      // Find handler
      const handler = this.methods.get(method);
      if (!handler) {
        throw new Error(`Method not found: ${method}`);
      }
      
      // Execute with timeout
      const result = await Promise.race([
        handler(params),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gateway timeout')), this.config.timeout)
        ),
      ]);
      
      const duration = performance.now() - startTime;
      
      this.responses.push({
        id: requestId,
        result,
        duration,
      });
      
      return result;
    } catch (error) {
      const duration = performance.now() - request.timestamp;
      
      this.responses.push({
        id: requestId,
        error,
        duration,
      });
      
      throw error;
    } finally {
      this.inFlight--;
      
      // Process queue
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
  
  /**
   * Get all requests
   * 
   * @returns Array of requests
   */
  getRequests(): GatewayRequest[] {
    return [...this.requests];
  }
  
  /**
   * Get requests for a specific method
   * 
   * @param method - Method name
   * @returns Array of requests
   */
  getRequestsForMethod(method: string): GatewayRequest[] {
    return this.requests.filter(r => r.method === method);
  }
  
  /**
   * Get all responses
   * 
   * @returns Array of responses
   */
  getResponses(): GatewayResponse[] {
    return [...this.responses];
  }
  
  /**
   * Get the last request
   * 
   * @returns Last request or undefined
   */
  getLastRequest(): GatewayRequest | undefined {
    return this.requests[this.requests.length - 1];
  }
  
  /**
   * Get the last response
   * 
   * @returns Last response or undefined
   */
  getLastResponse(): GatewayResponse | undefined {
    return this.responses[this.responses.length - 1];
  }
  
  /**
   * Clear all requests and responses
   */
  clear(): void {
    this.requests = [];
    this.responses = [];
  }
  
  /**
   * Reset the gateway (clear history and unregister all methods)
   */
  reset(): void {
    this.clear();
    this.methods.clear();
    this.inFlight = 0;
    this.queue = [];
  }
  
  /**
   * Get current in-flight request count
   * 
   * @returns Number of in-flight requests
   */
  getInFlightCount(): number {
    return this.inFlight;
  }
  
  /**
   * Get current queue size
   * 
   * @returns Number of queued requests
   */
  getQueueSize(): number {
    return this.queue.length;
  }
  
  /**
   * Get average response time
   * 
   * @returns Average duration in milliseconds
   */
  getAverageResponseTime(): number {
    if (this.responses.length === 0) return 0;
    const total = this.responses.reduce((sum, r) => sum + r.duration, 0);
    return total / this.responses.length;
  }
  
  /**
   * Get success rate
   * 
   * @returns Success rate (0-1)
   */
  getSuccessRate(): number {
    if (this.responses.length === 0) return 1;
    const successes = this.responses.filter(r => !r.error).length;
    return successes / this.responses.length;
  }
}

/**
 * Create a mock Gateway instance
 * 
 * @param config - Gateway configuration
 * @returns Mock Gateway instance
 * 
 * @example
 * ```typescript
 * const gateway = createMockGateway({ latency: 10 });
 * ```
 */
export function createMockGateway(config?: MockGatewayConfig): MockGateway {
  return new MockGateway(config);
}

/**
 * Create a Gateway with common method stubs
 * 
 * @returns Mock Gateway with pre-registered methods
 * 
 * @example
 * ```typescript
 * const gateway = createMockGatewayWithStubs();
 * const result = await gateway.call('channels.send', { ... });
 * ```
 */
export function createMockGatewayWithStubs(): MockGateway {
  const gateway = createMockGateway();
  
  // Channels methods
  gateway.registerMethod('channels.send', async (params) => ({
    success: true,
    messageId: `msg-${Date.now()}`,
    timestamp: Date.now(),
  }));
  
  gateway.registerMethod('channels.list', async () => ({
    channels: ['qq', 'wechat'],
  }));
  
  gateway.registerMethod('channels.getStatus', async (params) => ({
    channel: params.channel,
    status: 'connected',
    lastActivity: Date.now(),
  }));
  
  // Security methods
  gateway.registerMethod('security.checkAllowlist', async (params) => ({
    allowed: true,
    recipient: params.recipient,
    tier: 'owner',
  }));
  
  gateway.registerMethod('security.triggerKillSwitch', async (params) => ({
    success: true,
    domain: params.domain,
    reason: params.reason,
  }));
  
  // Memory methods
  gateway.registerMethod('memory.write', async (params) => ({
    success: true,
    memoryId: `mem-${Date.now()}`,
  }));
  
  gateway.registerMethod('memory.recall', async (params) => ({
    memories: [],
    query: params.query,
  }));
  
  // Node methods
  gateway.registerMethod('nodes.register', async (params) => ({
    success: true,
    nodeId: `node-${Date.now()}`,
  }));
  
  gateway.registerMethod('nodes.list', async () => ({
    nodes: [],
  }));
  
  // Companion methods
  gateway.registerMethod('companion.getPersona', async () => ({
    name: 'Miya',
    mode: 'work',
  }));
  
  gateway.registerMethod('companion.updatePersona', async (params) => ({
    success: true,
  }));
  
  return gateway;
}

/**
 * Create a spy for Gateway method calls
 * 
 * @param gateway - Gateway instance
 * @param method - Method name to spy on
 * @returns Spy function
 * 
 * @example
 * ```typescript
 * const gateway = createMockGateway();
 * const spy = spyOnGatewayMethod(gateway, 'channels.send');
 * 
 * await gateway.call('channels.send', { ... });
 * 
 * expect(spy.calls).toHaveLength(1);
 * ```
 */
export function spyOnGatewayMethod(
  gateway: MockGateway,
  method: string
): ReturnType<typeof createSpy> {
  const spy = createSpy();
  const originalHandler = gateway.hasMethod(method)
    ? (gateway as any).methods.get(method)
    : undefined;
  
  gateway.registerMethod(method, async (params) => {
    spy(params);
    if (originalHandler) {
      return await originalHandler(params);
    }
    return { success: true };
  });
  
  return spy;
}
