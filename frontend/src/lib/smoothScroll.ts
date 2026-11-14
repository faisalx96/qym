/**
 * Smooth scroll of the shell scroller for the section navs of the run page (cv4 C1-1) and the Compare page (cv4 Y10).
 * The target is measured again on every frame, so a lazy section that mounts above it during the travel moves the end point, not the landing. A wheel,
 * touch, pointer or key press stops the travel where it is. No motion under `prefers-reduced-motion`: the caller
 * jumps instead.
 */

/** The reader asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Travel time for a distance in px: 280 ms for a short hop, up to 640 ms across the page. */
export function scrollDuration(distance: number): number {
  const d = Math.abs(distance);
  return Math.round(280 + 360 * Math.min(1, d / 4000));
}

/** Ease in and out (cubic): starts and ends slowly, like a hand on a scroll wheel. */
export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** The scrollTop that puts `el`'s top at the scroller's top less its `scroll-margin-top`, clamped to the range. */
export function sectionScrollTop(scroller: HTMLElement, el: Element): number {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const top =
    el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - margin;
  return Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, Math.round(top)));
}

const STOP_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * Animate `scroller` to `target()` (read each frame). Resolves when the travel ends or the reader stops it; the
 * boolean says whether it reached the target.
 */
export function smoothScrollTo(scroller: HTMLElement, target: () => number): Promise<boolean> {
  return new Promise((resolve) => {
    const from = scroller.scrollTop;
    const duration = scrollDuration(target() - from);
    const start = performance.now();
    let frame = 0;
    let done = false;
    const finish = (reached: boolean) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      STOP_EVENTS.forEach((t) => window.removeEventListener(t, stop, true));
      resolve(reached);
    };
    const stop = () => finish(false);
    const step = (now: number) => {
      const t = (now - start) / duration;
      const to = target();
      scroller.scrollTop = from + (to - from) * easeInOutCubic(t);
      if (t >= 1) finish(true);
      else frame = requestAnimationFrame(step);
    };
    STOP_EVENTS.forEach((t) => window.addEventListener(t, stop, { capture: true, passive: true }));
    frame = requestAnimationFrame(step);
  });
}
