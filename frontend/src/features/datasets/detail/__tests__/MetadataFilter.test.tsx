import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetaFacets } from '@/api/datasets';
import { ToastProvider } from '@/ui';
import type { MetaFilter } from '../../lib/metaFilter';
import { MetadataFilter } from '../MetadataFilter';

const facets: MetaFacets = {
  truncated: false,
  paths: [
    {
      path: 'channels',
      kind: 'mixed',
      truncated: false,
      value_count: 3,
      values: [
        { value: 'chat', count: 87 },
        { value: 'email', count: 87 },
        { value: 'phone', count: 22 },
      ],
    },
    {
      path: 'domain',
      kind: 'scalar',
      truncated: false,
      value_count: 2,
      values: [
        { value: 'finance', count: 42 },
        { value: 'health', count: 30 },
      ],
    },
    {
      path: 'tags',
      kind: 'list',
      truncated: false,
      value_count: 3,
      values: [
        { value: 'billing', count: 26 },
        { value: 'refund', count: 26 },
        { value: 'account', count: 25 },
      ],
    },
    {
      path: 'big',
      kind: 'list',
      truncated: true,
      value_count: 340,
      values: Array.from({ length: 25 }, (_, n) => ({
        value: `v${String(n).padStart(2, '0')}`,
        count: 25 - n,
      })),
    },
  ],
};

