# Integration gate: dataset access, disabled items, batch edits, experiment dataset token, latency-sensitive runs

Merged tip of `UI-redesign`: 901e1afb (WP-A merge 04fe24b2, WP-B merge 9dc47d19, integration fixes 901e1afb). Python 3.11.17 (the
project's official version; `.venv` rebuilt on it on 2026-10-20), Node 24, every heavy step through `scripts/heavy.sh`. Run 2026-10-20.

| Step | Result |
|---|---|
| Migration tests (`test_migrations.py`, `test_migrations_0088.py`: SQLite round trips of 0087 and 0088, one head `0088`) | pass |
| Alembic chain 0086 → 0087 → 0088 on Postgres | **not run**: no Postgres on the machine (`QYM_TEST_POSTGRES_URL` unset); a fresh-SQLite chain from 0001 stops at an old revision (pre-existing, SQLite deployments build tables from the models) |
| `npm run check` (tsc, eslint, stylelint, Vitest, design-language test) | pass |
| `npm run build` | pass |
| `pytest tests/platform` in five chunks of 48 files | 2,949 passed, 767 skipped (Postgres cases), 0 failed |
| `pytest tests/sdk` | 498 passed, 4 skipped |
| `pytest tests/platform/test_design_language.py` | pass |
| Playwright `e2e/datasets` | 178 passed, 3 skipped (identity spec runs only in header-auth mode; it passed there in the WP-A re-review) |
| Playwright `e2e/experiments` | 160 passed |
| Playwright `e2e/environments` | 2 passed |
| Playwright `e2e/shell` | 98 passed, 8 skipped |
| Playwright `e2e/compare` | 119 passed |
| Playwright `e2e/run-detail` | 408 passed, 9 skipped, 1 failed: `redesign2-items.spec.ts:101` (pre-existing flake, fails 2 of 20 on the base commit 38d710c5; passes 3 of 3 alone on this tip) |

Goldens `payload_minimize_labeled_run_{full,compact}.json` were regenerated at integration: the only change is float summation noise
(0.39999999999999997 → 0.4000000000000001) from the newer Python and numpy; stable across runs.

Pre-existing flaky specs left alone: `redesign2-items.spec.ts:101`, `redesign3-header.spec.ts:196`.

Specs, mocks, implementation notes and measured reviews: `spec-a.md`, `spec-b.md`, `impl-notes-a.md`, `impl-notes-b.md`, `review-a.md`
(MEETS, 190/190 after one fix pass), `review-b.md` (MEETS, 130/130 after one fix pass). Design document:
`docs/internal/DATASET_ACCESS_AND_EVAL_FLAGS_DESIGN.md` (owner decisions D1-D7 in section 8).
