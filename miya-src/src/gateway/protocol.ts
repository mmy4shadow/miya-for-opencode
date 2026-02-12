export type GatewayClientRole = 'ui' | 'admin' | 'node' | 'channel' | 'unknown';

export interface HelloFrame {
  type: 'hello';
  role?: GatewayClientRole;
  clientID?: string;
  protocolVersion?: string;
  auth?: { token?: string };
  capabilities?: string[];
}

export interface RequestFrame {
  type: 'request';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ResponseFrame {
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload: unknown;
  stateVersion?: Record<string, number>;
}

export type GatewayIncomingFrame = HelloFrame | RequestFrame;

export interface GatewayMethodContext {
  clientID: string;
  role: GatewayClientRole;
}

export type GatewayMethodHandler = (
  params: Record<string, unknown>,
  context: GatewayMethodContext,
) => Promise<unknown> | unknown;

export class GatewayMethodRegistry {
  private handlers = new Map<string, GatewayMethodHandler>();

  register(method: string, handler: GatewayMethodHandler): void {
    this.handlers.set(method, handler);
  }

  async invoke(
    method: string,
    params: Record<string, unknown>,
    context: GatewayMethodContext,
  ): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) {
      throw new Error(`unknown_method:${method}`);
    }
    return await handler(params, context);
  }

  list(): string[] {
    return [...this.handlers.keys()].sort();
  }
}

export function parseIncomingFrame(message: unknown): {
  frame?: GatewayIncomingFrame;
  error?: string;
} {
  let payload: unknown;
  if (typeof message === 'string') {
    const raw = message.trim();
    if (!raw) return { error: 'empty_message' };
    if (raw === 'status') {
      return {
        frame: {
          type: 'request',
          id: 'legacy-status',
          method: 'gateway.status.get',
          params: {},
        },
      };
    }
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return { error: 'invalid_json' };
    }
  } else if (message && typeof message === 'object') {
    payload = message;
  } else {
    return { error: 'unsupported_payload' };
  }

  if (!payload || typeof payload !== 'object') {
    return { error: 'invalid_payload' };
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.type === 'hello') {
    return {
      frame: {
        type: 'hello',
        role: normalizeRole(candidate.role),
        clientID:
          typeof candidate.clientID === 'string' ? candidate.clientID : undefined,
        protocolVersion:
          typeof candidate.protocolVersion === 'string'
            ? candidate.protocolVersion
            : undefined,
        auth:
          candidate.auth && typeof candidate.auth === 'object'
            ? {
                token:
                  typeof (candidate.auth as Record<string, unknown>).token ===
                  'string'
                    ? String((candidate.auth as Record<string, unknown>).token)
                    : undefined,
              }
            : undefined,
        capabilities: Array.isArray(candidate.capabilities)
          ? candidate.capabilities.map(String)
          : undefined,
      },
    };
  }

  if (candidate.type === 'request') {
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    const method = typeof candidate.method === 'string' ? candidate.method : '';
    if (!id || !method) {
      return { error: 'invalid_request_frame' };
    }
    return {
      frame: {
        type: 'request',
        id,
        method,
        params:
          candidate.params && typeof candidate.params === 'object'
            ? (candidate.params as Record<string, unknown>)
            : {},
      },
    };
  }

  return { error: 'unsupported_frame_type' };
}

export function toResponseFrame(input: {
  id: string;
  ok: boolean;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: unknown;
}): ResponseFrame {
  if (input.ok) {
    return {
      type: 'response',
      id: input.id,
      ok: true,
      result: input.result,
    };
  }

  return {
    type: 'response',
    id: input.id,
    ok: false,
    error: {
      code: input.errorCode ?? 'internal_error',
      message: input.errorMessage ?? 'Internal error',
      details: input.errorDetails,
    },
  };
}

export function toEventFrame(input: {
  event: string;
  payload: unknown;
  stateVersion?: Record<string, number>;
}): EventFrame {
  return {
    type: 'event',
    event: input.event,
    payload: input.payload,
    stateVersion: input.stateVersion,
  };
}

function normalizeRole(role: unknown): GatewayClientRole {
  if (role === 'ui' || role === 'admin' || role === 'node' || role === 'channel') {
    return role;
  }
  return 'unknown';
}
