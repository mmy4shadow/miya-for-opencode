import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED_HOOK_KEYS } from '../src/contracts/hook-contract';

function fail(message: string): never {
  throw new Error(`[hook-contract-check] ${message}`);
}

const repoRoot = process.cwd();
const entryPath = join(repoRoot, 'src', 'index.ts');
const source = readFileSync(entryPath, 'utf8');

for (const key of REQUIRED_HOOK_KEYS) {
  if (!source.includes(`'${key}'`) && !source.includes(`"${key}"`)) {
    fail(`missing required hook key in src/index.ts: ${key}`);
  }
}

for (const legacyKey of ['tool.use.before', 'tool.use.after']) {
  if (source.includes(legacyKey)) {
    fail(`legacy hook key found in src/index.ts: ${legacyKey}`);
  }
}

console.log(
  `[hook-contract-check] ok (${REQUIRED_HOOK_KEYS.length} required hooks validated)`,
);
