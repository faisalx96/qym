/**
 * Q2 baseline: how long the passes of a repeat run take to appear in the runs table.
 *   NET=none|fast3g  SETTLE=0|1  OPEN=1|5  RUN=r300|r1200  REPS=3  node q2-passes-load.mts
 * SETTLE=0 clicks the chevron as soon as the list rows are painted (a reader who is quick); SETTLE=1 waits for the list's own
 * requests to finish (1.5 s of quiet). The click and every paint timestamp are read in the page (performance.now, rAF), so the
 * numbers are the ones a reader sees. For each opened group it records: placeholder rows painted, all pass rows painted, the
 * strip's statistics painted (a number in Pass@k), the requests (url, start, end, bytes, TTFB) and the table height before / after
 * (layout shift of the group). OPEN=5 opens the first five repeat runs one after the other (each after the previous painted).
 */
import { BASE, r7, save, median, launch, newPage, FAST3G, STORAGE_INIT } from './lib7.mts';

const NET = (process.env.NET ?? 'none') as 'none' | 'fast3g';
const SETTLE = process.env.SETTLE === '1';
const OPEN = Number(process.env.OPEN ?? 1);
const RUN = (process.env.RUN ?? 'r300') as 'r300' | 'r1200';
const REPS = Number(process.env.REPS ?? 3);
const WIDTH = Number(process.env.WIDTH ?? 1440);
const PREFETCH = process.env.TAG ?? '';
const FIRST = Number(process.env.FIRST ?? 0); // skip this many repeat runs (cold measurements use runs nobody opened yet)

const WATCH = `
window.__q2 = { groups: [] };
window.__openGroup = (runId, samples) => {
  const G = { runId, samples, t0: performance.now(), placeholders: null, rows: null, strip: null, h0: null, hp: null, h1: null, stripPh: null, stripH: null };
  window.__q2.groups.push(G);
  const table = () => document.querySelector('[data-testid="runs-table"] table');
  G.h0 = table().getBoundingClientRect().height;
  const btn = document.querySelector('[data-testid="runs-table"] tr[data-run-id="' + runId + '"] button[aria-expanded]');
  btn.click();
  const tick = () => {
    const now = performance.now() - G.t0;
    const ph = document.querySelectorAll('[data-testid="runs-table"] tr[data-loading-row][data-parent-run="' + runId + '"]').length;
    const pr = document.querySelectorAll('[data-testid="runs-table"] tr[data-pass-row][data-parent-run="' + runId + '"]').length;
    if (G.placeholders == null && ph > 0) {
      G.placeholders = now; G.hp = table().getBoundingClientRect().height;
      const run0 = document.querySelector('[data-testid="runs-table"] tr[data-run-id="' + runId + '"]');
      let e0 = run0 && run0.nextElementSibling; while (e0 && !e0.hasAttribute('data-strip-row') && !e0.hasAttribute('data-run-id')) e0 = e0.nextElementSibling;
      G.stripPh = e0 ? e0.getBoundingClientRect().height : null;
    }
    if (G.rows == null && pr >= samples) { G.rows = now; G.h1 = table().getBoundingClientRect().height; }
    if (G.strip == null) {
      const strip = document.querySelector('[data-testid="runs-table"] tr[data-strip-row] [role=group][aria-label="Group metrics"] dl[aria-busy="false"] dd');
      const run = document.querySelector('[data-testid="runs-table"] tr[data-run-id="' + runId + '"]');
      // the strip row that follows this run's passes
      let el = run && run.nextElementSibling;
      while (el && !el.hasAttribute('data-strip-row') && !el.hasAttribute('data-run-id')) el = el.nextElementSibling;
      const dd = el && el.querySelector && el.querySelector('[role=group][aria-label="Group metrics"] dl[aria-busy="false"] dd');
      if (dd && /\\d/.test(dd.textContent || '')) { G.strip = now; G.stripH = el.getBoundingClientRect().height; }
      void strip;
    }
    if (G.rows != null && G.strip != null) { G.done = true; return; }
    if (now < 90000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
`;

interface Req { url: string; start: number; end: number; bytes: number; ttfb: number }

