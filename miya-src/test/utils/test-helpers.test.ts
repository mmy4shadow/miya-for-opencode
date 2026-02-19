/**
 * Test Helpers Unit Tests
 * 
 * Verifies that test helper utilities work correctly.
 */

import { describe, test, expect } from 'bun:test';
import {
  sleep,
  waitFor,
  createSpy,
  assertDefined,
  assertThrows,
  randomString,
  randomInt,
  randomPick,
  deepClone,
  measureTime,
} from './test-helpers';

describe('Test Helpers', () => {
  describe('sleep', () => {
    test('should sleep for specified time', async () => {
      const start = Date.now();
      await sleep(100);
      const duration = Date.now() - start;
      
      expect(duration).toBeGreaterThanOrEqual(90);
      expect(duration).toBeLessThan(150);
    });
  });
  
  describe('waitFor', () => {
    test('should wait for condition to become true', async () => {
      let ready = false;
      setTimeout(() => { ready = true; }, 100);
      
      await waitFor(() => ready, 1000, 10);
      expect(ready).toBe(true);
    });
    
    test('should timeout if condition never becomes true', async () => {
      await expect(
        waitFor(() => false, 100, 10)
      ).rejects.toThrow('Timeout');
    });
  });
  
  describe('createSpy', () => {
    test('should track function calls', () => {
      const spy = createSpy((x: number) => x * 2);
      
      spy(5);
      spy(10);
      
      expect(spy.calls).toHaveLength(2);
      expect(spy.calls[0]).toEqual([5]);
      expect(spy.calls[1]).toEqual([10]);
      expect(spy.results[0]).toBe(10);
      expect(spy.results[1]).toBe(20);
    });
    
    test('should reset call history', () => {
      const spy = createSpy();
      
      spy(1);
      spy(2);
      expect(spy.calls).toHaveLength(2);
      
      spy.reset();
      expect(spy.calls).toHaveLength(0);
      expect(spy.results).toHaveLength(0);
    });
  });
  
  describe('assertDefined', () => {
    test('should pass for defined values', () => {
      expect(() => assertDefined(0)).not.toThrow();
      expect(() => assertDefined('')).not.toThrow();
      expect(() => assertDefined(false)).not.toThrow();
    });
    
    test('should throw for null or undefined', () => {
      expect(() => assertDefined(null)).toThrow();
      expect(() => assertDefined(undefined)).toThrow();
    });
  });
  
  describe('assertThrows', () => {
    test('should pass when function throws', async () => {
      await assertThrows(async () => {
        throw new Error('test error');
      });
    });
    
    test('should verify error message', async () => {
      await assertThrows(
        async () => { throw new Error('specific error'); },
        'specific error'
      );
    });
    
    test('should fail when function does not throw', async () => {
      await expect(
        assertThrows(async () => { /* no error */ })
      ).rejects.toThrow('Expected function to throw');
    });
  });
  
  describe('randomString', () => {
    test('should generate string of specified length', () => {
      const str = randomString(10);
      expect(str).toHaveLength(10);
    });
    
    test('should use specified charset', () => {
      const str = randomString(10, '01');
      expect(str).toMatch(/^[01]+$/);
    });
  });
  
  describe('randomInt', () => {
    test('should generate integer in range', () => {
      for (let i = 0; i < 100; i++) {
        const num = randomInt(1, 10);
        expect(num).toBeGreaterThanOrEqual(1);
        expect(num).toBeLessThanOrEqual(10);
        expect(Number.isInteger(num)).toBe(true);
      }
    });
  });
  
  describe('randomPick', () => {
    test('should pick element from array', () => {
      const array = [1, 2, 3, 4, 5];
      const picked = randomPick(array);
      expect(array).toContain(picked);
    });
  });
  
  describe('deepClone', () => {
    test('should create independent copy', () => {
      const original = { a: 1, b: { c: 2 } };
      const clone = deepClone(original);
      
      clone.b.c = 3;
      
      expect(original.b.c).toBe(2);
      expect(clone.b.c).toBe(3);
    });
  });
  
  describe('measureTime', () => {
    test('should measure execution time', async () => {
      const { result, duration } = await measureTime(async () => {
        await sleep(100);
        return 'done';
      });
      
      expect(result).toBe('done');
      expect(duration).toBeGreaterThanOrEqual(90);
      expect(duration).toBeLessThan(150);
    });
  });
});
