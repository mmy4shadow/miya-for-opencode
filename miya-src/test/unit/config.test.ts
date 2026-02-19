/**
 * Test Configuration Verification
 * 
 * This test verifies that the test configuration is properly loaded
 * and that the test runner is correctly configured.
 */

import { describe, test, expect } from 'bun:test';
import { getTestConfig, defaultConfig, testCategories, coreModules } from '../config/test.config';

describe('Test Configuration', () => {
  test('should load default configuration', () => {
    const config = getTestConfig();
    
    expect(config).toBeDefined();
    expect(config.timeout).toBe(30000);
    expect(config.retries).toBe(0);
    expect(config.concurrency).toBe(1);
  });
  
  test('should have coverage configuration', () => {
    const config = getTestConfig();
    
    expect(config.coverage).toBeDefined();
    expect(config.coverage.enabled).toBe(true);
    expect(config.coverage.thresholds.global).toBe(70);
    expect(config.coverage.thresholds.core).toBe(80);
  });
  
  test('should define test categories', () => {
    expect(testCategories).toBeDefined();
    expect(testCategories.unit).toBeDefined();
    expect(testCategories.integration).toBeDefined();
    expect(testCategories.regression).toBeDefined();
    expect(testCategories.adversarial).toBeDefined();
    expect(testCategories.performance).toBeDefined();
    expect(testCategories.e2e).toBeDefined();
  });
  
  test('should define core modules', () => {
    expect(coreModules).toBeDefined();
    expect(coreModules.length).toBeGreaterThan(0);
    expect(coreModules).toContain('src/gateway/**');
    expect(coreModules).toContain('src/channels/**');
    expect(coreModules).toContain('src/safety/**');
    expect(coreModules).toContain('src/policy/**');
  });
  
  test('should respect environment variable overrides', () => {
    // Save original env
    const originalTimeout = process.env.TEST_TIMEOUT;
    const originalVerbose = process.env.TEST_VERBOSE;
    
    try {
      // Set environment variables
      process.env.TEST_TIMEOUT = '60000';
      process.env.TEST_VERBOSE = '1';
      
      const config = getTestConfig();
      
      expect(config.timeout).toBe(60000);
      expect(config.execution.verbose).toBe(true);
    } finally {
      // Restore original env
      if (originalTimeout) {
        process.env.TEST_TIMEOUT = originalTimeout;
      } else {
        delete process.env.TEST_TIMEOUT;
      }
      
      if (originalVerbose) {
        process.env.TEST_VERBOSE = originalVerbose;
      } else {
        delete process.env.TEST_VERBOSE;
      }
    }
  });
  
  test('should have integration test configuration', () => {
    const config = getTestConfig();
    
    expect(config.integration).toBeDefined();
    expect(config.integration.timeout).toBe(60000);
    expect(typeof config.integration.enabled).toBe('boolean');
  });
  
  test('should have performance test configuration', () => {
    const config = getTestConfig();
    
    expect(config.performance).toBeDefined();
    expect(config.performance.enabled).toBe(true);
    expect(config.performance.baselinePath).toBe('test/baselines/benchmarks.json');
    expect(config.performance.regressionThreshold).toBe(10);
  });
  
  test('should exclude appropriate directories from coverage', () => {
    const config = getTestConfig();
    
    expect(config.coverage.exclude).toContain('**/node_modules/**');
    expect(config.coverage.exclude).toContain('**/dist/**');
    expect(config.coverage.exclude).toContain('**/test/**');
    expect(config.coverage.exclude).toContain('**/*.test.ts');
  });
});
