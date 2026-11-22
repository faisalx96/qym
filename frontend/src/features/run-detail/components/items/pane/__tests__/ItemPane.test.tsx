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

function makeContext(rows: Row[], lazy = false, samples = 1) {
  const payload = {
    run: { run_id: 'r', status: 'COMPLETED', samples, metric_names: names, metric_specs: specs },
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

function show(rows: Row[], { lazy = false, loadError = false, samples = 1 } = {}) {
  current = makeContext(rows, lazy, samples);
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

/** An item of a repeat run with four passes: pass 1 passes, passes 2 and 3 fail, pass 4 passes. */
const repeatRow = (): Row =>
  row(0, {
    metric_values: [0.6, 0.8],
    pass_scores: { resolution: [0.9, 0.2, 0.3, 0.95], tone: [0.9, 0.8, 0.7, 0.9] },
    pass_metric_meta: {
      resolution: [{}, { reason: 'Pass two missed the date' }, {}, {}],
      tone: [{}, {}, {}, {}],
    },
    pass_attempts: [1, 2, 3, 4].map((n) => ({
      pass_number: n,
      status: 'completed',
      output: `Answer of pass ${n}`,
      latency_ms: 1000 + n,
    })),
  } as Partial<Row>);

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
    // the first column holds the arrow that opens the details of a metric
    expect(heads.slice(1, 5)).toEqual(['Metric', 'Score', 'Pass if', 'Reason']);
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

  it('opens a multi-pass item with three passes in view from the first pass that failed', () => {
    const { pane } = show([repeatRow()], { samples: 4 });
    const group = within(pane).getByRole('group', { name: 'Passes in view' });
    const chips = within(group).getAllByRole('button');
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'true', 'true']);
    // one Output block per pass in view, each headed with its pass
    const outputs = Array.from(pane.querySelectorAll<HTMLElement>('[data-part="output"]'));
    expect(outputs.map((o) => within(o).getByText(/^Answer of pass/).textContent)).toEqual([
      'Answer of pass 2',
      'Answer of pass 3',
      'Answer of pass 4',
    ]);
    expect(within(outputs[0]!).getByText('Pass 2')).toBeTruthy();
    // the metrics table has a score column per pass in view and the mean; no reason column with several passes
    const heads = within(within(pane).getByRole('table', { name: 'Metrics' }))
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads.slice(1)).toEqual(expect.arrayContaining(['Pass 2', 'Pass 3', 'Pass 4', 'Mean']));
    expect(heads).not.toContain('Reason');
  });

  it('puts a pass in view or out of view with its chip, at most three, and keeps at least one in view', () => {
    const { pane } = show([repeatRow()], { samples: 4 });
    const group = within(pane).getByRole('group', { name: 'Passes in view' });
    const chip = (n: number) => within(group).getAllByRole('button')[n - 1]!;
    const pressed = () =>
      within(group)
        .getAllByRole('button')
        .map((c) => c.getAttribute('aria-pressed'));
    // the rule is said once in the head of the Output row; no shortcut claims to show every pass
    expect(within(pane).getByText('Up to 3 at a time')).toBeTruthy();
    expect(within(pane).queryByRole('button', { name: 'All passes' })).toBeNull();
    // a fourth pass takes the place of the pass picked earliest (pass 2 of the opening 2, 3, 4)
    fireEvent.click(chip(1));
    expect(pressed()).toEqual(['true', 'false', 'true', 'true']);
    expect(pane.querySelectorAll('[data-part="output"]')).toHaveLength(3);
    // then pass 3 is the earliest: pass 2 takes its place
    fireEvent.click(chip(2));
    expect(pressed()).toEqual(['true', 'true', 'false', 'true']);
    for (const n of [1, 4]) fireEvent.click(chip(n));
    expect(pane.querySelectorAll('[data-part="output"]')).toHaveLength(1);
    // the last pass in view stays on
    fireEvent.click(chip(2));
    expect(chip(2).getAttribute('aria-pressed')).toBe('true');
    expect(chip(2).getAttribute('aria-disabled')).toBe('true');
    // one pass in view: the table shows that pass's reasons in a column again
    const heads = within(within(pane).getByRole('table', { name: 'Metrics' }))
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toContain('Reason, pass 2');
    expect(within(pane).getByText('Pass two missed the date')).toBeTruthy();
  });

  it('folds each nested key of a large JSON output with three passes in view (feedback round 3)', () => {
    // a structured output well over BIG_VALUE parts, with groups of groups: the round-1 fold rule applies
    const big = (n: number) =>
      JSON.stringify({
        summary: `Report of pass ${n}`,
        totals: { revenue: 100 * n, orders: 12 },
        regions: Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [`r${i}`, { revenue: i * 10, growth: i / 10, top: `c${i}` }]),
        ),
      });
    const item = repeatRow();
    item.pass_attempts = item.pass_attempts!.map((a) => ({ ...a, output: big(a.pass_number ?? 0) }));
    const { pane } = show([item], { samples: 4 });
    const outputs = Array.from(pane.querySelectorAll<HTMLElement>('[data-part="output"]'));
    expect(outputs).toHaveLength(3);
    const key = (o: HTMLElement, name: RegExp) => within(o).getByRole('button', { name });
    for (const o of outputs) {
      // each output has its own Expand all / Collapse all bar; the first level is open, the level below is closed
      expect(within(o).getByRole('button', { name: 'Expand all' })).toBeTruthy();
      expect(key(o, /^regions/).getAttribute('aria-expanded')).toBe('true');
      expect(key(o, /^r03 fields/).getAttribute('aria-expanded')).toBe('false');
    }
    // a key folds and opens in its own output only
    fireEvent.click(key(outputs[2]!, /^r03 fields/));
    expect(key(outputs[2]!, /^r03 fields/).getAttribute('aria-expanded')).toBe('true');
    expect(key(outputs[0]!, /^r03 fields/).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(key(outputs[1]!, /^totals/));
    expect(key(outputs[1]!, /^totals/).getAttribute('aria-expanded')).toBe('false');
    expect(key(outputs[0]!, /^totals/).getAttribute('aria-expanded')).toBe('true');
    // Collapse all closes every key of its output
    fireEvent.click(within(outputs[0]!).getByRole('button', { name: 'Collapse all' }));
    expect(
      Array.from(outputs[0]!.querySelectorAll('button[aria-expanded]')).every(
        (b) => b.getAttribute('aria-expanded') === 'false',
      ),
    ).toBe(true);
  });

  it('gives the Output title the tone of the one pass in view, and no single tone to several', () => {
    const { pane } = show([repeatRow()], { samples: 4 });
    const outRow = pane.querySelector<HTMLElement>('[data-part="output-row"]')!;
    expect(outRow.hasAttribute('data-tone')).toBe(false);
    const group = within(pane).getByRole('group', { name: 'Passes in view' });
    const chip = (n: number) => within(group).getAllByRole('button')[n - 1]!;
    // passes 2, 3 and 4 in view; leave pass 2 (failed) alone, then pass 4 (passed) alone
    fireEvent.click(chip(3));
    fireEvent.click(chip(4));
    expect(outRow.getAttribute('data-tone')).toBe('danger');
    fireEvent.click(chip(4));
    fireEvent.click(chip(2));
    expect(outRow.getAttribute('data-tone')).toBe('success');
  });

  it('opens and closes every metric with one labelled button, and a row with a click on it', () => {
    const { pane } = show([
      row(0, { metric_meta: { resolution: { judge: 'gpt-4.1' }, tone: { judge: 'claude' } } }),
    ]);
    const all = within(pane).getByRole('button', { name: 'Expand all' });
    fireEvent.click(all);
    expect(pane.querySelectorAll('[data-part="metric-details"]')).toHaveLength(2);
    fireEvent.click(within(pane).getByRole('button', { name: 'Collapse all' }));
    expect(pane.querySelector('[data-part="metric-details"]')).toBeNull();
    // a click anywhere on a row (not on its controls) opens its details
    fireEvent.click(within(pane).getByText('resolution', { selector: '[role="row"] *' }));
    expect(pane.querySelector('[data-part="metric-details"]')!.textContent).toContain('gpt-4.1');
    expect(pane.querySelector('[data-open]')).not.toBeNull();
  });

  it('closes on a click outside the pane, and not on a click on a row of the list', () => {
    const { toggleExpanded } = show([row(0), row(1)]);
    const table = document.createElement('table');
    table.innerHTML = '<tbody><tr data-item-id="tkt-2"><td>Row 2</td></tr></tbody>';
    const empty = document.createElement('div');
    document.body.append(table, empty);
    const press = (el: Element) => {
      fireEvent.pointerDown(el, { button: 0 });
      fireEvent.click(el);
    };
    press(table.querySelector('td')!);
    expect(toggleExpanded).not.toHaveBeenCalled();
    press(empty);
    expect(toggleExpanded).toHaveBeenCalledWith('tkt-1', false);
    table.remove();
    empty.remove();
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
