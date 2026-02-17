export type PersonaWorldRisk = 'low' | 'medium' | 'high';
export interface PersonaPreset {
    id: string;
    name: string;
    persona: string;
    style: string;
    relationship: string;
    risk: PersonaWorldRisk;
    createdAt: string;
    updatedAt: string;
}
export interface WorldPreset {
    id: string;
    name: string;
    summary: string;
    rules: string[];
    tags: string[];
    risk: PersonaWorldRisk;
    createdAt: string;
    updatedAt: string;
}
export interface SessionPersonaWorldBinding {
    sessionID: string;
    personaPresetID?: string;
    worldPresetID?: string;
    updatedAt: string;
}
export declare function listPersonaPresets(projectDir: string): PersonaPreset[];
export declare function listWorldPresets(projectDir: string): WorldPreset[];
export declare function upsertPersonaPreset(projectDir: string, input: {
    id?: string;
    name: string;
    persona: string;
    style: string;
    relationship: string;
    risk?: PersonaWorldRisk;
}): PersonaPreset;
export declare function upsertWorldPreset(projectDir: string, input: {
    id?: string;
    name: string;
    summary: string;
    rules?: string[];
    tags?: string[];
    risk?: PersonaWorldRisk;
}): WorldPreset;
export declare function bindSessionPersonaWorld(projectDir: string, input: {
    sessionID: string;
    personaPresetID?: string;
    worldPresetID?: string;
}): SessionPersonaWorldBinding;
export declare function resolveSessionPersonaWorld(projectDir: string, sessionID: string): {
    binding: SessionPersonaWorldBinding;
    persona?: PersonaPreset;
    world?: WorldPreset;
    risk: PersonaWorldRisk;
};
export declare function buildPersonaWorldPrompt(projectDir: string, sessionID: string): string;
