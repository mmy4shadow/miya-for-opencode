# Design Document: Miya Plugin Audit and Testing System

## Introduction

This document defines the design for a comprehensive audit and testing system for the Miya plugin. The system will systematically verify all 160 requirements defined in requirements.md, ensuring that the Miya plugin is fully functional, secure, reliable, and user-friendly.

## Design Goals

1. **Comprehensive Coverage**: Test all 160 requirements without exception
2. **Systematic Organization**: Organize tests in a unified `test/` directory structure
3. **Automated Execution**: Enable automated test execution in CI/CD pipeline
4. **Clear Reporting**: Generate detailed audit reports with actionable findings
5. **Maintainability**: Design tests that are easy to understand and maintain

## System Architecture

### Test Organization Structure

All tests will be organized in a unified `test/` directory at the repository root:

```
test/
├── unit/                          # Unit tests (mirror source structure)
│   ├── gateway/
│   │   ├── protocol.test.ts
│   │   ├── methods/
│   │   │   ├── channels.test.ts
│   │   │   ├── security.test.ts
│   │   │   ├── nodes.test.ts
│   │   │   ├── companion.test.ts
│   │   │   └── memory.test.ts
│   │   └── index.test.ts
│   ├── channels/
│   │   ├── service.test.ts
│   │   └── policy.test.ts
│   ├── daemon/
│   │   ├── launcher.test.ts
│   │   └── host.test.ts
│   └── ...
├── integration/                   # Integration tests
│   ├── gateway-daemon.test.ts
│   ├── desktop-control.test.ts
│   ├── memory-system.test.ts
│   └── training-pipeline.test.ts
├── regression/                    # Regression tests
│   ├── outbound-safety.test.ts
│   ├── approval-fatigue.test.ts
│   ├── mixed-mode.test.ts
│   └── cross-domain-memory.test.ts
├── adversarial/                   # Security/adversarial tests
│   ├── prompt-injection.test.ts
│   ├── privilege-escalation.test.ts
│   └── policy-tampering.test.ts
├── performance/                   # Performance benchmarks
│   ├── gateway-rpc-latency.test.ts
│   ├── memory-recall.test.ts
│   └── desktop-control-latency.test.ts
├── e2e/                          # End-to-end tests
│   ├── user-workflows.test.ts
│   └── error-recovery.test.ts
├── fixtures/                      # Test fixtures and data
│   ├── policies/
│   ├── memories/
│   └── evidence-bundles/
├── utils/                         # Test utilities
│   ├── test-helpers.ts
│   ├── mock-gateway.ts
│   └── mock-daemon.ts
├── config/                        # Test configuration
│   └── test.config.ts
├── coverage/                      # Coverage reports (generated)
├── baselines/                     # Performance baselines
│   └── benchmarks.json
└── README.md                      # Test execution guide
```

### Test Categories and Mapping

Each requirement category maps to specific test types:

| Requirement Category | Test Type | Location |
|---------------------|-----------|----------|
| Architecture (Req 1, 13-15) | Integration | `test/integration/` |
| Security (Req 2, 11, 19-20, 96-99) | Adversarial | `test/adversarial/` |
| Functionality (Req 3, 61-80) | Integration + Unit | `test/integration/`, `test/unit/` |
| Performance (Req 4, 10, 40, 119, 160) | Performance | `test/performance/` |
| Code Quality (Req 5, 82-85, 140) | Unit + Static Analysis | `test/unit/` + linters |
| User Experience (Req 6, 101-120) | E2E | `test/e2e/` |
| Placeholder Detection (Req 31, 82-84) | Static Analysis | Custom audit tool |
| Partial Implementation (Req 32, 85-94) | Integration | `test/integration/` |
| Ineffective Implementation (Req 33, 95-100) | Integration | `test/integration/` |
| State Consistency (Req 121, 131-132, 152) | Integration | `test/integration/` |
| Resource Management (Req 123, 138, 150) | Integration | `test/integration/` |

## Testing Strategy

### 1. Unit Testing Strategy

**Scope**: Test individual functions, classes, and modules in isolation

**Approach**:
- Use Bun's built-in test runner
- Mock external dependencies
- Focus on business logic and edge cases
- Achieve minimum 80% code coverage for core modules

**Example Test Structure**:
```typescript
import { describe, test, expect, mock } from 'bun:test';
import { GatewayMethodRegistry } from '../src/gateway/protocol';

describe('GatewayMethodRegistry', () => {
  test('should register method successfully', () => {
    const registry = new GatewayMethodRegistry();
    const handler = mock(() => Promise.resolve({ success: true }));
    
    registry.register('test.method', handler);
    
    expect(registry.has('test.method')).toBe(true);
  });
  
  test('should enforce max in-flight limit', async () => {
    const registry = new GatewayMethodRegistry({ maxInFlight: 1 });
    // Test implementation
  });
});
```

