export interface CompanionAsset {
    id: string;
    type: 'image' | 'audio';
    label?: string;
    pathOrUrl: string;
    createdAt: string;
}
export interface CompanionProfile {
    enabled: boolean;
    onboardingCompleted: boolean;
    name: string;
    persona: string;
    relationship: string;
    style: string;
    memoryFacts: string[];
    assets: CompanionAsset[];
    updatedAt: string;
}
export declare function readCompanionProfile(projectDir: string): CompanionProfile;
export declare function writeCompanionProfile(projectDir: string, profile: CompanionProfile): CompanionProfile;
export declare function patchCompanionProfile(projectDir: string, patch: Partial<Pick<CompanionProfile, 'enabled' | 'onboardingCompleted' | 'name' | 'persona' | 'relationship' | 'style'>>): CompanionProfile;
export declare function addCompanionMemoryFact(projectDir: string, fact: string): CompanionProfile;
export declare function addCompanionAsset(projectDir: string, input: {
    type: CompanionAsset['type'];
    pathOrUrl: string;
    label?: string;
}): CompanionProfile;
export declare function resetCompanionProfile(projectDir: string): CompanionProfile;
