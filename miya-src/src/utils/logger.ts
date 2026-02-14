import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const logFile = path.join(os.tmpdir(), 'miya.log');

function sanitizeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return String(value);
  return value;
}

function stringifyLogData(data: unknown): string {
  if (typeof data === 'undefined') return '';
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(data, (_key, value) => {
      const sanitized = sanitizeLogValue(value);
      if (sanitized && typeof sanitized === 'object') {
        if (seen.has(sanitized as object)) return '[circular]';
        seen.add(sanitized as object);
      }
      return sanitized;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      logger_error: 'log_serialize_failed',
      message,
    });
  }
}

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString();
    const payload = stringifyLogData(data);
    const logEntry = `[${timestamp}] ${message}${payload ? ` ${payload}` : ''}\n`;
    fs.appendFileSync(logFile, logEntry);
  } catch {
    // Silently ignore logging errors
  }
}
