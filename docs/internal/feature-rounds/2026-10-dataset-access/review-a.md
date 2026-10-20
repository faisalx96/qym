# WP-A review: dataset access, disabled items, batch edit by metadata

Reviewer: independent (branch `review/dataset-access`, from `feat/dataset-access` at fafbf196). Python 3.11.17. Production build (`npm run build`) served by the
platform on 8985 with `QYM_AUTH_MODE=proxy_headers` (SQLite scratch DB); every browser request carried `X-User-Email`, so viewer, creator, manager and
no-access states are real identities (admin, mgr, mem, mem2, mem3), not rewritten answers. Dark scheme, fresh context per width (1440, 1024, 390).
Scripts: `measure/review-a-seed.py`, `review-a-seed.mts`, `review-a-api.py`, `review-a-api2.py`, `review-a-api3.py` (curl-style API checks), `review-a.mts`,
`review-a-items*.mts`, `review-a-pane.mts`, `review-a-run*.mts`, `review-a-cmp.mts`, `review-a-misc.mts`, `review-a-hist.mts` (browser). Shots: `shots/review-*.png`.
Playwright runs used platform port 8975 (8984 was held by another worktree; eval service ports 9075/9076).

## Verdict: MEETS WITH FIXES

190 criteria. DOES NOT MEET: 2 (A1-33, A1-34). MEETS WITH FIXES: 3 (A1-1 card badge width, A1-30 at 390, A3-27 at 390 documentation). All others MEET: about 60 measured
by me directly (browser or API), the rest MEET through the passing e2e and pytest suites (marked "e2e" below). Owner decisions D1, D2, D7: none contradicted. The two DOES NOT MEET are D1 follow-through
(the redaction holds and nothing leaks, but the text names the wrong cause and the redacted item card never renders).

## Fix list (requested measured values)

| # | Ids | Defect (measured) | Change requested | Measured value must become |
|---|---|---|---|---|
| F1 | A1-33, A1-36 | A run on a restricted dataset, opened as a user with level none (mem3, run of `legal-clauses`): the items table input column reads `[private test set: visible to admins only]` for all 20 rows, and `POST /api/runs/{id}/items/details` returns the same string in `input`, `output`, `expected` (permissions.py `PRIVATE_TEST_SET_PLACEHOLDER`, used for every cause). The wrong cause is shown. | `redact_item_content` / the run payload placeholder must be reason-aware (dataset_access: `Hidden: you don’t have access to this dataset’s items.`), table cell and details alike | table text for mem3 on the restricted run = the A1-33 sentence; 0 occurrences of `private test set` on that page |
| F2 | A1-33 | Expanding row #1 as mem3 leaves `Loading item details…` forever (3.5 s, no `items/details` request): `ItemCard` skips `details.ensure` when `run.items_restricted` but still waits for `loaded` (lazy runs, `detail_mode === 'lazy'`). The `run-item-redacted` line (`ItemCard.tsx:182`) is therefore never rendered: `document.querySelectorAll('[data-testid="run-item-redacted"]').length` = 0 at 1440 and 390. The e2e rewrites only the hero banner and never opens an item, so it does not catch it. | treat a restricted row as loaded (or fetch the redacted details) so the card renders its bar and the redacted line; add an e2e that expands an item on a restricted run | `run-item-redacted` count = 1 per open item, height one line (`--font-base`), no spinner |
| F3 | A1-34 | Compare of the restricted run (`/compare?cohortA=…&tab=items`, mem3): 0 occurrences of `Hidden: you don’t have access`, the cards show the private-test-set placeholder (3 hits). Same root cause as F1/F2, no e2e for compare. | as F1, plus an e2e for the compare output card | `Hidden: you don’t have access to this dataset’s items.` visible in each output card |
| F4 | A1-30 | 403 page at 390: alert 244.4 px high, spec 229 (1440 and 1024: 188.98 vs 189, met). The e2e tolerance is 25 px, which hides 15 px. | either amend the spec to 244 or tighten the card at 390 (text wraps to one more line) and set the e2e tolerance to 1 | 229 +- 1 or amended 244 |
| F5 | A1-1 | `View only` on the catalog card measures 75.5 x 20; spec says 91.5 (same size as the page header badge, which measures 91.5). | add the `eye` glyph to the card badge or amend the spec | 91.5 x 20 on the card |
| F6 | A3-27 (and A3-3) | The batch dialog at 390 is 348 px wide (spec 279, which was the gallery frame). A3-3 was amended for the popover but not this. It fits the viewport and is right; the spec number is wrong. | record the amendment in spec-a.md section 11 and assert 348 in the e2e | documented |

