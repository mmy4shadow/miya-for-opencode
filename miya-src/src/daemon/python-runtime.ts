import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface PythonRuntimeDiagnostics {
  ok: boolean;
  issues: string[];
  torch?: Record<string, unknown>;
  paths?: Record<string, unknown>;
  binaries?: Record<string, unknown>;
  min_vram_mb?: number;
}

export interface PythonDependencyRecommendation {
  package: string;
  recommendedVersion: string;
  reason: string;
  command: string;
}

export interface PythonRuntimeRepairPlan {
  issueType: 'ok' | 'no_gpu' | 'dependency_fault';
  warnings: string[];
  recommendations: PythonDependencyRecommendation[];
  conflicts: string[];
  oneShotCommand?: string;
  opencodeAssistPrompt?: string;
}

export interface PythonRuntimeStatus {
  ready: boolean;
  venvPath: string;
  pythonPath: string;
  diagnostics?: PythonRuntimeDiagnostics;
  trainingDisabledReason?: 'no_gpu' | 'dependency_fault';
  repairPlan?: PythonRuntimeRepairPlan;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function daemonDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'daemon');
}

function statusFile(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'python-runtime.json');
}

function writeStatus(projectDir: string, status: PythonRuntimeStatus): void {
  fs.mkdirSync(path.dirname(statusFile(projectDir)), { recursive: true });
  fs.writeFileSync(statusFile(projectDir), `${JSON.stringify(status, null, 2)}\n`, 'utf-8');
}

function readStatus(projectDir: string): PythonRuntimeStatus | null {
  const file = statusFile(projectDir);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as PythonRuntimeStatus;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function venvDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'venv');
}

export function venvPythonPath(projectDir: string): string {
  return process.platform === 'win32'
    ? path.join(venvDir(projectDir), 'Scripts', 'python.exe')
    : path.join(venvDir(projectDir), 'bin', 'python');
}

function pythonBootstrapCandidates(): Array<{ command: string; args: string[] }> {
  const candidates: Array<{ command: string; args: string[] }> = [];
  if (process.platform === 'win32') {
    candidates.push({ command: 'py', args: ['-3.11'] });
    candidates.push({ command: 'py', args: ['-3'] });
  }
  candidates.push({ command: 'python3', args: [] });
  candidates.push({ command: 'python', args: [] });
  return candidates;
}

