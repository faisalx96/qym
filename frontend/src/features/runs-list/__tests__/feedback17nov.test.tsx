import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { RunPass, RunRow } from '@/api/dashboardTypes';
import { MetricCell, runProgress, RunNameCell, StatusCell, TraceStatCell } from '../cells';
import { RunsCtx, type RunsCtxValue } from '../context';
import { PassMetricCell, PassNameCell, PassStatus } from '../passes/PassCells';
import { runRowState, type TableRow } from '../passes/rows';

/** Runs list feedback of 17 Nov (R2 to R8). */

const CTX: RunsCtxValue = {
  slug: 'p',
  listContext: '',
  metricTypes: { quality: 'score' },
  modelIndex: {},
  owners: {},
};

function row(over: Partial<RunRow> = {}): RunRow {
  return {
    run_id: 'r1',
    run_name: 'run-a',
    external_run_id: 'run-a',
    status: 'COMPLETED',
    samples: 1,
    metrics: ['quality'],
    metric_specs: { quality: { score_type: 'percentage', direction: 'maximize' } },
    owner: { id: 'me', display_name: 'Me', email: 'me@x' },
    ...over,
  } as RunRow;
}

function pass(over: Partial<RunPass> = {}): RunPass {
  return {
    pass_number: 2,
    status: 'completed',
    metric_means: { quality: 0.626 },
    items_scored: 20,
    items_total: 24,
    completed_count: 20,
    error_count: 0,
    task_error_count: 0,
    metric_error_count: 0,
    metric_error_counts: {},
    retry_count: 0,
    avg_latency_ms: null,
    median_latency_ms: null,
    p95_latency_ms: null,
    started_at: null,
    ended_at: null,
    duration_ms: null,
    trace_stats: null,
    ...over,
  };
}

