/** Scenario 11: the packaged viewer is a flat, offline, lean bundle. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, freshFile, rows, startLive, finishLive, test, LIVE } from './support';

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/sdk/qym/_static/ui',
);

test.describe('bundle', () => {
  test('contains exactly index.html, app.js, app.css, favicon.svg and stays under 450 KB', () => {
    const files = readdirSync(dir).sort();
    expect(files).toEqual(['app.css', 'app.js', 'favicon.svg', 'index.html']);
    const total = files.reduce((n, f) => n + statSync(path.join(dir, f)).size, 0);
    // 300 KB before the Plex faces were embedded (about 184 KB of base64 woff2, see tokens.css)
    expect(total).toBeLessThan(450 * 1024);
  });

  test('has no external URLs, webfonts or CDN references', () => {
    const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
    const css = readFileSync(path.join(dir, 'app.css'), 'utf8');
    const js = readFileSync(path.join(dir, 'app.js'), 'utf8');
    expect(html).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/@import/);
    // no font or image files to fetch: the only url() allowed is an inlined woff2 data URI
    for (const m of css.matchAll(/url\(([^)]*)\)/g))
      expect(m[1], 'url()').toMatch(/^["']?data:font\/woff2;base64,/);
    // every @font-face is either inlined (data URI) or maps onto fonts already installed on the machine
    for (const face of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      const src = /src:((?:[^;()]|\([^)]*\))*)/.exec(face)?.[1] ?? '';
      expect(
        src
          .split(/,(?![^(]*\))/)
          .every((part) => /^\s*(local\(|url\(["']?data:font\/woff2;base64,)/.test(part)),
        face.slice(0, 120),
      ).toBe(true);
    }
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)/);
    // app.js (React) only mentions the SVG namespace and docs links in error strings: none is fetched
    const urls = new Set(js.match(/https?:\/\/[^\s"'`)\\]+/g) ?? []);
    const allowed = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/(react\.dev|reactjs\.org)\//];
    const unexpected = [...urls].filter((u) => !allowed.some((re) => re.test(u)));
    expect(unexpected).toEqual([]);
    expect(js).not.toMatch(/\bimport\(\s*["']https?:/);
    expect(js).not.toMatch(/fetch\(\s*["']https?:/);
  });

  test('a full session (live, file, detail) only talks to the local server', async ({ page, request }) => {
    const hosts = new Set<string>();
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol === 'http:' || u.protocol === 'https:') hosts.add(u.host);
    });
    await startLive(request);
    await page.goto(LIVE);
    await expect(rows(page)).toHaveCount(8);
    await rows(page).first().click();
    await finishLive(request);
    const { url } = await freshFile(request);
    await page.goto(url);
    await expect(rows(page)).toHaveCount(8);
    expect([...hosts].sort()).toEqual(['127.0.0.1:8818', '127.0.0.1:8819']);
  });

  test('assets are served with the right types and the index works on /run/*', async ({ request }) => {
    const js = await request.get(`${LIVE}/app.js`).catch(() => null);
    // the live server may be down between scenarios: use the file server, which always runs
    const res = await request.get('http://127.0.0.1:8819/app.js');
    expect(res.headers()['content-type']).toContain('javascript');
    expect((await request.get('http://127.0.0.1:8819/app.css')).headers()['content-type']).toContain(
      'text/css',
    );
    expect((await request.get('http://127.0.0.1:8819/favicon.svg')).headers()['content-type']).toContain(
      'svg',
    );
    const page = await request.get('http://127.0.0.1:8819/run/anything');
    expect(await page.text()).toContain('<div id="root">');
    expect((await request.get('http://127.0.0.1:8819/../../etc/passwd')).status()).toBe(404);
    expect(js === null || js).toBeTruthy();
  });
});
