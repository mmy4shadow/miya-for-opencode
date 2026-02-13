import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getNodeService } from './index';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-node-service-test-'));
}

describe('node service facade', () => {
  test('register and query node through planning path', () => {
    const projectDir = tempProjectDir();
    const service = getNodeService(projectDir);
    service.register({
      nodeID: 'node-plan',
      deviceID: 'device-plan',
      type: 'cli',
      platform: process.platform,
      capabilities: ['system.info'],
    });

    const node = service.describe('node-plan');
    expect(node?.nodeID).toBe('node-plan');
    expect(service.list().length).toBe(1);
  });
});
