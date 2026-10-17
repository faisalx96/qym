/**
 * Part B baseline: loading a run page, cold HTTP cache.
 *   RUN=big|wide NET=none|fast3g PATHKIND=nav|deep REPS=3 WARMCHUNK=0|1 PLOT=name node load-run.mts
 * nav : the runs list is loaded first (unthrottled), then the network is throttled and the SPA navigates to the run
 *       (history.pushState + popstate, what a link click does) = the "navigation from the runs list" case.
 * deep: a full page load of the run URL (cold JS and data).
 * Per run it records: header painted (run-hero), first skeleton, Overview painted, items rows painted, time to interactive
 * (end of the last long task before 600 ms of quiet after Overview), total blocking time, CLS since the navigation, the
 * network (requests with encoded bytes and timings), JS chunk count/bytes, `?view=compact` bytes + TTFB, and which report
 * sections have their body mounted at Overview-painted and after 3 s.
 * Fast 3G = the DevTools preset: 1.6 Mbit/s down (x0.9), 750 kbit/s up, 562.5 ms latency.
 */
import { BASE, seed, save, median, launch, newPage, svgToPng } from './lib.mts';

const RUN = (process.env.RUN ?? 'big') as 'big' | 'wide';
const NET = (process.env.NET ?? 'none') as 'none' | 'fast3g';
const KIND = (process.env.PATHKIND ?? 'nav') as 'nav' | 'deep';
const REPS = Number(process.env.REPS ?? 3);
const WARM = process.env.WARMCHUNK === '1'; // nav only: the route chunk was already fetched (what idle prefetch from the list would give)
const PLOT = process.env.PLOT ?? '';
const runId = RUN === 'big' ? seed.big : seed.wide;
const url = `/projects/${seed.slug}/runs/${runId}`;

const WATCH = `
window.__watch = (t0) => {
  const W = window.__w = { t0, hero: null, skeleton: null, overview: null, rows: null, sections: null };
  const q = (s) => document.querySelector(s);
  const tick = () => {
    const now = performance.now() - t0;
    if (W.skeleton == null && q('[aria-busy="true"]')) W.skeleton = now;
    const hero = q('[data-testid="run-hero"]');
    if (W.hero == null && hero && /\\S/.test(hero.textContent || '')) W.hero = now;
    const ov = q('#run-section-overview');
    const body = ov && ov.querySelector(':scope > div:last-child');
    if (W.overview == null && body && body.children.length > 0) W.overview = now;
    if (W.rows == null && q('tbody tr[data-item-id]')) W.rows = now;
    if (W.hero != null && W.overview != null && W.rows != null) return;
    if (now < 60000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
window.__sections = () => Array.from(document.querySelectorAll('[data-report-section]')).map((s) => {
  const body = s.querySelector(':scope > div:last-child');
  return { id: s.getAttribute('data-report-section'), mounted: !!body && body.children.length > 0 };
});
`;

interface Req { id: string; url: string; type: string; start: number; end: number; bytes: number; ttfb: number }

