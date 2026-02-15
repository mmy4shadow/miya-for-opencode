import type { Hooks } from '@opencode-ai/plugin';

export const REQUIRED_HOOK_KEYS = [
  'tool.execute.before',
  'tool.execute.after',
  'permission.ask',
] as const satisfies ReadonlyArray<keyof Hooks>;

type RequiredHookKey = (typeof REQUIRED_HOOK_KEYS)[number];

export function assertRequiredHookHandlers(
  hooks: Partial<Record<RequiredHookKey, unknown>>,
): void {
  const missing = REQUIRED_HOOK_KEYS.filter((key) => typeof hooks[key] !== 'function');
  if (missing.length > 0) {
    throw new Error(`miya_hook_contract_missing:${missing.join(',')}`);
  }
}
