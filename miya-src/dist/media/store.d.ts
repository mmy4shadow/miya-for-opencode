export interface MediaItem {
    id: string;
    source: string;
    kind: 'image' | 'audio' | 'video' | 'file';
    mimeType: string;
    fileName: string;
    localPath?: string;
    sizeBytes?: number;
    createdAt: string;
    expiresAt: string;
    metadata?: Record<string, unknown>;
}
export declare function ingestMedia(projectDir: string, input: {
    source: string;
    kind: MediaItem['kind'];
    mimeType: string;
    fileName: string;
    contentBase64?: string;
    sizeBytes?: number;
    ttlHours?: number;
    metadata?: Record<string, unknown>;
}): MediaItem;
export declare function getMediaItem(projectDir: string, mediaID: string): MediaItem | null;
export declare function patchMediaMetadata(projectDir: string, mediaID: string, patch: Record<string, unknown>): MediaItem | null;
export declare function listMediaItems(projectDir: string, limit?: number): MediaItem[];
export declare function runMediaGc(projectDir: string): {
    removed: number;
    kept: number;
};
