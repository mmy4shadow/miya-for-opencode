import { spawn } from 'node:child_process';
import type { PluginInput } from '@opencode-ai/plugin';
import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  buildGatewayLaunchUrl,
  ensureGatewayRunning,
  probeGatewayAlive,
  stopGateway,
} from '../gateway';
import { collectSafetyEvidence } from '../safety/evidence';
import {
  activateKillSwitch,
  createTraceId,
  readKillSwitch,
  writeSelfApprovalRecord,
} from '../safety/store';
import type { SafetyTier } from '../safety/tier';
import { runVerifier } from '../safety/verifier';
import { listSettingEntries } from './registry';
import { applyConfigPatch, getConfigValue, validateConfigPatch } from './store';

const z = tool.schema;

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatValidationResult(
  validation: ReturnType<typeof validateConfigPatch>,
): string {
  const lines: string[] = [
    `ok=${validation.ok}`,
    `risk=${validation.maxRisk}`,
    `required_tier=${validation.requiredSafetyTier}`,
    `requires_evidence=${validation.requiresEvidence}`,
    `changes=${validation.changes.length}`,
  ];
  if (validation.errors.length > 0) {
    lines.push(`errors=${validation.errors.join(' | ')}`);
  }
  if (validation.warnings.length > 0) {
    lines.push(`warnings=${validation.warnings.join(' | ')}`);
  }
  if (validation.changes.length > 0) {
    lines.push(
      `changed_keys=${validation.changes.map((item) => item.key).join(', ')}`,
    );
  }
  return lines.join('\n');
}

