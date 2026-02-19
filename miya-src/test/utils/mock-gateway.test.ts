/**
 * Mock Gateway Unit Tests
 * 
 * Verifies that the mock Gateway implementation works correctly.
 */

import { describe, test, expect } from 'bun:test';
import { createMockGateway, createMockGatewayWithStubs } from './mock-gateway';

describe('Mock Gateway', () => {
  describe('createMockGateway', () => {
    test('should create gateway instance', () => {
      const gateway = createMockGateway();
      expect(gateway).toBeDefined();
    });
    
    test('should register and call methods', async () => {
      const gateway = createMockGateway();
      
      gateway.registerMethod('test.method', async (params) => {
        return { success: true, echo: params.value };
      });
      
      const result = await gateway.call('test.method', { value: 'hello' });
      
      expect(result.success).toBe(true);
      expect(result.echo).toBe('hello');
    });
    
    test('should track requests', async () => {
      const gateway = createMockGateway();
      
      gateway.registerMethod('test.method', async () => ({ success: true }));
      
      await gateway.call('test.method', { param1: 'value1' });
      await gateway.call('test.method', { param2: 'value2' });
      
      const requests = gateway.getRequests();
      expect(requests).toHaveLength(2);
      expect(requests[0].method).toBe('test.method');
      expect(requests[0].params).toEqual({ param1: 'value1' });
      expect(requests[1].params).toEqual({ param2: 'value2' });
    });
    
    test('should track responses', async () => {
      const gateway = createMockGateway();
      
      gateway.registerMethod('test.method', async () => ({ result: 'ok' }));
      
      await gateway.call('test.method');
      
      const responses = gateway.getResponses();
      expect(responses).toHaveLength(1);
      expect(responses[0].result).toEqual({ result: 'ok' });
      expect(responses[0].duration).toBeGreaterThanOrEqual(0);
    });
    
    test('should throw on unknown method', async () => {
      const gateway = createMockGateway();
      
      await expect(
        gateway.call('unknown.method')
      ).rejects.toThrow('Method not found');
    });
    
    test('should simulate latency', async () => {
      const gateway = createMockGateway({ latency: 100 });
      
      gateway.registerMethod('test.method', async () => ({ success: true }));
      
      const start = Date.now();
      await gateway.call('test.method');
      const duration = Date.now() - start;
      
      expect(duration).toBeGreaterThanOrEqual(90);
    });
    
    test('should enforce backpressure', async () => {
      const gateway = createMockGateway({
        maxInFlight: 1,
        maxQueue: 0,
      });
      
      gateway.registerMethod('slow.method', async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true };
      });
      
      // Start first request (will be in-flight)
      const promise1 = gateway.call('slow.method');
      
      // Wait a bit to ensure first request is in-flight
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Second request should fail due to queue full
      await expect(
        gateway.call('slow.method')
      ).rejects.toThrow('Gateway queue full');
      
      await promise1;
    });
    
    test('should clear history', async () => {
      const gateway = createMockGateway();
      
      gateway.registerMethod('test.method', async () => ({ success: true }));
      
      await gateway.call('test.method');
      expect(gateway.getRequests()).toHaveLength(1);
      
      gateway.clear();
      expect(gateway.getRequests()).toHaveLength(0);
      expect(gateway.getResponses()).toHaveLength(0);
    });
    
    test('should calculate metrics', async () => {
      const gateway = createMockGateway();
      
      gateway.registerMethod('test.method', async () => ({ success: true }));
      
      await gateway.call('test.method');
      await gateway.call('test.method');
      
      expect(gateway.getAverageResponseTime()).toBeGreaterThanOrEqual(0);
      expect(gateway.getSuccessRate()).toBe(1);
    });
  });
  
  describe('createMockGatewayWithStubs', () => {
    test('should have pre-registered methods', () => {
      const gateway = createMockGatewayWithStubs();
      
      expect(gateway.hasMethod('channels.send')).toBe(true);
      expect(gateway.hasMethod('channels.list')).toBe(true);
      expect(gateway.hasMethod('security.checkAllowlist')).toBe(true);
      expect(gateway.hasMethod('memory.write')).toBe(true);
    });
    
    test('should call channels.send', async () => {
      const gateway = createMockGatewayWithStubs();
      
      const result = await gateway.call('channels.send', {
        recipient: 'test@example.com',
        message: 'Hello'
      });
      
      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });
    
    test('should call memory.recall', async () => {
      const gateway = createMockGatewayWithStubs();
      
      const result = await gateway.call('memory.recall', {
        query: 'test query'
      });
      
      expect(result.memories).toBeDefined();
      expect(result.query).toBe('test query');
    });
  });
});
