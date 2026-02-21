export function normalizeControlUiBasePath(basePath?: string): string {
  if (!basePath) return '';
  let normalized = basePath.trim();
  if (!normalized) return '';
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized === '/') return '';
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}
