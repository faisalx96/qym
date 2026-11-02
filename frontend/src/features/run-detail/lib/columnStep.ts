/**
 * The four steps of the report column (round 3, run-detail.md section 0). Every responsive rule of the run page is a
 * container query on the report column with these widths; the hook exposes the same step as `data-step` so tests and
 * logic read what the CSS did.
 */
import { useEffect, useRef, useState } from 'react';

export type ColumnStep = 'wide' | 'mid' | 'narrow' | 'compact';

/** wide 1100+, mid 900 to 1099, narrow 560 to 899, compact up to 559 (the CSS container queries use the same numbers). */
export function stepForWidth(width: number): ColumnStep {
  if (width >= 1100) return 'wide';
  if (width >= 900) return 'mid';
  if (width >= 560) return 'narrow';
  return 'compact';
}

/** Measure an element (ResizeObserver) and return its width and step; `fallback` until measured. */
export function useColumnStep<T extends HTMLElement>(
  fallback = 1100,
): [React.RefObject<T>, ColumnStep, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref as React.RefObject<T>, stepForWidth(width), width];
}
