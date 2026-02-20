import { runCommand } from './process';

export async function isOpenCodeInstalled(): Promise<boolean> {
  try {
    const result = await runCommand('opencode', ['--version'], 8_000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function isTmuxInstalled(): Promise<boolean> {
  try {
    const result = await runCommand('tmux', ['-V'], 8_000);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function getOpenCodeVersion(): Promise<string | null> {
  try {
    const result = await runCommand('opencode', ['--version'], 8_000);
    return result.exitCode === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

export async function fetchLatestVersion(
  packageName: string,
): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}
