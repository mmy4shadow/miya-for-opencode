import { describe, expect, test } from 'bun:test';
import {
  loadDesktopOcrRegressionCases,
  runDesktopOcrRegression,
} from './vision-regression';

describe('vision OCR regression baseline', () => {
  test('keeps baseline fixture coverage stable', () => {
    const cases = loadDesktopOcrRegressionCases();
    expect(cases.length).toBeGreaterThanOrEqual(10);
    const result = runDesktopOcrRegression(cases);
    expect(result.total).toBe(cases.length);
    expect(result.passRate).toBe(100);
    expect(result.failures).toHaveLength(0);
  });
});
