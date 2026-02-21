import type { VisionAnalyzeInput, VisionAnalyzeResult } from './types';
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
export declare function parseDesktopOcrSignals(ocrText: string, expectedRecipient: string): DesktopOcrSignals;
export declare function analyzeDesktopOutboundEvidence(input: {
    destination: string;
    preSendScreenshotPath?: string;
    postSendScreenshotPath?: string;
    visualPrecheck?: string;
    visualPostcheck?: string;
    receiptStatus?: 'confirmed' | 'uncertain';
    recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
}): Promise<{
    recipientMatch: 'matched' | 'mismatch' | 'uncertain';
    sendStatusDetected: 'sent' | 'failed' | 'uncertain';
    ocrSource: 'remote_vlm' | 'tesseract' | 'none';
    ocrPreview: string;
    uiStyleMismatch: boolean;
    retries: number;
    lowConfidenceAttempts: number;
    capture: CaptureCapabilityReport;
}>;
export declare function analyzeVision(projectDir: string, input: VisionAnalyzeInput): Promise<VisionAnalyzeResult>;
