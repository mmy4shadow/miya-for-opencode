export type NavKey =
  | 'dashboard'
  | 'psyche'
  | 'security'
  | 'tasks'
  | 'memory'
  | 'diagnostics';

export interface NavItem {
  key: NavKey;
  label: string;
  subtitle: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '控制中枢', subtitle: '核心状态总览' },
  { key: 'psyche', label: '交互感知', subtitle: '守门员与心理参数' },
  { key: 'security', label: '安全与权限', subtitle: '安全开关与审计' },
  { key: 'tasks', label: '作业中心', subtitle: '任务执行与回放' },
  { key: 'memory', label: '记忆库', subtitle: '记忆筛选与修订' },
  { key: 'diagnostics', label: '网关诊断', subtitle: '节点与连接态' },
];

export function isNavActive(pathname: string, key: NavKey): boolean {
  if (key === 'dashboard') return pathname === '/' || pathname === '/dashboard';
  if (key === 'psyche') return pathname.startsWith('/psyche');
  if (key === 'security') return pathname.startsWith('/security');
  if (key === 'tasks') return pathname.includes('/tasks');
  if (key === 'memory') return pathname.includes('/memory');
  return pathname.includes('/diagnostics');
}

export function targetPathForNav(key: NavKey): string {
  if (key === 'dashboard') return '/dashboard';
  if (key === 'psyche') return '/psyche';
  if (key === 'security') return '/security';
  if (key === 'tasks') return '/tasks';
  if (key === 'memory') return '/memory';
  return '/diagnostics';
}
