# Integration gate, QA feedback round (October 2026)

Merged tip: `UI-redesign` 74a024a0 (2026-10-22). Merges: QA-B `feat/qa-experiments` de89613a (review MEETS, 73/75 measured, 1 unit-only,
re-review ea944102), QA-A `feat/qa-datasets` f6b72b2b (review MEETS 156/156, re-review 4df8b91e), then the follow-ups
`fix/dashboard-live-refresh-nowait` e45786ef and `fix/qa-axe-followups` 74a024a0. Ahead of the round on the same branch: the QA fixes
52b16bc1 (stale bundle reload), 81973094 (run-header JSON chips), 49dda808 (Columns menu drag), 013448a3 (release-notes head wording).
Nothing pushed. Logs: session scratchpad `qa/gate/` and `qa/*.log`.

## Gate on f6b72b2b (the two merged work packages), through `scripts/heavy.sh`

| Step | Result |
|---|---|
| Migration tests (SQLite round trips; no new migration this round) | 30 passed, 9 skipped |
| Alembic chain on Postgres | SKIPPED (no `QYM_TEST_POSTGRES_URL`) |
| `npm run check` | pass (design-language 54) |
| `npm run build` | pass |
| `pytest tests/platform`, 5 chunks of 48 files | 927 (rerun alone, first run killed by the memory cgroup), 849, 512, 709, 26 passed; 0 failed |
| `pytest tests/sdk` | 500 passed, 4 skipped |
| `test_design_language.py` | 1 passed |
| Playwright datasets | 217 passed |
| Playwright experiments | 192 passed |
| Playwright runs-list | 239 passed |
| Playwright docs | 14 passed |
| Playwright visual-language | 80 passed, 2 failed: `contrast.spec.ts:87` (axe, fixed below), `frozen-static.spec.ts:182` (pre-existing, fails on the base commit too; mouse.wheel timeout) |
| Playwright run-detail | 407 passed, 3 failed: `scope-sidebar.spec.ts:96`, `ux-a11y.spec.ts:25` ×2 (axe, fixed below) |
| Playwright shell | 97 passed, 1 failed: `a11y.spec.ts:60` UI gallery (axe, fixed below) |

## Follow-ups found by the gate

- **Axe (fix/qa-axe-followups 655c2c4a):** the run header's object chips (QA fix 81973094) had visible text outside their accessible
  name (`label-content-name-mismatch`); the QA-A gallery Tags chip row was `role=list` without list items; the QA mock tab bars had
  no panel for their selected tab; the QA-B mock loading versions list held text inside the `<dl>`. Product impact: the chip label only.
- **Live dashboard refresh (fix/dashboard-live-refresh-nowait bbd402c9):** owner-reported "ShareLock" failures of the summary worker;
  NOWAIT on the bucket and summary rows, busy ticks skipped and counted, `QYM_DASHBOARD_LIVE_REFRESH_SECONDS`.

## Verification on the merged tip 74a024a0

| Check | Result |
|---|---|
| `npm run check` (axe branch = tip's frontend) | 1,575 Vitest tests passed, design-language 54 |
| The five previously failing specs + `redesign3-header` | 43 passed, `--workers 1` |
| `test_dashboard_durable_summaries`, `test_main_lifespan`, `test_service_split` | 61 passed, 48 skipped (Postgres variants) |

## Not verified here

- PostgreSQL: the list-filter SQL (`json_each` / `jsonb_array_elements`), the NOWAIT live-refresh test and the Postgres test variants
  all skip without `QYM_TEST_POSTGRES_URL`; the PostgreSQL clause was reviewed by inspection only.
- `frozen-static.spec.ts:182` stays failing on the base commit (pre-existing).
