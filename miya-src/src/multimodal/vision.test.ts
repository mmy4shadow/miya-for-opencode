import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

  test('falls back to next available capture method when requested method is unsupported', async () => {
    const previousMethod = process.env.MIYA_CAPTURE_METHOD;
    const previousCaps = process.env.MIYA_CAPTURE_CAPABILITIES;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-capture-tree-'));
    const screenshot = path.join(dir, 'screen.png');
    fs.writeFileSync(screenshot, 'mock');
    process.env.MIYA_CAPTURE_METHOD = 'wgc_hwnd';
    process.env.MIYA_CAPTURE_CAPABILITIES = 'print_window,dxgi_duplication,uia_only';

    try {
      const result = await analyzeDesktopOutboundEvidence({
        destination: 'owner-1',
        preSendScreenshotPath: screenshot,
        receiptStatus: 'uncertain',
        recipientTextCheck: 'uncertain',
      });
      expect(result.capture.method).toBe('print_window');
      expect(
        result.capture.limitations.includes('capture_method_not_supported:wgc_hwnd'),
      ).toBe(true);
      expect(result.capture.limitations.some((item) => item.startsWith('capture_fallback:'))).toBe(
        false,
      );
    } finally {
      if (previousMethod === undefined) delete process.env.MIYA_CAPTURE_METHOD;
      else process.env.MIYA_CAPTURE_METHOD = previousMethod;
      if (previousCaps === undefined) delete process.env.MIYA_CAPTURE_CAPABILITIES;
      else process.env.MIYA_CAPTURE_CAPABILITIES = previousCaps;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns unknown with capture-tree-exhausted when screenshots are unavailable and uia is disabled', async () => {
    const previousMethod = process.env.MIYA_CAPTURE_METHOD;
    const previousCaps = process.env.MIYA_CAPTURE_CAPABILITIES;
    process.env.MIYA_CAPTURE_METHOD = 'wgc_hwnd';
    process.env.MIYA_CAPTURE_CAPABILITIES = 'wgc_hwnd,print_window,dxgi_duplication';
    try {
      const result = await analyzeDesktopOutboundEvidence({
        destination: 'owner-1',
        preSendScreenshotPath: 'missing-pre.png',
        postSendScreenshotPath: 'missing-post.png',
        receiptStatus: 'uncertain',
        recipientTextCheck: 'uncertain',
      });
      expect(result.capture.method).toBe('unknown');
      expect(result.capture.limitations.includes('capture_tree_exhausted:wgc_hwnd')).toBe(true);
      expect(result.capture.limitations.includes('capture_method_unspecified')).toBe(true);
    } finally {
      if (previousMethod === undefined) delete process.env.MIYA_CAPTURE_METHOD;
      else process.env.MIYA_CAPTURE_METHOD = previousMethod;
      if (previousCaps === undefined) delete process.env.MIYA_CAPTURE_CAPABILITIES;
      else process.env.MIYA_CAPTURE_CAPABILITIES = previousCaps;
    }
  });
});
