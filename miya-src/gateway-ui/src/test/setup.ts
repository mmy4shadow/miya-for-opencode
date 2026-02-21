import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';
import { afterEach, expect } from 'vitest';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Extend Vitest's expect with jest-axe matchers
expect.extend({ toHaveNoViolations });

// Cleanup after each test
afterEach(() => {
  cleanup();
});
