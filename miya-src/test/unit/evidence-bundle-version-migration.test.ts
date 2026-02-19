import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChannelRuntime, listOutboundAudit } from '../../src/channels/service';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-evidence-migration-'));
}

function validTickets() {
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  return {
    outboundSend: { traceID: 'trace-outbound', expiresAt },
    desktopControl: { traceID: 'trace-desktop', expiresAt },
  };
}

describe('evidence bundle version migration testing', () => {
  test('normalizes legacy V5 evidence bundle version when reading audit rows', () => {
    const projectDir = tempProjectDir();
    const file = path.join(
      projectDir,
      '.opencode',
      'miya',
      'channels-outbound.jsonl',
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        id: 'audit_legacy',
        at: new Date().toISOString(),
        channel: 'qq',
        destination: 'tester',
        textPreview: 'hello',
        sent: false,
        message: 'legacy_row',
        evidenceBundle: {
          kind: 'desktop_outbound',
          version: 'V5',
          destination: 'tester',
          screenshots: [],
          checks: {},
          diagnostics: {},
          meta: { captureMethod: 'unknown', confidence: 0, limitations: [] },
          simulation: { status: 'not_available' },
        },
      })}\n`,
      'utf-8',
    );

    const rows = listOutboundAudit(projectDir, 10);
    expect(rows[0]?.evidenceBundle?.version).toBe('v5');
  });

  test('rejects malformed approval ticket payload without throwing', async () => {
    const runtime = new ChannelRuntime(tempProjectDir(), {
      onInbound: () => {},
      onPairRequested: () => {},
    });

    const malformed = {
      outboundSend: validTickets().outboundSend,
    } as unknown as {
      outboundSend: { traceID: string; expiresAt: string };
      desktopControl: { traceID: string; expiresAt: string };
    };

    const result = await runtime.sendMessage({
      channel: 'qq',
      destination: 'tester',
      text: 'hello',
      approvalTickets: malformed,
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
        bypassAllowlist: true,
        bypassThrottle: true,
        bypassDuplicateGuard: true,
      },
    });

    expect(result.sent).toBe(false);
    expect(result.message).toContain('approval_ticket_missing');
  });
});
