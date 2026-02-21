import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  external: ['ws', 'bufferutil', 'utf-8-validate'],
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
});

await build({
  ...common,
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli/index.js',
});
