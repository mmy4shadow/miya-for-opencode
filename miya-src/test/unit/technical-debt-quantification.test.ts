import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const methodsDir = path.join(
  import.meta.dir,
  '..',
  '..',
  'src',
  'gateway',
  'methods',
);

describe('technical debt quantification', () => {
  test('gateway domain registration logic has single shared implementation', () => {
    const files = fs
      .readdirSync(methodsDir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.join(methodsDir, file));

    const inlineDefinitions = files
      .map((file) => fs.readFileSync(file, 'utf-8'))
      .reduce((count, source) => {
        if (!source.includes('function registerDomainMethods(')) return count;
        return count + 1;
      }, 0);

    expect(inlineDefinitions).toBe(0);

    const helperFile = path.join(methodsDir, 'domain-registration.ts');
    const helperSource = fs.readFileSync(helperFile, 'utf-8');
    expect(helperSource.includes('export function registerGatewayDomainMethods')).toBe(
      true,
    );
  });
});
