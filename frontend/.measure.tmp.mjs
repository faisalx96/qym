// ../../../../../../tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/measure.mts
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
var seed = JSON.parse(readFileSync(process.argv[2], "utf8"));
var BASE = "http://127.0.0.1:5998";
var run = (slug, id) => `${BASE}/projects/${slug}/runs/${id}`;
var box = async (page, sel) => page.evaluate((s) => {
  const els = [...document.querySelectorAll(s)];
  return els.map((e) => {
    const r = e.getBoundingClientRect();
    return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  });
}, sel);
var out = {};
var browser = await chromium.launch();
for (const w of [1440, 1024, 390]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, colorScheme: "dark" });
  const r = {};
  const open = async (url) => {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
  };
  await open(run(seed.slug, seed.union));
  r.hero = await box(page, "[data-testid=run-hero]");
  r.strip = await box(page, "[data-testid=run-hero-strip]");
  r.fact = await box(page, "[data-testid=hero-datasets-fact] > *");
  r.context = await box(page, "[data-testid=hero-context]");
  r.chips = await box(page, "[data-testid=hero-dataset-chip]");
  r.more = await page.evaluate(() => document.querySelector("#run-hero-chips ~ button")?.textContent ?? null);
  r.nav = await box(page, "[data-section]");
  r.navbar = await page.evaluate(() => {
    const n = document.querySelector("[data-section]")?.closest("nav,div");
    const r2 = n?.getBoundingClientRect();
    return r2 ? [r2.width, r2.height] : null;
  });
  r.section = await box(page, "#run-section-datasets");
  r.table = await box(page, "[data-testid=dataset-breakdown]");
  r.filter = await box(page, "[data-testid=dataset-filter]");
  r.cardsW = await box(page, "#run-section-datasets table");
  await open(run(seed.slug, seed.single));
  r.singleHero = await box(page, "[data-testid=run-hero]");
  r.singleStrip = await box(page, "[data-testid=run-hero-strip]");
  await open(run(seed.manySlug, seed.many));
  r.manyHero = await box(page, "[data-testid=run-hero]");
  r.manyMore = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent).find((t) => /more/.test(t ?? "")) ?? null);
  r.manySection = await box(page, "#run-section-datasets");
  await open(run(seed.delSlug, seed.deleted));
  r.delHero = await box(page, "[data-testid=run-hero]");
  await open(run(seed.singleSlug, seed.onlySingle));
  r.onlySingleHero = await box(page, "[data-testid=run-hero]");
  out[String(w)] = r;
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
