import { tool } from '@opencode-ai/plugin';
import { collectSafetyEvidence } from './evidence';
import { activateKillSwitch, createTraceId, findApprovalToken, listRecentSelfApprovalRecords, readKillSwitch, releaseKillSwitch, saveApprovalToken, writeSelfApprovalRecord, } from './store';
import { buildRequestHash, isSideEffectPermission, requiredTierForRequest, } from './risk';
import { normalizeTier, tierAtLeast } from './tier';
import { runVerifier } from './verifier';
const z = tool.schema;
function nowIso() {
    return new Date().toISOString();
}
function toPermissionRequest(input) {
    return {
        sessionID: input.sessionID,
        permission: input.permission,
        patterns: Array.isArray(input.patterns) ? input.patterns.map(String) : [],
        metadata: input.metadata,
        messageID: input.messageID ?? input.tool?.messageID,
        toolCallID: input.toolCallID ?? input.tool?.callID,
    };
}
function maxTier(a, b) {
    if (tierAtLeast(a, b))
        return a;
    return b;
}
function formatResult(input) {
    return [
        `VERDICT=${input.verdict.toUpperCase()}`,
        `trace_id=${input.traceID}`,
        `request_hash=${input.requestHash}`,
        `tier=${input.tier}`,
        `reason=${input.reason}`,
        `checks=${input.checks.length}`,
        input.issues.length > 0 ? `issues=${input.issues.join(' | ')}` : 'issues=none',
    ].join('\n');
}
export async function handlePermissionAsk(projectDir, input) {
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
            action: `permission.ask:${request.permission}`,
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
    const token = findApprovalToken(projectDir, request.sessionID, [strictHash, baseHash], requiredTier);
    if (!token) {
        const traceID = createTraceId();
        activateKillSwitch(projectDir, 'missing_evidence', traceID);
        writeSelfApprovalRecord(projectDir, {
            trace_id: traceID,
            session_id: request.sessionID,
            request_hash: strictHash,
            action: `permission.ask:${request.permission}`,
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
            rollback: { strategy: 'rerun miya_self_approve before side-effect actions' },
        });
        return { status: 'deny', reason: 'missing_evidence' };
    }
    writeSelfApprovalRecord(projectDir, {
        trace_id: token.trace_id,
        session_id: request.sessionID,
        request_hash: strictHash,
        action: `permission.ask:${request.permission}`,
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
        rollback: { strategy: 'use git checkpoint and kill-switch if execution fails' },
    });
    return { status: 'allow', reason: 'token_validated' };
}
export function getSafetySnapshot(projectDir) {
    return {
        kill: readKillSwitch(projectDir),
        recent: listRecentSelfApprovalRecords(projectDir, 5),
    };
}
export function createSafetyTools(ctx) {
    const miya_self_approve = tool({
        description: 'Run mandatory self-approval with evidence collection and verifier veto. Generates a short-lived approval token.',
        args: {
            permission: z
                .string()
                .describe('Permission key for the intended side-effect (edit/bash/external_directory)'),
            patterns: z
                .array(z.string())
                .optional()
                .describe('Expected permission patterns to bind approval token'),
            tier: z
                .enum(['LIGHT', 'STANDARD', 'THOROUGH'])
                .optional()
                .describe('Requested verification tier'),
            action: z
                .string()
                .optional()
                .describe('Human-readable action summary'),
            targets: z
                .array(z.string())
                .optional()
                .describe('Target files/commands/endpoints'),
            rollback: z.string().optional().describe('Rollback strategy summary'),
        },
        async execute(args, toolContext) {
            const sessionID = toolContext && typeof toolContext === 'object' && 'sessionID' in toolContext
                ? String(toolContext.sessionID)
                : 'main';
            const kill = readKillSwitch(ctx.directory);
            if (kill.active) {
                return `VERDICT=DENY\nreason=kill_switch_active\ntrace_id=${kill.trace_id ?? 'n/a'}`;
            }
            const request = {
                sessionID,
                permission: String(args.permission),
                patterns: Array.isArray(args.patterns) ? args.patterns.map(String) : [],
            };
            const requestedTier = normalizeTier(typeof args.tier === 'string' ? args.tier : undefined);
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
                    strategy: args.rollback && String(args.rollback).trim().length > 0
                        ? String(args.rollback)
                        : 'Revert via git checkpoint and keep kill switch active until fixed.',
                },
            });
            if (!allow) {
                activateKillSwitch(ctx.directory, `self_approval_denied:${reason}`, traceID);
            }
            else {
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
    const miya_kill_activate = tool({
        description: 'Activate fail-stop kill switch for all side-effect permissions.',
        args: {
            reason: z.string().optional().describe('Reason for emergency stop'),
        },
        async execute(args) {
            const traceID = createTraceId();
            const next = activateKillSwitch(ctx.directory, String(args.reason ?? 'manual_activation'), traceID);
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
        miya_kill_activate,
        miya_kill_release,
        miya_kill_status,
    };
}
