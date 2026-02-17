type ControlUiRootState = {
    kind: 'resolved';
    path: string;
} | {
    kind: 'invalid';
    path: string;
} | {
    kind: 'missing';
};
type ControlUiRequestOptions = {
    basePath?: string;
    root?: ControlUiRootState;
};
export declare function createControlUiRequestOptions(projectDir: string): ControlUiRequestOptions;
export declare function handleControlUiHttpRequest(request: Request, opts?: ControlUiRequestOptions): Response | null;
export {};
