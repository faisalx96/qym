/**
 * WP-B review measurements (runs every review-b-*.mts in order). Needs the platform on :8986 (QYM_AUTH_MODE=proxy_headers, the SPA built
 * into _static/app), two fake Evaluation Services on :9086 (--flags) and :9087, the design-b seed and its second seed (seed-b.json /
 * seed2.json written by seed-b.mts and the review's own seed script), then:
 *   SEED_B=<seed-b.json> SEED_B2=<seed2.json> node review-b.mts
 * Output: review-out/*.json and shots/review-*.png. See review-b.md for how the states were seeded.
 */
for (const part of ['launch', 'launch2', 'launch3', 'chip', 'chip2', 'detail', 'jobs', 'jobs2', 'lists', 'revoke', 'clone', 'warn']) await import(`./review-b-${part}.mts`);