function wrap(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RunsCtx.Provider value={CTX}>{node}</RunsCtx.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('R2: the ×N pass count', () => {
  it('takes the runs-list class on the count Tag (brighter fill, smaller box)', () => {
    wrap(<RunNameCell row={row({ samples: 10 })} />);
    const tag = screen.getByText('×10');
    expect(tag).toHaveAttribute('data-kind', 'count');
    expect(tag.className).toMatch(/passCount/);
  });
});

describe('R3: a running repeat run counts passes, a running pass counts items', () => {
  it('a repeat run: the pass now running out of the passes, the bar by item passes', () => {
    expect(
      runProgress(row({ samples: 3, last_completed_pass: 1, pass_items_completed: 34, pass_items_total: 72 })),
    ).toEqual({
      done: 2,
      total: 3,
      fraction: 34 / 72,
      unit: 'pass',
      title: 'pass 2 of 3 running · 1 of 3 passes done · 34 of 72 items done across all passes',
    });
    // a single-pass run counts its items, with no unit word
    expect(runProgress(row({ progress_completed: 30, progress_total: 50 }))).toEqual({
      done: 30,
      total: 50,
      fraction: 0.6,
      unit: null,
      title: '',
    });
    // a summary published before the item-pass fields: the bar fills by completed passes
    expect(runProgress(row({ samples: 3, last_completed_pass: 1 }))).toMatchObject({
      done: 2,
      total: 3,
      fraction: 1 / 3,
      title: 'pass 2 of 3 running · 1 of 3 passes done',
    });
    // never past the last pass
    expect(runProgress(row({ samples: 3, last_completed_pass: 3 }))).toMatchObject({ done: 3, total: 3, fraction: 1 });
  });

  it('a running repeat run: Running, the bar, then "pass 2/3"', () => {
    const { container } = wrap(
      <StatusCell
        row={row({
          status: 'RUNNING',
          samples: 3,
          last_completed_pass: 1,
          pass_items_completed: 34,
          pass_items_total: 72,
        })}
      />,
    );
    expect(screen.getByText('Running')).toBeInTheDocument();
    const progress = screen.getByLabelText('pass 2 of 3, progress 47 percent');
    expect(progress).toHaveTextContent(/^pass 2\/3$/);
    expect(container.querySelector('[class*="progressFill"]')).toHaveStyle({ width: '47%' });
    expect(screen.queryByText('34/72')).toBeNull();
    expect(container.querySelector('[title*="34 of 72 items done"]')).not.toBeNull();
  });

  it('a running single-pass run keeps done/total with no unit word', () => {
    wrap(<StatusCell row={row({ status: 'RUNNING', progress_completed: 30, progress_total: 50 })} />);
    expect(screen.getByLabelText('Progress 60 percent')).toHaveTextContent(/^30\/50$/);
  });

  it('a running pass: the bar and "items done/total" in Status, no progress text by the name', () => {
    const run = row({ status: 'RUNNING', samples: 3 });
    const p = pass({ status: 'running', completed_count: 10, items_total: 24 });
    const { container } = wrap(
      <>
        <PassNameCell run={run} pass={p} />
        <PassStatus run={run} pass={p} status="running" />
      </>,
    );
    expect(screen.getByLabelText('Pass 2, items 10 of 24, progress 42 percent')).toHaveTextContent(
      /^items 10\/24$/,
    );
    expect(container.querySelector('[class*="passName"]')).not.toHaveTextContent(/items|%/);
  });

  it('a finished pass shows no bar', () => {
    const { container } = wrap(<PassStatus run={row({ samples: 3 })} pass={pass()} status="completed" />);
    expect(container.querySelector('[class*="progressTrack"]')).toBeNull();
  });
});

describe('R4: Tool success is banded like a score', () => {
  it('colours the rate with the score bands; the other trace stats stay plain numbers', () => {
    const { container } = wrap(
      <>
        <TraceStatCell stat="tool_success_rate" value={0.65} />
        <TraceStatCell stat="avg_tokens" value={320} />
        <TraceStatCell stat="tool_success_rate" value={undefined} />
      </>,
    );
    const rate = screen.getByText('65.0%').closest('[data-band]');
    expect(rate).not.toBeNull();
    expect(rate).toHaveAttribute('data-variant', 'plain');
    expect(screen.getByText('320').closest('[data-band]')).toBeNull();
    expect(container).toHaveTextContent('—');
  });
});

describe('R5: a mean with metric errors shows the mean with the marker', () => {
  it('a run with some scorer errors shows its value, not Error', () => {
    wrap(
      <MetricCell
        row={row({ metric_averages: { quality: 0.641 }, metric_error_counts: { quality: 2 } })}
        metric="quality"
      />,
    );
    expect(screen.getByText('64.1%')).toBeInTheDocument();
    expect(screen.queryByText('Error')).toBeNull();
    expect(screen.getByRole('button', { name: /2 quality scorer errors|scorer error/ })).toBeInTheDocument();
  });

  it('shows Error only when no value exists', () => {
    wrap(
      <MetricCell
        // the summary sends null for a metric whose every score errored; the type says number
        row={row({ metric_averages: { quality: null as unknown as number }, metric_error_counts: { quality: 20 } })}
        metric="quality"
      />,
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('a pass: the mean with the marker; Error only without a mean', () => {
    const run = row({ samples: 3 });
    const { unmount } = wrap(
      <PassMetricCell run={run} pass={pass({ metric_error_counts: { quality: 4 } })} metric="quality" />,
    );
    expect(screen.getByText('62.6%')).toBeInTheDocument();
    expect(screen.queryByText('Error')).toBeNull();
    unmount();
    wrap(
      <PassMetricCell
        run={run}
        pass={pass({ metric_means: { quality: null }, metric_error_counts: { quality: 24 } })}
        metric="quality"
      />,
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
  });
});

describe('R6: no live rail', () => {
  it('only a failed run gets a row state', () => {
    const r = (status: RunRow['status']): TableRow => ({ kind: 'run', key: 'r1', row: row({ status }) });
    expect(runRowState(r('RUNNING'))).toBeUndefined();
    expect(runRowState(r('PENDING'))).toBeUndefined();
    expect(runRowState(r('COMPLETED'))).toBeUndefined();
    expect(runRowState(r('FAILED'))).toBe('error');
    const running = row({ status: 'RUNNING', samples: 3 });
    expect(
      runRowState({ kind: 'pass', key: 'r1::2', run: running, pass: pass({ status: 'running' }), status: 'running' }),
    ).toBeUndefined();
  });
});

describe('R9: the Status cell keeps its content width', () => {
  it('marks the run and pass status cells for the column fit', () => {
    const { container } = wrap(
      <>
        <StatusCell row={row({ status: 'RUNNING', progress_completed: 3, progress_total: 9 })} />
        <PassStatus run={row({ samples: 3 })} pass={pass()} status="completed" />
      </>,
    );
    expect(container.querySelectorAll('[data-status-fit]')).toHaveLength(2);
  });
});
