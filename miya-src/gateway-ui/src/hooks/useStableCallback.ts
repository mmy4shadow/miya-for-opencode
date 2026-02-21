/**
 * useStableCallback Hook
 *
 * Creates a stable callback reference that doesn't change between renders,
 * preventing unnecessary re-renders of child components that depend on the callback.
 * (Requirement 12.3, 12.4)
 *
 * This is a critical performance optimization that ensures callback props
 * passed to memoized child components don't break memoization.
 */

import { useCallback, useEffect, useRef } from 'react';

/**
 * Create a stable callback reference
 *
 * The returned callback always has the same reference, but internally
 * calls the latest version of the provided callback. This prevents
 * child components from re-rendering when the callback changes.
 *
 * @param callback - The callback function to stabilize
 * @returns A stable callback reference that always calls the latest callback
 *
 * @example
 * ```tsx
 * function ParentComponent() {
 *   const [count, setCount] = useState(0);
 *
 *   // Without useStableCallback, this would create a new function on every render
 *   // causing ChildComponent to re-render even if it's wrapped in React.memo
 *   const handleClick = useStableCallback(() => {
 *     console.log('Current count:', count);
 *     setCount(count + 1);
 *   });
 *
 *   return <ChildComponent onClick={handleClick} />;
 * }
 * ```
 */
export function useStableCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
): T {
  // Store the latest callback in a ref
  const callbackRef = useRef<T>(callback);

  // Update the ref whenever the callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Return a stable callback that always calls the latest callback
  // The returned function reference never changes, but it always
  // calls the most recent version of the callback
  return useCallback(
    ((...args: Parameters<T>) => {
      return callbackRef.current(...args);
    }) as T,
    [], // Empty dependency array ensures the callback reference never changes
  );
}
