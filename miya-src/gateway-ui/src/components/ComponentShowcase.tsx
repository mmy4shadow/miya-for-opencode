import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { SkeletonLoader } from './SkeletonLoader';

/**
 * Component showcase for demonstrating the shared UI components.
 * This file is for development/documentation purposes only.
 */
export function ComponentShowcase() {
  return (
    <div className="p-8 space-y-8 bg-slate-50 min-h-screen">
      <h1 className="text-3xl font-bold text-slate-900">
        Shared UI Components
      </h1>

      {/* Card Component */}
      <section>
        <h2 className="text-2xl font-semibold text-slate-800 mb-4">
          Card Component
        </h2>
        <div className="space-y-4">
          <Card title="Basic Card" subtitle="With title and subtitle">
            <p className="text-slate-700">This is the card content.</p>
          </Card>

          <Card>
            <p className="text-slate-700">Card without title or subtitle.</p>
          </Card>
        </div>
      </section>

      {/* SkeletonLoader Component */}
      <section>
        <h2 className="text-2xl font-semibold text-slate-800 mb-4">
          SkeletonLoader Component
        </h2>

        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium text-slate-700 mb-2">
              Card Type
            </h3>
            <SkeletonLoader type="card" count={2} />
          </div>

          <div>
            <h3 className="text-lg font-medium text-slate-700 mb-2">
              List Type
            </h3>
            <SkeletonLoader type="list" count={3} />
          </div>

          <div>
            <h3 className="text-lg font-medium text-slate-700 mb-2">
              Text Type
            </h3>
            <SkeletonLoader type="text" count={4} />
          </div>
        </div>
      </section>

      {/* EmptyState Component */}
      <section>
        <h2 className="text-2xl font-semibold text-slate-800 mb-4">
          EmptyState Component
        </h2>

        <div className="space-y-4">
          <Card>
            <EmptyState
              icon="📭"
              title="No Messages"
              description="You don't have any messages yet. Check back later."
            />
          </Card>

          <Card>
            <EmptyState
              icon="🔍"
              title="No Results Found"
              description="We couldn't find any results matching your search criteria. Try adjusting your filters."
            />
          </Card>

          <Card>
            <EmptyState
              title="Empty State Without Icon"
              description="This empty state doesn't have an icon, which is also supported."
            />
          </Card>
        </div>
      </section>
    </div>
  );
}
