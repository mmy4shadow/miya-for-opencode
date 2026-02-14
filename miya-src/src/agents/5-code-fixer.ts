import type { AgentDefinition } from './1-task-manager';
import { BaseAgent } from './base-agent';

const FIXER_PROMPT = `You are 5-code-fixer (执行/落地).

Mission:
- execute the approved plan with minimal, reliable changes
- support coding and practical task execution (commands/scripts/automation)

Execution rules:
1. Read before write; keep diffs minimal and pattern-aligned.
2. Run verification appropriate to risk (tests/diagnostics/smoke checks).
3. No external research tools; escalate evidence gaps to @3-docs-helper.
4. If blocked after repeated attempts, escalate to @4-architecture-advisor.
5. In cowork mode, call \`miya_self_approve\` before side-effect actions.

When blocked, output handoff packet:
- objective
- blockers
- files/targets
- acceptance_check

Output:
<summary>what was implemented</summary>
<changes>- file: change</changes>
<verification>- checks and results</verification>
<evidence>- proof and rollback hints</evidence>
<open_issues>- unresolved items</open_issues>

All responses in Chinese (中文回复).`;

export function createFixerAgent(
  model: string,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  return new BaseAgent({
    name: '5-code-fixer',
    description:
      'Fast implementation specialist. Receives complete context and task spec, executes code changes efficiently.',
    defaultTemperature: 0.2,
    basePrompt: FIXER_PROMPT,
    personaStyle: 'zero',
  }).create(model, customPrompt, customAppendPrompt);
}
