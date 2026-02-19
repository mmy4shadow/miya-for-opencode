# Test Fixtures

This directory contains sample data files for testing the Miya plugin. Fixtures provide consistent, realistic test data that can be reused across multiple tests.

## Directory Structure

```
fixtures/
├── policies/              # Policy configuration samples
├── memories/              # Memory record samples
├── evidence-bundles/      # Evidence bundle samples
├── configurations/        # System configuration samples
└── README.md             # This file
```

## Usage

### Loading Fixtures in Tests

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

// Load a policy fixture
const policyPath = join(__dirname, '../fixtures/policies/default.json');
const policy = JSON.parse(readFileSync(policyPath, 'utf-8'));

// Load a memory fixture
const memoryPath = join(__dirname, '../fixtures/memories/work-memory-sample.json');
const memory = JSON.parse(readFileSync(memoryPath, 'utf-8'));

// Load an evidence bundle fixture
const evidencePath = join(__dirname, '../fixtures/evidence-bundles/fs-write-evidence.json');
const evidence = JSON.parse(readFileSync(evidencePath, 'utf-8'));

// Load a configuration fixture
const configPath = join(__dirname, '../fixtures/configurations/default-config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
```

### Using Test Data Generator

For dynamic test data, use the test data generator:

```typescript
import { generatePolicy, generateMemory, generateEvidenceBundle } from '../utils/test-data-generator';

// Generate random policy
const policy = generatePolicy({ riskTier: 'THOROUGH' });

// Generate random memory
const memory = generateMemory({ domain: 'work_memory' });

// Generate random evidence bundle
const evidence = generateEvidenceBundle('fs_write');
```

## Fixture Categories

### 1. Policies (`policies/`)

Policy configuration files that define security rules, risk tiers, allowlists, and capability settings.

#### Available Fixtures:

- **`default.json`**: Standard policy with balanced security settings
  - 3 risk tiers (LIGHT, STANDARD, THOROUGH)
  - 3 allowlisted recipients (owner, friend, colleague)
  - All capabilities enabled with reasonable limits

- **`strict.json`**: Strict security policy for high-risk environments
  - All risk tiers require approval and evidence
  - Only owner tier recipient allowed
  - Desktop control and training disabled

- **`permissive.json`**: Permissive policy for development/testing
  - Extended silent thresholds
  - 5 allowlisted recipients
  - Higher VRAM budget (8GB)
  - Cross-domain memory writes without approval

#### Use Cases:

```typescript
// Test allowlist enforcement
test('should block non-allowlisted recipient', async () => {
  const policy = loadFixture('policies/strict.json');
  const result = await sendMessage(policy, 'stranger@example.com', 'test');
  expect(result.success).toBe(false);
});

// Test risk tier behavior
test('should enforce THOROUGH risk tier', async () => {
  const policy = loadFixture('policies/default.json');
  const tier = policy.riskTiers.THOROUGH;
  expect(tier.silentThreshold).toBe(0);
  expect(tier.approvalRequired).toBe(true);
});
```

### 2. Memories (`memories/`)

Memory record samples representing different memory domains and lifecycle states.

#### Available Fixtures:

- **`work-memory-sample.json`**: Active work memory
  - Domain: work_memory
  - Status: active
  - High access count (15)
  - Strong decay weight (0.95)

- **`relationship-memory-sample.json`**: Active relationship memory
  - Domain: relationship_memory
  - Status: active
  - Contains recipient metadata
  - Medium access count (8)

- **`episodic-memory-sample.json`**: Reflected episodic memory
  - Domain: episodic_memory
  - Status: reflected
  - Task completion event
  - Lower decay weight (0.75)

- **`pending-memory-sample.json`**: Pending approval memory
  - Domain: work_memory
  - Status: pending
  - Requires approval
  - Fresh (decay weight 1.0)

#### Use Cases:

```typescript
// Test memory retrieval
test('should retrieve active memories', async () => {
  const memory = loadFixture('memories/work-memory-sample.json');
  await storeMemory(memory);
  const results = await retrieveMemories('TypeScript');
  expect(results).toContainEqual(expect.objectContaining({ id: memory.id }));
});

// Test memory decay
test('should apply decay weight', async () => {
  const oldMemory = loadFixture('memories/episodic-memory-sample.json');
  const newMemory = loadFixture('memories/pending-memory-sample.json');
  expect(newMemory.decayWeight).toBeGreaterThan(oldMemory.decayWeight);
});

// Test memory lifecycle
test('should handle pending → active transition', async () => {
  const memory = loadFixture('memories/pending-memory-sample.json');
  expect(memory.status).toBe('pending');
  await approveMemory(memory.id);
  const updated = await getMemory(memory.id);
  expect(updated.status).toBe('active');
});
```

### 3. Evidence Bundles (`evidence-bundles/`)

Evidence bundle samples for different capability domains, demonstrating proper audit trail structure.

#### Available Fixtures:

- **`fs-write-evidence.json`**: File system write evidence
  - Includes git diff
  - File path and size
  - Operation type

- **`shell-exec-evidence.json`**: Shell command execution evidence
  - Command, stdout, stderr
  - Exit code
  - Duration

- **`desktop-control-evidence.json`**: Desktop automation evidence
  - Before/after screenshots
  - UIA method used
  - Human-Mutex wait time

- **`outbound-send-evidence.json`**: Outbound message send evidence
  - Recipient verification
  - Three-factor decision scores
  - Rate limit tracking

- **`memory-write-evidence.json`**: Memory write evidence
  - Cross-domain approval
  - Conflict detection
  - Embedding metadata

- **`training-evidence.json`**: Model training evidence
  - VRAM usage
  - Checkpoint path
  - Training duration
  - OOM detection

#### Use Cases:

```typescript
// Test evidence bundle structure
test('should generate complete evidence bundle', async () => {
  const expected = loadFixture('evidence-bundles/fs-write-evidence.json');
  const actual = await performFileWrite('/test/file.txt', 'content');
  
  expect(actual.evidenceBundle).toMatchObject({
    version: expected.version,
    auditId: expect.any(String),
    policyHash: expect.any(String),
    capabilityDomain: 'fs_write',
    gitDiff: expect.any(String),
  });
});

// Test semantic summary
test('should include semantic summary', async () => {
  const evidence = loadFixture('evidence-bundles/outbound-send-evidence.json');
  expect(evidence.semanticSummary).toHaveProperty('reason');
  expect(evidence.semanticSummary).toHaveProperty('keyAssertions');
  expect(evidence.semanticSummary).toHaveProperty('operatorNextSteps');
});

// Test action-specific evidence
test('should include training-specific evidence', async () => {
  const evidence = loadFixture('evidence-bundles/training-evidence.json');
  expect(evidence).toHaveProperty('vramBudget');
  expect(evidence).toHaveProperty('checkpointPath');
  expect(evidence).toHaveProperty('oomDetected');
});
```

### 4. Configurations (`configurations/`)

System configuration samples for different deployment scenarios.

#### Available Fixtures:

- **`default-config.json`**: Standard configuration
  - Balanced resource allocation
  - 4GB VRAM budget
  - Standard timeouts and limits

- **`minimal-config.json`**: Minimal resource configuration
  - Low VRAM budget (2GB)
  - Reduced queue sizes
  - Longer checkpoint intervals

- **`high-performance-config.json`**: High-performance configuration
  - 16GB VRAM budget
  - Larger queue sizes
  - Shorter checkpoint intervals
  - Model preloading enabled

#### Use Cases:

```typescript
// Test configuration loading
test('should load default configuration', async () => {
  const config = loadFixture('configurations/default-config.json');
  expect(config.version).toBe('0.7.0');
  expect(config.resources.vramBudget).toBe(4096);
});

// Test resource constraints
test('should enforce VRAM budget', async () => {
  const config = loadFixture('configurations/minimal-config.json');
  const result = await loadModel('flux-large', config);
  expect(result.success).toBe(false); // Model too large for 2GB budget
});

// Test performance settings
test('should use high-performance settings', async () => {
  const config = loadFixture('configurations/high-performance-config.json');
  expect(config.gateway.maxInFlight).toBe(20);
  expect(config.training.checkpointInterval.flux).toBe(25);
});
```

## Best Practices

### 1. Use Fixtures for Consistent Test Data

✅ **Good**: Use fixtures for consistent, realistic data
```typescript
const policy = loadFixture('policies/default.json');
```

❌ **Bad**: Inline test data that's hard to maintain
```typescript
const policy = { version: '1.0', riskTiers: { /* ... */ } };
```

### 2. Combine Fixtures with Generators

✅ **Good**: Use fixtures as base, override specific fields
```typescript
const policy = loadFixture('policies/default.json');
const customPolicy = { ...policy, allowlist: generateAllowlist() };
```

### 3. Document Fixture Purpose

Each fixture should have a clear purpose and use case. See the descriptions above.

### 4. Keep Fixtures Realistic

Fixtures should represent real-world scenarios, not edge cases. Use generators for edge cases.

### 5. Version Fixtures

When data structures change, update fixtures to match. Include version fields where applicable.

## Maintenance

### Adding New Fixtures

1. Create the fixture file in the appropriate subdirectory
2. Follow the naming convention: `{purpose}-{type}.json`
3. Document the fixture in this README
4. Add usage examples

### Updating Fixtures

When updating fixtures:
1. Ensure backward compatibility or update all tests
2. Update the documentation
3. Verify all tests still pass

### Removing Fixtures

Before removing a fixture:
1. Search for usage across all tests
2. Update or remove dependent tests
3. Update this README

## Related Files

- **`test/utils/test-data-generator.ts`**: Dynamic test data generation
- **`test/utils/test-helpers.ts`**: Test utility functions
- **`test/README.md`**: Overall test documentation

## Examples

### Complete Test Example

```typescript
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Policy Engine', () => {
  function loadFixture(path: string) {
    const fullPath = join(__dirname, '../fixtures', path);
    return JSON.parse(readFileSync(fullPath, 'utf-8'));
  }
  
  test('should enforce strict policy', async () => {
    const policy = loadFixture('policies/strict.json');
    const evidence = loadFixture('evidence-bundles/outbound-send-evidence.json');
    
    const result = await evaluatePolicy(policy, evidence);
    
    expect(result.approved).toBe(true);
    expect(result.evidenceRequired).toBe(true);
  });
  
  test('should block non-allowlisted recipient', async () => {
    const policy = loadFixture('policies/default.json');
    
    const result = await sendMessage(policy, 'stranger@example.com', 'test');
    
    expect(result.success).toBe(false);
    expect(result.reason).toContain('recipient_not_in_allowlist');
  });
});
```

## Summary

Test fixtures provide:
- ✅ Consistent test data across tests
- ✅ Realistic scenarios for integration tests
- ✅ Easy-to-maintain test data
- ✅ Clear documentation of data structures
- ✅ Reusable samples for multiple test cases

Use fixtures for stable, realistic data. Use generators for dynamic, randomized data.
