# Test Execution Guide

This guide provides detailed instructions for running tests in the Miya plugin test suite.

## Quick Start

```bash
# Run all tests
npx vitest run

# Run tests with coverage
npm run test:coverage

# Run specific test category
npm run test:unit
npm run test:integration
npm run test:regression
```

## Test Scripts

### Basic Test Execution

| Script | Command | Description |
|--------|---------|-------------|
| `test` | `npx vitest run` | Run all tests with default timeout (30s) |
| `test:unit` | `npm run test:unit` | Run unit tests only (5s timeout) |
| `test:integration` | `npm run test:integration` | Run integration tests (30s timeout, requires daemon) |
| `test:regression` | `npm run test:regression` | Run regression tests (30s timeout) |
| `test:adversarial` | `npm run test:adversarial` | Run security/adversarial tests (30s timeout) |
| `test:performance` | `npm run test:performance` | Run performance benchmarks (60s timeout) |
| `test:e2e` | `npm run test:e2e` | Run end-to-end tests (60s timeout) |

### Coverage and Reporting

| Script | Command | Description |
|--------|---------|-------------|
| `test:coverage` | `npm run test:coverage` | Run tests with HTML and text coverage reports |
| `test:coverage:core` | `npm run test:coverage:core` | Run coverage for core modules only (gateway, channels, safety, policy) |
| `test:ci` | `npm run test:ci` | Run tests in CI mode with text coverage output |

### Development

| Script | Command | Description |
|--------|---------|-------------|
| `test:watch` | `npm run test:watch` | Run tests in watch mode for development |

## Test Configuration

Test configuration is defined in `test/config/test.config.ts` and `vitest configuration`.

### Default Settings

- **Timeout**: 30 seconds (default), varies by test category
- **Retries**: 0 (tests should be deterministic)
- **Concurrency**: Sequential execution (concurrency=1)
- **Coverage Threshold**: 70% global, 80% for core modules

### Environment Variables

Override test configuration using environment variables:

```bash
# Set custom timeout (milliseconds)
TEST_TIMEOUT=60000 npx vitest run

# Set number of retries
TEST_RETRIES=2 npx vitest run

# Set concurrency level
TEST_CONCURRENCY=4 npx vitest run

# Enable verbose output
TEST_VERBOSE=1 npx vitest run

# Enable fail-fast mode
TEST_FAIL_FAST=1 npx vitest run

# Enable watch mode
TEST_WATCH=1 npx vitest run

# Enable integration tests (requires daemon)
MIYA_RUN_INTEGRATION=1 npm run test:integration
```

### Combining Options

```bash
# Run unit tests with verbose output and custom timeout
TEST_VERBOSE=1 TEST_TIMEOUT=10000 npm run test:unit

# Run integration tests with retries
TEST_RETRIES=2 MIYA_RUN_INTEGRATION=1 npm run test:integration

# Run all tests with fail-fast and coverage
TEST_FAIL_FAST=1 npm run test:coverage
```

## Test Categories

### Unit Tests (`test/unit/`)

**Purpose**: Test individual functions, classes, and modules in isolation

**Timeout**: 5 seconds

**Coverage Target**: 80% for core modules

**Example**:
```bash
# Run all unit tests
npm run test:unit

# Run specific unit test file
npx vitest run test/unit/gateway/protocol.test.ts

# Run unit tests with coverage
npx vitest run test/unit/ --coverage
```

### Integration Tests (`test/integration/`)

**Purpose**: Test interactions between multiple components

**Timeout**: 30 seconds

**Requirements**: Some tests require daemon runtime (set `MIYA_RUN_INTEGRATION=1`)

**Example**:
```bash
# Run integration tests (daemon required)
MIYA_RUN_INTEGRATION=1 npm run test:integration

# Run specific integration test
npx vitest run test/integration/gateway-daemon.test.ts

# Skip runtime-dependent tests
npx vitest run test/integration/
```

### Regression Tests (`test/regression/`)

**Purpose**: Prevent known issues from reoccurring

**Timeout**: 30 seconds

**Critical Paths**: Outbound safety, approval fatigue, mixed mode, cross-domain memory

**Example**:
```bash
# Run all regression tests
npm run test:regression

# Run specific regression test
npx vitest run test/regression/outbound-safety.test.ts
```

### Adversarial Tests (`test/adversarial/`)

**Purpose**: Test security mechanisms against attack scenarios

**Timeout**: 30 seconds

**Attack Scenarios**: Prompt injection, privilege escalation, policy tampering, etc.

