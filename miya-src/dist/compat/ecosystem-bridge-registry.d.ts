export interface EcosystemBridgeEntry {
    id: string;
    name: string;
    repository: string;
    integrationMode: 'reference' | 'adapter' | 'skill-pack' | 'runtime-link';
    versionPolicy: {
        pinRequired: boolean;
        updateCadence: 'manual' | 'scheduled';
    };
    compatibilityMatrix: {
        minMiyaVersion: string;
        minOpenCodeVersion: string;
        platforms: Array<'windows' | 'linux' | 'macos'>;
    };
    permissionMetadata: {
        sideEffects: string[];
        requiredDomains: string[];
    };
    rollbackPlan: {
        strategy: 'disable_entry' | 'rollback_adapter' | 'pin_previous';
        steps: string[];
    };
    auditFields: string[];
    tags: string[];
}
export declare const ECOSYSTEM_BRIDGE_REGISTRY: EcosystemBridgeEntry[];
export declare function listEcosystemBridgeRegistry(): EcosystemBridgeEntry[];
export declare function getEcosystemBridgeEntry(id: string): EcosystemBridgeEntry | null;
