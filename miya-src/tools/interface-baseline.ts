import {
  collectInterfaceCapabilityBaseline,
  readBaselineFile,
  writeBaselineFile,
} from './interface-baseline-lib';

const args = new Set(process.argv.slice(2));
const writeMode = args.has('--write');

const baseline = collectInterfaceCapabilityBaseline(process.cwd());
if (writeMode) {
  writeBaselineFile(baseline);
  console.log('[baseline] refreshed interface-capability-baseline.json');
  console.log(JSON.stringify(baseline.counts));
  process.exit(0);
}

const existing = readBaselineFile();
if (!existing) {
  console.log(
    '[baseline] no existing baseline file; pass --write to create one',
  );
  process.exit(1);
}

console.log('[baseline] current counts', JSON.stringify(baseline.counts));
console.log('[baseline] stored counts', JSON.stringify(existing.counts));