function openUrl(url: string): void {
  if (process.platform === 'win32') {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

function stringifyPatch(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function safetyTierFromValidation(
  validation: ReturnType<typeof validateConfigPatch>,
): SafetyTier {
  if (validation.requiredSafetyTier === 'THOROUGH') return 'THOROUGH';
  if (validation.requiredSafetyTier === 'STANDARD') return 'STANDARD';
  return 'LIGHT';
}

export function createConfigTools(
  ctx: PluginInput,
): Record<string, ToolDefinition> {
  const miya_config_get = tool({
    description: 'Read Miya runtime config by key (or all flattened keys).',
    args: {
      key: z.string().optional().describe('Setting key, e.g. ui.language'),
    },
    async execute(args) {
      const key = args.key ? String(args.key) : undefined;
      const value = getConfigValue(ctx.directory, key);
      if (key) {
        return `key=${key}\nvalue=${formatValue(value)}`;
      }
      return formatValue(value);
    },
  });

  const miya_registry_list = tool({
    description:
      'List all writable Miya settings from registry with risk/type/default info.',
    args: {},
    async execute() {
      return formatValue({ settings: listSettingEntries() });
    },
  });

  const miya_config_validate = tool({
    description:
      'Validate config patch without writing (type/range/conflict/risk checks).',
    args: {
      patch: z.any().describe('Patch payload: {set,unset} or JSON Patch array'),
    },
    async execute(args) {
      return formatValidationResult(
        validateConfigPatch(ctx.directory, args.patch as unknown),
      );
    },
  });

  const miya_config_patch = tool({
    description:
      'Apply Miya config patch with self-approval audit. HIGH risk enforces THOROUGH verification.',
    args: {
      patch: z.any().describe('Patch payload: {set,unset} or JSON Patch array'),
      reason: z.string().optional().describe('Reason for this change'),
    },
    async execute(args, toolContext) {
      const sessionID =
        toolContext &&
        typeof toolContext === 'object' &&
        'sessionID' in toolContext
          ? String((toolContext as { sessionID: string }).sessionID)
          : 'main';

      const validation = validateConfigPatch(
        ctx.directory,
        args.patch as unknown,
      );
      if (!validation.ok) {
        return formatValidationResult(validation);
      }

      const traceID = createTraceId();
      const reason =
        args.reason && String(args.reason).trim().length > 0
          ? String(args.reason).trim()
          : 'config_patch';
      const action = `miya.config.patch ${reason}`;
      const tier = safetyTierFromValidation(validation);
      let allow = true;
      let verifierSummary = 'LOW/MED 配置变更自动通过。';
      let checks: string[] = ['config patch validation'];
      let evidence: string[] = [
        `patch=${stringifyPatch(args.patch)}`,
        `risk=${validation.maxRisk}`,
        `required_tier=${validation.requiredSafetyTier}`,
      ];
      let issues: string[] = [];

      if (validation.maxRisk === 'HIGH') {
        const kill = readKillSwitch(ctx.directory);
        if (kill.active) {
          allow = false;
          verifierSummary = 'Kill switch 已激活，拒绝高风险配置变更。';
          issues = ['kill_switch_active'];
        } else {
          const collected = await collectSafetyEvidence(
            ctx.directory,
            'THOROUGH',
          );
          checks = [...checks, ...collected.checks];
          evidence = [...evidence, ...collected.evidence.slice(0, 20)];
          issues = [...collected.issues];
          const verifier = await runVerifier(ctx, {
            sessionID,
            traceID,
            requestHash: `config:${traceID}`,
            tier: 'THOROUGH',
            action,
            checks,
            evidence,
            issues,
          });
          verifierSummary = verifier.summary;
          allow = collected.pass && verifier.verdict === 'allow';
        }
      }

      writeSelfApprovalRecord(ctx.directory, {
        trace_id: traceID,
        session_id: sessionID,
        request_hash: `config:${traceID}`,
        action,
        tier,
        status: allow ? 'allow' : 'deny',
        reason: allow
          ? verifierSummary
          : `config_patch_denied:${verifierSummary}`,
        checks: checks.slice(0, 20),
        evidence: evidence.slice(0, 30),
        executor: {
          agent: 'executor',
          plan: action,
        },
        verifier: {
          agent: '4-architecture-advisor',
          verdict: allow ? 'allow' : 'deny',
          summary: verifierSummary,
        },
        rollback: {
          strategy: '使用同一工具提交反向 patch 回滚。',
        },
      });

      if (!allow) {
        activateKillSwitch(
          ctx.directory,
          `config_patch_denied:${verifierSummary}`,
          traceID,
        );
        return [
          'VERDICT=DENY',
          `trace_id=${traceID}`,
          `risk=${validation.maxRisk}`,
          `reason=${verifierSummary}`,
          `changed_keys=${validation.changes.map((item) => item.key).join(', ')}`,
        ].join('\n');
      }

      const applied = applyConfigPatch(ctx.directory, validation);
      return [
        'VERDICT=ALLOW',
        `trace_id=${traceID}`,
        `risk=${validation.maxRisk}`,
        `required_tier=${validation.requiredSafetyTier}`,
        `changed_keys=${applied.applied.map((item) => item.key).join(', ')}`,
      ].join('\n');
    },
  });

  const miya_ui_open = tool({
    description: 'Open Miya 本地控制台页面（默认浏览器）。',
    args: {},
    async execute() {
      let state = ensureGatewayRunning(ctx.directory);
      let healthy = await probeGatewayAlive(state.url);
      if (!healthy) {
        stopGateway(ctx.directory);
        state = ensureGatewayRunning(ctx.directory);
        healthy = await probeGatewayAlive(state.url, 1_200);
      }
      if (!healthy) {
        return `opened=false\nreason=gateway_unhealthy\nurl=${state.uiUrl}`;
      }
      const launchUrl = buildGatewayLaunchUrl({
        url: state.uiUrl,
        authToken: state.authToken,
      });
      openUrl(launchUrl);
      return `opened=${state.uiUrl}`;
    },
  });

  return {
    miya_config_get,
    miya_config_validate,
    miya_config_patch,
    miya_registry_list,
    miya_ui_open,
  };
}
