import { useEffect, useRef, type RefObject } from 'react';
import styles from './ScrollCue.module.css';

/** The class that draws the edge fade; put it on the scrolling element together with `useScrollCue`'s ref. */
export const scrollCue = styles.cue!;

/**
 * Marks a horizontally scrolling element with `data-cue-start` / `data-cue-end` while content lies beyond that
 * edge (recomputed on scroll and on resize of the element or its content), so `scrollCue` can fade the edge.
 */
export function useScrollCue<T extends HTMLElement = HTMLDivElement>(): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const pos = Math.abs(el.scrollLeft);
      el.toggleAttribute('data-cue-start', max > 1 && pos > 1);
      el.toggleAttribute('data-cue-end', max > 1 && max - pos > 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);
  return ref;
}
