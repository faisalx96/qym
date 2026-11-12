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

/** Where a fixed box inside `el` has its origin: a transformed or contained parent moves it off the window corner. */
function fixedOrigin(el: Element): { x: number; y: number } {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none';
  el.append(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { x: r.left, y: r.top };
}

/** The reason box's border-box size (its computed width and height are the content box). */
function boxSize(el: Element): { w: number; h: number } {
  const s = getComputedStyle(el, '::after');
  const n = (v: string) => parseFloat(v) || 0;
  const w = n(s.width);
  const h = n(s.height);
  const extraW =
    s.boxSizing === 'border-box'
      ? 0
      : n(s.paddingLeft) + n(s.paddingRight) + n(s.borderLeftWidth) + n(s.borderRightWidth);
  const extraH =
    s.boxSizing === 'border-box'
      ? 0
      : n(s.paddingTop) + n(s.paddingBottom) + n(s.borderTopWidth) + n(s.borderBottomWidth);
  return {
    w: w > 0 ? w + extraW : FALLBACK_W,
    h: h > 0 ? h + extraH : FALLBACK_H,
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
  const o = fixedOrigin(el);
  x -= o.x;
  y -= o.y;
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
