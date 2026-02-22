import { describe, expect, test } from 'vitest';
import {
  classifyUnhandledGatewayError,
  extractErrorCode,
  isAbortLikeError,
  isFatalGatewayError,
  isTransientGatewayError,
} from './gateway-crash-guard';

describe('gateway crash guard', () => {
  test('extracts nested error code from cause chain', () => {
    const reason = {
      message: 'top-level',
      cause: {
        message: 'nested',
        code: 'ECONNRESET',
      },
    };
    expect(extractErrorCode(reason)).toBe('ECONNRESET');
  });

  test('treats AbortError as non-fatal', () => {
    const reason = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    });
    expect(isAbortLikeError(reason)).toBe(true);
    expect(classifyUnhandledGatewayError(reason)).toBe('non_fatal');
  });

  test('treats transient fetch/network failures as non-fatal', () => {
    const reason = Object.assign(new TypeError('fetch failed'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    expect(isTransientGatewayError(reason)).toBe(true);
    expect(classifyUnhandledGatewayError(reason)).toBe('non_fatal');
  });

  test('marks OOM-family errors as fatal', () => {
    const reason = Object.assign(new Error('heap out of memory'), {
      code: 'ERR_OUT_OF_MEMORY',
    });
    expect(isFatalGatewayError(reason)).toBe(true);
    expect(classifyUnhandledGatewayError(reason)).toBe('fatal');
  });

  test('defaults unknown errors to fatal', () => {
    const reason = new Error('unexpected_internal_failure');
    expect(classifyUnhandledGatewayError(reason)).toBe('fatal');
  });
});

