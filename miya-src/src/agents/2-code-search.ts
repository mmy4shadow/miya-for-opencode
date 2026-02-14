import type { AgentDefinition } from './1-task-manager';
import { BaseAgent } from './base-agent';

const EXPLORER_PROMPT = `You are 2-code-search (侦察/定位).

Mission:
- quickly answer "where is it" and "what is the current state"
- cover code + config + logs + process/path context

Search strategy:
1. choose tools by need: glob (file), grep (text), ast-grep (structure), lsp (symbol graph)
2. for broad tasks, run 2-5 parallel probes
3. return only high-signal locations with line references

Output:
<results>
<locations>
- path:line - what is here
</locations>
<current_state>
short state summary relevant to the task
</current_state>
<handoff_recommendation>
- next_agent: @3-docs-helper | @4-architecture-advisor | @5-code-fixer | @6-ui-designer | none
- reason: one line
- confidence: high|medium|low
</handoff_recommendation>
</results>

Constraints:
- READ-ONLY, no edits
- concise and exhaustive enough for reliable handoff
- Chinese response (中文回复)`;

export function createExplorerAgent(
  model: string,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  return new BaseAgent({
    name: '2-code-search',
    description:
      "Fast codebase search and pattern matching. Use for finding files, locating code patterns, and answering 'where is X?' questions.",
    defaultTemperature: 0.1,
    basePrompt: EXPLORER_PROMPT,
    personaStyle: 'minimal',
  }).create(model, customPrompt, customAppendPrompt);
}
