import { scoreRouteIntentLightModel } from './light-model';

export type RouteIntent =
  | 'code_fix'
  | 'code_search'
  | 'docs_research'
  | 'architecture'
  | 'ui_design'
  | 'general';

interface IntentRule {
  intent: RouteIntent;
  pattern: RegExp;
  weight: number;
  evidence: string;
}

export interface RouteSemanticSignal {
  intent: RouteIntent;
  confidence: number;
  evidence: string[];
  scores: Record<RouteIntent, number>;
  ambiguity: number;
}

const INTENT_RULES: IntentRule[] = [
  { intent: 'code_fix', pattern: /(报错|修复|bug|错误|test fail|failing|compile|panic|stack trace|回归)/i, weight: 1.4, evidence: 'fix_error_signal' },
  { intent: 'code_fix', pattern: /(rollback|hotfix|patch|修一下|修复一下)/i, weight: 0.8, evidence: 'fix_action_signal' },
  { intent: 'code_search', pattern: /(查找|定位|where|find|grep|search|索引|引用在哪)/i, weight: 1.3, evidence: 'search_signal' },
  { intent: 'docs_research', pattern: /(文档|api|docs|reference|手册|规范|citation|引用来源)/i, weight: 1.3, evidence: 'docs_signal' },
  { intent: 'architecture', pattern: /(架构|设计方案|tradeoff|risk|风控|扩展性|可维护|migration|迁移)/i, weight: 1.2, evidence: 'architecture_signal' },
  { intent: 'ui_design', pattern: /(ui|样式|页面|交互|设计|视觉|layout|css|动效|排版)/i, weight: 1.2, evidence: 'ui_signal' },
];

function seedScores(): Record<RouteIntent, number> {
  return {
    code_fix: 0,
    code_search: 0,
    docs_research: 0,
    architecture: 0,
    ui_design: 0,
    general: 0.2,
  };
}

export function analyzeRouteSemantics(text: string): RouteSemanticSignal {
  const lower = String(text ?? '').toLowerCase();
  const ruleScores = seedScores();
  const evidence: string[] = [];
  for (const rule of INTENT_RULES) {
    if (!rule.pattern.test(lower)) continue;
    ruleScores[rule.intent] += rule.weight;
    evidence.push(rule.evidence);
  }

  if (/```[\s\S]*```/.test(lower)) {
    ruleScores.code_fix += 0.6;
    ruleScores.code_search += 0.4;
    evidence.push('code_block_present');
  }
  if (/(截图|mockup|figma|视觉稿)/i.test(lower)) {
    ruleScores.ui_design += 0.7;
    evidence.push('design_asset_signal');
  }
  if (/(并行|pipeline|workflow|编排|自动化)/i.test(lower)) {
    ruleScores.architecture += 0.5;
    ruleScores.code_fix += 0.3;
    evidence.push('workflow_signal');
  }
  if (/(state graph|状态图|budget|预算|fixability|postmortem)/i.test(lower)) {
    ruleScores.architecture += 1.05;
    evidence.push('state_graph_budget_signal');
  }

  const model = scoreRouteIntentLightModel(lower);
  const modelScale = 1.6;
  const modelWeight = 0.52;
  const combinedScores = seedScores();
  for (const intent of Object.keys(combinedScores) as RouteIntent[]) {
    combinedScores[intent] =
      (ruleScores[intent] ?? 0) + (model.probabilities[intent] ?? 0) * modelScale * modelWeight;
  }
  evidence.push(...model.evidence.map((item) => `light_model:${item}`));

  const ranked = Object.entries(combinedScores)
    .filter(([intent]) => intent !== 'general')
    .sort((a, b) => b[1] - a[1]) as Array<[RouteIntent, number]>;
  const top = ranked[0];
  const second = ranked[1];
  const intent: RouteIntent = !top || top[1] <= 0.25 ? 'general' : top[0];
  const confidence = !top
    ? 0
    : Number(Math.max(0, Math.min(1, top[1] / Math.max(1, top[1] + (second?.[1] ?? 0.2)))).toFixed(4));
  const ambiguity = second && top ? Number(Math.max(0, second[1] / Math.max(top[1], 0.0001)).toFixed(4)) : 0;

  return {
    intent,
    confidence,
    evidence: [...new Set(evidence)].slice(0, 8),
    scores: combinedScores,
    ambiguity,
  };
}

export function classifyIntent(text: string): RouteIntent {
  return analyzeRouteSemantics(text).intent;
}

export function recommendedAgent(intent: RouteIntent): string {
  if (intent === 'code_fix') return '5-code-fixer';
  if (intent === 'code_search') return '2-code-search';
  if (intent === 'docs_research') return '3-docs-helper';
  if (intent === 'architecture') return '4-architecture-advisor';
  if (intent === 'ui_design') return '6-ui-designer';
  return '1-task-manager';
}
