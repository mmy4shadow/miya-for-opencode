import type { PluginInput } from '@opencode-ai/plugin';
import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { collectSafetyEvidence } from './evidence';
import {
  buildRequestHash,
  isSideEffectPermission,
  requiredTierForRequest,
  type SafetyPermissionRequest,
} from './risk';
import {
  activateKillSwitch,
  createTraceId,
  findApprovalToken,
  listRecentSelfApprovalRecords,
  readKillSwitch,
  releaseKillSwitch,
  saveApprovalToken,
  writeSelfApprovalRecord,
} from './store';
import { normalizeTier, type SafetyTier, tierAtLeast } from './tier';
import { runVerifier } from './verifier';

const z = tool.schema;

export interface PermissionAskInput {
  sessionID: string;
  permission: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
  messageID?: string;
  toolCallID?: string;
  tool?: { messageID?: string; callID?: string };
}

function nowIso(): string {
  return new Date().toISOString();
}

function toPermissionRequest(
  input: PermissionAskInput,
): SafetyPermissionRequest {
  return {
    sessionID: input.sessionID,
    permission: input.permission,
    patterns: Array.isArray(input.patterns) ? input.patterns.map(String) : [],
    metadata: input.metadata,
    messageID: input.messageID ?? input.tool?.messageID,
    toolCallID: input.toolCallID ?? input.tool?.callID,
  };
}

function maxTier(a: SafetyTier, b: SafetyTier): SafetyTier {
  if (tierAtLeast(a, b)) return a;
  return b;
}

function formatResult(input: {
  verdict: 'allow' | 'deny';
  traceID: string;
  requestHash: string;
  tier: SafetyTier;
  reason: string;
  checks: string[];
  issues: string[];
}): string {
  return [
    `VERDICT=${input.verdict.toUpperCase()}`,
    `trace_id=${input.traceID}`,
    `request_hash=${input.requestHash}`,
    `tier=${input.tier}`,
    `reason=${input.reason}`,
    `checks=${input.checks.length}`,
    input.issues.length > 0
      ? `issues=${input.issues.join(' | ')}`
      : 'issues=none',
  ].join('\n');
}

export async function handlePermissionAsk(
  projectDir: string,
  input: PermissionAskInput,
): Promise<{ status: 'allow' | 'deny'; reason: string }> {
  const request = toPermissionRequest(input);
  if (!isSideEffectPermission(request.permission)) {
    return { status: 'allow', reason: 'non-side-effect permission' };
  }

  const kill = readKillSwitch(projectDir);
  const requiredTier = requiredTierForRequest(request);
  const strictHash = buildRequestHash(request, true);
  const baseHash = buildRequestHash(request, false);

  if (kill.active) {
    writeSelfApprovalRecord(projectDir, {
      trace_id: kill.trace_id ?? createTraceId(),
      session_id: request.sessionID,
      request_hash: strictHash,
      action: `permission.asked:${request.permission}`,
      tier: requiredTier,
      status: 'deny',
      reason: 'kill_switch_active',
      checks: ['kill switch state'],
      evidence: [`kill_switch_reason=${kill.reason ?? 'n/a'}`],
      executor: {
        agent: 'executor',
        plan: 'attempt permission request under kill-switch',
      },
      verifier: {
        agent: 'architect-verifier',
        verdict: 'deny',
        summary: 'Kill switch is active.',
      },
      rollback: { strategy: 'release kill switch after root cause is fixed' },
    });
    return { status: 'deny', reason: 'kill_switch_active' };
  }

  const token = findApprovalToken(
    projectDir,
    request.sessionID,
    [strictHash, baseHash],
    requiredTier,
  );
  if (!token) {
    const traceID = createTraceId();
    activateKillSwitch(projectDir, 'missing_evidence', traceID);
    writeSelfApprovalRecord(projectDir, {
      trace_id: traceID,
      session_id: request.sessionID,
      request_hash: strictHash,
      action: `permission.asked:${request.permission}`,
      tier: requiredTier,
      status: 'deny',
      reason: 'missing_evidence',
      checks: ['approval token'],
      evidence: ['no valid token matched request hash'],
      executor: {
        agent: 'executor',
        plan: 'execute side-effect without fresh self-approval token',
      },
      verifier: {
        agent: 'architect-verifier',
        verdict: 'deny',
        summary: 'Evidence token missing or expired.',
      },
      rollback: {
        strategy: 'rerun miya_self_approve before side-effect actions',
      },
    });
    return { status: 'deny', reason: 'missing_evidence' };
  }

  writeSelfApprovalRecord(projectDir, {
    trace_id: token.trace_id,
    session_id: request.sessionID,
    request_hash: strictHash,
    action: `permission.asked:${request.permission}`,
    tier: requiredTier,
    status: 'allow',
    reason: 'token_validated',
    checks: ['approval token'],
    evidence: [
      `token_hash=${token.request_hash}`,
      `token_tier=${token.tier}`,
      `token_created_at=${token.created_at}`,
      `token_expires_at=${token.expires_at}`,
    ],
    executor: {
      agent: 'executor',
      plan: 'execute side-effect action with validated token',
    },
    verifier: {
      agent: 'architect-verifier',
      verdict: 'allow',
      summary: 'Token satisfied required tier and freshness constraints.',
    },
    rollback: {
      strategy: 'use git checkpoint and kill-switch if execution fails',
    },
  });
  return { status: 'allow', reason: 'token_validated' };
}

