import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const METHOD_WRAPPER_FILES = [
  'src/gateway/methods/channels.ts',
  'src/gateway/methods/security.ts',
  'src/gateway/methods/nodes.ts',
  'src/gateway/methods/companion.ts',
  'src/gateway/methods/memory.ts',
];

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('partial implementation gap analysis', () => {
  test('gateway domain split remains wrapper-first and is explicitly documented as in progress', () => {
    const wrapperOnlyFiles = METHOD_WRAPPER_FILES.filter((file) => {
      const content = readFile(file);
      const hasDomainWrapperHelper =
        /registerDomainMethods\s*\(/.test(content) ||
        /registerGatewayDomainMethods\s*\(/.test(content);
      const hasRegisterCallbackArg =
        /register:\s*\(methods:\s*GatewayMethodRegistry\)\s*=>\s*void/.test(
          content,
        );
      return hasDomainWrapperHelper && hasRegisterCallbackArg;
    });

    expect(wrapperOnlyFiles.length).toBeGreaterThan(0);

    const planningDoc = fs.readFileSync(
      path.join(process.cwd(), '..', 'Miya插件开发完整项目规划.md'),
      'utf-8',
    );
    expect(planningDoc).toContain('网关按域拆分：进行中');
  });
});
