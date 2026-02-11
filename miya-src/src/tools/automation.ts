import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { MiyaAutomationService } from '../automation';
import { getSafetySnapshot } from '../safety';

const z = tool.schema;

function formatJobs(jobs: { id: string; name: string; enabled: boolean; nextRunAt: string; requireApproval: boolean; schedule: { time: string } }[]): string {
  if (jobs.length === 0) {
    return 'No jobs configured.';
  }

  return jobs
    .map(
      (job) =>
        `- ${job.id} | ${job.name} | enabled=${job.enabled} | daily=${job.schedule.time} | next=${job.nextRunAt} | approval=${job.requireApproval}`,
    )
    .join('\n');
}

function parseNaturalSchedule(input: string): { time: string; command: string } | null {
  const text = input.trim();

  let hour: number | null = null;
  let minute = 0;

  const chineseMatch = /每天(?:\s*(上午|中午|下午|晚上|凌晨))?\s*(\d{1,2})[:点时]?\s*(\d{1,2})?/.exec(
    text,
  );
  if (chineseMatch) {
    const period = chineseMatch[1];
    hour = Number(chineseMatch[2]);
    minute = chineseMatch[3] ? Number(chineseMatch[3]) : 0;

    if (period === '下午' || period === '晚上') {
      if (hour < 12) hour += 12;
    }
    if (period === '中午') {
      if (hour < 11) hour += 12;
    }
    if (period === '凌晨' && hour === 12) {
      hour = 0;
    }
  }

  if (hour === null) {
    const englishMatch = /(?:every day at|daily\s*(?:at)?)\s*(\d{1,2})(?::(\d{1,2}))?/i.exec(
      text,
    );
    if (englishMatch) {
      hour = Number(englishMatch[1]);
      minute = englishMatch[2] ? Number(englishMatch[2]) : 0;
    }
  }

  if (hour !== null) {
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  }

  if (hour === null) return null;

  const cmdPatterns: RegExp[] = [
    /(?:运行|执行)\s*([^，。,;]+)$/,
    /(?:run|execute)\s+(.+)$/i,
  ];

  let command: string | null = null;
  for (const pattern of cmdPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    command = match[1].trim();
    break;
  }

  if (!command) {
    return null;
  }

  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { time, command };
}

