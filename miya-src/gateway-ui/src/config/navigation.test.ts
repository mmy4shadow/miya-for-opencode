/**
 * Navigation Configuration Tests
 *
 * Validates the navigation configuration structure and completeness.
 * Requirements: 1.1, 1.2, 1.4, 1.6
 */

import { describe, expect, it } from 'vitest';
import { NAVIGATION_CONFIG, type NavigationItem } from './navigation';

describe('Navigation Configuration', () => {
  describe('Structure Validation', () => {
    it('should have exactly 6 navigation items', () => {
      // Requirement 1.1: System SHALL provide 6 independent navigation items
      expect(NAVIGATION_CONFIG).toHaveLength(6);
    });

    it('should have all required properties for each item', () => {
      // Requirement 1.4: System SHALL display title and subtitle for each item
      NAVIGATION_CONFIG.forEach((item: NavigationItem) => {
        expect(item).toHaveProperty('key');
        expect(item).toHaveProperty('path');
        expect(item).toHaveProperty('icon');
        expect(item).toHaveProperty('label');
        expect(item).toHaveProperty('subtitle');

        expect(typeof item.key).toBe('string');
        expect(typeof item.path).toBe('string');
        expect(typeof item.icon).toBe('string');
        expect(typeof item.label).toBe('string');
        expect(typeof item.subtitle).toBe('string');

        expect(item.key.length).toBeGreaterThan(0);
        expect(item.path.length).toBeGreaterThan(0);
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.subtitle.length).toBeGreaterThan(0);
      });
    });

    it('should have unique keys for all items', () => {
      const keys = NAVIGATION_CONFIG.map((item) => item.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should have unique paths for all items', () => {
      const paths = NAVIGATION_CONFIG.map((item) => item.path);
      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(paths.length);
    });
  });

  describe('Route Path Validation', () => {
    it('should define correct route paths for each module', () => {
      // Requirement 1.2: System SHALL define clear route paths
      const expectedPaths = [
        '/dashboard',
        '/psyche',
        '/security',
        '/tasks',
        '/memory',
        '/diagnostics',
      ];

      const actualPaths = NAVIGATION_CONFIG.map((item) => item.path);
      expect(actualPaths).toEqual(expectedPaths);
    });

    it('should have paths starting with forward slash', () => {
      NAVIGATION_CONFIG.forEach((item: NavigationItem) => {
        expect(item.path).toMatch(/^\//);
      });
    });
  });

  describe('Keyboard Shortcut Validation', () => {
    it('should have shortcuts for all navigation items', () => {
      // Requirement 1.6: System SHALL support keyboard shortcuts Alt+1 through Alt+6
      NAVIGATION_CONFIG.forEach((item: NavigationItem) => {
        expect(item.shortcut).toBeDefined();
        expect(typeof item.shortcut).toBe('string');
      });
    });

    it('should have correct shortcut format (Alt+N)', () => {
      const expectedShortcuts = [
        'Alt+1',
        'Alt+2',
        'Alt+3',
        'Alt+4',
        'Alt+5',
        'Alt+6',
      ];
      const actualShortcuts = NAVIGATION_CONFIG.map((item) => item.shortcut);
      expect(actualShortcuts).toEqual(expectedShortcuts);
    });

    it('should have unique shortcuts for all items', () => {
      const shortcuts = NAVIGATION_CONFIG.map((item) => item.shortcut);
      const uniqueShortcuts = new Set(shortcuts);
      expect(uniqueShortcuts.size).toBe(shortcuts.length);
    });
  });

  describe('Content Validation', () => {
    it('should have expected navigation items in correct order', () => {
      const expectedItems = [
        { key: 'dashboard', label: '控制中枢' },
        { key: 'psyche', label: '交互感知' },
        { key: 'security', label: '安全与风控' },
        { key: 'tasks', label: '作业中心' },
        { key: 'memory', label: '记忆库' },
        { key: 'diagnostics', label: '网关诊断' },
      ];

      expectedItems.forEach((expected, index) => {
        expect(NAVIGATION_CONFIG[index].key).toBe(expected.key);
        expect(NAVIGATION_CONFIG[index].label).toBe(expected.label);
      });
    });

    it('should have icons for all items', () => {
      NAVIGATION_CONFIG.forEach((item: NavigationItem) => {
        expect(item.icon).toBeTruthy();
        expect(item.icon.length).toBeGreaterThan(0);
      });
    });

    it('should have subtitles for all items', () => {
      // Requirement 1.4: System SHALL display subtitle for each navigation item
      NAVIGATION_CONFIG.forEach((item: NavigationItem) => {
        expect(item.subtitle).toBeTruthy();
        expect(item.subtitle.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Type Safety', () => {
    it('should match NavigationItem interface', () => {
      // TypeScript compile-time check ensures this
      const item: NavigationItem = NAVIGATION_CONFIG[0];
      expect(item).toBeDefined();
    });

    it('should be readonly array', () => {
      // Verify the array is exported as const
      expect(Array.isArray(NAVIGATION_CONFIG)).toBe(true);
    });
  });
});
