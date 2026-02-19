import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesktopOcrSignals } from './vision';

export interface DesktopOcrRegressionCase {
  id: string;
  app: 'qq' | 'wechat';
  theme: 'light' | 'dark';
  dpi: string;
  destination: string;
  ocrText: string;
  expectedRecipientMatch: 'matched' | 'mismatch' | 'uncertain';
  expectedSendStatus: 'sent' | 'failed' | 'uncertain';
}

export interface DesktopOcrRegressionResult {
  total: number;
  passed: number;
  passRate: number;
  failures: Array<{
    id: string;
    app: string;
    expectedRecipientMatch: string;
    actualRecipientMatch: string;
    expectedSendStatus: string;
    actualSendStatus: string;
  }>;
}

const FIXTURE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'desktop-outbound-ocr-regression.json',
);

export function loadDesktopOcrRegressionCases(
  fixtureFile = FIXTURE_FILE,
): DesktopOcrRegressionCase[] {
  const parsed = JSON.parse(fs.readFileSync(fixtureFile, 'utf-8')) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => item as DesktopOcrRegressionCase)
    .filter((item) => typeof item.id === 'string' && item.id.trim().length > 0);
}

export function runDesktopOcrRegression(
  cases: DesktopOcrRegressionCase[],
): DesktopOcrRegressionResult {
  const failures: DesktopOcrRegressionResult['failures'] = [];
  let passed = 0;
  for (const item of cases) {
    const signals = parseDesktopOcrSignals(item.ocrText, item.destination);
    const recipientOk = signals.recipientMatch === item.expectedRecipientMatch;
    const statusOk = signals.sendStatusDetected === item.expectedSendStatus;
    if (recipientOk && statusOk) {
      passed += 1;
      continue;
    }
    failures.push({
      id: item.id,
      app: item.app,
      expectedRecipientMatch: item.expectedRecipientMatch,
      actualRecipientMatch: signals.recipientMatch,
      expectedSendStatus: item.expectedSendStatus,
      actualSendStatus: signals.sendStatusDetected,
    });
  }
  const total = cases.length;
  return {
    total,
    passed,
    passRate: total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0,
    failures,
  };
}
