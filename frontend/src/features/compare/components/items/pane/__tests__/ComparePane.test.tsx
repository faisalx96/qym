/**
 * The item pane of the compare page: the approved order, one Output for each run, the platform's baseline flag, count
 * tag, table and on/off chips, and the row contract of the item list (aria-current, Escape gives the focus back).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CompareCtx, type CompareValue } from '../../../../CompareContext';
import type { CompareController } from '../../../../hooks/useCompareController';
import { useColumns } from '../../../../hooks/useColumnStats';
import { DetailsProvider, DetailsStore } from '../../../../hooks/useDetails';
import { makePayload, type FixtureRun } from '../../../../lib/__tests__/fixtures';
import { emptyView, type CompareView, type FilteredItem } from '../../../../lib/filters';
import { buildCompareModel } from '../../../../lib/model';
import { itemOutcomes, metricCtx } from '../../../../lib/scoring';
import { ItemList } from '../../ItemList';
import { ItemsUiHost } from '../../ItemsUi';

const ids = ['q1', 'q2', 'q3'];
const run = (id: string, score: number): FixtureRun => ({
  id,
  model: id,
  scores: Object.fromEntries(ids.map((item) => [item, { correct: score >= 0.5 ? 1 : 0, quality: score }])),
});

function Harness({ runs }: { runs: FixtureRun[] }) {
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
          input_full: JSON.stringify({ message: `Question ${row.item_id}`, tier: 'gold' }),
          expected_full: `Gold ${row.item_id}`,
          output_full: `Answer of ${r.base} to ${row.item_id}`,
        });
    return s;
  }, [model]);
  const [view, setViewState] = useState<CompareView>(() => ({ ...emptyView(), metric: 'quality' }));
  const ctx = useMemo(() => metricCtx(model, 'quality', {}), [model]);
  const info = useColumns(model, view)!;
  const items = useMemo<FilteredItem[]>(
    () => model.itemIds.map((itemId) => ({ itemId, ...itemOutcomes(model, itemId, ctx) })),
    [model, ctx],
  );
  const c = {
    view,
    thresholds: {},
    setView: (patch: Partial<CompareView>) => setViewState((v) => ({ ...v, ...patch })),
  } as unknown as CompareController;
  const value = {
    c,
    model,
    metric: 'quality',
    ctx,
    columns: info.columns,
    baseline: info.baseline,
    items,
    itemIds: model.itemIds,
    defs: [],
    slug: 'demo',
    searchPending: false,
    letter: (i: number) => 'ABCDEFGH'[i] ?? String(i + 1),
  } as unknown as CompareValue;
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/projects/demo/compare']}>
        <DetailsProvider store={store}>
          <CompareCtx.Provider value={value}>
            <ItemsUiHost>
              <ItemList />
            </ItemsUiHost>
          </CompareCtx.Provider>
        </DetailsProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const heads = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="item-head"]'));
const pane = () => screen.queryByTestId('item-pane');
const frame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
const two = [run('a', 0.9), run('b', 0.4)];

describe('the compare item list', () => {
  it('has rows that open the item: a button with no chevron, the open one is the current row', () => {
    render(<Harness runs={two} />);
    const head = heads()[0]!;
    expect(head.getAttribute('role')).toBe('button');
    expect(head.getAttribute('tabindex')).toBe('0');
    expect(document.querySelector('[data-part="item-chevron"]')).toBeNull();
    expect(head.hasAttribute('aria-expanded')).toBe(false);
    // the row text is the item's prompt (never the braces of a JSON input), else its id
    expect(head.querySelector('[data-part="item-title"]')!.textContent).toMatch(/^[^{]/);
    fireEvent.keyDown(head, { key: 'Enter' });
    expect(pane()!.getAttribute('data-item-id')).toBe('q1');
    expect(head.getAttribute('aria-current')).toBe('true');
    expect(head.closest('li')!.hasAttribute('data-open')).toBe(true);
    // Space on the next row moves the pane to it
    fireEvent.keyDown(heads()[1]!, { key: ' ' });
    expect(pane()!.getAttribute('data-item-id')).toBe('q2');
    expect(heads()[0]!.hasAttribute('aria-current')).toBe(false);
  });

  it('closes on Escape and gives the focus back to the row', async () => {
    render(<Harness runs={two} />);
    fireEvent.click(heads()[1]!);
    expect(pane()).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(pane()).toBeNull();
    await frame();
    expect(document.activeElement).toBe(heads()[1]!);
  });
});

describe('ComparePane', () => {
  it('shows Input, Expected beside one Output for each run, then Metrics, Execution and Root cause', () => {
    render(<Harness runs={two} />);
    fireEvent.click(heads()[0]!);
    const p = pane()!;
    expect(p.getAttribute('data-design')).toBe('compare-page');
    const parts = Array.from(p.querySelectorAll('[data-part]'))
      .map((n) => n.getAttribute('data-part')!)
      .filter((x) =>
        ['input', 'expected', 'output', 'metrics-section', 'execution', 'root-cause'].includes(x),
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
    expect(p.querySelector('[data-part="expected"]')!.getAttribute('data-tone')).toBe('gold');
    const tones = Array.from(p.querySelectorAll('[data-part="output"]')).map((o) =>
      o.getAttribute('data-tone'),
    );
    expect(tones).toEqual(['success', 'danger']);
  });

  it('marks the baseline with the platform flag and counts the failed metrics in a count tag', () => {
    render(<Harness runs={two} />);
    fireEvent.click(heads()[0]!);
    const p = pane()!;
    const flags = p.querySelectorAll('[data-part="baseline-tag"]');
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) expect(f.getAttribute('data-tone')).toBe('info');
    expect(p.querySelector('[data-count="failed"]')!.textContent).toMatch(/^\d+ failed$/);
    expect(within(p).getByRole('table', { name: 'Metrics of each run' })).toBeTruthy();
    // execution is the platform table, one column for each run
    expect(p.querySelector('[data-part="execution"] table')).not.toBeNull();
  });

  it('with four runs or more, picks the outputs in view with the on/off chips; one stays on', () => {
    render(<Harness runs={[run('a', 0.9), run('b', 0.4), run('c', 0.8), run('d', 0.3)]} />);
    fireEvent.click(heads()[0]!);
    const p = pane()!;
    const group = p.querySelector<HTMLElement>('[data-toggle-chips]')!;
    expect(group.getAttribute('role')).toBe('group');
    const chips = within(group).getAllByRole('button');
    expect(chips).toHaveLength(4);
    expect(p.querySelectorAll('[data-part="output"]')).toHaveLength(4);
    fireEvent.click(chips[0]!);
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(p.querySelectorAll('[data-part="output"]')).toHaveLength(3);
    fireEvent.click(chips[1]!);
    fireEvent.click(chips[2]!);
    fireEvent.click(chips[3]!);
    expect(p.querySelectorAll('[data-part="output"]')).toHaveLength(1);
    fireEvent.click(within(p).getByRole('button', { name: 'All' }));
    expect(p.querySelectorAll('[data-part="output"]')).toHaveLength(4);
  });
});
