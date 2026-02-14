import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { getMiyaDaemonService } from '../daemon';
import { getMediaItem } from '../media/store';
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

function commandExists(command: string): boolean {
  const probe = process.platform === 'win32' ? ['where', command] : ['which', command];
  const result = Bun.spawnSync(probe, { stdout: 'pipe', stderr: 'pipe', timeout: 3000 });
  return result.exitCode === 0;
}

function runTesseractOcr(imagePath: string): string {
  if (!commandExists('tesseract')) return '';
  const args =
    process.platform === 'win32'
      ? ['tesseract', imagePath, 'stdout', '--psm', '6']
      : ['tesseract', imagePath, 'stdout', '--psm', '6'];
  const proc = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe', timeout: 8000 });
  if (proc.exitCode !== 0) return '';
  return Buffer.from(proc.stdout).toString('utf-8').trim();
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
  const tesseractText = runTesseractOcr(imagePath);
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

export function parseDesktopOcrSignals(
  ocrText: string,
  expectedRecipient: string,
): DesktopOcrSignals {
  const normalized = (ocrText || '').replace(/\s+/g, ' ').trim();
  const recipient = expectedRecipient.trim();
  const lowered = normalized.toLowerCase();
  const recipientDetected = recipient && normalized.includes(recipient) ? recipient : '';

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

  const hasSent = sentHints.some((item) => lowered.includes(item.toLowerCase()));
  const hasFail = failHints.some((item) => lowered.includes(item.toLowerCase()));
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
}> {
  const candidates = [
    input.postSendScreenshotPath,
    input.preSendScreenshotPath,
  ].filter((item): item is string => typeof item === 'string' && fs.existsSync(item));
  if (candidates.length === 0) {
    return {
      recipientMatch: input.recipientTextCheck ?? 'uncertain',
      sendStatusDetected: input.receiptStatus === 'confirmed' ? 'sent' : 'uncertain',
      ocrSource: 'none',
      ocrPreview: '',
      uiStyleMismatch: true,
      retries: 0,
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

  return {
    recipientMatch: stableRecipient,
    sendStatusDetected: mergedStatus,
    ocrSource: inferred.source,
    ocrPreview: inferred.text.slice(0, 300),
    uiStyleMismatch,
    retries,
  };
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

  const daemon = getMiyaDaemonService(projectDir);
  const { result } = await daemon.runTask(
    {
      kind: 'vision.analyze',
      resource: {
        priority: 90,
        vramMB: 768,
        modelID: 'local:qwen3-vl-4b',
        modelVramMB: 1536,
      },
      metadata: {
        stage: 'multimodal.vision.analyze',
        mediaID: input.mediaID,
      },
    },
    async () => {
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
        input.question && input.question.trim()
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
    },
  );
  return result;
}