function run(command: string, args: string[], cwd: string, timeoutMs = 300_000): {
  ok: boolean;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function ensureVenv(projectDir: string): { ok: boolean; message?: string } {
  const pythonPath = venvPythonPath(projectDir);
  if (fs.existsSync(pythonPath)) return { ok: true };

  fs.mkdirSync(path.dirname(venvDir(projectDir)), { recursive: true });
  for (const candidate of pythonBootstrapCandidates()) {
    const result = run(
      candidate.command,
      [...candidate.args, '-m', 'venv', venvDir(projectDir)],
      projectDir,
      240_000,
    );
    if (result.ok && fs.existsSync(pythonPath)) {
      return { ok: true };
    }
  }
  return { ok: false, message: 'venv_create_failed:no_python_interpreter' };
}

function installRequirements(projectDir: string, pythonPath: string): { ok: boolean; message?: string } {
  const requirements = path.join(projectDir, 'miya-src', 'python', 'requirements.txt');
  if (!fs.existsSync(requirements)) {
    return { ok: false, message: 'requirements_missing' };
  }
  const upgradePip = run(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'], projectDir);
  if (!upgradePip.ok) {
    return { ok: false, message: `pip_upgrade_failed:${upgradePip.stderr.trim() || upgradePip.stdout.trim()}` };
  }
  const install = run(
    pythonPath,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements],
    projectDir,
    900_000,
  );
  if (!install.ok) {
    return { ok: false, message: `pip_install_failed:${install.stderr.trim() || install.stdout.trim()}` };
  }
  return { ok: true };
}

function runCheckEnv(projectDir: string, pythonPath: string): PythonRuntimeDiagnostics {
  const script = path.join(projectDir, 'miya-src', 'python', 'check_env.py');
  if (!fs.existsSync(script)) {
    return { ok: false, issues: ['check_env_script_missing'] };
  }
  const result = run(pythonPath, [script], projectDir, 120_000);
  if (!result.ok) {
    return { ok: false, issues: ['check_env_run_failed'] };
  }
  try {
    return JSON.parse(result.stdout) as PythonRuntimeDiagnostics;
  } catch {
    return { ok: false, issues: ['check_env_parse_failed'] };
  }
}

function classifyTrainingCapability(diagnostics: PythonRuntimeDiagnostics): PythonRuntimeStatus['trainingDisabledReason'] {
  if (!Array.isArray(diagnostics.issues) || diagnostics.issues.length === 0) return undefined;
  const hasDependencyIssue = diagnostics.issues.some((issue) =>
    /torch_not_installed|pip_|requirements_missing|check_env_|parse_failed|run_failed|metadata_invalid/i.test(
      issue,
    ),
  );
  if (hasDependencyIssue) return 'dependency_fault';
  if (diagnostics.issues.includes('cuda_not_available')) return 'no_gpu';
  return 'dependency_fault';
}

function recommendationMap(issue: string): PythonDependencyRecommendation[] {
  if (issue === 'torch_not_installed') {
    return [
      {
        package: 'torch',
        recommendedVersion: '>=2.2.0',
        reason: 'PyTorch is required by FLUX/GPT-SoVITS runtime and CUDA probing.',
        command: 'pip install "torch>=2.2.0" "torchvision>=0.17.0" "torchaudio>=2.2.0"',
      },
    ];
  }
  if (issue === 'ffmpeg_missing') {
    return [
      {
        package: 'ffmpeg',
        recommendedVersion: 'system_latest',
        reason: 'Audio preprocess and format conversion require ffmpeg binary.',
        command: 'winget install --id Gyan.FFmpeg -e',
      },
    ];
  }
  if (issue.startsWith('pip_install_failed')) {
    return [
      {
        package: 'python-deps',
        recommendedVersion: 'requirements.txt',
        reason: 'pip install failed while resolving project dependencies.',
        command:
          'python -m pip install --upgrade pip setuptools wheel && python -m pip install --disable-pip-version-check -r miya-src/python/requirements.txt',
      },
    ];
  }
  return [];
}

function dedupeRecommendations(items: PythonDependencyRecommendation[]): PythonDependencyRecommendation[] {
  const seen = new Set<string>();
  const out: PythonDependencyRecommendation[] = [];
  for (const item of items) {
    const key = `${item.package}::${item.recommendedVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractConflicts(issues: string[]): string[] {
  const conflicts: string[] = [];
  for (const issue of issues) {
    if (issue.startsWith('pip_install_failed:')) {
      conflicts.push(issue.slice('pip_install_failed:'.length));
    }
  }
  return conflicts.slice(0, 5);
}

function buildRepairPlan(input: {
  diagnostics: PythonRuntimeDiagnostics;
  reason?: PythonRuntimeStatus['trainingDisabledReason'];
  pythonPath: string;
}): PythonRuntimeRepairPlan {
  const issues = Array.isArray(input.diagnostics.issues) ? input.diagnostics.issues : [];
  const issueType: PythonRuntimeRepairPlan['issueType'] = input.reason
    ? input.reason
    : issues.length > 0
      ? 'dependency_fault'
      : 'ok';
  if (issueType === 'ok') {
    return { issueType: 'ok', warnings: [], recommendations: [], conflicts: [] };
  }
  if (issueType === 'no_gpu') {
    return {
      issueType: 'no_gpu',
      warnings: ['no_gpu_detected_training_disabled'],
      recommendations: [],
      conflicts: [],
      opencodeAssistPrompt:
        'Miya detected no GPU. Keep training disabled and guide user to install a compatible GPU driver or run on a GPU machine.',
    };
  }
  const recommendations = dedupeRecommendations(issues.flatMap((issue) => recommendationMap(issue)));
  const oneShotCommand = recommendations.map((item) => item.command).join(' && ');
  const conflicts = extractConflicts(issues);
  const recSummary = recommendations.length
    ? recommendations
        .map((item) => `- ${item.package} ${item.recommendedVersion}: ${item.reason}\n  cmd: ${item.command}`)
        .join('\n')
    : '- Re-run requirements installation and inspect pip stderr.';
  const prompt = [
    'You are assisting Miya local Python environment recovery.',
    `Interpreter: ${input.pythonPath}`,
    `Issues: ${issues.join(', ') || 'none'}`,
    conflicts.length ? `Conflicts: ${conflicts.join(' | ')}` : 'Conflicts: none',
    'Please produce a minimal repair plan with exact commands and explain why each dependency version is recommended.',
    'Current deterministic recommendations:',
    recSummary,
  ].join('\n');
  return {
    issueType: 'dependency_fault',
    warnings: ['dependency_fault_detected'],
    recommendations,
    conflicts,
    oneShotCommand: oneShotCommand || undefined,
    opencodeAssistPrompt: prompt,
  };
}

export function readPythonRuntimeStatus(projectDir: string): PythonRuntimeStatus | null {
  return readStatus(projectDir);
}

export function ensurePythonRuntime(projectDir: string): PythonRuntimeStatus {
  const existing = readStatus(projectDir);
  const pythonPath = venvPythonPath(projectDir);
  if (existing?.ready && fs.existsSync(existing.pythonPath)) {
    return existing;
  }

  const venv = ensureVenv(projectDir);
  if (!venv.ok) {
    const failed: PythonRuntimeStatus = {
      ready: false,
      venvPath: venvDir(projectDir),
      pythonPath,
      updatedAt: nowIso(),
      diagnostics: { ok: false, issues: [venv.message ?? 'venv_create_failed'] },
      trainingDisabledReason: 'dependency_fault',
      repairPlan: buildRepairPlan({
        diagnostics: { ok: false, issues: [venv.message ?? 'venv_create_failed'] },
        reason: 'dependency_fault',
        pythonPath,
      }),
    };
    writeStatus(projectDir, failed);
    return failed;
  }

  const deps = installRequirements(projectDir, pythonPath);
  if (!deps.ok) {
    const failed: PythonRuntimeStatus = {
      ready: false,
      venvPath: venvDir(projectDir),
      pythonPath,
      updatedAt: nowIso(),
      diagnostics: { ok: false, issues: [deps.message ?? 'pip_install_failed'] },
      trainingDisabledReason: 'dependency_fault',
      repairPlan: buildRepairPlan({
        diagnostics: { ok: false, issues: [deps.message ?? 'pip_install_failed'] },
        reason: 'dependency_fault',
        pythonPath,
      }),
    };
    writeStatus(projectDir, failed);
    return failed;
  }

  const diagnostics = runCheckEnv(projectDir, pythonPath);
  const status: PythonRuntimeStatus = {
    ready: diagnostics.ok,
    venvPath: venvDir(projectDir),
    pythonPath,
    diagnostics,
    updatedAt: nowIso(),
    trainingDisabledReason: classifyTrainingCapability(diagnostics),
    repairPlan: buildRepairPlan({
      diagnostics,
      reason: classifyTrainingCapability(diagnostics),
      pythonPath,
    }),
  };
  writeStatus(projectDir, status);
  return status;
}
