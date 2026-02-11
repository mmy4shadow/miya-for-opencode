import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Registry of custom skills bundled in this repository.
 */
export const CUSTOM_SKILLS = [
    {
        name: 'cartography',
        description: 'Repository understanding and hierarchical codemap generation',
        allowedAgents: ['orchestrator'],
        sourcePath: 'src/skills/cartography',
    },
];
/**
 * Get the target directory for custom skills installation.
 */
export function getCustomSkillsDir() {
    return join(homedir(), '.config', 'opencode', 'skills');
}
/**
 * Recursively copy a directory.
 */
function copyDirRecursive(src, dest) {
    if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true });
    }
    const entries = readdirSync(src);
    for (const entry of entries) {
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);
        const stat = statSync(srcPath);
        if (stat.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        }
        else {
            const destDir = dirname(destPath);
            if (!existsSync(destDir)) {
                mkdirSync(destDir, { recursive: true });
            }
            copyFileSync(srcPath, destPath);
        }
    }
}
/**
 * Install a custom skill by copying from src/skills/ to ~/.config/opencode/skills/
 * @param skill - The custom skill to install
 * @param projectRoot - Root directory of miya project
 * @returns True if installation succeeded, false otherwise
 */
export function installCustomSkill(skill) {
    try {
        const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
        const sourcePath = join(packageRoot, skill.sourcePath);
        const targetPath = join(getCustomSkillsDir(), skill.name);
        // Validate source exists
        if (!existsSync(sourcePath)) {
            console.error(`Custom skill source not found: ${sourcePath}`);
            return false;
        }
        // Copy skill directory
        copyDirRecursive(sourcePath, targetPath);
        return true;
    }
    catch (error) {
        console.error(`Failed to install custom skill: ${skill.name}`, error);
        return false;
    }
}
