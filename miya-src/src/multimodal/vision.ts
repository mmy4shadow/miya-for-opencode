import * as fs from 'node:fs';
import * as os from 'node:os';
import { getMediaItem } from '../media/store';
import { runProcess } from '../utils';
import { readOcrCoordinateCache, writeOcrCoordinateCache } from './ocr-cache';
import type { VisionAnalyzeInput, VisionAnalyzeResult } from './types';

function summarizeFromMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return 'No metadata available for vision summary.';
  const caption =
    typeof metadata.caption === 'string'
      ? metadata.caption
      : typeof metadata.description === 'string'
        ? metadata.description
        : '';
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((item) => typeof item === 'string').join(', ')
    : '';
  if (caption && tags) return `${caption} (tags: ${tags})`;
  if (caption) return caption;
  if (tags) return `tags: ${tags}`;
  return 'Image metadata found but no caption/tags were provided.';
}

async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? ['where', command] : ['which', command];
  const result = await runProcess(probe[0], probe.slice(1), { timeoutMs: 3000 });
  return !result.timedOut && result.exitCode === 0;
}

async function runTesseractOcr(imagePath: string): Promise<string> {
  if (!(await commandExists('tesseract'))) return '';
  const args =
    process.platform === 'win32'
      ? ['tesseract', imagePath, 'stdout', '--psm', '6']
      : ['tesseract', imagePath, 'stdout', '--psm', '6'];
  const result = await runProcess(args[0], args.slice(1), { timeoutMs: 8000 });
  if (result.timedOut || result.exitCode !== 0) return '';
  return result.stdout.trim();
}

async function runRemoteVisionInference(
  imagePath: string,
  question?: string,
): Promise<{ text: string; summary?: string; boxes?: Array<Record<string, unknown>> }> {
  const endpoint = process.env.MIYA_VISION_OCR_ENDPOINT?.trim();
  if (!endpoint) return { text: '' };
  if (!fs.existsSync(imagePath)) return { text: '' };
  const image = fs.readFileSync(imagePath);
  const mimeType = imagePath.endsWith('.png')
    ? 'image/png'
    : imagePath.endsWith('.jpg') || imagePath.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'application/octet-stream';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        imageBase64: image.toString('base64'),
        mimeType,
        question: question ?? '',
      }),
    });
    if (!response.ok) return { text: '' };
    const payload = (await response.json()) as {
      text?: string;
      summary?: string;
      boxes?: Array<Record<string, unknown>>;
      ocr_text?: string;
    };
    const text = String(payload.text ?? payload.ocr_text ?? '').trim();
    return {
      text,
      summary: payload.summary ? String(payload.summary) : undefined,
      boxes: Array.isArray(payload.boxes) ? payload.boxes : undefined,
    };
  } catch {
    return { text: '' };
  }
}

async function readTextFromImage(imagePath: string, question?: string): Promise<{
  source: 'remote_vlm' | 'tesseract' | 'none';
  text: string;
  summary?: string;
  boxes?: Array<Record<string, unknown>>;
}> {
  const remote = await runRemoteVisionInference(imagePath, question);
  if (remote.text) {
    return {
      source: 'remote_vlm',
      text: remote.text,
      summary: remote.summary,
      boxes: remote.boxes,
    };
  }
  const tesseractText = await runTesseractOcr(imagePath);
  if (tesseractText) {
    return {
      source: 'tesseract',
      text: tesseractText,
    };
  }
  return {
    source: 'none',
    text: '',
  };
}

export interface DesktopOcrSignals {
  recipientDetected: string;
  recipientMatch: 'matched' | 'mismatch' | 'uncertain';
  sendStatusDetected: 'sent' | 'failed' | 'uncertain';
}

export type CaptureMethod = 'wgc_hwnd' | 'print_window' | 'dxgi_duplication' | 'uia_only' | 'unknown';

export interface CaptureCapabilityReport {
  method: CaptureMethod;
  confidence: number;
  limitations: string[];
}

