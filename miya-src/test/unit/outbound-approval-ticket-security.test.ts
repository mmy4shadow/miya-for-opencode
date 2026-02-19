import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setContactTier } from '../../src/channels/pairing-store';
import { ChannelRuntime } from '../../src/channels/service';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-approval-ticket-'));
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

describe('outbound approval ticket security', () => {
  test('blocks desktop outbound when approval tickets are missing', async () => {
    let called = false;
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(
      projectDir,
      {
        onInbound: () => {},
        onPairRequested: () => {},
      },
      {
        sendQqDesktopMessage: async () => {
          called = true;
          return {
            sent: true,
            message: 'qq_desktop_sent',
            receiptStatus: 'confirmed',
          };
        },
        analyzeDesktopOutboundEvidence: async () =>
          ({
            recipientMatch: 'matched',
            sendStatusDetected: 'sent',
            uiStyleMismatch: false,
            ocrSource: 'none',
            ocrPreview: '',
            capture: {
              method: 'unknown',
              confidence: 1,
              limitations: [],
            },
          }) as never,
      },
    );
    setContactTier(projectDir, 'qq', 'tester', 'owner');

    const result = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello',
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
      },
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_blocked:approval_ticket_missing');
    expect(called).toBe(false);
  });

  test('blocks desktop outbound when approval tickets are expired', async () => {
    let called = false;
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(
      projectDir,
      {
        onInbound: () => {},
        onPairRequested: () => {},
      },
      {
        sendQqDesktopMessage: async () => {
          called = true;
          return {
            sent: true,
            message: 'qq_desktop_sent',
            receiptStatus: 'confirmed',
          };
        },
        analyzeDesktopOutboundEvidence: async () =>
          ({
            recipientMatch: 'matched',
            sendStatusDetected: 'sent',
            uiStyleMismatch: false,
            ocrSource: 'none',
            ocrPreview: '',
            capture: {
              method: 'unknown',
              confidence: 1,
              limitations: [],
            },
          }) as never,
      },
    );
    setContactTier(projectDir, 'qq', 'tester', 'owner');

    const expiredAt = new Date(Date.now() - 1_000).toISOString();
    const result = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello',
      approvalTickets: {
        outboundSend: {
          traceID: 'trace-outbound',
          expiresAt: expiredAt,
        },
        desktopControl: {
          traceID: 'trace-desktop',
          expiresAt: expiredAt,
        },
      },
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
      },
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_blocked:approval_ticket_expired');
    expect(called).toBe(false);
  });

  test('allows desktop outbound when approval tickets are valid', async () => {
    let called = false;
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(
      projectDir,
      {
        onInbound: () => {},
        onPairRequested: () => {},
      },
      {
        sendQqDesktopMessage: async () => {
          called = true;
          return {
            sent: true,
            message: 'qq_desktop_sent',
            receiptStatus: 'confirmed',
          };
        },
        analyzeDesktopOutboundEvidence: async () =>
          ({
            recipientMatch: 'matched',
            sendStatusDetected: 'sent',
            uiStyleMismatch: false,
            ocrSource: 'none',
            ocrPreview: '',
            capture: {
              method: 'unknown',
              confidence: 1,
              limitations: [],
            },
          }) as never,
      },
    );
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

    expect(result.sent).toBe(true);
    expect(result.message).toBe('qq_desktop_sent');
    expect(called).toBe(true);
  });
});

