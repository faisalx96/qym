import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark, BookmarkGroup, BookmarkGroupDetail, BookmarkGroupList } from '@/api/bookmarks';
import type { Project } from '@/api/types';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';
import { ToastProvider } from '@/ui';
import { BookmarkButton } from '../BookmarkButton';
import { BookmarkGroupPage } from '../BookmarkGroupPage';
import { BookmarksPage } from '../BookmarksPage';

// The group page hosts the runs table itself; here it is a stub that shows which runs it was given.
vi.mock('@/features/runs-list/RunsPage', () => ({
  RunsPage: ({ scope }: { scope?: { runIds: readonly string[] } }) => (
    <div data-testid="runs-page" data-scoped={scope ? '' : undefined}>
      {scope ? scope.runIds.join(',') : 'all'}
    </div>
  ),
}));

const project = {
  id: 'p1',
  name: 'Demo',
  slug: 'demo',
  is_active: true,
  role: 'MEMBER',
} as unknown as Project;
const me = { id: 'me', display_name: 'Me', email: 'me@x.com' };
const them = { id: 'them', display_name: 'Them', email: 'them@x.com' };

function group(over: Partial<BookmarkGroup> & { id: string; name: string }): BookmarkGroup {
  return {
    project_id: 'p1',
    project_slug: 'demo',
    description: '',
    pinned: false,
    pinned_at: null,
    is_mine: true,
    owner: me,
    bookmark_count: 0,
    created_at: '2026-11-17T10:00:00Z',
    updated_at: '2026-11-17T10:00:00Z',
    ...over,
  };
}

function bookmark(over: Partial<Bookmark> & { id: string; run_id: string }): Bookmark {
  return {
    project_id: 'p1',
    project_slug: 'demo',
    project_name: 'Demo',
    group: { id: 'g1', name: 'Baselines' },
    visibility: 'private',
    note: '',
    created_at: '2026-11-17T10:00:00Z',
    updated_at: '2026-11-17T10:00:00Z',
    is_mine: true,
    user: me,
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

const GROUPS: BookmarkGroupList = {
  project_id: 'p1',
  project_slug: 'demo',
  scope: 'all',
  groups: [
    group({
      id: 'g1',
      name: 'Baselines',
      pinned: true,
      pinned_at: '2026-11-17T11:00:00Z',
      bookmark_count: 2,
    }),
    group({ id: 'g2', name: 'General', bookmark_count: 1, description: 'Everything else' }),
    group({ id: 'g3', name: 'Shared picks', is_mine: false, owner: them, bookmark_count: 1 }),
  ],
};

const DETAIL: BookmarkGroupDetail = {
  ...GROUPS.groups[0]!,
  run_ids: ['r1', 'r2'],
  bookmarks: [
    bookmark({ id: 'b1', run_id: 'r1', note: '**Baseline** for release 4', visibility: 'public' }),
    bookmark({ id: 'b2', run_id: 'r2', note: 'candidate' }),
  ],
};

function stubFetch(overrides: { groups?: BookmarkGroupList; detail?: BookmarkGroupDetail } = {}) {
  const groups = overrides.groups ?? GROUPS;
  const detail = overrides.detail ?? DETAIL;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/bookmark-groups') && url.includes('/api/projects/')) {
      if (init?.method === 'POST') {
        const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
        return body(group({ id: 'g-new', name: String(sent.name) }), 201);
      }
      const mine = url.includes('scope=mine');
      return body({ ...groups, groups: mine ? groups.groups.filter((g) => g.is_mine) : groups.groups });
    }
    if (url.includes('/api/bookmark-groups/')) {
      if (init?.method === 'PATCH') {
        const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
        return body({ ...detail, ...sent });
      }
      if (init?.method === 'DELETE') return body({ ok: true, bookmarks_removed: 2 });
      return body(detail);
    }
    if (url.includes('/api/runs/') && url.endsWith('/bookmarks'))
      return body({ run_id: 'r9', mine: null, others: [] });
    if (url.includes('/api/runs/') && url.endsWith('/bookmark')) {
      const sent = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return body({ ...DETAIL.bookmarks[1], ...sent, run_id: 'r9' }, 201);
    }
    return body({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(node: React.ReactNode, ctx: Partial<ProjectValue> = {}, path = '/projects/demo/bookmarks') {
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
          <ProjectContext.Provider value={value}>{node}</ProjectContext.Provider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Bookmarks page (groups)', () => {
  it('lists the groups with their pin, shared flag, counts and owner, the pinned one first', async () => {
    stubFetch();
    renderAt(<BookmarksPage />);
    const cards = await screen.findAllByTestId('group-card');
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'Baselines',
      'General',
      'Shared picks',
    ]);
    expect(cards[0]).toHaveAttribute('data-pinned');
    expect(within(cards[0]!).getByText('Pinned')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('2 bookmarks')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Everything else')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Shared')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Them')).toBeInTheDocument();
    expect(cards[0]).toHaveAttribute('href', '/projects/demo/bookmarks/g1');
    expect(screen.getByText('3 groups')).toBeInTheDocument();
    expect(screen.getByText('1 pinned')).toBeInTheDocument();
  });

  it('shows pin, edit and remove on the caller’s own groups only, and none on a read-only project', async () => {
    stubFetch();
    const { unmount } = renderAt(<BookmarksPage />);
    const cards = await screen.findAllByTestId('group-card');
    expect(within(cards[0]!).getByTestId('group-pin')).toBeInTheDocument();
    expect(within(cards[0]!).getByTestId('group-edit')).toBeInTheDocument();
    expect(within(cards[2]!).queryByTestId('group-pin')).toBeNull();
    expect(within(cards[2]!).queryByTestId('group-delete')).toBeNull();
    unmount();
    renderAt(<BookmarksPage />, { readOnly: true });
    await screen.findAllByTestId('group-card');
    expect(screen.queryAllByTestId('group-pin')).toHaveLength(0);
    expect(screen.queryByTestId('new-group')).toBeNull();
  });

  it('pins a group with one PATCH and refetches', async () => {
    const fetchMock = stubFetch();
    renderAt(<BookmarksPage />);
    const cards = await screen.findAllByTestId('group-card');
    await userEvent.click(within(cards[1]!).getByTestId('group-pin'));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toContain('/api/bookmark-groups/g2');
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ pinned: true });
    });
  });

  it('creates a group from the New group dialog and opens it', async () => {
    const fetchMock = stubFetch();
    renderAt(<BookmarksPage />);
    await screen.findAllByTestId('group-card');
    await userEvent.click(screen.getByTestId('new-group'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Release candidates');
    await userEvent.click(screen.getByTestId('group-save'));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({ name: 'Release candidates', description: '' });
    });
  });

  it('asks the server for the caller’s own groups with scope=mine', async () => {
    const fetchMock = stubFetch();
    renderAt(<BookmarksPage />, {}, '/projects/demo/bookmarks?scope=mine');
    await screen.findAllByTestId('group-card');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('scope=mine'))).toBe(true);
    expect(screen.queryByText('Shared picks')).toBeNull();
  });
});

