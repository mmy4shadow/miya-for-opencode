/**
 * Test Data Generator
 * 
 * Provides utilities for generating realistic test data for various
 * Miya plugin components including policies, memories, evidence bundles,
 * and configurations.
 * 
 * @module test/utils/test-data-generator
 */

import { randomString, randomInt, randomPick } from './test-helpers';

/**
 * Generate a random policy configuration
 * 
 * @param overrides - Optional property overrides
 * @returns Policy configuration object
 * 
 * @example
 * ```typescript
 * const policy = generatePolicy({ riskTier: 'THOROUGH' });
 * ```
 */
export function generatePolicy(overrides: Partial<any> = {}): any {
  return {
    version: '1.0',
    policyHash: randomString(64, '0123456789abcdef'),
    riskTiers: {
      LIGHT: {
        silentThreshold: 3600000, // 60 minutes
        evidenceRequired: false,
        approvalRequired: false,
      },
      STANDARD: {
        silentThreshold: 900000, // 15 minutes
        evidenceRequired: true,
        approvalRequired: true,
      },
      THOROUGH: {
        silentThreshold: 0,
        evidenceRequired: true,
        approvalRequired: true,
      },
    },
    allowlist: {
      recipients: [
        { id: 'owner@example.com', tier: 'owner', name: 'Owner' },
        { id: 'friend@example.com', tier: 'friend', name: 'Friend' },
      ],
    },
    capabilities: {
      outbound_send: { enabled: true, channels: ['qq', 'wechat'] },
      desktop_control: { enabled: true, humanMutexTimeout: 20000 },
      memory_write: { enabled: true, crossDomainApproval: true },
      training: { enabled: true, vramBudget: 4096 },
    },
    ...overrides,
  };
}

/**
 * Generate a random memory record
 * 
 * @param overrides - Optional property overrides
 * @returns Memory record object
 * 
 * @example
 * ```typescript
 * const memory = generateMemory({ domain: 'work_memory' });
 * ```
 */
export function generateMemory(overrides: Partial<any> = {}): any {
  const domains = ['work_memory', 'relationship_memory', 'episodic_memory', 'semantic_memory'];
  const statuses = ['pending', 'active', 'reflected'];
  
  return {
    id: `mem-${randomString(16)}`,
    content: `Test memory content ${randomString(8)}`,
    domain: randomPick(domains),
    status: randomPick(statuses),
    createdAt: Date.now() - randomInt(0, 86400000), // Within last 24 hours
    lastAccessed: Date.now() - randomInt(0, 3600000), // Within last hour
    accessCount: randomInt(1, 100),
    decayWeight: Math.random(),
    source: {
      type: 'user_input',
      messageId: `msg-${randomString(16)}`,
    },
    embedding: Array.from({ length: 384 }, () => Math.random()),
    ...overrides,
  };
}

/**
 * Generate a random evidence bundle
 * 
 * @param actionType - Type of action (fs_write, shell_exec, etc.)
 * @param overrides - Optional property overrides
 * @returns Evidence bundle object
 * 
 * @example
 * ```typescript
 * const evidence = generateEvidenceBundle('fs_write');
 * ```
 */
export function generateEvidenceBundle(
  actionType: string,
  overrides: Partial<any> = {}
): any {
  const baseBundle = {
    version: 'V5',
    auditId: `audit-${randomString(16)}`,
    policyHash: randomString(64, '0123456789abcdef'),
    capabilityDomain: actionType,
    timestamp: Date.now(),
    semanticSummary: {
      reason: randomPick(['user_request', 'scheduled_task', 'auto_correction']),
      keyAssertions: [
        'Action was approved by user',
        'Evidence was collected successfully',
      ],
      operatorNextSteps: 'Review the action results',
    },
  };
  
  // Add action-specific evidence
  switch (actionType) {
    case 'fs_write':
      return {
        ...baseBundle,
        gitDiff: `--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old content\n+new content`,
        filePath: '/test/file.txt',
        ...overrides,
      };
    
    case 'shell_exec':
      return {
        ...baseBundle,
        command: 'npm test',
        stdout: 'All tests passed',
        stderr: '',
        exitCode: 0,
        ...overrides,
      };
    
    case 'desktop_control':
      return {
        ...baseBundle,
        screenshots: {
          before: `/tmp/before-${Date.now()}.png`,
          after: `/tmp/after-${Date.now()}.png`,
        },
        action: 'send_message',
        target: 'QQ',
        ...overrides,
      };
    
    case 'outbound_send':
      return {
        ...baseBundle,
        recipient: 'friend@example.com',
        recipientTier: 'friend',
        message: 'Test message',
        channel: 'qq',
        sendFingerprint: randomString(32, '0123456789abcdef'),
        ...overrides,
      };
    
    case 'memory_write':
      return {
        ...baseBundle,
        memoryId: `mem-${randomString(16)}`,
        domain: 'work_memory',
        content: 'Test memory content',
        ...overrides,
      };
    
    case 'training':
      return {
        ...baseBundle,
        model: 'flux-schnell',
        vramUsed: 2048,
        steps: 100,
        checkpointPath: `/tmp/checkpoint-${Date.now()}.pth`,
        ...overrides,
      };
    
    default:
      return { ...baseBundle, ...overrides };
  }
}

