/**
 * The Sweep table opens its item in the item pane of the compare page (ComparePane): the same blocks, the Sweep order
 * for J / K, Escape with the focus back on the row, and the cohort sides (A1, A2, B1) in view.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CompareCtx, runLetters, type CompareValue } from '../../CompareContext';
import type { CompareController } from '../../hooks/useCompareController';
import { useColumns } from '../../hooks/useColumnStats';
import { DetailsProvider, DetailsStore } from '../../hooks/useDetails';
import { makePayload, type FixtureRun } from '../../lib/__tests__/fixtures';
import { resolveCohorts } from '../../lib/cohort';
import { emptyView, type CompareView } from '../../lib/filters';
import { buildCompareModel } from '../../lib/model';
import { metricCtx } from '../../lib/scoring';
import { ItemsUiHost } from '../items/ItemsUi';
import { SweepView } from './SweepView';

const ITEMS = 30;
const ids = Array.from({ length: ITEMS }, (_, i) => `q${String(i + 1).padStart(2, '0')}`);

/** A run that passes `correct` on the items `pass` picks. */
function run(id: string, model: string, pass: (n: number) => boolean): FixtureRun {
  return {
    id,
    model,
    scores: Object.fromEntries(
      ids.map((item, n) => [item, { correct: pass(n) ? 1 : 0, quality: pass(n) ? 0.9 : 0.4 }]),
    ),
  };
}

function Harness({ left, right }: { left: FixtureRun[]; right: FixtureRun[] }) {
  const runs = useMemo(() => [...left, ...right], [left, right]);
  const model = useMemo(
    () =>
      buildCompareModel(
        makePayload(runs),
        runs.map((r) => r.id),
      ),
    [runs],
  );
  const store = useMemo(() => {
    const s = new DetailsStore(() => new Promise(() => {}));
    for (const r of model.runs)
      for (const row of r.byItem.values())
        s.put(r.base, {
          ...row,
          input_full: `Question ${row.item_id}`,
          expected_full: `Gold ${row.item_id}`,
          output_full: `Answer of ${r.base} to ${row.item_id}`,
        });
    return s;
  }, [model]);
  const [view, setViewState] = useState<CompareView>(() => ({
    ...emptyView(),
    tab: 'sweep',
    metric: 'correct',
  }));
  const cohorts = useMemo(
    () =>
      resolveCohorts(model, {
        left: left.map((r) => r.id),
        right: right.map((r) => r.id),
        leftLabel: 'Old prompt',
        rightLabel: 'New prompt',
      }),
    [model, left, right],
  );
  const ctx = useMemo(() => metricCtx(model, 'correct', {}), [model]);
  const info = useColumns(model, view)!;
  const letters = runLetters(
    model.runs.map((r) => r.ref),
    cohorts,
  );
  const c = {
    view,
    thresholds: {},
    cohorts,
    setView: (patch: Partial<CompareView>) => setViewState((v) => ({ ...v, ...patch })),
  } as unknown as CompareController;
  const value = {
    c,
    model,
    metric: 'correct',
    ctx,
    columns: info.columns,
    baseline: info.baseline,
    items: [],
    itemIds: model.itemIds,
    defs: [],
    cohorts,
    slug: 'demo',
    searchPending: false,
    letter: (i: number) => letters[i] ?? String(i + 1),
  } as unknown as CompareValue;
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/projects/demo/compare?tab=sweep']}>
        <DetailsProvider store={store}>
          <CompareCtx.Provider value={value}>
            <ItemsUiHost>
              <SweepView />
            </ItemsUiHost>
          </CompareCtx.Provider>
        </DetailsProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="sweep-item-row"]'));
const rowIds = () => rows().map((r) => r.id.replace(/^item-/, ''));
const pane = () => screen.queryByTestId('item-pane');
const key = (k: string) =>
  act(() => {
    fireEvent.keyDown(document.body, { key: k });
  });
/** The close step gives the focus back in the next frame. */
const frame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

const two = {
  left: [run('a1', 'old', (n) => n % 2 === 0)],
  right: [run('b1', 'new', (n) => n % 3 !== 0)],
};
const six = {
  left: [0, 1, 2].map((k) => run(`a${k + 1}`, 'old', (n) => (n + k) % 2 === 0)),
  right: [0, 1, 2].map((k) => run(`b${k + 1}`, 'new', (n) => (n + k) % 3 !== 0)),
};

