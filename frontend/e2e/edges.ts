/// <reference lib="dom" />
/**
 * Round 7 (Q1, D3): measuring the boundary of the frozen columns in the browser. The probes run inside the page and read
 * only what a reader can see: the elements stacked at a point, the computed shadow of the pinned cells, the boxes of the
 * rows. `table` is a selector for the `[data-testid=data-table]` card (or a wrapper that contains one).
 */
import type { Page } from '@playwright/test';

export interface PinnedCell {
  tag: string;
  edge: 'start' | 'end';
  shadow: string;
  inDetail: boolean;
  rail: boolean;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface EdgeReport {
  /** `[data-edge]` elements and live ::before / ::after fades of the body host. */
  overlays: number;
  cells: PinnedCell[];
  /** Gaps (px) between consecutive pinned-edge cells of one side (cells of tables nested in a detail row are left out), per side: rows that have no pinned cell. */
  gaps: { start: number[]; end: number[] };
  /** Top of the first header row, bottom of the last body row. */
  headTop: number;
  lastRowBottom: number;
  lineTop: { start: number | null; end: number | null };
  lineBottom: { start: number | null; end: number | null };
  detailRows: Array<{ height: number; strip: boolean }>;
  railHeight: number | null;
  scrollOverflow: boolean;
}

export async function edgeReport(page: Page, table: string): Promise<EdgeReport> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const card = root.matches('[data-testid=data-table]')
      ? root
      : root.querySelector('[data-testid=data-table]')!;
    const host = card.querySelector<HTMLElement>('[class*="bodyHost"]');
    let overlays = card.querySelectorAll('[data-edge]').length;
    if (host)
      for (const p of ['::before', '::after']) {
        const cs = getComputedStyle(host, p);
        if (cs.content !== 'none' && cs.content !== 'normal' && cs.display !== 'none') overlays += 1;
      }
    const tbl = card.querySelector('table');
    const cells: PinnedCell[] = [];
    for (const c of Array.from(tbl?.querySelectorAll<HTMLElement>('[data-pin-edge]') ?? [])) {
      const r = c.getBoundingClientRect();
      if (r.height === 0) continue;
      const shadow = getComputedStyle(c).boxShadow;
      cells.push({
        tag: c.tagName.toLowerCase(),
        edge: c.getAttribute('data-pin-edge') as 'start' | 'end',
        shadow,
        inDetail: Boolean(c.closest('tr[data-detail-row]')),
        rail: shadow.includes('rgb(') && shadow.split('inset').length > 2,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      });
    }
    const gapsOf = (side: string): number[] => {
      const s = cells.filter((c) => c.edge === side && !c.inDetail).sort((a, b) => a.top - b.top);
      const g: number[] = [];
      for (let i = 1; i < s.length; i++)
        if (s[i]!.top - s[i - 1]!.bottom > 1) g.push(s[i]!.top - s[i - 1]!.bottom);
      return g;
    };
    const ext = (side: string, k: 'top' | 'bottom'): number | null => {
      const s = cells.filter((c) => c.edge === side && !c.inDetail);
      return s.length
        ? k === 'top'
          ? Math.min(...s.map((c) => c.top))
          : Math.max(...s.map((c) => c.bottom))
        : null;
    };
    const firstTh = tbl?.querySelector('thead tr:first-child th')?.getBoundingClientRect();
    const rows = Array.from(tbl?.querySelectorAll('tbody > tr:not([data-spacer])') ?? []);
    const rail = card.querySelector('[data-testid=table-scroll-rail]')?.getBoundingClientRect();
    const scroller = card.querySelector<HTMLElement>('[data-dt-scroller]');
    return {
      overlays,
      cells,
      gaps: { start: gapsOf('start'), end: gapsOf('end') },
      headTop: firstTh?.top ?? 0,
      lastRowBottom: rows.length ? rows[rows.length - 1]!.getBoundingClientRect().bottom : 0,
      lineTop: { start: ext('start', 'top'), end: ext('end', 'top') },
      lineBottom: { start: ext('start', 'bottom'), end: ext('end', 'bottom') },
      detailRows: Array.from(tbl?.querySelectorAll<HTMLElement>('tbody > tr[data-detail-row]') ?? []).map(
        (r) => ({
          height: r.getBoundingClientRect().height,
          strip: r.hasAttribute('data-strip-row'),
        }),
      ),
      railHeight: rail ? rail.height : null,
      scrollOverflow: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false,
    };
  }, table);
}

export interface Covered {
  text: string;
  of: string;
  at: string;
  px: number;
  by: string;
}

/**
 * Text that something other than its own cell covers. Each visible text node of the table is clipped to the part the
 * reader can see (inside the scroller, below the sticky header, not under a pinned column or the page's sticky bars)
 * and probed at its left end, middle and right end: the element stacked on top must be the text's own cell.
 */
