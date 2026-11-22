/** /projects/:slug/bookmarks[/:groupId] — the groups list, or one group's page. */
import { projectPath } from '@/app/routes';

export interface BookmarkRoute {
  mode: 'list' | 'group';
  groupId: string | null;
}

export function parseBookmarkRoute(splat: string | undefined): BookmarkRoute {
  const groupId = (splat ?? '').split('/').filter(Boolean)[0] ?? null;
  return groupId ? { mode: 'group', groupId } : { mode: 'list', groupId: null };
}

export function bookmarksPath(slug: string, groupId?: string): string {
  return projectPath(slug, groupId ? `bookmarks/${encodeURIComponent(groupId)}` : 'bookmarks');
}
