/**
 * D1 diagnosis: does the page scroller scroll on the compositor thread while the main thread is busy, as the browser does for a plain
 * scroller? A magenta marker (a plain absolutely positioned div, NOT sticky, inside the scroller) is read in every presented frame
 * (CDP screencast) while a touch drag scrolls the page and the main thread is blocked 60 ms in every 120 ms.
 *   TARGET=app|plain  node d1-scroll-thread.mts
 *   app    the run page (`jsonKeys`, item j-01 open): the scroller is #shell-content
 *   plain  a bare page: one overflow:auto div with 20,000 px of content and one sticky bar (the control)
 * Output: presented frames, frames in which the marker did not move while the finger did (stalled), the longest stall in ms, and the
 * marker's total travel. A plain scroller advances during the block (stalls 0, travel = finger travel); a scroller that needs the main thread
 * for every step shows stalls of the block's length.
 */
import { BASE, r7, save, launch, newPageTouch, STORAGE_INIT } from './lib7.mts';

const TARGET = (process.env.TARGET ?? 'app') as 'app' | 'plain';
const JANK = Number(process.env.JANK ?? 60);
const browser = await launch();
const { ctx, page, cdp } = await newPageTouch(browser, { width: 1000, height: 700, init: [STORAGE_INIT] });
if (TARGET === 'app') {
  await page.goto(`${BASE}/projects/${r7.slug}/runs/${r7.jsonKeys}?item=j-01`);
  await page.getByTestId('item-card').waitFor();
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: '#r7mark{position:absolute;left:600px;width:80px;height:30px;background:#ff00ff;z-index:99;pointer-events:none}' });
  await page.evaluate(() => { const sc = document.getElementById('shell-content')!; sc.style.position = 'relative'; const m = document.createElement('div'); m.id = 'r7mark'; m.style.top = `${sc.scrollTop + 300}px`; m.style.left = `${620 - sc.getBoundingClientRect().left}px`; sc.appendChild(m); });
} else {
  await page.setContent(`<style>body{margin:0;background:#12151b}#sc{height:700px;overflow:auto;position:relative}#tall{height:20000px;background:linear-gradient(#222,#444)}#bar{position:sticky;top:0;height:30px;background:#00ffff}#r7mark{position:absolute;left:600px;top:300px;width:80px;height:30px;background:#ff00ff}</style><div id=sc><div id=bar></div><div id=tall></div><div id=r7mark></div></div>`);
}
const shots: Array<{ ts: number; data: string }> = [];
cdp.on('Page.screencastFrame', (e: { data: string; sessionId: number; metadata: { timestamp: number } }) => { shots.push({ ts: e.metadata.timestamp, data: e.data }); void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
await page.evaluate((j) => { setInterval(() => { const t = performance.now(); while (performance.now() - t < j) { /* block */ } }, 120); }, JANK);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1000, maxHeight: 700, everyNthFrame: 1 });
let y = 640;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 500, y }] });
for (let i = 0; i < 40; i++) { y -= 12; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 500, y }] }); await page.waitForTimeout(16); }
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(400);
await cdp.send('Page.stopScreencast');
const dec = await ctx.newPage();
await dec.setContent('<canvas id=c></canvas>');
const ys: Array<[number, number | null]> = await dec.evaluate(async (frames) => {
  const out: Array<[number, number | null]> = []; const c = document.getElementById('c') as HTMLCanvasElement;
  for (const f of frames) {
    const img = new Image(); await new Promise<void>((res) => ((img.onload = () => res()), (img.src = 'data:image/jpeg;base64,' + f.data)));
    c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
    const d = g.getImageData(640, 0, 1, img.height).data; let yy: number | null = null;
    for (let k = 0; k < img.height; k++) if (d[k * 4]! > 200 && d[k * 4 + 1]! < 70 && d[k * 4 + 2]! > 200) { yy = k; break; }
    out.push([f.ts, yy]);
  }
  return out;
}, shots);
const seq = ys.filter(([, v]) => v !== null) as Array<[number, number]>;
let stalled = 0, longest = 0, run = 0;
for (let i = 1; i < seq.length; i++) { if (seq[i]![1] === seq[i - 1]![1]) { stalled++; run += (seq[i]![0] - seq[i - 1]![0]) * 1000; longest = Math.max(longest, run); } else run = 0; }
await browser.close();
save(`d1-scroll-thread-${TARGET}-jank${JANK}`, { target: TARGET, jankMs: JANK, frames: ys.length, framesWithMarker: seq.length, stalledFrames: stalled, longestStallMs: Math.round(longest), markerTravelPx: seq.length ? seq[0]![1] - seq.at(-1)![1] : 0, fingerTravelPx: 40 * 12, ys: seq.map((s) => s[1]) });
