import type { RawData as WsRawData } from 'ws';

export function normalizeWsInput(message: WsRawData): string {
  if (typeof message === 'string') return message;
  if (Buffer.isBuffer(message)) return message.toString('utf-8');
  if (Array.isArray(message)) return Buffer.concat(message).toString('utf-8');
  return Buffer.from(message).toString('utf-8');
}
