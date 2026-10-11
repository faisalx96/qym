/**
 * Offset of an element inside the shell scroller (react-virtual `scrollMargin`).
 * Re-measured whenever the element, the scroller or any ancestor in between
 * resizes (hero expanding, filter chips wrapping), never on a render loop.
 */
import { useEffect, useState, type RefObject } from 'react';

export function useShellScroller(): HTMLElement | null {
  const [el] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.getElementById('shell-content'),
  );
  return el;
}

export function useScrollMargin(ref: RefObject<HTMLElement | null>, scroller: HTMLElement | null): number {
  const [margin, setMargin] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !scroller) return undefined;
    const measure = () => {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      setMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    for (let n: HTMLElement | null = el; n && n !== scroller; n = n.parentElement) ro.observe(n);
    return () => ro.disconnect();
  }, [ref, scroller]);
  return margin;
}
