import {
  collectInterfaceCapabilityBaseline,
  readBaselineFile,
} from './interface-baseline-lib';

function missing(base: string[], current: string[]): string[] {
  const currentSet = new Set(current);
  return base.filter((item) => !currentSet.has(item));
}

const baseline = readBaselineFile();
if (!baseline) {
  throw new Error(
    '[no-regression] missing baseline/interface-capability-baseline.json',
  );
}

const current = collectInterfaceCapabilityBaseline(process.cwd());
const violations: string[] = [];

const gatewayMissing = missing(baseline.gatewayMethods, current.gatewayMethods);
const daemonMissing = missing(baseline.daemonMethods, current.daemonMethods);
const toolMissing = missing(baseline.toolIDs, current.toolIDs);
const settingsMissing = missing(baseline.settingsKeys, current.settingsKeys);

if (gatewayMissing.length > 0) {
  violations.push(
    `[gateway] missing methods (${gatewayMissing.length}): ${gatewayMissing.join(', ')}`,
  );
}
if (daemonMissing.length > 0) {
  violations.push(
    `[daemon] missing methods (${daemonMissing.length}): ${daemonMissing.join(', ')}`,
  );
}
if (toolMissing.length > 0) {
  violations.push(
    `[tools] missing tool IDs (${toolMissing.length}): ${toolMissing.join(', ')}`,
  );
}
if (settingsMissing.length > 0) {
  violations.push(
    `[settings] missing keys (${settingsMissing.length}): ${settingsMissing.join(', ')}`,
  );
}
if (current.counts.totalCapabilities < baseline.counts.totalCapabilities) {
  violations.push(
    `[capabilities] total decreased: baseline=${baseline.counts.totalCapabilities}, current=${current.counts.totalCapabilities}`,
  );
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`[no-regression] ${violation}`);
  }
  throw new Error(
    `[no-regression] failed with ${violations.length} violation(s)`,
  );
}

console.log('[no-regression] ok');
console.log(
  JSON.stringify(
    { baseline: baseline.counts, current: current.counts },
    null,
    2,
  ),
);