### 2. Integration Testing Strategy

**Scope**: Test interactions between multiple components

**Approach**:
- Test real component interactions
- Use test fixtures for data
- Verify end-to-end workflows
- Test error propagation and recovery

**Key Integration Tests**:
1. **Gateway-Daemon Communication**: Verify WebSocket RPC protocol
2. **Desktop Control Pipeline**: Verify UIA → fallback → evidence chain
3. **Memory System**: Verify pending → active → reflect lifecycle
4. **Training Pipeline**: Verify VRAM budget → execution → checkpoint

### 3. Regression Testing Strategy

**Scope**: Prevent known issues from reoccurring

**Approach**:
- Maintain regression test suite for critical paths
- Run on every commit
- Block merge if regression tests fail

**Critical Regression Tests**:
1. Outbound safety (allowlist enforcement)
2. Approval fatigue mitigation
3. Mixed mode handling
4. Cross-domain memory writes

### 4. Adversarial Testing Strategy

**Scope**: Test security mechanisms against attacks

**Approach**:
- Simulate attack scenarios
- Verify security controls cannot be bypassed
- Test input validation and sanitization

**Attack Scenarios**:
1. Prompt injection via web content
2. Recipient spoofing
3. Privilege escalation
4. Policy file tampering
5. Memory injection
6. Rate limit bypass

### 5. Performance Testing Strategy

**Scope**: Verify performance meets requirements

**Approach**:
- Establish performance baselines
- Measure key metrics (latency, throughput, resource usage)
- Detect performance regressions
- Generate performance reports

**Key Performance Metrics**:
1. Gateway RPC latency (P50, P95, P99)
2. Memory recall precision (Recall@K)
3. Desktop control latency (P95 < 8s)
4. Training startup time
5. VRAM utilization

### 6. End-to-End Testing Strategy

**Scope**: Test complete user workflows

**Approach**:
- Simulate real user interactions
- Verify workflows from start to finish
- Test error recovery paths
- Validate user feedback loops

**Key User Workflows**:
1. QQ/WeChat send workflow
2. Image generation workflow
3. Voice training workflow
4. Memory management workflow
5. Error recovery workflow

## Correctness Properties

### Property 1: Allowlist Enforcement (Security)

**Property**: All outbound sends must verify recipient against allowlist before execution

**Verification Strategy**:
- Unit test: Verify allowlist check function
- Integration test: Verify check is called before send
- Adversarial test: Attempt bypass via various methods

**Test Implementation**:
```typescript
test('Property 1: Allowlist enforcement', async () => {
  // Setup: Create send request with non-allowlisted recipient
  const request = {
    recipient: 'not-in-allowlist@example.com',
    message: 'test message'
  };
  
  // Execute: Attempt send
  const result = await attemptSend(request);
  
  // Verify: Send is blocked
  expect(result.success).toBe(false);
  expect(result.reason).toContain('recipient_not_in_allowlist');
  
  // Verify: Kill-Switch is triggered
  const killSwitchStatus = await getKillSwitchStatus('outbound_send');
  expect(killSwitchStatus).toBe('triggered');
});
```

### Property 2: VRAM Budget Enforcement (Resource Management)

**Property**: No model loading shall proceed if VRAM budget is insufficient

**Verification Strategy**:
- Unit test: Verify VRAM budget calculation
- Integration test: Verify budget check before model load
- Performance test: Verify actual VRAM usage matches budget

**Test Implementation**:
```typescript
test('Property 2: VRAM budget enforcement', async () => {
  // Setup: Set VRAM budget to low value
  await setVRAMBudget(2048); // 2GB
  
  // Execute: Attempt to load large model
  const result = await loadModel('flux-large', { estimatedVRAM: 4096 });
  
  // Verify: Load is blocked
  expect(result.success).toBe(false);
  expect(result.reason).toContain('insufficient_vram');
  
  // Verify: Downgrade is offered
  expect(result.alternatives).toContain('flux-small');
});
```

### Property 3: Evidence Bundle Completeness (Audit)

**Property**: All state-changing operations must generate complete evidence bundles

**Verification Strategy**:
- Unit test: Verify evidence bundle structure
- Integration test: Verify evidence is generated for all operations
- Audit test: Verify evidence contains all required fields

