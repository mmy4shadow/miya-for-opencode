import { release } from 'node:os';
import { runProcess, runProcessSync } from './process';

const WINDOWS_BUILD_WITH_TAR = 17134;

function getWindowsBuildNumber(): number | null {
  if (process.platform !== 'win32') return null;

  const parts = release().split('.');
  if (parts.length >= 3) {
    const build = parseInt(parts[2], 10);
    if (!Number.isNaN(build)) return build;
  }
  return null;
}

function isPwshAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  const result = runProcessSync('where', ['pwsh']);
  return result.exitCode === 0;
}

function escapePowerShellPath(path: string): string {
  return path.replace(/'/g, "''");
}

type WindowsZipExtractor = 'tar' | 'pwsh' | 'powershell';

function getWindowsZipExtractor(): WindowsZipExtractor {
  const buildNumber = getWindowsBuildNumber();

  if (buildNumber !== null && buildNumber >= WINDOWS_BUILD_WITH_TAR) {
    return 'tar';
  }

  if (isPwshAvailable()) {
    return 'pwsh';
  }

  return 'powershell';
}

export async function extractZip(
  archivePath: string,
  destDir: string,
): Promise<void> {
  let result: Awaited<ReturnType<typeof runProcess>>;

  if (process.platform === 'win32') {
    const extractor = getWindowsZipExtractor();

    switch (extractor) {
      case 'tar':
        result = await runProcess('tar', ['-xf', archivePath, '-C', destDir]);
        break;
      case 'pwsh':
        result = await runProcess('pwsh', [
          '-Command',
          `Expand-Archive -Path '${escapePowerShellPath(archivePath)}' -DestinationPath '${escapePowerShellPath(destDir)}' -Force`,
        ]);
        break;
      default:
        result = await runProcess('powershell', [
          '-Command',
          `Expand-Archive -Path '${escapePowerShellPath(archivePath)}' -DestinationPath '${escapePowerShellPath(destDir)}' -Force`,
        ]);
        break;
    }
  } else {
    result = await runProcess('unzip', ['-o', archivePath, '-d', destDir]);
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `zip extraction failed (exit ${result.exitCode}): ${result.stderr}`,
    );
  }
}
