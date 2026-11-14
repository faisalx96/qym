/** The re-alignment in progress (one at a time): a new jump or travel ends the old one (cv4 Y2). */
let stopActive: (() => void) | null = null;

/** End the re-alignment in progress, if any: call it before a new travel starts (cv4 Y2). */
export function cancelAlign(): void {
  stopActive?.();
}

/**
 * Jump the shell scroller to an element and keep it aligned while the layout settles: lazy report sections above it
 * mount and grow after the jump. Instant (never smooth); a wheel, touch, pointer or key press ends the re-alignment,
 * and so does the next call (cv4 Y2: a second nav click must not be pulled back to the first section).
 */
export function alignToElement(el: Element, host?: Element | null, settleMs = 2000): void {
  cancelAlign();
  el.scrollIntoView({ block: 'start' });
  const target = host ?? document.getElementById('shell-content')?.firstElementChild;
  if (!target || typeof ResizeObserver === 'undefined') return;
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    ro.disconnect();
    clearTimeout(timer);
    events.forEach((t) => window.removeEventListener(t, stop));
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  const ro = new ResizeObserver(() => {
    if (!done) el.scrollIntoView({ block: 'start' });
  });
  const timer = setTimeout(stop, settleMs);
  ro.observe(target);
  events.forEach((t) => window.addEventListener(t, stop, { passive: true, once: true }));
}

/**
 * Move keyboard focus to a section's heading without scrolling (C091): after a section link, the next Tab starts inside
 * that section instead of at the top of the page. The heading becomes focusable by script only (tabindex -1).
 */
export function focusSectionHeading(section: Element): void {
  const heading = section.querySelector<HTMLElement>('h2, h3');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

let remembered: string | null = null;

/** Remember which report section the reader is in before an action that unmounts the page body (a run removed from a comparison). */
export function rememberScroll(): void {
  const scroller = document.getElementById('shell-content');
  if (!scroller) return;
  const line = scroller.getBoundingClientRect().top + 160;
  let current: string | null = null;
  document.querySelectorAll<HTMLElement>('[data-report-section]').forEach((el) => {
    if (el.getBoundingClientRect().top <= line) current = el.id;
  });
  remembered = current;
}

/** Put the reader back at the remembered section once the body is back (re-aligning while lazy sections settle); a no-op when nothing was remembered. */
export function restoreScroll(): void {
  const id = remembered;
  remembered = null;
  const el = id ? document.getElementById(id) : null;
  if (el) alignToElement(el);
}
