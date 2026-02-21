import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  buildLearningInjection,
  getLearningStats,
  listSkillDrafts,
  setSkillDraftStatus,
} from '../learning';

const z = tool.schema;

export function createLearningTools(
  projectDir: string,
): Record<string, ToolDefinition> {
  const miya_learning_drafts = tool({
    description:
      'Inspect/recommend/approve learning skill drafts generated from Ralph + memory-reflect.',
    args: {
      mode: z
        .enum(['list', 'recommend', 'accept', 'reject', 'stats'])
        .default('stats'),
      id: z.string().optional(),
      query: z.string().optional(),
      threshold: z.number().optional(),
      limit: z.number().optional(),
    },
    async execute(args) {
      const mode = String(args.mode ?? 'stats');

      if (mode === 'list') {
        const drafts = listSkillDrafts(projectDir, {
          limit: typeof args.limit === 'number' ? Number(args.limit) : 30,
        });
        if (drafts.length === 0) return 'learning_drafts=empty';
        return drafts
          .map((item) =>
            [
              `id=${item.id}`,
              `status=${item.status}`,
              `source=${item.source}`,
              `confidence=${item.confidence.toFixed(2)}`,
              `uses=${item.uses}`,
              `pending_uses=${item.pendingUses}`,
              `hit_rate=${item.uses > 0 ? (item.hits / item.uses).toFixed(2) : '0.00'}`,
              `title=${item.title}`,
            ].join(' | '),
          )
          .join('\n');
      }

      if (mode === 'recommend') {
        const query = String(args.query ?? '').trim();
        if (!query) return 'error=query_required';
        const result = buildLearningInjection(projectDir, query, {
          threshold:
            typeof args.threshold === 'number'
              ? Number(args.threshold)
              : undefined,
          limit:
            typeof args.limit === 'number' ? Number(args.limit) : undefined,
        });
        if (!result.snippet) return 'learning_recommendation=none';
        return [
          result.snippet,
          `matched=${result.matchedDraftIDs.join(',')}`,
        ].join('\n');
      }

      if (mode === 'accept' || mode === 'reject') {
        const id = String(args.id ?? '').trim();
        if (!id) return 'error=id_required';
        const updated = setSkillDraftStatus(
          projectDir,
          id,
          mode === 'accept' ? 'accepted' : 'rejected',
        );
        if (!updated) return 'error=draft_not_found';
        return `updated=true\nid=${updated.id}\nstatus=${updated.status}`;
      }

      const stats = getLearningStats(projectDir);
      return [
        `total=${stats.total}`,
        `draft=${stats.byStatus.draft}`,
        `recommended=${stats.byStatus.recommended}`,
        `accepted=${stats.byStatus.accepted}`,
        `rejected=${stats.byStatus.rejected}`,
        `uses=${stats.totalUses}`,
        `pending_uses=${stats.totalPendingUses}`,
        `hit_rate=${stats.hitRate}`,
      ].join('\n');
    },
  });

  return {
    miya_learning_drafts,
  };
}
