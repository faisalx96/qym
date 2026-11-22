/**
 * I13 and I14 (November 2026), in the rendered pane:
 * - the metrics table carries complete column templates (never a template built from an optional property);
 * - metadata with two tables renders as two tables, and stays open across a live refresh of the row;
 * - a reload of the open row (a new pass) keeps the pane and the opened details instead of the loading frame;
 * - the pane stays open when a refresh takes its item out of the table's rows;
 * - a crash in one metric's details stays in those details.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';
import { effectiveThresholds, type FilterContext } from '../../../../lib/filterRules';
import { reuseRows } from '../../../../lib/rowSignature';
import { buildRunModel } from '../../../../lib/runModel';
import type { Row, RunPayload } from '../../../../types';
import { ItemsUi, type ItemsUiValue } from '../../ItemsUi';
import type * as Values from '../values';

let current: ReturnType<typeof makeContext>;
vi.mock('../../../../RunContext', () => ({ useRunPage: () => current }));
vi.mock('@/api/runs', () => ({
  useUpdateMetric: () => ({ mutate: vi.fn(), isPending: false }),
  useIssueAction: () => ({ mutate: vi.fn(), isPending: false }),
  useCategoryCatalogQuery: () => ({ data: undefined }),
  useIssueBlocksQuery: () => ({ data: undefined }),
}));
// a scorer's value that breaks the details renderer: only the details holding it may fail
vi.mock('../values', async (importOriginal) => {
  const orig = await importOriginal<typeof Values>();
  return {
    ...orig,
    FieldList: (props: Parameters<typeof orig.FieldList>[0]) => {
      if (props.data && typeof props.data === 'object' && 'crash_me' in props.data) throw new Error('bad value');
      return orig.FieldList(props);
    },
  };
});

import { ItemPane } from '../ItemPane';

const specs = {
  accuracy: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.8, schema_version: 2 },
  latency: { score_type: 'percentage', direction: 'maximize', schema_version: 2 },
};
const names = Object.keys(specs);
const TABLE = [
  { region: 'Riyadh', quarter: 'Q1', sales: 1000 },
  { region: 'Jeddah', quarter: 'Q2', sales: 1113 },
];
const fullMeta = (pass: number) => ({
  exact_match_cell_f1: 100,
  llm_judge_reasoning: `The generated SQL selects the same rows as the reference query. `.repeat(5) + `(pass ${pass})`,
  expected_rows: TABLE,
  actual_rows: TABLE,
});
const compactMeta = () => ({ exact_match_cell_f1: 100 });
const attempt = (n: number, output?: string) => ({
  pass_number: n,
  status: 'completed',
  latency_ms: 1000 + n,
  output_digest: `d${n}`,
  __has_output: true,
  ...(output === undefined ? {} : { output }),
});

/** An item of a running repeat run, as the details loader stores it (full metadata) or as the index sends it. */
function itemRow(passes: number, loaded: boolean, over: Partial<Row> = {}): Row {
  const numbers = Array.from({ length: passes }, (_, i) => i + 1);
  return {
    index: 0,
    item_id: 'm3-001',
    status: 'completed',
    input_preview: 'Total sales in Riyadh',
    ...(loaded ? { input: 'Total sales in Riyadh', expected: 'SELECT 1', output: 'SELECT 1' } : {}),
    output_digest: 'row',
    __has_output: true,
    latency_ms: 1200,
    metric_values: [1, 0.9],
    pass_scores: { accuracy: numbers.map(() => 1), latency: numbers.map(() => 0.9) },
    metric_meta: { accuracy: loaded ? fullMeta(passes) : compactMeta(), latency: {} },
    pass_metric_meta: {
      accuracy: numbers.map((n) => (loaded ? fullMeta(n) : compactMeta())),
      latency: numbers.map(() => ({})),
    },
    pass_attempts: numbers.map((n) => attempt(n, loaded ? `SELECT ${n}` : undefined)),
    __details_loaded: loaded,
    ...over,
  } as Row;
}

