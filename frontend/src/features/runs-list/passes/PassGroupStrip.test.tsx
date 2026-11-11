/**
 * Round 7 (Q2): the strip asks for `view=group` (no bootstrap curve) and its loading frame is its own layout: the real
 * labels, select and threshold with skeleton values, so the group keeps its height when the numbers arrive.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import { createQueryClient } from '@/app/queryClient';
import { runKeys } from '@/api/dashboard';
import type { RunRow } from '@/api/dashboardTypes';
import { groupChoiceFor, summaryPasses } from './groupQuery';
import { PassGroupStrip } from './PassGroupStrip';

const waiting: Array<{ url: string; resolve: (v: unknown) => void }> = [];
vi.mock('@/lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(
        (url: string) =>
          new Promise((resolve) => {
            waiting.push({ url, resolve });
          }),
      ),
    },
  };
});

const row = {
  run_id: 'run-1',
  run_name: 'run-1',
  model_key: 'm',
  timestamp: '2026-10-01T00:00:00Z',
  metrics: ['correct', 'quality'],
  metric_specs: {
    correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, primary: true },
    quality: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7 },
  },
  metric_averages: { correct: 1, quality: 0.6 },
  samples: 10,
  total_items: 300,
  status: 'COMPLETED',
} as unknown as RunRow;

const group = {
  k: 10,
  report_k: null,
  threshold: 0.9999,
  total_items: 300,
  pass_at_k: 0.9,
  pass_hat_k: 0.5,
  avg_at_k: 0.7,
  max_at_k: 0.9,
  consistency: 0.8,
  reliability: 0.55,
};

function wrap(qc = createQueryClient()) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  waiting.length = 0;
});

describe('PassGroupStrip', () => {
  it('asks for view=group with the metric and threshold groupChoiceFor names', async () => {
    const { qc, Wrapper } = wrap();
    render(<PassGroupStrip row={row} remembered={null} onMetric={() => undefined} />, { wrapper: Wrapper });
    const q = groupChoiceFor(row, null, {});
    const url = `/api/runs/run-1/group-metrics?metric=${q.metric}&threshold=${q.threshold}&view=group`;
    expect(waiting.map((w) => w.url)).toContain(url);
    expect(
      qc.getQueryCache().find({ queryKey: runKeys.groupMetrics('run-1', q.metric!, q.threshold, 'group') }),
    ).toBeDefined();
    // the run page's full curve is a different entry
    expect(
      qc.getQueryCache().find({ queryKey: runKeys.groupMetrics('run-1', q.metric!, q.threshold) }),
    ).toBeUndefined();
  });

  it('renders its own layout with skeleton values while the passes and statistics load', () => {
    const { Wrapper } = wrap();
    render(<PassGroupStrip row={row} remembered={null} onMetric={() => undefined} />, { wrapper: Wrapper });
    const strip = screen.getByRole('group', { name: 'Group metrics' });
    expect(strip).toHaveAttribute('aria-busy', 'true');
    // the title, the five labels and the metric select are real from the first frame
    expect(within(strip).getByText('Passes')).toBeInTheDocument();
    expect(within(strip).getByText('10 · 300 items')).toBeInTheDocument();
    const labels = Array.from(strip.querySelectorAll('dl[aria-busy] dt')).map((d) => d.textContent);
    expect(labels).toEqual(['Pass@10', 'Pass^10', 'Avg@10', 'Consistency', 'Reliability']);
    // the five skeleton values (the threshold slider's <output> is a status too, outside the statistics)
    const stats = strip.querySelector<HTMLElement>('dl[aria-busy]')!;
    expect(within(stats).getAllByRole('status')).toHaveLength(5);
    expect(within(strip).getByRole('slider', { name: /^Pass if ≥/ })).toBeInTheDocument();
    expect(strip.querySelectorAll('dd')).toHaveLength(5 + 5); // five skeleton values + the five help definitions
  });

  it('replaces the skeletons with the statistics and clears aria-busy', async () => {
    const { Wrapper } = wrap();
    render(<PassGroupStrip row={row} remembered={null} onMetric={() => undefined} />, { wrapper: Wrapper });
    await act(async () => {
      for (const w of waiting.splice(0))
        w.resolve(
          w.url.includes('/passes')
            ? { run_id: 'run-1', samples: 10, metrics: ['correct', 'quality'], passes: [] }
            : {
                run_id: 'run-1',
                metric: 'correct',
                direction: 'maximize',
                threshold: 0.9999,
                samples: 10,
                report_k: null,
                group,
              },
        );
    });
    const strip = screen.getByRole('group', { name: 'Group metrics' });
    await waitFor(() => expect(strip).not.toHaveAttribute('aria-busy'));
    expect(within(strip.querySelector<HTMLElement>('dl')!).queryAllByRole('status')).toHaveLength(0);
    expect(within(strip).getByText('90.0%')).toBeInTheDocument(); // Pass@10
    expect(within(strip).getByText('55.0%')).toBeInTheDocument(); // Reliability
  });

  it('C023: a finished run opens on its summary with no request, and asks only for another threshold', async () => {
    const pass = {
      status: 'completed',
      primary_metric: 'correct',
      primary_score: 1,
      error_count: 0,
      task_error_count: 0,
      metric_error_count: 0,
      metric_error_counts: {},
      retry_count: 0,
      analysis_cause_count: 0,
    };
    const detail = {
      metric_means: { correct: 1, quality: 0.6 },
      items_scored: 300,
      items_total: 300,
      completed_count: 300,
      avg_latency_ms: 10,
      median_latency_ms: 9,
      p95_latency_ms: 20,
      started_at: null,
      ended_at: null,
      duration_ms: 1000,
      trace_stats: null,
    };
    const settled = {
      ...row,
      pass_summaries: [{ ...pass, pass_number: 1 }],
      pass_details: [{ ...detail, pass_number: 1 }],
      pass_groups: { correct: { threshold: 1, group }, quality: { threshold: 0.7, group } },
    } as unknown as RunRow;
    expect(summaryPasses(settled)?.passes[0]).toMatchObject({
      pass_number: 1,
      completed_count: 300,
      retry_count: 0,
    });
    expect(summaryPasses(row)).toBeUndefined();
    const { Wrapper } = wrap();
    render(<PassGroupStrip row={settled} remembered={null} onMetric={() => undefined} />, {
      wrapper: Wrapper,
    });
    const strip = screen.getByRole('group', { name: 'Group metrics' });
    expect(strip).not.toHaveAttribute('aria-busy');
    expect(within(strip).getByText('90.0%')).toBeInTheDocument();
    expect(waiting).toHaveLength(0);
    // another threshold than the summary's is a real question for the server
    const slider = within(strip).getByRole('slider', { name: /^Pass if ≥/ });
    act(() => {
      slider.focus();
    });
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    await waitFor(() => expect(waiting.some((w) => w.url.includes('/group-metrics'))).toBe(true));
    expect(waiting.some((w) => w.url.includes('/passes'))).toBe(false);
  });
});
