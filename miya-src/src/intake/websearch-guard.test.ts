import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  shouldInterceptWriteAfterWebsearch,
  trackWebsearchToolOutput,
} from './websearch-guard';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-intake-guard-'));
}

describe('websearch intake guard', () => {
  test('intercepts write-like permission after websearch result', () => {
    const projectDir = tempProjectDir();
    trackWebsearchToolOutput(
      's1',
      'websearch_web_search_exa',
      'top result: https://react.dev/reference/react/useMemo',
    );
    const result = shouldInterceptWriteAfterWebsearch(projectDir, {
      sessionID: 's1',
      permission: 'edit',
    });
    expect(result.intercept).toBe(true);
  });

  test('does not intercept non-write permission', () => {
    const projectDir = tempProjectDir();
    trackWebsearchToolOutput(
      's2',
      'websearch_web_search_exa',
      'top result: https://react.dev/learn',
    );
    const result = shouldInterceptWriteAfterWebsearch(projectDir, {
      sessionID: 's2',
      permission: 'question',
    });
    expect(result.intercept).toBe(false);
  });
});
