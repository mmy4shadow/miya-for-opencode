/**
 * Post-Write simplicity nudge - appends a compact review reminder after write/edit tools.
 * Disabled unless slimCompat.enablePostWriteSimplicityNudge is enabled.
 */

const NUDGE =
  '\n\n---\nPost-write check: run @7-code-simplicity-reviewer for complexity/comment cleanup before final response.';

const WRITE_TOOLS = new Set([
  'write',
  'edit',
  'multiedit',
  'ast_grep_replace',
]);

interface ToolExecuteAfterInput {
  tool: string;
}

interface ToolExecuteAfterOutput {
  output: string;
}

export function createPostWriteSimplicityHook() {
  return {
    'tool.execute.after': async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput,
    ): Promise<void> => {
      const tool = String(input.tool ?? '').toLowerCase();
      if (!WRITE_TOOLS.has(tool)) {
        return;
      }
      output.output = String(output.output ?? '') + NUDGE;
    },
  };
}