function setup(added: MetaFilter[], response: MetaFacets | 'error' = facets, filters: MetaFilter[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      response === 'error'
        ? new Response(JSON.stringify({ detail: 'boom' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MetadataFilter
          slug="demo"
          datasetRef="qa"
          version="v1"
          filters={filters}
          onAdd={(f) => added.push(f)}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('metadata-filter'));
  return screen.findByTestId('meta-popover');
}

async function pickKey(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('button', { name: /Key/ }));
  await user.click(await screen.findByRole('option', { name }));
}

afterEach(() => vi.unstubAllGlobals());

describe('Metadata filter popover (QA1-1 to QA1-18)', () => {
  it('lists list and mixed keys with their descriptions (QA1-2)', async () => {
    const user = userEvent.setup();
    setup([]);
    await open(user);
    await user.click(await screen.findByRole('button', { name: /Key/ }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: /channels/ })).toHaveTextContent(
      '3 values · list or value',
    );
    expect(within(list).getByRole('option', { name: /domain/ })).toHaveTextContent('2 values');
    expect(within(list).getByRole('option', { name: /tags/ })).toHaveTextContent('3 values · list');
  });

  it('a scalar key stays single-choice with no Match control (QA1-13)', async () => {
    const user = userEvent.setup();
    const added: MetaFilter[] = [];
    setup(added);
    await open(user);
    await pickKey(user, /domain/);
    expect(screen.queryByTestId('meta-match')).not.toBeInTheDocument();
    expect(screen.queryByTestId('facet-selected-count')).not.toBeInTheDocument();
    const values = screen.getByTestId('facet-values');
    expect(values).not.toHaveAttribute('aria-multiselectable', 'true');
    await user.click(within(values).getByRole('option', { name: /finance/ }));
    await user.click(within(values).getByRole('option', { name: /health/ }));
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(added).toEqual([{ path: 'domain', values: ['health'], mode: 'any' }]);
  });

  it('a list key is multi-select with the count, Match disabled below two values (QA1-5 to QA1-11)', async () => {
    const user = userEvent.setup();
    setup([]);
    await open(user);
    await pickKey(user, /^tags/);
    const values = screen.getByTestId('facet-values');
    expect(values).toHaveAttribute('aria-multiselectable', 'true');
    expect(screen.getByTestId('facet-selected-count')).toHaveTextContent('None selected');
    expect(screen.getByTestId('meta-match-help')).toHaveTextContent(
      'Choose two or more values to pick a match mode.',
    );
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeDisabled();
    await user.click(within(values).getByRole('option', { name: /billing/ }));
    expect(screen.getByTestId('facet-selected-count')).toHaveTextContent('1 selected');
    expect(within(screen.getByTestId('meta-match')).getByRole('radio', { name: 'Partial' })).toBeDisabled();
    await user.click(within(values).getByRole('option', { name: /refund/ }));
    expect(screen.getByTestId('facet-selected-count')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('meta-match-help')).toHaveTextContent(
      'Items that have at least one of the chosen values.',
    );
    await user.click(within(screen.getByTestId('meta-match')).getByRole('radio', { name: 'Full match' }));
    expect(screen.getByTestId('meta-match-help')).toHaveTextContent(
      'Items that have every chosen value. An item may have more.',
    );
  });

  it('adds the chosen values in facet order with the chosen mode (QA1-16, QA1-19)', async () => {
    const user = userEvent.setup();
    const added: MetaFilter[] = [];
    setup(added);
    await open(user);
    await pickKey(user, /^tags/);
    const values = screen.getByTestId('facet-values');
    await user.click(within(values).getByRole('option', { name: /account/ }));
    await user.click(within(values).getByRole('option', { name: /billing/ }));
    await user.click(within(screen.getByTestId('meta-match')).getByRole('radio', { name: 'Full match' }));
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(added).toEqual([{ path: 'tags', values: ['billing', 'account'], mode: 'all' }]);
  });

  it('defaults a mixed key to Partial and resets the choice when the key changes (QA1-3, QA1-14)', async () => {
    const user = userEvent.setup();
    const added: MetaFilter[] = [];
    setup(added);
    await open(user);
    await pickKey(user, /^tags/);
    await user.click(within(screen.getByTestId('facet-values')).getByRole('option', { name: /billing/ }));
    await pickKey(user, /channels/);
    expect(screen.getByTestId('facet-selected-count')).toHaveTextContent('None selected');
    const values = screen.getByTestId('facet-values');
    await user.click(within(values).getByRole('option', { name: /chat/ }));
    await user.click(within(values).getByRole('option', { name: /phone/ }));
    expect(within(screen.getByTestId('meta-match')).getByRole('radio', { name: 'Partial' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(added).toEqual([{ path: 'channels', values: ['chat', 'phone'], mode: 'any' }]);
  });

  it('truncated list key: typing an exact value and Enter adds it to the chosen set (QA1-15)', async () => {
    const user = userEvent.setup();
    const added: MetaFilter[] = [];
    setup(added);
    await open(user);
    await pickKey(user, /^big/);
    expect(screen.getByTestId('facet-truncated')).toHaveTextContent(
      'Showing the 25 most common values of 340. Type to search.',
    );
    await user.type(screen.getByRole('searchbox', { name: 'Find a value' }), 'not-listed{Enter}');
    expect(added).toEqual([]);
    expect(screen.getByTestId('facet-selected-count')).toHaveTextContent('1 selected');
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(added).toEqual([{ path: 'big', values: ['not-listed'], mode: 'any' }]);
  });

  it('typing the same unlisted value twice keeps one choice (QA1-8)', async () => {
    const user = userEvent.setup();
    const added: MetaFilter[] = [];
    setup(added);
    await open(user);
    await pickKey(user, /^big/);
    const box = screen.getByRole('searchbox', { name: 'Find a value' });
    await user.type(box, 'k299{Enter}');
    await user.type(box, 'k299{Enter}');
    expect(screen.getByTestId('facet-selected-count')).toHaveTextContent('1 selected');
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(added).toEqual([{ path: 'big', values: ['k299'], mode: 'any' }]);
  });

  it('stops at twenty values and says so (QA1-8)', async () => {
    const user = userEvent.setup({ delay: null });
    setup([]);
    await open(user);
    await pickKey(user, /^big/);
    const values = screen.getByTestId('facet-values');
    for (let n = 0; n < 20; n += 1)
      await user.click(
        within(values).getByRole('option', { name: new RegExp(`^v${String(n).padStart(2, '0')}`) }),
      );
    expect(screen.getByTestId('facet-selected-count')).toHaveTextContent('20 selected');
    expect(screen.getByTestId('facet-limit')).toHaveTextContent('You can choose up to 20 values.');
    expect(within(values).getByRole('option', { name: /^v20/ })).toHaveAttribute('aria-disabled', 'true');
  }, 30_000);

  it('shows the empty and error states (QA1-18)', async () => {
    const user = userEvent.setup();
    setup([], { paths: [], truncated: false });
    await open(user);
    expect(await screen.findByText('No metadata keys')).toBeInTheDocument();
  });

  it('shows the error state with Retry (QA1-18)', async () => {
    const user = userEvent.setup();
    setup([], 'error');
    await open(user);
    expect(await screen.findByText('Couldn’t load metadata keys')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('disables the button at five paths with the tooltip text (QA1-1)', () => {
    const five: MetaFilter[] = Array.from({ length: 5 }, (_, n) => ({
      path: `k${n}`,
      values: ['v'],
      mode: 'any',
    }));
    setup([], facets, five);
    expect(screen.getByTestId('metadata-filter')).toHaveAttribute('data-limit');
  });
});
