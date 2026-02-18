import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import {
  decideIntake,
  intakeStats,
  intakeSummary,
  listIntakeData,
  proposeIntake,
  resolveSourceUnitKey,
} from './service';
import type { IntakeScope, IntakeTrigger } from './types';

const z = tool.schema;

function toText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatProposalOutput(
  result: ReturnType<typeof proposeIntake>,
): string {
  const proposal = result.proposal;
  const lines: string[] = [`status=${result.status}`];
  if (proposal) {
    lines.push(`proposal_id=${proposal.id}`);
    lines.push(`trigger=${proposal.trigger}`);
    lines.push(`source_unit=${proposal.sourceUnitKey}`);
    lines.push(`source_fingerprint=${proposal.sourceFingerprint}`);
    lines.push(`requested_at=${proposal.requestedAt}`);
    if (proposal.summaryPoints.length > 0) {
      lines.push(`summary=${proposal.summaryPoints.join(' | ')}`);
    }
  }
  if (result.matchedRule) {
    lines.push(
      `matched_rule=${result.matchedRule.scope}:${result.matchedRule.value}`,
    );
  }
  if (result.stats) {
    lines.push(
      `stats=U${result.stats.usefulCount}/R${result.stats.rejectedCount}/T${result.stats.trialCount} verdict=${result.stats.verdict} explore=${result.stats.recommendedExplorePercent}%`,
    );
  }

  if (result.status === 'pending') {
    lines.push('');
    lines.push('decision_options=');
    lines.push('- approve_whitelist');
    lines.push('- reject_blacklist');
    lines.push('- reject_block_scope(scope=PAGE|PATH_PREFIX|DOMAIN)');
    lines.push('- trial_once');
  }
  return lines.join('\n');
}

function parseScope(value: unknown): IntakeScope | undefined {
  if (
    value === 'CONTENT_FINGERPRINT' ||
    value === 'PAGE' ||
    value === 'PATH_PREFIX' ||
    value === 'DOMAIN'
  ) {
    return value;
  }
  return undefined;
}

function parseTrigger(value: unknown): IntakeTrigger {
  if (
    value === 'config_change' ||
    value === 'skill_or_toolchain_change' ||
    value === 'high_risk_action' ||
    value === 'directive_content'
  ) {
    return value;
  }
  return 'manual';
}

