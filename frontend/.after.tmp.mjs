// ../../../../../../tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/aftershots.mts
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
var seed = JSON.parse(readFileSync(process.argv[2], "utf8"));
var OUT = process.argv[3];
var BASE = "http://127.0.0.1:5998";
var run = (slug, id, q = "") => `${BASE}/projects/${slug}/runs/${id}${q}`;
var browser = await chromium.launch();
async function pageAt(w, h = 1e3) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: "dark" });
  return p;
}
var settle = async (p, ms = 1200) => {
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(ms);
};
var jump = async (p, sel) => {
  await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "start" }), sel);
  await p.waitForTimeout(600);
};
for (const w of [1440, 1024, 390]) {
  let p = await pageAt(w);
  await p.goto(run(seed.slug, seed.union));
  await settle(p);
  await p.screenshot({ path: `${OUT}/after-c-page-run-${w}.png` });
  await jump(p, "#run-section-datasets");
  await p.screenshot({ path: `${OUT}/after-c-page-run-datasets-${w}.png` });
  await jump(p, "#run-items");
  await p.screenshot({ path: `${OUT}/after-c-page-run-items-${w}.png` });
  await p.close();
  p = await pageAt(w);
  await p.goto(run(seed.slug, seed.union, "?dataset=support-tickets%40v2"));
  await settle(p);
  await jump(p, "#run-items");
  await p.screenshot({ path: `${OUT}/after-c-page-run-filtered-${w}.png` });
  await p.close();
  p = await pageAt(w, 800);
  await p.goto(`${BASE}/projects/${seed.slug}`);
  await settle(p);
  await p.screenshot({ path: `${OUT}/after-c-page-runs-${w}.png` });
  await p.close();
  p = await pageAt(w, 1100);
  await p.goto(`${BASE}/compare?runs=${seed.union}&runs=${seed.single}`);
  await settle(p, 2e3);
  await p.screenshot({ path: `${OUT}/after-c-page-compare-${w}.png` });
  await p.close();
  p = await pageAt(w);
  await p.goto(run(seed.singleSlug, seed.onlySingle));
  await settle(p);
  await p.screenshot({ path: `${OUT}/after-c-state-single-${w}.png` });
  await p.close();
  p = await pageAt(w);
  let release = () => {
  };
  const gate = new Promise((r) => release = r);
  await p.route(/\/api\/runs\/[^/]+\/datasets/, async (route) => {
    await gate;
    await route.continue();
  });
  await p.goto(run(seed.slug, seed.union));
  await p.waitForTimeout(2e3);
  await jump(p, "#run-section-datasets");
  await p.screenshot({ path: `${OUT}/after-c-state-loading-${w}.png` });
  release();
  await p.close();
  p = await pageAt(w);
  await p.goto(run(seed.delSlug, seed.deleted));
  await settle(p);
  await p.screenshot({ path: `${OUT}/after-c-state-deleted-${w}.png` });
  await jump(p, "#run-section-datasets");
  await p.screenshot({ path: `${OUT}/after-c-state-deleted-datasets-${w}.png` });
  await p.close();
  p = await pageAt(w);
  await p.goto(run(seed.manySlug, seed.many));
  await settle(p);
  await p.screenshot({ path: `${OUT}/after-c-state-many-${w}.png` });
  await jump(p, "#run-section-datasets");
  await p.screenshot({ path: `${OUT}/after-c-state-many-datasets-${w}.png` });
  await p.close();
}
await browser.close();
