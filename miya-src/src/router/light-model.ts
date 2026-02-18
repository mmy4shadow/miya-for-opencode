import type { RouteIntent } from './classifier';

export interface RouteLightModelResult {
  probabilities: Record<RouteIntent, number>;
  evidence: string[];
  version: string;
}

const VERSION = 'route_light_model_v1';

const FEATURE_WEIGHTS: Record<
  RouteIntent,
  Array<{ pattern: RegExp; weight: number; evidence: string }>
> = {
  code_fix: [
    {
      pattern:
        /(bug|报错|修复|failing|stack trace|panic|exception|traceback|fix)/i,
      weight: 1.3,
      evidence: 'lm_fix_error',
    },
    {
      pattern: /(test fail|ci fail|lint fail|回归|hotfix|patch)/i,
      weight: 0.9,
      evidence: 'lm_fix_ci',
    },
  ],
  code_search: [
    {
      pattern: /(find|search|grep|定位|查找|索引|where)/i,
      weight: 1.2,
      evidence: 'lm_search_query',
    },
    {
      pattern: /(在哪|引用|definition|symbol|callsite)/i,
      weight: 0.7,
      evidence: 'lm_search_symbol',
    },
  ],
  docs_research: [
    {
      pattern: /(docs?|文档|reference|规范|citation|paper)/i,
      weight: 1.1,
      evidence: 'lm_docs_keyword',
    },
    {
      pattern: /(latest|最新|official|官网|source link)/i,
      weight: 0.6,
      evidence: 'lm_docs_freshness',
    },
  ],
  architecture: [
    {
      pattern: /(architecture|架构|tradeoff|可扩展|migration|重构方案|risk)/i,
      weight: 1.15,
      evidence: 'lm_arch_signal',
    },
    {
      pattern: /(pipeline|orchestr|workflow|state machine|治理)/i,
      weight: 0.7,
      evidence: 'lm_arch_workflow',
    },
  ],
  ui_design: [
    {
      pattern: /(ui|页面|视觉|layout|css|交互|动效|mockup|figma)/i,
      weight: 1.2,
      evidence: 'lm_ui_signal',
    },
    {
      pattern: /(font|color|spacing|responsive)/i,
      weight: 0.6,
      evidence: 'lm_ui_detail',
    },
  ],
  general: [],
};

function softmax(
  scores: Record<RouteIntent, number>,
): Record<RouteIntent, number> {
  const intents = Object.keys(scores) as RouteIntent[];
  const maxValue = Math.max(...intents.map((intent) => scores[intent]));
  const exps = intents.map((intent) => Math.exp(scores[intent] - maxValue));
  const denom = exps.reduce((sum, value) => sum + value, 0) || 1;
  const probs: Record<RouteIntent, number> = {
    code_fix: 0,
    code_search: 0,
    docs_research: 0,
    architecture: 0,
    ui_design: 0,
    general: 0,
  };
  intents.forEach((intent, index) => {
    probs[intent] = Number((exps[index] / denom).toFixed(6));
  });
  return probs;
}

export function scoreRouteIntentLightModel(
  text: string,
): RouteLightModelResult {
  const input = String(text ?? '').trim();
  const scores: Record<RouteIntent, number> = {
    code_fix: 0.25,
    code_search: 0.22,
    docs_research: 0.2,
    architecture: 0.2,
    ui_design: 0.2,
    general: 0.35,
  };
  const evidence: string[] = [];

  for (const intent of Object.keys(FEATURE_WEIGHTS) as RouteIntent[]) {
    for (const rule of FEATURE_WEIGHTS[intent]) {
      if (!rule.pattern.test(input)) continue;
      scores[intent] += rule.weight;
      evidence.push(rule.evidence);
    }
  }

  if (/```[\s\S]*```/.test(input)) {
    scores.code_fix += 0.45;
    scores.code_search += 0.3;
    evidence.push('lm_code_block');
  }
  if (/(plan|exec|verify|fix|计划|执行|验证|修复)/i.test(input)) {
    scores.architecture += 0.8;
    scores.code_fix += 0.05;
    evidence.push('lm_pipeline_terms');
  }
  if (/(state graph|状态图|budget|预算|fixability)/i.test(input)) {
    scores.architecture += 0.9;
    evidence.push('lm_state_graph_budget');
  }
  if (/(截图|screenshot|gif|动图)/i.test(input)) {
    scores.ui_design += 0.4;
    evidence.push('lm_visual_assets');
  }

  // Penalize general when explicit domain evidence exists.
  const domainSignal =
    scores.code_fix +
    scores.code_search +
    scores.docs_research +
    scores.architecture +
    scores.ui_design;
  if (domainSignal > 2) scores.general = Math.max(0.05, scores.general - 0.2);

  return {
    probabilities: softmax(scores),
    evidence: [...new Set(evidence)].slice(0, 10),
    version: VERSION,
  };
}