export async function coveredText(page: Page, table: string): Promise<Covered[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const card = root.matches('[data-testid=data-table]')
      ? root
      : root.querySelector('[data-testid=data-table]')!;
    const scroller = card.querySelector<HTMLElement>('[data-dt-scroller]') ?? (card as HTMLElement);
    const sr = scroller.getBoundingClientRect();
    let left = Math.max(sr.left, 0);
    let right = Math.min(sr.right, innerWidth);
    let top = Math.max(sr.top, 0);
    let bottom = Math.min(sr.bottom, innerHeight);
    for (const h of Array.from(card.querySelectorAll<HTMLElement>('thead th[data-pin]'))) {
      const r = h.getBoundingClientRect();
      if (h.getAttribute('data-pin') === 'start') left = Math.max(left, r.right);
      else right = Math.min(right, r.left);
    }
    // the mirrored rail sticks to the bottom of the viewport over the last rows
    const railBox = card.querySelector('[data-testid=table-scroll-rail]')?.getBoundingClientRect();
    if (railBox) bottom = Math.min(bottom, railBox.top);
    const thead = card.querySelector('thead')?.getBoundingClientRect();
    if (thead) top = Math.max(top, thead.bottom);
    // the page's own sticky bars (run navigation, filter bar) and the app header sit above the table
    for (const bar of Array.from(
      document.querySelectorAll<HTMLElement>('[data-run-nav], [data-run-filters], header'),
    )) {
      const cs = getComputedStyle(bar);
      if (cs.position === 'sticky' || cs.position === 'fixed')
        top = Math.max(top, bar.getBoundingClientRect().bottom);
    }
    const out: Array<{ text: string; of: string; at: string; px: number; by: string }> = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = (n.textContent ?? '').trim();
      const el = n.parentElement!;
      // (the help marker keeps its definitions in the DOM for assistive technology, off screen)
      const skip =
        '[aria-hidden=true], [data-pin], [data-testid=table-scroll-rail], thead, [class*="defs"], [class*="srOnly"]';
      if (!txt || el.closest(skip)) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const r of Array.from(rg.getClientRects())) {
        // a cell clips its own text (overflow hidden / ellipsis): only the part inside the cell is on screen
        const box = (el.closest('td, th, li') ?? el).getBoundingClientRect();
        const l = Math.max(r.left, left, box.left);
        const rr = Math.min(r.right, right, box.right);
        const cy = (r.top + r.bottom) / 2;
        if (rr - l < 2 || cy < top + 1 || cy > bottom - 1 || cy < box.top || cy > box.bottom) continue;
        const cell = el.closest('td, th, li') ?? el;
        for (const x of [l + 1, (l + rr) / 2, rr - 1]) {
          const hit = document.elementsFromPoint(x, cy)[0];
          if (!hit || hit === cell || cell.contains(hit) || hit.contains(el)) continue;
          out.push({
            text: txt.slice(0, 30),
            at: `x${Math.round(x)} y${Math.round(cy)} cell ${Math.round(box.left)}-${Math.round(box.right)} hit ${Math.round(hit.getBoundingClientRect().left)}-${Math.round(hit.getBoundingClientRect().right)} left${Math.round(left)} right${Math.round(right)}`,
            of: `${el.tagName.toLowerCase()}<${el.parentElement?.tagName.toLowerCase()}.${String(el.parentElement?.className).slice(0, 30)}<${el.parentElement?.parentElement?.className.toString().slice(0, 30)}`,
            px: rr - l,
            by: `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`,
          });
          break;
        }
      }
    }
    return out;
  }, table);
}

/** WCAG contrast of an element's text colour against its first opaque ancestor background. */
export async function contrastOf(page: Page, selector: string, textMatch?: string): Promise<number[]> {
  return page.evaluate(
    ([sel, match]) => {
      const parse = (c: string): number[] => {
        const n = c.match(/-?[\d.]+/g)!.map(Number);
        return c.startsWith('color(')
          ? [n[0]! * 255, n[1]! * 255, n[2]! * 255, n[3] ?? 1]
          : [n[0]!, n[1]!, n[2]!, n[3] ?? 1];
      };
      const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
      const out: number[] = [];
      const re = match ? new RegExp(match) : null;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        if (!el.getBoundingClientRect().width) continue;
        // with a pattern, only the elements whose own text matches (the value, not the bar around it)
        if (re && !Array.from(el.childNodes).some((n) => n.nodeType === 3 && re.test(n.textContent ?? '')))
          continue;
        const fg = parse(getComputedStyle(el).color);
        let bg = [18, 18, 24, 1];
        for (let n: HTMLElement | null = el; n; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c[3]! > 0.5) {
            bg = c;
            break;
          }
        }
        const a = lum(fg);
        const b = lum(bg);
        out.push((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
      }
      return out;
    },
    [selector, textMatch ?? ''] as const,
  );
}

/** The computed shadow `--border-strong` draws on the cell's inner side (start: the right side in LTR). */
export const LINE_START = 'rgb(82, 82, 108) -1px 0px 0px 0px inset';
export const LINE_END = 'rgb(82, 82, 108) 1px 0px 0px 0px inset';
