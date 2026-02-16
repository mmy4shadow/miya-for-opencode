import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  clearPlanBundleBinding,
  preparePlanBundleBinding,
  readPlanBundleBinding,
  updatePlanBundleBindingStatus,
} from './plan-bundle-binding';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-plan-bundle-binding-test-'));
}

describe('plan bundle binding', () => {
  test('prepare -> update -> clear lifecycle', () => {
    const projectDir = tempProjectDir();
    const prepared = preparePlanBundleBinding(projectDir, {
      sessionID: 'main',
      bundleId: 'pb_test_1',
      sourceTool: 'miya_autopilot',
      mode: 'work',
      riskTier: 'THOROUGH',
      policyHash: 'hash_1',
    });
    expect(prepared.status).toBe('prepared');

    const readPrepared = readPlanBundleBinding(projectDir, 'main');
    expect(readPrepared?.bundleId).toBe('pb_test_1');
    expect(readPrepared?.sourceTool).toBe('miya_autopilot');

    const running = updatePlanBundleBindingStatus(projectDir, {
      sessionID: 'main',
      status: 'running',
      bundleId: 'pb_test_1',
    });
    expect(running?.status).toBe('running');

    const completed = updatePlanBundleBindingStatus(projectDir, {
      sessionID: 'main',
      status: 'completed',
      bundleId: 'pb_test_1',
    });
    expect(completed?.status).toBe('completed');

    clearPlanBundleBinding(projectDir, 'main');
    expect(readPlanBundleBinding(projectDir, 'main')).toBeNull();
  });
});

