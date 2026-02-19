# Miya Plugin Test Suite

This directory contains the comprehensive test suite for the Miya plugin, covering all aspects of the plugin's functionality, security, performance, and reliability.

## Directory Structure

```
test/
├── unit/                          # Unit tests (mirror source structure)
│   ├── gateway/                   # Gateway control plane tests
│   ├── channels/                  # Channel service tests
│   ├── daemon/                    # Daemon lifecycle tests
│   ├── policy/                    # Policy engine tests
│   ├── safety/                    # Safety mechanism tests
│   └── ...                        # Other module tests
├── integration/                   # Integration tests
│   ├── gateway-daemon.test.ts     # Gateway-Daemon communication
│   ├── desktop-control.test.ts    # Desktop automation workflow
│   ├── memory-system.test.ts      # Memory lifecycle and retrieval
│   └── training-pipeline.test.ts  # Training job management
├── regression/                    # Regression tests
│   ├── outbound-safety.test.ts    # Allowlist enforcement
│   ├── approval-fatigue.test.ts   # Approval mitigation
│   ├── mixed-mode.test.ts         # Work/chat mode handling
│   └── cross-domain-memory.test.ts # Memory domain isolation
├── adversarial/                   # Security/adversarial tests
│   ├── prompt-injection.test.ts   # Injection attack prevention
│   ├── privilege-escalation.test.ts # Privilege barrier detection
│   └── policy-tampering.test.ts   # Policy integrity verification
├── performance/                   # Performance benchmarks
│   ├── gateway-rpc-latency.test.ts # RPC latency measurement
│   ├── memory-recall.test.ts      # Memory retrieval precision
│   └── desktop-control-latency.test.ts # Desktop operation timing
├── e2e/                          # End-to-end tests
│   ├── user-workflows.test.ts     # Complete user workflows
│   └── error-recovery.test.ts     # Error recovery paths
├── fixtures/                      # Test fixtures and data
│   ├── policies/                  # Sample policy files
│   ├── memories/                  # Sample memory data
│   ├── evidence-bundles/          # Sample evidence bundles
│   └── configurations/            # Sample configurations
├── utils/                         # Test utilities
│   ├── test-helpers.ts            # Common test utilities
│   ├── mock-gateway.ts            # Gateway mocking utilities
│   └── mock-daemon.ts             # Daemon mocking utilities
├── config/                        # Test configuration
│   └── test.config.ts             # Test runner configuration
├── baselines/                     # Performance baselines
│   └── benchmarks.json            # Baseline performance metrics
└── README.md                      # This file
```

## Test Categories

### Unit Tests (`test/unit/`)

Unit tests verify individual functions, classes, and modules in isolation. They use mocks for external dependencies and focus on business logic and edge cases.

**Coverage Target**: Minimum 80% for core modules (gateway, channels, safety, policy)

**Example**:
```typescript
import { describe, test, expect, mock } from 'bun:test';
import { PolicyEngine } from '../../src/policy/engine';

describe('PolicyEngine', () => {
  test('should enforce risk tier classification', () => {
    const engine = new PolicyEngine();
    const result = engine.classifyRisk('outbound_send');
    expect(result.tier).toBe('THOROUGH');
  });
});
```

### Integration Tests (`test/integration/`)

Integration tests verify interactions between multiple components, testing real component interactions and end-to-end workflows.

**Key Areas**:
- Gateway-Daemon WebSocket communication
- Desktop control pipeline (UIA → fallback → evidence)
- Memory system lifecycle (pending → active → reflect)
- Training pipeline (VRAM budget → execution → checkpoint)

**Example**:
```typescript
import { describe, test, expect } from 'bun:test';

describe('Gateway-Daemon Integration', () => {
  test('should establish WebSocket connection', async () => {
    const gateway = await startGateway();
    const daemon = await startDaemon();
    
    await expect(daemon.connect()).resolves.toBeTruthy();
    expect(gateway.connections.size).toBe(1);
  });
});
```

### Regression Tests (`test/regression/`)

Regression tests prevent known issues from reoccurring. These tests cover critical paths and run on every commit.

**Critical Paths**:
- Outbound safety (allowlist enforcement)
- Approval fatigue mitigation
- Mixed mode handling (work/chat)
- Cross-domain memory writes

### Adversarial Tests (`test/adversarial/`)

Adversarial tests verify security mechanisms against attack scenarios.

**Attack Scenarios**:
- Prompt injection via web content
- Recipient spoofing
- Privilege escalation
- Policy file tampering
- Memory injection
- Rate limit bypass

### Performance Tests (`test/performance/`)

Performance tests measure key metrics and detect performance regressions.

**Key Metrics**:
- Gateway RPC latency (P50, P95, P99)
- Memory recall precision (Recall@K)
- Desktop control latency (P95 < 8s target)
- Training startup time
- VRAM utilization

Current implementation includes:
- `action-ledger-benchmark.test.ts`: baseline-aware regression check against `test/baselines/benchmarks.json`
- `performance-smoke.test.ts`: category smoke presence check