const browser = await launch();
const reps: Array<Record<string, unknown>> = [];
for (let rep = 0; rep < REPS; rep++) {
  const { page, cdp } = await newPage(browser, { width: WIDTH, height: 1000, init: [WATCH, STORAGE_INIT] });
  await cdp.send('Network.enable');
  const reqs = new Map<string, Req>();
  let originWall = 0;
  cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string }; wallTime: number }) => {
    if (!e.request.url.startsWith(BASE + '/api/')) return;
    reqs.set(e.requestId, { url: e.request.url.replace(BASE, ''), start: e.wallTime * 1000 - originWall, end: NaN, bytes: 0, ttfb: NaN });
  });
  cdp.on('Network.responseReceived', (e: { requestId: string; response: { timing?: { receiveHeadersEnd: number; sendEnd: number } } }) => {
    const r = reqs.get(e.requestId);
    if (r && e.response.timing) r.ttfb = e.response.timing.receiveHeadersEnd - e.response.timing.sendEnd;
  });
  cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
    const r = reqs.get(e.requestId);
    if (r) { r.bytes = e.encodedDataLength; r.end = Date.now() - originWall; }
  });
  await page.goto(`${BASE}/projects/${r7.slug}`);
  await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
  if (SETTLE) await page.waitForTimeout(2500);
  if (NET === 'fast3g') await cdp.send('Network.emulateNetworkConditions', FAST3G);
  reqs.clear();
  originWall = Date.now();
  const listApi = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/')).map((e) => e.name.replace(location.origin, '')));
  // the runs to open: the first OPEN repeat runs on the page (10 passes), or the 1,200-item run
  const targets: Array<{ id: string; samples: number }> = await page.evaluate(
    ({ n, only, first }) => {
      const rows = Array.from(document.querySelectorAll('[data-testid="runs-table"] tbody tr[data-run-id]')) as HTMLElement[];
      const ids = rows
        .filter((r) => r.querySelector('button[aria-expanded]') && (!only || r.dataset.runId === only))
        .map((r) => ({ id: r.dataset.runId!, samples: Number(/Expand (\d+) passes/.exec(r.querySelector('button[aria-expanded]')!.getAttribute('aria-label') || '')?.[1] ?? 0) }));
      return ids.filter((x) => x.samples === 10).slice(first, first + n);
    },
    { n: OPEN, only: RUN === 'r1200' ? r7.passes1200 : null, first: FIRST },
  );
  const out: Array<Record<string, unknown>> = [];
  for (const t of targets) {
    const t0Req = reqs.size;
    await page.evaluate(({ id, s }) => (window as any).__openGroup(id, s), { id: t.id, s: t.samples }); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page.waitForFunction(() => { const g = (window as any).__q2.groups.at(-1); return g && g.done; }, null, { timeout: 120000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const g = await page.evaluate(() => (window as any).__q2.groups.at(-1)); // eslint-disable-line @typescript-eslint/no-explicit-any
    out.push({ runId: t.id, placeholdersMs: Math.round(g.placeholders), rowsMs: Math.round(g.rows), stripMs: Math.round(g.strip), heightBefore: g.h0, heightPlaceholders: g.hp, heightAfterRows: g.h1, heightAfterStrip: null, stripPlaceholderPx: g.stripPh, stripLoadedPx: g.stripH, requestsSoFar: reqs.size - t0Req });
  }
  await page.waitForTimeout(500);
  const cls = await page.evaluate(() => (window as any).__perf.shifts.reduce((n: number, s: { v: number }) => n + s.v, 0)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const all = [...reqs.values()].sort((a, b) => a.start - b.start);
  const passes = all.filter((r) => /\/passes(\?|$)/.test(r.url));
  const group = all.filter((r) => r.url.includes('/group-metrics'));
  reps.push({
    rep, listApiAtLoad: listApi.length, groups: out,
    requestsAfterClick: all.length, passesRequests: passes.length, groupMetricsRequests: group.length,
    apiKB: Number((all.reduce((n, r) => n + r.bytes, 0) / 1024).toFixed(2)),
    passesKB: Number((passes.reduce((n, r) => n + r.bytes, 0) / 1024).toFixed(2)),
    passesTtfbMs: passes.map((r) => Math.round(r.ttfb)), passesDoneMs: passes.map((r) => Math.round(r.end)),
    groupTtfbMs: group.map((r) => Math.round(r.ttfb)), groupDoneMs: group.map((r) => Math.round(r.end)),
    cls: Number(cls.toFixed(4)),
    requestList: all.map((r) => `${r.url.split('?')[0]!.slice(-34)}${r.url.includes('?') ? '?' + r.url.split('?')[1]!.slice(0, 44) : ''} @${Math.round(r.start)}-${Math.round(r.end)}ms ttfb ${Math.round(r.ttfb)} ${(r.bytes / 1024).toFixed(1)}kB`),
  });
  await page.close();
}
await browser.close();
const first = (k: string) => median(reps.map((r) => ((r.groups as Array<Record<string, number>>)[0] ?? {})[k] as number));
save(`q2-passes-${RUN}-${NET}-${SETTLE ? 'settled' : 'quick'}-open${OPEN}-w${WIDTH}${PREFETCH ? '-' + PREFETCH : ''}`, {
  net: NET, width: WIDTH, settle: SETTLE, open: OPEN, run: RUN,
  median: { firstGroupPlaceholdersMs: first('placeholdersMs'), firstGroupRowsMs: first('rowsMs'), firstGroupStripMs: first('stripMs'), requestsAfterClick: median(reps.map((r) => r.requestsAfterClick as number)), apiKB: median(reps.map((r) => r.apiKB as number)), cls: median(reps.map((r) => r.cls as number)) },
  reps,
});
