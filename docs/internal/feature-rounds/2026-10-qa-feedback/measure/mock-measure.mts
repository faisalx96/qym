/** Numbers of the specified design, measured on the gallery mocks (/__ui#qa-experiments) at 1440, 1024, 390. Output baseline/mock-<w>.json. Needs only Vite. */
import { chromium, APP, WIDTHS, open, save } from './lib.mts';
const browser = await chromium.launch();
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width, 1000);
  await page.goto(`${APP}/__ui#qa-experiments`);
  await page.waitForSelector('[data-case^="qb-"]');
  await page.waitForTimeout(1200);
  const out = await page.evaluate(() => {
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const b = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { w: r1(r.width), h: r1(r.height), font: `${cs.fontSize}/${cs.fontWeight}`, family: cs.fontFamily.split(',')[0].replace(/"/g, ''), ox: el.scrollWidth - el.clientWidth };
    };
    const cs = (id: string) => document.querySelector(`[data-case^="${id} "]`) as HTMLElement;
    const all = (root: Element, sel: string) => Array.from(root.querySelectorAll(sel));
    const res: Record<string, unknown> = {};
    const home = cs('qb-home');
    res.home = all(home, '[class*="where"]').map((w) => ({
      row: b(w), env: b(w.children[0]), dataset: b(w.children[1]),
      block: b(w.querySelector('[data-testid="home-latency"]')), checkbox: b(w.querySelector('[data-testid="launch-latency"] label')),
      helper: b(w.querySelector('[data-testid="launch-latency"] p')), reason: b(w.querySelector('[data-testid="launch-latency-reason"]')),
      callout: b(w.querySelector('[role="note"]')),
    }));
    const ver = cs('qb-versions');
    res.versions = all(ver, 'section[aria-label="Current versions"]').map((s) => ({
      card: b(s), head: b(s.querySelector('[class*="versionsHead"]')), buttons: all(s, 'button').map((x) => (x.textContent || '').trim()),
      rows: all(s, '[data-env-version]').map((r) => `${r.getAttribute('data-env-version')}:${r.getAttribute('data-status')}:${r1(r.getBoundingClientRect().height)}`),
      tags: all(s, 'dd span').slice(0, 3).map((t) => b(t)),
    }));
    const st = cs('qb-step1');
    res.step1 = all(st, '[data-testid="launch-entry-mock"]').map((e) => ({
      total: b(e), run: b(e.querySelector('section[aria-label="Name and priority"]')),
      where: b(e.querySelector('[class*="where"]')), versions: b(e.querySelector('section[aria-label="Current versions"]')),
      textarea: e.querySelectorAll('textarea').length, versioningLabel: /Versioning details/.test(e.textContent || ''),
    }));
    const runs = cs('qb-runs');
    res.runs = all(runs, '[data-testid="run-cell"]').map((c) => ({
      cell: b(c), name: b(c.querySelector('a')), official: b(c.querySelector('[title="Run launched by an official experiment"]')),
      tag: b(c.querySelector('[data-testid="run-latency-tag"]')), nameText: (c.querySelector('a')?.textContent || ''),
    }));
    const list = cs('qb-list');
    res.list = all(list, '[class*="listCell"]').map((c) => ({ cell: b(c), tag: b(c.querySelector('[data-testid="latency-tag"]')), name: b(c.querySelector('[class*="nameLine"]')) }));
    res.pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return res;
  });
  save(`mock-${width}`, { width, ...out });
  await ctx.close();
}
await browser.close();
