import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkeletonLoader } from './SkeletonLoader';

describe('SkeletonLoader', () => {
  it('should render card type skeleton', () => {
    const { container } = render(<SkeletonLoader type="card" />);
    const cardSkeleton = container.querySelector('.rounded-2xl');
    expect(cardSkeleton).toBeInTheDocument();
    expect(cardSkeleton).toHaveClass('animate-pulse');
  });

  it('should render multiple card skeletons when count is specified', () => {
    const { container } = render(<SkeletonLoader type="card" count={3} />);
    const cardSkeletons = container.querySelectorAll('.rounded-2xl');
    expect(cardSkeletons).toHaveLength(3);
  });

  it('should render list type skeleton', () => {
    const { container } = render(<SkeletonLoader type="list" />);
    const listItems = container.querySelectorAll('.rounded-lg');
    expect(listItems.length).toBeGreaterThan(0);
  });

  it('should render multiple list items when count is specified', () => {
    const { container } = render(<SkeletonLoader type="list" count={5} />);
    const listItems = container.querySelectorAll('.rounded-lg');
    expect(listItems).toHaveLength(5);
  });

  it('should render text type skeleton', () => {
    const { container } = render(<SkeletonLoader type="text" />);
    const textSkeletons = container.querySelectorAll('.h-4.bg-slate-200');
    expect(textSkeletons.length).toBeGreaterThan(0);
  });

  it('should render multiple text lines when count is specified', () => {
    const { container } = render(<SkeletonLoader type="text" count={4} />);
    const textSkeletons = container.querySelectorAll('.h-4.bg-slate-200');
    expect(textSkeletons).toHaveLength(4);
  });

  it('should default to count of 1 when not specified', () => {
    const { container } = render(<SkeletonLoader type="card" />);
    const cardSkeletons = container.querySelectorAll('.rounded-2xl');
    expect(cardSkeletons).toHaveLength(1);
  });
});
