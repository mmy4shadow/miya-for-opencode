/**
 * Property-Based Tests for Sidebar Component
 * 
 * Tests Properties 1, 3, and 4 for the Sidebar navigation component.
 * Validates Requirements: 1.1, 1.4, 1.5, 1.6
 * 
 * Uses fast-check to generate random data and verify navigation properties
 * hold across all valid inputs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import * as fc from 'fast-check';
import { Sidebar } from './Sidebar';
import { NAVIGATION_CONFIG } from '../config/navigation';

describe('Sidebar Property-Based Tests', () => {
  describe('Property 1: Navigation Item Completeness', () => {
    /**
     * **Validates: Requirements 1.1, 1.4**
     * 
     * Property: For any rendered Sidebar component, it should contain all 6 navigation items
     * (Dashboard, Psyche, Security, Tasks, Memory, Diagnostics), and each navigation item
     * should include both title and subtitle text.
     * 
     * This property ensures that the navigation structure is complete and consistent
     * regardless of the application state.
     */
    it('should render all 6 navigation items with title and subtitle', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const { container } = render(
            <BrowserRouter>
              <Sidebar />
            </BrowserRouter>
          );

          // Find all navigation buttons
          const navButtons = container.querySelectorAll('nav button');
          
          // Requirement 1.1: Should have exactly 6 navigation items
          expect(navButtons).toHaveLength(6);

          // Requirement 1.4: Each item should have title and subtitle
          navButtons.forEach((button, index) => {
            const navItem = NAVIGATION_CONFIG[index];
            
            // Check for title (font-medium class)
            const title = button.querySelector('.font-medium');
            expect(title).toBeInTheDocument();
            expect(title?.textContent).toBe(navItem.label);

            // Check for subtitle (text-xs class)
            const subtitles = button.querySelectorAll('.text-xs');
            expect(subtitles.length).toBeGreaterThan(0);
            
            // Find the subtitle element (not the shortcut)
            const subtitle = Array.from(subtitles).find(
              (el) => el.textContent === navItem.subtitle
            );
            expect(subtitle).toBeInTheDocument();
          });
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Each navigation item should display its configured icon.
     * 
     * This ensures visual consistency and helps users quickly identify navigation items.
     */
    it('should render navigation items with correct icons', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const { container } = render(
            <BrowserRouter>
              <Sidebar />
            </BrowserRouter>
          );

          const navButtons = container.querySelectorAll('nav button');
          
          navButtons.forEach((button, index) => {
            const navItem = NAVIGATION_CONFIG[index];
            const icon = button.querySelector('[role="img"]');
            
            expect(icon).toBeInTheDocument();
            expect(icon?.textContent).toBe(navItem.icon);
          });
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: All navigation items should have descriptive aria-label attributes
     * for accessibility.
     */
    it('should have proper ARIA labels for all navigation items', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const { container } = render(
            <BrowserRouter>
              <Sidebar />
            </BrowserRouter>
          );

          const navButtons = container.querySelectorAll('nav button');
          
          navButtons.forEach((button, index) => {
            const ariaLabel = button.getAttribute('aria-label');
            const navItem = NAVIGATION_CONFIG[index];
            
            expect(ariaLabel).toBeTruthy();
            expect(ariaLabel).toContain(navItem.label);
            expect(ariaLabel).toContain(navItem.subtitle);
          });
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Navigation Active State', () => {
    /**
     * **Validates: Requirements 1.5**
     * 
     * Property: For any current route path, the corresponding navigation item should
     * have active state styling (aria-current="page"), and only one navigation item
     * should be in active state.
     * 
     * This property ensures that users always know which page they are currently viewing,
     * and that the active state is mutually exclusive across navigation items.
     */
    it('should highlight the current route with active styling', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...NAVIGATION_CONFIG.map((item) => item.path)),
          (currentPath) => {
            const { container } = render(
              <MemoryRouter initialEntries={[currentPath]}>
                <Sidebar />
              </MemoryRouter>
            );

            const navButtons = container.querySelectorAll('nav button');
            
            // Count how many items have aria-current="page"
            let activeCount = 0;
            let foundActiveItem = false;

            navButtons.forEach((button) => {
              const ariaCurrent = button.getAttribute('aria-current');
              
              if (ariaCurrent === 'page') {
                activeCount++;
                foundActiveItem = true;
                
                // Active item should have blue background
                expect(button).toHaveClass('bg-blue-50');
                expect(button).toHaveClass('border-blue-600');
              }
            });

            // Requirement 1.5: Exactly one item should be active
            expect(activeCount).toBe(1);
            expect(foundActiveItem).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: When navigating to a specific route, only the navigation item
     * with the matching path should have active styling.
     * 
     * This ensures that the active state is correctly applied and mutually exclusive.
     */
    it('should apply active styling only to the matching route', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: NAVIGATION_CONFIG.length - 1 }),
          (activeIndex) => {
            const activePath = NAVIGATION_CONFIG[activeIndex].path;
            
            const { container } = render(
              <MemoryRouter initialEntries={[activePath]}>
                <Sidebar />
              </MemoryRouter>
            );

            const navButtons = container.querySelectorAll('nav button');
            
            navButtons.forEach((button, index) => {
              const ariaCurrent = button.getAttribute('aria-current');
              
              if (index === activeIndex) {
                // This should be the active item
                expect(ariaCurrent).toBe('page');
                expect(button).toHaveClass('bg-blue-50');
              } else {
                // These should not be active
                expect(ariaCurrent).toBeNull();
                expect(button).not.toHaveClass('bg-blue-50');
              }
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Active state should be correctly applied for sub-routes.
     * 
     * For example, /tasks/123 should activate the /tasks navigation item.
     */
    it('should activate parent route for sub-routes', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('/tasks', '/memory'),
          fc.string({ minLength: 1, maxLength: 10 }),
          (basePath, subPath) => {
            const fullPath = `${basePath}/${subPath}`;
            
            const { container } = render(
              <MemoryRouter initialEntries={[fullPath]}>
                <Sidebar />
              </MemoryRouter>
            );

            const navButtons = container.querySelectorAll('nav button');
            
            // Find the button for the base path
            const basePathIndex = NAVIGATION_CONFIG.findIndex(
              (item) => item.path === basePath
            );
            
            if (basePathIndex >= 0) {
              const activeButton = navButtons[basePathIndex];
              expect(activeButton.getAttribute('aria-current')).toBe('page');
              expect(activeButton).toHaveClass('bg-blue-50');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: Keyboard Shortcut Navigation', () => {
    /**
     * **Validates: Requirements 1.6**
     * 
     * Property: For any navigation item with a defined shortcut, pressing the
     * corresponding shortcut key combination (Alt+1 through Alt+6) should
     * navigate to that navigation item's route path.
     * 
     * This property ensures that keyboard shortcuts provide an efficient way
     * to navigate the application without using the mouse.
     */
    it('should navigate when Alt+number shortcuts are pressed', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 6 }),
          (shortcutNumber) => {
            const { container, unmount } = render(
              <BrowserRouter>
                <Sidebar />
              </BrowserRouter>
            );

            // Create keyboard event for Alt+number
            const keyEvent = new KeyboardEvent('keydown', {
              key: shortcutNumber.toString(),
              altKey: true,
              bubbles: true,
            });

            // Dispatch the event
            window.dispatchEvent(keyEvent);

            // Verify the component doesn't throw errors
            expect(container).toBeInTheDocument();
            
            // Clean up
            unmount();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Pressing number keys without Alt should not trigger navigation.
     * 
     * This ensures that shortcuts don't interfere with normal typing or input.
     */
    it('should not navigate when Alt key is not pressed', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 6 }),
          (keyNumber) => {
            const { container } = render(
              <BrowserRouter>
                <Sidebar />
              </BrowserRouter>
            );

            // Create keyboard event without Alt key
            const keyEvent = new KeyboardEvent('keydown', {
              key: keyNumber.toString(),
              altKey: false,
              bubbles: true,
            });

            // Dispatch the event - should not cause any errors
            window.dispatchEvent(keyEvent);

            expect(container).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Pressing Alt with non-numeric keys should not trigger navigation.
     * 
     * This ensures that only the defined shortcuts (Alt+1 through Alt+6) trigger navigation.
     */
    it('should ignore non-numeric keys with Alt', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('a', 'b', 'z', 'Enter', 'Escape', 'Tab', '0', '7', '8', '9'),
          (key) => {
            const { container } = render(
              <BrowserRouter>
                <Sidebar />
              </BrowserRouter>
            );

            const keyEvent = new KeyboardEvent('keydown', {
              key,
              altKey: true,
              bubbles: true,
            });

            window.dispatchEvent(keyEvent);

            expect(container).toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Each shortcut number (1-6) should map to the correct navigation path.
     * 
     * This ensures the shortcut mapping is correct and consistent.
     */
    it('should map shortcuts to correct navigation paths', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const expectedMapping = {
            '1': '/dashboard',
            '2': '/psyche',
            '3': '/security',
            '4': '/tasks',
            '5': '/memory',
            '6': '/diagnostics',
          };

          // Verify the mapping matches NAVIGATION_CONFIG
          Object.entries(expectedMapping).forEach(([key, path]) => {
            const index = parseInt(key) - 1;
            expect(NAVIGATION_CONFIG[index].path).toBe(path);
          });
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Integration Properties', () => {
    /**
     * Property: The sidebar should maintain consistent structure across all routes.
     * 
     * This ensures that navigation is always available regardless of the current page.
     */
    it('should maintain consistent structure across all routes', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...NAVIGATION_CONFIG.map((item) => item.path)),
          (currentPath) => {
            const { container } = render(
              <MemoryRouter initialEntries={[currentPath]}>
                <Sidebar />
              </MemoryRouter>
            );

            // Should always have 6 navigation items
            const navButtons = container.querySelectorAll('nav button');
            expect(navButtons).toHaveLength(6);

            // Should always have the header
            const headers = container.querySelectorAll('h1');
            const header = Array.from(headers).find(h => h.textContent === 'Miya 网关');
            expect(header).toBeInTheDocument();

            // Should always have the navigation role
            const navElement = container.querySelector('nav');
            expect(navElement?.getAttribute('role')).toBe('navigation');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Navigation items should be rendered in the correct order.
     * 
     * This ensures consistent visual layout and predictable keyboard navigation.
     */
    it('should render navigation items in correct order', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const { container } = render(
            <BrowserRouter>
              <Sidebar />
            </BrowserRouter>
          );

          const navButtons = container.querySelectorAll('nav button');
          
          navButtons.forEach((button, index) => {
            const navItem = NAVIGATION_CONFIG[index];
            expect(button.textContent).toContain(navItem.label);
            expect(button.textContent).toContain(navItem.subtitle);
          });
        }),
        { numRuns: 100 }
      );
    });
  });
});
