export function normalizeControlUiBasePath(basePath?: string): string {
  if (!basePath) return '';
  let normalized = basePath.trim().replaceAll('\\', '/');
  if (!normalized) return '';
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/+/g, '/');
  if (normalized === '/') return '';
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  const segments = normalized.split('/').filter(Boolean);
  if (
    segments.some(
      (segment) =>
        segment === '.' || segment === '..' || segment.includes('\0'),
    )
  ) {
    return '';
  }
  return segments.length > 0 ? `/${segments.join('/')}` : '';
}
