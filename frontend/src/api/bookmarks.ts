/**
 * Run bookmarks (platform api/bookmarks.py): a person's saved runs, each with a markdown note. A bookmark is private
 * (its author only) or public (every member of the project); pinned bookmarks lead every list, newest pin first.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export type BookmarkVisibility = 'private' | 'public';
export type BookmarkScope = 'all' | 'mine';

export interface BookmarkUser {
  id: string;
  display_name: string;
  email: string;
}

export interface BookmarkRun {
  run_id: string;
  run_name: string;
  external_run_id: string | null;
  task: string | null;
  dataset: string | null;
  model: string | null;
  status: string | null;
  origin: string | null;
  owner_user_id: string | null;
  created_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface Bookmark {
  id: string;
  run_id: string;
  project_id: string;
  project_slug: string | null;
  project_name: string | null;
  visibility: BookmarkVisibility;
  note: string;
  pinned: boolean;
  pinned_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** The caller wrote it: the one bookmark they may change. */
  is_mine: boolean;
  user: BookmarkUser;
  run: BookmarkRun;
}

export interface BookmarkList {
  project_id: string;
  project_slug: string;
  scope: BookmarkScope;
  total: number;
  pinned_count: number;
  bookmarks: Bookmark[];
}

/** The run page's view: the caller's own bookmark and the public ones of other members. */
export interface RunBookmarks {
  run_id: string;
  mine: Bookmark | null;
  others: Bookmark[];
}

/** An omitted field keeps its value on the server. */
export interface BookmarkWrite {
  visibility?: BookmarkVisibility;
  note?: string;
  pinned?: boolean;
}

/** The server's cap on a note (api/bookmarks.py NOTE_MAX_CHARS). */
export const BOOKMARK_NOTE_MAX = 20_000;
/** The server returns at most this many bookmarks per list (LIST_PAGE_MAX). */
export const BOOKMARK_LIST_MAX = 200;

export const bookmarkKeys = {
  all: ['bookmarks'] as const,
  list: (slug: string, scope: BookmarkScope, q: string) => ['bookmarks', 'project', slug, scope, q] as const,
  run: (runId: string) => ['bookmarks', 'run', runId] as const,
};

export function useProjectBookmarks(slug: string, scope: BookmarkScope, q: string, enabled = true) {
  return useQuery({
    queryKey: bookmarkKeys.list(slug, scope, q),
    queryFn: () => {
      const params = new URLSearchParams({ scope, limit: String(BOOKMARK_LIST_MAX) });
      if (q) params.set('q', q);
      return apiFetch<BookmarkList>(`/api/projects/${encodeURIComponent(slug)}/bookmarks?${params.toString()}`);
    },
    enabled: enabled && Boolean(slug),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useRunBookmarks(runId: string, enabled = true) {
  return useQuery({
    queryKey: bookmarkKeys.run(runId),
    queryFn: () => apiFetch<RunBookmarks>(`/api/runs/${encodeURIComponent(runId)}/bookmarks`),
    enabled: enabled && Boolean(runId),
    retry: false,
  });
}

/** Create or update the caller's bookmark of a run (PUT: 201 new, 200 changed). */
export function saveBookmark(runId: string, body: BookmarkWrite): Promise<Bookmark> {
  return apiFetch<Bookmark>(`/api/runs/${encodeURIComponent(runId)}/bookmark`, { method: 'PUT', body });
}

export function removeBookmark(runId: string): Promise<{ ok: boolean; removed: boolean }> {
  return apiFetch(`/api/runs/${encodeURIComponent(runId)}/bookmark`, { method: 'DELETE' });
}

/** Create or update the caller's bookmark of a run; every bookmark list refetches. */
export function useSaveBookmark(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BookmarkWrite) => saveBookmark(runId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: bookmarkKeys.all }),
  });
}

export function useRemoveBookmark(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => removeBookmark(runId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: bookmarkKeys.all }),
  });
}
