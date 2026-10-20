import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Dataset, DatasetAccess } from '@/api/datasets';
import { ToastProvider } from '@/ui';
import { AccessSection } from '../AccessSection';

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

function install(
  responses: { get: () => Response | Promise<Response>; put?: (body: unknown) => DatasetAccess },
): Harness {
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

function renderSection(archived = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AccessSection slug="demo" dataset={dataset} archived={archived} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Access section (A1-7 to A1-24)', () => {
  it('shows the two modes as a radio group with the project mode selected by default', async () => {
    install({ get: () => ok(access()) });
    renderSection();
    const group = await screen.findByRole('radiogroup', { name: 'Who can access this dataset' });
    const project = within(group).getByRole('radio', { name: /Everyone in the project/ });
    const only = within(group).getByRole('radio', { name: /Only people listed below/ });
    expect(project).toBeChecked();
    expect(only).not.toBeChecked();
    expect(screen.getByText('Every member can view and modify this dataset. This is the default.')).toBeInTheDocument();
    expect(screen.getByText('Project managers, admins and the creator always have full access.')).toBeInTheDocument();
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
    expect(screen.getByText('Only project managers, admins and the creator can open this dataset.')).toBeInTheDocument();
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
    install({ get: () => ok(restricted([grant(NOURA, 'view'), grant(KHALID, 'view'), grant(OMAR, 'view')])) });
    renderSection();
    await user.click(await screen.findByRole('radio', { name: /Everyone in the project/ }));
    expect(
      screen.getByText(/3 saved grants are kept and apply again if you switch back\./),
    ).toBeInTheDocument();
  });

  it('is a read-only summary for someone who cannot manage access', async () => {
    install({
      get: () =>
        ok(restricted([grant(NOURA, 'modify')]) && { ...restricted([grant(NOURA, 'modify')]), can_manage_access: false, candidates: [], your_level: 'view' }),
    });
    renderSection();
    const summary = await screen.findByTestId('access-summary');
    expect(within(summary).getByText('Only people listed below')).toBeInTheDocument();
    expect(within(summary).getByText('View')).toBeInTheDocument();
    expect(screen.getByText('Only project managers and admins can change who has access.')).toBeInTheDocument();
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
          ? new Response(JSON.stringify({ detail: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
          : ok(access()),
    });
    renderSection();
    expect(screen.getByRole('status', { name: 'Loading access' })).toBeInTheDocument();
    expect(await screen.findByText('Couldn’t load access')).toBeInTheDocument();
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
