/**
 * Sidebar Navigation Component
 *
 * Provides the main navigation menu for the Gateway UI application.
 * Displays all 6 navigation items with icons, labels, and subtitles.
 * Highlights the current active route and supports keyboard shortcuts.
 *
 * Requirements:
 * - 1.1: Renders all 6 navigation items
 * - 1.3: Handles navigation clicks
 * - 1.4: Displays title and subtitle for each item
 * - 1.5: Highlights current active route
 * - 1.6: Supports keyboard shortcuts (Alt+1 through Alt+6)
 */

import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAVIGATION_CONFIG } from '../config/navigation';

/**
 * Sidebar component
 *
 * Renders the navigation sidebar with all navigation items.
 * Uses React Router's useLocation to determine the active route
 * and useNavigate to handle navigation clicks.
 *
 * Wrapped with React.memo for performance optimization (Requirement 12.2).
 */
export const Sidebar = React.memo(function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Handle navigation item click
   *
   * @param path - The route path to navigate to
   */
  const handleNavigate = (path: string) => {
    navigate(path);
  };

  /**
   * Check if a navigation item is currently active
   *
   * @param path - The route path to check
   * @returns true if the current location matches the path
   */
  const isActive = (path: string): boolean => {
    return (
      location.pathname === path || location.pathname.startsWith(`${path}/`)
    );
  };

  /**
   * Handle keyboard shortcuts (Alt+1 through Alt+6)
   *
   * Requirement 1.6: Support keyboard shortcuts for navigation
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if Alt key is pressed
      if (!event.altKey) return;

      // Map number keys 1-6 to navigation items
      const keyMap: Record<string, string> = {
        '1': '/dashboard',
        '2': '/psyche',
        '3': '/security',
        '4': '/tasks',
        '5': '/memory',
        '6': '/diagnostics',
      };

      const targetPath = keyMap[event.key];
      if (targetPath) {
        event.preventDefault();
        navigate(targetPath);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate]);

  return (
    <nav
      className="w-64 bg-white border-r border-slate-200 h-screen flex flex-col"
      aria-label="主导航"
    >
      {/* Logo/Header Section */}
      <div className="p-6 border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900">Miya 网关</h1>
        <p className="text-sm text-slate-500 mt-1">控制台</p>
      </div>

      {/* Navigation Items */}
      <div className="flex-1 overflow-y-auto py-4">
        {NAVIGATION_CONFIG.map((item) => {
          const active = isActive(item.path);

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleNavigate(item.path)}
              className={`
                w-full px-6 py-3 flex items-start gap-3 text-left
                transition-colors duration-150
                ${
                  active
                    ? 'bg-blue-50 border-r-4 border-blue-600'
                    : 'hover:bg-slate-50'
                }
              `}
              aria-current={active ? 'page' : undefined}
              aria-label={`${item.label} - ${item.subtitle}${item.shortcut ? ` (${item.shortcut})` : ''}`}
            >
              {/* Icon */}
              <span
                className="text-2xl flex-shrink-0"
                role="img"
                aria-hidden="true"
              >
                {item.icon}
              </span>

              {/* Text Content */}
              <div className="flex-1 min-w-0">
                <div
                  className={`font-medium ${active ? 'text-blue-900' : 'text-slate-900'}`}
                >
                  {item.label}
                </div>
                <div
                  className={`text-xs mt-0.5 ${active ? 'text-blue-700' : 'text-slate-500'}`}
                >
                  {item.subtitle}
                </div>
                {item.shortcut && (
                  <div className="text-xs text-slate-400 mt-1">
                    {item.shortcut}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer Section (Optional) */}
      <div className="p-4 border-t border-slate-200 text-xs text-slate-500">
        <p>版本 1.0.0</p>
      </div>
    </nav>
  );
});
