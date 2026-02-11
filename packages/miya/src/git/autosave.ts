import { spawn } from 'node:child_process';
import { log } from '../utils/logger';

const DEFAULT_REMOTE = 'miya-autosave';
const DEFAULT_REMOTE_URL = 'https://github.com/mmy4shadow/miya-for-opencode.git';

type CmdResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

let running = false;
let lastDoneAt = 0;

function runGit(
  directory: string,
  args: string[],
  options?: { allowFailure?: boolean },
): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd: directory,
      env: process.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      const ok = code === 0 || options?.allowFailure === true;
      resolve({ ok, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', (error) => {
      resolve({
        ok: options?.allowFailure === true,
        code: null,
        stdout: stdout.trim(),
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });
  });
}

async function ensureRemote(directory: string, remoteName: string, remoteUrl: string) {
  const getUrl = await runGit(directory, ['remote', 'get-url', remoteName], {
    allowFailure: true,
  });
  if (getUrl.code === 0 && getUrl.stdout === remoteUrl) return;
  if (getUrl.code === 0) {
    await runGit(directory, ['remote', 'set-url', remoteName, remoteUrl], {
      allowFailure: true,
    });
    return;
  }
  await runGit(directory, ['remote', 'add', remoteName, remoteUrl], {
    allowFailure: true,
  });
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function autoSaveToGithub(
  directory: string,
  input?: { remoteName?: string; remoteUrl?: string },
) {
  if (running) return;
  if (Date.now() - lastDoneAt < 5000) return;
  running = true;
  const remoteName = input?.remoteName ?? DEFAULT_REMOTE;
  const remoteUrl = input?.remoteUrl ?? DEFAULT_REMOTE_URL;

  const check = await runGit(directory, ['rev-parse', '--is-inside-work-tree'], {
    allowFailure: true,
  });
  if (check.code !== 0) {
    running = false;
    return;
  }

  await ensureRemote(directory, remoteName, remoteUrl);

  const dirty = await runGit(directory, ['status', '--porcelain'], {
    allowFailure: true,
  });
  if (!dirty.stdout.trim()) {
    running = false;
    lastDoneAt = Date.now();
    return;
  }

  await runGit(directory, ['add', '-A'], { allowFailure: true });

  const commitMessage = `chore(miya): autosave ${nowStamp()}`;
  const commit = await runGit(
    directory,
    [
      '-c',
      'user.name=Miya Autopilot',
      '-c',
      'user.email=miya-autopilot@local',
      'commit',
      '-m',
      commitMessage,
    ],
    { allowFailure: true },
  );
  if (commit.code !== 0 && !/nothing to commit/i.test(commit.stderr)) {
    log('[miya-autosave] commit failed', {
      code: commit.code,
      stderr: commit.stderr,
    });
    running = false;
    lastDoneAt = Date.now();
    return;
  }

  const branch = await runGit(directory, ['rev-parse', '--abbrev-ref', 'HEAD'], {
    allowFailure: true,
  });
  const target = branch.stdout && branch.stdout !== 'HEAD' ? branch.stdout : 'main';
  const push = await runGit(directory, ['push', '--no-verify', remoteName, `HEAD:${target}`], {
    allowFailure: true,
  });
  if (push.code !== 0) {
    log('[miya-autosave] push failed', {
      code: push.code,
      stderr: push.stderr,
      remoteName,
      remoteUrl,
      target,
    });
  }

  running = false;
  lastDoneAt = Date.now();
}