/**
 * Generate a random configuration object
 * 
 * @param overrides - Optional property overrides
 * @returns Configuration object
 * 
 * @example
 * ```typescript
 * const config = generateConfig({ vramBudget: 8192 });
 * ```
 */
export function generateConfig(overrides: Partial<any> = {}): any {
  return {
    version: '0.7.0',
    gateway: {
      port: randomInt(3000, 9000),
      maxInFlight: randomInt(5, 20),
      maxQueue: randomInt(50, 200),
      timeout: randomInt(10000, 60000),
    },
    daemon: {
      autoStart: true,
      heartbeatInterval: 10000,
      reconnectBackoff: [1000, 2000, 4000, 8000, 16000],
      suicideTimer: 60000,
    },
    resources: {
      vramBudget: randomInt(2048, 16384),
      tempImageLimit: 20480, // 20GB
      tempVoiceRetention: 7, // days
    },
    training: {
      defaultPreset: 0.5,
      checkpointInterval: {
        flux: 50,
        gptsovits: 100,
      },
      minCheckpointInterval: 300000, // 5 minutes
    },
    desktop: {
      humanMutexTimeout: 20000,
      cooldownPeriod: 900000, // 15 minutes
      maxRetries: 3,
    },
    ...overrides,
  };
}

/**
 * Generate a random user profile
 * 
 * @param overrides - Optional property overrides
 * @returns User profile object
 * 
 * @example
 * ```typescript
 * const user = generateUser({ tier: 'owner' });
 * ```
 */
export function generateUser(overrides: Partial<any> = {}): any {
  const tiers = ['owner', 'friend', 'colleague', 'stranger'];
  const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
  
  return {
    id: `user-${randomString(16)}`,
    name: randomPick(names),
    email: `${randomString(8)}@example.com`,
    tier: randomPick(tiers),
    createdAt: Date.now() - randomInt(0, 31536000000), // Within last year
    lastSeen: Date.now() - randomInt(0, 86400000), // Within last 24 hours
    ...overrides,
  };
}

/**
 * Generate a random task/job record
 * 
 * @param overrides - Optional property overrides
 * @returns Task record object
 * 
 * @example
 * ```typescript
 * const task = generateTask({ status: 'completed' });
 * ```
 */
export function generateTask(overrides: Partial<any> = {}): any {
  const types = ['image_generation', 'voice_training', 'desktop_control', 'memory_write'];
  const statuses = ['pending', 'running', 'completed', 'failed', 'cancelled'];
  
  return {
    id: `task-${randomString(16)}`,
    type: randomPick(types),
    status: randomPick(statuses),
    createdAt: Date.now() - randomInt(0, 3600000),
    startedAt: Date.now() - randomInt(0, 1800000),
    completedAt: Date.now() - randomInt(0, 900000),
    params: {
      prompt: `Test prompt ${randomString(8)}`,
    },
    result: {
      success: true,
    },
    ...overrides,
  };
}

/**
 * Generate a random approval request
 * 
 * @param overrides - Optional property overrides
 * @returns Approval request object
 * 
 * @example
 * ```typescript
 * const approval = generateApprovalRequest({ riskTier: 'THOROUGH' });
 * ```
 */
export function generateApprovalRequest(overrides: Partial<any> = {}): any {
  const actions = ['fs_write', 'shell_exec', 'desktop_control', 'outbound_send'];
  const riskTiers = ['LIGHT', 'STANDARD', 'THOROUGH'];
  
  return {
    id: `approval-${randomString(16)}`,
    action: randomPick(actions),
    riskTier: randomPick(riskTiers),
    params: {
      description: `Test action ${randomString(8)}`,
    },
    requestedAt: Date.now(),
    expiresAt: Date.now() + 300000, // 5 minutes
    status: 'pending',
    ...overrides,
  };
}

/**
 * Generate a random Kill-Switch event
 * 
 * @param overrides - Optional property overrides
 * @returns Kill-Switch event object
 * 
 * @example
 * ```typescript
 * const killSwitch = generateKillSwitchEvent({ domain: 'outbound_send' });
 * ```
 */
