// Dev walkthrough: seeds the compare scenario into a running platform.
// Usage: npx tsx scripts/seed-compare.ts http://127.0.0.1:8803 compare-demo
import { seedCompareScenario } from '../e2e/compare/seed.ts';

const [baseUrl = 'http://127.0.0.1:8803', slug = 'compare-demo'] = process.argv.slice(2);
seedCompareScenario({ baseUrl }, slug).then((r) => console.log(JSON.stringify(r, null, 2)));
