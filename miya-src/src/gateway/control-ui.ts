import fs from 'node:fs';
import path from 'node:path';
import { normalizeControlUiBasePath } from './control-ui-shared';

type ControlUiRootState =
  | { kind: 'resolved'; path: string }
  | { kind: 'invalid'; path: string }
  | { kind: 'missing' };

type ControlUiRequestOptions = {
  basePath?: string;
  root?: ControlUiRootState;
};

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function securityHeaders(contentType?: string): HeadersInit {
  const headers: Record<string, string> = {
    'cache-control': 'no-cache',
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  };
  if (contentType) headers['content-type'] = contentType;
  return headers;
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: securityHeaders('text/plain; charset=utf-8'),
  });
}

function isSafeRelativePath(relPath: string): boolean {
  if (!relPath) return false;
  const normalized = path.posix.normalize(relPath);
  if (normalized.startsWith('../') || normalized === '..') return false;
  if (normalized.includes('\0')) return false;
  return true;
}

function resolveRequestedFile(pathname: string, basePath: string): string | null {
  if (basePath) {
    if (pathname === basePath) return 'index.html';
    if (!pathname.startsWith(`${basePath}/`)) return null;
    pathname = pathname.slice(basePath.length);
  }

  if (!pathname.startsWith('/')) return null;
  if (pathname === '/' || pathname === '') return 'index.html';

  const assetsIndex = pathname.indexOf('/assets/');
  const rel = assetsIndex >= 0 ? pathname.slice(assetsIndex + 1) : pathname.slice(1);
  const requested = rel && !rel.endsWith('/') ? rel : `${rel}index.html`;
  return requested || 'index.html';
}

function resolveRootState(projectDir: string): ControlUiRootState {
  const envRoot = process.env.MIYA_GATEWAY_UI_ROOT?.trim();
  const candidates = envRoot
    ? [envRoot]
    : [
        path.join(projectDir, 'miya-src', 'gateway-ui', 'dist'),
        path.join(projectDir, 'gateway-ui', 'dist'),
        path.join(projectDir, '.opencode', 'miya', 'gateway-ui', 'dist'),
        path.join(projectDir, '.opencode', 'miya', 'gateway-ui'),
      ];
  for (const candidate of candidates) {
    const indexPath = path.join(candidate, 'index.html');
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return { kind: 'resolved', path: candidate };
    }
  }
  if (envRoot) return { kind: 'invalid', path: envRoot };
  return { kind: 'missing' };
}

export function createControlUiRequestOptions(projectDir: string): ControlUiRequestOptions {
  return {
    basePath: normalizeControlUiBasePath(process.env.MIYA_GATEWAY_UI_BASE_PATH),
    root: resolveRootState(projectDir),
  };
}

export function handleControlUiHttpRequest(
  request: Request,
  opts?: ControlUiRequestOptions,
): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const basePath = normalizeControlUiBasePath(opts?.basePath);
  const requestedFile = resolveRequestedFile(pathname, basePath);
  if (!requestedFile) return null;
  if (!isSafeRelativePath(requestedFile)) {
    return textResponse(404, 'Not Found');
  }

  const root = opts?.root;
  if (root?.kind === 'invalid') {
    return textResponse(
      503,
      `Control UI assets not found at ${root.path}. Set MIYA_GATEWAY_UI_ROOT to a built UI directory.`,
    );
  }
  if (root?.kind === 'missing') {
    return textResponse(
      503,
      'Control UI assets not found. Set MIYA_GATEWAY_UI_ROOT to a built UI directory.',
    );
  }
  if (!root || root.kind !== 'resolved') return null;

  const filePath = path.join(root.path, requestedFile);
  if (!filePath.startsWith(root.path)) {
    return textResponse(404, 'Not Found');
  }

  const indexPath = path.join(root.path, 'index.html');
  const resolvedPath =
    fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : indexPath;
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    return textResponse(404, 'Not Found');
  }

  const headers = securityHeaders(contentTypeForExt(path.extname(resolvedPath).toLowerCase()));
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  const body = fs.readFileSync(resolvedPath);
  return new Response(body, {
    status: 200,
    headers,
  });
}
