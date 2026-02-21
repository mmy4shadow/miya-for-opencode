import { render } from '@testing-library/react';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  describe('Property 8: Card Style Consistency', () => {
    it('should apply all required CSS classes consistently', () => {
      /**
       * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**
       *
       * Property: For any Card component rendered, it should apply all required CSS classes:
       * - Rounded corners (rounded-xl or rounded-2xl)
       * - Border (border border-slate-200)
       * - White background (bg-white)
       * - Padding (p-4 or larger)
       * - Shadow effect (shadow-sm)
       */
      fc.assert(
        fc.property(
          fc.record({
            title: fc.option(fc.string(), { nil: undefined }),
            subtitle: fc.option(fc.string(), { nil: undefined }),
            content: fc.string(),
            className: fc.option(fc.string(), { nil: undefined }),
          }),
          (props) => {
            const { container } = render(
              <Card
                title={props.title}
                subtitle={props.subtitle}
                className={props.className}
              >
                {props.content}
              </Card>,
            );

            const cardElement = container.firstChild as HTMLElement;
            expect(cardElement).toBeInTheDocument();

            // Requirement 8.2: Rounded corners (rounded-xl or rounded-2xl)
            const hasRoundedCorners =
              cardElement.classList.contains('rounded-xl') ||
              cardElement.classList.contains('rounded-2xl');
            expect(hasRoundedCorners).toBe(true);

            // Requirement 8.3: Border (border border-slate-200)
            expect(cardElement).toHaveClass('border');
            expect(cardElement).toHaveClass('border-slate-200');

            // Requirement 8.4: White background (bg-white)
            expect(cardElement).toHaveClass('bg-white');

            // Requirement 8.5: Padding (p-4 or larger)
            const hasPadding =
              cardElement.classList.contains('p-4') ||
              cardElement.classList.contains('p-5') ||
              cardElement.classList.contains('p-6') ||
              cardElement.classList.contains('p-8');
            expect(hasPadding).toBe(true);

            // Requirement 8.6: Shadow effect (shadow-sm)
            expect(cardElement).toHaveClass('shadow-sm');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should maintain style consistency with custom className', () => {
      /**
       * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**
       *
       * Property: Even when custom className is provided, all required CSS classes
       * should still be applied to the Card component.
       */
      fc.assert(
        fc.property(
          fc.string().filter((s) => s.length > 0 && s.length < 50),
          (customClassName) => {
            const { container } = render(
              <Card className={customClassName}>
                <div>Test content</div>
              </Card>,
            );

            const cardElement = container.firstChild as HTMLElement;

            // All required classes should still be present
            const hasRoundedCorners =
              cardElement.classList.contains('rounded-xl') ||
              cardElement.classList.contains('rounded-2xl');
            expect(hasRoundedCorners).toBe(true);
            expect(cardElement).toHaveClass('border');
            expect(cardElement).toHaveClass('border-slate-200');
            expect(cardElement).toHaveClass('bg-white');
            expect(cardElement).toHaveClass('shadow-sm');

            // Custom className should also be applied
            const classNames = customClassName
              .split(/\s+/)
              .filter((c) => c.length > 0);
            classNames.forEach((className) => {
              expect(cardElement).toHaveClass(className);
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should render children content correctly', () => {
      /**
       * Property: Card component should always render its children content
       * regardless of other props.
       */
      fc.assert(
        fc.property(
          fc.record({
            title: fc.option(fc.string(), { nil: undefined }),
            subtitle: fc.option(fc.string(), { nil: undefined }),
            content: fc.string().filter((s) => s.trim().length > 0),
          }),
          (props) => {
            const { container } = render(
              <Card title={props.title} subtitle={props.subtitle}>
                <div data-testid="card-content">{props.content}</div>
              </Card>,
            );

            const contentElement = container.querySelector(
              '[data-testid="card-content"]',
            );
            expect(contentElement).toBeInTheDocument();
            expect(contentElement?.textContent).toBe(props.content);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should render title and subtitle when provided', () => {
      /**
       * Property: When title or subtitle is provided, they should be rendered
       * in the Card component.
       */
      fc.assert(
        fc.property(
          fc.record({
            title: fc.string().filter((s) => s.trim().length > 0),
            subtitle: fc.string().filter((s) => s.trim().length > 0),
          }),
          (props) => {
            const { container } = render(
              <Card title={props.title} subtitle={props.subtitle}>
                <div>Content</div>
              </Card>,
            );

            // Check title is rendered in h3 element
            const titleElement = container.querySelector('h3');
            expect(titleElement).toBeInTheDocument();
            expect(titleElement?.textContent).toBe(props.title);

            // Check subtitle is rendered in p element
            const subtitleElement = container.querySelector('p');
            expect(subtitleElement).toBeInTheDocument();
            expect(subtitleElement?.textContent).toBe(props.subtitle);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
