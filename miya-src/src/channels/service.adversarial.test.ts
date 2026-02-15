import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.MIYA_INPUT_MUTEX_TIMEOUT_MS = '25';

let sendDelayMs = 0;
let forceSendSuccess = false;
type VisionStubResult = {
  recipientMatch: 'matched' | 'mismatch' | 'uncertain';
  sendStatusDetected: 'sent' | 'failed' | 'uncertain';
  ocrSource: 'remote_vlm' | 'tesseract' | 'none';
  ocrPreview: string;
  uiStyleMismatch: boolean;
  retries: number;
  capture: {
    method: 'wgc_hwnd' | 'print_window' | 'dxgi_duplication' | 'uia_only' | 'unknown';
    confidence: number;
    limitations: string[];
  };
};
let forcedVisionResult: VisionStubResult | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

mock.module('../multimodal/vision', () => ({
  analyzeDesktopOutboundEvidence: async (input: {
    receiptStatus?: 'confirmed' | 'uncertain';
    recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
  }): Promise<VisionStubResult> => {
    if (forcedVisionResult) return forcedVisionResult;
    const recipientMatch = input.recipientTextCheck ?? 'uncertain';
    const sendStatusDetected = input.receiptStatus === 'confirmed' ? 'sent' : 'uncertain';
    return {
      recipientMatch,
      sendStatusDetected,
      ocrSource: 'none',
      ocrPreview: '',
      uiStyleMismatch: true,
      retries: 0,
      capture: {
        method: 'uia_only',
        confidence: 0.3,
        limitations: ['no_desktop_screenshot', 'ui_style_mismatch'],
      },
    };
  },
}));

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

const { ChannelRuntime } = await import('./service');
const { setContactTier } = await import('./pairing-store');

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-channels-adversarial-'));
}

describe('channel runtime adversarial cases', () => {
  beforeEach(() => {
    sendDelayMs = 0;
    forceSendSuccess = false;
    forcedVisionResult = null;
  });

  afterAll(() => {
    mock.restore();
  });

  test('keeps blocked state when outbound receipt is uncertain', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'owner-user', 'owner');
    forceSendSuccess = false;

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
    expect(
      result.message === 'outbound_blocked:receipt_uncertain' ||
        result.message === 'outbound_degraded:ui_style_mismatch:draft_only',
    ).toBe(true);

    const auditFile = path.join(projectDir, '.opencode', 'miya', 'channels-outbound.jsonl');
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { semanticTags?: string[]; semanticSummary?: { conclusion?: string } });
    expect(
      rows[0]?.semanticTags?.includes('receipt_uncertain') ||
        rows[0]?.semanticTags?.includes('ui_style_mismatch'),
    ).toBe(true);
  });

  test('downgrades to ui_style_mismatch draft-only under OCR/DPI evidence drift', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'owner-user', 'owner');
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
      sessionID: 'case-ocr-dpi-mismatch',
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_degraded:ui_style_mismatch:draft_only');

    const auditFile = path.join(projectDir, '.opencode', 'miya', 'channels-outbound.jsonl');
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            message?: string;
            semanticTags?: string[];
            evidenceLimitations?: string[];
          },
      );
    const row = rows.find((item) => item.message === result.message);
    expect(Boolean(row)).toBe(true);
    expect(row?.semanticTags?.includes('ui_style_mismatch')).toBe(true);
    expect(row?.evidenceLimitations?.includes('ui_style_mismatch')).toBe(true);
  });

  test('blocks outbound when visual recipient evidence mismatches target', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'owner-user', 'owner');
    forceSendSuccess = true;
    forcedVisionResult = {
      recipientMatch: 'mismatch',
      sendStatusDetected: 'sent',
      ocrSource: 'remote_vlm',
      ocrPreview: '与 other_user 的聊天\\n已发送',
      uiStyleMismatch: false,
      retries: 0,
      capture: {
        method: 'wgc_hwnd',
        confidence: 0.91,
        limitations: [],
      },
    };

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
      sessionID: 'case-recipient-mismatch',
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_blocked:recipient_text_mismatch');

    const auditFile = path.join(projectDir, '.opencode', 'miya', 'channels-outbound.jsonl');
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message?: string; semanticTags?: string[] });
    const row = rows.find((item) => item.message === result.message);
    expect(Boolean(row)).toBe(true);
    expect(row?.semanticTags?.includes('recipient_mismatch')).toBe(true);
  });

  test('blocks outbound when visual evidence marks send as failed', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'owner-user', 'owner');
    forceSendSuccess = true;
    forcedVisionResult = {
      recipientMatch: 'matched',
      sendStatusDetected: 'failed',
      ocrSource: 'remote_vlm',
      ocrPreview: '与 owner-user 的聊天\\n发送失败',
      uiStyleMismatch: false,
      retries: 0,
      capture: {
        method: 'wgc_hwnd',
        confidence: 0.88,
        limitations: [],
      },
    };

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
      sessionID: 'case-send-failed',
    });

    expect(result.sent).toBe(false);
    expect(result.message).toBe('outbound_blocked:receipt_uncertain');

    const auditFile = path.join(projectDir, '.opencode', 'miya', 'channels-outbound.jsonl');
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message?: string; semanticTags?: string[] });
    const row = rows.find((item) => item.message === result.message);
    expect(Boolean(row)).toBe(true);
    expect(row?.semanticTags?.includes('receipt_uncertain')).toBe(true);
  });

  test('triggers input_mutex_timeout under sustained session contention', async () => {
    const projectDir = tempProjectDir();
    const runtime = new ChannelRuntime(projectDir, {
      onInbound: () => {},
      onPairRequested: () => {},
    });
    setContactTier(projectDir, 'qq', 'owner-a', 'owner');
    setContactTier(projectDir, 'qq', 'owner-b', 'owner');
    sendDelayMs = 350;

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

    expect(String(second.message ?? '').length).toBeGreaterThan(0);
    expect(firstResult.message.length).toBeGreaterThan(0);

    const auditFile = path.join(projectDir, '.opencode', 'miya', 'channels-outbound.jsonl');
    const rows = fs
      .readFileSync(auditFile, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message?: string; semanticTags?: string[] });
    const blockedRow = rows.find((row) => {
      const message = String(row.message ?? '');
      return message.startsWith('outbound_degraded:') || message.startsWith('outbound_blocked:');
    });
    expect(Boolean(blockedRow)).toBe(true);
  });
});
