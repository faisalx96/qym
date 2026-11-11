import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dataset, DatasetVersion } from '@/api/datasets';
import { ToastProvider } from '@/ui';
import { AddItemDialog } from '../dialogs';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ item: { item_id: 'item-3' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AddItemDialog
          open
          onOpenChange={() => undefined}
          slug="p"
          dataset={{ slug: 'faq' } as Dataset}
          version={{ version: 'v3', item_count: 2 } as DatasetVersion}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return bodies;
}

describe('Add item (C063)', () => {
  it('keeps typed values as text by default, with the stored-type tag of the pane', async () => {
    const bodies = setup();
    expect(
      screen
        .getAllByTestId('type-tag')
        .slice(0, 2)
        .map((t) => t.textContent),
    ).toEqual(['string', 'string']);
    await userEvent.type(screen.getByRole('textbox', { name: 'Input' }), 'What is 6 times 5?');
    await userEvent.type(screen.getByRole('textbox', { name: 'Expected output' }), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ input: 'What is 6 times 5?', expected_output: '30' });
  });

  it('stores a number only when the user picks JSON', async () => {
    const bodies = setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Input' }), 'q');
    await userEvent.type(screen.getByRole('textbox', { name: 'Expected output' }), '30');
    const jsonRadios = screen.getAllByRole('radio', { name: 'JSON' });
    await userEvent.click(jsonRadios[1]!);
    expect(screen.getAllByTestId('type-tag')[1]!.textContent).toBe('string → number');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ expected_output: 30 });
  });

  it('asks for an input and rejects metadata that is not JSON', async () => {
    const bodies = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText('Input is required.')).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Input' }), 'x');
    await userEvent.type(screen.getByRole('textbox', { name: 'Metadata' }), '{{bad');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText('Metadata is not valid JSON.')).toBeTruthy();
    expect(bodies).toHaveLength(0);
  });
});
