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
  authToken?: string;
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
  if (relPath.includes('\\')) return false;
  const normalized = path.posix.normalize(relPath);
  if (path.posix.isAbsolute(normalized)) return false;
  if (normalized.startsWith('../') || normalized === '..') return false;
  if (normalized.includes('\0')) return false;
  return true;
}

function resolveRequestedFile(
  pathname: string,
  basePath: string,
):
  | {
      requestedFile: string;
      isAssetRequest: boolean;
      decodeFailed: boolean;
    }
  | null {
  if (basePath) {
    if (pathname === basePath) {
      return {
        requestedFile: 'index.html',
        isAssetRequest: false,
        decodeFailed: false,
      };
    }
    if (!pathname.startsWith(`${basePath}/`)) return null;
    pathname = pathname.slice(basePath.length);
  }

  if (!pathname.startsWith('/')) return null;
  if (pathname === '/' || pathname === '') {
    return {
      requestedFile: 'index.html',
      isAssetRequest: false,
      decodeFailed: false,
    };
  }

  const assetsIndex = pathname.indexOf('/assets/');
  const isAssetRequest = assetsIndex >= 0;
  const rel =
    assetsIndex >= 0 ? pathname.slice(assetsIndex + 1) : pathname.slice(1);
  const requested = rel && !rel.endsWith('/') ? rel : `${rel}index.html`;
  const decoded = (() => {
    try {
      return { value: decodeURIComponent(requested), failed: false };
    } catch {
      return { value: '', failed: true };
    }
  })();
  return {
    requestedFile: decoded.value || 'index.html',
    isAssetRequest,
    decodeFailed: decoded.failed,
  };
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

export function createControlUiRequestOptions(
  projectDir: string,
  authToken?: string,
): ControlUiRequestOptions {
  return {
    basePath: normalizeControlUiBasePath(process.env.MIYA_GATEWAY_UI_BASE_PATH),
    root: resolveRootState(projectDir),
    authToken,
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
  const resolvedRequest = resolveRequestedFile(pathname, basePath);
  if (!resolvedRequest) return null;
  if (resolvedRequest.decodeFailed) {
    return textResponse(400, 'Bad Request');
  }
  const requestedFile = resolvedRequest.requestedFile;
  const isHtmlEntry = requestedFile === 'index.html';
  const currentToken = url.searchParams.get('token')?.trim() ?? '';
  const authToken = String(opts?.authToken ?? '').trim();
  if (isHtmlEntry && authToken && !currentToken) {
    const nextUrl = new URL(request.url);
    nextUrl.searchParams.set('token', authToken);
    return Response.redirect(nextUrl.toString(), 302);
  }
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
  const relFromRoot = path.relative(root.path, filePath);
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
    return textResponse(404, 'Not Found');
  }

  const indexPath = path.join(root.path, 'index.html');
  const hasRequestedFile =
    fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  if (!hasRequestedFile && resolvedRequest.isAssetRequest) {
    return textResponse(404, 'Asset Not Found');
  }
  const resolvedPath = hasRequestedFile ? filePath : indexPath;
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    return textResponse(404, 'Not Found');
  }

  const headers = securityHeaders(
    contentTypeForExt(path.extname(resolvedPath).toLowerCase()),
  );
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(fs.readFileSync(resolvedPath), {
    status: 200,
    headers,
  });
}