Minor drifts, all MEETS (within 5 px, not worth a fix): run banner 57 / 73.8 / 124.2 vs 55.5 / 73.5 / 127.5; dialog 438 x 275.8 vs 440 x 279.7; history row 63 / 114.4 vs 58.8 / 110.2;
batch sentence 36.4 high vs 39; counter 46.2 wide vs 52.8 (digit count); published pane button 164 vs 161.
Amended-by-implementer numbers that I re-measured and confirm: A1-5/6 (373.0 / 476.0), A3-3 (popover 320), A3-17 (menu 170 wide here, implementer said 178), A2-5 (67 / 99 / 225), A2-57, A2-63, A3-60.

## Backend and API (live against my platform, proxy-header users; the pytest files were also run)

| Ids | Measured | Verdict |
|---|---|---|
| A1-37 | viewer GET /access: 200, `candidates: []`, `your_level: view`, `can_manage_access: false`; manager: candidates = members not granted, `your_level: manage` | MEETS |
| A1-39 | creator PUT: 403 `Only project managers and admins can change dataset access`; manager PUT 200 with the GET payload; modify-grant PUT 403 same text | MEETS |
| A1-40 | 422 exact strings for access_mode, level, duplicate (`Duplicate grant for user mem2`), non-member (`User out is not an active member of this project`) | MEETS |
| A1-42, 44 | level none (mem3): 403 `You don't have access to this dataset` on detail, access, versions, version, items, item, runs, lineage, compare, download, neighbors, revisions, facets, item runs, item lineage, batch, alias, PATCH, DELETE, POST versions, disable (20 routes; invalid bodies get FastAPI 422 before the 403, harmless) | MEETS |
| A1-43, 58 | catalog for mem3 omits the restricted dataset; `include_inaccessible=true` lists it; mem2 (view) sees it | MEETS (statement-count test read and passes) |
| A1-46 | view user: batch/PATCH/versions 403 `You can view this dataset but not change it`; modify user: PATCH 200, production alias 403, delete 403 `Only the dataset's creator or a project manager can delete a dataset.` | MEETS |
| A1-47 | default `access_mode` project, creator has `access_level: modify`, no grant row | MEETS |
| A1-49 | outsider (other project): 403 `Access denied`, not the dataset 403 | MEETS |
| A1-50, 57 | run on restricted dataset: mem3 `GET /api/runs/{id}` 200, `items_restricted: true`, `items_restricted_reason: dataset_access`, no input/output text (`SECRETQ0`, `MODELSAID` absent), items/details no content; mem2 and mgr see all | MEETS (but see F1: the placeholder text names the wrong cause) |
| A1-41, 60 | audit rows `dataset.access_changed`: before/after hold user ids and levels only, no emails | MEETS |
| A1-53 | migration 0087 on a scratch SQLite DB: stamp 0086, upgrade, downgrade to 0086, upgrade again, all clean; columns, index `ix_dataset_items_version_disabled`, table `dataset_grants` present; model matches migration; `disabled_by_user_id` has no FK on either side (as spec A2-66 says). A fresh SQLite chain from 0001 fails at an old migration (pre-existing, unrelated). Postgres: `QYM_TEST_POSTGRES_URL` is not set in my shell, so the Postgres cases skipped (1 skipped in test_dataset_items_batch.py); the `#>>` path is untested by me | MEETS (SQLite), Postgres not measured |
| A1-59 | read-token lift read in `_require_dataset_access` / `_get_dataset(read_token=)`: only `need == view`, only `auth_type == api_key`, token must belong to the dataset's project; wired to item list, item get and download only; pytest `test_dataset_read_token_*` read and passes (writes and versions stay 403) | MEETS |
| A2-49..52 | default list active only (29 of 30 after one disable), `state` shape `{"at","by","reason"}`, `?state=disabled|all`, 422 `state must be active, disabled or all`, item GET returns any state, `counts` `{active, disabled, all}` | MEETS |
| A2-54..56 | published 409 `Create a draft to change item state`; unknown item 404 `Dataset item not found`; 501-char reason 422 `Reason must be 500 characters or fewer`; disable 200 `changed true` with actor; repeat 200 `changed false` | MEETS |
| A2-57 | revision `change_type: disabled`, before/after `{item_id, disabled, reason}`, actor present; audit `dataset.item_disabled` / `item_enabled` rows exist | MEETS |
| A2-58 | draft v4 from v3 holds the 2 disabled items; enabling in v4 leaves v3 at 2 | MEETS |
| A2-59 | published item write 409; PATCH body with `disabled:false` ignored (item stays disabled); `items:bulk` upsert keeps the flag, new row active | MEETS |
| A2-60 | v3 (2 disabled) `content_hash` 797f5b79 differs from v2 4155f5ca; hash of v1 = v2 (no disabled) so existing digests are unchanged | MEETS |
| A2-61, 62 | download 29 vs 30 lines with `include_disabled`; default read (the SDK path) returns active only; SDK diff read: `state=active` on both item reads, `tests/sdk/test_native_datasets_sdk.py` 6 passed | MEETS |
| A2-63/64 | compare summary `disabled`/`enabled` integers, `fields: ["state"]` (amended shape); lineage counts "6 disabled" in the UI | MEETS (amended) |
| A3-43..45 | `meta=` repeatable AND, nested dotted path, numbers (`difficulty:2` 10), booleans (15), first-colon split, missing path or path through a scalar: 200 with 0 rows; 422 `meta must look like path:value`, `Metadata path must be dotted keys of at most 3 levels` (4 levels, empty segment, space), `Use at most 5 metadata filters` | MEETS |
| A3-46 | facets paths include every scalar leaf to depth 3 with counts | MEETS |
| A3-47..55 | dry run default true; `matched 5 affected 4` when one already disabled; dry run writes nothing; `expected_affected` mismatch 409 with the exact text and nothing written; apply returns `dry_run: false`; empty filter and state-only 422 `Add a search, label, metadata or item filter before a batch edit`; none match 422 `No items match this filter`; published 409 `Create a draft to edit items` (dry run too); bad action and reason 422 exact | MEETS |
| A3-56, 57, 60, 64 | none user 403, outsider 403 `Access denied`, `missing_item_ids: ["nope"]`, 6 meta keys 422 | MEETS |
| A3-50, 59 | one `dataset.items_batch` audit row per apply; set-based statements read in `api/datasets.py`; I did not time a 5,000-item batch | MEETS (code read), timing not measured |

