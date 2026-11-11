/** C129: the note under the Items bar for a page metric with no declared direction, and its two buttons. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();
let canManage = true;
let source: 'assumed' | 'project' | 'declared' = 'assumed';
let direction: 'maximize' | 'minimize' = 'maximize';
vi.mock('@/api/projects', () => ({ useSetMetricDirection: () => ({ mutate, isPending: false }) }));
vi.mock('@/features/shell', () => ({
  useProjectContext: () => ({ project: { id: 'p1', slug: 'p' }, canManage, readOnly: false }),
}));
vi.mock('../../RunContext', () => ({
  useRunPage: () => ({
    model: {
      metricDirectionSource: { correctness: source },
      metricDirections: { correctness: direction },
    },
  }),
}));

import { ToastProvider } from '@/ui';
import { DirectionNote } from './DirectionNote';

describe('DirectionNote', () => {
  it('says higher is better is assumed, and a manager saves the other choice for the project', () => {
    source = 'assumed';
    direction = 'maximize';
    canManage = true;
    mutate.mockReset();
    render(
      <ToastProvider>
        <DirectionNote metric="correctness" />
      </ToastProvider>,
    );
    expect(screen.getByTestId('direction-note')).toHaveTextContent(
      'Direction not set, so higher is better is assumed.',
    );
    expect(screen.getByRole('button', { name: 'Higher is better' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Lower is better' }));
    expect(mutate.mock.calls[0]![0]).toEqual({ metric: 'correctness', direction: 'minimize' });
  });

  it('after a save it names the project choice; a member sees the buttons locked, with why', () => {
    source = 'project';
    direction = 'minimize';
    canManage = false;
    render(
      <ToastProvider>
        <DirectionNote metric="correctness" />
      </ToastProvider>,
    );
    expect(screen.getByTestId('direction-note')).toHaveTextContent(
      'This project reads correctness as lower is better.',
    );
    expect(screen.getByRole('button', { name: 'Lower is better' })).toBeDisabled();
    expect(screen.getByTestId('direction-note')).toHaveTextContent('Only project managers');
  });

  it('shows nothing for a metric that declares its direction', () => {
    source = 'declared';
    render(
      <ToastProvider>
        <DirectionNote metric="correctness" />
      </ToastProvider>,
    );
    expect(screen.queryByTestId('direction-note')).toBeNull();
  });
});
