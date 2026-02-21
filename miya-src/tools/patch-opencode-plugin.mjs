import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const target = path.join(
  process.cwd(),
  'node_modules',
  '@opencode-ai',
  'plugin',
  'dist',
  'index.js',
);

if (!existsSync(target)) {
  process.stdout.write(`[patch-opencode-plugin] skip: missing ${target}\n`);
  process.exit(0);
}

const content = readFileSync(target, 'utf-8');
if (content.includes('export * from "./tool.js";')) {
  process.stdout.write('[patch-opencode-plugin] already patched\n');
  process.exit(0);
}

const patched = content.replace('export * from "./tool";', 'export * from "./tool.js";');
if (patched === content) {
  process.stdout.write('[patch-opencode-plugin] skip: unexpected source format\n');
  process.exit(0);
}

writeFileSync(target, patched, 'utf-8');
process.stdout.write('[patch-opencode-plugin] patched @opencode-ai/plugin dist/index.js\n');
