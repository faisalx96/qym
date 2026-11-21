import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark, BookmarkList } from '@/api/bookmarks';
import type { Project } from '@/api/types';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';
import { ToastProvider } from '@/ui';
import { BookmarkButton } from '../BookmarkButton';
import { BookmarksPage } from '../BookmarksPage';

const project = { id: 'p1', name: 'Demo', slug: 'demo', is_active: true, role: 'MEMBER' } as unknown as Project;

function bookmark(over: Partial<Bookmark> & { id: string; run_id: string }): Bookmark {
  return {
    project_id: 'p1',
    project_slug: 'demo',
    project_name: 'Demo',
    visibility: 'private',
    note: '',
    pinned: false,
    pinned_at: null,
    created_at: '2026-11-17T10:00:00Z',
    updated_at: '2026-11-17T10:00:00Z',
    is_mine: true,
    user: { id: 'me', display_name: 'Me', email: 'me@x.com' },
    run: {
      run_id: over.run_id,
      run_name: `Run ${over.run_id}`,
      external_run_id: null,
      task: 'qa',
      dataset: 'faq',
      model: 'gpt-x',
      status: 'COMPLETED',
      origin: 'local',
      owner_user_id: 'me',
      created_at: '2026-11-16T10:00:00Z',
      started_at: null,
      ended_at: null,
    },
    ...over,
  };
}

const LIST: BookmarkList = {
  project_id: 'p1',
  project_slug: 'demo',
  scope: 'all',
  total: 2,
  pinned_count: 1,
  bookmarks: [
    bookmark({
      id: 'b1',
      run_id: 'r1',
      pinned: true,
      pinned_at: '2026-11-17T11:00:00Z',
      visibility: 'public',
      is_mine: false,
      note: '**Baseline** for release 4',
      user: { id: 'them', display_name: 'Them', email: 'them@x.com' },
    }),
    bookmark({ id: 'b2', run_id: 'r2', note: 'mine, private' }),
  ],
};

function stubFetch(list: BookmarkList = LIST) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = (payload: unknown) =>
      new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/bookmarks') && url.includes('/api/projects/')) return body(list);
    if (url.includes('/api/runs/') && url.endsWith('/bookmarks')) return body({ run_id: 'r9', mine: null, others: [] });
    if (url.includes('/api/runs/') && url.endsWith('/bookmark')) {
      const sent = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return body({ ...LIST.bookmarks[1], ...sent, run_id: 'r9' });
    }
    return body({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(ctx: Partial<ProjectValue> = {}, path = '/projects/demo/bookmarks') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value: ProjectValue = {
    project,
    slug: 'demo',
    readOnly: false,
    archived: false,
    viewer: false,
    canManage: false,
    isAdmin: false,
    ...ctx,
  };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ProjectContext.Provider value={value}>
            <BookmarksPage />
          </ProjectContext.Provider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Bookmarks page', () => {
  it('lists the bookmarks pinned first, with their flags, rendered notes and author', async () => {
    stubFetch();
    renderPage();
    const cards = await screen.findAllByTestId('bookmark-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-pinned');
    expect(within(cards[0]!).getByText('Pinned')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Public')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Baseline').tagName).toBe('STRONG');
    expect(within(cards[0]!).getByText('Them')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Private')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Run r1' })).toHaveAttribute('href', '/projects/demo/runs/r1');
    expect(screen.getByText('2 bookmarks')).toBeInTheDocument();
  });

  it('shows the pin, edit and remove actions on the caller’s own bookmarks only', async () => {
    stubFetch();
    renderPage();
    const cards = await screen.findAllByTestId('bookmark-card');
    expect(within(cards[0]!).queryByTestId('bookmark-edit')).not.toBeInTheDocument();
    expect(within(cards[1]!).getByTestId('bookmark-edit')).toBeInTheDocument();
    expect(within(cards[1]!).getByTestId('bookmark-pin')).toHaveAccessibleName('Pin to the top');
  });

  it('hides every action on a read-only project', async () => {
    stubFetch();
    renderPage({ readOnly: true, viewer: true });
    await screen.findAllByTestId('bookmark-card');
    expect(screen.queryByTestId('bookmark-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bookmark-pin')).not.toBeInTheDocument();
  });

  it('pins a bookmark with one PUT and refetches the list', async () => {
    const fetchMock = stubFetch();
    renderPage();
    const cards = await screen.findAllByTestId('bookmark-card');
    await userEvent.click(within(cards[1]!).getByTestId('bookmark-pin'));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(String(put![0])).toContain('/api/runs/r2/bookmark');
      expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ pinned: true });
    });
    await waitFor(() => {
      const lists = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/projects/demo/bookmarks'));
      expect(lists.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('asks the server for the caller’s own bookmarks with scope=mine', async () => {
    const fetchMock = stubFetch();
    renderPage({}, '/projects/demo/bookmarks?scope=mine');
    await screen.findAllByTestId('bookmark-card');
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/projects/'))![0]);
    expect(url).toContain('scope=mine');
  });

  it('reads an empty search result as a search, not as an empty project', async () => {
    stubFetch({ ...LIST, total: 0, pinned_count: 0, bookmarks: [] });
    renderPage({}, '/projects/demo/bookmarks?q=zzz');
    expect(await screen.findByText('No bookmarks match “zzz”')).toBeInTheDocument();
  });
});

describe('Bookmark button (run header)', () => {
  function renderButton(ctx: Partial<ProjectValue> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const value: ProjectValue = {
      project,
      slug: 'demo',
      readOnly: false,
      archived: false,
      viewer: false,
      canManage: false,
      isAdmin: false,
      ...ctx,
    };
    return render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <ProjectContext.Provider value={value}>
              <BookmarkButton runId="r9" runName="Run r9" />
            </ProjectContext.Provider>
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('saves a new bookmark with the note, visibility and pin from the dialog', async () => {
    const fetchMock = stubFetch();
    renderButton();
    const button = await screen.findByTestId('bookmark-button');
    expect(button).toHaveTextContent('Bookmark');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Bookmark run')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'keep');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Public' }));
    await userEvent.click(within(dialog).getByRole('switch'));
    await userEvent.click(within(dialog).getByTestId('bookmark-save'));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({
        note: 'keep',
        visibility: 'public',
        pinned: true,
      });
    });
  });

  it('is absent while the project is read-only for the caller', () => {
    stubFetch();
    renderButton({ readOnly: true, archived: true });
    expect(screen.queryByTestId('bookmark-button')).not.toBeInTheDocument();
  });
});
