/**
 * Part A, what the user actually sees: compare the sticky header (items, vertical) or the frozen cells (runs, horizontal)
 * with their target position in the COMPOSITED frames (CDP Page.screencast), not in the DOM. A scroll offset that the compositor
 * applies on its own thread while JS moves the header on the main thread shows up here as a per-frame offset, even though the
 * DOM reads of scroll-table.mts are always consistent. Measurement-only paint: header cells magenta, frozen cells cyan.
 *   TABLE=items|runs WIDTH=1440 CPU=1|4 PLOT=name node visual-lag.mts
 */
import { BASE, seed, save, median, pct, launch, newPage, svgToPng, linePlot } from './lib.mts';

const TABLE = (process.env.TABLE ?? 'items') as 'runs' | 'items';
const WIDTH = Number(process.env.WIDTH ?? 1440);
const CPU = Number(process.env.CPU ?? 1);
const PLOT = process.env.PLOT ?? '';

const css =
  TABLE === 'items'
    ? `[role=treegrid][aria-label=Items] > thead th{background:#ff00ff !important;color:#ff00ff !important;border-color:#ff00ff !important}`
    : `[data-testid=runs-table] tbody td[data-pin],[data-testid=runs-table] tbody td[data-pin] *{background:#00ffff !important}`;
const init = [
  `localStorage.setItem('qym:data-table:v2:runs.v2', JSON.stringify({widths:{},hidden:null,pins:{'metric-${seed.metrics[0]}':'start','metric-${seed.metrics[1]}':'start'},order:null,density:null,collapsed:[]}));localStorage.setItem('qym:run-page-size','500');localStorage.setItem('qym:runs:page-size','50');`,
  `addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);});`,
];

const browser = await launch();
const { ctx, page, cdp } = await newPage(browser, { width: WIDTH, height: 900, init });
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
if (TABLE === 'items') {
  await page.goto(`${BASE}/projects/${seed.slug}/runs/${seed.big}`);
  await page.getByTestId('items-count').waitFor();
  await page.evaluate(() => document.getElementById('run-items')?.scrollIntoView({ block: 'start' }));
  await page.getByRole('button', { name: /^Open item #\d+$/ }).first().waitFor();
} else {
  await page.goto(`${BASE}/projects/${seed.slug}`);
  await page.locator('[data-testid="runs-table"] tbody tr[data-run-id]').first().waitFor();
}
await page.waitForTimeout(500);
const target = await page.evaluate((t) => {
  if (t === 'items') {
    const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
    const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
    const sc = document.getElementById('shell-content')!;
    const n = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
    const f = filters && getComputedStyle(filters).position === 'sticky' ? filters.getBoundingClientRect().bottom : 0;
    const th = document.querySelector('[role=treegrid][aria-label=Items] > thead th') as HTMLElement;
    const r = th.getBoundingClientRect();
    return { line: Math.max(n, f), x: Math.round(r.left + 3), headH: r.height };
  }
  const sc = document.querySelector('[data-testid="runs-table"] [data-dt-scroller]') as HTMLElement;
  const row = document.querySelector('[data-testid="runs-table"] tbody tr[data-run-id]') as HTMLElement;
  const td = row.querySelector('td[data-col="run"]') as HTMLElement;
  const r = td.getBoundingClientRect();
  return { line: sc.getBoundingClientRect().left + parseFloat(getComputedStyle(td).left), y: Math.round(r.top + r.height / 2), x: 0, headH: 0 };
}, TABLE);

const shots: Array<{ ts: number; data: string }> = [];
cdp.on('Page.screencastFrame', (e: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
  shots.push({ ts: e.metadata.timestamp, data: e.data });
  void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
});
await page.mouse.move(Math.min(WIDTH / 2, 700), 500);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: WIDTH, maxHeight: 900, everyNthFrame: 1 });
for (let i = 0; i < 120; i++) {
  await page.mouse.wheel(TABLE === 'runs' ? 60 : 0, TABLE === 'items' ? 60 : 0);
  await page.waitForTimeout(16);
}
await page.waitForTimeout(200);
await cdp.send('Page.stopScreencast');
if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, Buffer.from(shots[Math.floor(shots.length * 0.6)]!.data, 'base64'));

