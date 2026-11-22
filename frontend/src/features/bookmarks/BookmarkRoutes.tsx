/** /projects/:slug/bookmarks[/*] dispatcher: the groups list, or one group's page (lazy: it carries the runs table). */
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { BookmarksPage } from './BookmarksPage';
import { parseBookmarkRoute } from './lib/route';

const BookmarkGroupPage = lazy(() =>
  import('./BookmarkGroupPage').then((m) => ({ default: m.BookmarkGroupPage })),
);

export function BookmarkRoutes() {
  const params = useParams();
  const route = parseBookmarkRoute(params['*']);
  if (route.mode === 'group' && route.groupId)
    return (
      <Suspense fallback={null}>
        <BookmarkGroupPage groupId={route.groupId} />
      </Suspense>
    );
  return <BookmarksPage />;
}

export default BookmarkRoutes;
