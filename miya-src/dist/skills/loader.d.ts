export interface SkillDescriptor {
    id: string;
    name: string;
    source: 'workspace' | 'global' | 'builtin' | 'extra';
    dir: string;
    skillFile: string;
    frontmatter: {
        version?: string;
        description?: string;
        bins?: string[];
        env?: string[];
        platforms?: string[];
    };
    gate: {
        loadable: boolean;
        reasons: string[];
    };
}
export declare function discoverSkills(projectDir: string, extraDirs?: string[]): SkillDescriptor[];
