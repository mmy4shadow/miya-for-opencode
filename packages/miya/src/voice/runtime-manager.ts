import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { log } from '../utils/logger';

type Provider = 'coqui' | 'rvc';

type RuntimeState = {
  installedAt?: string;
  venvPython?: string;
  providers: Record<Provider, { pid?: number; port: number; updatedAt: string }>;
};

type ProviderStatus = {
  provider: Provider;
  port: number;
  pid?: number;
  processAlive: boolean;
  healthOk: boolean;
};

const PROVIDER_PORT: Record<Provider, number> = {
  coqui: 5002,
  rvc: 5003,
};

const PYTHON_APP = `from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import base64
import json
import os
import tempfile
from pathlib import Path

provider = os.environ.get("MIYA_PROVIDER", "coqui").strip() or "coqui"
runtime_root = Path(os.environ.get("MIYA_RUNTIME_ROOT", ".")).resolve()
voice_store = runtime_root / "voices"
voice_store.mkdir(parents=True, exist_ok=True)

app = FastAPI()
_tts_engine = None
_tts_error = None
_voices_file = voice_store / f"{provider}-voices.json"

def _load_voices():
    if not _voices_file.exists():
        return {}
    try:
        return json.loads(_voices_file.read_text(encoding="utf-8"))
    except Exception:
        return {}

def _save_voices(payload):
    _voices_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

def _ensure_tts():
    global _tts_engine, _tts_error
    if _tts_engine is not None or _tts_error is not None:
        return _tts_engine
    try:
        from TTS.api import TTS
        model_name = os.environ.get("MIYA_COQUI_MODEL", "tts_models/en/vctk/vits")
        _tts_engine = TTS(model_name=model_name)
        return _tts_engine
    except Exception as err:
        _tts_error = str(err)
        return None

class SpeakInput(BaseModel):
    text: str
    voice_id: str | None = None
    model_id: str | None = None

class CloneInput(BaseModel):
    sample_url: str
    voice_name: str

@app.get("/health")
def health():
    engine = _ensure_tts()
    return {
        "ok": True,
        "provider": provider,
        "tts_ready": engine is not None,
        "tts_error": _tts_error,
    }

@app.post("/v1/clone")
def clone_voice(payload: CloneInput):
    voices = _load_voices()
    voice_id = f"{provider}-{len(voices)+1}"
    voices[voice_id] = {
        "name": payload.voice_name,
        "sample_url": payload.sample_url,
    }
    _save_voices(voices)
    return {"voice_id": voice_id}

@app.post("/v1/speak")
def speak(payload: SpeakInput):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    engine = _ensure_tts()
    if engine is None:
        raise HTTPException(
            status_code=503,
            detail=f"TTS engine unavailable. Install Coqui TTS in runtime venv. Error: {_tts_error}",
        )
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fp:
        out_path = fp.name
    try:
        kwargs = {}
        if payload.voice_id:
            voices = _load_voices()
            sample = voices.get(payload.voice_id, {}).get("sample_url")
            if sample and sample.startswith("file://"):
                kwargs["speaker_wav"] = sample[7:]
        engine.tts_to_file(text=text, file_path=out_path, **kwargs)
        data = Path(out_path).read_bytes()
        return {
            "provider": provider,
            "voice_id": payload.voice_id or provider,
            "audio_base64": base64.b64encode(data).decode("ascii"),
        }
    finally:
        try:
            Path(out_path).unlink(missing_ok=True)
        except Exception:
            pass
`;

