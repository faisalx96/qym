// Usage (Node 24, from the repo root): node docs/internal/ui-migration/redesign4/seed-passes.mts <platform url>
// Seeds project "r4-seed": a classic single run, a 3-pass repeat run and a 10-pass repeat run (8 items each).
import * as s from '../../../../frontend/e2e/run-detail/seed.ts';
const client = { baseUrl: process.argv[2]! };
const p = await s.ensureProject(client, 'R4 seed', 'r4-seed');
const t = await s.createApiKey(client, p.id);
const out: Record<string, string> = { project: p.slug };
out.classic = await s.seedClassicRun(client, t);
out.repeat3 = await s.seedRepeatRun(client, t, { items: 8, samples: 3 });
out.repeat10 = await s.seedRepeatRun(client, t, { items: 8, samples: 10 });
console.log(JSON.stringify(out));
