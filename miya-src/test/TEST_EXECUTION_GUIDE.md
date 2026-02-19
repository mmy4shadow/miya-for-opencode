# Test Execution Guide

This guide provides detailed instructions for running tests in the Miya plugin test suite.

## Quick Start

```bash
# Run all tests
bun test

# Run tests with coverage
bun run test:coverage

# Run specific test category
bun run test:unit
bun run test:integration
bun run test:regression
```

## Test Scripts

### Basic Test Execution

| Script | Command | Description |
|--------|---------|-------------|
| `test` | `bun test` | Run all tests with default timeout (30s) |
| `test:unit` | `bun run test:unit` | Run unit tests only (5s timeout) |
| `test:integration` | `bun run test:integration` | Run integration tests (30s timeout, requires daemon) |
| `test:regression` | `bun run test:regression` | Run regression tests (30s timeout) |
| `test:adversarial` | `bun run test:adversarial` | Run security/adversarial tests (30s timeout) |
| `test:performance` | `bun run test:performance` | Run performance benchmarks (60s timeout) |
| `test:e2e` | `bun run test:e2e` | Run end-to-end tests (60s timeout) |

### Coverage and Reporting

| Script | Command | Description |
|--------|---------|-------------|
| `test:coverage` | `bun run test:coverage` | Run tests with HTML and text coverage reports |
| `test:coverage:core` | `bun run test:coverage:core` | Run coverage for core modules only (gateway, channels, safety, policy) |
| `test:ci` | `bun run test:ci` | Run tests in CI mode with text coverage output |

### Development

| Script | Command | Description |
|--------|---------|-------------|
| `test:watch` | `bun run test:watch` | Run tests in watch mode for development |

## Test Configuration

Test configuration is defined in `test/config/test.config.ts` and `bunfig.toml`.

### Default Settings

- **Timeout**: 30 seconds (default), varies by test category
- **Retries**: 0 (tests should be deterministic)
- **Concurrency**: Sequential execution (concurrency=1)
- **Coverage Threshold**: 70% global, 80% for core modules

### Environment Variables

Override test configuration using environment variables:

```bash
# Set custom timeout (milliseconds)
TEST_TIMEOUT=60000 bun test

# Set number of retries
TEST_RETRIES=2 bun test

# Set concurrency level
TEST_CONCURRENCY=4 bun test

# Enable verbose output
TEST_VERBOSE=1 bun test

# Enable fail-fast mode
TEST_FAIL_FAST=1 bun test

# Enable watch mode
TEST_WATCH=1 bun test

# Enable integration tests (requires daemon)
MIYA_RUN_INTEGRATION=1 bun run test:integration
```

### Combining Options

```bash
# Run unit tests with verbose output and custom timeout
TEST_VERBOSE=1 TEST_TIMEOUT=10000 bun run test:unit

# Run integration tests with retries
TEST_RETRIES=2 MIYA_RUN_INTEGRATION=1 bun run test:integration

# Run all tests with fail-fast and coverage
TEST_FAIL_FAST=1 bun run test:coverage
```

## Test Categories

### Unit Tests (`test/unit/`)

**Purpose**: Test individual functions, classes, and modules in isolation

**Timeout**: 5 seconds

**Coverage Target**: 80% for core modules

**Example**:
```bash
# Run all unit tests
bun run test:unit

# Run specific unit test file
bun test test/unit/gateway/protocol.test.ts

# Run unit tests with coverage
bun test test/unit/ --coverage
```

### Integration Tests (`test/integration/`)

**Purpose**: Test interactions between multiple components

**Timeout**: 30 seconds

**Requirements**: Some tests require daemon runtime (set `MIYA_RUN_INTEGRATION=1`)

**Example**:
```bash
# Run integration tests (daemon required)
MIYA_RUN_INTEGRATION=1 bun run test:integration

# Run specific integration test
bun test test/integration/gateway-daemon.test.ts

# Skip runtime-dependent tests
bun test test/integration/
```

### Regression Tests (`test/regression/`)

**Purpose**: Prevent known issues from reoccurring

**Timeout**: 30 seconds

**Critical Paths**: Outbound safety, approval fatigue, mixed mode, cross-domain memory

**Example**:
```bash
# Run all regression tests
bun run test:regression

# Run specific regression test
bun test test/regression/outbound-safety.test.ts
```

### Adversarial Tests (`test/adversarial/`)

**Purpose**: Test security mechanisms against attack scenarios

**Timeout**: 30 seconds

**Attack Scenarios**: Prompt injection, privilege escalation, policy tampering, etc.

**Example**:
```bash
# Run all adversarial tests
bun run test:adversarial

# Run specific adversarial test
bun test test/adversarial/prompt-injection.test.ts
```

### Performance Tests (`test/performance/`)

**Purpose**: Measure performance metrics and detect regressions

**Timeout**: 60 seconds

**Metrics**: RPC latency, memory recall, desktop control latency, VRAM utilization

**Example**:
```bash
# Run all performance tests
bun run test:performance

# Run specific performance test
bun test test/performance/gateway-rpc-latency.test.ts

# Update performance baselines
bun test test/performance/ --update-baselines
```

### End-to-End Tests (`test/e2e/`)

