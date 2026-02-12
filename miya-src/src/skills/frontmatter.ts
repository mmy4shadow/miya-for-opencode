export interface SkillFrontmatter {
  name?: string;
  version?: string;
  description?: string;
  bins?: string[];
  env?: string[];
  platforms?: string[];
}

function normalizeList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
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

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIndex === -1) {
    return {};
  }

  const result: SkillFrontmatter = {};
  for (const rawLine of lines.slice(1, endIndex)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    if (key === 'name') result.name = value;
    else if (key === 'version') result.version = value;
    else if (key === 'description') result.description = value;
    else if (key === 'bins') result.bins = normalizeList(value);
    else if (key === 'env') result.env = normalizeList(value);
    else if (key === 'platforms') result.platforms = normalizeList(value);
  }

  return result;
}
