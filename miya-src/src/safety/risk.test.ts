import { describe, expect, test } from 'bun:test';
import {
  isSideEffectPermission,
  requiredTierForRequest,
} from './risk';

describe('safety risk tiers', () => {
  test('treats gateway side effects as side-effect permissions', () => {
    expect(isSideEffectPermission('external_message')).toBe(true);
    expect(isSideEffectPermission('desktop_control')).toBe(true);
    expect(isSideEffectPermission('node_invoke')).toBe(true);
    expect(isSideEffectPermission('skills_install')).toBe(true);
    expect(isSideEffectPermission('webhook_outbound')).toBe(true);
    expect(isSideEffectPermission('miya_autopilot')).toBe(true);
    expect(isSideEffectPermission('miya_autoflow')).toBe(true);
  });

  test('assigns thorough tier to external message and webhook', () => {
    expect(
      requiredTierForRequest({
        permission: 'external_message',
        patterns: ['channel=slack'],
      }),
    ).toBe('THOROUGH');
    expect(
      requiredTierForRequest({
        permission: 'desktop_control',
        patterns: ['channel=wechat'],
      }),
    ).toBe('THOROUGH');
    expect(
      requiredTierForRequest({
        permission: 'webhook_outbound',
        patterns: ['url=https://example.com'],
      }),
    ).toBe('THOROUGH');
  });

  test('assigns node invoke tier by capability risk', () => {
    expect(
      requiredTierForRequest({
        permission: 'node_invoke',
        patterns: ['cap=system.info'],
      }),
    ).toBe('STANDARD');
    expect(
      requiredTierForRequest({
        permission: 'node_invoke',
        patterns: ['cap=system.run'],
      }),
    ).toBe('THOROUGH');
  });

  test('assigns autopilot/autoflow risk tier from command patterns', () => {
    expect(
      requiredTierForRequest({
        permission: 'miya_autopilot',
        patterns: ['command=bun test'],
      }),
    ).toBe('STANDARD');
    expect(
      requiredTierForRequest({
        permission: 'miya_autoflow',
        patterns: ['command=git reset --hard'],
      }),
    ).toBe('THOROUGH');
  });
});
