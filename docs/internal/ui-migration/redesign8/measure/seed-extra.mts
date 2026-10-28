/** Adds four more aligned runs (e1..e4) to the project of the compare seed so 8-run pages can be measured. Usage: seed-extra.mts <platform url> <ids key: react|legacy> */
import { ensureProject, createApiKey, seedCompareRun } from '../../../../../frontend/e2e/compare/seed.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [baseUrl, key] = process.argv.slice(2);
const client = { baseUrl };
const file = path.join(path.dirname(new URL(import.meta.url).pathname), 'seed-ids.json');
const ids = JSON.parse(readFileSync(file, 'utf8'));
const project = await ensureProject(client, 'Compare demo', 'cmp-r8');
const token = await createApiKey(client, project.id);
const specs = [
  ['cand-d-mini-high', 'openai/gpt-5-mini', 0.2, 7],
  ['cand-e-haiku', 'anthropic/claude-haiku-4', -0.05, 8],
  ['cand-f-large', 'openai/gpt-5', 0.3, 9],
  ['cand-g-flash', 'google/gemini-2.5-flash', 0.05, 10],
] as const;
for (const [i, [name, model, skill, seed]] of specs.entries())
  ids[key][`e${i + 1}`] = await seedCompareRun(client, token, { name, model, skill, seed, taskErrors: i === 1 ? [3] : [] });
writeFileSync(file, JSON.stringify(ids, null, 1));
console.log(ids[key]);
