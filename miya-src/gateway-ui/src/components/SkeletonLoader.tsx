import React from 'react';

interface SkeletonLoaderProps {
  type: 'card' | 'list' | 'text';
  count?: number;
}

/**
 * SkeletonLoader component for displaying loading placeholders.
 *
 * Used during initial data loading to provide visual feedback
 * as per requirement 12.6.
 *
 * @param type - The type of skeleton to display (card, list, or text)
 * @param count - Number of skeleton items to render (default: 1)
 */
export const SkeletonLoader = React.memo<SkeletonLoaderProps>(
  function SkeletonLoader({ type, count = 1 }) {
    const items = Array.from({ length: count }, (_, i) => i);

    if (type === 'card') {
      return (
        <div className="space-y-4">
          {items.map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm animate-pulse"
            >
              <div className="h-6 bg-slate-200 rounded w-1/3 mb-3"></div>
              <div className="h-4 bg-slate-200 rounded w-2/3 mb-2"></div>
              <div className="h-4 bg-slate-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      );
    }

    if (type === 'list') {
      return (
        <div className="space-y-2">
          {items.map((i) => (
            <div
              key={i}
              className="flex items-center space-x-3 p-3 rounded-lg bg-slate-50 animate-pulse"
            >
              <div className="h-10 w-10 bg-slate-200 rounded-full"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                <div className="h-3 bg-slate-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // type === 'text'
    return (
      <div className="space-y-2">
        {items.map((i) => (
          <div key={i} className="h-4 bg-slate-200 rounded animate-pulse"></div>
        ))}
      </div>
    );
  },
);
