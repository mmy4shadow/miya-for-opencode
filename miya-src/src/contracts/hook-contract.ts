import type { Hooks } from '@opencode-ai/plugin';
import {
  PERMISSION_CANONICAL_EVENTS,
  PERMISSION_OBSERVED_HOOK,
} from './permission-events';

export const REQUIRED_HOOK_KEYS = [
  'tool.execute.before',
  'tool.execute.after',
  PERMISSION_OBSERVED_HOOK,
] as const satisfies ReadonlyArray<keyof Hooks>;

export const PERMISSION_HOOK_COMPAT = {
  observedHook: PERMISSION_OBSERVED_HOOK,
  canonicalAsked: PERMISSION_CANONICAL_EVENTS.asked,
  canonicalReplied: PERMISSION_CANONICAL_EVENTS.replied,
} as const;

type RequiredHookKey = (typeof REQUIRED_HOOK_KEYS)[number];

export function assertRequiredHookHandlers(
  hooks: Partial<Record<RequiredHookKey, unknown>>,
): void {
  const missing = REQUIRED_HOOK_KEYS.filter((key) => typeof hooks[key] !== 'function');
  if (missing.length > 0) {
    throw new Error(`miya_hook_contract_missing:${missing.join(',')}`);
  }
}
