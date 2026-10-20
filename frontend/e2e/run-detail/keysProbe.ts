/// <reference lib="dom" />
/**
 * Round 7, D2: the in-page key / value probe (a port of docs/internal/ui-migration/redesign7/measure/d2-probe.mts that reads
 * the data-part hooks). Passed to page.evaluate, so it must stay self-contained.
 *
 * Per key row: the key's text box against the value's, the row's actions and its own box.
 *   keyClipPx       text wider than the key's box (clipped by overflow, or painted outside the box)
 *   ellipsis        text-overflow ellipsis actually active
 *   overlapPx       horizontal overlap of the key's painted text with the value's painted text on the same line
 *   overlapActPx    the same against the Expand all / Collapse all / Copy buttons of the row
 *   gapPx           value inline-start edge minus key inline-end edge (same line only)
 *   keyBeyondRowPx  how far the key's text reaches past the row's box
 */
export type ProbeKind = 'tree' | 'sections' | 'facts';

export interface KeyRowReport {
  region: string;
  depth: number;
  key: string;
  rendered: string;
  hasTitle: boolean;
  keyDir: string | null;
  keyLang: string | null;
  keyLines: number;
  keyTextW: number;
  keyBoxW: number;
  keyLeft: number;
  keyBoxLeft: number;
  chevronRight: number | null;
  keyClipPx: number;
  scrollOverflow: boolean;
  ellipsis: boolean;
  textOverflow: string;
  whiteSpace: string;
  textTransform: string;
  overlapPx: number;
  overlapActPx: number;
  valueOverActPx: number;
  gapPx: number | null;
  valueBelowKey: boolean | null;
  valueDir: string | null;
  keyBeyondRowPx: number;
  rowH: number;
  rowW: number;
  valueLeft: number | null;
  keyRight: number;
  valueTop: number | null;
  keyBottom: number;
  actionsOnOwnLine: boolean | null;
}

