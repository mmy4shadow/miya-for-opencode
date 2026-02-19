/**
 * Fixture Loading Tests
 * 
 * Verifies that all test fixtures can be loaded correctly and have valid structure.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = __dirname;

/**
 * Load a fixture file
 */
function loadFixture(relativePath: string): any {
  const fullPath = join(FIXTURES_DIR, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf-8'));
}

describe('Fixture Loading', () => {
  describe('Policy Fixtures', () => {
    test('should load default policy', () => {
      const policy = loadFixture('policies/default.json');
      
      expect(policy.version).toBe('1.0');
      expect(policy.policyHash).toBeDefined();
      expect(policy.riskTiers).toHaveProperty('LIGHT');
      expect(policy.riskTiers).toHaveProperty('STANDARD');
      expect(policy.riskTiers).toHaveProperty('THOROUGH');
      expect(policy.allowlist.recipients).toBeArray();
      expect(policy.capabilities).toBeDefined();
    });
    
    test('should load strict policy', () => {
      const policy = loadFixture('policies/strict.json');
      
      expect(policy.version).toBe('1.0');
      expect(policy.riskTiers.LIGHT.approvalRequired).toBe(true);
      expect(policy.allowlist.recipients).toHaveLength(1);
      expect(policy.capabilities.desktop_control.enabled).toBe(false);
    });
    
    test('should load permissive policy', () => {
      const policy = loadFixture('policies/permissive.json');
      
      expect(policy.version).toBe('1.0');
      expect(policy.riskTiers.LIGHT.silentThreshold).toBeGreaterThan(3600000);
      expect(policy.allowlist.recipients.length).toBeGreaterThan(3);
      expect(policy.capabilities.training.vramBudget).toBe(8192);
    });
  });
  
  describe('Memory Fixtures', () => {
    test('should load work memory sample', () => {
      const memory = loadFixture('memories/work-memory-sample.json');
      
      expect(memory.id).toStartWith('mem-');
      expect(memory.domain).toBe('work_memory');
      expect(memory.status).toBe('active');
      expect(memory.content).toBeDefined();
      expect(memory.decayWeight).toBeGreaterThan(0);
      expect(memory.source).toBeDefined();
    });
    
    test('should load relationship memory sample', () => {
      const memory = loadFixture('memories/relationship-memory-sample.json');
      
      expect(memory.domain).toBe('relationship_memory');
      expect(memory.status).toBe('active');
      expect(memory.metadata.recipientId).toBeDefined();
    });
    
    test('should load episodic memory sample', () => {
      const memory = loadFixture('memories/episodic-memory-sample.json');
      
      expect(memory.domain).toBe('episodic_memory');
      expect(memory.status).toBe('reflected');
      expect(memory.tags).toBeArray();
    });
    
    test('should load pending memory sample', () => {
      const memory = loadFixture('memories/pending-memory-sample.json');
      
      expect(memory.status).toBe('pending');
      expect(memory.approvalRequired).toBe(true);
      expect(memory.decayWeight).toBe(1.0);
    });
  });
  
  describe('Evidence Bundle Fixtures', () => {
    test('should load fs-write evidence', () => {
      const evidence = loadFixture('evidence-bundles/fs-write-evidence.json');
      
      expect(evidence.version).toBe('V5');
      expect(evidence.auditId).toStartWith('audit-');
      expect(evidence.capabilityDomain).toBe('fs_write');
      expect(evidence.gitDiff).toBeDefined();
      expect(evidence.filePath).toBeDefined();
      expect(evidence.semanticSummary).toBeDefined();
    });
    
    test('should load shell-exec evidence', () => {
      const evidence = loadFixture('evidence-bundles/shell-exec-evidence.json');
      
      expect(evidence.capabilityDomain).toBe('shell_exec');
      expect(evidence.command).toBeDefined();
      expect(evidence.stdout).toBeDefined();
      expect(evidence.exitCode).toBeDefined();
    });
    
    test('should load desktop-control evidence', () => {
      const evidence = loadFixture('evidence-bundles/desktop-control-evidence.json');
      
      expect(evidence.capabilityDomain).toBe('desktop_control');
      expect(evidence.screenshots).toBeDefined();
      expect(evidence.screenshots.before).toBeDefined();
      expect(evidence.screenshots.after).toBeDefined();
      expect(evidence.action).toBe('send_message');
    });
    
    test('should load outbound-send evidence', () => {
      const evidence = loadFixture('evidence-bundles/outbound-send-evidence.json');
      
      expect(evidence.capabilityDomain).toBe('outbound_send');
      expect(evidence.recipient).toBeDefined();
      expect(evidence.recipientTier).toBeDefined();
      expect(evidence.decisionFactors).toBeDefined();
      expect(evidence.sendFingerprint).toBeDefined();
    });
    
    test('should load memory-write evidence', () => {
      const evidence = loadFixture('evidence-bundles/memory-write-evidence.json');
      
      expect(evidence.capabilityDomain).toBe('memory_write');
      expect(evidence.memoryId).toBeDefined();
      expect(evidence.domain).toBeDefined();
      expect(evidence.crossDomainApproval).toBeDefined();
    });
    
    test('should load training evidence', () => {
      const evidence = loadFixture('evidence-bundles/training-evidence.json');
      
      expect(evidence.capabilityDomain).toBe('training');
      expect(evidence.model).toBeDefined();
      expect(evidence.vramBudget).toBeDefined();
      expect(evidence.vramUsed).toBeDefined();
      expect(evidence.checkpointPath).toBeDefined();
      expect(evidence.oomDetected).toBeDefined();
    });
  });
  
  describe('Configuration Fixtures', () => {
    test('should load default config', () => {
      const config = loadFixture('configurations/default-config.json');
      
      expect(config.version).toBe('0.7.0');
      expect(config.gateway).toBeDefined();
      expect(config.daemon).toBeDefined();
      expect(config.resources).toBeDefined();
      expect(config.training).toBeDefined();
      expect(config.desktop).toBeDefined();
    });
    
    test('should load minimal config', () => {
      const config = loadFixture('configurations/minimal-config.json');
      
      expect(config.resources.vramBudget).toBe(2048);
      expect(config.gateway.maxInFlight).toBe(5);
      expect(config.training.defaultPreset).toBe(0.3);
    });
    
    test('should load high-performance config', () => {
      const config = loadFixture('configurations/high-performance-config.json');
      
      expect(config.resources.vramBudget).toBe(16384);
      expect(config.gateway.maxInFlight).toBe(20);
      expect(config.training.defaultPreset).toBe(0.8);
      expect(config.resources.modelCache).toBeDefined();
    });
  });
  
  describe('Fixture Structure Validation', () => {
    test('all evidence bundles should have semantic summaries', () => {
      const evidenceFiles = readdirSync(join(FIXTURES_DIR, 'evidence-bundles'))
        .filter(f => f.endsWith('.json'));
      
      for (const file of evidenceFiles) {
        const evidence = loadFixture(`evidence-bundles/${file}`);
        expect(evidence.semanticSummary).toBeDefined();
        expect(evidence.semanticSummary.reason).toBeDefined();
        expect(evidence.semanticSummary.keyAssertions).toBeArray();
        expect(evidence.semanticSummary.operatorNextSteps).toBeDefined();
      }
    });
    
    test('all policies should have three risk tiers', () => {
      const policyFiles = readdirSync(join(FIXTURES_DIR, 'policies'))
        .filter(f => f.endsWith('.json'));
      
      for (const file of policyFiles) {
        const policy = loadFixture(`policies/${file}`);
        expect(policy.riskTiers).toHaveProperty('LIGHT');
        expect(policy.riskTiers).toHaveProperty('STANDARD');
        expect(policy.riskTiers).toHaveProperty('THOROUGH');
      }
    });
    
    test('all memories should have required fields', () => {
      const memoryFiles = readdirSync(join(FIXTURES_DIR, 'memories'))
        .filter(f => f.endsWith('.json'));
      
      for (const file of memoryFiles) {
        const memory = loadFixture(`memories/${file}`);
        expect(memory.id).toBeDefined();
        expect(memory.content).toBeDefined();
        expect(memory.domain).toBeDefined();
        expect(memory.status).toBeDefined();
        expect(memory.decayWeight).toBeDefined();
        expect(memory.source).toBeDefined();
      }
    });
    
    test('all configs should have version field', () => {
      const configFiles = readdirSync(join(FIXTURES_DIR, 'configurations'))
        .filter(f => f.endsWith('.json'));
      
      for (const file of configFiles) {
        const config = loadFixture(`configurations/${file}`);
        expect(config.version).toBe('0.7.0');
      }
    });
  });
});

describe('Fixture Coverage', () => {
  test('should have fixtures for all capability domains', () => {
    const domains = [
      'fs_write',
      'shell_exec',
      'desktop_control',
      'outbound_send',
      'memory_write',
      'training'
    ];
    
    const evidenceFiles = readdirSync(join(FIXTURES_DIR, 'evidence-bundles'))
      .filter(f => f.endsWith('.json'));
    
    for (const domain of domains) {
      const hasFixture = evidenceFiles.some(file => {
        const evidence = loadFixture(`evidence-bundles/${file}`);
        return evidence.capabilityDomain === domain;
      });
      expect(hasFixture).toBe(true);
    }
  });
  
  test('should have fixtures for all memory domains', () => {
    const domains = [
      'work_memory',
      'relationship_memory',
      'episodic_memory'
    ];
    
    const memoryFiles = readdirSync(join(FIXTURES_DIR, 'memories'))
      .filter(f => f.endsWith('.json'));
    
    for (const domain of domains) {
      const hasFixture = memoryFiles.some(file => {
        const memory = loadFixture(`memories/${file}`);
        return memory.domain === domain;
      });
      expect(hasFixture).toBe(true);
    }
  });
  
  test('should have fixtures for different policy profiles', () => {
    const profiles = ['default', 'strict', 'permissive'];
    
    const policyFiles = readdirSync(join(FIXTURES_DIR, 'policies'))
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
    
    for (const profile of profiles) {
      expect(policyFiles).toContain(profile);
    }
  });
});
