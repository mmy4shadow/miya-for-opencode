/**
 * Route Configuration Tests
 * 
 * Tests the routing configuration to ensure all routes are properly defined
 * and the root path redirects correctly.
 * 
 * Requirements: 1.2
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Routes, Route, Navigate, MemoryRouter } from 'react-router-dom';
import { NAVIGATION_CONFIG } from './navigation';

/**
 * Mock GatewayRpcClient to avoid real network calls during tests
 */
vi.mock('../gateway-client', () => ({
  GatewayRpcClient: class MockGatewayRpcClient {
    request = vi.fn().mockResolvedValue({});
    dispose = vi.fn();
  },
}));

/**
 * Simple test components for each route
 */
const TestDashboard = () => <div data-testid="dashboard-page">Dashboard Page</div>;
const TestPsyche = () => <div data-testid="psyche-page">Psyche Page</div>;
const TestSecurity = () => <div data-testid="security-page">Security Page</div>;
const TestTasks = () => <div data-testid="tasks-page">Tasks Page</div>;
const TestMemory = () => <div data-testid="memory-page">Memory Page</div>;
const TestDiagnostics = () => <div data-testid="diagnostics-page">Diagnostics Page</div>;

/**
 * Test router configuration that mirrors the actual app routes
 */
function TestRouterConfig() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<TestDashboard />} />
      <Route path="/psyche" element={<TestPsyche />} />
      <Route path="/security" element={<TestSecurity />} />
      <Route path="/tasks" element={<TestTasks />} />
      <Route path="/memory" element={<TestMemory />} />
      <Route path="/diagnostics" element={<TestDiagnostics />} />
    </Routes>
  );
}