**Test Implementation**:
```typescript
test('Property 3: Evidence bundle completeness', async () => {
  // Execute: Perform state-changing operation
  const result = await executeOperation('fs_write', {
    path: '/test/file.txt',
    content: 'test content'
  });
  
  // Verify: Evidence bundle is generated
  expect(result.evidenceBundle).toBeDefined();
  
  // Verify: Required fields are present
  const evidence = result.evidenceBundle;
  expect(evidence.auditId).toBeDefined();
  expect(evidence.policyHash).toBeDefined();
  expect(evidence.capabilityDomain).toBe('fs_write');
  expect(evidence.semanticSummary).toBeDefined();
  expect(evidence.gitDiff).toBeDefined(); // fs_write specific
});
```

### Property 4: Kill-Switch Effectiveness (Safety)

**Property**: When Kill-Switch is triggered, capability domain must immediately halt

**Verification Strategy**:
- Unit test: Verify Kill-Switch state management
- Integration test: Verify operations are blocked after trigger
- Timing test: Verify halt occurs within acceptable time

**Test Implementation**:
```typescript
test('Property 4: Kill-Switch effectiveness', async () => {
  // Setup: Start operation
  const operation = startLongRunningOperation('desktop_control');
  
  // Execute: Trigger Kill-Switch
  await triggerKillSwitch('desktop_control', 'test_trigger');
  
  // Verify: Operation is halted within 2 seconds
  await sleep(2000);
  const status = await getOperationStatus(operation.id);
  expect(status).toBe('halted');
  
  // Verify: New operations are blocked
  const newOp = await attemptOperation('desktop_control');
  expect(newOp.success).toBe(false);
  expect(newOp.reason).toContain('kill_switch_active');
});
```

### Property 5: Memory Decay Application (Memory System)

**Property**: Memory decay weights must be applied during retrieval

**Verification Strategy**:
- Unit test: Verify decay calculation
- Integration test: Verify decay affects retrieval ranking
- Performance test: Verify old memories rank lower

**Test Implementation**:
```typescript
test('Property 5: Memory decay application', async () => {
  // Setup: Create memories with different ages
  const oldMemory = await createMemory('old fact', { age: 30 }); // 30 days old
  const newMemory = await createMemory('new fact', { age: 1 });  // 1 day old
  
  // Execute: Retrieve memories
  const results = await retrieveMemories('fact');
  
  // Verify: New memory ranks higher than old memory
  const oldRank = results.findIndex(m => m.id === oldMemory.id);
  const newRank = results.findIndex(m => m.id === newMemory.id);
  expect(newRank).toBeLessThan(oldRank);
  
  // Verify: Decay weight is applied
  const oldScore = results[oldRank].score;
  const newScore = results[newRank].score;
  expect(oldScore).toBeLessThan(newScore);
});
```

## Test Execution Plan

### Phase 1: Test Infrastructure Setup (Week 1)

**Tasks**:
1. Create unified `test/` directory structure
2. Migrate existing tests to new structure
3. Set up test configuration and utilities
4. Create test fixtures and mock data
5. Configure test runner and coverage tools

**Deliverables**:
- Complete `test/` directory structure
- Test utilities and helpers
- Test configuration files
- CI/CD integration

### Phase 2: Unit Test Implementation (Week 2-3)

**Tasks**:
1. Implement unit tests for Gateway methods (Req 85)
2. Implement unit tests for configuration system (Req 83)
3. Implement unit tests for event handlers (Req 84)
4. Implement unit tests for memory system
5. Implement unit tests for policy engine

**Deliverables**:
- 80%+ code coverage for core modules
- Unit test suite passing

### Phase 3: Integration Test Implementation (Week 4-5)

**Tasks**:
1. Implement Gateway-Daemon integration tests
2. Implement desktop control integration tests
3. Implement memory system integration tests
4. Implement training pipeline integration tests
5. Implement approval system integration tests

**Deliverables**:
- Integration test suite covering all major workflows
- Integration tests passing

### Phase 4: Security and Adversarial Testing (Week 6)

**Tasks**:
1. Implement prompt injection tests
2. Implement privilege escalation tests
3. Implement policy tampering tests
4. Implement allowlist bypass tests
5. Implement rate limit bypass tests

**Deliverables**:
- Adversarial test suite
- Security vulnerability report

### Phase 5: Performance and E2E Testing (Week 7)

**Tasks**:
1. Establish performance baselines
2. Implement performance benchmark tests
3. Implement end-to-end user workflow tests
4. Implement error recovery tests
5. Generate performance reports

**Deliverables**:
- Performance benchmark suite
- E2E test suite
- Performance baseline data

### Phase 6: Audit and Reporting (Week 8)

**Tasks**:
1. Run complete test suite
2. Generate audit reports
3. Identify and document issues
4. Prioritize issues (P0/P1/P2)
5. Create remediation plan

**Deliverables**:
- Complete audit report
- Issue priority matrix
- Remediation plan

## Audit Report Structure

The audit report will include:

