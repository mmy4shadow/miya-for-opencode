type GatewayCrashSeverity = 'non_fatal' | 'fatal';

interface GatewayCrashEvent {
  context: string;
  severity: GatewayCrashSeverity;
  reason: unknown;
  reasonText: string;
}

interface GatewayCrashGuardOptions {
  exitOnFatal?: boolean;
  fatalExitCode?: number;
  onEvent?: (event: GatewayCrashEvent) => void;
}

const FATAL_CODES = new Set([
  'ERR_OUT_OF_MEMORY',
  'ERR_SCRIPT_EXECUTION_TIMEOUT',
  'ERR_WORKER_OUT_OF_MEMORY',
  'ERR_WORKER_UNCAUGHT_EXCEPTION',
  'ERR_WORKER_INITIALIZATION_FAILED',
]);

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNABORTED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_DNS_RESOLVE_FAILED',
  'UND_ERR_CONNECT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function asObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractRawCode(value: unknown): string | null {
  const record = asObject(value);
  if (!record) return null;
  const codeRaw = record.code;
  if (typeof codeRaw === 'string' && codeRaw.trim().length > 0) {
    return codeRaw.trim();
  }
  return null;
}

function extractCause(value: unknown): unknown {
  const record = asObject(value);
  if (!record) return undefined;
  return record.cause;
}

export function extractErrorCode(value: unknown): string | null {
  const direct = extractRawCode(value);
  if (direct) return direct;
  const cause = extractCause(value);
  if (!cause || cause === value) return null;
  return extractErrorCode(cause);
}

export function isAbortLikeError(value: unknown): boolean {
  const record = asObject(value);
  if (!record) return false;
  const name = typeof record.name === 'string' ? record.name : '';
  if (name === 'AbortError') return true;
  const message = typeof record.message === 'string' ? record.message : '';
  if (message === 'This operation was aborted') return true;
  return false;
}

export function isTransientGatewayError(value: unknown): boolean {
  const code = extractErrorCode(value);
  if (code && TRANSIENT_NETWORK_CODES.has(code)) {
    return true;
  }
  if (value instanceof TypeError && value.message === 'fetch failed') {
    return true;
  }
  const record = asObject(value);
  if (!record) return false;
  const message = typeof record.message === 'string' ? record.message : '';
  if (/\bfetch failed\b/i.test(message)) {
    return true;
  }
  const cause = extractCause(value);
  if (cause && cause !== value && isTransientGatewayError(cause)) {
    return true;
  }
  return false;
}

export function isFatalGatewayError(value: unknown): boolean {
  const code = extractErrorCode(value);
  if (code && FATAL_CODES.has(code)) return true;
  const record = asObject(value);
  if (!record) return false;
  const message = typeof record.message === 'string' ? record.message : '';
  if (/\bout of memory\b/i.test(message)) return true;
  if (/\bheap limit\b/i.test(message)) return true;
  return false;
}

export function classifyUnhandledGatewayError(
  reason: unknown,
): GatewayCrashSeverity {
  if (isAbortLikeError(reason)) return 'non_fatal';
  if (isTransientGatewayError(reason)) return 'non_fatal';
  if (isFatalGatewayError(reason)) return 'fatal';
  return 'fatal';
}

export function formatGatewayCrashReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.stack || reason.message;
  }
  return String(reason);
}

export function installGatewayCrashGuards(
  context: string,
  options?: GatewayCrashGuardOptions,
): () => void {
  const exitOnFatal = options?.exitOnFatal !== false;
  const fatalExitCode = Number.isFinite(Number(options?.fatalExitCode))
    ? Number(options?.fatalExitCode)
    : 1;

  const emit = (severity: GatewayCrashSeverity, reason: unknown): void => {
    const reasonText = formatGatewayCrashReason(reason);
    options?.onEvent?.({ context, severity, reason, reasonText });
    if (severity === 'fatal' && exitOnFatal) {
      process.exit(fatalExitCode);
      return;
    }
    if (severity === 'fatal') {
      return;
    }
  };

  const onUnhandledRejection = (reason: unknown): void => {
    const severity = classifyUnhandledGatewayError(reason);
    emit(severity, reason);
  };

  const onUncaughtException = (error: Error): void => {
    const severity = classifyUnhandledGatewayError(error);
    emit(severity, error);
  };

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  return () => {
    process.off('unhandledRejection', onUnhandledRejection);
    process.off('uncaughtException', onUncaughtException);
  };
}