export function createAutomationTools(
  automationService: MiyaAutomationService,
): Record<string, ToolDefinition> {
  const miya_schedule_daily_command = tool({
    description:
      'Create a daily scheduled command job (HH:mm local time) in Miya automation runtime.',
    args: {
      name: z.string().describe('Job name'),
      time: z.string().describe('Daily local time, format HH:mm'),
      command: z.string().describe('Command to execute'),
      cwd: z.string().optional().describe('Working directory for command'),
      timeout_ms: z
        .number()
        .optional()
        .describe('Execution timeout in milliseconds'),
      require_approval: z
        .boolean()
        .optional()
        .describe('Require manual approval for scheduled runs'),
    },
    async execute(args) {
      const job = automationService.scheduleDailyCommand({
        name: String(args.name),
        time: String(args.time),
        command: String(args.command),
        cwd: args.cwd ? String(args.cwd) : undefined,
        timeoutMs:
          typeof args.timeout_ms === 'number' ? Number(args.timeout_ms) : undefined,
        requireApproval:
          typeof args.require_approval === 'boolean'
            ? args.require_approval
            : false,
      });

      return `Scheduled job created.
id=${job.id}
name=${job.name}
time=${job.schedule.time}
next_run=${job.nextRunAt}
require_approval=${job.requireApproval}`;
    },
  });

  const miya_list_jobs = tool({
    description: 'List Miya automation jobs.',
    args: {},
    async execute() {
      return formatJobs(automationService.listJobs());
    },
  });

  const miya_delete_job = tool({
    description: 'Delete a Miya automation job by id.',
    args: {
      job_id: z.string().describe('Job id to remove'),
    },
    async execute(args) {
      const ok = automationService.deleteJob(String(args.job_id));
      return ok ? `Deleted job ${String(args.job_id)}.` : 'Job not found.';
    },
  });

  const miya_set_job_enabled = tool({
    description: 'Enable or disable a Miya automation job.',
    args: {
      job_id: z.string().describe('Job id'),
      enabled: z.boolean().describe('Whether job should be enabled'),
    },
    async execute(args) {
      const job = automationService.setJobEnabled(
        String(args.job_id),
        Boolean(args.enabled),
      );
      if (!job) return 'Job not found.';
      return `Job ${job.id} enabled=${job.enabled}, next_run=${job.nextRunAt}`;
    },
  });

  const miya_run_job_now = tool({
    description: 'Run a Miya automation job immediately.',
    args: {
      job_id: z.string().describe('Job id'),
    },
    async execute(args) {
      const result = await automationService.runJobNow(String(args.job_id));
      if (!result) return 'Job not found.';

      return `Run finished.
status=${result.status}
exit_code=${result.exitCode}
timed_out=${result.timedOut}
stdout:
${result.stdout || '(empty)'}
stderr:
${result.stderr || '(empty)'}`;
    },
  });

  const miya_list_approvals = tool({
    description: 'List pending/finished approval requests for scheduled jobs.',
    args: {},
    async execute() {
      const approvals = automationService.listApprovals();
      if (approvals.length === 0) return 'No approvals found.';

      return approvals
        .map(
          (approval) =>
            `- ${approval.id} | job=${approval.jobId} | status=${approval.status} | requested=${approval.requestedAt}`,
        )
        .join('\n');
    },
  });

  const miya_approve_job_run = tool({
    description: 'Approve a pending job run request and execute it immediately.',
    args: {
      approval_id: z.string().describe('Approval request id'),
    },
    async execute(args) {
      const result = await automationService.approveAndRun(
        String(args.approval_id),
      );
      if (!result) {
        return 'Approval not found or no longer pending.';
      }

      return `Approved ${result.approval.id}.
run_status=${result.result?.status ?? 'unknown'}
exit_code=${result.result?.exitCode ?? 'n/a'}
timed_out=${result.result?.timedOut ?? 'n/a'}`;
    },
  });

  const miya_reject_job_run = tool({
    description: 'Reject a pending scheduled job approval request.',
    args: {
      approval_id: z.string().describe('Approval request id'),
    },
    async execute(args) {
      const approval = automationService.rejectApproval(String(args.approval_id));
      if (!approval) {
        return 'Approval not found or no longer pending.';
      }
      return `Rejected ${approval.id}.`;
    },
  });

  const miya_job_history = tool({
    description: 'Show recent Miya job execution history.',
    args: {
      limit: z.number().optional().describe('Maximum records to return (default 20)'),
    },
    async execute(args) {
      const limit =
        typeof args.limit === 'number' && args.limit > 0
          ? Math.min(200, Number(args.limit))
          : 20;
      const records = automationService.listHistory(limit);
      if (records.length === 0) return 'No history records found.';

      return records
        .map(
          (record) =>
            `- ${record.id} | job=${record.jobName} | trigger=${record.trigger} | status=${record.status} | exit=${record.exitCode} | started=${record.startedAt}`,
        )
        .join('\n');
    },
  });

  const miya_status_panel = tool({
    description: 'Show compact Miya runtime status panel for jobs and approvals.',
    args: {},
    async execute() {
      const jobs = automationService.listJobs();
      const approvals = automationService
        .listApprovals()
        .filter((item) => item.status === 'pending');
      const history = automationService.listHistory(5);

      const historyText =
        history.length === 0
          ? '(no runs yet)'
          : history
              .map(
                (item) =>
                  `- ${item.startedAt} | ${item.jobName} | ${item.status} | exit=${item.exitCode}`,
                )
              .join('\n');
      const safety = getSafetySnapshot(automationService.getProjectDir());
      const safetyText =
        safety.recent.length === 0
          ? '(none)'
          : safety.recent
              .map(
                (item) =>
                  `- ${item.created_at} | ${item.status} | ${item.tier} | ${item.reason} | trace=${item.trace_id}`,
              )
              .join('\n');

      return `<details>
<summary>Miya Control Plane</summary>

Miya status
jobs_total=${jobs.length}
jobs_enabled=${jobs.filter((job) => job.enabled).length}
approvals_pending=${approvals.length}
kill_switch_active=${safety.kill.active}
kill_switch_reason=${safety.kill.reason ?? 'n/a'}

Jobs:
${formatJobs(jobs)}

Pending approvals:
${
  approvals.length === 0
    ? '(none)'
    : approvals
        .map(
          (item) =>
            `- ${item.id} | job=${item.jobId} | requested=${item.requestedAt}`,
        )
        .join('\n')
}

Recent runs:
${historyText}

Recent self-approval:
${safetyText}
</details>`;
    },
  });

  const miya_schedule_from_text = tool({
    description:
      'Create daily schedule from a natural-language request (Chinese/English basic patterns).',
    args: {
      request: z.string().describe('Natural-language automation request'),
      name: z.string().optional().describe('Optional job name override'),
    },
    async execute(args) {
      const request = String(args.request);
      const parsed = parseNaturalSchedule(request);
      if (!parsed) {
        return 'Unable to parse schedule or command. Please include daily time and explicit command.';
      }

      const risky = /(股票|证券|买卖|trade|broker|email|mail)/i.test(request);
      const job = automationService.scheduleDailyCommand({
        name: args.name ? String(args.name) : `nl-${parsed.time}-${Date.now()}`,
        time: parsed.time,
        command: parsed.command,
        requireApproval: risky,
      });

      return `Scheduled from natural language.
id=${job.id}
time=${job.schedule.time}
command=${job.action.command}
require_approval=${job.requireApproval}`;
    },
  });

  return {
    miya_schedule_daily_command,
    miya_list_jobs,
    miya_delete_job,
    miya_set_job_enabled,
    miya_run_job_now,
    miya_list_approvals,
    miya_approve_job_run,
    miya_reject_job_run,
    miya_job_history,
    miya_status_panel,
    miya_schedule_from_text,
  };
}
