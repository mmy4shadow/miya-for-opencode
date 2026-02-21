import {
  type AutoflowFixStep,
  type AutoflowManager,
  type AutoflowRunResult,
  configureAutoflowSession,
  runAutoflow,
} from '../../autoflow';
import type { RouteExecutionPlan, RouteStage } from '../../router';
import type { UltraworkTaskInput } from '../../ultrawork/types';

export interface AutoParallelStats {
  triggered: number;
  succeeded: number;
  failed: number;
  totalDagNodes: number;
  totalDagCompleted: number;
}

export interface AutoParallelOutcome {
  ok: boolean;
  summary: string;
  flow: AutoflowRunResult;
  tasks: UltraworkTaskInput[];
}

function clip(text: string, max = 1400): string {
  return text.trim().slice(0, max);
}

function stageToVerificationCommand(stage: RouteStage): string | undefined {
  if (stage === 'high') return 'npm --prefix miya-src run -s typecheck';
  if (stage === 'medium') return 'npm --prefix miya-src run -s check:contracts';
  return undefined;
}

function buildStageDag(
  plan: RouteExecutionPlan,
  text: string,
): UltraworkTaskInput[] {
  const available = new Set(plan.plannedAgents);
  const tasks: UltraworkTaskInput[] = [];
  const phase1: string[] = [];
  const seed = clip(text, 900);

  const pushPhase1 = (agent: string, id: string, prompt: string) => {
    if (!available.has(agent)) return;
    tasks.push({
      id,
      agent,
      prompt,
      description: `${agent} phase1`,
      dependsOn: [],
      maxRetries: 1,
    });
    phase1.push(id);
  };

  pushPhase1(
    '2-code-search',
    'phase1_search',
    `请并行侦察代码与配置现状：${seed}`,
  );
  pushPhase1(
    '3-docs-helper',
    'phase1_docs',
    `请并行查证关键约束与官方依据：${seed}`,
  );
  pushPhase1(
    '4-architecture-advisor',
    'phase1_arch',
    `请并行评估风险与验证层级：${seed}`,
  );

  if (phase1.length === 0) {
    const first = plan.plannedAgents[0] ?? plan.agent;
    tasks.push({
      id: 'phase1_primary',
      agent: first,
      prompt: seed,
      description: `${first} primary`,
      dependsOn: [],
      maxRetries: 1,
    });
    phase1.push('phase1_primary');
  }

  const fixer = plan.plannedAgents.includes('5-code-fixer')
    ? '5-code-fixer'
    : plan.agent;
  tasks.push({
    id: 'phase2_fix',
    agent: fixer,
    prompt: `基于上游并行结果执行落地修改并准备验证：${seed}`,
    description: `${fixer} phase2`,
    dependsOn: phase1,
    maxRetries: 1,
  });

  if (plan.plannedAgents.includes('7-code-simplicity-reviewer')) {
    tasks.push({
      id: 'phase3_simplify',
      agent: '7-code-simplicity-reviewer',
      prompt: `对已完成变更执行简化审查并给出可执行修正：${seed}`,
      description: '7-code-simplicity-reviewer phase3',
      dependsOn: ['phase2_fix'],
      maxRetries: 1,
    });
  }

  return tasks.slice(0, Math.max(1, plan.maxAgents));
}

function defaultFixSteps(): AutoflowFixStep[] {
  return [
    {
      id: 'fix_agent_round_1',
      type: 'agent_task',
      agent: '5-code-fixer',
      prompt: '根据最新验证失败信息执行最小修复并说明变更。',
      description: 'agent-based fix step',
      maxRetries: 1,
    },
    {
      id: 'fix_command_round_2',
      type: 'command',
      command: 'npm --prefix miya-src run -s typecheck',
      description: 'fallback command verification/fix step',
    },
  ];
}

export async function executeAutoParallelWorkflow(input: {
  projectDir: string;
  sessionID: string;
  text: string;
  plan: RouteExecutionPlan;
  manager: AutoflowManager;
}): Promise<AutoParallelOutcome> {
  const tasks = buildStageDag(input.plan, input.text);
  const verificationCommand = stageToVerificationCommand(input.plan.stage);
  configureAutoflowSession(input.projectDir, {
    sessionID: input.sessionID,
    goal: `auto_parallel:${clip(input.text, 280)}`,
    tasks,
    verificationCommand,
    fixSteps: defaultFixSteps(),
    maxFixRounds: 2,
    phase: 'planning',
  });

  const flow = await runAutoflow({
    projectDir: input.projectDir,
    sessionID: input.sessionID,
    manager: input.manager,
    goal: `auto_parallel:${clip(input.text, 280)}`,
    tasks,
    verificationCommand,
    fixSteps: defaultFixSteps(),
    maxFixRounds: 2,
    maxParallel: Math.max(2, Math.min(input.plan.maxAgents, 5)),
    forceRestart: true,
  });

  return {
    ok: flow.success,
    summary: flow.summary,
    flow,
    tasks,
  };
}
