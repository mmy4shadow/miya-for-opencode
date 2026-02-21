/**
 * Unit tests for useStableCallback hook
 *
 * Tests stable callback reference creation and behavior
 * Requirements: 12.3, 12.4
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStableCallback } from './useStableCallback';

describe('useStableCallback', () => {
  it('should return a function', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useStableCallback(callback));

    expect(typeof result.current).toBe('function');
  });

  it('should call the provided callback when invoked', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useStableCallback(callback));

    result.current();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should pass arguments to the callback', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useStableCallback(callback));

    result.current('arg1', 'arg2', 123);

    expect(callback).toHaveBeenCalledWith('arg1', 'arg2', 123);
  });

  it('should return the callback result', () => {
    const callback = vi.fn(() => 'test-result');
    const { result } = renderHook(() => useStableCallback(callback));

    const returnValue = result.current();

    expect(returnValue).toBe('test-result');
  });

  it('should maintain the same reference across re-renders', () => {
    const callback1 = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useStableCallback(cb), {
      initialProps: { cb: callback1 },
    });

    const firstReference = result.current;

    // Re-render with a different callback
    const callback2 = vi.fn();
    rerender({ cb: callback2 });

    const secondReference = result.current;

    // The reference should be the same
    expect(secondReference).toBe(firstReference);
  });

  it('should call the latest callback version', () => {
    const callback1 = vi.fn(() => 'result1');
    const { result, rerender } = renderHook(({ cb }) => useStableCallback(cb), {
      initialProps: { cb: callback1 },
    });

    // Call with first callback
    const result1 = result.current();
    expect(result1).toBe('result1');
    expect(callback1).toHaveBeenCalledTimes(1);

    // Re-render with a different callback
    const callback2 = vi.fn(() => 'result2');
    rerender({ cb: callback2 });

    // Call with second callback (same reference, but should call callback2)
    const result2 = result.current();
    expect(result2).toBe('result2');
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback1).toHaveBeenCalledTimes(1); // Should not be called again
  });

  it('should access latest closure variables', () => {
    let count = 0;
    const callback1 = vi.fn(() => count);

    const { result, rerender } = renderHook(({ cb }) => useStableCallback(cb), {
      initialProps: { cb: callback1 },
    });

    // First call
    expect(result.current()).toBe(0);

    // Update closure variable and re-render with new callback
    count = 5;
    const callback2 = vi.fn(() => count);
    rerender({ cb: callback2 });

    // Should access the latest closure variable
    expect(result.current()).toBe(5);
  });

  it('should work with async callbacks', async () => {
    const callback = vi.fn(async (value: number) => {
      return value * 2;
    });

    const { result } = renderHook(() => useStableCallback(callback));

    const returnValue = await result.current(5);

    expect(returnValue).toBe(10);
    expect(callback).toHaveBeenCalledWith(5);
  });

  it('should work with callbacks that have multiple parameters', () => {
    const callback = vi.fn((a: number, b: string, c: boolean) => {
      return `${a}-${b}-${c}`;
    });

    const { result } = renderHook(() => useStableCallback(callback));

    const returnValue = result.current(42, 'test', true);

    expect(returnValue).toBe('42-test-true');
    expect(callback).toHaveBeenCalledWith(42, 'test', true);
  });

  it('should work with callbacks that throw errors', () => {
    const callback = vi.fn(() => {
      throw new Error('Test error');
    });

    const { result } = renderHook(() => useStableCallback(callback));

    expect(() => result.current()).toThrow('Test error');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should preserve this context when callback uses it', () => {
    const obj = {
      value: 42,
      getValue() {
        return this.value;
      },
    };

    const { result } = renderHook(() =>
      useStableCallback(obj.getValue.bind(obj)),
    );

    const returnValue = result.current();

    expect(returnValue).toBe(42);
  });

  it('should handle rapid re-renders with different callbacks', () => {
    const callbacks = [
      vi.fn(() => 'a'),
      vi.fn(() => 'b'),
      vi.fn(() => 'c'),
      vi.fn(() => 'd'),
    ];

    const { result, rerender } = renderHook(({ cb }) => useStableCallback(cb), {
      initialProps: { cb: callbacks[0] },
    });

    const stableRef = result.current;

    // Rapidly re-render with different callbacks
    for (let i = 1; i < callbacks.length; i++) {
      rerender({ cb: callbacks[i] });
      expect(result.current).toBe(stableRef); // Reference should remain stable
    }

    // The last callback should be called
    const finalResult = result.current();
    expect(finalResult).toBe('d');
    expect(callbacks[3]).toHaveBeenCalledTimes(1);
  });

  it('should work with callbacks that return objects', () => {
    const callback = vi.fn(() => ({ key: 'value', count: 42 }));

    const { result } = renderHook(() => useStableCallback(callback));

    const returnValue = result.current();

    expect(returnValue).toEqual({ key: 'value', count: 42 });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should work with callbacks that return undefined', () => {
    const callback = vi.fn(() => undefined);

    const { result } = renderHook(() => useStableCallback(callback));

    const returnValue = result.current();

    expect(returnValue).toBeUndefined();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should work with callbacks that have no parameters', () => {
    const callback = vi.fn(() => 'no-params');

    const { result } = renderHook(() => useStableCallback(callback));

    const returnValue = result.current();

    expect(returnValue).toBe('no-params');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should handle callbacks with rest parameters', () => {
    const callback = vi.fn((...args: number[]) => {
      return args.reduce((sum, n) => sum + n, 0);
    });

    const { result } = renderHook(() => useStableCallback(callback));

    const returnValue = result.current(1, 2, 3, 4, 5);

    expect(returnValue).toBe(15);
    expect(callback).toHaveBeenCalledWith(1, 2, 3, 4, 5);
  });

  it('should work in a realistic React component scenario', () => {
    // Simulate a component that re-renders with different state
    let renderCount = 0;
    const mockOnClick = vi.fn();

    const { result, rerender } = renderHook(
      ({ count }) => {
        renderCount++;
        // Simulate a callback that depends on state
        const handleClick = () => {
          mockOnClick(count);
        };
        return useStableCallback(handleClick);
      },
      { initialProps: { count: 0 } },
    );

    const stableCallback = result.current;

    // First click
    result.current();
    expect(mockOnClick).toHaveBeenCalledWith(0);

    // Re-render with new count
    rerender({ count: 5 });
    expect(result.current).toBe(stableCallback); // Reference should be stable

    // Second click should use the new count
    result.current();
    expect(mockOnClick).toHaveBeenCalledWith(5);

    // Re-render again
    rerender({ count: 10 });
    expect(result.current).toBe(stableCallback); // Reference should still be stable

    // Third click should use the newest count
    result.current();
    expect(mockOnClick).toHaveBeenCalledWith(10);

    expect(renderCount).toBe(3);
    expect(mockOnClick).toHaveBeenCalledTimes(3);
  });
});
