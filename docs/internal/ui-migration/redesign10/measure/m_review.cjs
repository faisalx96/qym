// K2: "N runs to launch" on the Review step with the two-axis sweep (linked model x threshold, plain timeout, 2 environments):
// columns, widths, the swept-setting tags, the dry-run axes. Usage: node m_review.cjs [current|mock]
const { open, ids, base, PROJ, SHOTS } = require('./pw.cjs');
const mode = process.argv[2] ?? 'current';
const probe = () => {
  const f = (v) => Math.round(v * 10) / 10;
  const card = document.querySelector('[data-part=review-runs]');
  const out = { card: card && f(card.getBoundingClientRect().width) };
  const table = document.querySelector('[data-part=runs-table]');
  if (table) {
    const ths = Array.from(table.querySelectorAll('thead th, [role=columnheader]'));
    out.columns = ths.map((t) => `${t.innerText.trim().replace(/\s+/g, ' ')}:${f(t.getBoundingClientRect().width)}`);
    const rows = Array.from(table.querySelectorAll('tbody tr, [role=row][data-run]'));
    out.rows = rows.length;
    out.rowH = rows[0] && f(rows[0].getBoundingClientRect().height);
    out.firstRows = rows.slice(0, 3).map((r) => Array.from(r.children).map((c) => c.innerText.trim().replace(/\s+/g, ' ')).join(' | '));
    const tags = Array.from(table.querySelectorAll('[data-part=runs-table] tbody td span')).filter((s) => getComputedStyle(s).fontFamily.includes('Mono'));
    out.tagSample = tags.slice(0, 2).map((t) => `${t.innerText} w=${f(t.getBoundingClientRect().width)} font=${getComputedStyle(t).fontSize} ellipsis=${getComputedStyle(t).textOverflow} clipped=${t.scrollWidth > t.clientWidth}`);
    const scroller = table.querySelector('[data-scroll], [class*=scroll]') ?? table;
    out.scroll = `${scroller.scrollWidth}/${scroller.clientWidth}`;
  }
  const cards = document.querySelector('[data-part=runs-cards]');
  if (cards) {
    const li = cards.querySelectorAll('li');
    out.cards = li.length;
    out.cardH = f(li[0].getBoundingClientRect().height);
    out.firstCard = li[0].innerText.replace(/\n/g, ' | ');
  }
  const swept = document.querySelector('[data-part=review-swept]');
  if (swept) out.swept = swept.innerText.replace(/\n/g, ' | ');
  const changes = document.querySelector('[data-part=review-changes]');
  if (changes) out.changes = changes.innerText.replace(/\n/g, ' | ').slice(0, 300);
  return out;
};
(async () => {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
    const { browser, page } = await open(w, h);
    if (mode === 'mock') {
      if (w === 1024) {
        // the mock shell is drawn at 1440 or 390; the 1024 column (777 px) is measured on the sheet's frames below
        await browser.close();
        continue;
      }
      await page.goto(`${base}/__mock/round10/review`);
      await page.waitForSelector('[data-part=review-runs]');
      await page.waitForTimeout(600);
      console.log(w, JSON.stringify(await page.evaluate(probe), null, 1));
      const first = await page.evaluate(() => {
        const f = (v) => Math.round(v * 10) / 10;
        const sum = document.querySelector('[data-part=review-summary]')?.closest('section, [class*=card]') ?? document.querySelector('[data-part=review-summary]');
        const rows = document.querySelectorAll('[data-part=runs-table] tbody tr');
        const bar = document.querySelector('[data-part=launch-bar]');
        return { summaryBottom: f(sum.getBoundingClientRect().bottom), run2Bottom: rows[1] && f(rows[1].getBoundingClientRect().bottom), run4Bottom: rows[3] && f(rows[3].getBoundingClientRect().bottom), barTop: f(bar.getBoundingClientRect().top) };
      });
      console.log(w, 'first screen', JSON.stringify(first));
      if (w === 1440) {
        await page.goto(`${base}/__mock/round10/sheet-runs`);
        await page.waitForSelector('[data-part=runs-sheet]');
        await page.waitForTimeout(600);
        const frames = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-part^=runs-table]')).map((t) => {
            const f = (v) => Math.round(v * 10) / 10;
            const sc = Array.from(t.querySelectorAll('*')).find((e) => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX));
            const ths = Array.from(t.querySelectorAll('thead tr:last-child th'));
            return `${t.dataset.part} frame ${f(t.getBoundingClientRect().width)}: ${sc ? `scrolls ${sc.scrollWidth}/${sc.clientWidth}` : 'no scroll'}; columns ${ths.map((h) => `${h.innerText.replace(/\s+/g, ' ').trim()}:${f(h.getBoundingClientRect().width)}`).join(' | ')}`;
          }),
        );
        for (const l of frames) console.log(l);
      }
    } else {
      await page.goto(`${base}${PROJ}/experiments`);
      const { twoAxis } = await ids(page);
      let dry = null;
      page.on('response', async (r) => {
        if (r.request().method() === 'POST' && /\/experiments(\?|$)/.test(r.url())) {
          try { dry = await r.json(); } catch { /* ignore */ }
        }
      });
      await page.goto(`${base}${PROJ}/experiments/new?clone=${twoAxis}&step=review`);
      await page.waitForSelector('[data-part=review-runs]', { timeout: 30000 });
      await page.waitForTimeout(3000);
      console.log(w, JSON.stringify(await page.evaluate(probe), null, 1));
      if (w === 1440 && dry) console.log('dry-run axes', JSON.stringify(dry.axes), 'job0', JSON.stringify({ label: dry.jobs?.[0]?.label, params: dry.jobs?.[0]?.params }));
      await page.screenshot({ path: `${SHOTS}/current-review-two-axis-${w}.png`, fullPage: true });
      const runs = page.locator('[data-part=review-runs]');
      await runs.screenshot({ path: `${SHOTS}/current-review-two-axis-runs-${w}.png` });
    }
    await browser.close();
  }
})();
