import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Dataset, DatasetAccess } from '@/api/datasets';
import { ToastProvider } from '@/ui';
import { AccessTab, accessSignature, grantDate } from '../AccessTab';

const person = (id: string, name: string) => ({ id, name, email: `${id}@example.com` });
const NOURA = person('noura', 'Noura Alharbi');
const KHALID = person('khalid', 'Khalid Almutairi');
const OMAR = person('omar', 'Omar Alharbi');
const DEV = person('dev', 'Dev User');

function access(over: Partial<DatasetAccess> = {}): DatasetAccess {
  return {
    access_mode: 'project',
    grants: [],
    can_manage_access: true,
    candidates: [NOURA, KHALID, OMAR],
    your_level: 'manage',
    ...over,
  };
}

const restricted = (grants: DatasetAccess['grants'] = []) =>
  access({
    access_mode: 'restricted',
    grants,
    candidates: [OMAR],
  });

const grant = (user: ReturnType<typeof person>, level: 'view' | 'modify') => ({
  user,
  level,
  granted_by: DEV,
  created_at: '2026-10-20T10:00:00Z',
});

const dataset = { slug: 'qa', name: 'qa' } as unknown as Dataset;

interface Harness {
  puts: unknown[];
}

function install(responses: {
  get: () => Response | Promise<Response>;
  put?: (body: unknown) => DatasetAccess;
}): Harness {
  const harness: Harness = { puts: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as unknown;
        harness.puts.push(body);
        const next = responses.put?.(body);
        return new Response(JSON.stringify(next ?? access()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      void input;
      return responses.get();
    }),
  );
  return harness;
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function renderSection(archived = false, onDirtyChange?: (dirty: boolean) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AccessTab slug="demo" dataset={dataset} archived={archived} onDirtyChange={onDirtyChange} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Access tab (QA5-24 to QA5-62)', () => {
  it('shows the two modes as a radio group with the project mode selected by default', async () => {
    install({ get: () => ok(access()) });
    renderSection();
    const group = await screen.findByRole('radiogroup', { name: 'Who can access this dataset' });
    const project = within(group).getByRole('radio', { name: /Everyone in the project/ });
    const only = within(group).getByRole('radio', { name: /Only people listed below/ });
    expect(project).toBeChecked();
    expect(only).not.toBeChecked();
    expect(
      screen.getByText('Every member can view and modify this dataset. This is the default.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Project managers, admins and the creator always have full access.'),
    ).toBeInTheDocument();
    // Save and Discard are disabled while nothing changed.
    expect(screen.getByRole('button', { name: 'Save access' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('choosing the restricted mode marks the section dirty and saves the full state with one PUT', async () => {
    const user = userEvent.setup();
    const calls = install({
      get: () => ok(access()),
      put: () => restricted([grant(OMAR, 'view')]),
    });
    renderSection();
    await user.click(await screen.findByRole('radio', { name: /Only people listed below/ }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    // An empty restricted list is allowed to be saved and says who still has access.
    expect(screen.getByText('No one is listed')).toBeInTheDocument();
    expect(
      screen.getByText('Only project managers, admins and the creator can open this dataset.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save access' }));
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    expect(calls.puts[0]).toEqual({ access_mode: 'restricted', grants: [] });
    expect(await screen.findByText('Access saved')).toBeInTheDocument();
  });

  it('lists grants with a level control and a remove button; Discard restores the saved list', async () => {
    const user = userEvent.setup();
    install({ get: () => ok(restricted([grant(NOURA, 'modify'), grant(KHALID, 'view')])) });
    renderSection();
    const table = await screen.findByTestId('access-grants-table');
    expect(within(table).getByText('Noura Alharbi')).toBeInTheDocument();
    expect(within(table).getByText('noura@example.com')).toBeInTheDocument();
    expect(screen.getByText('2 people')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Noura Alharbi' }));
    expect(within(table).queryByText('Noura Alharbi')).not.toBeInTheDocument();
    expect(screen.getByText('1 person')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(within(screen.getByTestId('access-grants-table')).getByText('Noura Alharbi')).toBeInTheDocument();
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('adds a person at the chosen level', async () => {
    const user = userEvent.setup();
    const calls = install({
      get: () => ok(restricted([grant(KHALID, 'view')])),
      put: () => restricted([grant(KHALID, 'view'), grant(OMAR, 'modify')]),
    });
    renderSection();
    const add = await screen.findByTestId('access-add');
    const levels = within(add).getByRole('radiogroup', { name: 'Level for the new person' });
    await user.click(within(levels).getByRole('radio', { name: 'Modify' }));
    const addButton = within(add).getByRole('button', { name: /^Add person$/ });
    expect(addButton).toBeDisabled();
    await user.click(within(add).getByRole('button', { name: /Choose a project member/ }));
    await user.click(await screen.findByRole('option', { name: /Omar Alharbi/ }));
    expect(addButton).toBeEnabled();
    await user.click(addButton);
    const table = screen.getByTestId('access-grants-table');
    expect(within(table).getByText('Omar Alharbi')).toBeInTheDocument();
    expect(screen.getByText('2 people')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save access' }));
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    expect(calls.puts[0]).toEqual({
      access_mode: 'restricted',
      grants: [
        { user_id: 'khalid', level: 'view' },
        { user_id: 'omar', level: 'modify' },
      ],
    });
  });

  it('tells a manager that everyone already has access when no candidate is left', async () => {
    install({ get: () => ok({ ...restricted([grant(KHALID, 'view')]), candidates: [] }) });
    renderSection();
    expect(await screen.findByText('Everyone in the project already has access.')).toBeInTheDocument();
  });

  it('keeps saved grants and says so when switching back to the project mode', async () => {
    const user = userEvent.setup();
    install({
      get: () => ok(restricted([grant(NOURA, 'view'), grant(KHALID, 'view'), grant(OMAR, 'view')])),
    });
    renderSection();
    await user.click(await screen.findByRole('radio', { name: /Everyone in the project/ }));
    expect(
      screen.getByText(/3 saved grants are kept and apply again if you switch back\./),
    ).toBeInTheDocument();
  });

  it('is a read-only summary for someone who cannot manage access', async () => {
    install({
      get: () =>
        ok(
          restricted([grant(NOURA, 'modify')]) && {
            ...restricted([grant(NOURA, 'modify')]),
            can_manage_access: false,
            candidates: [],
            your_level: 'view',
          },
        ),
    });
    renderSection();
    const summary = await screen.findByTestId('access-summary');
    expect(within(summary).getByText('Only people listed below')).toBeInTheDocument();
    expect(within(summary).getByText('View')).toBeInTheDocument();
    expect(
      screen.getByText('Only project managers and admins can change who has access.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('access-grants-table')).getByText('Modify')).toBeInTheDocument();
  });

  it('is read-only in an archived project even for a manager', async () => {
    install({ get: () => ok(access()) });
    renderSection(true);
    const summary = await screen.findByTestId('access-summary');
    expect(within(summary).getByText('Everyone in the project')).toBeInTheDocument();
    expect(within(summary).getByText('Modify')).toBeInTheDocument();
    expect(screen.getByText('This project is archived.')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton, then an error with Retry (never the default form)', async () => {
    const user = userEvent.setup();
    let fail = true;
    install({
      get: () =>
        fail
          ? new Response(JSON.stringify({ detail: 'boom' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          : ok(access()),
    });
    renderSection();
    // the card keeps its header while loading; the skeleton shows after the pending delay (QA5-57)
    expect(screen.getByRole('heading', { name: 'Access mode' })).toBeInTheDocument();
    expect(await screen.findByText('Couldn’t load access')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Access mode' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('radiogroup')).toBeInTheDocument();
  });

  it('has no axe violations in the manager form', async () => {
    install({ get: () => ok(restricted([grant(NOURA, 'modify')])) });
    const { container } = renderSection();
    await screen.findByTestId('access-grants-table');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Access tab: new rules of the QA round', () => {
  it('splits Access mode and People with access into two cards with h2 titles (QA5-24, QA5-32, QA5-49)', async () => {
    install({ get: () => ok(restricted([grant(NOURA, 'view')])) });
    renderSection();
    await screen.findByTestId('access-grants-table');
    expect(screen.getByRole('heading', { level: 2, name: 'Access mode' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'People with access' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByTestId('access-count')).toHaveTextContent('1 person');
    expect(screen.getByTestId('access-always')).toHaveTextContent(
      'Project managers, admins and the creator always have full access.',
    );
  });

  it('puts the add row above the table (QA5-34)', async () => {
    install({ get: () => ok(restricted([grant(NOURA, 'view')])) });
    renderSection();
    const table = await screen.findByTestId('access-grants-table');
    const add = screen.getByTestId('access-add');
    expect(add.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the People card in project mode and restores the rows when switching back (QA5-32, QA5-50)', async () => {
    const user = userEvent.setup();
    install({ get: () => ok(restricted([grant(NOURA, 'view')])) });
    renderSection();
    await screen.findByTestId('access-grants-table');
    await user.click(screen.getByRole('radio', { name: /Everyone in the project/ }));
    expect(screen.queryByTestId('access-people')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Only people listed below/ }));
    expect(within(screen.getByTestId('access-grants-table')).getByText('Noura Alharbi')).toBeInTheDocument();
    expect(screen.getByText('No changes')).toBeInTheDocument(); // back to the saved state is clean (QA5-47)
  });

  it('shows the grant date, Unknown user for a deleted granter and You / Not saved for a new row (QA5-40, QA5-41)', async () => {
    const user = userEvent.setup();
    install({
      get: () =>
        ok(
          restricted([
            grant(NOURA, 'view'),
            { ...grant(KHALID, 'view'), granted_by: null, created_at: '2026-10-14T09:00:00Z' },
          ]),
        ),
    });
    renderSection();
    const table = await screen.findByTestId('access-grants-table');
    expect(within(table).getByText('Unknown user')).toBeInTheDocument();
    expect(within(table).getAllByTestId('grant-added-at')).toHaveLength(2);
    expect(within(table).getByText('Oct 14, 2026')).toBeInTheDocument();
    expect(within(table).queryByText('Not saved')).not.toBeInTheDocument();
    await user.click(
      within(screen.getByTestId('access-add')).getByRole('button', { name: /Choose a project member/ }),
    );
    await user.click(await screen.findByRole('option', { name: /Omar Alharbi/ }));
    await user.click(within(screen.getByTestId('access-add')).getByRole('button', { name: /^Add person$/ }));
    expect(within(screen.getByTestId('access-grants-table')).getByText('Not saved')).toBeInTheDocument();
    expect(within(screen.getByTestId('access-grants-table')).getByText('You')).toBeInTheDocument();
  });

  it('removing and re-adding the same person is clean again and keeps the saved date (QA5-47, QA5-51)', async () => {
    const user = userEvent.setup();
    install({ get: () => ok(restricted([grant(NOURA, 'view')])) });
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Remove Noura Alharbi' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    const add = screen.getByTestId('access-add');
    await user.click(within(add).getByRole('button', { name: /Choose a project member/ }));
    await user.click(await screen.findByRole('option', { name: /Noura Alharbi/ }));
    await user.click(within(add).getByRole('button', { name: /^Add person$/ }));
    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(within(screen.getByTestId('access-grants-table')).getByText('Oct 20, 2026')).toBeInTheDocument();
  });

  it('reports the unsaved state to the page and clears it on unmount (QA5-62)', async () => {
    const user = userEvent.setup();
    const seen: boolean[] = [];
    install({ get: () => ok(restricted([grant(NOURA, 'view')])) });
    const { unmount } = renderSection(false, (d) => seen.push(d));
    await screen.findByTestId('access-grants-table');
    await user.click(screen.getByRole('button', { name: 'Remove Noura Alharbi' }));
    expect(seen.at(-1)).toBe(true);
    unmount();
    expect(seen.at(-1)).toBe(false);
  });

  it('keeps the edits and says so when the save fails (QA5-45, QA5-46)', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        (init?.method ?? 'GET').toUpperCase() === 'PUT'
          ? new Response(JSON.stringify({ detail: 'nope' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          : ok(restricted([grant(NOURA, 'view')])),
      ),
    );
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Remove Noura Alharbi' }));
    await user.click(screen.getByRole('button', { name: 'Save access' }));
    expect(await screen.findAllByText('Couldn’t save access')).not.toHaveLength(0);
    expect(screen.getByTestId('access-save-bar')).toHaveAttribute('data-state', 'failed');
    expect(screen.getByRole('button', { name: 'Save access' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Remove Noura Alharbi' })).not.toBeInTheDocument();
  });

  it('read only: summary badge, Added column, no add row, no save bar (QA5-53, QA5-55)', async () => {
    install({
      get: () =>
        ok({
          ...restricted([grant(NOURA, 'modify')]),
          can_manage_access: false,
          candidates: [],
          your_level: 'view',
        }),
    });
    renderSection();
    await screen.findByTestId('access-summary');
    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByTestId('access-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('access-save-bar')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('access-grants-table')).getByText('Added')).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('formats the grant date in English (QA5-41)', () => {
    expect(grantDate('2026-10-14T09:00:00Z')).toBe('Oct 14, 2026');
    expect(grantDate(null)).toBe('—');
  });
  it('signs mode and levels order-independently (QA5-47)', () => {
    const a = { person: NOURA, level: 'view' as const };
    const b = { person: KHALID, level: 'modify' as const };
    expect(accessSignature('restricted', [a, b])).toBe(accessSignature('restricted', [b, a]));
    expect(accessSignature('restricted', [a])).not.toBe(accessSignature('project', [a]));
    expect(accessSignature('restricted', [a])).not.toBe(
      accessSignature('restricted', [{ ...a, level: 'modify' }]),
    );
  });
});
