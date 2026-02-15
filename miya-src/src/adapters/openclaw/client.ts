import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { getMiyaClient } from '../../daemon/client';
import { venvPythonPath } from '../../daemon/python-runtime';
import type { AdapterRpcRequest, AdapterRpcResponse, EvidenceBundle, MiyaAdapter } from '../standard';
import { toAdapterEvidence } from '../standard';

export interface OpenClawAdapterInput {
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

interface OpenClawAdapterOutput {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

export class OpenClawAdapter implements MiyaAdapter<OpenClawAdapterInput, OpenClawAdapterOutput> {
  constructor(private readonly projectDir: string) {}

  validateInput(input: OpenClawAdapterInput): boolean {
    return Boolean(input && typeof input.method === 'string' && input.method.trim().length > 0);
  }

  injectPermission(auditID: string): Record<string, unknown> {
    return {
      audit_id: auditID,
      adapter: 'openclaw',
    };
  }

  async execute(input: OpenClawAdapterInput): Promise<OpenClawAdapterOutput> {
    if (!this.validateInput(input)) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'openclaw_adapter_input_invalid',
        },
      };
    }

    const req: AdapterRpcRequest = {
      id: `rpc_${randomUUID()}`,
      method: input.method,
      params: input.params ?? {},
    };
    const daemon = getMiyaClient(this.projectDir);
    const py = venvPythonPath(this.projectDir);
    const server = path.join(this.projectDir, 'miya-src', 'src', 'adapters', 'openclaw', 'server.py');
    const proc = await daemon.runIsolatedProcess({
      kind: 'shell.exec',
      command: py,
      args: [server],
      cwd: this.projectDir,
      timeoutMs: Math.max(1_000, input.timeoutMs ?? 15_000),
      env: {
        MIYA_ADAPTER_RPC_REQ: JSON.stringify(req),
      },
      metadata: {
        stage: 'adapter.openclaw.rpc',
        method: input.method,
      },
      resource: {
        priority: 85,
        vramMB: 0,
      },
    });
    if (proc.exitCode !== 0) {
      return {
        ok: false,
        error: {
          code: 'adapter_subprocess_failed',
          message: proc.stderr || proc.stdout || `exit_code_${String(proc.exitCode)}`,
        },
      };
    }
    const lines = String(proc.stdout || '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const last = lines.at(-1);
    if (!last) {
      return {
        ok: false,
        error: {
          code: 'adapter_invalid_response',
          message: 'openclaw_adapter_empty_stdout',
        },
      };
    }
    try {
      const parsed = JSON.parse(last) as AdapterRpcResponse;
      if (!parsed.ok) {
        return {
          ok: false,
          error: parsed.error ?? {
            code: 'adapter_error',
            message: 'openclaw_adapter_error',
          },
        };
      }
      return {
        ok: true,
        result: parsed.result,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'adapter_parse_failed',
          message: error instanceof Error ? error.message : String(error),
          details: { stdout: proc.stdout },
        },
      };
    }
  }

  normalizeOutput(raw: OpenClawAdapterOutput, auditID: string): EvidenceBundle {
    return toAdapterEvidence({
      adapter: 'openclaw',
      auditID,
      ok: raw.ok,
      summary: raw.ok ? 'openclaw_adapter_ok' : `openclaw_adapter_failed:${raw.error?.code ?? 'unknown'}`,
      raw,
      diagnostics: raw.ok ? undefined : { error: raw.error },
    });
  }
}