export function createIntakeTools(
  ctx: PluginInput,
): Record<string, ToolDefinition> {
  const miya_intake_propose = tool({
    description:
      'Create an intake-gate proposal before config/skill/high-risk changes from external/web info.',
    args: {
      trigger: z
        .string()
        .optional()
        .describe(
          'config_change|skill_or_toolchain_change|high_risk_action|directive_content|manual',
        ),
      source: z
        .any()
        .describe(
          'Source object: {domain,path,selector,contentHash,sourceKey,url}',
        ),
      summary_points: z.array(z.string()).optional(),
      original_plan: z.string().optional(),
      suggested_change: z.string().optional(),
      benefits: z.array(z.string()).optional(),
      risks: z.array(z.string()).optional(),
      evidence: z.array(z.string()).optional(),
      proposed_changes: z.any().optional(),
    },
    async execute(args) {
      const result = proposeIntake(ctx.directory, {
        trigger: parseTrigger(args.trigger),
        source:
          args.source && typeof args.source === 'object'
            ? (args.source as Record<string, unknown>)
            : {},
        summaryPoints: Array.isArray(args.summary_points)
          ? args.summary_points.map(String)
          : undefined,
        originalPlan: args.original_plan
          ? String(args.original_plan)
          : undefined,
        suggestedChange: args.suggested_change
          ? String(args.suggested_change)
          : undefined,
        benefits: Array.isArray(args.benefits)
          ? args.benefits.map(String)
          : undefined,
        risks: Array.isArray(args.risks) ? args.risks.map(String) : undefined,
        evidence: Array.isArray(args.evidence)
          ? args.evidence.map(String)
          : undefined,
        proposedChanges: args.proposed_changes,
      });
      return formatProposalOutput(result);
    },
  });

  const miya_intake_decide = tool({
    description:
      'Resolve one pending intake proposal: approve/whitelist, reject/blacklist, block scope, or trial once.',
    args: {
      proposal_id: z.string().describe('Pending proposal id'),
      decision: z
        .string()
        .describe(
          'approve|approve_whitelist|reject|reject_blacklist|reject_block_scope|trial_once',
        ),
      scope: z
        .string()
        .optional()
        .describe('Required for reject_block_scope: PAGE|PATH_PREFIX|DOMAIN'),
      reason: z.string().optional(),
    },
    async execute(args) {
      const decision = String(args.decision);
      if (
        decision !== 'approve' &&
        decision !== 'approve_whitelist' &&
        decision !== 'reject' &&
        decision !== 'reject_blacklist' &&
        decision !== 'reject_block_scope' &&
        decision !== 'trial_once'
      ) {
        return 'ok=false\nmessage=invalid_decision';
      }

      const result = decideIntake(ctx.directory, {
        proposalId: String(args.proposal_id),
        decision,
        scope: parseScope(args.scope),
        reason: args.reason ? String(args.reason) : undefined,
      });

      if (!result.ok || !result.proposal) {
        return `ok=false\nmessage=${result.message}`;
      }

      const lines: string[] = [
        'ok=true',
        `proposal_id=${result.proposal.id}`,
        `status=${result.proposal.status}`,
        `decision=${result.proposal.resolution?.decision ?? 'n/a'}`,
      ];
      if (result.createdRule) {
        lines.push(
          `list_entry=${result.createdRule.scope}:${result.createdRule.value}`,
        );
      }
      if (result.stats) {
        lines.push(
          `stats=U${result.stats.usefulCount}/R${result.stats.rejectedCount}/T${result.stats.trialCount} verdict=${result.stats.verdict} explore=${result.stats.recommendedExplorePercent}%`,
        );
      }
      return lines.join('\n');
    },
  });

  const miya_intake_stats = tool({
    description:
      'Evaluate intake source quality on sliding window: hard deny / downrank / normal.',
    args: {
      source_key: z.string().optional().describe('Source unit key'),
      source: z.any().optional().describe('Source object if no source_key'),
    },
    async execute(args) {
      let sourceKey = args.source_key ? String(args.source_key).trim() : '';
      if (!sourceKey) {
        const source =
          args.source && typeof args.source === 'object'
            ? (args.source as Record<string, unknown>)
            : {};
        sourceKey = resolveSourceUnitKey(ctx.directory, source);
      }
      const stats = intakeStats(ctx.directory, { sourceUnitKey: sourceKey });
      return toText(stats);
    },
  });

  const miya_intake_list = tool({
    description:
      'List intake gate data: pending proposals, whitelist, blacklist, events, or all.',
    args: {
      target: z
        .string()
        .optional()
        .describe('pending|whitelist|blacklist|events|all'),
      limit: z.number().optional().describe('Result limit (default 50)'),
    },
    async execute(args) {
      const state = listIntakeData(ctx.directory);
      const summary = intakeSummary(ctx.directory);
      const target = args.target ? String(args.target).toLowerCase() : 'all';
      const limit =
        typeof args.limit === 'number' && args.limit > 0
          ? Math.min(500, Math.trunc(args.limit))
          : 50;

      if (target === 'pending') {
        return toText({
          summary,
          pending: summary.pendingItems.slice(0, limit),
        });
      }
      if (target === 'whitelist') {
        return toText({ summary, whitelist: state.whitelist.slice(0, limit) });
      }
      if (target === 'blacklist') {
        return toText({ summary, blacklist: state.blacklist.slice(0, limit) });
      }
      if (target === 'events') {
        return toText({ summary, events: state.events.slice(0, limit) });
      }
      return toText({
        summary,
        pending: summary.pendingItems.slice(0, limit),
        whitelist: state.whitelist.slice(0, limit),
        blacklist: state.blacklist.slice(0, limit),
        events: state.events.slice(0, limit),
      });
    },
  });

  return {
    miya_intake_propose,
    miya_intake_decide,
    miya_intake_stats,
    miya_intake_list,
  };
}

export { intakeSummary, listIntakeData };
