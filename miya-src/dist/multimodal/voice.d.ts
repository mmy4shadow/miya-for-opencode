import type { VoiceInputIngest, VoiceInputResult, VoiceOutputInput, VoiceOutputResult } from './types';
export declare function ingestVoiceInput(projectDir: string, input: VoiceInputIngest): VoiceInputResult;
export declare function synthesizeVoiceOutput(projectDir: string, input: VoiceOutputInput): Promise<VoiceOutputResult>;
