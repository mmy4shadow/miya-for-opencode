/**
 * A recommended skill to install via `npx skills add`.
 */
export interface RecommendedSkill {
    /** Human-readable name for prompts */
    name: string;
    /** GitHub repo URL for `npx skills add` */
    repo: string;
    /** Skill name within the repo (--skill flag) */
    skillName: string;
    /** List of agents that should auto-allow this skill */
    allowedAgents: string[];
    /** Description shown to user during install */
    description: string;
    /** Optional commands to run after the skill is added */
    postInstallCommands?: string[];
}
/**
 * List of recommended skills.
 * Add new skills here to include them in the installation flow.
 */
export declare const RECOMMENDED_SKILLS: RecommendedSkill[];
/**
 * Install a skill using `npx skills add`.
 * @param skill - The skill to install
 * @returns True if installation succeeded, false otherwise
 */
export declare function installSkill(skill: RecommendedSkill): boolean;
/**
 * Get permission presets for a specific agent based on recommended skills.
 * @param agentName - The name of the agent
 * @param skillList - Optional explicit list of skills to allow (overrides recommendations)
 * @returns Permission rules for the skill permission type
 */
export declare function getSkillPermissionsForAgent(agentName: string, skillList?: string[]): Record<string, 'allow' | 'ask' | 'deny'>;