const CAPTURE_PRIORITY: CaptureMethod[] = [
  'wgc_hwnd',
  'print_window',
  'dxgi_duplication',
  'uia_only',
];

function normalizeCaptureMethod(input: string | undefined): CaptureMethod | null {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'wgc' || raw === 'wgc_hwnd') return 'wgc_hwnd';
  if (raw === 'printwindow' || raw === 'print_window') return 'print_window';
  if (raw === 'dxgi' || raw === 'dxgi_duplication') return 'dxgi_duplication';
  if (raw === 'uia' || raw === 'uia_only') return 'uia_only';
  if (raw === 'unknown') return 'unknown';
  return null;
}

function parseCaptureMethods(input: string | undefined): CaptureMethod[] {
  const raw = String(input ?? '').trim();
  if (!raw) return [...CAPTURE_PRIORITY];
  const methods = raw
    .split(',')
    .map((item) => normalizeCaptureMethod(item))
    .filter((item): item is CaptureMethod => Boolean(item) && item !== 'unknown');
  if (methods.length === 0) return [...CAPTURE_PRIORITY];
  return [...new Set(methods)];
}

function inferCaptureProbeLimitations(input: {
  visualPrecheck?: string;
  visualPostcheck?: string;
}): string[] {
  const signal = `${input.visualPrecheck ?? ''}|${input.visualPostcheck ?? ''}`.toLowerCase();
  const result: string[] = [];
  if (!signal.trim()) return result;
  if (signal.includes('black')) result.push('capture_probe_black_screen');
  if (signal.includes('timeout')) result.push('capture_probe_timeout');
  if (signal.includes('error') || signal.includes('failed')) result.push('capture_probe_error');
  if (signal.includes('occluded')) result.push('capture_probe_occluded');
  return [...new Set(result)];
}

function compactOcrText(text: string): string {
  return (text || '').replace(/\s+/g, '').toLowerCase();
}

export function parseDesktopOcrSignals(
  ocrText: string,
  expectedRecipient: string,
): DesktopOcrSignals {
  const normalized = (ocrText || '').replace(/\s+/g, ' ').trim();
  const recipient = expectedRecipient.trim();
  const lowered = normalized.toLowerCase();
  const compactNormalized = compactOcrText(normalized);
  const compactRecipient = compactOcrText(recipient);
  const recipientDetected =
    recipient &&
    (normalized.includes(recipient) ||
      lowered.includes(recipient.toLowerCase()) ||
      (compactRecipient.length > 0 && compactNormalized.includes(compactRecipient)))
      ? recipient
      : '';

  const sentHints = [
    '发送成功',
    '已发送',
    'sent',
    'delivered',
    '发送',
    '已发出',
  ];
  const failHints = [
    '发送失败',
    'failed',
    '失败',
    'retry',
    '重试',
    '未发送',
  ];

  const hasSent = sentHints.some((item) => {
    const loweredHint = item.toLowerCase();
    return lowered.includes(loweredHint) || compactNormalized.includes(compactOcrText(loweredHint));
  });
  const hasFail = failHints.some((item) => {
    const loweredHint = item.toLowerCase();
    return lowered.includes(loweredHint) || compactNormalized.includes(compactOcrText(loweredHint));
  });
  const sendStatusDetected: DesktopOcrSignals['sendStatusDetected'] = hasFail
    ? 'failed'
    : hasSent
      ? 'sent'
      : 'uncertain';

  let recipientMatch: DesktopOcrSignals['recipientMatch'] = 'uncertain';
  if (recipientDetected) {
    recipientMatch = 'matched';
  } else if (recipient && normalized.length > 0) {
    recipientMatch = 'mismatch';
  }

  return {
    recipientDetected,
    recipientMatch,
    sendStatusDetected,
  };
}