**Purpose**: Test complete user workflows from start to finish

**Timeout**: 60 seconds

**Workflows**: QQ/WeChat send, image generation, voice training, memory management

**Example**:
```bash
# Run all E2E tests
bun run test:e2e

# Run specific E2E test
bun test test/e2e/user-workflows.test.ts
```

## Coverage Reports

### Generate Coverage Reports

```bash
# Generate HTML and text coverage reports
bun run test:coverage

# View HTML coverage report (opens in browser)
open coverage/index.html  # macOS
start coverage/index.html # Windows
xdg-open coverage/index.html # Linux
```

### Coverage Thresholds

- **Global**: 70% minimum
- **Core Modules** (gateway, channels, safety, policy): 80% minimum
- **Per-File**: 70% statements, 60% branches, 70% functions, 70% lines

### Check Core Module Coverage

```bash
# Run coverage for core modules only
bun run test:coverage:core
```

## Continuous Integration

### CI Test Execution

```bash
# Run tests in CI mode
bun run test:ci

# This runs:
# - All tests with 30s timeout
# - Coverage reporting (text format)
# - No watch mode
# - Fail on coverage threshold violations
```

### Pre-Commit Checks

```bash
# Run all checks before committing
bun run check:ci

# This runs:
# - Contract checks
# - Doc linting
# - Regression gate checks
# - Biome linting
```

## Debugging Tests

### Run Single Test

```bash
# Run a single test file
bun test test/unit/gateway/protocol.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "allowlist"
```

### Verbose Output

```bash
# Enable verbose output
TEST_VERBOSE=1 bun test

# Or use Bun's built-in verbose flag
bun test --verbose
```

### Debug Mode

```bash
# Run with debugger
bun --inspect test test/unit/my-test.test.ts

# Add debugger statement in test
test('debug this', () => {
  debugger;
  // test code
});
```

### View Test Logs

```bash
# Enable debug logging
DEBUG=miya:* bun test

# Or set specific log level
LOG_LEVEL=debug bun test
```

## Troubleshooting

### Tests Fail Locally But Pass in CI

**Possible Causes**:
- Environment variable differences
- Node.js/Bun version mismatch
- Timing-dependent tests
- Test isolation issues

**Solutions**:
```bash
# Check Bun version
bun --version

# Clear test cache
rm -rf node_modules/.cache

# Run tests with same settings as CI
bun run test:ci
```

### Tests Are Flaky

**Possible Causes**:
- Race conditions
- Insufficient timeouts
- Improper cleanup
- Shared state between tests

**Solutions**:
```bash
# Increase timeout
TEST_TIMEOUT=60000 bun test

# Add retries
TEST_RETRIES=2 bun test

# Run tests sequentially
bun test --max-concurrency=1
```

### Coverage Is Low

**Solutions**:
```bash
# Generate coverage report to identify gaps
bun run test:coverage

# View HTML report
open coverage/index.html

# Focus on core modules
bun run test:coverage:core
```

### Integration Tests Fail

**Possible Causes**:
- Daemon not running
- WebSocket connection issues
- Resource conflicts

**Solutions**:
```bash
# Ensure daemon is available
MIYA_RUN_INTEGRATION=1 bun run test:integration

# Check daemon logs
tail -f daemon/host.stdout.log

# Run integration tests with verbose output
TEST_VERBOSE=1 MIYA_RUN_INTEGRATION=1 bun run test:integration
```

## Performance Baselines

### View Current Baselines

```bash
# View baseline file
cat test/baselines/benchmarks.json
```

### Update Baselines

```bash
# Run performance tests and update baselines
bun test test/performance/ --update-baselines

# Or use the baseline refresh script
bun run baseline:refresh
```

### Compare Against Baselines

```bash
# Run performance tests (automatically compares against baselines)
bun run test:performance

# Tests will fail if performance degrades by more than 10%
```

## Best Practices

### 1. Run Tests Before Committing

```bash
# Run all checks
bun run check:ci

# Run tests with coverage
bun run test:coverage
```

### 2. Use Watch Mode During Development

```bash
# Run tests in watch mode
bun run test:watch

# Or with specific category
bun test test/unit/ --watch
```

### 3. Test Isolation

- Each test should be independent
- Use `beforeEach` and `afterEach` for setup/cleanup
- Don't rely on test execution order

### 4. Descriptive Test Names

```typescript
// Good: Clear and specific
test('should reject outbound send when recipient not in allowlist', () => {});

// Bad: Vague
test('send test', () => {});
```

### 5. Coverage Goals

- Aim for 80%+ coverage on core modules
- Focus on business logic, not boilerplate
- Test edge cases and error paths

## Additional Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Test Configuration](./config/test.config.ts)
- [Test README](./README.md)
- [Design Document](../.kiro/specs/miya-plugin-audit/design.md)
- [Requirements Document](../.kiro/specs/miya-plugin-audit/requirements.md)

## Support

For questions or issues:

1. Check this guide and the test README
2. Review existing test examples
3. Check the design and requirements documents
4. Open an issue on GitHub
5. Contact the maintainers

---

**Last Updated**: 2025-01-XX  
**Test Framework**: Bun Test v1.3.9+  
**Coverage Target**: 70% global, 80% core modules
