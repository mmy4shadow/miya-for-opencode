export interface MediaTranscribeRequest {
    mediaID: string;
    language?: string;
}
export interface MediaTranscribeResult {
    mediaID: string;
    transcript: string;
    confidence?: number;
}
export declare function buildTranscribeRequestedEvent(input: MediaTranscribeRequest): {
    event: string;
    payload: {
        mediaID: string;
        language: string | undefined;
    };
};
export declare function buildTranscribeDoneEvent(input: MediaTranscribeResult): {
    event: string;
    payload: {
        mediaID: string;
        transcript: string;
        confidence: number | undefined;
    };
};