export async function analyzeDesktopOutboundEvidence(
  input: {
    destination: string;
    preSendScreenshotPath?: string;
    postSendScreenshotPath?: string;
    visualPrecheck?: string;
    visualPostcheck?: string;
    receiptStatus?: 'confirmed' | 'uncertain';
    recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
  },
): Promise<{
  recipientMatch: 'matched' | 'mismatch' | 'uncertain';
  sendStatusDetected: 'sent' | 'failed' | 'uncertain';
  ocrSource: 'remote_vlm' | 'tesseract' | 'none';
  ocrPreview: string;
  uiStyleMismatch: boolean;
  retries: number;
  lowConfidenceAttempts: number;
  capture: CaptureCapabilityReport;
}> {
  const capture = resolveCaptureCapability(input);
  const candidates = [
    input.postSendScreenshotPath,
    input.preSendScreenshotPath,
  ].filter((item): item is string => typeof item === 'string' && fs.existsSync(item));
  if (candidates.length === 0) {
    const recipientMatch = input.recipientTextCheck ?? 'uncertain';
    const sendStatusDetected = input.receiptStatus === 'confirmed' ? 'sent' : 'uncertain';
    return {
      recipientMatch,
      sendStatusDetected,
      ocrSource: 'none',
      ocrPreview: '',
      uiStyleMismatch: true,
      retries: 0,
      lowConfidenceAttempts: 1,
      capture: {
        method: capture.method,
        confidence: capture.confidence,
        limitations: mergeCaptureLimitations(capture.limitations, {
          uiStyleMismatch: true,
          recipientMatch,
          sendStatusDetected,
        }),
      },
    };
  }

  const isLowConfidenceText = (text: string): boolean => {
    const trimmed = (text || '').replace(/\s+/g, '');
    if (trimmed.length < 8) return true;
    const meaningful = trimmed.replace(/[a-zA-Z0-9\u4e00-\u9fa5]/g, '');
    const noiseRatio = meaningful.length / Math.max(1, trimmed.length);
    return noiseRatio > 0.6;
  };

  let inferred = await readTextFromImage(candidates[0], '识别聊天界面收件人与发送状态');
  let signals = parseDesktopOcrSignals(inferred.text, input.destination);
  let retries = 0;
  let lowConfidenceAttempts =
    inferred.source === 'none' || isLowConfidenceText(inferred.text) ? 1 : 0;
  let uiStyleMismatch =
    inferred.source === 'none' ||
    (signals.recipientMatch !== 'matched' && isLowConfidenceText(inferred.text));

  if (
    candidates.length > 1 &&
    (signals.recipientMatch === 'mismatch' || uiStyleMismatch)
  ) {
    const retryInferred = await readTextFromImage(
      candidates[1],
      'DPI样式兼容重试：识别聊天界面收件人与发送状态',
    );
    const retrySignals = parseDesktopOcrSignals(retryInferred.text, input.destination);
    retries = 1;
    if (retryInferred.source === 'none' || isLowConfidenceText(retryInferred.text)) {
      lowConfidenceAttempts += 1;
    }

    const retryBetter =
      retrySignals.recipientMatch === 'matched' ||
      (retrySignals.sendStatusDetected !== 'uncertain' &&
        signals.sendStatusDetected === 'uncertain') ||
      (!isLowConfidenceText(retryInferred.text) && isLowConfidenceText(inferred.text));
    if (retryBetter) {
      inferred = retryInferred;
      signals = retrySignals;
    }
    uiStyleMismatch =
      (inferred.source === 'none' || isLowConfidenceText(inferred.text)) &&
      signals.recipientMatch !== 'matched';
  }

  const mergedRecipient =
    signals.recipientMatch === 'mismatch' && input.recipientTextCheck === 'matched'
      ? 'matched'
      : signals.recipientMatch === 'uncertain'
        ? (input.recipientTextCheck ?? 'uncertain')
        : signals.recipientMatch;
  const mergedStatus =
    signals.sendStatusDetected === 'uncertain'
      ? input.receiptStatus === 'confirmed'
        ? 'sent'
        : 'uncertain'
      : signals.sendStatusDetected;

  const stableRecipient =
    uiStyleMismatch && mergedRecipient === 'mismatch' ? 'uncertain' : mergedRecipient;
  const confidence = estimateEvidenceConfidence({
    ocrSource: inferred.source,
    uiStyleMismatch,
    recipientMatch: stableRecipient,
    sendStatusDetected: mergedStatus,
    retries,
  });
  const mergedConfidence = Number(Math.min(confidence, capture.confidence).toFixed(2));
  if (mergedConfidence < 0.45 || lowConfidenceAttempts >= 2) {
    uiStyleMismatch = true;
  }

  return {
    recipientMatch: stableRecipient,
    sendStatusDetected: mergedStatus,
    ocrSource: inferred.source,
    ocrPreview: inferred.text.slice(0, 300),
    uiStyleMismatch,
    retries,
    lowConfidenceAttempts,
    capture: {
      method: capture.method,
      confidence: mergedConfidence,
      limitations: mergeCaptureLimitations(capture.limitations, {
        uiStyleMismatch,
        recipientMatch: stableRecipient,
        sendStatusDetected: mergedStatus,
      }),
    },
  };
}