### End-to-End Tests (`test/e2e/`)

E2E tests simulate complete user workflows from start to finish.

**Key Workflows**:
- QQ/WeChat send workflow
- Image generation workflow
- Voice training workflow
- Memory management workflow
- Error recovery workflow

## Running Tests

### Run All Tests

```bash
bun test
```

### Run Specific Test Categories

```bash
# Unit tests only
bun test test/unit/

# Integration tests only
bun test test/integration/

# Regression tests only
bun test test/regression/

# Adversarial tests only
bun test test/adversarial/

# Performance tests only
bun test test/performance/

# Generate machine-readable and markdown audit snapshot
bun run audit:report

# Gateway UI component behavior tests (Vitest + jsdom)
bun run test:ui

# E2E tests only
bun test test/e2e/
```

### Run Specific Test Files

```bash
# Run a single test file
bun test test/unit/gateway/protocol.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "allowlist"
```

### Run Tests with Coverage

```bash
# Generate coverage report
bun test --coverage

# View coverage report
open coverage/index.html
```

### Run Tests in Watch Mode

```bash
# Watch mode for development
bun test --watch
```

### Run Integration Tests (Requires Runtime)

Some integration tests require the actual daemon runtime to be available. These tests are skipped by default and can be enabled with an environment variable:

```bash
# Enable runtime integration tests
MIYA_RUN_INTEGRATION=1 bun test test/integration/

# Or use the npm script
bun run test:integration
```

## Test Configuration

Test configuration is located in `test/config/test.config.ts`. Key settings include:

- **Timeout**: Default test timeout (30 seconds)
- **Retries**: Number of retries for flaky tests (0 by default)
- **Concurrency**: Maximum concurrent tests (1 for sequential execution)
- **Coverage**: Coverage thresholds and exclusions

## Writing Tests

### Test File Naming

- Unit tests: `*.test.ts` (co-located with source or in `test/unit/`)
- Integration tests: `*.integration.test.ts` (in `test/integration/`)
- Regression tests: `*.regression.test.ts` (in `test/regression/`)
- Performance tests: `*.perf.test.ts` (in `test/performance/`)

### Test Structure

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  test('should do something specific', () => {
    // Arrange
    const input = createTestInput();
    
    // Act
    const result = functionUnderTest(input);
    
    // Assert
    expect(result).toBe(expectedValue);
  });

  test('should handle edge case', () => {
    // Test edge cases
  });
});
```

### Using Test Utilities

```typescript
import { createMockGateway, createMockDaemon } from '../utils/mock-gateway';
import { generateTestPolicy } from '../utils/test-helpers';

test('should use test utilities', async () => {
  const gateway = createMockGateway();
  const policy = generateTestPolicy({ tier: 'THOROUGH' });
  
  // Use mocks in test
});
```

### Using Test Fixtures

Test fixtures provide realistic, reusable test data. See `fixtures/README.md` for complete documentation.

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

// Load a policy fixture
test('should use policy fixture', () => {
  const policyPath = path.join(__dirname, '../fixtures/policies/default.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
  
  expect(policy.version).toBe('1.0');
  expect(policy.riskTiers).toHaveProperty('THOROUGH');
});

// Load a memory fixture
test('should use memory fixture', () => {
  const memoryPath = path.join(__dirname, '../fixtures/memories/work-memory-sample.json');
  const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
  
  expect(memory.domain).toBe('work_memory');
  expect(memory.status).toBe('active');
});

// Load an evidence bundle fixture
test('should use evidence fixture', () => {
  const evidencePath = path.join(__dirname, '../fixtures/evidence-bundles/fs-write-evidence.json');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
  
  expect(evidence.capabilityDomain).toBe('fs_write');
  expect(evidence.semanticSummary).toBeDefined();
});
```

**Available Fixtures**:
- **Policies**: `default.json`, `strict.json`, `permissive.json`
- **Memories**: `work-memory-sample.json`, `relationship-memory-sample.json`, `episodic-memory-sample.json`, `pending-memory-sample.json`
- **Evidence Bundles**: `fs-write-evidence.json`, `shell-exec-evidence.json`, `desktop-control-evidence.json`, `outbound-send-evidence.json`, `memory-write-evidence.json`, `training-evidence.json`
- **Configurations**: `default-config.json`, `minimal-config.json`, `high-performance-config.json`

See `fixtures/README.md` for detailed documentation and usage examples.

## Best Practices

### 1. Test Isolation

Each test should be independent and not rely on the state from other tests.

```typescript
// Good: Each test creates its own data
test('test 1', () => {
  const data = createTestData();
  // test with data
});

test('test 2', () => {
  const data = createTestData();
  // test with data
});

// Bad: Tests share state
let sharedData;
test('test 1', () => {
  sharedData = createTestData();
});
test('test 2', () => {
  // uses sharedData from test 1
});
```

### 2. Descriptive Test Names

Test names should clearly describe what is being tested.