export function getSafetySnapshot(projectDir: string): {
  kill: ReturnType<typeof readKillSwitch>;
  recent: ReturnType<typeof listRecentSelfApprovalRecords>;
} {
  return {
    kill: readKillSwitch(projectDir),
    recent: listRecentSelfApprovalRecords(projectDir, 5),
  };
}

export function createSafetyTools(
  ctx: PluginInput,
): Record<string, ToolDefinition> {
  const miya_self_approve = tool({
    description:
      'Run mandatory self-approval with evidence collection and verifier veto. Generates a short-lived approval token.',
    args: {
      permission: z
        .string()
        .describe(
          'Permission key for the intended side-effect (edit/bash/external_directory)',
        ),
      patterns: z
        .array(z.string())
        .optional()
        .describe('Expected permission patterns to bind approval token'),
      tier: z
        .enum(['LIGHT', 'STANDARD', 'THOROUGH'])
        .optional()
        .describe('Requested verification tier'),
      action: z.string().optional().describe('Human-readable action summary'),
      targets: z
        .array(z.string())
        .optional()
        .describe('Target files/commands/endpoints'),
      rollback: z.string().optional().describe('Rollback strategy summary'),
    },
    async execute(args, toolContext) {
      const sessionID =
        toolContext &&
        typeof toolContext === 'object' &&
        'sessionID' in toolContext
          ? String((toolContext as { sessionID: string }).sessionID)
          : 'main';

      const kill = readKillSwitch(ctx.directory);
      if (kill.active) {
        return `VERDICT=DENY\nreason=kill_switch_active\ntrace_id=${kill.trace_id ?? 'n/a'}`;
      }

      const request: SafetyPermissionRequest = {
        sessionID,
        permission: String(args.permission),
        patterns: Array.isArray(args.patterns) ? args.patterns.map(String) : [],
      };
      const requestedTier = normalizeTier(
        typeof args.tier === 'string' ? args.tier : undefined,
      );
      const riskTier = requiredTierForRequest(request);
      const tier = maxTier(requestedTier, riskTier);
      const requestHash = buildRequestHash(request, false);
      const traceID = createTraceId();
      const action = [
        args.action ? String(args.action) : `${request.permission} side-effect`,
        Array.isArray(args.targets) && args.targets.length > 0
          ? `(targets=${args.targets.join(', ')})`
          : '',
      ]
        .filter(Boolean)
        .join(' ');

      const evidence = await collectSafetyEvidence(ctx.directory, tier);
      const verifier = await runVerifier(ctx, {
        sessionID,
        traceID,
        requestHash,
        tier,
        action,
        checks: evidence.checks,
        evidence: evidence.evidence,
        issues: evidence.issues,
      });

      const allow = evidence.pass && verifier.verdict === 'allow';
      const reason = allow
        ? verifier.summary
        : evidence.issues.length > 0
          ? evidence.issues.join(' | ')
          : verifier.summary;

      writeSelfApprovalRecord(ctx.directory, {
        trace_id: traceID,
        session_id: sessionID,
        request_hash: requestHash,
        action,
        tier,
        status: allow ? 'allow' : 'deny',
        reason,
        checks: evidence.checks,
        evidence: evidence.evidence.slice(0, 40),
        executor: {
          agent: 'executor',
          plan: action,
        },
        verifier: {
          agent: '4-architecture-advisor',
          verdict: allow ? 'allow' : 'deny',
          summary: verifier.summary,
        },
        rollback: {
          strategy:
            args.rollback && String(args.rollback).trim().length > 0
              ? String(args.rollback)
              : 'Revert via git checkpoint and keep kill switch active until fixed.',
        },
      });

      if (!allow) {
        activateKillSwitch(
          ctx.directory,
          `self_approval_denied:${reason}`,
          traceID,
        );
      } else {
        saveApprovalToken(ctx.directory, sessionID, {
          trace_id: traceID,
          request_hash: requestHash,
          tier,
          action,
        });
      }

      return formatResult({
        verdict: allow ? 'allow' : 'deny',
        traceID,
        requestHash,
        tier,
        reason,
        checks: evidence.checks,
        issues: evidence.issues,
      });
    },
  });

  const miya_self_approve_bundle = tool({
    description:
      'Approve a batch plan in one pass and mint short-lived tokens for multiple side-effect actions.',
    args: {
      actions: z
        .array(
          z.object({
            permission: z.string(),
            patterns: z.array(z.string()).optional(),
            action: z.string().optional(),
          }),
        )
        .describe('Batch actions that should share one approval run'),
      tier: z.enum(['LIGHT', 'STANDARD', 'THOROUGH']).optional(),
      rollback: z
        .string()
        .optional()
        .describe('Shared rollback strategy summary'),
    },
    async execute(args, toolContext) {
      const sessionID =
        toolContext &&
        typeof toolContext === 'object' &&
        'sessionID' in toolContext
          ? String((toolContext as { sessionID: string }).sessionID)
          : 'main';
      const actions = Array.isArray(args.actions) ? args.actions : [];
      if (actions.length === 0) {
        return 'VERDICT=DENY\nreason=empty_bundle_actions';
      }

      let tier = normalizeTier(
        typeof args.tier === 'string' ? args.tier : undefined,
      );
      const requests = actions.map((item) => ({
        permission: String(item.permission ?? ''),
        patterns: Array.isArray(item.patterns) ? item.patterns.map(String) : [],
        action:
          typeof item.action === 'string' && item.action.trim().length > 0
            ? item.action.trim()
            : undefined,
      }));
      for (const request of requests) {
        tier = maxTier(tier, requiredTierForRequest(request));
      }

      const traceID = createTraceId();
      const requestHash = buildRequestHash(
        {
          permission: 'bundle',
          patterns: requests.flatMap((item) => item.patterns),
        },
        false,
      );
      const actionSummary = `bundle_actions=${requests.length}`;
      const evidence = await collectSafetyEvidence(ctx.directory, tier);
      const verifier = await runVerifier(ctx, {
        sessionID,
        traceID,
        requestHash,
        tier,
        action: actionSummary,
        checks: evidence.checks,
        evidence: evidence.evidence,
        issues: evidence.issues,
      });
      const allow = evidence.pass && verifier.verdict === 'allow';
      const reason = allow
        ? verifier.summary
        : evidence.issues.length > 0
          ? evidence.issues.join(' | ')
          : verifier.summary;

      const rollbackStrategy =
        args.rollback && String(args.rollback).trim().length > 0
          ? String(args.rollback)
          : 'Revert via git checkpoint and keep kill switch active until fixed.';

      if (!allow) {
        writeSelfApprovalRecord(ctx.directory, {
          trace_id: traceID,
          session_id: sessionID,
          request_hash: requestHash,
          action: actionSummary,
          tier,
          status: 'deny',
          reason,
          checks: evidence.checks,
          evidence: evidence.evidence.slice(0, 40),
          executor: {
            agent: 'executor',
            plan: actionSummary,
          },
          verifier: {
            agent: '4-architecture-advisor',
            verdict: 'deny',
            summary: verifier.summary,
          },
          rollback: {
            strategy: rollbackStrategy,
          },
        });
        activateKillSwitch(
          ctx.directory,
          `self_approval_denied:${reason}`,
          traceID,
        );
        return formatResult({
          verdict: 'deny',
          traceID,
          requestHash,
          tier,
          reason,
          checks: evidence.checks,
          issues: evidence.issues,
        });
      }

      for (const request of requests) {
        const tokenHash = buildRequestHash(
          {
            permission: request.permission,
            patterns: request.patterns,
          },
          false,
        );
        const action = request.action ?? `${request.permission} side-effect`;
        writeSelfApprovalRecord(ctx.directory, {
          trace_id: traceID,
          session_id: sessionID,
          request_hash: tokenHash,
          action,
          tier,
          status: 'allow',
          reason,
          checks: evidence.checks,
          evidence: evidence.evidence.slice(0, 40),
          executor: {
            agent: 'executor',
            plan: action,
          },
          verifier: {
            agent: '4-architecture-advisor',
            verdict: 'allow',
            summary: verifier.summary,
          },
          rollback: {
            strategy: rollbackStrategy,
          },
        });
        saveApprovalToken(ctx.directory, sessionID, {
          trace_id: traceID,
          request_hash: tokenHash,
          tier,
          action,
        });
      }

      return [
        formatResult({
          verdict: 'allow',
          traceID,
          requestHash,
          tier,
          reason,
          checks: evidence.checks,
          issues: evidence.issues,
        }),
        `bundle_actions=${requests.length}`,
      ].join('\n');
    },
  });

  const miya_kill_activate = tool({
    description:
      'Activate fail-stop kill switch for all side-effect permissions.',
    args: {
      reason: z.string().optional().describe('Reason for emergency stop'),
    },
    async execute(args) {
      const traceID = createTraceId();
      const next = activateKillSwitch(
        ctx.directory,
        String(args.reason ?? 'manual_activation'),
        traceID,
      );
      return `kill_switch_active=${next.active}\ntrace_id=${traceID}\nreason=${next.reason ?? 'n/a'}\nactivated_at=${next.activated_at ?? nowIso()}`;
    },
  });

  const miya_kill_release = tool({
    description: 'Release fail-stop kill switch after remediation.',
    args: {},
    async execute() {
      const next = releaseKillSwitch(ctx.directory);
      return `kill_switch_active=${next.active}`;
    },
  });

  const miya_kill_status = tool({
    description: 'Inspect current kill-switch status.',
    args: {},
    async execute() {
      const kill = readKillSwitch(ctx.directory);
      return [
        `kill_switch_active=${kill.active}`,
        `trace_id=${kill.trace_id ?? 'n/a'}`,
        `reason=${kill.reason ?? 'n/a'}`,
        `activated_at=${kill.activated_at ?? 'n/a'}`,
      ].join('\n');
    },
  });

  return {
    miya_self_approve,
    miya_self_approve_bundle,
    miya_kill_activate,
    miya_kill_release,
    miya_kill_status,
  };
}
