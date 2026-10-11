# datasets-reviews-trash — decisions taken alone

One dated line per decision the component agent made without a human.

- 2026-10-11 — `frontend/src/lib/` was never committed on `ui/foundation` (root `.gitignore` `lib/` rule). Copied it from the foundation worktree onto this branch and added `!frontend/**/lib/` to `.gitignore` (the rule also swallowed `features/*/lib/`). The reviewer should land the same fix on `ui/foundation`.
- 2026-10-11 — Catalog sort goes into the URL as `?sort=` (client-side; `GET /v1/datasets` has no sort). Default `updated_desc` is omitted from the URL.
- 2026-10-11 — Items `?page=` stays 0-based (deep-link compatibility); page size is `?size=` (not persisted), default 50.
- 2026-10-11 — Reviews sort moves from `localStorage['qym.reviews.sort']` into `?sort=` (shareable links). Default `oldest` is omitted. The old key is not read.
- 2026-10-11 — Reviews multiselect "none selected" (`[]`) keeps the vanilla semantics: `__none__` in the URL, no param sent to the API (same results as "all").
- 2026-10-11 — Trash gets URL state: `?q=`, `?project=<project_id>`, `?page=` (1-based). Restore has no undo (a restored run is simply back in the project); the toast lists skipped reasons.
- 2026-10-11 — Wizard CSV/JSON parsing runs in a Web Worker (`features/datasets/lib/parse.worker.ts`); the main thread only receives headers/rows. `:upload` uses XHR so the Review step shows byte progress; add-to-draft shows "batch n of m".
- 2026-10-11 — Item page gets an unsaved-changes guard (in-app confirm on Prev/Next/tab/Back + `beforeunload`).
- 2026-10-11 — "Revert to revision" is re-exposed on the item History tab (full-body PATCH of input/expected_output/metadata/labels), only on drafts.
- 2026-10-11 — Private test set toggle asks for confirmation before hiding items from the team (it affects everyone instantly).
- 2026-10-11 — Reviews `?id=` to a correction outside the loaded page: kept the vanilla behaviour (fetched separately, inserted at the top, ringed) and labelled it "Linked" so the out-of-order position is explained.
- 2026-10-11 — DataTable `storageKey`s reuse the legacy names (`datasets.items.v2`, `datasets.runs.v2`, `datasets.item.runs.v4`, `datasets.deleted.v1`, `trash-v2`) so column widths carry over.