function resolveCaptureCapability(input: {
  preSendScreenshotPath?: string;
  postSendScreenshotPath?: string;
  visualPrecheck?: string;
  visualPostcheck?: string;
}): CaptureCapabilityReport {
  const hasScreenshots =
    (typeof input.preSendScreenshotPath === 'string' &&
      input.preSendScreenshotPath.length > 0 &&
      fs.existsSync(input.preSendScreenshotPath)) ||
    (typeof input.postSendScreenshotPath === 'string' &&
      input.postSendScreenshotPath.length > 0 &&
      fs.existsSync(input.postSendScreenshotPath));
  const supported = parseCaptureMethods(process.env.MIYA_CAPTURE_CAPABILITIES);
  const preferred = CAPTURE_PRIORITY.find((item) => supported.includes(item));
  const requested = normalizeCaptureMethod(process.env.MIYA_CAPTURE_METHOD);
  let method: CaptureMethod = 'unknown';
  if (hasScreenshots) {
    if (requested && supported.includes(requested)) {
      method = requested;
    } else if (preferred) {
      method = preferred;
    } else {
      method = 'unknown';
    }
  } else {
    method = supported.includes('uia_only') ? 'uia_only' : 'unknown';
  }
  const limitations: string[] = [];
  limitations.push(...inferCaptureProbeLimitations(input));
  if (!hasScreenshots) {
    limitations.push('no_desktop_screenshot');
  }
  if (requested && requested !== 'unknown' && !supported.includes(requested)) {
    limitations.push(`capture_method_not_supported:${requested}`);
  }
  if (hasScreenshots && preferred && method !== 'unknown' && method !== preferred) {
    limitations.push(`capture_fallback:${preferred}->${method}`);
  }
  if (!hasScreenshots && preferred && preferred !== 'uia_only') {
    limitations.push(`capture_tree_exhausted:${preferred}`);
  }
  if (method === 'unknown') limitations.push('capture_method_unspecified');
  if (method === 'uia_only') limitations.push('pixel_evidence_unavailable');
  const baseByMethod: Record<CaptureMethod, number> = {
    wgc_hwnd: 0.92,
    print_window: 0.84,
    dxgi_duplication: 0.76,
    uia_only: 0.4,
    unknown: 0.24,
  };
  let confidence = baseByMethod[method];
  if (!hasScreenshots) {
    confidence = Math.min(confidence, method === 'uia_only' ? 0.34 : 0.24);
  }
  if (limitations.includes('capture_probe_black_screen')) {
    confidence = Math.min(confidence, 0.28);
  }
  if (limitations.includes('capture_probe_timeout')) {
    confidence = Math.min(confidence, 0.3);
  }
  if (limitations.includes('capture_probe_error')) {
    confidence = Math.min(confidence, 0.3);
  }
  return {
    method,
    confidence: Number(confidence.toFixed(2)),
    limitations,
  };
}

