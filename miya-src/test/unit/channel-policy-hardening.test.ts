import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setContactTier } from '../../src/channels/pairing-store';
import { ChannelRuntime } from '../../src/channels/service';
import { readPolicy } from '../../src/policy';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-policy-hardening-'));
}

function policyFile(projectDir: string): string {
  return path.join(projectDir, '.opencode', 'miya', 'policy.json');
}

function writeRawPolicy(projectDir: string, payload: unknown): void {
  const file = policyFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function validTickets() {
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  return {
    outboundSend: { traceID: 'trace-outbound', expiresAt },
    desktopControl: { traceID: 'trace-desktop', expiresAt },
  };
}

describe('policy hardening and channel integration boundaries', () => {
  test('sanitizes malformed policy values to safe defaults', () => {
    const projectDir = tempProjectDir();
    writeRawPolicy(projectDir, {
      version: 1,
      domains: {
        outbound_send: 'paused',
        memory_write: 'invalid_state',
      },
      outbound: {
        allowedChannels: ['qq', 'telegram', 123],
        requireArchAdvisorApproval: 'yes',
        requireAllowlist: false,
        minIntervalMs: 'oops',
        burstWindowMs: 'oops',
        burstLimit: 0,
        duplicateWindowMs: -100,
      },
    });

    const policy = readPolicy(projectDir);
    expect(policy.domains.outbound_send).toBe('paused');
    expect(policy.domains.memory_write).toBe('running');
    expect(policy.outbound.allowedChannels).toEqual(['qq']);
    expect(policy.outbound.requireArchAdvisorApproval).toBe(true);
    expect(policy.outbound.requireAllowlist).toBe(false);
    expect(policy.outbound.minIntervalMs).toBe(4000);
    expect(policy.outbound.burstWindowMs).toBe(60000);
    expect(policy.outbound.burstLimit).toBe(1);
    expect(policy.outbound.duplicateWindowMs).toBe(1000);
  });

  test('blocks desktop outbound channel when disallowed by policy', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'tester', 'owner');

    writeRawPolicy(projectDir, {
      version: 1,
      outbound: {
        allowedChannels: ['wechat'],
      },
    });

    const result = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello',
      approvalTickets: validTickets(),
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
      },
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_blocked:channel_not_allowed_by_policy:qq');
  });

  test('keeps throttle guard active when policy numeric fields are malformed', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'tester', 'owner');

    writeRawPolicy(projectDir, {
      version: 1,
      outbound: {
        allowedChannels: ['qq'],
        minIntervalMs: 'NaN',
        burstWindowMs: 'NaN',
        burstLimit: 'NaN',
        duplicateWindowMs: 'NaN',
      },
    });

    const first = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello-1',
      approvalTickets: validTickets(),
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
      },
    });

    const second = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello-2',
      approvalTickets: validTickets(),
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
      },
    });

    expect(first.message.length).toBeGreaterThan(0);
    expect(second.sent).toBe(false);
    expect(second.message).toMatch(/outbound_blocked:throttled:/);
  });
});