pytest, one file at a time: `test_dataset_access.py` 29 passed, `test_dataset_item_state.py` 22 passed, `test_dataset_items_batch.py` 23 passed 1 skipped (Postgres). The tests assert the spec strings and numbers (read). Gate re-run: `npm run check` pass (heavy.sh cost 3, log `review-a-check.log`), `pytest tests/platform/test_design_language.py` 1 passed, `npm run build` pass.

## Browser measurements (production build, real identities)

### S1 catalog (`shots/review-catalog-mgr-*.png`, `review-catalog-mem3-*.png`)
| Id | 1440 / 1024 / 390 | Verdict |
|---|---|---|
| A1-1 | Restricted badge 98.7 x 20; Private test set 112.2 x 20 first; View only (mem2, view grant) 75.5 x 20 on the card (spec 91.5, F5) | MEETS WITH FIXES |
| A1-2 | name width 264.3 / 257.5 / 176 (spec frame 254.3 / 257.5 / 155), `text-overflow: clip`, no clipping, no horizontal page scroll | MEETS |
| A1-3 | head 96 with badges, 76 without, at all three widths; cluster width = head width (346.3 / 339.5 / 258); badges under the title at all widths | MEETS |
| A1-4 | mem3 (none) sees only `support-faq`; restricted ones omitted | MEETS |