// Decode in a clean page: find the magenta (header) top edge / the cyan (frozen cells) left edge in every composited frame.
const dec = await ctx.newPage();
await dec.setContent('<canvas id=c></canvas>');
const series: Array<{ t: number; pos: number | null }> = await dec.evaluate(
  async ({ frames, t, x, y }) => {
    const out: Array<{ t: number; pos: number | null }> = [];
    const c = document.getElementById('c') as HTMLCanvasElement;
    for (const f of frames) {
      const img = new Image();
      await new Promise<void>((res) => ((img.onload = () => res()), (img.src = 'data:image/jpeg;base64,' + f.data)));
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      let pos: number | null = null;
      if (t === 'items') {
        const d = g.getImageData(x, 0, 1, img.height).data;
        for (let yy = 0; yy < img.height; yy++) {
          const r = d[yy * 4]!, gg = d[yy * 4 + 1]!, b = d[yy * 4 + 2]!;
          if (r > 200 && gg < 70 && b > 200) { pos = yy; break; }
        }
      } else {
        const d = g.getImageData(0, y, img.width, 1).data;
        for (let xx = 0; xx < img.width; xx++) {
          const r = d[xx * 4]!, gg = d[xx * 4 + 1]!, b = d[xx * 4 + 2]!;
          if (r < 70 && gg > 200 && b > 200) { pos = xx; break; }
        }
      }
      out.push({ t: f.ts, pos });
    }
    return out;
  },
  { frames: shots, t: TABLE, x: target.x, y: target.y ?? 0 },
);
await browser.close().catch(() => {});
const ok = series.filter((s) => s.pos != null);
// settle: header starts at its natural place; judge the frames after the first quarter of the scroll
const judged = ok.slice(Math.floor(ok.length / 4));
// The stable stuck position is the reference (the sticky line differs from the nav bottom by the page chrome); lag = deviation from it.
const refPos = median(judged.map((s) => s.pos as number));
const lags = judged.map((s) => (s.pos as number) - refPos);
const dts = ok.slice(1).map((s, i) => (s.t - ok[i]!.t) * 1000);
const result = {
  table: TABLE, width: WIDTH, cpu: CPU, target, refPos,
  compositedFrames: shots.length, framesWithMarker: ok.length, judged: judged.length,
  medianLagPx: Number(median(lags.map(Math.abs)).toFixed(2)),
  p95LagPx: Number(pct(lags.map(Math.abs), 95).toFixed(2)),
  maxLagPx: Number(Math.max(0, ...lags.map(Math.abs)).toFixed(2)),
  framesLagOver1px: lags.filter((l) => Math.abs(l) > 1).length,
  presentedFps: Number((1000 / median(dts)).toFixed(1)),
};
if (PLOT) {
  await (async () => {
    const b2 = await launch();
    await svgToPng(
      b2,
      linePlot({
        title: `${PLOT}: composited-frame offset of ${TABLE === 'items' ? 'sticky header vs line' : 'frozen cells vs target'} (${WIDTH}px, cpu x${CPU})`,
        w: 760, h: 260,
        series: [{ name: 'abs offset px per presented frame', color: '#e5694b', pts: lags.map((l, i) => [i, Math.abs(l)] as [number, number]) }],
        xLabel: 'presented frame during 2 s scroll', yLabel: 'px', hlines: [{ y: 1, label: 'target 1 px' }],
      }),
      `${PLOT}.png`, 760, 260,
    );
    await b2.close();
  })();
}
save(`visual-${TABLE}-${WIDTH}-cpu${CPU}`, result);
