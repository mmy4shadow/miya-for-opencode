import { describe, expect, test } from 'bun:test';
import { createPostWriteSimplicityHook } from './index';

describe('post-write simplicity hook', () => {
  test('appends nudge for write tool', async () => {
    const hook = createPostWriteSimplicityHook();
    const output = { output: 'done' };
    await hook['tool.execute.after']({ tool: 'write' }, output);
    expect(output.output.includes('7-code-simplicity-reviewer')).toBe(true);
  });

  test('ignores read tool', async () => {
    const hook = createPostWriteSimplicityHook();
    const output = { output: 'content' };
    await hook['tool.execute.after']({ tool: 'read' }, output);
    expect(output.output).toBe('content');
  });
});