### S2 Settings (manager `mgr`, `shots/review-settings-*.png`)
| Id | Measured | Verdict |
|---|---|---|
| A1-5 | 760 wide; project mode 373.0 (amended); restricted with three people 590.8 with the add row replaced by the "everyone already has access" line (+28 = 618.8 as spec); empty 520.3; save bar 33; mode group 718 x 115.2; add row 43.4 (empty case) | MEETS |
| A1-6 | 279 wide; 476.0 (amended) / 935.7 (+60 = 995.7 as spec) / 691.3; save bar 56.4; add row 75.4; mode group 237 wide; no horizontal scroll | MEETS |
| A1-21 | empty note 55.5 at 1440, 91.5 at 390 | MEETS |
| A1-22 | read-only (mem2, mem): no buttons/radios/selects in the section (0), `access-summary` 41.6 / 58.4, table read-only, sentence `Only project managers and admins can change who has access.`, "Your access" View / Modify | MEETS |
| A1-7..20, 23, 24 | exercised by the implementer's `access.spec.ts` (all 177 `e2e/datasets` specs pass in my run: 177 passed in 2.2 m); I did not re-measure the 390 card list, the keyboard and the loading/error frames in my own script | MEETS (e2e) |

### S3 viewer and 403 (`shots/review-viewer-*.png`)
| Id | Measured | Verdict |
|---|---|---|
| A1-25 | View only badge 91.5 x 20 at all widths, with the info marker and the exact text | MEETS |
| A1-26/27 | viewer Items tab at 1440, 1024, 390: no Add item, no All matching, 0 checkboxes, no Publish, no Create draft; Metadata and the state control present | MEETS |
| A1-30 | `da-403` text exact; alert 188.98 at 1440 and 1024; **244.4 at 390 (spec 229)** | MEETS WITH FIXES (F4) |
| A1-31 | tab title `Datasets`; item deep link `?item=faq-001` makes exactly one dataset request (the failed GET) | MEETS |

### S4 run pages (`shots/review-run-*.png`, `review-compare-redacted-1440.png`)
| Id | Measured | Verdict |
|---|---|---|
| A1-32 | banner exact text, 57 / 73.8 / 124.2 (spec 55.5 / 73.5 / 127.5); none for mem2 | MEETS |
| A1-33 | table text wrong cause (F1); item card never renders, 0 `run-item-redacted` (F2) | DOES NOT MEET |
| A1-34 | compare shows the private-test-set placeholder, 0 of the new line (F3) | DOES NOT MEET |
| A1-35 | run listed, scores and latencies shown (exact_match 65.0 %, latency columns), dataset name and version visible | MEETS |
| A1-36 | no content leaks (scan of run payload, details, compare for the secret strings: none) | MEETS (text: F1) |

