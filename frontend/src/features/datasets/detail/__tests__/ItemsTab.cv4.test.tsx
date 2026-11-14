/**
 * cv4 review fixes in the items table: the pane's row is the highlighted row (E2), a double click opens the item page
 * (E3), and the row actions stay while the pane is open (E5, reversed by X8 after the shared fold fix).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as DatasetsApi from '@/api/datasets';
import type { Dataset, DatasetItem, DatasetVersion } from '@/api/datasets';
import { ToastProvider } from '@/ui';
import { ItemsTab } from '../ItemsTab';

const items: DatasetItem[] = ['ct-001', 'ct-002', 'ct-003'].map(
  (id, index) =>
    ({
      id: index + 1,
      item_id: id,
      index,
      input: { instruction: `question ${index}`, document_id: `doc-${index}` },
      expected_output: `answer ${index}`,
      metadata: { clause: 'x' },
      labels: [],
      state: 'active',
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    }) as DatasetItem,
);

vi.mock('@/api/datasets', async (importOriginal) => {
  const actual = await importOriginal<typeof DatasetsApi>();
  return {
    ...actual,
    useDatasetItems: () => ({
      data: {
        items,
        total: items.length,
        metric_names: [],
        metric_directions: {},
        counts: { all: 3, active: 3, disabled: 0 },
      },
      isPending: false,
      isFetching: false,
      isError: false,
      isPlaceholderData: false,
      refetch: () => undefined,
    }),
    useDeleteItem: () => ({ mutateAsync: async () => undefined }),
  };
});

const dataset = { slug: 'gold', name: 'Gold', items_visible: true } as Dataset;
const version = {
  id: 'ver-2',
  version: 'v2',
  status: 'draft',
  labels: [],
  item_count: 3,
} as unknown as DatasetVersion;

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

function tab(activeKey: string | null) {
  return (
    <ItemsTab
      slug="proj"
      dataset={dataset}
      version={version}
      readOnly={false}
      onAddItem={() => undefined}
      onImport={() => undefined}
      onOpenItem={() => undefined}
      activeKey={activeKey}
    />
  );
}

function mount(activeKey: string | null) {
  const client = new QueryClient();
  const wrap = (node: React.ReactNode) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/projects/proj/datasets/gold?v=v2']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  {node}
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(tab(activeKey)));
  return { ...view, rerenderWith: (key: string | null) => view.rerender(wrap(tab(key))) };
}

const row = (id: string) => document.querySelector<HTMLElement>(`tbody tr[data-row-key="${id}"]`)!;

afterEach(() => vi.restoreAllMocks());

describe('ItemsTab with the item pane (cv4 E2)', () => {
  it('highlights the pane row and moves the highlight when the pane steps to the next item', () => {
    const scrolled: string[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push((this as HTMLElement).dataset.rowKey ?? '');
    });
    const view = mount('ct-001');
    expect(row('ct-001')).toHaveAttribute('data-focused');
    expect(row('ct-002')).not.toHaveAttribute('data-focused');
    view.rerenderWith('ct-002');
    expect(row('ct-002')).toHaveAttribute('data-focused');
    expect(row('ct-001')).not.toHaveAttribute('data-focused');
    expect(scrolled).toContain('ct-002');
  });

  it('moves keyboard focus with the pane when it was on the old row', () => {
    const view = mount('ct-001');
    row('ct-001').focus();
    view.rerenderWith('ct-003');
    expect(document.activeElement).toBe(row('ct-003'));
  });
});

describe('ItemsTab row actions (cv4 E5, X8)', () => {
  it('keeps the row-actions column with the pane open and closed', () => {
    const view = mount(null);
    expect(screen.getAllByRole('button', { name: 'Copy as JSON' }).length).toBe(items.length);
    view.rerenderWith('ct-002');
    expect(screen.getAllByRole('button', { name: 'Copy as JSON' }).length).toBe(items.length);
  });
});

describe('ItemsTab double click (cv4 E3)', () => {
  it('opens the item page on a double click of a row', () => {
    mount(null);
    const cell = row('ct-002').querySelectorAll('td')[3]!;
    fireEvent.pointerDown(cell, { clientX: 10, clientY: 10 });
    fireEvent.doubleClick(cell, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId('where').textContent).toBe('/projects/proj/datasets/gold?v=v2&item=ct-002');
  });

  it('does not open the page after a drag (a text selection) or on a checkbox', () => {
    mount(null);
    const cell = row('ct-002').querySelectorAll('td')[3]!;
    fireEvent.pointerDown(cell, { clientX: 10, clientY: 10 });
    fireEvent.doubleClick(cell, { clientX: 80, clientY: 10 });
    const box = row('ct-002').querySelector('input[type="checkbox"]');
    if (box) fireEvent.doubleClick(box);
    expect(screen.getByTestId('where').textContent).toBe('/projects/proj/datasets/gold?v=v2');
  });
});
