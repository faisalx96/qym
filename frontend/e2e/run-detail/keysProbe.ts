/// <reference lib="dom" />
/**
 * Round 7, D2: the in-page key / value probe, for the item pane. Passed to page.evaluate, so it must stay
 * self-contained.
 *
 * The pane shows a JSON value as fields (pane/values.tsx `FieldList`): each key is a `dt[data-part=key]` above its
 * value (`dd`) in one field box. The probe reads each key under the given root.
 *   key             the key as written (the text of the key only: a table or group key also holds a count, "3 rows")
 *   rendered        the same text as painted (innerText applies text-transform)
 *   keyClipPx       text wider than the key's box (clipped by overflow, or painted outside the box)
 *   ellipsis        text-overflow ellipsis actually active
 *   overlapPx       horizontal overlap of the key's painted text with the value's painted text on the same line
 *   valueBelowKey   the value starts below the key (the fields recipe of the pane)
 *   keyBeyondRowPx  how far the key's text reaches past the box of its field
 */
export interface KeyRowReport {
  key: string;
  rendered: string;
  hasTitle: boolean;
  keyDir: string | null;
  keyLang: string | null;
  keyLines: number;
  keyBoxW: number;
  keyClipPx: number;
  scrollOverflow: boolean;
  ellipsis: boolean;
  textOverflow: string;
  whiteSpace: string;
  textTransform: string;
  overlapPx: number;
  valueBelowKey: boolean | null;
  keyBeyondRowPx: number;
}

export function keyProbe(rootSel: string): KeyRowReport[] | null {
  const roots = Array.from(document.querySelectorAll(rootSel));
  if (!roots.length) return null;
  type B = { l: number; r: number; t: number; b: number };
  const rectsBox = (rs: DOMRect[]): (B & { lines: number }) | null => {
    const shown = rs.filter((r) => r.width > 0);
    if (!shown.length) return null;
    return {
      l: Math.min(...shown.map((r) => r.left)),
      r: Math.max(...shown.map((r) => r.right)),
      t: Math.min(...shown.map((r) => r.top)),
      b: Math.max(...shown.map((r) => r.bottom)),
      lines: new Set(shown.map((r) => Math.round(r.top))).size,
    };
  };
  const box = (el: Element): B => {
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom };
  };
  const same = (a: B, b: B) => Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
  const ovl = (a: B, b: B) => (same(a, b) ? Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) : 0);
  const rows: KeyRowReport[] = [];
  for (const root of roots) {
    for (const keyEl of Array.from(root.querySelectorAll<HTMLElement>('dt[data-part=key]'))) {
      // the key's own text nodes (the count of a table or group is an element inside the dt)
      const texts = Array.from(keyEl.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE);
      const rects: DOMRect[] = [];
      for (const n of texts) {
        const rg = document.createRange();
        rg.selectNodeContents(n);
        rects.push(...Array.from(rg.getClientRects()));
      }
      const kt = rectsBox(rects);
      const kb = box(keyEl);
      const cs = getComputedStyle(keyEl);
      const clipped = keyEl.scrollWidth > keyEl.clientWidth + 1;
      const field = keyEl.parentElement ?? keyEl;
      const valEl = keyEl.nextElementSibling;
      let vt: (B & { lines: number }) | null = null;
      if (valEl) {
        const rg = document.createRange();
        rg.selectNodeContents(valEl);
        vt = rectsBox(Array.from(rg.getClientRects()));
      }
      const fb = box(field);
      const source = texts.map((n) => n.textContent ?? '').join('');
      const transform = cs.textTransform;
      rows.push({
        key: source.trim(),
        rendered: (transform === 'uppercase'
          ? source.toUpperCase()
          : transform === 'lowercase'
            ? source.toLowerCase()
            : source
        ).trim(),
        hasTitle: keyEl.hasAttribute('title'),
        keyDir: keyEl.getAttribute('dir'),
        keyLang: keyEl.getAttribute('lang'),
        keyLines: kt ? kt.lines : 0,
        keyBoxW: Math.round(kb.r - kb.l),
        keyClipPx: kt ? Math.round(Math.max(0, kt.r - kb.r, kb.l - kt.l)) : 0,
        scrollOverflow: clipped || keyEl.scrollHeight > keyEl.clientHeight + 1,
        ellipsis: cs.textOverflow === 'ellipsis' && clipped,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
        textTransform: transform,
        overlapPx: kt && vt ? Math.round(ovl(kt, vt)) : 0,
        valueBelowKey: kt && vt ? vt.t >= kt.b - 1 : null,
        keyBeyondRowPx: kt ? Math.round(Math.max(0, kt.r - fb.r, fb.l - kt.l)) : 0,
      });
    }
  }
  return rows;
}