### S6..S10 items, pane, dialog, version header, history, compare (`shots/review-toolbar-*`, `review-items-disabled-1440`, `review-pane-*`, `review-disable-dialog-*`, `review-compare-1440`)
| Id | Measured | Verdict |
|---|---|---|
| A2-1 | state control 202.9 x 24 at all widths, text `Active 124 Disabled 6 All 130` | MEETS |
| A2-3, 6 | counts 124 / 6 / 130; count text `6 items` under Disabled | MEETS |
| A2-4 | `[data-dt-toolbar]` 40 / 65 / 161 | MEETS |
| A2-5 | with three chips 67 / 99 / 225 (amended 390), chip row 26 / 26 / 56, chips 429 wide at 1440 | MEETS |
| A2-7, 8 | disabled rows 52 px apart, ID column with a 70.3 x 20 `Disabled` badge, under Disabled | MEETS |
| A2-13..16 | pane: Disable item… 105 x 24; Enable 64 x 24; banner 55.5; published pane button `Create a draft to disable` 164 x 24 (spec 161); viewer pane (mem2 on a project-mode dataset has modify, so that cell is not a viewer test) | MEETS |
| A2-18..20 | item page: action 121 x 32, Enable 72 x 32, banner 55.5 (1193 / 777 wide) | MEETS |
| A2-23 | after Esc focus returns to the `item-state-action` button | MEETS |
| A2-29..31 | dialog 438 x 275.8 (spec 440 x 279.7), title `Disable item faq-002?`, counter `1 / 500` after one character | MEETS |
| A2-36, 37, 39, 40 | meta line `130 items (6 disabled)` (121.4 x 15), version rows `130 items (6 disabled)` / `130 items`, More menu has both Download entries, publish note `6 items are disabled. Runs on v2 skip them.` 398 x 34 (308 at 390) | MEETS |
| A2-43, 44 | history row `DISABLED #2 Edited By … Reason: duplicate of faq-014`, no revert button, 63 / 114.4 high (spec 58.8 / 110.2) | MEETS |
| A2-45, 46, 48 | compare: Changed 7 (1 content + 6 state), Disabled 6, `compare-state-row` `state ACTIVE DISABLED`, `aria-label="state changed from Active to Disabled"` | MEETS |
| A2-47 | lineage shows `6 disabled` | MEETS |
| A2-9, 10, 11, 12, 14 (dialog flow), 17, 21, 22, 24..28, 32..35, 38, 41, 42 | covered by `item-state-batch.spec.ts` (passes); not re-measured by me | MEETS (e2e) |

### S12..S14 metadata filter, All matching, batch dialog
| Id | Measured | Verdict |
|---|---|---|
| A3-1 | Metadata 98 x 24 for managers and viewers | MEETS |
| A3-2/3 | popover 320 wide at all widths (amended), 280.3 high with the 3-value first key (spec 310.3 was for a 4-value key; data dependent), value list 292 wide | MEETS |
| A3-7/8 | chips `domain: finance` etc., 26 high, 429 wide for three; 56 high at 390 | MEETS |
| A3-15, 16, 20 | All matching 108 x 24 only when a criterion exists (absent in the default view); items `Disable all 10 matching…`, `Enable all 1 matching…`, `Delete all 11 matching…` from the counts; menu 170 wide (amended) | MEETS |
| A3-27, 29, 30 | dialog 598 x 372.8 (spec 600 x 371.1), numbers sentence `10 of 130 items match domain: finance, source.region.code: sa and are active.` 558 x 36.4, ids `faq-001 faq-009 faq-013 faq-017 faq-021 and 5 more`; at 390 the dialog is 348 wide, not 279 (F6) | MEETS WITH FIXES (F6, documentation) |
| A3-9, 10, 11..14, 17..19, 21..26, 28, 31..42 | covered by `item-state-batch.spec.ts` (passes); API behaviours of A3-37 (409 text) and A3-54 confirmed live | MEETS (e2e) |