**Example**:
```bash
# Run all adversarial tests
npm run test:adversarial

# Run specific adversarial test
npx vitest run test/adversarial/prompt-injection.test.ts
```

### Performance Tests (`test/performance/`)

**Purpose**: Measure performance metrics and detect regressions

**Timeout**: 60 seconds

**Metrics**: RPC latency, memory recall, desktop control latency, VRAM utilization

**Example**:
```bash
# Run all performance tests
npm run test:performance

# Run specific performance test
npx vitest run test/performance/gateway-rpc-latency.test.ts

# Update performance baselines
npx vitest run test/performance/ --update-baselines
```

### End-to-End Tests (`test/e2e/`)

**Purpose**: Test complete user workflows from start to finish

**Timeout**: 60 seconds

**Workflows**: QQ/WeChat send, image generation, voice training, memory management

**Example**:
```bash
# Run all E2E tests
npm run test:e2e

# Run specific E2E test
npx vitest run test/e2e/user-workflows.test.ts
```

## Coverage Reports

### Generate Coverage Reports

```bash
# Generate HTML and text coverage reports
npm run test:coverage

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
npm run test:coverage:core
```

## Continuous Integration

### CI Test Execution

```bash
# Run tests in CI mode
npm run test:ci

# This runs:
# - All tests with 30s timeout
# - Coverage reporting (text format)
# - No watch mode
# - Fail on coverage threshold violations
```

### Pre-Commit Checks

```bash
# Run all checks before committing
npm run check:ci

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
npx vitest run test/unit/gateway/protocol.test.ts

# Run tests matching a pattern
npx vitest run --test-name-pattern "allowlist"
```

### Verbose Output

```bash
# Enable verbose output
TEST_VERBOSE=1 npx vitest run

# Or use Vitest verbose mode
npx vitest run --verbose
```

### Debug Mode

```bash
# Run with debugger
node --inspect-brk ./node_modules/vitest/vitest.mjs run test/unit/my-test.test.ts

# Add debugger statement in test
test('debug this', () => {
  debugger;
  // test code
});
```

### View Test Logs

```bash
# Enable debug logging
DEBUG=miya:* npx vitest run

# Or set specific log level
LOG_LEVEL=debug npx vitest run
```

## Troubleshooting

### Tests Fail Locally But Pass in CI

**Possible Causes**:
- Environment variable differences
- Node.js version mismatch
- Timing-dependent tests
- Test isolation issues

**Solutions**:
```bash
# Check Node.js and npm versions
node --version

# Clear test cache
rm -rf node_modules/.cache

# Run tests with same settings as CI
npm run test:ci
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
TEST_TIMEOUT=60000 npx vitest run

# Add retries
TEST_RETRIES=2 npx vitest run

# Run tests sequentially
npx vitest run --max-concurrency=1
```

### Coverage Is Low

**Solutions**:
```bash
# Generate coverage report to identify gaps
npm run test:coverage

# View HTML report
open coverage/index.html

# Focus on core modules
npm run test:coverage:core
```

### Integration Tests Fail

**Possible Causes**:
- Daemon not running
- WebSocket connection issues
- Resource conflicts

**Solutions**:
```bash
# Ensure daemon is available
MIYA_RUN_INTEGRATION=1 npm run test:integration

# Check daemon logs
tail -f daemon/host.stdout.log

# Run integration tests with verbose output
TEST_VERBOSE=1 MIYA_RUN_INTEGRATION=1 npm run test:integration
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
npx vitest run test/performance/ --update-baselines

# Or use the baseline refresh script
npm run baseline:refresh
```

### Compare Against Baselines

```bash
# Run performance tests (automatically compares against baselines)
npm run test:performance

# Tests will fail if performance degrades by more than 10%
```

## Best Practices

### 1. Run Tests Before Committing

```bash
# Run all checks
npm run check:ci

# Run tests with coverage
npm run test:coverage
```

### 2. Use Watch Mode During Development

```bash
# Run tests in watch mode
npm run test:watch

# Or with specific category
npx vitest run test/unit/ --watch
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

- [npx vitest run Documentation](https://vitest.dev/guide/)
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
**Test Framework**: npx vitest run v1.3.9+  
**Coverage Target**: 70% global, 80% core modules


# Strict Gate

- Command: `npm --prefix miya-src run -s test:strict`
- Behavior: runs typecheck, core vitest, gateway milestone, integration, UI, contracts, doc lint, and `opencode debug config|skill|paths` in sequence.
- Report: `miya-src/.opencode/miya/reports/strict-gate-latest.json`
- Rule: any failed step marks strict gate failed and blocks "闭环已完成" claims.
