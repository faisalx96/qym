/**
 * Jump the shell scroller to an element and keep it aligned while the layout settles: lazy report sections above it
 * mount and grow after the jump. Instant (never smooth); a wheel, touch or key press ends the re-alignment.
 */
export function alignToElement(el: Element, host?: Element | null, settleMs = 2000): void {
  el.scrollIntoView({ block: 'start' });
  const target = host ?? document.getElementById('shell-content')?.firstElementChild;
  if (!target || typeof ResizeObserver === 'undefined') return;
  const events = ['wheel', 'touchstart', 'keydown'];
  let done = false;
  const stop = () => {
    done = true;
    ro.disconnect();
    clearTimeout(timer);
    events.forEach((t) => window.removeEventListener(t, stop));
  };
  const ro = new ResizeObserver(() => {
    if (!done) el.scrollIntoView({ block: 'start' });
  });
  const timer = setTimeout(stop, settleMs);
  ro.observe(target);
  events.forEach((t) => window.addEventListener(t, stop, { passive: true, once: true }));
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
