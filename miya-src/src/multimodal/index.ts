export { generateImage } from './image';
export { analyzeVision } from './vision';
export { loadDesktopOcrRegressionCases, runDesktopOcrRegression } from './vision-regression';
export { ingestVoiceInput, synthesizeVoiceOutput } from './voice';
export { detectMultimodalIntent, type MultimodalIntent } from './intent';
export type {
  GenerateImageInput,
  GenerateImageResult,
  VisionAnalyzeInput,
  VisionAnalyzeResult,
  VoiceInputIngest,
  VoiceInputResult,
  VoiceOutputInput,
  VoiceOutputResult,
} from './types';
