/** C203: the detail buttons on Reviews keep their names ('Approve', not 'Approve a') and announce their keys. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as HttpModule from '@/lib/http';
import type { CorrectionRow } from '@/api/reviews';

vi.mock('@/lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>();
  return { ...actual, api: { ...actual.api, get: vi.fn(async () => ({})) } };
});

import { DetailPane } from '../DetailPane';

const row = {
  id: 7,
  run_id: 'run-1',
  item_id: 'item-1',
  pass_number: null,
  pass_deleted_at: null,
  status: 'pending',
  created_at: '2026-10-30T10:00:00Z',
  project_slug: 'demo',
  human_root_cause_issues: [],
  ai_root_cause_issues: [],
  ai_root_causes: [],
  human_root_causes: [],
  self_reviewed: false,
} as unknown as CorrectionRow;

describe('DetailPane shortcut keys', () => {
  it('names each button by its action and sets aria-keyshortcuts', () => {
    const noop = () => {};
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DetailPane
            row={row}
            position={{ index: 0, total: 1 }}
            showProject={false}
            expanded={false}
            editing={false}
            busy={false}
            saving={false}
            onApprove={noop}
            onReject={noop}
            onReset={noop}
            onDelete={noop}
            onEdit={noop}
            onToggle={noop}
            onSaveEdit={noop}
            onCancelEdit={noop}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const [name, key] of [
      ['Approve', 'a'],
      ['Reject', 'r'],
      ['Edit', 'e'],
      ['Details', 'o'],
    ] as const) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-keyshortcuts', key);
    }
  });
});
