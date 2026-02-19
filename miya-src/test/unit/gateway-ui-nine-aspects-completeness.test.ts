import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const appFile = path.join(
  import.meta.dir,
  '..',
  '..',
  'gateway-ui',
  'src',
  'App.tsx',
);
const appSource = fs.readFileSync(appFile, 'utf-8');

describe('gateway ui nine-aspect completeness', () => {
  test('notification system keeps a visible recent log', () => {
    expect(appSource.includes('const [notifications, setNotifications]')).toBe(
      true,
    );
    expect(appSource.includes('通知中心')).toBe(true);
    expect(appSource.includes('clearNotifications')).toBe(true);
  });

  test('onboarding and first-time guidance are available', () => {
    expect(appSource.includes('miya_gateway_onboarding_done')).toBe(true);
    expect(appSource.includes('首次使用引导')).toBe(true);
    expect(appSource.includes('completeOnboarding')).toBe(true);
  });

  test('keyboard navigation and accessibility shortcuts are implemented', () => {
    expect(appSource.includes("event.altKey")).toBe(true);
    expect(appSource.includes("event.key === '1'")).toBe(true);
    expect(appSource.includes("event.key === '/'")).toBe(true);
    expect(appSource.includes('aria-current={active ? \'page\' : undefined}')).toBe(
      true,
    );
  });

  test('search, filtering, and batch operations are implemented', () => {
    expect(appSource.includes('taskSearchQuery')).toBe(true);
    expect(appSource.includes('memorySearchQuery')).toBe(true);
    expect(appSource.includes('runBatchMemoryOperation')).toBe(true);
    expect(appSource.includes('全选/反选可见项')).toBe(true);
  });

  test('real-time update visibility and perceived performance cues exist', () => {
    expect(appSource.includes('setInterval(() =>')).toBe(true);
    expect(appSource.includes('formatRelativeSeconds(lastRefreshAt)')).toBe(true);
    expect(appSource.includes("isRefreshing ? '刷新中...' : '刷新'")).toBe(true);
  });

  test('data export/import and context-aware help are available', () => {
    expect(appSource.includes('exportMemories')).toBe(true);
    expect(appSource.includes('importMemoriesFromFile')).toBe(true);
    expect(appSource.includes('memoryImportInputRef')).toBe(true);
    expect(appSource.includes('const contextHelp = useMemo')).toBe(true);
    expect(appSource.includes('当前上下文问题')).toBe(true);
  });
});
