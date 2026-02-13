import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  DEFAULT_SOUL_MARKDOWN,
  loadSoulProfile,
  saveSoulMarkdown,
  soulFilePath,
  soulPersonaLayer,
} from '../soul';

const z = tool.schema;

export function createSoulTools(projectDir: string): Record<string, ToolDefinition> {
  const miya_soul_get = tool({
    description: 'Read current SOUL profile and persona layer.',
    args: {},
    async execute() {
      const profile = loadSoulProfile(projectDir);
      return [
        `file=${soulFilePath(projectDir)}`,
        `name=${profile.name}`,
        `role=${profile.role}`,
        `tone=${profile.tone}`,
        `principles=${profile.principles.length}`,
        `behavior_rules=${profile.behaviorRules.length}`,
        `forbidden=${profile.forbidden.length}`,
        '',
        soulPersonaLayer(projectDir),
      ].join('\n');
    },
  });

  const miya_soul_set = tool({
    description: 'Replace SOUL.md content and persist persona profile.',
    args: {
      markdown: z.string().describe('Full SOUL.md markdown content'),
    },
    async execute(args) {
      const profile = saveSoulMarkdown(projectDir, String(args.markdown));
      return [
        'updated=true',
        `file=${soulFilePath(projectDir)}`,
        `name=${profile.name}`,
        `role=${profile.role}`,
      ].join('\n');
    },
  });

  const miya_soul_reset = tool({
    description: 'Reset SOUL.md to default template.',
    args: {},
    async execute() {
      const profile = saveSoulMarkdown(projectDir, DEFAULT_SOUL_MARKDOWN);
      return [
        'reset=true',
        `file=${soulFilePath(projectDir)}`,
        `name=${profile.name}`,
      ].join('\n');
    },
  });

  return {
    miya_soul_get,
    miya_soul_set,
    miya_soul_reset,
  };
}

