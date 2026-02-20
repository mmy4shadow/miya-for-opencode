/**
 * Type definitions for jest-axe
 */

declare module 'jest-axe' {
  import type { AxeResults } from 'axe-core';

  export interface JestAxeConfigureOptions {
    rules?: Record<string, { enabled: boolean }>;
    globalOptions?: Record<string, unknown>;
  }

  export function axe(
    html: Element | Document | string,
    options?: JestAxeConfigureOptions
  ): Promise<AxeResults>;

  export function toHaveNoViolations(results: AxeResults): {
    pass: boolean;
    message: () => string;
  };

  export function configureAxe(options?: JestAxeConfigureOptions): typeof axe;
}