function makeContext(rows: Row[], samples: number) {
  const payload = {
    run: { run_id: 'r', status: 'RUNNING', samples, metric_names: names, metric_specs: specs },
    snapshot: { rows, metric_names: names, metric_specs: specs, detail_mode: 'lazy' },
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

const ensure = vi.fn(() => new Promise<void>(() => {}));
const ui = {
  textMode: 'raw',
  hiddenFields: new Set<string>(),
  hiddenMetricFields: new Set<string>(),
  details: { ensure, retry: vi.fn(), stateOf: () => undefined },
  expanded: new Set(['m3-001']),
  toggleExpanded: vi.fn(),
  highlight: null,
  openTrace: vi.fn(),
  scrollTarget: null,
  requestScroll: vi.fn(),
  clearScroll: vi.fn(),
} as unknown as ItemsUiValue;

const client = new QueryClient();
const wrap = (node: ReactNode) => (
  <QueryClientProvider client={client}>
    <ToastProvider>
      <MemoryRouter>
        <ItemsUi.Provider value={ui}>{node}</ItemsUi.Provider>
      </MemoryRouter>
    </ToastProvider>
  </QueryClientProvider>
);

/** Mounts the pane over `rows`; `update` is a live refresh (new rows; the table may list other rows). */
function mount(rows: Row[], samples = 2) {
  current = makeContext(rows, samples);
  const view = render(wrap(<ItemPane openId="m3-001" rows={rows} />));
  return {
    update(next: Row[], tableRows: Row[] = next) {
      current = makeContext(next, samples);
      view.rerender(wrap(<ItemPane openId="m3-001" rows={tableRows} />));
    },
  };
}

const pane = () => screen.getByTestId('item-pane');
const metrics = () => within(pane()).getByRole('table', { name: 'Metrics' });
const details = () => pane().querySelector('[data-part="metric-details"]');
/** The data tables in the opened details (DataTable's own `<table>` markup, as the live probe counts them). */
const detailTables = () => Array.from(details()?.querySelectorAll('table') ?? []).map((t) => t.getAttribute('aria-label'));
const openAccuracy = () =>
  fireEvent.click(within(pane()).getByRole('button', { name: 'Show the details of accuracy' }));

describe('the metrics table of the item pane: column templates (I13, I16)', () => {
  it('sets one complete template and no optional column property', () => {
    mount([itemRow(2, true)]);
    const style = metrics().getAttribute('style') ?? '';
    const value = metrics().style.getPropertyValue('--m-cols');
    // a complete track list: the lead and action columns, and the score columns written out
    expect(value).toMatch(/^24px .* 24px$/);
    expect(value).not.toContain('var(');
    // one line at every width (I16): no narrow or tiny stacked template
    expect(style).not.toMatch(/--m-(wide|narrow|tiny)|--scores|--c-passif|--c-reason/);
  });

  it('writes the score columns of the passes in view and the mean into the template', () => {
    mount([itemRow(2, true)]);
    // two passes in view and the mean; accuracy has a pass threshold: the Pass if column
    expect(metrics().style.getPropertyValue('--m-cols')).toBe(
      '24px minmax(148px, 1.4fr) repeat(3, minmax(68px, 1fr)) 64px 24px',
    );
  });
});

describe('metadata with two tables on a running run (I14)', () => {
  it('renders the two tables of the opened metadata', () => {
    mount([itemRow(1, true)]);
    openAccuracy();
    const box = details()!;
    expect(detailTables()).toEqual(['expected_rows', 'actual_rows']);
    expect(box.textContent).toContain('expected_rows');
    expect(box.textContent).toContain('actual_rows');
    expect(box.textContent).toContain('Riyadh');
  });

  it('keeps the details open, with both tables, across a live refresh of the row', () => {
    const loaded = itemRow(2, true);
    const { update } = mount([loaded]);
    openAccuracy();
    expect(detailTables()).toHaveLength(4);
    // the refetch: the index form of the same row (no tables, no long text), merged as the query cache merges it
    const prev = makeContext([loaded], 2).payload;
    const after = reuseRows(prev, makeContext([itemRow(2, false)], 2).payload);
    update(after.snapshot.rows);
    expect(within(pane()).getByRole('button', { name: 'Hide the details of accuracy' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(detailTables()).toHaveLength(4);
  });

  it('keeps the pane and the opened details while a new pass reloads the row', () => {
    // a run of three passes, two of them done so far
    const { update } = mount([itemRow(2, true)], 3);
    openAccuracy();
    // a new pass arrived: the row is not loaded until its bodies come back
    update([itemRow(3, false)]);
    expect(pane().querySelector('[data-part="pane-skeleton"]')).toBeNull();
    expect(detailTables()).toHaveLength(4);
    expect(ensure).toHaveBeenCalledWith(['m3-001']);
    // the bodies arrive: the new pass shows, the details are still open
    update([itemRow(3, true)]);
    expect(within(pane()).getByRole('button', { name: 'Hide the details of accuracy' })).toBeInTheDocument();
    expect(detailTables()).toHaveLength(6);
  });

  it('stays open when a refresh takes the item out of the table rows', () => {
    const row = itemRow(2, true);
    const other = { ...itemRow(2, true), item_id: 'm3-002', index: 1 } as Row;
    const { update } = mount([row, other]);
    openAccuracy();
    update([row, other], [other]);
    expect(pane()).toBeInTheDocument();
    expect(within(pane()).getByText('Not in the list')).toBeInTheDocument();
    expect(details()).not.toBeNull();
  });

  it('keeps a crash in one metric’s details inside those details', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const crash = { ...fullMeta(1), crash_me: 'yes' };
    mount([itemRow(1, true, { metric_meta: { accuracy: crash, latency: {} } } as Partial<Row>)], 1);
    openAccuracy();
    // the table and its rows stay; the details say that they could not be shown
    expect(within(metrics()).getAllByRole('row').length).toBeGreaterThan(2);
    expect(within(details() as HTMLElement).getByText(/Couldn’t show the details of accuracy/)).toBeInTheDocument();
    spy.mockRestore();
  });
});
