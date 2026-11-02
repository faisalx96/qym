import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '@/api/dashboardTypes';
import { buildColumns } from '../columns';
import { AnalysisCell, passSignalItems, RowActions, rowMenuItems, StatusCell } from '../cells';
import { RunsCtx, type RunsCtxValue } from '../context';
import { baseColumnKey } from '../selection';

/** Runs list rows and columns (review group L1: C028, C133, C115, C223; owner decisions of Oct 31 and Nov 1). */

const CTX: RunsCtxValue = { slug: 'p', listContext: '', metricTypes: {}, modelIndex: {}, owners: {} };

function row(over: Partial<RunRow> = {}): RunRow {
  return {
    run_id: 'r1',
    run_name: 'run-a',
    external_run_id: 'run-a',
    status: 'COMPLETED',
    samples: 1,
    metrics: ['accuracy'],
    owner: { id: 'me', display_name: 'Me', email: 'me@x' },
    analysis_cause_count: 0,
    ...over,
  } as RunRow;
}

function wrap(node: ReactNode, ctx: RunsCtxValue = CTX) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RunsCtx.Provider value={ctx}>{node}</RunsCtx.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ids = (metrics: string[], opts?: Parameters<typeof buildColumns>[4], hidden?: Set<string>) =>
  buildColumns(metrics, new Set(), null, hidden, opts).visible.map((c) => c.id);

describe('runs columns (C028, C223)', () => {
  it('has no Signals column: the signals sit in the Status cell', () => {
    expect(ids(['a', 'b', 'c', 'd'])).not.toContain('signals');
  });

  it('keeps today’s order when more than 3 scores show and no main metric is declared', () => {
    const order = ids(['a', 'b', 'c', 'd'], { withData: { experiment: true, version: true } });
    expect(order.slice(0, 8)).toEqual([
      'run',
      'status',
      'task',
      'model',
      'dataset',
      'time',
      'analysis',
      'metric-a',
    ]);
  });

  it('puts the scores right after Run and Status when 3 or fewer show', () => {
    const order = ids(['a', 'b', 'c']);
    expect(order.slice(0, 10)).toEqual([
      'run',
      'status',
      'metric-a',
      'metric-b',
      'metric-c',
      'time',
      'model',
      'dataset',
      'owner',
      'task',
    ]);
  });

  it('counts only the scores the user shows', () => {
    const hidden = new Set(['metric-d', 'metric-e']);
    expect(ids(['a', 'b', 'c', 'd', 'e'], {}, hidden).slice(2, 5)).toEqual([
      'metric-a',
      'metric-b',
      'metric-c',
    ]);
  });

  it('puts a declared main metric first, with every score after Run and Status', () => {
    const order = ids(['a', 'b', 'c', 'd', 'e'], { mainMetric: 'd' });
    expect(order.slice(0, 7)).toEqual([
      'run',
      'status',
      'metric-d',
      'metric-a',
      'metric-b',
      'metric-c',
      'metric-e',
    ]);
  });

  it('hides Experiment and Version by default when no run in scope has one', () => {
    const order = ids(['a', 'b', 'c', 'd'], { withData: { experiment: false, version: false } });
    expect(order).not.toContain('experiment');
    expect(order).not.toContain('version');
    const shown = ids(['a', 'b', 'c', 'd'], { withData: { experiment: true, version: false } });
    expect(shown).toContain('experiment');
    expect(shown).not.toContain('version');
  });

  it('a saved choice still wins over the default', () => {
    const saved = buildColumns(['a'], new Set(), new Set([baseColumnKey('experiment')]), null, {
      withData: { experiment: false, version: false },
    });
    expect(saved.visible.map((c) => c.id)).toContain('experiment');
  });

  it('the Actions column is one narrow row menu column', () => {
    const set = buildColumns(['a'], new Set(), null);
    const actions = set.visible.find((c) => c.id === 'actions')!;
    expect(actions.width).toBeLessThanOrEqual(48);
  });
});

