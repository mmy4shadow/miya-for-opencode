import { describe, expect, test } from 'bun:test';
import { getEcosystemBridgeEntry, listEcosystemBridgeRegistry } from './ecosystem-bridge-registry';

describe('ecosystem bridge registry', () => {
  test('lists pinned entries with required governance fields', () => {
    const entries = listEcosystemBridgeRegistry();
    expect(entries.length).toBeGreaterThanOrEqual(10);
    const openclaw = entries.find((entry) => entry.id === 'openclaw');
    expect(openclaw).toBeTruthy();
    expect(openclaw?.versionPolicy.pinRequired).toBe(true);
    expect(openclaw?.auditFields.includes('policyHash')).toBe(true);
  });

  test('resolves a single entry by id', () => {
    const item = getEcosystemBridgeEntry('OpenClaw');
    expect(item?.id).toBe('openclaw');
  });
});
