import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setContactTier, upsertChannelState } from './pairing-store';
import { ChannelRuntime, summarizeChannelGovernance } from './service';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-channels-service-'));
}

function validTickets() {
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  return {
    outboundSend: {
      traceID: 'trace-outbound',
      expiresAt,
    },
    desktopControl: {
      traceID: 'trace-desktop',
      expiresAt,
    },
  };
}

describe('channel runtime send policy', () => {
  test('blocks outbound send for inbound-only channels', async () => {
    const runtime = new ChannelRuntime(tempProjectDir(), {
      onInbound: () => {},
      onPairRequested: () => {},
    });

    const result = await runtime.sendMessage({
      channel: 'telegram',
      destination: '123',
      text: 'hello',
    });

    expect(result.sent).toBe(false);
    expect(result.message).toMatch(/channel_send_blocked:telegram/);
  });

  test('records outbound audit for qq desktop send attempts', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });

    setContactTier(projectDir, 'qq', 'tester', 'owner');

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
    expect(result.message.length).toBeGreaterThan(0);

    const auditFile = path.join(
      projectDir,
      '.opencode',
      'miya',
      'channels-outbound.jsonl',
    );
    expect(fs.existsSync(auditFile)).toBe(true);
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean);
    expect(rows.length).toBe(1);
    const first = JSON.parse(rows[0]) as {
      id?: string;
      channel?: string;
      sent?: boolean;
      textPreview?: string;
      payloadHash?: string;
      receiptStatus?: string;
      failureStep?: string;
      evidenceBundle?: {
        kind?: string;
        version?: string;
        destination?: string;
        screenshots?: string[];
        meta?: {
          captureMethod?: string;
          confidence?: number;
          limitations?: string[];
        };
        simulation?: {
          status?: string;
        };
      };
      semanticSummary?: {
        conclusion?: string;
        keyAssertion?: string;
        recovery?: string;
      };
    };
    expect(typeof first.id).toBe('string');
    expect(first.channel).toBe('qq');
    expect(first.sent).toBe(false);
    expect(first.textPreview).toBe('hello');
    expect(typeof first.payloadHash).toBe('string');
    expect(first.payloadHash?.length).toBe(64);
    expect(first.receiptStatus).toBe('uncertain');
    expect(typeof first.failureStep).toBe('string');
    expect(first.evidenceBundle?.kind).toBe('desktop_outbound');
    expect(first.evidenceBundle?.version).toBe('v5');
    expect(first.evidenceBundle?.destination).toBe('tester');
    expect(Array.isArray(first.evidenceBundle?.screenshots)).toBe(true);
    expect(typeof first.evidenceBundle?.meta?.captureMethod).toBe('string');
    expect(typeof first.evidenceBundle?.meta?.confidence).toBe('number');
    expect(Array.isArray(first.evidenceBundle?.meta?.limitations)).toBe(true);
    expect(typeof first.evidenceBundle?.simulation?.status).toBe('string');
    expect(typeof first.semanticSummary?.conclusion).toBe('string');
    expect(typeof first.semanticSummary?.keyAssertion).toBe('string');
    expect(typeof first.semanticSummary?.recovery).toBe('string');
  });

  test('blocks outbound send when arch advisor has not approved', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    upsertChannelState(projectDir, 'qq', {
      allowlist: ['tester'],
    });

    const result = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello',
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_blocked:arch_advisor_denied');

    const auditFile = path.join(
      projectDir,
      '.opencode',
      'miya',
      'channels-outbound.jsonl',
    );
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            message?: string;
            semanticTags?: string[];
            semanticSummary?: { conclusion?: string };
          },
      );
    const row = rows[0];
    expect(row?.message).toBe('outbound_blocked:arch_advisor_denied');
    expect(row?.semanticTags?.includes('privilege_barrier')).toBe(true);
    expect(String(row?.semanticSummary?.conclusion ?? '')).toContain(
      'Arch Advisor',
    );
  });

  test('blocks outbound send when destination is not in allowlist', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    upsertChannelState(projectDir, 'qq', {
      allowlist: ['approved-user'],
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
    expect(result.message).toMatch(/target_not_in_allowlist/);
  });

  test('throttles rapid outbound sends', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'tester', 'owner');

    const first = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello 1',
      approvalTickets: validTickets(),
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
      },
    });
    const second = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello 2',
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

  test('friend tier can only reply', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'friend-1', 'friend');

    const result = await runtime.sendMessage({
      channel: 'qq',
      destination: 'friend-1',
      text: 'hello',
      approvalTickets: validTickets(),
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
        intent: 'initiate',
      },
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_blocked:friend_tier_can_only_reply');
  });

  test('friend tier blocks sensitive content even on reply', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'friend-2', 'friend');

    const result = await runtime.sendMessage({
      channel: 'qq',
      destination: 'friend-2',
      text: 'sensitive',
      approvalTickets: validTickets(),
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
        intent: 'reply',
        containsSensitive: true,
      },
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe(
      'outbound_blocked:friend_tier_sensitive_content_denied',
    );
  });

  test('outbound send pipeline keeps local blocked-path p95 under 50ms', async () => {
    const runtime = new ChannelRuntime(tempProjectDir(), {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    const samples: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const start = Date.now();
      await runtime.sendMessage({
        channel: 'telegram',
        destination: `u-${i}`,
        text: 'hello',
      });
      samples.push(Date.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 =
      samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    expect(p95).toBeLessThan(50);
  });

  test('releases input mutex when desktop runtime throws', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(
      projectDir,
      {
        onInbound: () => {},
        onPairRequested: () => {},
      },
      {
        sendQqDesktopMessage: async () => {
          throw new Error('Desktop bridge crashed unexpectedly');
        },
      },
    );
    setContactTier(projectDir, 'qq', 'tester', 'owner');

    const first = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello',
      sessionID: 'sess-runtime-error',
      approvalTickets: validTickets(),
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
      },
    });
    expect(first.sent).toBe(false);
    expect(first.message).toContain(
      'outbound_degraded:desktop_runtime_exception:',
    );

    const secondStart = Date.now();
    const second = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello again',
      sessionID: 'sess-runtime-error',
      approvalTickets: validTickets(),
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
        bypassThrottle: true,
      },
    });
    const elapsed = Date.now() - secondStart;

    expect(second.sent).toBe(false);
    expect(second.message).toContain(
      'outbound_degraded:desktop_runtime_exception:',
    );
    expect(second.message).not.toContain('input_mutex_timeout');
    expect(elapsed).toBeLessThan(1000);
  });

  test('produces inbound-only governance summary', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });

    await runtime.sendMessage({
      channel: 'telegram',
      destination: 'abc',
      text: 'hello',
    });

    const summary = summarizeChannelGovernance(projectDir, 100);
    expect(summary.windowRows).toBeGreaterThan(0);
    expect(summary.inboundOnlyViolationAttempts).toBeGreaterThan(0);
    expect(summary.inboundOnlyInvariantMaintained).toBe(true);
  });
});
