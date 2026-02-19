import { describe, expect, test } from 'bun:test';
import { createCodeSimplicityReviewerAgent } from './7-code-simplicity-reviewer';

describe('7-code-simplicity-reviewer prompt', () => {
  test('enforces functional completeness testing in the base prompt', () => {
    const agent = createCodeSimplicityReviewerAgent('openrouter/z-ai/glm-5');
    const prompt = String(agent.config.prompt ?? '');

    expect(prompt.includes('verify functional completeness with executable tests')).toBe(
      true,
    );
    expect(prompt.includes('functional_test_plan')).toBe(true);
    expect(prompt.includes('functional_test_result')).toBe(true);
    expect(prompt.includes('If functional tests are missing or failing, do not return PASS.')).toBe(
      true,
    );
  });
});
