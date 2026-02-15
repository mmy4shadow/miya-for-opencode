export const PERMISSION_OBSERVED_HOOK = 'permission.ask' as const;
export const PERMISSION_CANONICAL_EVENTS = {
  asked: 'permission.asked',
  replied: 'permission.replied',
} as const;

export interface PermissionObservedInput {
  sessionID?: string;
  type?: string;
  pattern?: string[] | string;
  metadata?: unknown;
  messageID?: string;
  callID?: string;
}

export interface PermissionObservedOutput {
  status?: 'allow' | 'ask' | 'deny';
}

export interface PermissionLifecycleEvent {
  event:
    | typeof PERMISSION_CANONICAL_EVENTS.asked
    | typeof PERMISSION_CANONICAL_EVENTS.replied;
  at: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  messageID?: string;
  callID?: string;
  metadata?: unknown;
  status?: 'allow' | 'ask' | 'deny';
}

export function adaptPermissionLifecycle(
  input: PermissionObservedInput,
  output: PermissionObservedOutput,
): {
  asked: PermissionLifecycleEvent;
  replied: PermissionLifecycleEvent;
} {
  const patterns = Array.isArray(input.pattern)
    ? input.pattern.map(String)
    : typeof input.pattern === 'string'
      ? [String(input.pattern)]
      : [];
  const base = {
    at: new Date().toISOString(),
    sessionID: String(input.sessionID ?? 'main'),
    permission: String(input.type ?? ''),
    patterns,
    messageID: input.messageID ? String(input.messageID) : undefined,
    callID: input.callID ? String(input.callID) : undefined,
    metadata: input.metadata,
  };
  return {
    asked: {
      ...base,
      event: PERMISSION_CANONICAL_EVENTS.asked,
    },
    replied: {
      ...base,
      event: PERMISSION_CANONICAL_EVENTS.replied,
      status:
        output.status === 'allow' || output.status === 'ask' || output.status === 'deny'
          ? output.status
          : undefined,
    },
  };
}
