import { useEffect, type RefObject } from 'react';
import { computeShift, isSuspended, type DetailSpan } from './stickyShift';

/** Geometry that only changes with layout, in the parent's scroll-content space (independent of `scrollTop`). */
interface Geometry {
  /** Sticky line, px below the top of the parent's visible area. */
  line: number;
  tableTop: number;
  tableH: number;
  headH: number;
  details: DetailSpan[];
}

/**
 * Keep a header under the bars above it while an ancestor (the page scroller) scrolls, without making the
 * table its own vertical scroll container: the header is translated by `--head-shift` on `container`.
 * `top` is the sticky line in px below the top of `parent` (or a function measuring it).
 *
 * Perf round 6 (D1/D9): geometry is measured only when layout changes (ResizeObserver callbacks run after
 * layout, so reading rects there costs nothing extra). The scroll handler reads `parent.scrollTop`, runs the
 * pure `computeShift` on the cached numbers and writes only the values that changed: no rect reads, no forced layout.
 */
export function useStickyShift({
  container,
  head,
  parent,
  top,
  details,
  shiftTarget,
  enabled = true,
}: {
  container: RefObject<HTMLElement | null>;
  head: (container: HTMLElement) => HTMLElement | null;
  parent: HTMLElement | null;
  top: number | (() => number) | undefined;
  /** The expanded details inside the container (round 3 P4): the header is held above them. Rects are read only on layout changes. */
  details?: (container: HTMLElement) => HTMLElement[];
  /** Element that receives `--head-shift` (default `container`). The nearer to the moving part, the fewer elements re-style per scroll event. */
  shiftTarget?: (container: HTMLElement) => HTMLElement | null;
  enabled?: boolean;
}): void {
  useEffect(() => {
    const el = container.current;
    if (!enabled || !parent || !el) return undefined;
    let geo: Geometry = { line: 0, tableTop: 0, tableH: 0, headH: 0, details: [] };
    let lastShift = NaN;
    let wasHeld = false;
    let held = false;
    let stuck = false;
    let raf = 0;
    let resumeTimer = 0;
    const observed = new Set<HTMLElement>();

    const measure = () => {
      raf = 0;
      const pr = parent.getBoundingClientRect();
      const st = parent.scrollTop;
      const t = el.getBoundingClientRect();
      const space = (r: DOMRect) => ({ top: r.top - pr.top + st, bottom: r.bottom - pr.top + st });
      geo = {
        line: typeof top === 'function' ? top() : (top ?? 0),
        tableTop: space(t).top,
        tableH: t.height,
        headH: head(el)?.getBoundingClientRect().height ?? 0,
        details: details ? details(el).map((d) => space(d.getBoundingClientRect())) : [],
      };
      apply();
    };
    const apply = () => {
      const input = { ...geo, line: parent.scrollTop + geo.line };
      const shift = Math.round(computeShift(input) * 100) / 100;
      const nowHeld = isSuspended(input);
      if (shift !== lastShift) {
        lastShift = shift;
        (shiftTarget?.(el) ?? el).style.setProperty('--head-shift', `${shift}px`);
      }
      const nowStuck = shift > 0;
      if (nowStuck !== stuck) {
        stuck = nowStuck;
        el.toggleAttribute('data-stuck', nowStuck);
      }
      if (nowHeld !== held) {
        held = nowHeld;
        el.toggleAttribute('data-held', nowHeld);
        if (wasHeld && !nowHeld) {
          // The line left the detail: the header returns at once (a 150ms opacity fade, none under reduced motion).
          el.setAttribute('data-resumed', '');
          window.clearTimeout(resumeTimer);
          resumeTimer = window.setTimeout(() => el.removeAttribute('data-resumed'), 160);
        }
        wasHeld = nowHeld;
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    // Scrolling writes synchronously from cached geometry so the header never trails the page.
    const onScroll = (e: Event) => {
      if (e.target === parent) apply(); // capture also sees the scrolls of inner scrollers
    };

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const sync = () => {
      if (!ro || !details) return;
      const now = new Set(details(el));
      observed.forEach((d) => {
        if (!now.has(d)) {
          ro.unobserve(d);
          observed.delete(d);
          schedule(); // a detail left: its span is gone from the cache
        }
      });
      now.forEach((d) => {
        if (!observed.has(d)) {
          ro.observe(d); // its first observation callback re-measures after layout: no read here
          observed.add(d);
        }
      });
    };
    // Detail rows come and go with expansion and windowing: only (un)observe them, never read geometry here.
    const mo =
      details && typeof MutationObserver !== 'undefined'
        ? new MutationObserver((muts) => {
            if (muts.some((m) => m.addedNodes.length || m.removedNodes.length)) sync();
          })
        : null;

    measure();
    sync();
    parent.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    ro?.observe(el);
    ro?.observe(parent);
    // Content above the table can grow (a section above mounts, its data arrives) and move the table without
    // resizing it: observe every ancestor up to the scroller, whose size changes then.
    for (let n = el.parentElement; n && n !== parent; n = n.parentElement) ro?.observe(n);
    mo?.observe(el, { childList: true, subtree: true });
    void document.fonts?.ready.then(schedule);
    return () => {
      parent.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      mo?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(resumeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `top`, `head` and `details` are read live on each measure
  }, [container, parent, enabled, top]);
}