const browser = await launch();
const results: Array<Record<string, unknown>> = [];
let lastReqs: Req[] = [];
for (let rep = 0; rep < REPS; rep++) {
  const { page, cdp } = await newPage(browser, { width: 1440, height: 900, init: [WATCH] });
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  const reqs = new Map<string, Req>();
  let origin = 0;
  cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string }; type: string; wallTime: number }) => {
    if (!e.request.url.startsWith(BASE)) return;
    reqs.set(e.requestId, { id: e.requestId, url: e.request.url.replace(BASE, ''), type: e.type, start: e.wallTime * 1000 - origin, end: NaN, bytes: 0, ttfb: NaN });
  });
  cdp.on('Network.responseReceived', (e: { requestId: string; response: { timing?: { receiveHeadersEnd: number; sendEnd: number } } }) => {
    const r = reqs.get(e.requestId);
    if (r && e.response.timing) r.ttfb = e.response.timing.receiveHeadersEnd - e.response.timing.sendEnd;
  });
  cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number; timestamp: number }) => {
    const r = reqs.get(e.requestId);
    if (r) { r.bytes = e.encodedDataLength; r.end = Date.now() - origin; }
  });
  const throttle = async () => {
    if (NET === 'fast3g')
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 });
  };
  let t0Perf = 0;
  if (KIND === 'nav') {
    await page.goto(`${BASE}/projects/${seed.slug}`);
    await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
    if (WARM) {
      await page.evaluate((u) => { history.pushState(null, '', u); dispatchEvent(new PopStateEvent('popstate')); }, `/projects/${seed.slug}/runs/${seed.wide}`);
      await page.locator('[data-testid="run-hero"]').waitFor();
      await page.evaluate((u) => { history.pushState(null, '', u); dispatchEvent(new PopStateEvent('popstate')); }, `/projects/${seed.slug}`);
      await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
    }
    await page.waitForTimeout(800);
    await throttle();
    reqs.clear();
    origin = Date.now();
    t0Perf = await page.evaluate((u) => {
      const t0 = performance.now();
      (window as any).__watch(t0); // eslint-disable-line @typescript-eslint/no-explicit-any
      (window as any).__perf.t0 = t0; // eslint-disable-line @typescript-eslint/no-explicit-any
      history.pushState(null, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
      return t0;
    }, url);
  } else {
    await throttle();
    // deep link: the watcher must exist before app code; install through an init script reading the navigation start
    await page.addInitScript(`(${(() => { const w = () => (window as any).__watch && (window as any).__watch(0); if ((window as any).__watch) w(); else document.addEventListener('DOMContentLoaded', w); }).toString()})()`); // eslint-disable-line @typescript-eslint/no-explicit-any
    origin = Date.now();
    page.goto(`${BASE}${url}`, { waitUntil: 'commit' }).catch(() => {});
  }
  const waitFor = async (field: string, timeout = 60000) => {
    await page.waitForFunction((f) => (window as any).__w && (window as any).__w[f] != null, field, { timeout, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  await waitFor('overview');
  await waitFor('rows');
  const atOverview = await page.evaluate(() => (window as any).__sections()); // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.waitForTimeout(3000);
  const after3s = await page.evaluate(() => (window as any).__sections()); // eslint-disable-line @typescript-eslint/no-explicit-any
  const w = await page.evaluate(() => (window as any).__w); // eslint-disable-line @typescript-eslint/no-explicit-any
  const perf = await page.evaluate(() => {
    const P = (window as any).__perf; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { long: P.longtasks as Array<{ start: number; dur: number }>, shifts: P.shifts as Array<{ t: number; v: number }>, commits: P.commits };
  });
  const base = KIND === 'nav' ? t0Perf : 0;
  const long = perf.long.map((l) => ({ start: l.start - base, dur: l.dur })).filter((l) => l.start + l.dur > 0);
  const quietFrom = Math.max(w.overview, w.hero);
  // TTI: end of the last long task that started before (overview painted + 600 ms of quiet) -> walk tasks in order
  let tti = quietFrom;
  for (const l of long.sort((a, b) => a.start - b.start)) {
    if (l.start <= tti + 600) tti = Math.max(tti, l.start + l.dur);
  }
  const tbt = long.filter((l) => l.start < tti).reduce((n, l) => n + Math.max(0, l.dur - 50), 0);
  const cls = perf.shifts.filter((s) => s.t - base >= 0).reduce((n, s) => n + s.v, 0);
  const all = [...reqs.values()].filter((r) => !/\/(favicon|__vite)/.test(r.url)).sort((a, b) => a.start - b.start);
  const js = all.filter((r) => r.type === 'Script' || /\.js(\?|$)/.test(r.url));
  const api = all.filter((r) => r.url.startsWith('/api/'));
  const compact = all.find((r) => r.url.includes('view=compact'));
  results.push({
    rep, heroMs: Math.round(w.hero), skeletonMs: w.skeleton == null ? null : Math.round(w.skeleton), overviewMs: Math.round(w.overview), rowsMs: Math.round(w.rows),
    ttiMs: Math.round(tti), tbtMs: Math.round(tbt), cls: Number(cls.toFixed(4)), reactCommits: perf.commits,
    requests: all.length, jsChunks: js.length, jsKB: Number((js.reduce((n, r) => n + r.bytes, 0) / 1024).toFixed(1)),
    apiRequests: api.length, apiKB: Number((api.reduce((n, r) => n + r.bytes, 0) / 1024).toFixed(1)),
    compactKB: compact ? Number((compact.bytes / 1024).toFixed(1)) : null, compactTtfbMs: compact ? Math.round(compact.ttfb) : null,
    compactDoneMs: compact ? Math.round(compact.end) : null,
    mountedAtOverview: atOverview.filter((s: { mounted: boolean }) => s.mounted).map((s: { id: string }) => s.id.replace('run-section-', '')),
    mountedAfter3s: after3s.filter((s: { mounted: boolean }) => s.mounted).map((s: { id: string }) => s.id.replace('run-section-', '')),
    sectionsTotal: after3s.length,
    jsList: js.map((r) => `${r.url.split('/').pop()} ${(r.bytes / 1024).toFixed(1)}kB @${Math.round(r.start)}-${Math.round(r.end)}ms`),
    apiList: api.map((r) => `${r.url.split('?')[0]}${r.url.includes('?') ? '?' + r.url.split('?')[1]!.slice(0, 40) : ''} ${(r.bytes / 1024).toFixed(1)}kB @${Math.round(r.start)}-${Math.round(r.end)}ms`),
  });
  lastReqs = all;
  await page.close();
}
await browser.close();
const med = (k: string) => median(results.map((r) => r[k] as number));
const summary = Object.fromEntries(['heroMs', 'overviewMs', 'rowsMs', 'ttiMs', 'tbtMs', 'cls', 'requests', 'jsChunks', 'jsKB', 'apiRequests', 'apiKB', 'compactKB', 'compactTtfbMs', 'compactDoneMs'].map((k) => [k, med(k)]));
if (PLOT) {
  const W = 760, rowH = 11, top = 36;
  const reqs = lastReqs.slice(0, 48);
  const tmax = Math.max(...reqs.map((r) => (Number.isFinite(r.end) ? r.end : r.start)), 1);
  const X = (t: number) => 190 + (t / tmax) * (W - 200);
  const bars = reqs
    .map((r, i) => {
      const y = top + i * rowH;
      const col = r.url.startsWith('/api/') ? '#e5694b' : r.type === 'Script' ? '#6aa9ff' : '#9aa3b2';
      const end = Number.isFinite(r.end) ? r.end : r.start;
      return `<text x="4" y="${y + 8}" fill="#9aa3b2" font-size="9" font-family="monospace">${r.url.split('?')[0]!.slice(-26)} ${(r.bytes / 1024).toFixed(0)}k</text><rect x="${X(r.start)}" y="${y}" width="${Math.max(1, X(end) - X(r.start))}" height="8" fill="${col}"/>`;
    })
    .join('');
  const h = top + reqs.length * rowH + 28;
  const t = med('ttiMs');
  const mk = `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 6}" y2="${h - 22}" stroke="#4bbf8a" stroke-dasharray="3 3"/><text x="${X(t) - 4}" y="${top - 8}" fill="#4bbf8a" font-size="10" text-anchor="end" font-family="monospace">header = Overview = items = interactive at ${t} ms (one commit)</text>`;
  const b2 = await launch();
  await svgToPng(b2, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}"><text x="4" y="14" fill="#e6e9ef" font-size="12" font-family="monospace">${PLOT}: ${RUN} run, ${KIND}, ${NET} (median of ${REPS}); orange = /api, blue = JS</text>${mk}${bars}<text x="${W / 2}" y="${h - 6}" fill="#9aa3b2" font-size="10" text-anchor="middle" font-family="monospace">ms since navigation (last rep, 0..${Math.round(tmax)})</text></svg>`, `${PLOT}.png`, W, h);
  await b2.close();
}
save(`load-${RUN}-${KIND}-${NET}${WARM ? '-warmchunk' : ''}`, { run: RUN, kind: KIND, net: NET, median: summary, runs: results });
