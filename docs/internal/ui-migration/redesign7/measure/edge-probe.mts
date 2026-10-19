/** The in-page edge-cue probe shared by edge-cues.mts (the shipped UI) and edge-mock.mts (the gallery mocks). See edge-cues.mts for the fields. */
export const PROBE = `
window.__edge = (hostSel) => {
  const host = document.querySelector(hostSel);
  const card = host && (host.matches('[data-testid=data-table]') ? host : host.querySelector('[data-testid=data-table]'));
  if (!card) return null;
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
  const byClass = (root, s) => root.querySelector('[class*="' + s + '"]');
  const bodyHost = byClass(card, 'bodyHost');
  const scroller = card.querySelector('[data-dt-scroller]');
  const table = card.querySelector('table');
  const firstTh = table && table.querySelector('thead tr:first-child th');
  const rows = table ? Array.from(table.querySelectorAll('tbody > tr:not([data-spacer])')) : [];
  const lastRow = rows[rows.length - 1];
  const toolbar = Array.from(card.children).find((c) => /toolbar/i.test(c.className) || c.matches('[data-dt-toolbar]'));
  const footer = card.querySelector('[data-testid=status-bar], [class*="footer"]');
  const rail = card.querySelector('[data-testid=table-scroll-rail]');
  const details = Array.from(table ? table.querySelectorAll('tbody > tr[data-detail-row]') : []).map((r) => ({ ...R(r), strip: r.hasAttribute('data-strip-row') }));
  const bs = bodyHost ? getComputedStyle(bodyHost) : null;
  const pinStart = bs ? parseFloat(bs.getPropertyValue('--pin-start')) || 0 : 0;
  const pinEnd = bs ? parseFloat(bs.getPropertyValue('--pin-end')) || 0 : 0;
  const hb = R(bodyHost);
  // cues: .edge elements
  const cues = [];
  for (const e of card.querySelectorAll('[class*="edge"][data-edge]')) {
    const cs = getComputedStyle(e);
    cues.push({ kind: 'edge-' + e.getAttribute('data-edge'), rect: R(e), opacity: parseFloat(cs.opacity), display: cs.display, zIndex: cs.zIndex, bg: cs.backgroundImage.slice(0, 80), borderInline: cs.borderInlineStartWidth + '/' + cs.borderInlineEndWidth, shade: true, line: true });
  }
  // cues: scroll fades (::before / ::after of bodyHost)
  if (bodyHost && bodyHost.hasAttribute('data-cues')) {
    for (const p of ['::before', '::after']) {
      const cs = getComputedStyle(bodyHost, p);
      // round 7: the fades are gone, a pseudo-element with no content is not a cue (its computed opacity would read 1)
      if (cs.content === 'none' || cs.content === 'normal') continue;
      const w = parseFloat(cs.width) || 0;
      const left = p === '::before' ? hb.l + pinStart : hb.r - pinEnd - w;
      cues.push({ kind: 'fade-' + (p === '::before' ? 'start' : 'end'), rect: { l: left, r: left + w, t: hb.t, b: hb.b, w, h: hb.b - hb.t }, opacity: parseFloat(cs.opacity), display: cs.display, zIndex: cs.zIndex, bg: cs.backgroundImage.slice(0, 80), borderInline: '0/0', shade: true, line: false });
    }
  }
  // the pinned cells' own inset lines (computed box-shadow of the edge cell of each side), first body row and header
  const insets = [];
  const edgeCells = table ? Array.from(table.querySelectorAll('[data-pin-edge]')) : [];
  for (const c of edgeCells.slice(0, 40)) {
    const cs = getComputedStyle(c);
    insets.push({ tag: c.tagName.toLowerCase(), edge: c.getAttribute('data-pin-edge'), shadow: cs.boxShadow.slice(0, 90), rect: R(c) });
  }
  const insetKinds = Array.from(new Set(insets.map((i) => i.tag + ':' + i.edge + ':' + i.shadow)));
  // text under the cues
  const rootCss = getComputedStyle(document.documentElement);
  const hex = (v) => { v = v.trim(); const m = /^#([0-9a-f]{6})$/i.exec(v); return m ? [1, 3, 5].map((i) => parseInt(m[1].slice(i - 1, i + 1), 16)) : null; };
  const void_ = hex(rootCss.getPropertyValue('--bg-void')) || [11, 11, 15];
  const parse = (c) => {
    let m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (m) { const p = m[1].split(/[ ,\\/]+/).map((x) => parseFloat(x)); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
    m = /color\\(srgb ([^)]+)\\)/.exec(c); // color-mix() results compute to color(srgb r g b / a)
    if (m) { const p = m[1].split(/[ \\/]+/).map((x) => parseFloat(x)); return { rgb: p.slice(0, 3).map((v) => v * 255), a: p.length > 3 ? p[3] : 1 }; }
    return null;
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const p = parse(getComputedStyle(n).backgroundColor); if (p && p.a > 0.5) return p.rgb; } return [18, 18, 24]; };
  const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
  const overlaps = [];
  const sc = scroller ? R(scroller) : hb;
  const alphaAt = (c, x) => {
    const toStart = c.kind.endsWith('start');
    const t = toStart ? 1 - (x - c.rect.l) / c.rect.w : (x - c.rect.l) / c.rect.w; // 1 at the pinned side, 0 at the far side
    return x < c.rect.l || x > c.rect.r ? 0 : Math.max(0, Math.min(1, t)) * c.opacity;
  };
  const walker = document.createTreeWalker(scroller || card, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const txt = n.textContent.trim();
    if (!txt) continue;
    const el = n.parentElement;
    if (el.closest('[aria-hidden=true]')) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    const live = cues.filter((c) => c.shade && c.opacity >= 0.02 && c.display !== 'none');
    for (const r of rg.getClientRects()) {
      if (r.width < 1 || r.bottom < sc.t || r.top > sc.b) continue;
      const hits = live.filter((c) => r.bottom >= c.rect.t && r.top <= c.rect.b && Math.min(r.right, c.rect.r) - Math.max(r.left, c.rect.l) > 0.5);
      if (!hits.length) continue;
      // sample the glyph run every 0.5 px: px under any cue, the combined alpha of every cue stacked at that x, and the contrast there
      let under = 0, worstA = 0, minC = 99;
      const fg = parse(getComputedStyle(el).color) || { rgb: [168, 168, 186], a: 1 }; const bg = bgOf(el);
      for (let x = r.left; x < r.right; x += 0.5) {
        const a = 1 - live.reduce((m, c) => m * (1 - (r.bottom >= c.rect.t && r.top <= c.rect.b ? alphaAt(c, x) : 0)), 1);
        if (a > 0.005) { under += 0.5; worstA = Math.max(worstA, a); minC = Math.min(minC, ratio(mix(fg.rgb, void_, a), mix(bg, void_, a))); }
      }
      const row = el.closest('tr');
      overlaps.push({ cues: hits.map((c) => c.kind).join('+'), text: txt.slice(0, 28), overlapPx: Math.round(under * 10) / 10, alpha: Math.round(worstA * 100) / 100, contrastBase: Math.round(ratio(fg.rgb, bg) * 10) / 10, contrastShaded: Math.round(minC * 10) / 10,
        rowKind: !row ? 'none' : row.closest('thead') ? 'header' : row.hasAttribute('data-strip-row') ? 'strip' : row.hasAttribute('data-detail-row') ? 'detail' : row.hasAttribute('data-pass-row') ? 'pass' : 'row', pinned: !!el.closest('[data-pin]') });
    }
  }
  // the line the pinned cells draw themselves: coverage of the pinned-edge cells of each side, and the gaps in it (rows with no pinned cell)
  const lineOf = (side) => {
    // (round 7: tables nested in an expanded item draw their own line; the line of THIS table is the cells outside the detail rows)
    const cells = edgeCells.filter((c) => c.getAttribute('data-pin-edge') === side && !c.closest('tr[data-detail-row]')).map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0).sort((a, b) => a.top - b.top);
    if (!cells.length) return null;
    const gaps = [];
    for (let i = 1; i < cells.length; i++) { const g = cells[i].top - cells[i - 1].bottom; if (g > 1) gaps.push(Math.round(g)); }
    const sample = edgeCells.find((c) => c.getAttribute('data-pin-edge') === side && c.tagName === 'TD');
    return { cells: cells.length, top: Math.round(cells[0].top), bottom: Math.round(cells[cells.length - 1].bottom), gaps, x: Math.round(side === 'start' ? cells[0].right : cells[0].left), shadow: sample ? getComputedStyle(sample).boxShadow.slice(0, 70) : null };
  };
  const lines = { start: lineOf('start'), end: lineOf('end') };
  const cueElementsLive = cues.filter((c) => c.display !== 'none').length;
  const nonPinned = overlaps.filter((o) => !o.pinned);
  return {
    boxes: { card: R(card), toolbar: R(toolbar), footer: R(footer), bodyHost: hb, scroller: R(scroller), firstHeaderRow: R(firstTh), lastBodyRow: R(lastRow), rail: R(rail), details, pinStart, pinEnd },
    attrs: bodyHost ? bodyHost.getAttributeNames().filter((n) => n.startsWith('data-')) : [],
    scrollLeft: scroller ? scroller.scrollLeft : 0, scrollW: scroller ? scroller.scrollWidth : 0, clientW: scroller ? scroller.clientWidth : 0,
    cues, lines, cueElementsLive,
    insetKinds,
    overlaps: nonPinned.sort((a, b) => b.overlapPx - a.overlapPx).slice(0, 14),
    overlapSummary: { textNodesOverCue: nonPinned.length, totalPx: Math.round(nonPinned.reduce((n, o) => n + o.overlapPx, 0) * 10) / 10, worstOverlapPx: Math.max(0, ...nonPinned.map((o) => o.overlapPx)), minContrastShaded: nonPinned.length ? Math.min(...nonPinned.map((o) => o.contrastShaded)) : null, byRowKind: nonPinned.reduce((m, o) => ((m[o.rowKind] = (m[o.rowKind] || 0) + 1), m), {}) },
  };
};
`;