function fileExists(file: string) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[], cwd?: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status ?? 1}`).trim());
  }
  return (result.stdout || '').trim();
}

async function ping(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const response = await fetch(url, { signal: ctrl.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export class LocalVoiceRuntimeManager {
  private readonly root: string;
  private readonly scriptDir: string;
  private readonly logDir: string;
  private readonly stateFile: string;
  private readonly venvDir: string;

  constructor() {
    this.root = path.join(os.homedir(), '.opencode', 'miya', 'voice-runtime');
    this.scriptDir = path.join(this.root, 'scripts');
    this.logDir = path.join(this.root, 'logs');
    this.stateFile = path.join(this.root, 'state.json');
    this.venvDir = path.join(this.root, 'venv');
  }

  private ensureLayout() {
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(this.scriptDir, { recursive: true });
    fs.mkdirSync(this.logDir, { recursive: true });
    fs.writeFileSync(path.join(this.scriptDir, 'voice_runtime_app.py'), PYTHON_APP, 'utf8');
  }

  private readState(): RuntimeState {
    const fallback: RuntimeState = {
      providers: {
        coqui: { port: PROVIDER_PORT.coqui, updatedAt: new Date(0).toISOString() },
        rvc: { port: PROVIDER_PORT.rvc, updatedAt: new Date(0).toISOString() },
      },
    };
    if (!fileExists(this.stateFile)) return fallback;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as RuntimeState;
      return {
        ...fallback,
        ...parsed,
        providers: {
          coqui: {
            ...fallback.providers.coqui,
            ...(parsed.providers?.coqui ?? {}),
            port: PROVIDER_PORT.coqui,
          },
          rvc: {
            ...fallback.providers.rvc,
            ...(parsed.providers?.rvc ?? {}),
            port: PROVIDER_PORT.rvc,
          },
        },
      };
    } catch {
      return fallback;
    }
  }

  private writeState(next: RuntimeState) {
    this.ensureLayout();
    fs.writeFileSync(this.stateFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  private detectSystemPython() {
    const candidates = process.platform === 'win32'
      ? ['python', 'py']
      : ['python3', 'python'];
    for (const cmd of candidates) {
      try {
        if (cmd === 'py') {
          runCommand('py', ['-3', '--version']);
          return { command: 'py', args: ['-3'] };
        }
        runCommand(cmd, ['--version']);
        return { command: cmd, args: [] as string[] };
      } catch {
        continue;
      }
    }
    throw new Error('Python not found. Install Python 3.10+ and retry.');
  }

  private venvPythonPath() {
    return process.platform === 'win32'
      ? path.join(this.venvDir, 'Scripts', 'python.exe')
      : path.join(this.venvDir, 'bin', 'python3');
  }

  private ensureVenvPython() {
    const py = this.venvPythonPath();
    if (fileExists(py)) return py;
    throw new Error('Voice runtime venv missing. Run miya_voice_install first.');
  }

  async install(force = false) {
    this.ensureLayout();
    const state = this.readState();
    const systemPy = this.detectSystemPython();

    if (force && fileExists(this.venvDir)) {
      fs.rmSync(this.venvDir, { recursive: true, force: true });
    }
    if (!fileExists(this.venvPythonPath())) {
      runCommand(systemPy.command, [...systemPy.args, '-m', 'venv', this.venvDir]);
    }

    const py = this.venvPythonPath();
    runCommand(py, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel']);
    runCommand(py, ['-m', 'pip', 'install', 'fastapi', 'uvicorn', 'pydantic', 'requests']);
    try {
      runCommand(py, ['-m', 'pip', 'install', 'TTS==0.22.0', 'numpy<2', 'soundfile']);
    } catch (error) {
      log('[voice-runtime] coqui install warning', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const next: RuntimeState = {
      ...state,
      installedAt: new Date().toISOString(),
      venvPython: py,
      providers: {
        coqui: { ...state.providers.coqui, updatedAt: new Date().toISOString() },
        rvc: { ...state.providers.rvc, updatedAt: new Date().toISOString() },
      },
    };
    this.writeState(next);
    return next;
  }

  private processAlive(pid?: number) {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async providerStatus(provider: Provider): Promise<ProviderStatus> {
    const state = this.readState();
    const item = state.providers[provider];
    const alive = this.processAlive(item.pid);
    const health = await ping(`http://127.0.0.1:${item.port}/health`);
    return {
      provider,
      port: item.port,
      pid: item.pid,
      processAlive: alive,
      healthOk: health,
    };
  }

  async status() {
    const state = this.readState();
    const [coqui, rvc] = await Promise.all([
      this.providerStatus('coqui'),
      this.providerStatus('rvc'),
    ]);
    return {
      root: this.root,
      installed: !!state.installedAt && fileExists(this.venvPythonPath()),
      installedAt: state.installedAt,
      coqui,
      rvc,
    };
  }

  async start(provider: Provider) {
    this.ensureLayout();
    const py = this.ensureVenvPython();
    const state = this.readState();
    const existing = state.providers[provider];
    if (this.processAlive(existing.pid)) {
      return this.status();
    }

    const logFile = path.join(this.logDir, `${provider}.log`);
    const fd = fs.openSync(logFile, 'a');
    const child = spawn(
      py,
      ['-m', 'uvicorn', 'voice_runtime_app:app', '--host', '127.0.0.1', '--port', String(existing.port)],
      {
        cwd: this.scriptDir,
        env: {
          ...process.env,
          MIYA_PROVIDER: provider,
          MIYA_RUNTIME_ROOT: this.root,
          PYTHONUNBUFFERED: '1',
        },
        detached: true,
        stdio: ['ignore', fd, fd],
      },
    );
    child.unref();
    fs.closeSync(fd);

    const next = this.readState();
    next.providers[provider].pid = child.pid;
    next.providers[provider].updatedAt = new Date().toISOString();
    this.writeState(next);

    for (let i = 0; i < 20; i++) {
      if (await ping(`http://127.0.0.1:${PROVIDER_PORT[provider]}/health`)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return this.status();
  }

  async stop(provider: Provider) {
    const state = this.readState();
    const item = state.providers[provider];
    if (item.pid && this.processAlive(item.pid)) {
      try {
        process.kill(item.pid);
      } catch {
        // ignore
      }
    }
    state.providers[provider] = {
      ...item,
      pid: undefined,
      updatedAt: new Date().toISOString(),
    };
    this.writeState(state);
    return this.status();
  }

  async up(providers: Provider[] = ['coqui', 'rvc']) {
    const current = await this.status();
    if (!current.installed) {
      await this.install(false);
    }
    for (const provider of providers) {
      await this.start(provider);
    }
    return this.status();
  }

  async down(providers: Provider[] = ['coqui', 'rvc']) {
    for (const provider of providers) {
      await this.stop(provider);
    }
    return this.status();
  }

  async doctor() {
    const lines: string[] = [];
    lines.push('Miya Local Voice Runtime Doctor');
    lines.push(`root=${this.root}`);

    try {
      const py = this.detectSystemPython();
      lines.push(`python=ok (${py.command})`);
    } catch (error) {
      lines.push(`python=missing (${error instanceof Error ? error.message : String(error)})`);
    }

    lines.push(`venv=${fileExists(this.venvPythonPath()) ? 'ok' : 'missing'}`);
    lines.push(`script=${fileExists(path.join(this.scriptDir, 'voice_runtime_app.py')) ? 'ok' : 'missing'}`);

    const status = await this.status();
    lines.push(
      `coqui pid=${status.coqui.pid ?? 'none'} alive=${status.coqui.processAlive} health=${status.coqui.healthOk}`,
    );
    lines.push(
      `rvc pid=${status.rvc.pid ?? 'none'} alive=${status.rvc.processAlive} health=${status.rvc.healthOk}`,
    );
    return lines.join('\n');
  }
}

