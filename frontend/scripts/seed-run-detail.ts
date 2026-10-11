/**
 * Seed the run-detail scenarios into a running platform (dev walkthrough).
 *   node frontend/scripts/seed-run-detail.ts http://127.0.0.1:8802 [slug]
 */
import { seedAll } from '../e2e/run-detail/seed.ts';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8802';
const slug = process.argv[3] ?? 'rd-seed';
seedAll({ baseUrl }, slug).then(
  (result) => console.log(JSON.stringify(result, null, 2)),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
