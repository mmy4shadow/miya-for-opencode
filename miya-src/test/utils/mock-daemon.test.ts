/**
 * Mock Daemon Unit Tests
 * 
 * Verifies that the mock Daemon implementation works correctly.
 */

import { describe, test, expect } from 'bun:test';
import { createMockDaemon } from './mock-daemon';
import { sleep } from './test-helpers';

describe('Mock Daemon', () => {
  describe('createMockDaemon', () => {
    test('should create daemon instance', () => {
      const daemon = createMockDaemon();
      expect(daemon).toBeDefined();
    });
    
    test('should submit and execute task', async () => {
      const daemon = createMockDaemon({ executionTime: 50 });
      
      const taskId = await daemon.submitTask('image_generation', {
        prompt: 'A beautiful sunset',
        model: 'flux-schnell'
      });
      
      expect(taskId).toBeDefined();
      
      const task = await daemon.waitForTask(taskId);
      
      expect(task.status).toBe('completed');
      expect(task.result.imagePath).toBeDefined();
      expect(task.result.prompt).toBe('A beautiful sunset');
    });
    
    test('should track task lifecycle', async () => {
      const daemon = createMockDaemon({ executionTime: 50 });
      
      const taskId = await daemon.submitTask('voice_training', {
        steps: 100
      });
      
      // Task should start as pending
      let task = daemon.getTask(taskId);
      expect(task?.status).toMatch(/pending|running/);
      
      // Wait for completion
      task = await daemon.waitForTask(taskId);
      
      expect(task.status).toBe('completed');
      expect(task.createdAt).toBeDefined();
      expect(task.startedAt).toBeDefined();
      expect(task.completedAt).toBeDefined();
    });
    
    test('should enforce VRAM budget', async () => {
      const daemon = createMockDaemon({
        vramAvailable: 2048,
        executionTime: 50
      });
      
      // Submit task that requires 4GB (should fail)
      const taskId = await daemon.submitTask('image_generation', {
        model: 'flux-large' // Requires 4GB
      });
      
      const task = await daemon.waitForTask(taskId);
      
      expect(task.status).toBe('failed');
      expect(task.error).toContain('Insufficient VRAM');
    });
    
    test('should track VRAM usage', async () => {
      const daemon = createMockDaemon({
        vramAvailable: 8192,
        executionTime: 100
      });
      
      // Submit task that uses VRAM
      const taskId = await daemon.submitTask('image_generation', {
        model: 'flux-schnell' // Uses 2GB
      });
      
      // Wait a bit for task to start
      await sleep(20);
      
      // VRAM should be allocated
      const vramUsed = daemon.getTotalVRAMUsed();
      expect(vramUsed).toBeGreaterThan(0);
      
      // Wait for completion
      await daemon.waitForTask(taskId);
      
      // VRAM should be released
      expect(daemon.getTotalVRAMUsed()).toBe(0);
    });
    
    test('should respect human mutex for desktop control', async () => {
      const daemon = createMockDaemon({
        humanMutex: true,
        executionTime: 50
      });
      
      const taskId = await daemon.submitTask('desktop_control', {
        action: 'send_message'
      });
      
      const task = await daemon.waitForTask(taskId);
      
      expect(task.status).toBe('failed');
      expect(task.error).toContain('Human mutex active');
    });
    
    test('should allow desktop control when human mutex is off', async () => {
      const daemon = createMockDaemon({
        humanMutex: false,
        executionTime: 50
      });
      
      const taskId = await daemon.submitTask('desktop_control', {
        action: 'send_message'
      });
      
      const task = await daemon.waitForTask(taskId);
      
      expect(task.status).toBe('completed');
      expect(task.result.success).toBe(true);
    });
    
    test('should cancel running task', async () => {
      const daemon = createMockDaemon({ executionTime: 200 });
      
      const taskId = await daemon.submitTask('image_generation', {
        prompt: 'test'
      });
      
      // Wait a bit for task to start
      await sleep(50);
      
      // Cancel the task
      const cancelled = daemon.cancelTask(taskId);
      expect(cancelled).toBe(true);
      
      const task = daemon.getTask(taskId);
      expect(task?.status).toBe('cancelled');
    });
    
    test('should get tasks by status', async () => {
      const daemon = createMockDaemon({ executionTime: 50 });
      
      await daemon.submitTask('image_generation', { prompt: 'test1' });
      await daemon.submitTask('voice_training', { steps: 100 });
      
      await sleep(100);
      
      const completed = daemon.getTasksByStatus('completed');
      expect(completed.length).toBeGreaterThan(0);
    });
    
    test('should get tasks by type', async () => {
      const daemon = createMockDaemon({ executionTime: 50 });
      
      await daemon.submitTask('image_generation', { prompt: 'test1' });
      await daemon.submitTask('image_generation', { prompt: 'test2' });
      await daemon.submitTask('voice_training', { steps: 100 });
      
      await sleep(100);
      
      const imageTasks = daemon.getTasksByType('image_generation');
      expect(imageTasks).toHaveLength(2);
    });
    
    test('should calculate statistics', async () => {
      const daemon = createMockDaemon({ executionTime: 50 });
      
      await daemon.submitTask('image_generation', { prompt: 'test' });
      await sleep(100);
      
      const stats = daemon.getStatistics();
      
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.completed).toBeGreaterThan(0);
      expect(stats.successRate).toBeGreaterThan(0);
      expect(stats.vramAvailable).toBeGreaterThan(0);
    });
    
    test('should simulate connection state', () => {
      const daemon = createMockDaemon();
      
      expect(daemon.isConnected()).toBe(true);
      
      daemon.disconnect();
      expect(daemon.isConnected()).toBe(false);
      
      daemon.reconnect();
      expect(daemon.isConnected()).toBe(true);
    });
    
    test('should clear all tasks', async () => {
      const daemon = createMockDaemon({ executionTime: 50 });
      
      await daemon.submitTask('image_generation', { prompt: 'test' });
      await sleep(100);
      
      expect(daemon.getAllTasks()).toHaveLength(1);
      
      daemon.clear();
      expect(daemon.getAllTasks()).toHaveLength(0);
    });
    
    test('should generate appropriate results for different task types', async () => {
      const daemon = createMockDaemon({ executionTime: 50 });
      
      // Image generation
      const imageTaskId = await daemon.submitTask('image_generation', {
        prompt: 'test',
        model: 'flux-schnell'
      });
      const imageTask = await daemon.waitForTask(imageTaskId);
      expect(imageTask.result.imagePath).toBeDefined();
      
      // Voice inference
      const voiceTaskId = await daemon.submitTask('voice_inference', {
        text: 'Hello world'
      });
      const voiceTask = await daemon.waitForTask(voiceTaskId);
      expect(voiceTask.result.audioPath).toBeDefined();
      
      // ASR
      const asrTaskId = await daemon.submitTask('asr', {
        audioPath: '/tmp/audio.wav'
      });
      const asrTask = await daemon.waitForTask(asrTaskId);
      expect(asrTask.result.text).toBeDefined();
    });
  });
});
