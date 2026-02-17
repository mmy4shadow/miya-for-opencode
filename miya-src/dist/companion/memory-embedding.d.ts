export type EmbeddingProviderKind = 'local-hash' | 'local-ngram' | 'remote-http';
export interface EmbeddingProviderConfig {
    kind: EmbeddingProviderKind;
    dims: number;
    url?: string;
    model?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
    fallbackKind?: 'local-hash' | 'local-ngram';
}
export interface EmbeddingProviderInfo {
    kind: EmbeddingProviderKind;
    description: string;
    supportsRemote: boolean;
}
export declare function listEmbeddingProviders(): EmbeddingProviderInfo[];
export declare function readEmbeddingProviderConfig(projectDir: string): EmbeddingProviderConfig;
export declare function writeEmbeddingProviderConfig(projectDir: string, patch: Partial<EmbeddingProviderConfig>): EmbeddingProviderConfig;
export declare function embedTextWithProvider(projectDir: string, text: string): {
    embedding: number[];
    provider: string;
    dims: number;
};
