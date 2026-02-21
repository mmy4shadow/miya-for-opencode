import React from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Card component for displaying information modules with consistent styling.
 *
 * Applies card layout styles as per requirements 8.1-8.6:
 * - Rounded corners (rounded-2xl)
 * - Border (border border-slate-200)
 * - White background (bg-white)
 * - Padding (p-4)
 * - Shadow effect (shadow-sm)
 */
export const Card = React.memo<CardProps>(function Card({
  title,
  subtitle,
  children,
  className = '',
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}
    >
      {(title || subtitle) && (
        <div className="mb-3">
          {title && (
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          )}
          {subtitle && (
            <p className="text-sm text-slate-600 mt-1">{subtitle}</p>
          )}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
});
