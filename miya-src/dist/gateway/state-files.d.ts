export declare function gatewayFile(projectDir: string): string;
export declare function trustModeFile(projectDir: string): string;
export declare function psycheModeFile(projectDir: string): string;
export declare function learningGateFile(projectDir: string): string;
export declare function ensureDir(file: string): void;
export declare function writeJsonAtomic(file: string, payload: unknown): void;
export declare function safeReadJsonObject(file: string): Record<string, unknown> | null;
