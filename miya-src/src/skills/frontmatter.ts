export interface SkillFrontmatter {
  name?: string;
  version?: string;
  description?: string;
  bins?: string[];
  env?: string[];
  platforms?: string[];
  permissions?: string[];
}

const LIST_KEYS = new Set(['bins', 'env', 'platforms', 'permissions']);

function normalizeScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const body =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;
  return body
    .split(',')
    .map((item) => normalizeScalar(item))
    .filter(Boolean);
}

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith('---')) {
    return {};
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== '---') {
    return {};
  }

  const endIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );
  if (endIndex === -1) {
    return {};
  }

  const result: SkillFrontmatter = {};
  let activeListKey: 'bins' | 'env' | 'platforms' | 'permissions' | undefined;
  for (const rawLine of lines.slice(1, endIndex)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (activeListKey && line.startsWith('- ')) {
      const value = normalizeScalar(line.slice(2));
      if (value) {
        const existing = result[activeListKey] ?? [];
        result[activeListKey] = [...existing, value];
      }
      continue;
    }
    activeListKey = undefined;

    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    if (key === 'name') result.name = value;
    else if (key === 'version') result.version = value;
    else if (key === 'description') result.description = value;
    else if (LIST_KEYS.has(key)) {
      const listKey = key as 'bins' | 'env' | 'platforms' | 'permissions';
      const parsed = normalizeList(value);
      if (parsed.length > 0) {
        result[listKey] = parsed;
      } else {
        result[listKey] = [];
        activeListKey = listKey;
      }
    }
  }

  return result;
}
