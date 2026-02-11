import type { DiscoveredModel, OpenCodeFreeModel } from './types';
export declare function parseOpenCodeModelsVerboseOutput(output: string, providerFilter?: string, freeOnly?: boolean): DiscoveredModel[];
export declare function discoverModelCatalog(): Promise<{
    models: DiscoveredModel[];
    error?: string;
}>;
export declare function discoverOpenCodeFreeModels(): Promise<{
    models: OpenCodeFreeModel[];
    error?: string;
}>;
export declare function discoverProviderFreeModels(providerID: string): Promise<{
    models: OpenCodeFreeModel[];
    error?: string;
}>;