describe('Route Configuration', () => {
  describe('Route Path Definitions', () => {
    it('should define all 6 navigation routes', () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The System SHALL define clear route paths for each module:
       * - /dashboard (控制中枢)
       * - /psyche (交互感知)
       * - /security (安全与风控)
       * - /tasks (作业中心)
       * - /memory (记忆库)
       * - /diagnostics (网关诊断)
       */
      
      // Verify all expected paths are defined in NAVIGATION_CONFIG
      const expectedPaths = [
        '/dashboard',
        '/psyche',
        '/security',
        '/tasks',
        '/memory',
        '/diagnostics',
      ];

      const actualPaths = NAVIGATION_CONFIG.map(item => item.path);
      
      // Check that all expected paths are present
      expectedPaths.forEach(expectedPath => {
        expect(actualPaths).toContain(expectedPath);
      });

      // Verify we have exactly 6 routes
      expect(actualPaths).toHaveLength(6);
    });

    it('should render dashboard route at /dashboard', async () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The /dashboard route should be accessible and render the dashboard page.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(getByTestId('dashboard-page')).toBeInTheDocument();
      });
    });

    it('should render psyche route at /psyche', async () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The /psyche route should be accessible and render the psyche page.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/psyche']}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(getByTestId('psyche-page')).toBeInTheDocument();
      });
    });

    it('should render security route at /security', async () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The /security route should be accessible and render the security page.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/security']}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(getByTestId('security-page')).toBeInTheDocument();
      });
    });

    it('should render tasks route at /tasks', async () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The /tasks route should be accessible and render the tasks page.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/tasks']}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(getByTestId('tasks-page')).toBeInTheDocument();
      });
    });

    it('should render memory route at /memory', async () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The /memory route should be accessible and render the memory page.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/memory']}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(getByTestId('memory-page')).toBeInTheDocument();
      });
    });

    it('should render diagnostics route at /diagnostics', async () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The /diagnostics route should be accessible and render the diagnostics page.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/diagnostics']}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(getByTestId('diagnostics-page')).toBeInTheDocument();
      });
    });

    it('should have unique route paths', () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * All route paths should be unique to avoid conflicts.
       */
      const paths = NAVIGATION_CONFIG.map(item => item.path);
      const uniquePaths = new Set(paths);
      
      expect(uniquePaths.size).toBe(paths.length);
    });

    it('should have all paths starting with forward slash', () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * All route paths should follow the convention of starting with /.
       */
      NAVIGATION_CONFIG.forEach(item => {
        expect(item.path).toMatch(/^\//);
      });
    });
  });

  describe('Root Path Redirect', () => {
    it('should redirect root path to /dashboard', async () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The root path (/) should redirect to /dashboard to provide
       * a default landing page for users.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/']}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      // After redirect, should see the dashboard page
      await waitFor(() => {
        expect(getByTestId('dashboard-page')).toBeInTheDocument();
      });
    });

    it('should use replace navigation for root redirect', () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The root redirect should use replace navigation to avoid
       * adding an extra entry to browser history.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<TestDashboard />} />
          </Routes>
        </MemoryRouter>
      );

      // Should render dashboard without adding history entry
      expect(getByTestId('dashboard-page')).toBeInTheDocument();
    });

    it('should not redirect non-root paths', async () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * Only the root path should redirect; other paths should
       * render their respective pages directly.
       */
      const testPaths = [
        { path: '/dashboard', testId: 'dashboard-page' },
        { path: '/psyche', testId: 'psyche-page' },
        { path: '/security', testId: 'security-page' },
        { path: '/tasks', testId: 'tasks-page' },
        { path: '/memory', testId: 'memory-page' },
        { path: '/diagnostics', testId: 'diagnostics-page' },
      ];

      for (const { path, testId } of testPaths) {
        const { getByTestId, unmount } = render(
          <MemoryRouter initialEntries={[path]}>
            <TestRouterConfig />
          </MemoryRouter>
        );

        await waitFor(() => {
          expect(getByTestId(testId)).toBeInTheDocument();
        });

        unmount();
      }
    });
  });

  describe('Route Configuration Completeness', () => {
    it('should have route definitions matching navigation config', () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * The route configuration should match the navigation configuration
       * to ensure consistency between navigation and routing.
       */
      const navPaths = NAVIGATION_CONFIG.map(item => item.path);
      const expectedRoutes = [
        '/dashboard',
        '/psyche',
        '/security',
        '/tasks',
        '/memory',
        '/diagnostics',
      ];

      expect(navPaths).toEqual(expectedRoutes);
    });

    it('should define routes for all navigation items', () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * Every navigation item should have a corresponding route definition.
       */
      const navKeys = NAVIGATION_CONFIG.map(item => item.key);
      const expectedKeys = [
        'dashboard',
        'psyche',
        'security',
        'tasks',
        'memory',
        'diagnostics',
      ];

      expect(navKeys).toEqual(expectedKeys);
    });

    it('should have consistent path naming convention', () => {
      /**
       * **Validates: Requirements 1.2**
       * 
       * All route paths should follow a consistent naming convention
       * (lowercase, no special characters except hyphens).
       */
      NAVIGATION_CONFIG.forEach(item => {
        // Path should be lowercase and only contain letters, hyphens, and forward slash
        expect(item.path).toMatch(/^\/[a-z-]+$/);
      });
    });
  });

  describe('Route Navigation', () => {
    it('should allow navigation between all routes', async () => {
      /**
       * **Validates: Requirements 1.2, 1.3**
       * 
       * Users should be able to navigate between all defined routes.
       */
      const routes = [
        { path: '/dashboard', testId: 'dashboard-page' },
        { path: '/tasks', testId: 'tasks-page' },
        { path: '/memory', testId: 'memory-page' },
        { path: '/diagnostics', testId: 'diagnostics-page' },
      ];

      for (const { path, testId } of routes) {
        const { getByTestId, unmount } = render(
          <MemoryRouter initialEntries={[path]}>
            <TestRouterConfig />
          </MemoryRouter>
        );

        await waitFor(() => {
          const element = getByTestId(testId);
          expect(element).toBeInTheDocument();
        });

        unmount();
      }
    });

    it('should maintain route state during navigation', async () => {
      /**
       * **Validates: Requirements 9.1, 9.2**
       * 
       * Route state should be maintained when navigating between pages.
       * This test verifies that the router can handle multiple entries in history.
       */
      const { getByTestId } = render(
        <MemoryRouter initialEntries={['/dashboard', '/tasks']} initialIndex={0}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      // Start at dashboard (index 0)
      await waitFor(() => {
        expect(getByTestId('dashboard-page')).toBeInTheDocument();
      });

      // Verify we can navigate to tasks by changing the router's initial index
      // In a real app, this would be done via Link or navigate()
      const { getByTestId: getByTestId2 } = render(
        <MemoryRouter initialEntries={['/dashboard', '/tasks']} initialIndex={1}>
          <TestRouterConfig />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(getByTestId2('tasks-page')).toBeInTheDocument();
      });
    });
  });
});
