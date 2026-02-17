/**
 * A custom skill bundled in this repository.
 * Unlike npx-installed skills, these are copied from src/skills/ to ~/.config/opencode/skills/
 */
export interface CustomSkill {
    /** Skill name (folder name) */
    name: string;
    /** Human-readable description */
    description: string;
    /** List of agents that should auto-allow this skill */
    allowedAgents: string[];
    /** Source path in this repo (relative to project root) */
    sourcePath: string;
}
/**
 * Registry of custom skills bundled in this repository.
 */
export declare const CUSTOM_SKILLS: CustomSkill[];
/**
 * Get the target directory for custom skills installation.
 */
export declare function getCustomSkillsDir(): string;
export declare function getCustomSkillPermissionsForAgent(agentName: string): Record<string, 'allow' | 'deny'>;
/**
 * Install a custom skill by copying from src/skills/ to ~/.config/opencode/skills/
 * @param skill - The custom skill to install
 * @param projectRoot - Root directory of miya project
 * @returns True if installation succeeded, false otherwise
 */
export declare function installCustomSkill(skill: CustomSkill): boolean;
