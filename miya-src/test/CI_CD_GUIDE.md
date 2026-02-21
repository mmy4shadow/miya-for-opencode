# CI/CD Integration Guide

## Overview

This document describes the CI/CD pipeline configuration for the Miya Plugin test suite. The pipeline automatically runs tests, generates coverage reports, and uploads artifacts on every push and pull request.

## Workflow File

**Location**: `.github/workflows/miya-ci.yml`

## Pipeline Stages

### 1. Setup
- Checkout repository
- Setup Node.js runtime (latest version)
- Install dependencies with frozen lockfile

### 2. Quality Gates
- Run linters (Biome)
- Run contract checks
- Run documentation lint

### 3. Test Execution

The pipeline runs tests in the following order:

#### Unit Tests
```bash
npm run test:unit
```
- **Timeout**: 5 seconds per test
- **Location**: `test/unit/`
- **Purpose**: Test individual functions and modules in isolation
- **Failure**: Blocks merge

#### Integration Tests
```bash
npm run test:integration
```
- **Timeout**: 30 seconds per test
- **Location**: `test/integration/`
- **Purpose**: Test component interactions
- **Failure**: Warning only (requires daemon runtime)

#### Regression Tests
```bash
npm run test:regression
```
- **Timeout**: 30 seconds per test
- **Location**: `test/regression/`
- **Purpose**: Prevent known issues from reoccurring
- **Failure**: Blocks merge

#### Adversarial Tests
```bash
npm run test:adversarial
```
- **Timeout**: 30 seconds per test
- **Location**: `test/adversarial/`
- **Purpose**: Test security mechanisms
- **Failure**: Warning only (not yet implemented)

#### Performance Tests
```bash
npm run test:performance
```
- **Timeout**: 60 seconds per test
- **Location**: `test/performance/`
- **Purpose**: Detect performance regressions
- **Failure**: Warning only (not yet implemented)

### 4. Coverage Reporting

```bash
npm run test:coverage
```

Generates coverage reports in multiple formats:
- **HTML**: `coverage/index.html` (interactive report)
- **Text**: Console output
- **JSON**: `coverage/coverage-summary.json`

**Coverage Thresholds**:
- Global: 70%
- Core modules (gateway, channels, safety, policy): 80%

### 5. Artifact Upload

The pipeline uploads the following artifacts:

#### Coverage Report
- **Name**: `coverage-report`
- **Path**: `miya-src/coverage/`
- **Retention**: 30 days
- **Contents**: HTML coverage report, JSON summary

#### Test Results
- **Name**: `test-results`
- **Path**: `miya-src/test/reports/`, `miya-src/test/baselines/`
- **Retention**: 30 days
- **Contents**: Test execution reports, performance baselines

### 6. PR Comments

On pull requests, the pipeline automatically comments with coverage metrics:

```
## Test Coverage Report

| Metric | Coverage |
|--------|----------|
| Statements | XX% |
| Branches | XX% |
| Functions | XX% |
| Lines | XX% |

**Overall Coverage:** XX%
```

## Triggering the Pipeline

### Automatic Triggers

The pipeline runs automatically on:

1. **Push to branches**:
   - `main`
   - `master`
   - `miya/**`

2. **Pull requests**:
   - All branches

### Manual Trigger

You can manually trigger the workflow from the GitHub Actions tab:
1. Go to Actions → Miya Plugin CI/CD
2. Click "Run workflow"
3. Select branch
4. Click "Run workflow"

## Local Testing

Before pushing, you can run the same tests locally:

```bash
cd miya-src

# Run all checks (same as CI)
npm run check:ci

# Run unit tests
npm run test:unit

# Run integration tests (requires daemon)
MIYA_RUN_INTEGRATION=1 npm run test:integration

# Run regression tests
npm run test:regression

# Generate coverage report
npm run test:coverage
```

## Viewing Results

### GitHub Actions UI

1. Go to the repository on GitHub
2. Click "Actions" tab
3. Click on a workflow run
4. View logs and download artifacts

