export interface OcrBoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
}
interface OcrCacheEntry {
    key: string;
    mediaID: string;
    question: string;
    boxes: OcrBoundingBox[];
    summary: string;
    createdAt: string;
    usedAt: string;
}
export declare function readOcrCoordinateCache(projectDir: string, input: {
    mediaID: string;
    question?: string;
}): OcrCacheEntry | null;
export declare function writeOcrCoordinateCache(projectDir: string, input: {
    mediaID: string;
    question?: string;
    boxes: OcrBoundingBox[];
    summary: string;
}): void;
export {};
