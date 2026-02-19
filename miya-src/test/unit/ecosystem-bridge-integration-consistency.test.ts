import { describe, expect, test } from 'bun:test';
import {
  getEcosystemBridgeEntry,
  listEcosystemBridgeRegistry,
} from '../../src/compat/ecosystem-bridge-registry';

describe('ecosystem bridge integration consistency', () => {
  test('registry does not contain deprecated media side-effect token', () => {
    const entries = listEcosystemBridgeRegistry();
    for (const entry of entries) {
      expect(entry.permissionMetadata.sideEffects).not.toContain(
        'media_generation',
      );
    }
  });

  test('open-llm-vtuber requires media_generate policy domain', () => {
    const entry = getEcosystemBridgeEntry('open-llm-vtuber');
    expect(entry).toBeTruthy();
    expect(entry?.permissionMetadata.requiredDomains).toContain(
      'media_generate',
    );
  });

  test('list operation returns defensive copies', () => {
    const first = listEcosystemBridgeRegistry();
    first[0]!.tags.push('mutated-tag');
    first[0]!.permissionMetadata.sideEffects.push('mutated-effect');

    const second = listEcosystemBridgeRegistry();
    expect(second[0]!.tags).not.toContain('mutated-tag');
    expect(second[0]!.permissionMetadata.sideEffects).not.toContain(
      'mutated-effect',
    );
  });
});

