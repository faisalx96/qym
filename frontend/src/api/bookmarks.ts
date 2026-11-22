/**
 * Run bookmarks in groups (platform api/bookmarks.py): a person's saved runs, each with a markdown note, filed in one
 * of their bookmark groups. A bookmark is private (its author only) or public (every member of the project); a group
 * is its owner's, who may pin it (pinned groups lead the owner's list, newest pin first), and shows to other members
 * when it holds a public bookmark.
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
  group: { id: string; name: string };
  visibility: BookmarkVisibility;
  note: string;
  created_at: string | null;
  updated_at: string | null;
  /** The caller wrote it: the one bookmark they may change. */
  is_mine: boolean;
  user: BookmarkUser;
  run: BookmarkRun;
}

export interface BookmarkGroup {
  id: string;
  project_id: string;
  project_slug: string | null;
  name: string;
  description: string;
  /** The owner's pin; false on another member's group. */
  pinned: boolean;
  pinned_at: string | null;
  is_mine: boolean;
  owner: BookmarkUser;
  /** Bookmarks the caller may see in it. */
  bookmark_count: number;
  created_at: string | null;
  updated_at: string | null;
}

/** A group with the bookmarks the caller may see and the ids of their runs (the group page's runs list). */
export interface BookmarkGroupDetail extends BookmarkGroup {
  run_ids: string[];
  bookmarks: Bookmark[];
}

export interface BookmarkGroupList {
  project_id: string;
  project_slug: string;
  scope: BookmarkScope;
  groups: BookmarkGroup[];
}

export interface BookmarkList {
  project_id: string;
  project_slug: string;
  scope: BookmarkScope;
  total: number;
  bookmarks: Bookmark[];
}

/** The run page's view: the caller's own bookmark and the public ones of other members. */
export interface RunBookmarks {
  run_id: string;
  mine: Bookmark | null;
  others: Bookmark[];
}

/** An omitted field keeps its value on the server; `group_id` moves the bookmark. */
export interface BookmarkWrite {
  group_id?: string;
  visibility?: BookmarkVisibility;
  note?: string;
}

export interface GroupWrite {
  name: string;
  description: string;
}

export interface GroupPatch {
  name?: string;
  description?: string;
  pinned?: boolean;
}

/** The server's caps (api/bookmarks.py). */
export const BOOKMARK_NOTE_MAX = 20_000;
export const GROUP_NAME_MAX = 120;
export const GROUP_DESCRIPTION_MAX = 4_000;
export const BOOKMARK_LIST_MAX = 200;
export const DEFAULT_GROUP_NAME = 'General';

const enc = encodeURIComponent;

export const bookmarkKeys = {
  all: ['bookmarks'] as const,
  groups: (slug: string, scope: BookmarkScope) => ['bookmarks', 'groups', slug, scope] as const,
  group: (groupId: string) => ['bookmarks', 'group', groupId] as const,
  list: (slug: string, scope: BookmarkScope, q: string, groupId: string | null) =>
    ['bookmarks', 'project', slug, scope, q, groupId] as const,
  run: (runId: string) => ['bookmarks', 'run', runId] as const,
};

export function useBookmarkGroups(slug: string, scope: BookmarkScope = 'all', enabled = true) {
  return useQuery({
    queryKey: bookmarkKeys.groups(slug, scope),
    queryFn: () => apiFetch<BookmarkGroupList>(`/api/projects/${enc(slug)}/bookmark-groups?scope=${scope}`),
    enabled: enabled && Boolean(slug),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useBookmarkGroup(groupId: string, enabled = true) {
  return useQuery({
    queryKey: bookmarkKeys.group(groupId),
    queryFn: () => apiFetch<BookmarkGroupDetail>(`/api/bookmark-groups/${enc(groupId)}`),
    enabled: enabled && Boolean(groupId),
    retry: false,
  });
}

export function useProjectBookmarks(
  slug: string,
  scope: BookmarkScope,
  q: string,
  groupId: string | null = null,
  enabled = true,
) {
  return useQuery({
    queryKey: bookmarkKeys.list(slug, scope, q, groupId),
    queryFn: () => {
      const params = new URLSearchParams({ scope, limit: String(BOOKMARK_LIST_MAX) });
      if (q) params.set('q', q);
      if (groupId) params.set('group_id', groupId);
      return apiFetch<BookmarkList>(`/api/projects/${enc(slug)}/bookmarks?${params.toString()}`);
    },
    enabled: enabled && Boolean(slug),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useRunBookmarks(runId: string, enabled = true) {
  return useQuery({
    queryKey: bookmarkKeys.run(runId),
    queryFn: () => apiFetch<RunBookmarks>(`/api/runs/${enc(runId)}/bookmarks`),
    enabled: enabled && Boolean(runId),
    retry: false,
  });
}

/** Create or update the caller's bookmark of a run (PUT: 201 new, 200 changed). */
export function saveBookmark(runId: string, body: BookmarkWrite): Promise<Bookmark> {
  return apiFetch<Bookmark>(`/api/runs/${enc(runId)}/bookmark`, { method: 'PUT', body });
}

export function removeBookmark(runId: string): Promise<{ ok: boolean; removed: boolean }> {
  return apiFetch(`/api/runs/${enc(runId)}/bookmark`, { method: 'DELETE' });
}

export function createGroup(slug: string, body: GroupWrite): Promise<BookmarkGroup> {
  return apiFetch<BookmarkGroup>(`/api/projects/${enc(slug)}/bookmark-groups`, { method: 'POST', body });
}

export function updateGroup(groupId: string, body: GroupPatch): Promise<BookmarkGroup> {
  return apiFetch<BookmarkGroup>(`/api/bookmark-groups/${enc(groupId)}`, { method: 'PATCH', body });
}

export function deleteGroup(groupId: string): Promise<{ ok: boolean; bookmarks_removed: number }> {
  return apiFetch(`/api/bookmark-groups/${enc(groupId)}`, { method: 'DELETE' });
}

function useInvalidating<TArgs, TOut>(fn: (args: TArgs) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: bookmarkKeys.all }),
  });
}

/** Create or update the caller's bookmark of a run; every bookmark query refetches. */
export function useSaveBookmark(runId: string) {
  return useInvalidating((body: BookmarkWrite) => saveBookmark(runId, body));
}

export function useRemoveBookmark(runId: string) {
  return useInvalidating(() => removeBookmark(runId));
}

export function useCreateGroup(slug: string) {
  return useInvalidating((body: GroupWrite) => createGroup(slug, body));
}

export function useUpdateGroup(groupId: string) {
  return useInvalidating((body: GroupPatch) => updateGroup(groupId, body));
}

export function useDeleteGroup(groupId: string) {
  return useInvalidating(() => deleteGroup(groupId));
}