function estimateEvidenceConfidence(input: {
  ocrSource: 'remote_vlm' | 'tesseract' | 'none';
  uiStyleMismatch: boolean;
  recipientMatch: 'matched' | 'mismatch' | 'uncertain';
  sendStatusDetected: 'sent' | 'failed' | 'uncertain';
  retries: number;
}): number {
  let score = input.ocrSource === 'remote_vlm' ? 0.86 : input.ocrSource === 'tesseract' ? 0.72 : 0.35;
  if (input.uiStyleMismatch) score -= 0.32;
  if (input.recipientMatch === 'matched') score += 0.08;
  if (input.sendStatusDetected === 'sent' || input.sendStatusDetected === 'failed') score += 0.04;
  if (input.retries > 0) score -= 0.05;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return Number(score.toFixed(2));
}

function mergeCaptureLimitations(
  base: string[],
  input: {
    uiStyleMismatch: boolean;
    recipientMatch: 'matched' | 'mismatch' | 'uncertain';
    sendStatusDetected: 'sent' | 'failed' | 'uncertain';
  },
): string[] {
  const result = [...base];
  if (input.uiStyleMismatch) result.push('ui_style_mismatch');
  if (input.recipientMatch === 'uncertain') result.push('recipient_unverified');
  if (input.sendStatusDetected === 'uncertain') result.push('delivery_unverified');
  return [...new Set(result)];
}

export async function analyzeVision(
  projectDir: string,
  input: VisionAnalyzeInput,
): Promise<VisionAnalyzeResult> {
  const cacheHit = readOcrCoordinateCache(projectDir, {
    mediaID: input.mediaID,
    question: input.question,
  });
  if (cacheHit) {
    return {
      mediaID: cacheHit.mediaID,
      summary: cacheHit.summary,
      details: {
        cacheHit: true,
        ocrBoxes: cacheHit.boxes,
      },
    };
  }

  const media = getMediaItem(projectDir, input.mediaID);
  if (!media) throw new Error('media_not_found');
  if (media.kind !== 'image') throw new Error('invalid_vision_media_kind');
  const filePath = media.localPath && fs.existsSync(media.localPath) ? media.localPath : '';
  const ocr: Awaited<ReturnType<typeof readTextFromImage>> = filePath
    ? await readTextFromImage(filePath, input.question)
    : { source: 'none', text: '' };
  const metadataSummary = summarizeFromMetadata(media.metadata);
  const summary = ocr.summary || ocr.text || metadataSummary;
  const ocrLines = ocr.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  const remoteBoxes =
    Array.isArray(ocr.boxes) && ocr.boxes.length > 0
      ? ocr.boxes
          .map((item) => ({
            x: Number(item.x ?? 0),
            y: Number(item.y ?? 0),
            width: Number(item.width ?? 0),
            height: Number(item.height ?? 0),
            text: String(item.text ?? '').trim(),
          }))
          .filter(
            (item) =>
              Number.isFinite(item.x) &&
              Number.isFinite(item.y) &&
              Number.isFinite(item.width) &&
              Number.isFinite(item.height) &&
              item.text.length > 0,
          )
      : [];
  const ocrBoxes =
    remoteBoxes.length > 0
      ? remoteBoxes
      : ocrLines.map((line, index) => ({
          x: 16,
          y: 24 + index * 24,
          width: Math.min(720, 80 + line.length * 8),
          height: 20,
          text: line.slice(0, 240),
        }));
  const finalSummary =
    input.question?.trim()
      ? `${summary} | question: ${input.question.trim()}`
      : summary;
  writeOcrCoordinateCache(projectDir, {
    mediaID: media.id,
    question: input.question,
    boxes: ocrBoxes,
    summary: finalSummary,
  });
  return {
    mediaID: media.id,
    summary: finalSummary,
    details: {
      cacheHit: false,
      ocrBoxes,
      inferenceSource: ocr.source,
      ocrPreview: ocr.text.slice(0, 400),
      fileName: media.fileName,
      mimeType: media.mimeType,
      localPath: media.localPath,
      metadata: media.metadata ?? {},
      host: os.hostname(),
    },
  };
}
