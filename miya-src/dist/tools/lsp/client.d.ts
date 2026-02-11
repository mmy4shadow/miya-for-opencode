import type { Diagnostic, ResolvedServer } from './types';
declare class LSPServerManager {
    private static instance;
    private clients;
    private cleanupInterval;
    private readonly IDLE_TIMEOUT;
    private constructor();
    private registerProcessCleanup;
    static getInstance(): LSPServerManager;
    private getKey;
    private startCleanupTimer;
    private cleanupIdleClients;
    getClient(root: string, server: ResolvedServer): Promise<LSPClient>;
    releaseClient(root: string, serverId: string): void;
    isServerInitializing(root: string, serverId: string): boolean;
    stopAll(): Promise<void>;
}
export declare const lspManager: LSPServerManager;
export declare class LSPClient {
    private root;
    private server;
    private proc;
    private connection;
    private openedFiles;
    private stderrBuffer;
    private processExited;
    private diagnosticsStore;
    constructor(root: string, server: ResolvedServer);
    start(): Promise<void>;
    private startStderrReading;
    initialize(): Promise<void>;
    openFile(filePath: string): Promise<void>;
    definition(filePath: string, line: number, character: number): Promise<unknown>;
    references(filePath: string, line: number, character: number, includeDeclaration?: boolean): Promise<unknown>;
    diagnostics(filePath: string): Promise<{
        items: Diagnostic[];
    }>;
    rename(filePath: string, line: number, character: number, newName: string): Promise<unknown>;
    isAlive(): boolean;
    stop(): Promise<void>;
}
export {};
