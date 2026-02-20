export interface SkillFrontmatter {
    name?: string;
    version?: string;
    description?: string;
    bins?: string[];
    env?: string[];
    platforms?: string[];
    permissions?: string[];
}
export declare function parseSkillFrontmatter(markdown: string): SkillFrontmatter;
