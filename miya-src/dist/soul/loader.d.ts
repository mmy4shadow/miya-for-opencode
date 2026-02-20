import type { SoulProfile } from './types';
export declare function loadSoulProfile(projectDir: string): SoulProfile;
export declare function saveSoulMarkdown(projectDir: string, markdown: string): SoulProfile;
export declare function soulPersonaLayer(projectDir: string): string;
export declare function soulFilePath(projectDir: string): string;
