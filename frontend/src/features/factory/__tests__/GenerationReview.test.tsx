/**
 * Factory → Generation: an attempt opens from the attempts table into the layer chart and the items to review;
 * the review actions (one item, the popup, every pending item) post to the review route.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FactoryDetailPage } from '../FactoryDetailPage';
import { detail, renderPage, stubFetch } from './factoryFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function reviewCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([u, i]) => String(u).endsWith('/jobs/j1/items:review') && (i as RequestInit).method === 'POST')
    .map(([, i]) => JSON.parse(String((i as RequestInit).body)) as Record<string, unknown>);
}

describe('generation attempts', () => {
  it('opens an attempt from the table and draws one bar per layer', async () => {
    stubFetch();
    renderPage(<FactoryDetailPage factoryId="f1" />, {}, '/projects/demo/factory/f1?tab=generation');
    expect(await screen.findByTestId('job-dataset')).toHaveTextContent('Faq generated 1');
    await userEvent.click(screen.getByTestId('job-open'));
    const view = await screen.findByTestId('attempt-view');
    const rows = await within(view).findAllByTestId('layer-row');
    expect(rows.map((r) => r.getAttribute('data-layer'))).toEqual(['0', '1', '2']);
    expect(rows[0]).toHaveTextContent('2 source items');
    expect(rows[1]).toHaveTextContent('3 · 1 approved · 0 rejected · 2 pending');
    expect(rows[2]).toHaveTextContent('2 · 0 approved · 0 rejected · 2 pending');
    // Every segment names its share for a screen reader.
    expect(within(rows[1]!).getByLabelText('Layer 1: 1 approved')).toBeInTheDocument();
    expect(screen.getByTestId('attempt-counts')).toHaveTextContent('1 approved · 0 rejected · 4 pending');
    // The items, with their rule and their review.
    const table = screen.getByRole('grid', { name: 'Generated items' });
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).getByText('i1~L1.1~L2.1')).toBeInTheDocument();
    expect(within(table).getAllByText('Greet back')).not.toHaveLength(0);
    expect(within(table).getAllByText('Pending')).toHaveLength(4);
  });

  it('reviews one item from the row, from the popup, and every pending item at once', async () => {
    const fetchMock = stubFetch();
    renderPage(<FactoryDetailPage factoryId="f1" />, {}, '/projects/demo/factory/f1?tab=generation&job=j1');
    const table = await screen.findByRole('grid', { name: 'Generated items' });
    await within(table).findByText('i1~L1.2');
    // Row action: reject the second item.
    const row = within(table).getByText('i1~L1.2').closest('tr')!;
    await userEvent.click(within(row).getByTestId('item-reject'));
    await waitFor(() => expect(reviewCalls(fetchMock)).toEqual([{ review: 'rejected', item_ids: ['i1~L1.2'] }]));
    // The popup: opens on the row, shows the item, walks to the next one and approves it.
    await userEvent.click(within(table).getByText('i2~L1.1'));
    const dialog = await screen.findByTestId('generated-item-view');
    expect(dialog).toHaveTextContent('i2~L1.1');
    expect(dialog).toHaveTextContent('Layer 1 · from i2 · Amounts in SAR');
    expect(within(dialog).getByText('How do I pay in SAR? (i2~L1.1)')).toBeInTheDocument();
    expect(within(dialog).getByText('Added the currency.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByTestId('item-view-next'));
    expect(dialog).toHaveTextContent('i1~L1.1~L2.1');
    expect(within(dialog).getByText('4 of 5')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByTestId('item-view-approve'));
    await waitFor(() =>
      expect(reviewCalls(fetchMock)).toEqual([
        { review: 'rejected', item_ids: ['i1~L1.2'] },
        { review: 'approved', item_ids: ['i1~L1.1~L2.1'] },
      ]),
    );
    await userEvent.keyboard('{Escape}');
    // Every pending item at once, after a confirmation.
    await userEvent.click(screen.getByTestId('approve-all'));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve all' }));
    await waitFor(() => expect(reviewCalls(fetchMock).at(-1)).toEqual({ review: 'approved', all_pending: true }));
  });

  it('shows the chart and the items without review controls below the approve level', async () => {
    stubFetch({
      detail: {
        ...detail,
        permissions: {
          access_level: 'modify',
          can_modify: true,
          can_approve: false,
          can_manage_access: false,
          can_disconnect: false,
          is_creator: false,
        },
      },
    });
    renderPage(<FactoryDetailPage factoryId="f1" />, {}, '/projects/demo/factory/f1?tab=generation&job=j1');
    const table = await screen.findByRole('grid', { name: 'Generated items' });
    await within(table).findByText('i1~L1.2');
    expect(screen.queryByTestId('item-reject')).toBeNull();
    expect(screen.queryByTestId('approve-all')).toBeNull();
    expect(screen.getAllByTestId('layer-row')).toHaveLength(3);
    await userEvent.click(within(table).getByText('i1~L1.2'));
    const dialog = await screen.findByTestId('generated-item-view');
    expect(within(dialog).queryByTestId('item-view-approve')).toBeNull();
  });
});
