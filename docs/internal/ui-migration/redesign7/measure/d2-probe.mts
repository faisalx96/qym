/** The in-page key / value probe shared by d2-keys.mts (the shipped UI) and d2-mock.mts (the gallery mocks). See d2-keys.mts for the fields. */
export const MEASURE = `
window.__d2 = (rootSel, kind) => {
  const root = document.querySelector(rootSel);
  if (!root) return null;
  const text = (el) => {
    const rg = document.createRange(); rg.selectNodeContents(el);
    const rs = Array.from(rg.getClientRects()).filter((r) => r.width > 0);
    if (!rs.length) return null;
    return { l: Math.min(...rs.map((r) => r.left)), r: Math.max(...rs.map((r) => r.right)), t: Math.min(...rs.map((r) => r.top)), b: Math.max(...rs.map((r) => r.bottom)), lines: new Set(rs.map((r) => Math.round(r.top))).size };
  };
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const same = (a, b) => a && b && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
  const ovl = (a, b) => (same(a, b) ? Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) : 0);
  const q = (el, sels) => { for (const s of sels) { const f = el.querySelector(s); if (f) return f; } return null; };
  const rows = [];
  const add = (region, depth, keyEl, valEl, actEls, rowEl) => {
    if (!keyEl) return;
    const kt = text(keyEl), kb = box(keyEl), cs = getComputedStyle(keyEl);
    const clipped = keyEl.scrollWidth > keyEl.clientWidth + 1;
    const ellipsis = cs.textOverflow === 'ellipsis' && clipped;
    const keyPaint = kt && { ...kt, r: ellipsis || cs.overflowX === 'hidden' ? Math.min(kt.r, kb.r) : kt.r };
    const vt = valEl ? text(valEl) : null;
    const vb = valEl ? box(valEl) : null;
    // the painted extent of the value: its text clipped to its own box when the box hides overflow
    const vcs = valEl ? getComputedStyle(valEl) : null;
    const valPaint = vt && { ...vt, r: vcs.overflowX === 'hidden' ? Math.min(vt.r, vb.r) : vt.r, l: vcs.overflowX === 'hidden' ? Math.max(vt.l, vb.l) : vt.l };
    const acts = (actEls || []).filter(Boolean).map(box);
    const rowB = box(rowEl);
    rows.push({
      region, depth, key: keyEl.textContent.trim().slice(0, 90), keyLen: keyEl.textContent.trim().length,
      keyTextW: kt ? Math.round(kt.r - kt.l) : 0, keyBoxW: Math.round(kb.r - kb.l), keyLines: kt ? kt.lines : 0,
      keyClipPx: kt ? Math.round(Math.max(0, kt.r - kb.r, keyEl.scrollWidth - keyEl.clientWidth)) : 0,
      ellipsis,
      overlapPx: valPaint && keyPaint ? Math.round(ovl(keyPaint, valPaint)) : 0,
      overlapActPx: keyPaint ? Math.round(Math.max(0, ...acts.map((a) => ovl(keyPaint, a)))) : 0,
      gapPx: valPaint && keyPaint && same(keyPaint, valPaint) ? Math.round(valPaint.l - keyPaint.r) : null,
      valueOverActPx: valPaint ? Math.round(Math.max(0, ...acts.map((a) => ovl(valPaint, a)))) : 0,
      keyBeyondRowPx: keyPaint ? Math.round(Math.max(0, keyPaint.r - rowB.r, rowB.l - keyPaint.l)) : 0,
      valueBelowKey: vt && kt ? vt.t >= kt.b - 1 : null, rowH: Math.round(rowB.b - rowB.t),
      dir: valEl ? (valEl.getAttribute('dir') || getComputedStyle(valEl).direction) : null,
    });
  };
  if (kind === 'tree') {
    for (const row of root.querySelectorAll('[class*="row"][data-depth]')) {
      const head = row.querySelector(':scope > [class*="head"]'); if (!head) continue;
      const toggle = head.querySelector('button[aria-expanded]');
      const keyEl = q(toggle, ['[data-part=key]', '[class*="key"]']);
      const valEl = q(toggle, ['[data-part=value]', '[class*="preview"]', '[data-part=type]', '[class*="type"]']);
      const acts = [head.querySelector('[class*="bulk"]'), ...Array.from(head.querySelectorAll('button')).filter((b) => b !== toggle && !b.closest('[class*="bulk"]'))];
      add(kind, Number(row.getAttribute('data-depth')), keyEl, valEl, acts, head);
    }
  } else if (kind === 'sections') {
    for (const sec of root.querySelectorAll('[class*="section"][data-kind]')) {
      const head = sec.querySelector(':scope > [class*="head"]'); if (!head) continue;
      const keyEl = q(head, ['[data-part=key]', '[class*="key"]']);
      const valEl = q(head, ['[data-part=value]', '[class*="summary"]', '[class*="scalar"]']);
      const acts = Array.from(head.querySelectorAll('button')).filter((b) => !b.contains(keyEl));
      add(kind, 0, keyEl, valEl, acts, head);
    }
  } else if (kind === 'facts') {
    for (const f of root.querySelectorAll('dl[class*="facts"] > div')) add(kind, 0, f.querySelector('dt'), f.querySelector('dd'), [], f);
    for (const p of root.querySelectorAll('[data-part=prose]')) add('eyebrow', 0, p.querySelector('[data-part=eyebrow]'), p.querySelector('[data-part=prose-text]'), [], p);
  }
  return rows;
};
`;
