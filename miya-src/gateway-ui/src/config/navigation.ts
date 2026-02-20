/**
 * Navigation Configuration
 * 
 * Defines the navigation structure for the Miya Gateway UI.
 * This configuration supports the 6-module architecture:
 * Dashboard, Psyche, Security, Tasks, Memory, and Diagnostics.
 * 
 * Requirements: 1.1, 1.2
 */

/**
 * Navigation item interface
 * 
 * @property key - Unique identifier for the navigation item
 * @property path - Route path for the navigation item
 * @property icon - Emoji icon for visual identification
 * @property label - Primary label text
 * @property subtitle - Secondary descriptive text
 * @property shortcut - Optional keyboard shortcut (e.g., "Alt+1")
 */
export interface NavigationItem {
  key: string;
  path: string;
  icon: string;
  label: string;
  subtitle: string;
  shortcut?: string;
}

/**
 * Navigation configuration array
 * 
 * Defines all 6 navigation items with their routes, icons, labels, and shortcuts.
 * This configuration is used by the Sidebar component to render navigation menu.
 * 
 * Requirements:
 * - 1.1: Provides 6 independent navigation items
 * - 1.2: Defines clear route paths for each module
 * - 1.4: Includes title and subtitle for each item
 * - 1.6: Includes keyboard shortcuts (Alt+1 through Alt+6)
 */
export const NAVIGATION_CONFIG: NavigationItem[] = [
  {
    key: 'dashboard',
    path: '/dashboard',
    icon: '🏠',
    label: '控制中枢',
    subtitle: '核心状态总览',
    shortcut: 'Alt+1',
  },
  {
    key: 'psyche',
    path: '/psyche',
    icon: '🧠',
    label: '交互感知',
    subtitle: '守门员与心理参数',
    shortcut: 'Alt+2',
  },
  {
    key: 'security',
    path: '/security',
    icon: '🛡️',
    label: '安全与风控',
    subtitle: '权限控制与审计',
    shortcut: 'Alt+3',
  },
  {
    key: 'tasks',
    path: '/tasks',
    icon: '📋',
    label: '作业中心',
    subtitle: '任务执行与回放',
    shortcut: 'Alt+4',
  },
  {
    key: 'memory',
    path: '/memory',
    icon: '📚',
    label: '记忆库',
    subtitle: '记忆筛选与修订',
    shortcut: 'Alt+5',
  },
  {
    key: 'diagnostics',
    path: '/diagnostics',
    icon: '📡',
    label: '网关诊断',
    subtitle: '节点与连接态',
    shortcut: 'Alt+6',
  },
];