export function keyProbe([rootSel, kind]: [string, ProbeKind]): KeyRowReport[] | null {
  const root = document.querySelector(rootSel);
  if (!root) return null;
  const text = (el: Element) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rs = Array.from(rg.getClientRects()).filter((r) => r.width > 0);
    if (!rs.length) return null;
    return {
      l: Math.min(...rs.map((r) => r.left)),
      r: Math.max(...rs.map((r) => r.right)),
      t: Math.min(...rs.map((r) => r.top)),
      b: Math.max(...rs.map((r) => r.bottom)),
      lines: new Set(rs.map((r) => Math.round(r.top))).size,
    };
  };
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom };
  };
  type B = { l: number; r: number; t: number; b: number };
  const same = (a: B, b: B) => Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
  const ovl = (a: B, b: B) => (same(a, b) ? Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) : 0);
  const rows: KeyRowReport[] = [];
  const add = (
    region: string,
    depth: number,
    keyEl: Element | null,
    valEl: Element | null,
    actEls: Array<Element | null>,
    rowEl: Element,
    chevron: Element | null,
  ) => {
    if (!keyEl) return;
    const kt = text(keyEl);
    const kb = box(keyEl);
    const cs = getComputedStyle(keyEl);
    const clipped = keyEl.scrollWidth > keyEl.clientWidth + 1;
    const ellipsis = cs.textOverflow === 'ellipsis' && clipped;
    const keyPaint = kt && { ...kt, r: ellipsis || cs.overflowX === 'hidden' ? Math.min(kt.r, kb.r) : kt.r };
    const vt = valEl ? text(valEl) : null;
    const vb = valEl ? box(valEl) : null;
    const vcs = valEl ? getComputedStyle(valEl) : null;
    const valPaint =
      vt && vb && vcs
        ? {
            ...vt,
            r: vcs.overflowX === 'hidden' ? Math.min(vt.r, vb.r) : vt.r,
            l: vcs.overflowX === 'hidden' ? Math.max(vt.l, vb.l) : vt.l,
          }
        : null;
    const acts = actEls.filter((a): a is Element => Boolean(a)).map(box);
    const rowB = box(rowEl);
    const cb = chevron ? box(chevron) : null;
    rows.push({
      region,
      depth,
      key: (keyEl.textContent ?? '').trim(),
      rendered: (keyEl as HTMLElement).innerText.trim(),
      hasTitle: keyEl.hasAttribute('title'),
      keyDir: keyEl.getAttribute('dir') ?? keyEl.firstElementChild?.getAttribute('dir') ?? null,
      keyLang: keyEl.getAttribute('lang') ?? keyEl.firstElementChild?.getAttribute('lang') ?? null,
      keyLines: kt ? kt.lines : 0,
      keyTextW: kt ? Math.round(kt.r - kt.l) : 0,
      keyBoxW: Math.round(kb.r - kb.l),
      keyLeft: kt ? kt.l : kb.l,
      keyBoxLeft: kb.l,
      chevronRight: cb ? cb.r : null,
      keyClipPx: kt ? Math.round(Math.max(0, kt.r - kb.r, keyEl.scrollWidth - keyEl.clientWidth)) : 0,
      scrollOverflow:
        keyEl.scrollWidth > keyEl.clientWidth + 1 || keyEl.scrollHeight > keyEl.clientHeight + 1,
      ellipsis,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      textTransform: cs.textTransform,
      overlapPx: valPaint && keyPaint ? Math.round(ovl(keyPaint, valPaint)) : 0,
      overlapActPx: keyPaint ? Math.round(Math.max(0, ...acts.map((a) => ovl(keyPaint, a)))) : 0,
      valueOverActPx: valPaint ? Math.round(Math.max(0, ...acts.map((a) => ovl(valPaint, a)))) : 0,
      gapPx: valPaint && keyPaint && same(keyPaint, valPaint) ? Math.round(valPaint.l - keyPaint.r) : null,
      valueBelowKey: vt && kt ? vt.t >= kt.b - 1 : null,
      valueDir: valEl ? (valEl.getAttribute('dir') ?? getComputedStyle(valEl).direction) : null,
      keyBeyondRowPx: keyPaint ? Math.round(Math.max(0, keyPaint.r - rowB.r, rowB.l - keyPaint.l)) : 0,
      rowH: Math.round(rowB.b - rowB.t),
      rowW: Math.round(rowB.r - rowB.l),
      valueLeft: valPaint ? valPaint.l : null,
      keyRight: kt ? kt.r : kb.r,
      valueTop: vt ? vt.t : null,
      keyBottom: kt ? kt.b : kb.b,
      actionsOnOwnLine: acts.length && kt ? acts.every((a) => a.t >= kt.b - 1) : null,
    });
  };
  if (kind === 'tree') {
    for (const row of Array.from(root.querySelectorAll('[data-depth]'))) {
      const head = row.firstElementChild;
      if (!head) continue;
      const toggle = head.querySelector('button[aria-expanded]');
      if (!toggle) continue;
      const keyEl = toggle.querySelector('[data-part=key]');
      const valEl = toggle.querySelector('[data-part=value], [data-part=type]');
      const actions = head.querySelector('[data-part=actions]');
      add(
        'tree',
        Number(row.getAttribute('data-depth')),
        keyEl,
        valEl,
        actions ? Array.from(actions.querySelectorAll('button')) : [],
        head,
        toggle.querySelector('svg'),
      );
    }
  } else if (kind === 'sections') {
    for (const sec of Array.from(root.querySelectorAll('[data-kind][role=group]'))) {
      const head = sec.firstElementChild;
      if (!head) continue;
      const keyEl = head.querySelector('[data-part=key]');
      const valEl = head.querySelector('[data-part=value], [data-kind=string], [class*="scalar"]');
      const actions = head.querySelector('[data-part=actions]');
      add(
        'sections',
        0,
        keyEl,
        valEl,
        actions ? Array.from(actions.querySelectorAll('button')) : [],
        head,
        head.querySelector('svg'),
      );
    }
  } else {
    for (const f of Array.from(root.querySelectorAll('dl[data-part=facts] > div')))
      add('facts', 0, f.querySelector('[data-part=key]'), f.querySelector('[data-part=value]'), [], f, null);
    for (const p of Array.from(root.querySelectorAll('[data-part=prose]')))
      add(
        'eyebrow',
        0,
        p.querySelector('[data-part=eyebrow]'),
        p.querySelector('[data-part=prose-text]'),
        [],
        p,
        null,
      );
  }
  return rows;
}
