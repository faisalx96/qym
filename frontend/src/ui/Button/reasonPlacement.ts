/**
 * Places the disabled-reason box (Button.module.css `.reasonWrap::after`, A-22) inside the window.
 *
 * The box is a fixed-position pseudo-element, so no `overflow: hidden` parent (a menu popover, a scroll area) cuts it.
 * On pointer entry this sets `--reason-x` / `--reason-y` and `data-reason-at` on the wrap:
 * - `above-start`: above the control, start-aligned (the A-22 recipe);
 * - `above-end`: above, aligned to the control's end edge, when a start-aligned box would pass the window end (A-11);
 * - `below-start` / `below-end`: under the control, only when the box does not fit above it in the window;
 * - `side-end` / `side-start`: for a menu item (`data-reason-beside`), beside the menu at the item's row, so the box
 *   covers no other item (A-09).
 */

const GAP = 6;
const EDGE = 8;
const FALLBACK_W = 280;
const FALLBACK_H = 30;

/** The nearest parent that is the containing block of a fixed box (transform, filter, containment), else null. */
function fixedContainer(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (
      (s.transform && s.transform !== 'none') ||
      (s.filter && s.filter !== 'none') ||
      (s.backdropFilter && s.backdropFilter !== 'none') ||
      (s.perspective && s.perspective !== 'none') ||
      /transform|filter|perspective/.test(s.willChange) ||
      /layout|paint|strict|content/.test(s.contain) ||
      (s.containerType && s.containerType !== 'normal')
    )
      return p;
  }
  return null;
}

function boxSize(el: Element): { w: number; h: number } {
  const s = getComputedStyle(el, '::after');
  const w = parseFloat(s.width);
  const h = parseFloat(s.height);
  return {
    w: Number.isFinite(w) && w > 0 ? w : FALLBACK_W,
    h: Number.isFinite(h) && h > 0 ? h : FALLBACK_H,
  };
}

export function placeReason(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const { w, h } = boxSize(el);
  let x: number;
  let y: number;
  let at: string;
  if (el.hasAttribute('data-reason-beside')) {
    const menu = (el.closest('[role="menu"]')?.parentElement ?? el).getBoundingClientRect();
    const end = menu.right + GAP + w <= vw - EDGE || menu.left - GAP - w < EDGE;
    x = end ? menu.right + GAP : menu.left - GAP - w;
    y = Math.min(Math.max(r.top + r.height / 2 - h / 2, EDGE), vh - EDGE - h);
    at = end ? 'side-end' : 'side-start';
  } else {
    const fitsEnd = r.left + w <= vw - EDGE;
    x = fitsEnd ? r.left : Math.max(EDGE, r.right - w);
    const above = r.top - GAP - h >= EDGE || r.bottom + GAP + h > vh - EDGE;
    y = above ? r.top - GAP - h : r.bottom + GAP;
    at = `${above ? 'above' : 'below'}-${fitsEnd ? 'start' : 'end'}`;
  }
  const cb = fixedContainer(el);
  if (cb) {
    const c = cb.getBoundingClientRect();
    x -= c.left + cb.clientLeft;
    y -= c.top + cb.clientTop;
  }
  el.style.setProperty('--reason-x', `${Math.round(x)}px`);
  el.style.setProperty('--reason-y', `${Math.round(y)}px`);
  el.setAttribute('data-reason-at', at);
}

let installed = false;

/** One document listener for every reason box (Button, IconButton, LinkButton, menu items). */
export function installReasonPlacement(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'pointerover',
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const wrap = t.closest<HTMLElement>('[data-reason][data-disabled-reason]');
      if (!wrap) return;
      placeReason(wrap);
      // The box takes its hover size on the next style pass; place it again with the real size.
      requestAnimationFrame(() => placeReason(wrap));
    },
    { capture: true, passive: true },
  );
}

installReasonPlacement();
