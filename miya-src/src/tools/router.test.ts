import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRouterTools } from './router';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-router-tools-'));
}

describe('router tools', () => {
  test('miya_route_intent reports orchestration fields', async () => {
    const projectDir = tempProjectDir();
    const tools = createRouterTools(projectDir);
    const output = String(
      await tools.miya_route_intent.execute({
        text: '请查找并修复类型问题，同时评估架构风险。',
        session_id: 's1',
      }),
    );

    expect(output).toContain('planned_agents=');
    expect(output).toContain('max_agents=');
    expect(output).toContain('context_strategy=');
    expect(output).toContain('requires_multiple_steps=');
    expect(output).toContain('enable_early_exit=');
  });
});
