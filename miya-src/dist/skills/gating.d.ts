import type { SkillFrontmatter } from './frontmatter';
export interface SkillGateResult {
    loadable: boolean;
    reasons: string[];
}
export declare function evaluateSkillGate(frontmatter: SkillFrontmatter): SkillGateResult;
