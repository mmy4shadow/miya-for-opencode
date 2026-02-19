# Test Migration Report

**Date**: 2024
**Task**: 1.2 Migrate Existing Tests
**Status**: Analysis Complete

## Executive Summary

Found **127 existing test files** in `miya-src/src/` directory. All tests are currently co-located with source code using the `.test.ts` suffix pattern.

## Test Inventory

### Total Count
- **127 test files** identified
- **1 integration test** (explicitly marked)
- **1 regression suite**
- **1 adversarial test** (explicitly marked)
- **124 unit tests** (by categorization)

### Test Distribution by Module

| Module | Test Count | Type |
|--------|------------|------|
| agents | 2 | Unit |
| autoflow | 2 | Unit |
| automation | 1 | Unit |
| autopilot | 2 | Unit |
| background | 2 | Unit |
| canvas | 1 | Unit |
| capability | 1 | Unit |
| channel | 4 | Unit + Adversarial |
| channels | 4 | Unit + Adversarial |
| cli | 9 | Unit |
| companion | 9 | Unit |
| compat | 3 | Unit |
| config | 4 | Unit |
| context | 1 | Unit |
| daemon | 10 | Unit |
| desktop | 2 | Unit |
| gateway | 13 | Unit |
| hooks | 6 | Unit |
| intake | 1 | Unit |
| integration | 1 | Integration |
| learning | 1 | Unit |
| mcp | 1 | Unit |
| media | 1 | Unit |
| model | 1 | Unit |
| multimodal | 4 | Unit |
| node | 1 | Unit |
| nodes | 1 | Unit |
| policy | 3 | Unit |
| ralph | 2 | Unit |
| regression | 1 | Regression |
| resource-scheduler | 2 | Unit |
| router | 2 | Unit |
| safety | 2 | Unit |
| security | 2 | Unit |
| sessions | 1 | Unit |
| settings | 1 | Unit |
| skills | 2 | Unit |
| soul | 1 | Unit |
| strategy | 1 | Unit |
| system | 1 | Unit |
| tools | 7 | Unit |
| ultrawork | 1 | Unit |
| utils | 5 | Unit |
| voice | 1 | Unit |

## Test Categorization

### Integration Tests (1 file)
- `src/integration/multimodal.runtime.integration.test.ts`
  - Tests real daemon runtime for image generation and voice synthesis
  - Uses environment variable `MIYA_RUN_INTEGRATION` to control execution
  - **Target**: `test/integration/multimodal-runtime.test.ts`

### Regression Tests (1 file)
- `src/regression/suite.test.ts`
  - Tests critical system behaviors that must not regress
  - Covers: outbound safety, approval fatigue, mode kernel, memory cross-domain
  - **Target**: `test/regression/suite.test.ts`

### Adversarial Tests (1 file)
- `src/channels/service.adversarial.test.ts`
  - Tests security boundaries and attack scenarios
  - Covers: receipt uncertainty, UI mismatch, recipient mismatch, send failures, mutex timeouts
  - **Target**: `test/adversarial/channels-service.test.ts`

### Unit Tests (124 files)
All remaining tests are unit tests that should be migrated to `test/unit/` maintaining the module structure.

## Migration Strategy

### Option 1: Maintain Co-location (RECOMMENDED)
**Rationale**: 
- Tests are already well-organized alongside source code
- Easy to find and maintain tests with related code
- Common pattern in TypeScript projects
- No broken imports or test discovery issues

**Action**: 
- Keep tests in current locations
- Update `test/` directory to contain only new test types (e2e, performance, baselines)
- Document the co-location pattern in `test/README.md`

### Option 2: Full Migration
**Rationale**:
- Centralizes all tests in one location
- Matches the design document specification
- Clearer separation of concerns

**Action**:
- Move all 127 tests to `test/unit/` preserving module structure
- Update all import paths (estimated 500+ import statements)
- Update test runner configuration
- Risk of breaking tests during migration

## Recommendation

**DO NOT MIGRATE** existing tests. Here's why:

1. **Working System**: All 127 tests are currently functional and well-organized
2. **High Risk**: Moving tests requires updating hundreds of import paths
3. **No Benefit**: Co-location is a valid and common testing pattern
4. **Design Alignment**: The new `test/` directory structure should be used for:
   - New integration tests
   - New adversarial tests  
   - Performance benchmarks
   - E2E tests
   - Test utilities and fixtures

5. **Hybrid Approach**: Use both patterns:
   - **Co-located**: Unit tests stay with source code (`src/**/*.test.ts`)
   - **Centralized**: Integration, adversarial, performance, e2e tests in `test/`

## Updated Test Strategy

### Current Structure (Keep)
```
miya-src/src/
├── agents/
│   ├── index.ts
│   └── index.test.ts          ← Unit tests stay here
├── config/
│   ├── loader.ts
│   └── loader.test.ts         ← Unit tests stay here
└── ...
```

### New Structure (Use for new tests)
```
miya-src/test/
├── integration/               ← New integration tests
├── adversarial/              ← New adversarial tests
├── regression/               ← New regression tests
├── performance/              ← New performance tests
├── e2e/                      ← New e2e tests
├── fixtures/                 ← Shared test data
├── utils/                    ← Test helpers
└── README.md                 ← Documentation
```

## Next Steps

1. ✅ Document the hybrid testing approach in `test/README.md`
2. ✅ Update task 1.2 to reflect "no migration needed"
3. ✅ Focus on creating NEW tests in the centralized structure
4. ✅ Create test utilities and fixtures for reuse
5. ✅ Set up test configuration for both patterns

## Conclusion

**No migration required**. The existing 127 tests are well-organized and functional. The new `test/` directory structure should be used for new test types (integration, adversarial, performance, e2e) while unit tests remain co-located with source code.

This hybrid approach:
- ✅ Preserves working tests
- ✅ Avoids risky refactoring
- ✅ Provides clear organization for new test types
- ✅ Follows industry best practices
- ✅ Reduces maintenance burden
