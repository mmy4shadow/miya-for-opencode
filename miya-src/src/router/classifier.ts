export type RouteIntent =
  | 'code_fix'
  | 'code_search'
  | 'docs_research'
  | 'architecture'
  | 'ui_design'
  | 'general';

export function classifyIntent(text: string): RouteIntent {
  const lower = text.toLowerCase();
  if (/(报错|修复|bug|错误|test fail|failing|compile)/i.test(lower)) {
    return 'code_fix';
  }
  if (/(查找|定位|where|find|grep|search)/i.test(lower)) {
    return 'code_search';
  }
  if (/(文档|api|docs|reference|手册)/i.test(lower)) {
    return 'docs_research';
  }
  if (/(架构|设计方案|tradeoff|risk|风控)/i.test(lower)) {
    return 'architecture';
  }
  if (/(ui|样式|页面|交互|设计|视觉)/i.test(lower)) {
    return 'ui_design';
  }
  return 'general';
}

export function recommendedAgent(intent: RouteIntent): string {
  if (intent === 'code_fix') return '5-code-fixer';
  if (intent === 'code_search') return '2-code-search';
  if (intent === 'docs_research') return '3-docs-helper';
  if (intent === 'architecture') return '4-architecture-advisor';
  if (intent === 'ui_design') return '6-ui-designer';
  return '1-task-manager';
}
