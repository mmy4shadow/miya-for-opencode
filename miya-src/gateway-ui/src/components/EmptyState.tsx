import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
}

/**
 * EmptyState component for displaying friendly empty state messages.
 *
 * Used when there is no data to display, providing clear feedback
 * to the user as per requirement 8.7.
 *
 * @param icon - Optional emoji or icon to display
 * @param title - Main title for the empty state
 * @param description - Descriptive text explaining the empty state
 */
export const EmptyState = React.memo<EmptyStateProps>(function EmptyState({
  icon,
  title,
  description,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && (
        <div className="text-6xl mb-4" role="img" aria-label="Empty state icon">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 max-w-md">{description}</p>
    </div>
  );
});
