import { useEffect, useState } from 'react';

/**
 * Active heading for the TOC: IntersectionObserver rooted at the shell scroller
 * (`main#shell-content`, the only scroller), 25% band from the top like the
 * vanilla docs.js. Re-runs when the heading list changes (page swap).
 */
export function useScrollSpy(ids: string[], ready: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !ids.length || typeof IntersectionObserver === 'undefined') return;
    const root = document.getElementById('shell-content');
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => Boolean(e));
    if (!els.length) return;
    setActive(els[0]!.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive((entry.target as HTMLElement).id);
      },
      { root, rootMargin: '0px 0px -75% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids, ready]);
  return active;
}