```typescript
// Good: Clear and specific
test('should reject outbound send when recipient not in allowlist', () => {});

// Bad: Vague
test('send test', () => {});
```

### 3. Arrange-Act-Assert Pattern

Structure tests with clear setup, execution, and verification phases.

```typescript
test('should calculate decay weight correctly', () => {
  // Arrange
  const memory = createMemory({ age: 30 });
  const lambda = 0.1;
  
  // Act
  const weight = calculateDecayWeight(memory, lambda);
  
  // Assert
  expect(weight).toBeCloseTo(0.05);
});
```

### 4. Test Edge Cases

Always test boundary conditions and error cases.

```typescript
describe('VRAM budget enforcement', () => {
  test('should allow model load when budget sufficient', () => {});
  test('should reject model load when budget insufficient', () => {});
  test('should handle zero budget', () => {});
  test('should handle negative budget', () => {});
  test('should handle exact budget match', () => {});
});
```

### 5. Use Mocks Appropriately

Mock external dependencies but test real logic.

```typescript
// Good: Mock external service, test real logic
test('should process data correctly', () => {
  const mockService = mock(() => Promise.resolve(mockData));
  const result = processData(mockService);
  expect(result).toBe(expectedResult);
});

// Bad: Mock everything, test nothing
test('should work', () => {
  const mockEverything = mock(() => true);
  expect(mockEverything()).toBe(true); // Not testing real logic
});
```

### 6. Clean Up Resources

Always clean up resources after tests.

```typescript
test('should clean up resources', async () => {
  const tempDir = createTempDir();
  try {
    // Test logic
  } finally {
    // Always clean up
    fs.rmSync(tempDir, { recursive: true });
  }
});
```

## Continuous Integration

Tests run automatically on every push and pull request via GitHub Actions. The CI pipeline includes:

1. **Linting**: Code style and quality checks (Biome)
2. **Contract Checks**: Hook contract validation
3. **Documentation Lint**: Documentation consistency checks
4. **Unit Tests**: Fast unit test execution (< 5s per test)
5. **Integration Tests**: Component interaction tests (requires daemon)
6. **Regression Tests**: Critical path verification
7. **Adversarial Tests**: Security validation (not yet implemented)
8. **Performance Tests**: Performance regression detection (not yet implemented)
9. **Coverage Report**: Code coverage analysis (70% global, 80% core)
10. **Artifact Upload**: Coverage reports and test results (30-day retention)
11. **PR Comments**: Automatic coverage metrics on pull requests

### CI Workflow

**Location**: `.github/workflows/miya-ci.yml`

**Triggers**:
- Push to `main`, `master`, or `miya/**` branches
- Pull requests to any branch

**Artifacts**:
- `coverage-report`: HTML coverage report and JSON summary
- `test-results`: Test execution reports and performance baselines

**See Also**: [CI/CD Integration Guide](./CI_CD_GUIDE.md) for detailed documentation.

### Running CI Checks Locally

Before pushing, run the same checks that CI will run:

```bash
# Run all CI checks
bun run check:ci

# Run tests with coverage
bun run test:coverage

# Run specific test categories
bun run test:unit
bun run test:integration
bun run test:regression
```

## Debugging Tests

### Run Tests with Verbose Output

```bash
bun test --verbose
```

### Run Single Test in Debug Mode

```bash
# Add debugger statement in test
test('debug this', () => {
  debugger;
  // test code
});

# Run with inspector
bun --inspect test test/unit/my-test.test.ts
```

### View Test Logs

```bash
# Enable debug logging
DEBUG=miya:* bun test
```

## Performance Baselines

Performance baselines are stored in `test/baselines/benchmarks.json`. To update baselines:

```bash
# Run performance tests and refresh baselines
MIYA_UPDATE_BASELINES=1 bun test test/performance/
```

## Troubleshooting

### Tests Fail Locally But Pass in CI

- Check environment variables
- Verify Node.js/Bun version matches CI
- Check for timing-dependent tests
- Verify test isolation

### Tests Are Flaky

- Add proper waits for async operations
- Increase timeouts if needed
- Check for race conditions
- Ensure proper cleanup

### Coverage Is Low

- Identify untested code with coverage report
- Add unit tests for uncovered functions
- Add integration tests for workflows
- Remove dead code

## Contributing

When adding new features:

1. Write tests first (TDD approach recommended)
2. Ensure tests pass locally
3. Verify coverage meets threshold (80%+)
4. Update this README if adding new test categories
5. Add test fixtures if needed

## Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Miya Plugin Documentation](../README.md)
- [Design Document](../.kiro/specs/miya-plugin-audit/design.md)
- [Requirements Document](../.kiro/specs/miya-plugin-audit/requirements.md)

## Support

For questions or issues with tests:

1. Check existing test examples in this directory
2. Review the design and requirements documents
3. Open an issue on GitHub
4. Contact the maintainers

---

**Last Updated**: 2025-01-XX  
**Test Framework**: Bun Test  
**Coverage Target**: 80%+ for core modules  
**Total Requirements**: 160 (see requirements.md)
