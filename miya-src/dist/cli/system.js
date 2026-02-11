export async function isOpenCodeInstalled() {
    try {
        const proc = Bun.spawn(['opencode', '--version'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        await proc.exited;
        return proc.exitCode === 0;
    }
    catch {
        return false;
    }
}
export async function isTmuxInstalled() {
    try {
        const proc = Bun.spawn(['tmux', '-V'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        await proc.exited;
        return proc.exitCode === 0;
    }
    catch {
        return false;
    }
}
export async function getOpenCodeVersion() {
    try {
        const proc = Bun.spawn(['opencode', '--version'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const output = await new Response(proc.stdout).text();
        await proc.exited;
        return proc.exitCode === 0 ? output.trim() : null;
    }
    catch {
        return null;
    }
}
export async function fetchLatestVersion(packageName) {
    try {
        const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
        if (!res.ok)
            return null;
        const data = (await res.json());
        return data.version;
    }
    catch {
        return null;
    }
}
