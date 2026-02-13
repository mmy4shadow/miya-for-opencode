import { describe, expect, test } from 'bun:test';
import { analyzeFailure } from './error-analyzer';

describe('ralph error analyzer', () => {
  test('classifies missing dependencies', () => {
    const result = analyzeFailure('Error: Cannot find module "zod"');
    expect(result.kind).toBe('dependency_missing');
  });

  test('classifies type errors', () => {
    const result = analyzeFailure('TS2339: Property x does not exist');
    expect(result.kind).toBe('type_error');
  });

  test('falls back to unknown', () => {
    const result = analyzeFailure('something odd happened');
    expect(result.kind).toBe('unknown');
  });
});

