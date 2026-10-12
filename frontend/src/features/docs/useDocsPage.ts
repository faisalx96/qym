import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useDocumentTitle } from '@/features/shell/hooks';
import { FIRST_PAGE, docsPath, findPage, loadPage, neighbours, type DocsPagePayload, type DocsPageRef } from './content';
import { scrollToHeading } from './DocsArticle';

export interface DocsPageState {
  ref: DocsPageRef;
  payload: DocsPagePayload | null | undefined; // undefined = loading, null = not written yet
  error: unknown;
  prev: DocsPageRef | null;
  next: DocsPageRef | null;
  headingIds: string[];
  activeHash: string;
}

/**
 * Route → page: resolves :section/:page (unknown → first page, replace),
 * loads the compiled body (cached), keeps the previous article mounted while
 * the next one loads, scrolls to `#heading` after render (else to the top of
 * the shell scroller) and sets the document title.
 */
export function useDocsPage(): DocsPageState {
  const { section, page } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const ref = findPage(section, page);
  useEffect(() => {
    if (!ref) navigate(docsPath(FIRST_PAGE), { replace: true });
  }, [ref, navigate]);
  const current = ref ?? FIRST_PAGE;
  const [state, setState] = useState<{ key: string; payload: DocsPagePayload | null | undefined; error: unknown }>({
    key: current.key,
    payload: undefined,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    loadPage(current.key)
      .then((payload) => !cancelled && setState({ key: current.key, payload, error: null }))
      .catch((error: unknown) => !cancelled && setState({ key: current.key, payload: null, error }));
    return () => {
      cancelled = true;
    };
  }, [current.key]);
  useDocumentTitle(`${current.title} · Docs`);
  const loaded = state.key === current.key ? state.payload : undefined;
  const headingIds = useMemo(() => (loaded ? loaded.headings.map((h) => h.id) : []), [loaded]);
  const heading = hash.replace(/^#/, '');
  // After the article renders: deep-link heading or top. Runs on page change and hash change.
  useLayoutEffect(() => {
    if (loaded === undefined) return;
    if (heading && scrollToHeading(heading, false)) return;
    if (!heading) {
      const scroller = document.getElementById('shell-content');
      if (scroller) scroller.scrollTop = 0;
    }
  }, [loaded, heading, current.key]);
  const { prev, next } = neighbours(current);
  return {
    ref: current,
    payload: loaded,
    error: state.key === current.key ? state.error : null,
    prev,
    next,
    headingIds,
    activeHash: heading,
  };
}
