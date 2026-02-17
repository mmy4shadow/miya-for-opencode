import type { SoulProfile } from './types';
export type SoulLayerMode = 'work' | 'chat' | 'mixed';
export type SoulLayerDepth = 'minimal' | 'full';
export declare function loadSoulProfile(projectDir: string): SoulProfile;
export declare function saveSoulMarkdown(projectDir: string, markdown: string): SoulProfile;
export declare function soulPersonaLayer(projectDir: string, options?: {
    mode?: SoulLayerMode;
    depth?: SoulLayerDepth;
}): string;
export declare function soulFilePath(projectDir: string): string;
