/**
 * Q2-7: the background prefetch of the seeded runs page (17 repeat runs: 12 x 10 passes x 300 items, 1 x 10 x 1,200, 4 x 3 x 100).
 *   NET=none|fast3g node q2-prefetch.mts
 * Records every /api/ request from navigation on (url, start, end, encoded bytes) and reports: the list's own requests, when the last of them ended,
 * when the first prefetch request started (ms after that), the most prefetch requests in flight at once, the number and gzip size of the prefetch
 * requests, the runs they were for, and when the last one ended (ms after navigation). Prefetch requests are `/passes` and `/group-metrics`.
 */
import { BASE, r7, save, launch, newPage, FAST3G, STORAGE_INIT } from './lib7.mts';

const NET = (process.env.NET ?? 'none') as 'none' | 'fast3g';
const browser = await launch();
const { page, cdp } = await newPage(browser, { width: 1440, height: 1000, init: [STORAGE_INIT] });
await cdp.send('Network.enable');
if (NET === 'fast3g') await cdp.send('Network.emulateNetworkConditions', FAST3G);
interface Req { url: string; start: number; end: number; bytes: number }
const reqs = new Map<string, Req>();
const t0 = Date.now();
cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string } }) => {
  if (e.request.url.startsWith(BASE + '/api/')) reqs.set(e.requestId, { url: e.request.url.replace(BASE, ''), start: Date.now() - t0, end: NaN, bytes: 0 });
});
cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
  const r = reqs.get(e.requestId);
  if (r) { r.end = Date.now() - t0; r.bytes = e.encodedDataLength; }
});
await page.goto(`${BASE}/projects/${r7.slug}`);
await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
await page.waitForTimeout(NET === 'fast3g' ? 14000 : 5000);
const all = [...reqs.values()].sort((a, b) => a.start - b.start);
const isPrefetch = (r: Req) => /\/api\/runs\/[^/?]+\/(passes|group-metrics)/.test(r.url);
const own = all.filter((r) => !isPrefetch(r));
const pre = all.filter(isPrefetch);
const listDone = Math.max(...own.filter((r) => !Number.isNaN(r.end)).map((r) => r.end));
let worst = 0;
for (const r of pre) worst = Math.max(worst, pre.filter((o) => o.start <= r.start && (Number.isNaN(o.end) || o.end > r.start)).length);
save(`q2-prefetch-${NET}`, {
  net: NET,
  listRequests: own.length, listDoneMs: Math.round(listDone),
  prefetchRequests: pre.length, prefetchRuns: new Set(pre.map((r) => /\/api\/runs\/([^/?]+)/.exec(r.url)![1])).size,
  firstPrefetchStartMsAfterList: Math.round(Math.min(...pre.map((r) => r.start)) - listDone),
  maxInFlight: worst,
  lastPrefetchEndMs: Math.round(Math.max(...pre.map((r) => r.end))), settledMsAfterList: Math.round(Math.max(...pre.map((r) => r.end)) - listDone),
  prefetchGzipKB: Number((pre.reduce((n, r) => n + r.bytes, 0) / 1024).toFixed(1)),
  timeline: pre.map((r) => `${r.url.replace(/\?.*/, '').slice(-40)}${r.url.includes('view=group') ? ' view=group' : ''} ${Math.round(r.start)}-${Math.round(r.end)}ms ${(r.bytes / 1024).toFixed(1)}kB`),
});
await browser.close();
