/**
 * Test Data Generator Unit Tests
 * 
 * Verifies that test data generators produce valid data.
 */

import { describe, test, expect } from 'bun:test';
import {
  generatePolicy,
  generateMemory,
  generateEvidenceBundle,
  generateConfig,
  generateUser,
  generateTask,
  generateApprovalRequest,
  generateKillSwitchEvent,
  generateBatch,
  generateConversation,
  generateFileTree,
  generateBenchmarkData,
} from './test-data-generator';

describe('Test Data Generator', () => {
  describe('generatePolicy', () => {
    test('should generate valid policy', () => {
      const policy = generatePolicy();
      
      expect(policy.version).toBeDefined();
      expect(policy.policyHash).toBeDefined();
      expect(policy.riskTiers).toBeDefined();
      expect(policy.allowlist).toBeDefined();
      expect(policy.capabilities).toBeDefined();
    });
    
    test('should apply overrides', () => {
      const policy = generatePolicy({ version: '2.0' });
      expect(policy.version).toBe('2.0');
    });
  });
  
  describe('generateMemory', () => {
    test('should generate valid memory', () => {
      const memory = generateMemory();
      
      expect(memory.id).toBeDefined();
      expect(memory.content).toBeDefined();
      expect(memory.domain).toBeDefined();
      expect(memory.status).toBeDefined();
      expect(memory.createdAt).toBeDefined();
      expect(memory.embedding).toBeInstanceOf(Array);
    });
    
    test('should apply overrides', () => {
      const memory = generateMemory({ domain: 'work_memory' });
      expect(memory.domain).toBe('work_memory');
    });
  });
  
  describe('generateEvidenceBundle', () => {
    test('should generate fs_write evidence', () => {
      const evidence = generateEvidenceBundle('fs_write');
      
      expect(evidence.version).toBe('V5');
      expect(evidence.auditId).toBeDefined();
      expect(evidence.policyHash).toBeDefined();
      expect(evidence.capabilityDomain).toBe('fs_write');
      expect(evidence.gitDiff).toBeDefined();
      expect(evidence.filePath).toBeDefined();
    });
    
    test('should generate shell_exec evidence', () => {
      const evidence = generateEvidenceBundle('shell_exec');
      
      expect(evidence.command).toBeDefined();
      expect(evidence.stdout).toBeDefined();
      expect(evidence.exitCode).toBeDefined();
    });
    
    test('should generate desktop_control evidence', () => {
      const evidence = generateEvidenceBundle('desktop_control');
      
      expect(evidence.screenshots).toBeDefined();
      expect(evidence.screenshots.before).toBeDefined();
      expect(evidence.screenshots.after).toBeDefined();
    });
    
    test('should generate outbound_send evidence', () => {
      const evidence = generateEvidenceBundle('outbound_send');
      
      expect(evidence.recipient).toBeDefined();
      expect(evidence.recipientTier).toBeDefined();
      expect(evidence.message).toBeDefined();
      expect(evidence.channel).toBeDefined();
      expect(evidence.sendFingerprint).toBeDefined();
    });
    
    test('should apply overrides', () => {
      const evidence = generateEvidenceBundle('fs_write', {
        filePath: '/custom/path.txt'
      });
      
      expect(evidence.filePath).toBe('/custom/path.txt');
    });
  });
  
  describe('generateConfig', () => {
    test('should generate valid config', () => {
      const config = generateConfig();
      
      expect(config.version).toBeDefined();
      expect(config.gateway).toBeDefined();
      expect(config.daemon).toBeDefined();
      expect(config.resources).toBeDefined();
      expect(config.training).toBeDefined();
      expect(config.desktop).toBeDefined();
    });
    
    test('should apply overrides', () => {
      const config = generateConfig({ version: '1.0.0' });
      expect(config.version).toBe('1.0.0');
    });
  });
  
  describe('generateUser', () => {
    test('should generate valid user', () => {
      const user = generateUser();
      
      expect(user.id).toBeDefined();
      expect(user.name).toBeDefined();
      expect(user.email).toBeDefined();
      expect(user.tier).toBeDefined();
      expect(user.createdAt).toBeDefined();
    });
    
    test('should apply overrides', () => {
      const user = generateUser({ tier: 'owner' });
      expect(user.tier).toBe('owner');
    });
  });
  
  describe('generateTask', () => {
    test('should generate valid task', () => {
      const task = generateTask();
      
      expect(task.id).toBeDefined();
      expect(task.type).toBeDefined();
      expect(task.status).toBeDefined();
      expect(task.createdAt).toBeDefined();
    });
    
    test('should apply overrides', () => {
      const task = generateTask({ status: 'completed' });
      expect(task.status).toBe('completed');
    });
  });
  
  describe('generateApprovalRequest', () => {
    test('should generate valid approval request', () => {
      const approval = generateApprovalRequest();
      
      expect(approval.id).toBeDefined();
      expect(approval.action).toBeDefined();
      expect(approval.riskTier).toBeDefined();
      expect(approval.requestedAt).toBeDefined();
      expect(approval.expiresAt).toBeDefined();
    });
    
    test('should apply overrides', () => {
      const approval = generateApprovalRequest({ riskTier: 'THOROUGH' });
      expect(approval.riskTier).toBe('THOROUGH');
    });
  });
  
  describe('generateKillSwitchEvent', () => {
    test('should generate valid kill-switch event', () => {
      const event = generateKillSwitchEvent();
      
      expect(event.id).toBeDefined();
      expect(event.domain).toBeDefined();
      expect(event.reason).toBeDefined();
      expect(event.triggeredAt).toBeDefined();
      expect(event.semanticSummary).toBeDefined();
    });
    
    test('should apply overrides', () => {
      const event = generateKillSwitchEvent({ domain: 'outbound_send' });
      expect(event.domain).toBe('outbound_send');
    });
  });
  
  describe('generateBatch', () => {
    test('should generate batch of memories', () => {
      const memories = generateBatch('memory', 10);
      
      expect(memories).toHaveLength(10);
      expect(memories[0].id).toBeDefined();
    });
    
    test('should generate batch with overrides', () => {
      const users = generateBatch('user', 5, { tier: 'friend' });
      
      expect(users).toHaveLength(5);
      users.forEach(user => {
        expect(user.tier).toBe('friend');
      });
    });
  });
  
  describe('generateConversation', () => {
    test('should generate conversation history', () => {
      const conversation = generateConversation(10);
      
      expect(conversation).toHaveLength(10);
      expect(conversation[0].role).toBe('user');
      expect(conversation[1].role).toBe('assistant');
      expect(conversation[0].content).toBeDefined();
    });
    
    test('should have chronological timestamps', () => {
      const conversation = generateConversation(5);
      
      for (let i = 1; i < conversation.length; i++) {
        expect(conversation[i].timestamp).toBeGreaterThan(
          conversation[i - 1].timestamp
        );
      }
    });
  });
  
  describe('generateFileTree', () => {
    test('should generate file tree', () => {
      const tree = generateFileTree(2, 3);
      
      expect(tree.type).toBe('directory');
      expect(tree.children).toBeDefined();
      expect(tree.children.length).toBeGreaterThan(0);
    });
    
    test('should respect depth limit', () => {
      const tree = generateFileTree(1, 3);
      
      // At depth 1, all children should be files
      tree.children.forEach((child: any) => {
        if (child.type === 'file') {
          expect(child.size).toBeDefined();
        }
      });
    });
  });
  
  describe('generateBenchmarkData', () => {
    test('should generate benchmark data', () => {
      const benchmark = generateBenchmarkData('test_metric', 100);
      
      expect(benchmark.metric).toBe('test_metric');
      expect(benchmark.sampleCount).toBe(100);
      expect(benchmark.samples).toHaveLength(100);
      expect(benchmark.statistics).toBeDefined();
    });
    
    test('should calculate statistics correctly', () => {
      const benchmark = generateBenchmarkData('test_metric', 100);
      const stats = benchmark.statistics;
      
      expect(stats.min).toBeLessThanOrEqual(stats.median);
      expect(stats.median).toBeLessThanOrEqual(stats.max);
      expect(stats.p50).toBeLessThanOrEqual(stats.p95);
      expect(stats.p95).toBeLessThanOrEqual(stats.p99);
    });
  });
});
