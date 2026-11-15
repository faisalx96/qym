const { chromium } = require('/home/meshari-aldossari/Documents/qym/qym-wt-redesign9/frontend/node_modules/@playwright/test');
const S = '/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/r9';
exports.S = S;
exports.open = async (w = 1440, h = 900) => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  return { browser, page };
};
exports.base = 'http://127.0.0.1:5988';
// in-page measure helper: returns resolved bg (walking up), border, rect, font for a selector (first match or nth)
exports.measure = async (page, sel, nth = 0) => page.evaluate(({ sel, nth }) => {
  const el = document.querySelectorAll(sel)[nth];
  if (!el) return null;
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const stack = []; for (let n = el; n; n = n.parentElement) stack.push(n);
  let bg = { r: 16, g: 16, b: 24, a: 1 };
  for (const n of stack.reverse()) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) bg = over(c, bg); }
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const parent = el.parentElement; let pbg = null;
  if (parent) { const st = []; for (let n = parent; n; n = n.parentElement) st.push(n); let b2 = { r: 16, g: 16, b: 24, a: 1 }; for (const n of st.reverse()) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) b2 = over(c, b2); } pbg = hex(b2); }
  return { sel, bg: hex(bg), parentBg: pbg, border: cs.borderTopWidth + ' ' + cs.borderTopColor, radius: cs.borderTopLeftRadius, color: cs.color, font: cs.fontSize + '/' + cs.fontWeight + ' ' + cs.fontFamily.split(',')[0], cursor: cs.cursor, x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, pad: cs.padding, display: cs.display, position: cs.position };
}, { sel, nth });
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const L = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
exports.contrast = (a, b) => { const x = L(a), y = L(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
exports.PROJ = '/projects/exp-demo';
exports.ENVS = { staging: '4eab8fc2-e199-4c8f-b8b3-78f95f0466fb', production: '1fde04ad-a52e-4c8c-af8c-15d182d9c15f' };
