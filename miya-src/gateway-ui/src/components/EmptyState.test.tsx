import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('should render title and description', () => {
    const { getByText } = render(
      <EmptyState title="No Data" description="There is no data to display" />,
    );

    expect(getByText('No Data')).toBeInTheDocument();
    expect(getByText('There is no data to display')).toBeInTheDocument();
  });

  it('should render icon when provided', () => {
    const { getByRole } = render(
      <EmptyState
        icon="📭"
        title="Empty Inbox"
        description="You have no messages"
      />,
    );

    const iconElement = getByRole('img', { name: 'Empty state icon' });
    expect(iconElement).toBeInTheDocument();
    expect(iconElement).toHaveTextContent('📭');
  });

  it('should not render icon when not provided', () => {
    const { queryByRole } = render(
      <EmptyState title="No Data" description="There is no data to display" />,
    );

    const iconElement = queryByRole('img', { name: 'Empty state icon' });
    expect(iconElement).not.toBeInTheDocument();
  });

  it('should apply centered layout styles', () => {
    const { container } = render(
      <EmptyState title="No Data" description="There is no data to display" />,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass(
      'flex',
      'flex-col',
      'items-center',
      'justify-center',
    );
  });

  it('should render title with correct styling', () => {
    const { getByText } = render(
      <EmptyState title="No Data" description="There is no data to display" />,
    );

    const title = getByText('No Data');
    expect(title.tagName).toBe('H3');
    expect(title).toHaveClass('text-lg', 'font-semibold', 'text-slate-900');
  });

  it('should render description with correct styling', () => {
    const { getByText } = render(
      <EmptyState title="No Data" description="There is no data to display" />,
    );

    const description = getByText('There is no data to display');
    expect(description.tagName).toBe('P');
    expect(description).toHaveClass('text-sm', 'text-slate-600');
  });
});
