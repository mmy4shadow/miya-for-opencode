import { describe, expect, test } from 'bun:test';
import { listEcosystemBridgeRegistry } from '../../src/compat/ecosystem-bridge-registry';

const SEMVER = /^\d+\.\d+\.\d+$/;

describe('integration and ecosystem compatibility', () => {
  test('registry entries are unique and include complete rollback metadata', () => {
    const entries = listEcosystemBridgeRegistry();
    const idSet = new Set(entries.map((entry) => entry.id));
    expect(idSet.size).toBe(entries.length);

    for (const entry of entries) {
      expect(entry.rollbackPlan.steps.length).toBeGreaterThanOrEqual(2);
      expect(entry.rollbackPlan.steps.every((step) => step.trim().length > 0)).toBeTrue();
      expect(entry.compatibilityMatrix.platforms.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('registry minimum versions use strict semver and required audit fields', () => {
    const entries = listEcosystemBridgeRegistry();
    for (const entry of entries) {
      expect(SEMVER.test(entry.compatibilityMatrix.minMiyaVersion)).toBeTrue();
      expect(SEMVER.test(entry.compatibilityMatrix.minOpenCodeVersion)).toBeTrue();
      expect(entry.auditFields.includes('policyHash')).toBeTrue();
      expect(entry.auditFields.includes('timestamp')).toBeTrue();
      expect(entry.permissionMetadata.requiredDomains.length).toBeGreaterThan(0);
    }
  });
});
