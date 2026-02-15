import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PERMISSION_HOOK_COMPAT,
  REQUIRED_HOOK_KEYS,
} from '../src/contracts/hook-contract';

function fail(message: string): never {
  throw new Error(`[hook-contract-check] ${message}`);
}

const repoRoot = process.cwd();
const entryPath = join(repoRoot, 'src', 'index.ts');
const source = readFileSync(entryPath, 'utf8');

for (const key of REQUIRED_HOOK_KEYS) {
  if (
    source.includes(`'${key}'`) ||
    source.includes(`"${key}"`) ||
    (key === PERMISSION_HOOK_COMPAT.observedHook &&
      source.includes('PERMISSION_OBSERVED_HOOK'))
  ) {
    continue;
  }
  fail(`missing required hook key in src/index.ts: ${key}`);
}

for (const canonical of [
  PERMISSION_HOOK_COMPAT.canonicalAsked,
  PERMISSION_HOOK_COMPAT.canonicalReplied,
]) {
  if (!source.includes(canonical)) {
    fail(`missing permission canonical event reference in src/index.ts: ${canonical}`);
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
