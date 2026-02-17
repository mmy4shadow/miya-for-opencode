import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';

export interface InterfaceCapabilityBaseline {
  version: 1;
  generatedAt: string;
  counts: {
    gatewayMethods: number;
    daemonMethods: number;
    toolIDs: number;
    settingsKeys: number;
    totalCapabilities: number;
  };
  gatewayMethods: string[];
  daemonMethods: string[];
  toolIDs: string[];
  settingsKeys: string[];
  capabilities: string[];
}

export const BASELINE_FILE = join(process.cwd(), 'baseline', 'interface-capability-baseline.json');

function uniqSorted(input: string[]): string[] {
  return [...new Set(input.map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function readText(file: string): string {
  return readFileSync(file, 'utf-8');
}

function extractByRegex(content: string, regex: RegExp): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null = regex.exec(content);
  while (match) {
    out.push(String(match[1] ?? ''));
    match = regex.exec(content);
  }
  return out;
}

function walkTsFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
        continue;
      }
      if (entry.isFile() && next.endsWith('.ts')) out.push(next);
    }
  }
  return out;
}

export function collectInterfaceCapabilityBaseline(repoRoot = process.cwd()): InterfaceCapabilityBaseline {
  const gatewayPath = join(repoRoot, 'src', 'gateway', 'index.ts');
  const daemonPath = join(repoRoot, 'src', 'daemon', 'host.ts');
  const settingsPath = join(repoRoot, 'src', 'settings', 'registry.ts');
  const toolsDir = join(repoRoot, 'src', 'tools');
  const settingsToolsPath = join(repoRoot, 'src', 'settings', 'tools.ts');

  const gatewayContent = readText(gatewayPath);
  const daemonContent = readText(daemonPath);
  const settingsContent = readText(settingsPath);

  const gatewayMethods = uniqSorted(
    extractByRegex(gatewayContent, /methods\.register\('([^']+)'/g),
  );
  const daemonMethods = uniqSorted(
    extractByRegex(daemonContent, /if \(method === '([^']+)'\)/g),
  );
  const settingsKeys = uniqSorted(
    extractByRegex(settingsContent, /key:\s*'([^']+)'/g),
  );

  const toolFiles = uniqSorted([
    ...walkTsFiles(toolsDir),
    settingsToolsPath,
    gatewayPath,
  ]);
  const toolIDs = uniqSorted(
    toolFiles.flatMap((file) => {
      const content = readText(file);
      return [
        ...extractByRegex(content, /\bconst\s+([A-Za-z0-9_]+)\s*=\s*tool\(/g),
        ...extractByRegex(content, /\bexport\s+const\s+([A-Za-z0-9_]+)(?::[^=]+)?=\s*tool\(/g),
      ];
    }),
  );

  const capabilities = uniqSorted([
    ...gatewayMethods.map((item) => `gateway:${item}`),
    ...daemonMethods.map((item) => `daemon:${item}`),
    ...toolIDs.map((item) => `tool:${item}`),
    ...settingsKeys.map((item) => `setting:${item}`),
  ]);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    counts: {
      gatewayMethods: gatewayMethods.length,
      daemonMethods: daemonMethods.length,
      toolIDs: toolIDs.length,
      settingsKeys: settingsKeys.length,
      totalCapabilities: capabilities.length,
    },
    gatewayMethods,
    daemonMethods,
    toolIDs,
    settingsKeys,
    capabilities,
  };
}

export function writeBaselineFile(baseline: InterfaceCapabilityBaseline): void {
  fs.mkdirSync(join(process.cwd(), 'baseline'), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
}

export function readBaselineFile(): InterfaceCapabilityBaseline | null {
  if (!existsSync(BASELINE_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')) as InterfaceCapabilityBaseline;
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}
