import { describe, expect, test } from 'bun:test';
import { analyzeDesktopOutboundEvidence } from './vision';

describe('desktop outbound vision capability tree', () => {
  test('returns uia-only fallback with limitations when screenshots are missing', async () => {
    const result = await analyzeDesktopOutboundEvidence({
      destination: 'owner-1',
      preSendScreenshotPath: 'missing-pre.png',
      postSendScreenshotPath: 'missing-post.png',
      receiptStatus: 'uncertain',
      recipientTextCheck: 'uncertain',
    });

    expect(result.capture.method).toBe('uia_only');
    expect(result.capture.confidence).toBeLessThan(0.5);
    expect(result.capture.limitations.includes('no_desktop_screenshot')).toBe(true);
    expect(result.capture.limitations.includes('delivery_unverified')).toBe(true);
  });
});

