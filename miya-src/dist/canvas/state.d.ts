export interface CanvasDocument {
    id: string;
    title: string;
    type: 'text' | 'markdown' | 'json' | 'html';
    content: string;
    createdAt: string;
    updatedAt: string;
}
export interface CanvasEvent {
    id: string;
    kind: 'open' | 'render' | 'close';
    docID: string;
    at: string;
    actor: string;
}
export interface CanvasState {
    activeDocID?: string;
    docs: Record<string, CanvasDocument>;
    events: CanvasEvent[];
}
export declare function readCanvasState(projectDir: string): CanvasState;
export declare function writeCanvasState(projectDir: string, state: CanvasState): CanvasState;
export declare function openCanvasDoc(projectDir: string, input: {
    title: string;
    type?: CanvasDocument['type'];
    content?: string;
    actor?: string;
}): CanvasDocument;
export declare function renderCanvasDoc(projectDir: string, input: {
    docID: string;
    content: string;
    merge?: boolean;
    actor?: string;
}): CanvasDocument | null;
export declare function closeCanvasDoc(projectDir: string, docID: string, actor?: string): CanvasDocument | null;
export declare function listCanvasDocs(projectDir: string): CanvasDocument[];
export declare function getCanvasDoc(projectDir: string, docID: string): CanvasDocument | null;
