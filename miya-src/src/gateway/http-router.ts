import { spawnSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function normalizeNodeHeaders(headers: IncomingMessage['headers']): HeadersInit {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      normalized[key] = value.join(', ');
    }
  }
  return normalized;
}

export function toNodeRequest(req: IncomingMessage, hostname: string, port: number): Request {
  const hostHeader =
    typeof req.headers.host === 'string' && req.headers.host.trim()
      ? req.headers.host.trim()
      : `${hostname}:${port}`;
  const requestUrl = new URL(req.url || '/', `http://${hostHeader}`);
  return new Request(requestUrl, {
    method: req.method ?? 'GET',
    headers: normalizeNodeHeaders(req.headers),
  });
}

export async function sendNodeResponse(
  req: IncomingMessage,
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  for (const [key, value] of response.headers.entries()) {
    res.setHeader(key, value);
  }
  if ((req.method ?? 'GET').toUpperCase() === 'HEAD') {
    res.end();
    return;
  }
  if (!response.body) {
    res.end();
    return;
  }
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export function reserveGatewayPort(hostname: string, configuredPort: number): number {
  if (configuredPort > 0) {
    return configuredPort;
  }
  const script = [
    "const net=require('node:net');",
    'const host=process.argv[1]||"127.0.0.1";',
    'const s=net.createServer();',
    's.listen(0,host,()=>{',
    'const address=s.address();',
    "if(address&&typeof address==='object'){process.stdout.write(String(address.port));}",
    's.close(()=>process.exit(0));',
    '});',
    "s.on('error',()=>process.exit(1));",
  ].join('');
  const probe = spawnSync('node', ['-e', script, hostname], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (probe.status !== 0) {
    throw new Error(`gateway_port_reservation_failed:${String(probe.stderr || '').trim()}`);
  }
  const reserved = Number(String(probe.stdout || '').trim());
  if (!Number.isFinite(reserved) || reserved <= 0) {
    throw new Error('gateway_port_reservation_invalid');
  }
  return Math.floor(reserved);
}
