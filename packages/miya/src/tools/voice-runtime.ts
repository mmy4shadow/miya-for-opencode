import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { LocalVoiceRuntimeManager } from '../voice/runtime-manager';

const z = tool.schema;

function parseProviders(value?: string): Array<'coqui' | 'rvc'> {
  if (!value || !value.trim()) return ['coqui', 'rvc'];
  const parts = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const providers = parts.filter((item): item is 'coqui' | 'rvc' => item === 'coqui' || item === 'rvc');
  return providers.length > 0 ? providers : ['coqui', 'rvc'];
}

function formatStatus(payload: Awaited<ReturnType<LocalVoiceRuntimeManager['status']>>) {
  return [
    'Miya Local Voice Runtime',
    `root=${payload.root}`,
    `installed=${payload.installed}`,
    `installed_at=${payload.installedAt ?? 'n/a'}`,
    `coqui: port=${payload.coqui.port} pid=${payload.coqui.pid ?? 'none'} alive=${payload.coqui.processAlive} health=${payload.coqui.healthOk}`,
    `rvc: port=${payload.rvc.port} pid=${payload.rvc.pid ?? 'none'} alive=${payload.rvc.processAlive} health=${payload.rvc.healthOk}`,
  ].join('\n');
}

export function createVoiceRuntimeTools(): Record<string, ToolDefinition> {
  const manager = new LocalVoiceRuntimeManager();

  const miya_voice_status = tool({
    description: 'Show local voice runtime status (coqui/rvc).',
    args: {},
    async execute() {
      return formatStatus(await manager.status());
    },
  });

  const miya_voice_install = tool({
    description: 'Install embedded local voice runtime dependencies (Python venv + API server).',
    args: {
      force: z.boolean().optional().describe('Recreate virtual environment from scratch'),
    },
    async execute(args) {
      await manager.install(args.force === true);
      return formatStatus(await manager.status());
    },
  });

  const miya_voice_up = tool({
    description: 'Start local voice runtime servers for selected providers (default: coqui,rvc).',
    args: {
      providers: z.string().optional().describe('Comma-separated: coqui,rvc'),
    },
    async execute(args) {
      const providers = parseProviders(
        typeof args.providers === 'string' ? args.providers : undefined,
      );
      await manager.up(providers);
      return formatStatus(await manager.status());
    },
  });

  const miya_voice_down = tool({
    description: 'Stop local voice runtime servers for selected providers (default: all).',
    args: {
      providers: z.string().optional().describe('Comma-separated: coqui,rvc'),
    },
    async execute(args) {
      const providers = parseProviders(
        typeof args.providers === 'string' ? args.providers : undefined,
      );
      await manager.down(providers);
      return formatStatus(await manager.status());
    },
  });

  const miya_voice_doctor = tool({
    description: 'Run diagnostics for local voice runtime environment.',
    args: {},
    async execute() {
      return manager.doctor();
    },
  });

  return {
    miya_voice_status,
    miya_voice_install,
    miya_voice_up,
    miya_voice_down,
    miya_voice_doctor,
  };
}

