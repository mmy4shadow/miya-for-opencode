export type MultimodalIntent = {
    type: 'selfie';
    prompt: string;
} | {
    type: 'voice_to_friend';
    text: string;
    friend: string;
} | {
    type: 'unknown';
};
export declare function detectMultimodalIntent(text: string): MultimodalIntent;
