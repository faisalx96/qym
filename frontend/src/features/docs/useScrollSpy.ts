import { useEffect, useState } from 'react';

/**
 * Active heading for the TOC, measured against `main#shell-content` (the only
 * scroller): the last heading above the reading line (top quarter); at the very
 * bottom the last heading wins so short pages and end-of-page deep links work.
 */
export function useScrollSpy(ids: string[], ready: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const root = document.getElementById('shell-content');
    if (!ready || !root || !ids.length) return;
    let raf = 0;
    const update = () => {
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.25;
      let current = ids[0]!;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = ids[ids.length - 1]!;
      setActive(current);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener('scroll', onScroll);
    };
  }, [ids, ready]);
  return active;
}