describe('the Status cell carries the signals (C028, C115)', () => {
  it('shows each signal with its count and today’s colour, linking to the run’s Errors section', () => {
    wrap(<StatusCell row={row({ task_error_count: 91, metric_error_count: 22, total_retries: 3 })} />);
    const task = screen.getByRole('link', { name: '91 task errors across all items' });
    expect(task).toHaveAttribute('href', '/projects/p/runs/r1#errors');
    expect(task).toHaveAttribute('data-tone', 'error');
    expect(task).toHaveTextContent('91');
    expect(screen.getByRole('link', { name: '22 metric errors across all items' })).toHaveAttribute(
      'data-tone',
      'metric',
    );
    expect(screen.getByRole('link', { name: '3 total retries across all items' })).toHaveAttribute(
      'data-tone',
      'info',
    );
  });

  it('a task error is red at any share: no threshold, no grey', () => {
    wrap(
      <StatusCell
        row={row({ task_error_count: 1, metric_error_count: 0, execution_count: 1000 } as Partial<RunRow>)}
      />,
    );
    expect(screen.getByRole('link', { name: '1 task error across all items' })).toHaveAttribute(
      'data-tone',
      'error',
    );
  });

  it('a clean run shows only its status', () => {
    wrap(<StatusCell row={row({ task_error_count: 0, metric_error_count: 0 })} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('pass rows use the same markers', () => {
    expect(passSignalItems({ task_error_count: 2, metric_error_count: 1, retry_count: 1 } as never)).toEqual([
      expect.objectContaining({ key: 'task', glyph: '⚠', tone: 'error', count: 2 }),
      expect.objectContaining({ key: 'metric', glyph: '⚠', tone: 'metric', count: 1 }),
      expect.objectContaining({ key: 'retry', glyph: '↻', tone: 'info', count: 1 }),
    ]);
  });
});

describe('Analysis shows only causes or a running analysis (C133)', () => {
  it('an idle run shows nothing to start here', () => {
    wrap(<AnalysisCell row={row()} />);
    expect(screen.queryByTestId('analyze-action')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('a run with causes keeps its link', () => {
    wrap(<AnalysisCell row={row({ analysis_cause_count: 5 })} />);
    expect(screen.getByTestId('analyze-action')).toHaveTextContent('5 causes');
  });

  it('a running analysis keeps its link', () => {
    wrap(<AnalysisCell row={row()} />, { ...CTX, analyzing: new Set(['r1']) });
    expect(screen.getByTestId('analyze-action')).toHaveTextContent('Analyzing');
  });
});

describe('row actions sit in one menu behind the row handle (owner, Nov 1)', () => {
  const owner = { readOnly: false, canManage: false, isAdmin: false, meId: 'me' };
  const manager = { readOnly: false, canManage: true, isAdmin: false, meId: 'other' };

  it('the owner of a finished run gets auto-analysis, Submit and Delete', () => {
    const items = rowMenuItems(row(), owner);
    expect(items.map((i) => i.id)).toEqual(['analyze', 'submit', 'delete']);
    expect(items[0]).toMatchObject({ label: 'Open auto-analysis', tone: 'meta' });
    expect(items[1]).toMatchObject({ label: 'Submit' });
    expect(items[2]).toMatchObject({ label: 'Delete', tone: 'danger', separatorBefore: true });
  });

  it('a manager on a submitted run gets the review items and Transfer ownership', () => {
    const items = rowMenuItems(row({ status: 'SUBMITTED' }), manager);
    expect(items.map((i) => i.label)).toEqual([
      'Open auto-analysis',
      'Approve',
      'Reject',
      'Transfer ownership',
      'Delete',
    ]);
  });

  it('a manager submitting for someone else sees on whose behalf', () => {
    const [, submit] = rowMenuItems(row(), manager);
    expect(submit).toMatchObject({ id: 'submit', description: 'On behalf of Me' });
  });

  it('a live run has nothing to analyse yet', () => {
    expect(rowMenuItems(row({ status: 'RUNNING' }), owner).map((i) => i.id)).toEqual(['delete']);
  });

  it('a viewer gets only auto-analysis', () => {
    expect(rowMenuItems(row(), { ...owner, readOnly: true }).map((i) => i.id)).toEqual(['analyze']);
  });

  it('the handle opens the menu, and each item keeps its tile', async () => {
    const onAction = vi.fn();
    wrap(<RowActions row={row()} perm={owner} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for run-a' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Open auto-analysis', 'Submit', 'Delete']);
    expect(items[0]!.querySelector('[data-tile][data-tone="meta"]')).not.toBeNull();
    expect(items[1]!.querySelector('[data-tile][data-tone="default"]')).not.toBeNull();
    expect(items[2]!.querySelector('[data-tile][data-tone="danger"]')).not.toBeNull();
    await userEvent.click(items[1]!);
    expect(onAction).toHaveBeenCalledWith('submit', expect.objectContaining({ run_id: 'r1' }));
  });
});
