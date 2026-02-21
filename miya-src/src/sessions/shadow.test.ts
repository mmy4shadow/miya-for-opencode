import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendShadowSessionLog, shouldRouteToShadowSession } from './shadow';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-shadow-session-'));
}

describe('shadow session routing', () => {
  test('routes long output to shadow session', () => {
    expect(
      shouldRouteToShadowSession({
        tool: 'bash',
        output: 'x'.repeat(3000),
      }),
    ).toBe(true);
  });

  test('writes shadow session archive record', () => {
    const projectDir = tempProjectDir();
    const archive = appendShadowSessionLog({
      projectDir,
      sessionID: 'main',
      tool: 'bash',
      callID: 'call-1',
      output: 'hello',
    });
    expect(fs.existsSync(archive)).toBe(true);
    const content = fs.readFileSync(archive, 'utf-8');
    expect(content).toContain('"tool":"bash"');
  });
});
