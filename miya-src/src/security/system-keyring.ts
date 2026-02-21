import { spawnSync } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

interface SecretEnvelope {
  version: 1;
  alg: 'dpapi' | 'aes256gcm';
  payload: string;
  iv?: string;
  tag?: string;
}

function keyFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'security', 'master.key');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function toBase64(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}

function fromBase64(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function hasPowerShell(): boolean {
  const shell = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const result = spawnSync(
    shell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$PSVersionTable.PSVersion.ToString()',
    ],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 1500,
    },
  );
  return result.status === 0;
}

function encryptWithDpapi(plainText: string): string | null {
  const shell = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const script = [
    `$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${toBase64(plainText)}'))`,
    '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
    'ConvertFrom-SecureString -SecureString $secure',
  ].join('; ');
  const result = spawnSync(
    shell,
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 2000,
    },
  );
  if (result.status !== 0) return null;
  const out = result.stdout.trim();
  return out.length > 0 ? out : null;
}

function decryptWithDpapi(blob: string): string | null {
  const shell = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const escaped = blob.replace(/'/g, "''");
  const script = [
    `$secure = ConvertTo-SecureString '${escaped}'`,
    '$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
    '$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)',
    '[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)',
    '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))',
  ].join('; ');
  const result = spawnSync(
    shell,
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 2000,
    },
  );
  if (result.status !== 0) return null;
  const out = result.stdout.trim();
  if (!out) return null;
  try {
    return fromBase64(out);
  } catch {
    return null;
  }
}

function deriveFallbackKey(projectDir: string): Buffer {
  const file = keyFile(projectDir);
  if (fs.existsSync(file)) {
    return fs.readFileSync(file);
  }
  const entropy = randomBytes(32);
  ensureDir(file);
  fs.writeFileSync(file, entropy);
  return entropy;
}

function encryptFallback(
  projectDir: string,
  plainText: string,
): SecretEnvelope {
  const key = deriveFallbackKey(projectDir);
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    createHash('sha256').update(key).digest(),
    iv,
  );
  const payload = Buffer.concat([
    cipher.update(plainText, 'utf-8'),
    cipher.final(),
  ]);
  return {
    version: 1,
    alg: 'aes256gcm',
    payload: payload.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptFallback(
  projectDir: string,
  envelope: SecretEnvelope,
): string | null {
  if (!envelope.iv || !envelope.tag) return null;
  try {
    const key = deriveFallbackKey(projectDir);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      createHash('sha256').update(key).digest(),
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.payload, 'base64')),
      decipher.final(),
    ]);
    return plain.toString('utf-8');
  } catch {
    return null;
  }
}

function encodeEnvelope(envelope: SecretEnvelope): string {
  return `miya-sec:${Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64')}`;
}

function decodeEnvelope(raw: string): SecretEnvelope | null {
  if (!raw.startsWith('miya-sec:')) return null;
  const body = raw.slice('miya-sec:'.length);
  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64').toString('utf-8'),
    ) as SecretEnvelope;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encryptSensitiveValue(
  projectDir: string,
  plainText: string,
): string {
  const normalized = String(plainText ?? '');
  if (!normalized) return normalized;

  if (process.platform === 'win32' && hasPowerShell()) {
    const dpapi = encryptWithDpapi(normalized);
    if (dpapi) {
      return encodeEnvelope({
        version: 1,
        alg: 'dpapi',
        payload: dpapi,
      });
    }
  }
  return encodeEnvelope(encryptFallback(projectDir, normalized));
}

export function decryptSensitiveValue(
  projectDir: string,
  rawValue: string,
): string {
  const raw = String(rawValue ?? '');
  if (!raw.startsWith('miya-sec:')) return raw;
  const envelope = decodeEnvelope(raw);
  if (!envelope) return raw;

  if (envelope.alg === 'dpapi') {
    const decoded = decryptWithDpapi(envelope.payload);
    return decoded ?? raw;
  }
  const fallback = decryptFallback(projectDir, envelope);
  return fallback ?? raw;
}