### 1. Executive Summary
- Overall pass/fail status
- Critical findings (P0)
- High-priority findings (P1)
- Medium-priority findings (P2)
- Recommendations

### 2. Requirement Coverage Matrix
- 160 requirements with pass/fail status
- Evidence for each requirement
- Issues found per requirement

### 3. Test Results Summary
- Total tests run
- Tests passed/failed
- Code coverage percentage
- Performance metrics

### 4. Detailed Findings
- Issue description
- Severity (P0/P1/P2)
- Affected requirements
- Evidence (logs, screenshots, traces)
- Reproduction steps
- Recommended fix

### 5. Performance Analysis
- Latency measurements
- Resource usage
- Bottleneck identification
- Optimization recommendations

### 6. Security Assessment
- Vulnerabilities found
- Attack scenarios tested
- Security controls verified
- Remediation recommendations

## Static Analysis Tools

### 1. Placeholder Function Scanner

**Purpose**: Detect functions that have no real effect (Req 82)

**Implementation**:
```typescript
// Scan for placeholder patterns
const placeholderPatterns = [
  /return\s+true;?\s*$/,           // Only returns true
  /return\s+false;?\s*$/,          // Only returns false
  /console\.log\([^)]*\);?\s*$/,   // Only logs
  /throw\s+new\s+Error\(['"]Not implemented['"]\)/, // Not implemented
  /return\s+\{[^}]*mock[^}]*\}/,   // Returns mock data
];

function scanForPlaceholders(sourceFile: string): PlaceholderReport {
  // Implementation
}
```

### 2. Configuration Effectiveness Analyzer

**Purpose**: Detect unused configuration options (Req 83)

**Implementation**:
```typescript
// Track configuration reads
const configReads = new Set<string>();

// Scan for config definitions
const configDefinitions = scanConfigSchema();

// Find unused configs
const unusedConfigs = configDefinitions.filter(
  key => !configReads.has(key)
);
```

### 3. Dead Code Detector

**Purpose**: Identify dead code and unused features (Req 140)

**Implementation**:
```typescript
// Build call graph
const callGraph = buildCallGraph(sourceFiles);

// Find unreachable functions
const deadFunctions = findUnreachableFunctions(callGraph);

// Find unused exports
const unusedExports = findUnusedExports(sourceFiles);
```

## Continuous Integration

### CI Pipeline

```yaml
name: Miya Audit and Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
      
      - name: Run linters
        run: bun run lint
      
      - name: Run unit tests
        run: bun test test/unit/
      
      - name: Run integration tests
        run: bun test test/integration/
      
      - name: Run regression tests
        run: bun test test/regression/
      
      - name: Run adversarial tests
        run: bun test test/adversarial/
      
      - name: Run performance tests
        run: bun test test/performance/
      
      - name: Generate coverage report
        run: bun run coverage
      
      - name: Run static analysis
        run: bun run audit:static
      
      - name: Generate audit report
        run: bun run audit:report
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: audit-report
          path: test/reports/
```

## Success Criteria

The audit is considered successful when:

1. **All 160 requirements have test coverage**: Each requirement must have at least one test verifying it
2. **All tests pass**: No failing tests in any category
3. **Code coverage >= 80%**: For core modules (gateway, channels, safety, policy)
4. **No P0 issues**: All critical issues must be resolved
5. **Performance meets targets**: All performance metrics within acceptable ranges
6. **Security controls verified**: All security mechanisms tested and working
7. **Audit report generated**: Complete report with findings and recommendations

## Risk Mitigation

### Risk 1: Test Coverage Gaps

**Mitigation**:
- Use coverage tools to identify untested code
- Review requirements regularly to ensure all are covered
- Implement traceability matrix (requirement → test)

### Risk 2: Flaky Tests

**Mitigation**:
- Use deterministic test data
- Implement proper test isolation
- Add retry logic for timing-sensitive tests
- Use test fixtures instead of real external services

### Risk 3: Long Test Execution Time

**Mitigation**:
- Parallelize test execution
- Use test categorization (unit/integration/e2e)
- Run fast tests first, slow tests later
- Cache test results when possible

### Risk 4: False Positives in Static Analysis

**Mitigation**:
- Tune static analysis rules
- Implement whitelist for known false positives
- Manual review of flagged issues
- Continuous refinement of detection patterns

## Conclusion

This design provides a comprehensive framework for auditing and testing the Miya plugin. By systematically verifying all 160 requirements through multiple testing strategies, we will ensure that the Miya plugin is fully functional, secure, reliable, and user-friendly.

The unified test organization, clear testing strategies, and automated execution will enable continuous quality assurance and rapid identification of issues. The detailed audit reports will provide actionable insights for improvement and ensure that no critical issues are overlooked.
