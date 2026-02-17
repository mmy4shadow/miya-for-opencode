import type { AutopilotRunDigest, AutopilotStats } from './types';
export declare function readAutopilotStats(projectDir: string): AutopilotStats;
export declare function recordAutopilotRunDigest(projectDir: string, digest: AutopilotRunDigest): AutopilotStats;
