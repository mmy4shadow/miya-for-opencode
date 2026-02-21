import { describe, expect, test } from 'vitest';
import { deriveDesktopFailureDetail } from './shared';

describe('desktop outbound error detail parsing', () => {
  test('prefers structured error from script signal', () => {
    const detail = deriveDesktopFailureDetail({
      signal:
        'desktop_send_fail|step=send.text_commit|error=input_mutex_timeout:user_active',
      stdout:
        'desktop_send_fail|step=send.text_commit|error=input_mutex_timeout:user_active',
      stderr: '',
      timedOut: false,
      exitCode: 2,
    });
    expect(detail).toBe('input_mutex_timeout:user_active');
  });

  test('falls back to timeout only when no explicit detail exists', () => {
    const detail = deriveDesktopFailureDetail({
      signal: '',
      stdout: '',
      stderr: '',
      timedOut: true,
      exitCode: 2,
    });
    expect(detail).toBe('timeout');
  });

  test('falls back to exit code when not timed out and no output exists', () => {
    const detail = deriveDesktopFailureDetail({
      signal: '',
      stdout: '',
      stderr: '',
      timedOut: false,
      exitCode: 7,
    });
    expect(detail).toBe('exit_7');
  });
});
