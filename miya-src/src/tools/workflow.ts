import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  createSaveRecord,
  evaluateSave,
  getCurrentBranch,
  getSessionState,
  listSaveRecords,
  loadSaveRecord,
  resetSessionState,
  setSessionState,
} from '../workflow';

const z = tool.schema;

function sid(ctx: unknown): string {
  if (ctx && typeof ctx === 'object' && 'sessionID' in ctx) {
    return String((ctx as { sessionID: string }).sessionID);
  }
  return 'unknown';
}

function normalizeList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map(String);
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function createWorkflowTools(
  projectDir: string,
): Record<string, ToolDefinition> {
  const save_work = tool({
    description:
      'Persist current workflow checkpoint to .opencode/cowork-saves',
    args: {
      label: z.string().optional().describe('Checkpoint label'),
      done: z.array(z.string()).optional().describe('Completed items'),
      missing: z.array(z.string()).optional().describe('Still missing items'),
      unresolved: z
        .array(z.string())
        .optional()
        .describe('Known unresolved issues or risks'),
      notes: z.string().optional().describe('Extra notes'),
    },
    async execute(args, toolContext) {
      const sessionID = sid(toolContext);

      const record = createSaveRecord(projectDir, {
        label: String(args.label ?? 'checkpoint'),
        sessionID,
        done: Array.isArray(args.done) ? args.done.map(String) : [],
        missing: Array.isArray(args.missing) ? args.missing.map(String) : [],
        unresolved: Array.isArray(args.unresolved)
          ? args.unresolved.map(String)
          : [],
        notes: args.notes ? String(args.notes) : undefined,
      });

      return `Saved checkpoint: ${record.id}\nBranch: ${record.branch ?? 'unknown'}\nLabel: ${record.label}`;
    },
  });

  const miya_iteration_done = tool({
    description:
      'Mark one autopilot cycle as completed, persist a checkpoint, and enforce the internal max-cycle guard.',
    args: {
      done: z.array(z.string()).optional().describe('Completed items'),
      missing: z.array(z.string()).optional().describe('Still missing items'),
      unresolved: z.array(z.string()).optional().describe('Known unresolved issues or risks'),
      notes: z.string().optional().describe('Extra notes'),
    },
    async execute(args, toolContext) {
      const sessionID = sid(toolContext);
      if (sessionID === 'unknown') return 'Session id unavailable.';

      const state = getSessionState(projectDir, sessionID);
      const done = normalizeList(args.done);
      const missing = normalizeList(args.missing);
      const unresolved = normalizeList(args.unresolved);
      const next = state.iterationCompleted + 1;

      const record = createSaveRecord(projectDir, {
        label: `iter-${next}`,
        sessionID,
        done,
        missing,
        unresolved,
        notes: args.notes ? String(args.notes) : undefined,
      });

      const stalled =
        sameList(state.lastMissing, missing) &&
        sameList(state.lastUnresolved, unresolved) &&
        (missing.length > 0 || unresolved.length > 0);

      state.iterationCompleted = next;
      state.lastDone = done;
      state.lastMissing = missing;
      state.lastUnresolved = unresolved;

      const window = Math.max(0, state.iterationCompleted - state.windowStartIteration);
      const limit = state.maxIterationsPerWindow;
      const capped = state.loopEnabled && window >= limit;
      state.awaitingConfirmation = capped;
      setSessionState(projectDir, sessionID, state);

      const unresolvedWork = missing.length > 0 || unresolved.length > 0;
      const reachedWithGaps = capped && unresolvedWork;
      const completed = missing.length === 0;

      return [
        `MIYA_ITERATION_COMPLETED=${state.iterationCompleted}`,
        `MIYA_LOOP_LIMIT_REACHED=${reachedWithGaps}`,
        `MIYA_LOOP_WINDOW_CAPPED=${capped}`,
        `MIYA_LOOP_COMPLETE=${completed}`,
        `MIYA_LOOP_STALLED=${stalled}`,
        `checkpoint=${record.id}`,
        reachedWithGaps
          ? [
              '',
              'Loop cap reached (max cycles exhausted).',
              'Do not ask the user for approval.',
              'Finalize now with one of:',
              '- degraded completion: safest usable state + explicit residual risk list + queued follow-up jobs',
              '- hard failure: minimal reproducible blocker + next viable path',
            ].join('\n')
          : '',
        stalled
          ? [
              '',
              'Progress stalled: missing/unresolved did not improve.',
              'Stop iterating and output replayable failure package.',
            ].join('\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  });

  const load_work = tool({
    description:
      'Load a saved checkpoint from .opencode/cowork-saves with branch safety check',
    args: {
      id: z.string().describe('Checkpoint id (filename without .json)'),
      confirm_branch_mismatch: z
        .boolean()
        .optional()
        .describe('Set true to proceed when saved branch != current branch'),
    },
    async execute(args) {
      const record = loadSaveRecord(projectDir, String(args.id));
      if (!record) {
        return `Save not found: ${String(args.id)}`;
      }

      const currentBranch = getCurrentBranch(projectDir);
      const mismatch =
        record.branch && currentBranch && record.branch !== currentBranch;
      if (mismatch && args.confirm_branch_mismatch !== true) {
        return `Branch mismatch detected. Saved on '${record.branch}', current is '${currentBranch}'. Re-run load_work with confirm_branch_mismatch=true to proceed.`;
      }

      return `Loaded checkpoint ${record.id}
Label: ${record.label}
Saved branch: ${record.branch ?? 'unknown'}
Current branch: ${currentBranch ?? 'unknown'}
Done: ${record.done.length}
Missing: ${record.missing.length}
Unresolved: ${record.unresolved.length}
Notes: ${record.notes ?? '(none)'}`;
    },
  });

  const check_work = tool({
    description:
      'Check completion status for one checkpoint or all checkpoints in .opencode/cowork-saves',
    args: {
      id: z.string().optional().describe('Checkpoint id to inspect'),
      all: z.boolean().optional().describe('Check all checkpoints'),
    },
    async execute(args) {
      if (args.id) {
        const record = loadSaveRecord(projectDir, String(args.id));
        if (!record) {
          return `Save not found: ${String(args.id)}`;
        }
        const result = evaluateSave(record);
        return `Checkpoint ${record.id}: ${result.status}\nReason: ${result.reason}`;
      }

      const records = listSaveRecords(projectDir);
      if (records.length === 0) {
        return 'No checkpoints found.';
      }

      const lines = records.map((record) => {
        const result = evaluateSave(record);
        return `- ${record.id} [${result.status}] ${record.label} (${result.reason})`;
      });

      return `Checkpoints:\n${lines.join('\n')}`;
    },
  });

  const quality_gate = tool({
    description:
      'Hard quality gate evaluation. Passes only when all three scores meet threshold.',
    args: {
      architecture_score: z.number().min(0).max(10),
      docs_score: z.number().min(0).max(10),
      domain_score: z.number().min(0).max(10),
      threshold: z.number().min(0).max(10).optional(),
    },
    async execute(args) {
      const threshold = typeof args.threshold === 'number' ? args.threshold : 9.2;
      const a = Number(args.architecture_score);
      const d = Number(args.docs_score);
      const x = Number(args.domain_score);
      const pass = a >= threshold && d >= threshold && x >= threshold;

      if (!pass) {
        return `QUALITY_GATE=FAIL\nthreshold=${threshold}\narchitecture=${a}\ndocs=${d}\ndomain=${x}`;
      }
      return `QUALITY_GATE=PASS\nthreshold=${threshold}\narchitecture=${a}\ndocs=${d}\ndomain=${x}`;
    },
  });

  const cancel_work = tool({
    description:
      'Cancel loop-mode for current session and reset loop guard counters.',
    args: {
      reason: z.string().optional(),
    },
    async execute(args, toolContext) {
      const sessionID = sid(toolContext);

      if (sessionID !== 'unknown') {
        resetSessionState(projectDir, sessionID);
      }

      return `Loop canceled for session ${sessionID}. Reason: ${String(args.reason ?? 'n/a')}`;
    },
  });

  const loop_state = tool({
    description: 'Inspect current loop guard state for this session.',
    args: {},
    async execute(_args, toolContext) {
      const sessionID = sid(toolContext);
      if (sessionID === 'unknown') {
        return 'Session id unavailable.';
      }

      const state = getSessionState(projectDir, sessionID);
      return [
        `session=${sessionID}`,
        `loop_enabled=${state.loopEnabled}`,
        `auto_continue=${state.autoContinue}`,
        `max_iterations_per_window=${state.maxIterationsPerWindow}`,
        `iteration_completed=${state.iterationCompleted}`,
        `window_start_iteration=${state.windowStartIteration}`,
        `awaiting_confirmation=${state.awaitingConfirmation}`,
        `strict_quality_gate=${state.strictQualityGate}`,
        `last_done=${state.lastDone.length}`,
        `last_missing=${state.lastMissing.length}`,
        `last_unresolved=${state.lastUnresolved.length}`,
      ].join('\n');
    },
  });

  const strict_quality_gate_set = tool({
    description: 'Enable or disable strict quality gate mode for this session.',
    args: {
      enabled: z.boolean(),
    },
    async execute(args, toolContext) {
      const sessionID =
        toolContext && typeof toolContext === 'object' && 'sessionID' in toolContext
          ? String((toolContext as { sessionID: string }).sessionID)
          : 'unknown';
      if (sessionID === 'unknown') {
        return 'Session id unavailable.';
      }

      const current = getSessionState(projectDir, sessionID);
      current.strictQualityGate = Boolean(args.enabled);
      setSessionState(projectDir, sessionID, current);
      return `strict_quality_gate=${current.strictQualityGate}`;
    },
  });

  return {
    save_work,
    load_work,
    check_work,
    quality_gate,
    cancel_work,
    loop_state,
    strict_quality_gate_set,
    miya_iteration_done,
  };
}
