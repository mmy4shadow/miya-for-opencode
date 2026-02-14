import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('gateway outbound guard', () => {
  test('blocks direct channelRuntime.sendMessage calls in gateway', () => {
    const sourceFile = path.resolve(import.meta.dir, 'index.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');
    const forbidden = 'channelRuntime' + '.sendMessage(';
    expect(source.includes(forbidden)).toBe(false);
  });
});
