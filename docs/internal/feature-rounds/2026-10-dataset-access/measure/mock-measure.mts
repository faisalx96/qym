/**
 * The numbers of the specified design, measured on the gallery mocks (/__ui#eval-flags) at 1440, 1024 and 390 px.
 * Output: baseline/mock-<width>.json (the spec's criteria quote these). Needs only Vite.
 *   VITE_BASE=http://127.0.0.1:5982 node mock-measure.mts
 */
import { chromium, APP, WIDTHS, open, save } from './lib-b.mts';

const browser = await chromium.launch();
for (const width of WIDTHS) {
  const { page, ctx } = await open(browser, width, 1000);
  await page.goto(`${APP}/__ui`);
  await page.waitForSelector('[data-gallery-section="eval-flags"]');
  await page.waitForTimeout(1200);
  const out = await page.evaluate(() => {
    const root = document.querySelector('[data-gallery-section="eval-flags"]') as HTMLElement;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const b = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { w: r1(r.width), h: r1(r.height), font: `${cs.fontSize}/${cs.fontWeight}`, family: cs.fontFamily.split(',')[0].replace(/"/g, ''), overflowX: el.scrollWidth - el.clientWidth };
    };
    const all = (sel: string) => Array.from(root.querySelectorAll(sel));
    const res: Record<string, unknown> = {};
    res.runSettings = all('[data-testid="launch-run-settings"]').map((el) => ({
      card: b(el.closest('section')),
      checkbox: b(el.querySelector('[data-testid="launch-latency"] label')),
      helper: b(el.querySelector('[data-testid="launch-latency"] p')),
      reason: b(el.querySelector('[data-testid="launch-latency-reason"]')),
      callout: b(el.querySelector('[role="note"]')),
      name: b(el.querySelector('input')),
      priority: b(el.querySelector('button')),
    }));
    res.review = all('aside[aria-label="Review"]').map((el) => ({
      pane: b(el),
      rows: Array.from(el.querySelectorAll('dl > div')).map((d) => `${d.querySelector('dt')?.textContent}:${r1(d.getBoundingClientRect().height)}`),
      callouts: Array.from(el.querySelectorAll('[role="note"]')).map((c) => b(c)),
      problem: b(el.querySelector('ul button')),
    }));
    res.dataset = all('[data-testid="launch-dataset"]').map((el) => ({
      trigger: b(el.querySelector('button')),
      chip: b(el.querySelector('[data-testid="dataset-chip"]')),
      help: b(el.querySelector('[data-testid="dataset-token-help"]')),
      options: Array.from(el.querySelectorAll('[role="option"]')).map((o) => b(o)),
    }));
    res.header = all('[data-testid="exp-header-mock"]').map((el) => ({
      page: b(el),
      title: b(el.querySelector('h1,[data-variant="title"]')),
      latencyTag: b(el.querySelector('[data-testid="latency-tag"]')),
      creds: b(el.querySelector('[data-testid="exp-credentials"]')),
      apiBadge: b(el.querySelector('[data-testid="cred-api-key"] > *')),
      tokenBadge: b(el.querySelector('[data-testid="cred-dataset-token"] > *')),
      notice: b(el.querySelector('[data-testid="token-notice"]')?.closest('[role="note"]') ?? null),
    }));
    res.jobs = all('[data-exp-jobs]').map((el) => ({
      statusHeader: b(Array.from(el.querySelectorAll('[role="columnheader"]')).find((h) => h.textContent?.trim() === 'Status') ?? null),
      rows: Array.from(el.querySelectorAll('[role="row"]')).slice(0, 8).map((r) => r1(r.getBoundingClientRect().height)),
      requeueTag: b(el.querySelector('[data-testid="requeue-tag"]')),
    }));
    res.listQueue = {
      latencyTags: all('[data-testid="latency-tag"]').length,
      tag: b(all('[role="grid"] [data-testid="latency-tag"]')[0] ?? null),
      filter: b(all('[data-testid="filter-latency"]')[0] ?? null),
      note: b(all('[data-testid="queue-latency-note"]')[0] ?? null),
      rows: all('[aria-label="Experiments"] [role="row"]').slice(0, 6).map((r) => r1(r.getBoundingClientRect().height)),
      queueRows: all('[aria-label="Our jobs"] [role="row"]').slice(0, 5).map((r) => r1(r.getBoundingClientRect().height)),
    };
    res.env = all('[data-section="env-policies"]').map((el) => ({
      section: b(el),
      selects: Array.from(el.querySelectorAll('button')).map((x) => b(x)),
      disabled: el.querySelectorAll('button[disabled], button[data-disabled]').length,
    }));
    res.tokens = {
      rows: all('[aria-label="Dataset read tokens"] [role="row"]').map((r) => r1(r.getBoundingClientRect().height)),
      chip: b(all('[data-testid="token-kind-chip"]')[0] ?? null),
      link: b(all('[data-testid="token-experiment-link"]')[0] ?? null),
      dialog: b(all('[data-testid="token-revoke-copy"]')[0] ?? null),
    };
    res.pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return res;
  });
  save(`mock-${width}`, { width, ...out });
  await ctx.close();
}
await browser.close();
console.log('ok');
