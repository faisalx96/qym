import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Dataset } from '@/api/datasets';
import { ToastProvider } from '@/ui';
import { SettingsTab } from '../SettingsTab';

const dataset = {
  slug: 'qa',
  name: 'support-faq',
  description: 'Customer support questions.',
  tags: ['support'],
  private_test_set: false,
  can_set_private_test_set: true,
  permissions: { can_delete: true },
} as unknown as Dataset;

function renderTab(over: Partial<Dataset> = {}, props: { readOnly?: boolean; archived?: boolean } = {}) {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SettingsTab
            slug="demo"
            dataset={{ ...dataset, ...over } as Dataset}
            readOnly={props.readOnly ?? false}
            archived={props.archived ?? false}
          />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe('Settings tab (QA5-3 to QA5-16)', () => {
  it('renders General, Visibility and Danger zone as cards with h2 titles', () => {
    renderTab();
    for (const name of ['General', 'Visibility', 'Danger zone'])
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    expect(screen.getByTestId('settings-layout')).toBeInTheDocument();
  });

  it('makes no request to the access route and shows no access controls (QA5-14)', () => {
    const { fetchMock } = renderTab();
    expect(screen.queryByTestId('access-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('access-tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.filter((u) => u.includes('/access'))).toEqual([]);
  });

  it('labels the fields by FieldRow and aria-label (QA5-6)', () => {
    renderTab();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('support-faq');
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByText('Press Enter to add a tag.')).toBeInTheDocument();
  });

  it('save is disabled until the form is dirty and the status says so (QA5-10)', async () => {
    const user = userEvent.setup();
    renderTab();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('No changes')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('a reader has read-only fields and no footer (QA5-10)', () => {
    renderTab({}, { readOnly: true });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Tags' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Private test set/ })).toBeDisabled();
  });

  it('omits the Visibility card when the caller cannot set it (QA5-11, QA5-13)', () => {
    renderTab({ can_set_private_test_set: false });
    expect(screen.queryByRole('heading', { name: 'Visibility' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument();
  });

  it('Danger zone sentences follow the permission and the archive state (QA5-12)', () => {
    const { unmount } = renderTab({ permissions: { can_delete: false } } as Partial<Dataset>);
    expect(
      screen.getByText('Only the dataset creator or a project manager can delete a dataset.'),
    ).toBeInTheDocument();
    unmount();
    renderTab({}, { archived: true });
    const danger = screen.getByTestId('settings-danger');
    expect(within(danger).getByText('This project is archived.')).toBeInTheDocument();
    expect(within(danger).queryByRole('button', { name: 'Delete dataset' })).not.toBeInTheDocument();
  });

  it('keeps the description sentences whole (QA5-4)', () => {
    renderTab();
    expect(screen.getByText(/Members still see versions, run history, and scores\./)).toBeInTheDocument();
    expect(screen.getByText(/Runs that used it keep their results\./)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderTab();
    expect(await axe(container)).toHaveNoViolations();
  });
});
