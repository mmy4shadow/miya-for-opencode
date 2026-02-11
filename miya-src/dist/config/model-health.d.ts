export declare function getModelProviderID(model: string): string;
export declare function isStrongProviderAvailable(providerID: string): boolean;
export declare function isModelLikelyAvailable(model: string): boolean;
export declare function pickBestAvailableModel(candidates: readonly string[]): string | null;
