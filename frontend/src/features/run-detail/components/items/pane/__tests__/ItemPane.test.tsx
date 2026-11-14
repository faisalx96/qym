/**
 * The item pane of the run page: the approved order of its parts, platform primitives for each state, and the keys
 * (Escape, J / K). The loading frame has its own test (PaneSkeleton.test.tsx).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';
import { effectiveThresholds, type FilterContext } from '../../../../lib/filterRules';
import { buildRunModel } from '../../../../lib/runModel';
import type { Row, RunPayload } from '../../../../types';
import { ItemsUi, type ItemsUiValue } from '../../ItemsUi';

let current: ReturnType<typeof makeContext>;
vi.mock('../../../../RunContext', () => ({ useRunPage: () => current }));
vi.mock('@/api/runs', () => ({
  useUpdateMetric: () => ({ mutate: vi.fn(), isPending: false }),
  useIssueAction: () => ({ mutate: vi.fn(), isPending: false }),
  useCategoryCatalogQuery: () => ({ data: undefined }),
  useIssueBlocksQuery: () => ({ data: undefined }),
}));

import { ItemPane } from '../ItemPane';

const specs = {
  resolution: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.7, schema_version: 2 },
  tone: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.6, schema_version: 2 },
};
const names = Object.keys(specs);

const row = (index: number, over: Partial<Row> = {}): Row =>
  ({
    index,
    item_id: `tkt-${index + 1}`,
    status: 'completed',
    input: JSON.stringify({ channel: 'chat', message: `Question ${index + 1}` }),
    expected: 'Refunds take 3 days',
    output: 'Refunds take 7 days',
    latency_ms: 1200,
    metric_values: [0.5, 0.9],
    metric_meta: {
      resolution: { reason: 'The timeline is wrong', judge: 'gpt-4.1' },
      tone: { reason: 'Polite' },
    },
    item_metadata: { lang: 'en' },
    ...over,
  }) as Row;

function makeContext(rows: Row[], lazy = false) {
  const payload = {
    run: { run_id: 'r', status: 'COMPLETED', samples: 1, metric_names: names, metric_specs: specs },
    snapshot: { rows, metric_names: names, metric_specs: specs, detail_mode: lazy ? 'lazy' : 'full' },
  } as unknown as RunPayload;
  const model = buildRunModel(payload, null);
  const ctx: FilterContext = {
    model,
    thresholds: effectiveThresholds(model, { metric: null, threshold: null }),
    selectedMetric: model.defaultMetric,
    repeatAggregate: false,
  };
  return {
    runId: 'r',
    slug: 'p',
    payload,
    model,
    api: { ctx, selectedMetric: model.defaultMetric, view: { page: 1 }, setItemParam: vi.fn() },
    readOnly: false,
    scoresLocked: false,
    basePath: '/projects/p/runs/r',
  };
}

function show(rows: Row[], { lazy = false, loadError = false } = {}) {
  current = makeContext(rows, lazy);
  const toggleExpanded = vi.fn();
  const openTrace = vi.fn();
  const ui = {
    textMode: 'raw',
    hiddenFields: new Set<string>(),
    hiddenMetricFields: new Set<string>(),
    details: {
      ensure: () => (lazy ? new Promise(() => {}) : Promise.resolve()),
      retry: vi.fn(),
      stateOf: () => (loadError ? { status: 'error', error: new Error('boom') } : undefined),
    },
    expanded: new Set([rows[0]!.item_id]),
    toggleExpanded,
    highlight: null,
    openTrace,
    scrollTarget: null,
    requestScroll: vi.fn(),
    clearScroll: vi.fn(),
  } as unknown as ItemsUiValue;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <ItemsUi.Provider value={ui}>
            <ItemPane openId={rows[0]!.item_id} rows={rows} />
          </ItemsUi.Provider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { toggleExpanded, openTrace, pane: screen.getByTestId('item-pane') };
}

const partsOf = (pane: HTMLElement, wanted: string[]) =>
  Array.from(pane.querySelectorAll('[data-part]'))
    .map((n) => n.getAttribute('data-part')!)
    .filter((x) => wanted.includes(x));

describe('ItemPane', () => {
  it('shows the parts in the approved order: Input, Expected beside Output, Metrics, Execution, Metadata', () => {
    const { pane } = show([row(0), row(1)]);
    expect(pane.getAttribute('aria-label')).toBe('Item #1');
    expect(
      partsOf(pane, ['input', 'expected', 'output', 'metrics-section', 'execution', 'metadata']),
    ).toEqual(['input', 'expected', 'output', 'metrics-section', 'execution', 'metadata']);
    // Expected is gold; the output of a failed item is red
    expect(pane.querySelector('[data-part="expected"]')!.getAttribute('data-tone')).toBe('gold');
    expect(pane.querySelector('[data-part="output"]')!.getAttribute('data-tone')).toBe('danger');
    // the header: the number, the verdict as a state tag, the id, the prompt as the title
    expect(within(pane).getByText('#1')).toBeTruthy();
    expect(within(pane).getByRole('heading', { level: 3, name: 'Question 1' })).toBeTruthy();
    expect(within(pane).getByText('1', { selector: 'nav span span' })).toBeTruthy();
  });

  it('has a metrics table with the pass-if text, the reason and a failed count tag', () => {
    const { pane } = show([row(0)]);
    const table = within(pane).getByRole('table', { name: 'Metrics' });
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads.slice(0, 4)).toEqual(['Metric', 'Score', 'Pass if', 'Reason']);
    expect(within(table).getByText('≥70%')).toBeTruthy();
    expect(within(table).getByText('The timeline is wrong')).toBeTruthy();
    expect(pane.querySelector('[data-count="failed"]')!.textContent).toBe('1 failed');
    // the details of a metric are closed until the reader opens them
    expect(pane.querySelector('[data-part="metric-details"]')).toBeNull();
    fireEvent.click(within(pane).getByRole('button', { name: 'Show the details of resolution' }));
    expect(pane.querySelector('[data-part="metric-details"]')!.textContent).toContain('gpt-4.1');
  });

  it('opens the platform score editor with a hint for the row in edit', () => {
    const { pane } = show([row(0)]);
    fireEvent.click(within(pane).getByRole('button', { name: 'Edit the resolution score' }));
    const form = within(pane).getByRole('form', { name: 'Edit resolution score' });
    expect(within(form).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(pane).getByText('Enter a value from 0 to 1, or 0% to 100%.')).toBeTruthy();
  });

  it('switches one block to raw JSON and leaves the others', () => {
    const { pane } = show([row(0, { output: JSON.stringify({ answer: 'Seven days', days: 7 }) })]);
    const input = pane.querySelector<HTMLElement>('[data-part="input"]')!;
    fireEvent.click(within(input).getByRole('button', { name: 'Show the raw JSON' }));
    expect(input.querySelector('pre[data-lang="json"]')).not.toBeNull();
    expect(pane.querySelector('[data-part="output"] pre[data-lang="json"]')).toBeNull();
    expect(pane.querySelector('[data-part="output"] dl')).not.toBeNull();
  });

  it('shows a task error in the Output block and no scores', () => {
    const { pane } = show([row(0, { status: 'error', error: 'ValidationError: bad amount', output: '' })]);
    const output = pane.querySelector<HTMLElement>('[data-part="output"]')!;
    expect(output.getAttribute('data-tone')).toBe('danger');
    expect(within(output).getByText(/The task failed before it gave an output/)).toBeTruthy();
    expect(within(output).getByText('ValidationError: bad amount')).toBeTruthy();
    expect(within(pane).getByText('No scores: this item gave no output to score')).toBeTruthy();
  });

  it('shows the platform error state with Retry when the item did not load', () => {
    const { pane } = show([row(0)], { lazy: true, loadError: true });
    const alert = within(pane).getByRole('alert');
    expect(alert.textContent).toContain('Couldn’t load this item');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('closes on Escape and steps with J', () => {
    const { toggleExpanded } = show([row(0), row(1)]);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'j' });
    });
    expect(toggleExpanded).toHaveBeenCalledWith('tkt-2', true);
    toggleExpanded.mockClear();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(toggleExpanded).toHaveBeenCalledWith('tkt-1', false);
  });

  it('closes on the same Escape that closes a tooltip, and leaves Escape to an open dialog', () => {
    const { toggleExpanded } = show([row(0)]);
    const tip = document.createElement('div');
    tip.setAttribute('role', 'tooltip');
    tip.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.append(tip);
    // React Aria closes its tooltip in the capture phase and stops the event: the pane must not need a press more
    const stop = (e: Event) => e.stopPropagation();
    document.addEventListener('keydown', stop, true);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    document.removeEventListener('keydown', stop, true);
    expect(toggleExpanded).toHaveBeenCalledWith('tkt-1', false);
    toggleExpanded.mockClear();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.append(dialog);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(toggleExpanded).not.toHaveBeenCalled();
    tip.remove();
    dialog.remove();
  });
});