### Other gates
- Playwright `e2e/datasets` (cost 3): 177 passed. `e2e/run-detail` (cost 3, three run-page components changed): 407 passed, 9 skipped, **2 failed**:
  `redesign3-header.spec.ts:196` (P6-8/9, `Response has been disposed` inside the spec's own `route.fetch().json()`) and `redesign5-bars.spec.ts:286` (R1-3, bar bottoms 2 distinct instead of 1).
  Both reproduce on a single re-run. Neither touches a file this branch changed (RunHero, ItemCard, OutputCard, types are not used by those specs' assertions; BarColumns is untouched), so I judge them pre-existing, but I did not run them on the base commit to prove it. `e2e/compare` was not run.
- `RadioGroup` is exported from `ui/index.ts` and has a gallery Case in `UiGalleryPage.tsx`; I did not open `/__ui` (dev server only) so its look is unmeasured.
- Known pre-existing failure `test_run_page_payloads.py::test_error_labeled_passes_read_the_same_in_full_and_compact_rows` not re-run by me.

## Not measured
Postgres (`QYM_TEST_POSTGRES_URL` unset); 5,000-item batch timing (A3-59); the hover, keyboard and loading/error frames of S2 and S12 (relied on the implementer's passing e2e); `/__ui` gallery visual; `e2e/compare`; the two failing run-detail specs on the base commit.
Ports: 8985 (platform), 8975/5985/9075/9076/9975 (Playwright runs) all released (confirmed by `ss -ltnp`).

## Re-review of the fix pass (feat/dataset-access at 5ba81c05)

Same method: production build (`npm run build` rebuilt), platform on 8985 in proxy_headers mode, identities mem3 (no access), mem2 (view), mgr. Playwright on 8975 (8984 was held again).
Scripts: `measure/review-a-rerun.mts` plus the earlier `review-a-run3.mts`, `review-a-cmp.mts`.

| Fix | Measured | Verdict |
|---|---|---|
| F1 A1-33/A1-36 | items table input cells for mem3 read `Hidden: you don’t have access to this dataset’s items.` for every row; `POST /items/details` returns the same sentence in `input`, `output`, `expected`; "private test set" occurrences on the run page after opening an item: 0 (1440 and 390). The private-test-set text stays the default: `redact_item_content(payload, reason=None)` and `placeholder_for` use the old placeholder unless the reason is `dataset_access`; `test_dataset_access.py` 29 passed (incl. the private-wins and orthogonality cases). I did not render a private-test-set run in the browser | MEETS |
| F2 A1-33 | after expanding #1: `run-item-redacted` count 1 at 1440 and at 390, no "Loading item details…", line height 16.8 (1440) / 33.6 (390, wraps) | MEETS |
| F3 A1-34 | compare (mem3, restricted run vs a readable run): 20 `Hidden: you don’t have access…` lines, 0 private-test-set text, no content leak | MEETS |
| F4 A1-30 | 403 alert 188.98 / 188.98 / 244.42 at 1440 / 1024 / 390; spec amended (section 11), e2e line `near(…, height, 1)` with the 390 value 244.4 | MEETS |
| F5 A1-1 | catalog card `View only` badge (mem2) 91.5 x 20 with 1 svg glyph at 1440, 1024, 390 | MEETS |
| F6 A3-27 | batch dialog 598 x 372.8 at 1440 and 1024, 348 x 426.2 at 390; amendment recorded in the spec | MEETS |
| F7 | `e2e/run-detail/redesign5-bars.spec.ts`: 14 passed (the whole file, R1-3 included; at cost 2 heavy.sh killed the run, at cost 3 it ran clean) | MEETS |

Gates: `access-identities.spec.ts` in header-auth mode (`QYM_E2E_AUTH_MODE=proxy_headers QYM_ADMIN_BOOTSTRAP_TOKEN=e2e-bootstrap`, cost 2): 3 passed. `e2e/datasets` (cost 3, none mode): 178 passed, 3 skipped (the identity spec, which needs header mode). The earlier `redesign3-header.spec.ts:196` failure was not re-run.

### Final verdict: MEETS (190 of 190; DOES NOT MEET 0, MEETS WITH FIXES 0)
Open, unchanged from the first review: Postgres (`QYM_TEST_POSTGRES_URL` unset), 5,000-item timing, `/__ui` gallery look, `e2e/compare`, and `redesign3-header.spec.ts:196` (test-harness `Response has been disposed`, likely pre-existing).
