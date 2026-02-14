import { beforeEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.MIYA_INPUT_MUTEX_TIMEOUT_MS = '25';

let sendDelayMs = 0;
let forceUiStyleMismatch = false;
let forceSendSuccess = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

mock.module('../channel/outbound/qq', () => ({
  sendQqDesktopMessage: async () => {
    if (sendDelayMs > 0) await sleep(sendDelayMs);
    if (!forceSendSuccess) {
      return {
        sent: false,
        message: 'outbound_blocked:receipt_uncertain',
        payloadHash: 'f'.repeat(64),
        windowFingerprint: 'win-fp',
        recipientTextCheck: 'uncertain',
        receiptStatus: 'uncertain',
        preSendScreenshotPath: 'pre.png',
        postSendScreenshotPath: 'post.png',
        failureStep: 'mock-fail',
        visualPrecheck: 'ok',
        visualPostcheck: 'ok',
        sendStatusCheck: 'uncertain',
      };
    }
    return {
      sent: true,
      message: 'outbound_sent',
      payloadHash: 'f'.repeat(64),
      windowFingerprint: 'win-fp',
      recipientTextCheck: 'matched',
      receiptStatus: 'confirmed',
      preSendScreenshotPath: 'pre.png',
      postSendScreenshotPath: 'post.png',
      failureStep: '',
      visualPrecheck: 'ok',
      visualPostcheck: 'ok',
      sendStatusCheck: 'sent',
    };
  },
}));

mock.module('../channel/outbound/wechat', () => ({
  sendWechatDesktopMessage: async () => ({
    sent: false,
    message: 'outbound_blocked:receipt_uncertain',
    payloadHash: 'e'.repeat(64),
    windowFingerprint: 'win-fp',
    recipientTextCheck: 'uncertain',
    receiptStatus: 'uncertain',
    preSendScreenshotPath: 'pre.png',
    postSendScreenshotPath: 'post.png',
    failureStep: 'mock-fail',
    visualPrecheck: 'ok',
    visualPostcheck: 'ok',
    sendStatusCheck: 'uncertain',
  }),
}));

mock.module('../multimodal/vision', () => ({
  analyzeDesktopOutboundEvidence: async () => ({
    recipientMatch: 'matched',
    sendStatusDetected: 'sent',
    uiStyleMismatch: forceUiStyleMismatch,
    ocrSource: 'tesseract',
    ocrPreview: 'ok',
  }),
  analyzeVision: async () => ({
    ocrText: '',
    source: 'none',
  }),
  parseDesktopOcrSignals: () => ({
    hasSendSuccessSignal: false,
    hasFailureSignal: false,
    hasUiStyleMismatchSignal: false,
    hasInputMutexSignal: false,
  }),
}));

const { ChannelRuntime } = await import('./service');
const { setContactTier } = await import('./pairing-store');

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-channels-adversarial-'));
}

describe('channel runtime adversarial cases', () => {
  beforeEach(() => {
    sendDelayMs = 0;
    forceUiStyleMismatch = false;
    forceSendSuccess = false;
  });

  test('degrades to draft_only when OCR detects ui_style_mismatch', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'owner-user', 'owner');
    forceUiStyleMismatch = true;
    forceSendSuccess = true;

    const result = await runtime.sendMessage({
      channel: 'qq',
      destination: 'owner-user',
      text: 'hello',
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
        bypassThrottle: true,
        bypassDuplicateGuard: true,
      },
      sessionID: 'case-ui-mismatch',
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_degraded:ui_style_mismatch:draft_only');

    const auditFile = path.join(projectDir, '.opencode', 'miya', 'channels-outbound.jsonl');
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { semanticTags?: string[]; semanticSummary?: { conclusion?: string } });
    expect(rows[0]?.semanticTags).toContain('ui_style_mismatch');
    expect(rows[0]?.semanticSummary?.conclusion).toContain('style mismatch');
  });

  test('triggers input_mutex_timeout under sustained session contention', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'owner-a', 'owner');
    setContactTier(projectDir, 'qq', 'owner-b', 'owner');
    sendDelayMs = 100;

    const first = runtime.sendMessage({
      channel: 'qq',
      destination: 'owner-a',
      text: 'hold-lock',
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
        bypassThrottle: true,
        bypassDuplicateGuard: true,
      },
      sessionID: 'contended-session',
    });
    await sleep(5);
    const second = await runtime.sendMessage({
      channel: 'qq',
      destination: 'owner-b',
      text: 'wait-lock',
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
        bypassThrottle: true,
        bypassDuplicateGuard: true,
      },
      sessionID: 'contended-session',
    });
    const firstResult = await first;

    expect(second.sent).toBe(false);
    expect(second.message).toBe('outbound_degraded:input_mutex_timeout:draft_only');
    expect(firstResult.message.length).toBeGreaterThan(0);

    const auditFile = path.join(projectDir, '.opencode', 'miya', 'channels-outbound.jsonl');
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message?: string; semanticTags?: string[] });
    expect(rows.some((row) => row.message === 'outbound_degraded:input_mutex_timeout:draft_only')).toBe(
      true,
    );
    const timeoutRow = rows.find(
      (row) => row.message === 'outbound_degraded:input_mutex_timeout:draft_only',
    );
    expect(timeoutRow?.semanticTags).toContain('input_mutex_timeout');
  });
});
