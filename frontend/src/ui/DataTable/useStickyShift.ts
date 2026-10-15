import { useEffect, type RefObject } from 'react';
import { computeShift, isSuspended, type DetailSpan } from './stickyShift';

/**
 * Keep a header under the bars above it while an ancestor (the page scroller) scrolls, without making the
 * table its own vertical scroll container: the header is translated by `--head-shift` on `container`.
 * `top` is the sticky line in px below the top of `parent` (or a function measuring it live).
 */
export function useStickyShift({
  container,
  head,
  parent,
  top,
  details,
  enabled = true,
}: {
  container: RefObject<HTMLElement | null>;
  head: (container: HTMLElement) => HTMLElement | null;
  parent: HTMLElement | null;
  top: number | (() => number) | undefined;
  /** Viewport spans of the expanded details inside the container: the header is held above them (round 3 P4). */
  details?: (container: HTMLElement) => DetailSpan[];
  enabled?: boolean;
}): void {
  useEffect(() => {
    const el = container.current;
    if (!enabled || !parent || !el) return undefined;
    let raf = 0;
    let wasHeld = false;
    const update = () => {
      raf = 0;
      const line = typeof top === 'function' ? top() : (top ?? 0);
      const t = el.getBoundingClientRect();
      const h = head(el)?.getBoundingClientRect().height ?? 0;
      const y = parent.getBoundingClientRect().top + line;
      const input = { line: y, tableTop: t.top, tableH: t.height, headH: h, details: details?.(el) ?? [] };
      const shift = computeShift(input);
      const held = isSuspended(input);
      if (wasHeld && !held) {
        // The line left the detail: the header returns at once (a 150ms opacity fade, none under reduced motion).
        el.setAttribute('data-resumed', '');
        window.setTimeout(() => el.removeAttribute('data-resumed'), 160);
      }
      wasHeld = held;
      el.style.setProperty('--head-shift', `${shift}px`);
      el.toggleAttribute('data-stuck', shift > 0);
      el.toggleAttribute('data-held', held);
    };
    // Measure/resize changes may wait for a frame; scrolling writes synchronously so the header never trails it.
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onScroll = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      update();
    };
    update();
    parent.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', on);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(on);
    ro?.observe(el);
    ro?.observe(parent);
    return () => {
      parent.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', on);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `top` and `head` are read live on each update
  }, [container, parent, enabled, top]);
}
