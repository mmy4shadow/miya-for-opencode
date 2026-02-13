export interface VoiceHistoryItem {
    id: string;
    text: string;
    source: 'wake' | 'talk' | 'manual' | 'media';
    language?: string;
    mediaID?: string;
    createdAt: string;
}
export interface VoiceState {
    enabled: boolean;
    wakeWordEnabled: boolean;
    talkMode: boolean;
    routeSessionID: string;
    sttProvider: 'local' | 'off';
    ttsProvider: 'local' | 'off';
    lastInputAt?: string;
    lastTranscript?: string;
    history: VoiceHistoryItem[];
}
export declare function readVoiceState(projectDir: string): VoiceState;
export declare function writeVoiceState(projectDir: string, state: VoiceState): VoiceState;
export declare function patchVoiceState(projectDir: string, patch: Partial<Omit<VoiceState, 'history'>>): VoiceState;
export declare function appendVoiceHistory(projectDir: string, input: {
    text: string;
    source: VoiceHistoryItem['source'];
    language?: string;
    mediaID?: string;
}): VoiceHistoryItem;
export declare function clearVoiceHistory(projectDir: string): VoiceState;
