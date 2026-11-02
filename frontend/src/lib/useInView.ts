/** True once an element has come within `rootMargin` of the viewport (or of `root`); never goes false again when `once`. */
import { useEffect, useState, type RefObject } from 'react';

export interface UseInViewOptions {
  rootMargin?: string;
  /** Stay true after the first sighting (default true). */
  once?: boolean;
  /** Skip observing; the result is always true (non-lazy callers). */
  disabled?: boolean;
}

export function useInView(ref: RefObject<Element | null>, opts: UseInViewOptions = {}): boolean {
  const { rootMargin = '600px 0px', once = true, disabled = false } = opts;
  const unsupported = typeof IntersectionObserver === 'undefined';
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (disabled || unsupported || !el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (hit) setSeen(true);
        else if (!once) setSeen(false);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, once, disabled, unsupported]);
  return disabled || unsupported || seen;
}
