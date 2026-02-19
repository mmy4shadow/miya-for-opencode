/**
 * Test Helpers and Utilities
 * 
 * Common utilities for test setup, teardown, assertions, and data generation.
 * These helpers are designed to be reusable across all test categories.
 * 
 * @module test/utils/test-helpers
 */

import { expect } from 'bun:test';
import type { TestContext } from 'bun:test';

/**
 * Sleep utility for async tests
 * 
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 * 
 * @example
 * ```typescript
 * await sleep(1000); // Wait 1 second
 * ```
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to become true with timeout
 * 
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 * @param interval - Check interval in milliseconds (default: 100)
 * @returns Promise that resolves when condition is met or rejects on timeout
 * 
 * @example
 * ```typescript
 * await waitFor(() => server.isReady(), 10000);
 * ```
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const result = await Promise.resolve(condition());
    if (result) {
      return;
    }
    await sleep(interval);
  }
  
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Create a temporary directory for test isolation
 * 
 * @param prefix - Directory name prefix (default: 'test-')
 * @returns Path to the temporary directory
 * 
 * @example
 * ```typescript
 * const tmpDir = await createTempDir('my-test-');
 * // Use tmpDir for test files
 * await cleanupTempDir(tmpDir);
 * ```
 */
export async function createTempDir(prefix = 'test-'): Promise<string> {
  const tmpDir = `/tmp/${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await Bun.write(`${tmpDir}/.gitkeep`, '');
  return tmpDir;
}

/**
 * Clean up a temporary directory
 * 
 * @param path - Path to the directory to remove
 * 
 * @example
 * ```typescript
 * await cleanupTempDir(tmpDir);
 * ```
 */
export async function cleanupTempDir(path: string): Promise<void> {
  try {
    await Bun.$`rm -rf ${path}`;
  } catch (error) {
    console.warn(`Failed to cleanup temp dir ${path}:`, error);
  }
}

/**
 * Mock console methods for testing
 * 
 * @returns Object with restore function and captured logs
 * 
 * @example
 * ```typescript
 * const consoleMock = mockConsole();
 * console.log('test message');
 * expect(consoleMock.logs).toContain('test message');
 * consoleMock.restore();
 * ```
 */
export function mockConsole() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  const logs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  
  console.log = (...args: any[]) => {
    logs.push(args.map(String).join(' '));
  };
  
  console.error = (...args: any[]) => {
    errors.push(args.map(String).join(' '));
  };
  
  console.warn = (...args: any[]) => {
    warnings.push(args.map(String).join(' '));
  };
  
  return {
    logs,
    errors,
    warnings,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

/**
 * Create a spy function that tracks calls
 * 
 * @param implementation - Optional implementation function
 * @returns Spy function with call tracking
 * 
 * @example
 * ```typescript
 * const spy = createSpy((x: number) => x * 2);
 * spy(5);
 * expect(spy.calls).toHaveLength(1);
 * expect(spy.calls[0]).toEqual([5]);
 * expect(spy.results[0]).toBe(10);
 * ```
 */
export function createSpy<T extends (...args: any[]) => any>(
  implementation?: T
): T & {
  calls: Parameters<T>[];
  results: ReturnType<T>[];
  reset: () => void;
} {
  const calls: Parameters<T>[] = [];
  const results: ReturnType<T>[] = [];
  
  const spy = ((...args: Parameters<T>) => {
    calls.push(args);
    const result = implementation ? implementation(...args) : undefined;
    results.push(result);
    return result;
  }) as any;
  
  spy.calls = calls;
  spy.results = results;
  spy.reset = () => {
    calls.length = 0;
    results.length = 0;
  };
  
  return spy;
}

/**
 * Assert that a value is defined (not null or undefined)
 * 
 * @param value - Value to check
 * @param message - Optional error message
 * 
 * @example
 * ```typescript
 * assertDefined(user, 'User should be defined');
 * ```
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || 'Value is null or undefined');
  }
}

/**
 * Assert that an async function throws an error
 * 
 * @param fn - Async function to test
 * @param expectedError - Optional expected error message or pattern
 * 
 * @example
 * ```typescript
 * await assertThrows(
 *   async () => { throw new Error('test'); },
 *   'test'
 * );
 * ```
 */
export async function assertThrows(
  fn: () => Promise<any>,
  expectedError?: string | RegExp
): Promise<void> {
  let thrown = false;
  let error: any;
  
  try {
    await fn();
  } catch (e) {
    thrown = true;
    error = e;
  }
  
  if (!thrown) {
    throw new Error('Expected function to throw an error');
  }
  
  if (expectedError) {
    const message = error?.message || String(error);
    if (typeof expectedError === 'string') {
      if (!message.includes(expectedError)) {
        throw new Error(
          `Expected error message to include "${expectedError}", got "${message}"`
        );
      }
    } else {
      if (!expectedError.test(message)) {
        throw new Error(
          `Expected error message to match ${expectedError}, got "${message}"`
        );
      }
    }
  }
}

/**
 * Create a mock timer for testing time-dependent code
 * 
 * @returns Object with timer control methods
 * 
 * @example
 * ```typescript
 * const timer = createMockTimer();
 * const callback = createSpy();
 * setTimeout(callback, 1000);
 * timer.tick(1000);
 * expect(callback.calls).toHaveLength(1);
 * timer.restore();
 * ```
 */
export function createMockTimer() {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  
  let currentTime = 0;
  const timers: Map<number, { callback: Function; time: number; interval?: number }> = new Map();
  let nextId = 1;
  
  globalThis.setTimeout = ((callback: Function, ms: number) => {
    const id = nextId++;
    timers.set(id, { callback, time: currentTime + ms });
    return id;
  }) as any;
  
  globalThis.clearTimeout = (id: number) => {
    timers.delete(id);
  };
  
  globalThis.setInterval = ((callback: Function, ms: number) => {
    const id = nextId++;
    timers.set(id, { callback, time: currentTime + ms, interval: ms });
    return id;
  }) as any;
  
  globalThis.clearInterval = (id: number) => {
    timers.delete(id);
  };
  
  return {
    tick: (ms: number) => {
      currentTime += ms;
      for (const [id, timer] of timers.entries()) {
        if (timer.time <= currentTime) {
          timer.callback();
          if (timer.interval) {
            timer.time = currentTime + timer.interval;
          } else {
            timers.delete(id);
          }
        }
      }
    },
    getCurrentTime: () => currentTime,
    getPendingTimers: () => timers.size,
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };
}

/**
 * Generate a random string for testing
 * 
 * @param length - Length of the string (default: 10)
 * @param charset - Character set to use (default: alphanumeric)
 * @returns Random string
 * 
 * @example
 * ```typescript
 * const id = randomString(16);
 * const hex = randomString(8, '0123456789abcdef');
 * ```
 */
export function randomString(
  length = 10,
  charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

/**
 * Generate a random integer in a range
 * 
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns Random integer
 * 
 * @example
 * ```typescript
 * const age = randomInt(18, 65);
 * ```
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pick a random element from an array
 * 
 * @param array - Array to pick from
 * @returns Random element
 * 
 * @example
 * ```typescript
 * const color = randomPick(['red', 'green', 'blue']);
 * ```
 */
export function randomPick<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Deep clone an object for test isolation
 * 
 * @param obj - Object to clone
 * @returns Cloned object
 * 
 * @example
 * ```typescript
 * const original = { a: 1, b: { c: 2 } };
 * const clone = deepClone(original);
 * clone.b.c = 3;
 * expect(original.b.c).toBe(2);
 * ```
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Create a test fixture with setup and teardown
 * 
 * @param setup - Setup function
 * @param teardown - Teardown function
 * @returns Fixture object
 * 
 * @example
 * ```typescript
 * const dbFixture = createFixture(
 *   async () => await createTestDb(),
 *   async (db) => await db.close()
 * );
 * 
 * test('my test', async () => {
 *   const db = await dbFixture.setup();
 *   // Use db
 *   await dbFixture.teardown(db);
 * });
 * ```
 */
export function createFixture<T>(
  setup: () => Promise<T>,
  teardown: (value: T) => Promise<void>
) {
  return {
    setup,
    teardown,
    use: async (fn: (value: T) => Promise<void>) => {
      const value = await setup();
      try {
        await fn(value);
      } finally {
        await teardown(value);
      }
    },
  };
}

/**
 * Retry a function with exponential backoff
 * 
 * @param fn - Function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param initialDelay - Initial delay in milliseconds (default: 100)
 * @returns Result of the function
 * 
 * @example
 * ```typescript
 * const result = await retry(
 *   async () => await fetchData(),
 *   5,
 *   200
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 100
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        const delay = initialDelay * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}

/**
 * Measure execution time of a function
 * 
 * @param fn - Function to measure
 * @returns Object with result and duration in milliseconds
 * 
 * @example
 * ```typescript
 * const { result, duration } = await measureTime(async () => {
 *   return await expensiveOperation();
 * });
 * console.log(`Operation took ${duration}ms`);
 * ```
 */
export async function measureTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

/**
 * Assert that execution time is within bounds
 * 
 * @param fn - Function to measure
 * @param maxDuration - Maximum allowed duration in milliseconds
 * @param message - Optional error message
 * 
 * @example
 * ```typescript
 * await assertPerformance(
 *   async () => await fastOperation(),
 *   100,
 *   'Operation should complete in under 100ms'
 * );
 * ```
 */
export async function assertPerformance<T>(
  fn: () => Promise<T>,
  maxDuration: number,
  message?: string
): Promise<T> {
  const { result, duration } = await measureTime(fn);
  
  if (duration > maxDuration) {
    throw new Error(
      message || `Expected execution time <= ${maxDuration}ms, got ${duration.toFixed(2)}ms`
    );
  }
  
  return result;
}
