/**
 * Test Configuration for Miya Plugin Test Suite
 * 
 * This configuration file defines settings for the Bun test framework,
 * including timeouts, retries, coverage thresholds, and test execution options.
 */

export interface TestConfig {
  /** Default timeout for all tests (milliseconds) */
  timeout: number;
  
  /** Number of retries for flaky tests */
  retries: number;
  
  /** Maximum concurrent tests (1 for sequential execution) */
  concurrency: number;
  
  /** Coverage configuration */
  coverage: {
    /** Enable coverage reporting */
    enabled: boolean;
    
    /** Coverage thresholds (percentage) */
    thresholds: {
      /** Global coverage threshold */
      global: number;
      
      /** Core module coverage threshold */
      core: number;
      
      /** Per-file coverage thresholds */
      perFile: {
        statements: number;
        branches: number;
        functions: number;
        lines: number;
      };
    };
    
    /** Directories to exclude from coverage */
    exclude: string[];
  };
  
  /** Test execution options */
  execution: {
    /** Fail fast on first test failure */
    failFast: boolean;
    
    /** Enable verbose output */
    verbose: boolean;
    
    /** Enable watch mode for development */
    watch: boolean;
  };
  
  /** Integration test configuration */
  integration: {
    /** Enable runtime integration tests (requires daemon) */
    enabled: boolean;
    
    /** Timeout for integration tests (milliseconds) */
    timeout: number;
  };
  
  /** Performance test configuration */
  performance: {
    /** Enable performance regression detection */
    enabled: boolean;
    
    /** Path to baseline benchmarks file */
    baselinePath: string;
    
    /** Regression threshold (percentage) */
    regressionThreshold: number;
  };
}

/**
 * Default test configuration
 */
export const defaultConfig: TestConfig = {
  // Default timeout: 30 seconds
  timeout: 30000,
  
  // No retries by default (tests should be deterministic)
  retries: 0,
  
  // Sequential execution to avoid race conditions
  concurrency: 1,
  
  coverage: {
    enabled: true,
    
    thresholds: {
      // Global coverage: 70%
      global: 70,
      
      // Core modules: 80% (gateway, channels, safety, policy)
      core: 80,
      
      // Per-file thresholds
      perFile: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
    
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/fixtures/**',
      '**/mocks/**',
      '**/*.d.ts',
    ],
  },
  
  execution: {
    failFast: false,
    verbose: false,
    watch: false,
  },
  
  integration: {
    // Integration tests disabled by default (require runtime)
    enabled: process.env.MIYA_RUN_INTEGRATION === '1',
    
    // Integration tests get longer timeout: 60 seconds
    timeout: 60000,
  },
  
  performance: {
    enabled: true,
    baselinePath: 'test/baselines/benchmarks.json',
    
    // Flag regression if performance degrades by more than 10%
    regressionThreshold: 10,
  },
};

/**
 * Core modules that require 80% coverage
 */
export const coreModules = [
  'src/gateway/**',
  'src/channels/**',
  'src/safety/**',
  'src/policy/**',
];

/**
 * Test categories and their configurations
 */
export const testCategories = {
  unit: {
    pattern: 'test/unit/**/*.test.ts',
    timeout: 5000,
    description: 'Unit tests for individual functions and modules',
  },
  integration: {
    pattern: 'test/integration/**/*.test.ts',
    timeout: 30000,
    description: 'Integration tests for component interactions',
  },
  regression: {
    pattern: 'test/regression/**/*.test.ts',
    timeout: 30000,
    description: 'Regression tests for critical paths',
  },
  adversarial: {
    pattern: 'test/adversarial/**/*.test.ts',
    timeout: 30000,
    description: 'Security and adversarial tests',
  },
  performance: {
    pattern: 'test/performance/**/*.test.ts',
    timeout: 60000,
    description: 'Performance benchmarks and regression detection',
  },
  e2e: {
    pattern: 'test/e2e/**/*.test.ts',
    timeout: 60000,
    description: 'End-to-end user workflow tests',
  },
};

/**
 * Get test configuration with environment overrides
 */
export function getTestConfig(): TestConfig {
  const config = { ...defaultConfig };
  
  // Environment variable overrides
  if (process.env.TEST_TIMEOUT) {
    config.timeout = parseInt(process.env.TEST_TIMEOUT, 10);
  }
  
  if (process.env.TEST_RETRIES) {
    config.retries = parseInt(process.env.TEST_RETRIES, 10);
  }
  
  if (process.env.TEST_CONCURRENCY) {
    config.concurrency = parseInt(process.env.TEST_CONCURRENCY, 10);
  }
  
  if (process.env.TEST_VERBOSE === '1') {
    config.execution.verbose = true;
  }
  
  if (process.env.TEST_FAIL_FAST === '1') {
    config.execution.failFast = true;
  }
  
  if (process.env.TEST_WATCH === '1') {
    config.execution.watch = true;
  }
  
  return config;
}

/**
 * Export default configuration
 */
export default defaultConfig;