### Coverage Report

1. Download the `coverage-report` artifact
2. Extract the ZIP file
3. Open `index.html` in a browser

### Test Results

1. Download the `test-results` artifact
2. Extract the ZIP file
3. Review reports in `test/reports/`

## Troubleshooting

### Tests Fail in CI but Pass Locally

**Possible causes**:
- Environment differences (Node.js vs Node/Vitest)
- Missing environment variables
- Timing issues (CI is slower)
- File system differences (Linux vs Windows)

**Solutions**:
- Check CI logs for specific errors
- Run tests with `TEST_VERBOSE=1` locally
- Add retries for flaky tests
- Use deterministic test data

### Coverage Below Threshold

**Possible causes**:
- New code without tests
- Tests not covering edge cases
- Dead code not removed

**Solutions**:
- Add unit tests for new code
- Review coverage report to identify gaps
- Remove unused code

### Artifacts Not Uploaded

**Possible causes**:
- Tests failed before artifact upload
- Path mismatch in workflow
- Artifact size too large

**Solutions**:
- Check workflow logs
- Verify paths in workflow file
- Reduce artifact size (exclude unnecessary files)

## Configuration

### Test Timeouts

Configured in `test/config/test.config.ts`:

```typescript
export const testCategories = {
  unit: { timeout: 5000 },
  integration: { timeout: 30000 },
  regression: { timeout: 30000 },
  adversarial: { timeout: 30000 },
  performance: { timeout: 60000 },
  e2e: { timeout: 60000 },
};
```

### Coverage Thresholds

Configured in `test/config/test.config.ts`:

```typescript
coverage: {
  thresholds: {
    global: 70,
    core: 80,
    perFile: {
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
  },
}
```

### Excluded Paths

Configured in `test/config/test.config.ts`:

```typescript
exclude: [
  '**/node_modules/**',
  '**/dist/**',
  '**/test/**',
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/fixtures/**',
  '**/mocks/**',
  '**/*.d.ts',
]
```

## Best Practices

### Writing CI-Friendly Tests

1. **Deterministic**: Tests should produce the same result every time
2. **Isolated**: Tests should not depend on external services
3. **Fast**: Unit tests should complete in < 1 second
4. **Clear**: Test names should describe what is being tested
5. **Focused**: Each test should verify one thing

### Handling Flaky Tests

1. **Identify**: Use `TEST_RETRIES=3` to detect flaky tests
2. **Fix**: Make tests deterministic (avoid timing dependencies)
3. **Isolate**: Ensure proper test cleanup
4. **Document**: Add comments explaining timing-sensitive tests

### Optimizing CI Performance

1. **Parallelize**: Run independent tests in parallel
2. **Cache**: Use frozen lockfile for faster installs
3. **Skip**: Use `continue-on-error` for optional tests
4. **Fail Fast**: Use `bail: 1` to stop on first failure (optional)

## Future Enhancements

### Planned Features

1. **E2E Tests**: Add end-to-end user workflow tests
2. **Performance Baselines**: Track performance metrics over time
3. **Security Scanning**: Add dependency vulnerability scanning
4. **Code Quality**: Add complexity and maintainability metrics
5. **Deployment**: Add automatic deployment on successful tests

### Integration Opportunities

1. **Codecov**: Upload coverage to Codecov for better visualization
2. **Slack/Discord**: Send notifications on test failures
3. **GitHub Status Checks**: Block merge on test failures
4. **Dependabot**: Automatic dependency updates with tests

## References

- [npx vitest run Runner](https://vitest.dev/guide/)
- [GitHub Actions](https://docs.github.com/en/actions)
- [Test Configuration](./config/test.config.ts)
- [Test Execution Guide](./TEST_EXECUTION_GUIDE.md)

## Support

For issues with CI/CD:
1. Check workflow logs in GitHub Actions
2. Review this guide for troubleshooting steps
3. Open an issue with workflow run URL and error logs