describe('Bookmark group page', () => {
  it('shows the group’s runs in the runs table, scoped to its run ids', async () => {
    stubFetch();
    renderAt(<BookmarkGroupPage groupId="g1" />, {}, '/projects/demo/bookmarks/g1');
    expect(await screen.findByRole('heading', { name: 'Baselines' })).toBeInTheDocument();
    const table = screen.getByTestId('runs-page');
    expect(table).toHaveAttribute('data-scoped');
    expect(table).toHaveTextContent('r1,r2');
    expect(screen.getByText('2 bookmarks')).toBeInTheDocument();
    expect(screen.getByTestId('group-pin')).toHaveTextContent('Unpin');
  });

  it('switches to the Notes view with the bookmarks and their actions', async () => {
    stubFetch();
    renderAt(<BookmarkGroupPage groupId="g1" />, {}, '/projects/demo/bookmarks/g1?show=notes');
    const cards = await screen.findAllByTestId('bookmark-card');
    expect(cards).toHaveLength(2);
    expect(screen.queryByTestId('runs-page')).toBeNull();
    expect(within(cards[0]!).getByText('Baseline')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Public')).toBeInTheDocument();
    expect(within(cards[0]!).getByTestId('bookmark-edit')).toBeInTheDocument();
    expect(within(cards[0]!).getByRole('link', { name: 'Run r1' })).toHaveAttribute(
      'href',
      '/projects/demo/runs/r1',
    );
  });

  it('hides the owner actions on another member’s shared group', async () => {
    stubFetch({ detail: { ...DETAIL, is_mine: false, owner: them, pinned: false } });
    renderAt(<BookmarkGroupPage groupId="g1" />, {}, '/projects/demo/bookmarks/g1');
    await screen.findByRole('heading', { name: 'Baselines' });
    expect(screen.queryByTestId('group-pin')).toBeNull();
    expect(screen.queryByTestId('group-delete')).toBeNull();
    expect(screen.getByText('Shared with you')).toBeInTheDocument();
  });
});

describe('Bookmark button (run header)', () => {
  it('saves a new bookmark into the chosen group with the note and visibility', async () => {
    const fetchMock = stubFetch();
    renderAt(<BookmarkButton runId="r9" runName="Run nine" />);
    await userEvent.click(await screen.findByTestId('bookmark-button'));
    const dialog = await screen.findByRole('dialog');
    // The group picker appears once the caller's groups loaded.
    await within(dialog).findByText('Group');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'keep this one');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Public' }));
    await userEvent.click(within(dialog).getByTestId('bookmark-save'));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(String(put![0])).toContain('/api/runs/r9/bookmark');
      // No pick in the dialog: the General group, the caller's default.
      expect(JSON.parse(String(put![1]!.body))).toEqual({
        group_id: 'g2',
        note: 'keep this one',
        visibility: 'public',
      });
    });
  });

  it('is absent while the project is read-only for the caller', () => {
    stubFetch();
    renderAt(<BookmarkButton runId="r9" runName="Run nine" />, { readOnly: true });
    expect(screen.queryByTestId('bookmark-button')).toBeNull();
  });
});