export function generateKillSwitchEvent(overrides: Partial<any> = {}): any {
  const domains = ['outbound_send', 'desktop_control', 'memory_write', 'training'];
  const reasons = ['recipient_mismatch', 'privilege_barrier', 'oom', 'injection_risk'];
  
  return {
    id: `killswitch-${randomString(16)}`,
    domain: randomPick(domains),
    reason: randomPick(reasons),
    triggeredAt: Date.now(),
    semanticSummary: {
      reason: randomPick(reasons),
      keyAssertions: [
        'Kill-Switch was triggered',
        'Domain was shut down',
      ],
      recoveryConditions: 'Manual unlock required from owner tier',
    },
    inFlightTasks: [],
    ...overrides,
  };
}

/**
 * Generate a batch of test data
 * 
 * @param type - Type of data to generate
 * @param count - Number of items to generate
 * @param overrides - Optional property overrides
 * @returns Array of generated items
 * 
 * @example
 * ```typescript
 * const memories = generateBatch('memory', 10);
 * const policies = generateBatch('policy', 5, { riskTier: 'STANDARD' });
 * ```
 */
export function generateBatch(
  type: 'policy' | 'memory' | 'evidence' | 'config' | 'user' | 'task' | 'approval' | 'killswitch',
  count: number,
  overrides: Partial<any> = {}
): any[] {
  const generators = {
    policy: generatePolicy,
    memory: generateMemory,
    evidence: () => generateEvidenceBundle('fs_write', overrides),
    config: generateConfig,
    user: generateUser,
    task: generateTask,
    approval: generateApprovalRequest,
    killswitch: generateKillSwitchEvent,
  };
  
  const generator = generators[type];
  return Array.from({ length: count }, () => generator(overrides));
}

/**
 * Generate a realistic conversation history
 * 
 * @param messageCount - Number of messages to generate
 * @returns Array of message objects
 * 
 * @example
 * ```typescript
 * const conversation = generateConversation(20);
 * ```
 */
export function generateConversation(messageCount: number): any[] {
  const roles = ['user', 'assistant'];
  const messages: any[] = [];
  
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      id: `msg-${randomString(16)}`,
      role: roles[i % 2],
      content: `Message ${i + 1}: ${randomString(20)}`,
      timestamp: Date.now() - (messageCount - i) * 60000, // 1 minute apart
    });
  }
  
  return messages;
}

/**
 * Generate a realistic file tree structure
 * 
 * @param depth - Maximum depth of the tree
 * @param filesPerDir - Average files per directory
 * @returns File tree object
 * 
 * @example
 * ```typescript
 * const fileTree = generateFileTree(3, 5);
 * ```
 */
export function generateFileTree(depth: number, filesPerDir: number): any {
  function generateNode(currentDepth: number): any {
    if (currentDepth >= depth) {
      return {
        type: 'file',
        name: `file-${randomString(8)}.ts`,
        size: randomInt(100, 10000),
      };
    }
    
    const children: any[] = [];
    const fileCount = randomInt(filesPerDir - 2, filesPerDir + 2);
    
    for (let i = 0; i < fileCount; i++) {
      if (Math.random() < 0.3 && currentDepth < depth - 1) {
        // Create directory
        children.push({
          type: 'directory',
          name: `dir-${randomString(6)}`,
          children: Array.from(
            { length: randomInt(2, 5) },
            () => generateNode(currentDepth + 1)
          ),
        });
      } else {
        // Create file
        children.push(generateNode(depth));
      }
    }
    
    return {
      type: 'directory',
      name: currentDepth === 0 ? 'root' : `dir-${randomString(6)}`,
      children,
    };
  }
  
  return generateNode(0);
}

/**
 * Generate performance benchmark data
 * 
 * @param metricName - Name of the metric
 * @param sampleCount - Number of samples
 * @returns Benchmark data object
 * 
 * @example
 * ```typescript
 * const benchmark = generateBenchmarkData('rpc_latency', 100);
 * ```
 */
export function generateBenchmarkData(metricName: string, sampleCount: number): any {
  const samples = Array.from({ length: sampleCount }, () => ({
    value: Math.random() * 100 + 10, // 10-110ms
    timestamp: Date.now() - randomInt(0, 3600000),
  }));
  
  samples.sort((a, b) => a.value - b.value);
  
  const values = samples.map(s => s.value);
  const sum = values.reduce((a, b) => a + b, 0);
  
  return {
    metric: metricName,
    sampleCount,
    samples,
    statistics: {
      min: values[0],
      max: values[values.length - 1],
      mean: sum / sampleCount,
      median: values[Math.floor(sampleCount / 2)],
      p50: values[Math.floor(sampleCount * 0.5)],
      p95: values[Math.floor(sampleCount * 0.95)],
      p99: values[Math.floor(sampleCount * 0.99)],
    },
  };
}