describe('Sweep item pane', () => {
  it('opens the item of a row in the compare pane, not in a dialog', () => {
    render(<Harness {...two} />);
    expect(pane()).toBeNull();
    const first = rows()[0]!;
    fireEvent.click(within(first).getByRole('button'));
    const p = pane()!;
    expect(p.getAttribute('data-item-id')).toBe(rowIds()[0]);
    expect(p.getAttribute('data-design')).toBe('compare-page');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(first.hasAttribute('data-open')).toBe(true);
    expect(within(first).getByRole('button').getAttribute('aria-current')).toBe('true');
    // the approved order: Input, Expected beside one Output for each run, then the sections
    const parts = Array.from(p.querySelectorAll('[data-part]'))
      .map((n) => n.getAttribute('data-part'))
      .filter((x) =>
        ['input', 'expected', 'output', 'metrics-section', 'execution', 'root-cause'].includes(x!),
      );
    expect(parts).toEqual([
      'input',
      'expected',
      'output',
      'output',
      'metrics-section',
      'execution',
      'root-cause',
    ]);
    expect(within(p).getByRole('radiogroup', { name: 'Mark the differences from' })).toBeTruthy();
  });

  it('shows each cohort side in the pane header and the side letter of each run', () => {
    render(<Harness {...six} />);
    fireEvent.click(within(rows()[0]!).getByRole('button'));
    const p = pane()!;
    const sides = Array.from(p.querySelectorAll('[data-part="sweep-pane-sides"] > span'));
    expect(sides.map((s) => s.getAttribute('title'))).toEqual([
      'Cohort A: Old prompt',
      'Cohort B: New prompt',
    ]);
    expect(sides.map((s) => s.querySelectorAll('[class*="dot"]').length)).toEqual([3, 3]);
    const letters = new Set(
      Array.from(p.querySelectorAll('[data-part="output"] [data-part="run-letter"]')).map(
        (n) => n.textContent,
      ),
    );
    expect([...letters]).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
  });

  it('gives the metrics a column for each run up to four runs and a row for each run above four', () => {
    const { unmount } = render(<Harness {...two} />);
    fireEvent.click(within(rows()[0]!).getByRole('button'));
    let table = within(pane()!).getByRole('table', { name: 'Metrics of each run' });
    expect(within(table).getAllByRole('columnheader')[0]!.textContent).toBe('Metric');
    unmount();
    render(<Harness {...six} />);
    fireEvent.click(within(rows()[0]!).getByRole('button'));
    table = within(pane()!).getByRole('table', { name: 'Metrics of each run' });
    expect(within(table).getAllByRole('columnheader')[0]!.textContent).toBe('Run');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(6);
  });

  it('steps with J and K in the order of the Sweep table and turns its page', () => {
    render(<Harness {...two} />);
    const order = rowIds();
    expect(order).toHaveLength(25);
    fireEvent.click(within(rows()[0]!).getByRole('button'));
    key('j');
    expect(pane()!.getAttribute('data-item-id')).toBe(order[1]);
    key('k');
    expect(pane()!.getAttribute('data-item-id')).toBe(order[0]);
    // the last row of page 1, then one more step: the table shows page 2 with the open row on it
    fireEvent.click(within(rows()[24]!).getByRole('button'));
    expect(pane()!.getAttribute('data-item-id')).toBe(order[24]);
    key('j');
    const open = pane()!.getAttribute('data-item-id')!;
    expect(order).not.toContain(open);
    expect(rowIds()).toHaveLength(ITEMS - 25);
    expect(document.getElementById(`item-${open}`)?.hasAttribute('data-open')).toBe(true);
    expect(within(pane()!).getByRole('navigation', { name: 'Previous and next item' }).textContent).toContain(
      `26 of ${ITEMS}`,
    );
  });

  it('closes on Escape and gives the focus back to the row', async () => {
    render(<Harness {...two} />);
    const button = within(rows()[2]!).getByRole('button');
    fireEvent.click(button);
    expect(pane()).not.toBeNull();
    key('Escape');
    expect(pane()).toBeNull();
    await frame();
    expect(document.activeElement).toBe(button);
    // a second click on the open row closes the pane too
    fireEvent.click(button);
    fireEvent.click(button);
    expect(pane()).toBeNull();
  });
});
