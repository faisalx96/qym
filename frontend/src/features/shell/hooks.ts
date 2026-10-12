import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { KEYS, readLocal, writeLocal } from '@/lib/storage';

const TITLE_SUFFIX = 'قيِّم';

/** `document.title = "<title> · قيِّم"` while mounted. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · ${TITLE_SUFFIX}` : TITLE_SUFFIX;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export const COLLAPSE_BREAKPOINT = 760;

/** Sidebar collapse persisted in localStorage['qym:sidebar-collapsed']; auto-collapse ≤760px. */
export function useSidebarCollapsed(): [boolean, () => void, boolean] {
  const narrow = useMediaQuery(`(max-width: ${COLLAPSE_BREAKPOINT}px)`);
  const [stored, setStored] = useState(() => readLocal(KEYS.sidebarCollapsed) === '1');
  const collapsed = narrow || stored;
  const toggle = useCallback(() => {
    setStored((prev) => {
      const next = !prev;
      writeLocal(KEYS.sidebarCollapsed, next ? '1' : '0');
      return next;
    });
  }, []);
  return [collapsed, toggle, narrow];
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/**
 * Scroll restoration for the shell content scroller (window scrolling is
 * disabled; React Router's <ScrollRestoration> only handles window). Push →
 * top; Back/Forward → the offset saved for that history entry.
 */
export function useContentScrollRestoration(ref: React.RefObject<HTMLElement | null>): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const offsets = useRef(new Map<string, number>());
  const currentKey = useRef(location.key);
  const restoring = useRef(false);

  // Record the offset as the user scrolls: by the time a route change commits the
  // new page is already in the scroller, so reading scrollTop then is too late.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (!restoring.current) offsets.current.set(currentKey.current, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    currentKey.current = location.key;
    if (navigationType !== 'POP') {
      restoring.current = false;
      el.scrollTop = 0;
      return;
    }
    const saved = offsets.current.get(location.key) ?? 0;
    // Content may still be loading; retry for up to ~6 s until the offset holds.
    restoring.current = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      el.scrollTop = saved;
      if (Math.abs(el.scrollTop - saved) > 2 && tries++ < 40) timer = setTimeout(tick, 150);
      else restoring.current = false;
    };
    tick();
    return () => {
      clearTimeout(timer);
      restoring.current = false;
    };
  }, [location.key, navigationType, ref]);
}

/** Last visited active project (used by /reviews, /compare, /run/*). */
export function rememberedProjectSlug(): string | null {
  return readLocal(KEYS.lastProjectSlug);
}
