# WP QA-A: list-valued metadata filter, Settings spacing, Access tab, link cards without hover underline (design specification)

Status: design stage. Branch `feat/qa-datasets` (from `UI-redesign` 379e6d5e). No product component, route or model is changed by this stage.
The code added is the gallery mock `frontend/src/features/dev/QaDatasetsMocks.tsx` (+ `.module.css`, wired into `/__ui#qa-datasets` through
`UiGalleryPage.tsx`), the seed, measurement and screenshot scripts under `measure/`, the screenshots under `shots/` and this document. The mocks are
the visual contract: where this text and a mock disagree, the number in this text wins and the mock is a bug. The CSS in
`QaDatasetsMocks.module.css` is the proposed recipe, ready to move into the real components. Owner decisions D1-D7 (previous round) and E1-E4
(`BRIEF.md`) are final and are not re-opened here.

Measured 2026-10-21 at 1440, 1024 and 390 px on the Vite dev server (5981) over the platform on 8981 (SQLite, `QYM_AUTH_MODE=none`), Playwright
Chromium headless, dark scheme, one browser context per width. Column widths of the real pages: **1193 px at 1440, 777 at 1024, 279 at 390**. The
gallery frame (`.frame`) is drawn at 1163 px at 1440 (the gallery has its own gutters), 777 at 1024 and 279 at 390. Every number that says "frame"
was measured in the gallery, every number that says "page" in the product (`current-*` shots). Fixed widths (popover 320, columns 160 / 180 / 130 /
48, rows 40) are identical in both; a flex column (Person, the form body) is 30 px wider in the page than in the 1440 frame, and the spec states both.

## 0. Reading guide

The owner's feedback points handled here, in the owner's words (`BRIEF.md` section 1):

> 1- the metadata filter doesn't show keys that include a list of items, it should show them and allow the user to filter by them and add
> button for them to allow the user to choose full match or partial.
>
> 5- fix spacing utilization in the dataset settings, and separate the permission into another tab with clearer view.
>
> general UI notes: 1- boxes for project, datasets.. shouldn't show an underline below each text when the user hover above them.

Decisions that bind this work: **E1** (partial = the item's list contains *some* of the chosen values; full match = it contains *all* of them and may hold
more; `tags: ["a","b"]`: choosing `a` matches in both modes, choosing `a` and `c` matches in partial only), **E4** (the permissions move to a new
top-level "Access" tab next to Items / Runs / Lineage / Settings; Settings keeps the rest), **D7** (dotted nested paths up to 3 levels), **D1-D3** of the
previous round for the access model (not changed).

### Composed page mocks (look at these first)

Whole pages as the user sees them: app shell (sidebar 192 px, topbar, page header, the real tab bar), realistic data, default state, drawn at the real size (1440 wide, content column 1193; at 390 a 56 px rail and a 279 px column). Gallery `/__ui#qa-datasets`, first cases of the anchor; the state sheets below them are the appendix for every other state.

| Case id | Surface | Shots | Criteria |
|---|---|---|---|
| `qa-page-access` | dataset page, **Access** tab, restricted with 12 people | `mock-page-access-{1440,390}.png` | QA5-17 to QA5-52 |
| `qa-page-settings` | dataset page, **Settings** tab after the spacing fix | `mock-page-settings-{1440,390}.png` | QA5-1 to QA5-16 |
| `qa-page-filter-popover` | Items tab, Metadata popover open on the list key `tags` with billing and refund chosen | `mock-page-filter-popover-{1440,390}.png` | QA1-1 to QA1-18 |
| `qa-page-filter-chips` | Items tab with a list chip (`tags: billing, refund (any)`) and a scalar chip applied | `mock-page-filter-chips-{1440,390}.png` | QA1-19 to QA1-30 |
| `qa-page-catalog` | datasets catalog, cards are links without a hover underline | `mock-page-catalog-{1440,390}.png` | QG1-1, QG1-2, QG1-11 |

Script: `measure/shots-pages.mts`. In the composed Access page the save bar is drawn at the end of the content (the picture is not a scroller); QA5-44 pins it to the scroll host in the product.

Feature to surface to criteria:

| Feature | Surface | Criteria |
|---|---|---|
| QA1 list-valued keys in the metadata filter | S1 Metadata popover: key list, list value choice, Match control | QA1-1 to QA1-18 |
| QA1 | S2 applied chips, URL, "All matching" | QA1-19 to QA1-30 |
| QA1 | S3 API: facets payload for list paths | QA1-31 to QA1-40 |
| QA1 | S4 API: `meta` and `meta_mode` on list, download, neighbors; `items:batch` filter; SQLite and PostgreSQL | QA1-41 to QA1-62 |
| QA5 spacing and the new tab | S5 Settings tab layout | QA5-1 to QA5-16 |
| QA5 | S6 tab strip: the Access tab | QA5-17 to QA5-23 |
| QA5 | S7 Access tab: layout, manager states (project-wide, restricted: none, one, twelve, unsaved, saving, failed) | QA5-24 to QA5-52 |
| QA5 | S8 Access tab: read only, archived, loading, error, 279 px, leave dialog | QA5-53 to QA5-72 |
| QA5 | S9 API of the Access tab (no new route) | QA5-73 to QA5-78 |
| QG1 link cards without hover underline | S10 the rule and every surface | QG1-1 to QG1-16 |

Count: QA1 62, QA5 78, QG1 16 = **156 numbered criteria**. Section 7 records the decisions I took (with reasons and how to reverse), section 8 the test plan,
section 9 the hand-off, section 10 what could not be measured.

`data-testid` values written in `code` are part of the contract; the mock carries the same ids and the implementer adds them to the real components.

### Screenshots (`docs/internal/feature-rounds/2026-10-qa-feedback/shots/`, dark, each under 300 KB)

| File pattern | What |
|---|---|
| `current-meta-popover-{1440,1024,390}.png`, `current-meta-keys-*`, `current-meta-chips-*` | the Metadata popover (first key `channels`, 2 values), the key list and three chips today |
| `current-settings-*`, `current-access-*` | Settings tab today (project mode; the 12-grant dataset); the page scrolls inside `main`, so these show the first viewport only. Full heights are in the tables |
| `current-hover-{project-card,dataset-card,docs-pager,run-meta-link,inline-link}-1440.png` | each link while hovered, today (underlined) |
| `mock-filter-popover-*`, `mock-filter-chips-*` | S1 and S2 as specified |
| `mock-tabs-*`, `mock-settings-*` | S6 and S5 as specified |
| `mock-access-*`, `mock-access-edit-*`, `mock-access-readonly-*`, `mock-access-states-*`, `mock-leave-dialog-*` | S7 and S8 as specified |
| `mock-link-cards-*`, `mock-hover-{card,pager,meta-link,plain-link}-1440.png` | S10 as specified (hovered) |

### How it was measured (`measure/`)

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd <worktree>; source <main checkout>/.venv/bin/activate
export PYTHONPATH=packages/sdk:packages/platform QYM_PYTHON=<main checkout>/.venv/bin/python QYM_DATABASE_URL=sqlite:///$PWD/.qym-design-a.db
python frontend/scripts/dev_db.py $QYM_DATABASE_URL
QYM_AUTH_MODE=none QYM_ENVIRONMENT=development python -m uvicorn qym_platform.main:app --port 8981 &
(cd frontend && QYM_PLATFORM_PORT=8981 npm run dev -- --port 5981) &
curl -X POST localhost:8981/v1/projects -H 'content-type: application/json' -d '{"name":"Access demo","slug":"access-demo"}'
python  docs/internal/feature-rounds/2026-10-qa-feedback/measure/seed-members.py $QYM_DATABASE_URL    # 15 more members (direct insert: no user API)
node    .../measure/seed-qa-a.mts http://127.0.0.1:8981       # 6 datasets, list metadata, grants (1 restricted with 12, 1 with 1, 1 with 0)
node    .../measure/seed-runs-qa-a.mts                         # 2 runs
node    .../measure/current-filter.mts | current-settings.mts | current-deadspace.mts | hover-inventory.mts [1440 all [runs]] | hover-shots.mts current
node    .../measure/shots-mock.mts | measure-mock.mts | mock-deadspace.mts | hover-shots.mts mock
python3 .../measure/oracle.py                                  # facets and any / all counts computed in Python from the public API
/usr/bin/python3 .../measure/shrink-shots.py                   # quantises a PNG over 290 KB
```

Seed (`seed-qa-a.mts`, public API only; run ids printed by `seed-runs-qa-a.mts` are written into `hover-*.mts`): project `access-demo`, 16 members
(`qa-user-01..15`, one manager, one Arabic name). Datasets: `support-faq` (public; v1 published with 130 items and alias `production`, v2 draft copy),
`legal-clauses` (40 items, **restricted, 12 grants**), `onboarding-checks` (restricted, 1 grant), `refund-cases` (restricted, 0 grants),
`pricing-golden` (private test set, 24 items), `release-notes` (12 items). Metadata of `support-faq` (130 items): `domain` (scalar), `difficulty` (number),
`source.channel`, `source.region.code` (scalars, nested), **`tags`** (list of 1 to 3 of 8 strings), **`source.labels`** (nested list of 1 to 2 of 5),
**`channels`** (a list on 44 items, a string on 86: mixed), **`levels`** (list of numbers), **`attachments`** (list of objects on 33 items, empty list on
the rest), **`flags`** (empty list on every item). Today the facets answer exactly the five scalar keys (`channels` with 2 of its 3 values, `difficulty`,
`domain`, `source.channel`, `source.region.code`): `tags`, `source.labels` and `levels` are missing, which is the owner's report.

## 1. Summary of what changes where

| Surface | Today (measured) | Specified |
|---|---|---|
| Metadata popover | 320 wide; Key select, one-choice value list (74 px for 2 values), footer; 248.3 high for the default key; list keys absent | list and mixed keys appear with `· list` descriptions; values are multi-select with a tick; a **Match** control "Partial / Full match" (125.5 x 24) under the list; heights 519.7 (8 values), 359.7 (3 values), scalar 318.9 |
| Chips | `domain: finance` (136 x 26); one value per path | `tags: billing, refund (all)` (178 x 26); a long chip wraps instead of overflowing |
| URL and API | `meta=path:value`; arrays never match; facets skip arrays | `meta=tags:billing&meta=tags:refund&meta_mode=tags:any`; a scalar path matches equal, a list path matches contains; facets carry `kind` |
| Settings tab | one column 760 px wide (63.7% of 1193), 433 px empty on the right; 84 px of dead space above each card title; descriptions cut with an ellipsis; labels stacked above full-width inputs; 1245.9 px tall in project mode with Access inside | two columns from 900 px (form 819 + side 360 in the page), 15 px to the title, wrapped descriptions, label-left rows; **354.9 px** tall at 1440 (frame) |
| Access | a card at the bottom of Settings (373 to 978.8 px at 1440; 2183.6 px at 390 with 12 people) | a **top-level tab "Access"** between Lineage and Settings: Access mode card, People with access card (add row on top, table with Person / Level / Added by / Added / Remove), sticky save bar |
| Link cards | `a:hover { text-decoration: underline }` underlines every text inside a card link, a boxed link and a multi-text link | the underline is for running text only; block links carry `data-link="block"` and never underline |

---

## 2. QA1: list-valued metadata keys in the filter

### 2.1 S1 The Metadata popover (`detail/MetadataFilter.tsx`)

Current state (`current-meta-popover-*.png`, `measure/out/current-filter.json`): the **Metadata** button is 98 x 24 at all widths. The popover is 320 x 248.3 at
1440, 1024 and 390 (it fits the 390 viewport), padding 14, gap 14; the title `h3` is 292 x 17.5; the Key select lists the paths alphabetically with the first
(`channels`) selected; the value list (`facet-values`) is 292 x 74 for the 2 values of `channels`, options 282 x 32; the footer holds Cancel and Add filter.
A value is a single choice. A key whose value is an array is not in the list.

Specified (`mock-filter-popover-*.png`, case `qa-filter-popover`). All spec numbers below are the popover of the mock; its width is 320 at every viewport.

| Id | Element | Width | Criterion |
|---|---|---|---|
| QA1-1 | `metadata-filter` | all | unchanged: 98 x 24, label **Metadata**, `plus` icon 12, visible to every person who can see items, disabled with the tooltip **You can combine up to 5 metadata filters.** at five filters |
| QA1-2 | Key `Select` | all | lists every path of the facets response, alphabetical, including list and mixed paths. On the seed `support-faq` v1 exactly: `channels`, `difficulty`, `domain`, `levels`, `source.channel`, `source.labels`, `source.region.code`, `tags` (8 keys; `attachments` and `flags` are absent, see QA1-35). Each option has a description: scalar **N values** (as today; 1 value reads **1 value**), list **N values · list**, mixed **N values · list or value** (`·` is U+00B7). Paths are written as stored, never uppercased or cut |
| QA1-3 | Key select | all | 290 x 24 (the popover content width), searchable when more than 8 keys (unchanged); the first path is selected on open; changing the key clears the chosen values and resets the mode to Partial |
| QA1-4 | `meta-popover` | all | 320 px wide at 1440, 1024 and 390, padding 14, gap 14, `--bg-elevated`, 1px `--border-default`, `--shadow-popover`, `--dropdown-radius` (the previous A3-2 / A3-3 geometry); heights: list key with 8 values **519.7**, mixed key with 3 values **359.7**, list key with the truncated line **554.5**, list key with the limit line **539.1**, scalar key with 4 values **318.9** (**amended, see section 11:** `meta-popover` is the bordered Popover surface, 320 x 519.7 with a 318 px inner panel and 290 px of content; the numbers hold when the viewport leaves the room, a phone-high viewport clamps the popover and it scrolls inside) |
| QA1-5 | Value head row | all | one row 20 px high: the label **Value** (`--font-sm`, 650, muted) at the start; for a list or mixed key the count at the end (`--font-sm`, muted): **None selected** or **N selected** (`data-testid="facet-selected-count"`); a scalar key shows no count |
| QA1-6 | `facet-values` (list or mixed key) | all | `role="listbox"` `aria-multiselectable="true"`, 290 px wide, padding 4 and a 1px `--border-subtle` frame on `--bg-surface`, max height `--dropdown-max-height`, scrolls; 8 values = 266 px, 3 values = 106 px; options `role="option"` with `aria-selected`, 280 x 32 (`--dropdown-option-height`) |
| QA1-7 | option row | all | in order: a 14 x 14 tick box (1px `--border-strong`, `--control-radius`, `--bg-surface`; chosen: `--accent-primary` fill with a 12 px `check` glyph), the value (`--font-base`, secondary, wraps with `overflow-wrap: anywhere`, never cut), the count at the end (mono, `--font-sm`, muted). A chosen row uses `--bg-selected` and primary text. The count is the number of items that contain the value (QA1-34) |
| QA1-8 | choosing | all | click or Space toggles one value; Enter on an option toggles it and never submits the popover; any number from 0 to 20; at 20 chosen the unchosen rows are `aria-disabled` and the line `facet-limit` (`--font-sm`, muted) reads **You can choose up to 20 values.** |
| QA1-9 | `meta-match` (list or mixed key only) | all | a 290 x 58.8 block under the list: one row 24 px high with the label **Match** (`--font-sm`, 650, muted) at the start and `SegmentedControl` "Match mode" at the end, options **Partial** and **Full match** (125.5 x 24), default **Partial**; under it the help line `meta-match-help` that **always reserves two lines** (30.8 px) so the popover never changes height (QA1-12) |
| QA1-10 | Match control state | all | disabled (muted, not focusable) while fewer than two values are chosen, enabled from two; with a single value the mode has no meaning and none is stored (QA1-24) |
| QA1-11 | Match help copy (verbatim) | all | fewer than two chosen: **Choose two or more values to pick a match mode.**; Partial: **Items that have at least one of the chosen values.**; Full match: **Items that have every chosen value. An item may have more.** The same copy for list and mixed keys |
| QA1-12 | geometry | all | the popover is the same height with nothing chosen, two chosen in Partial and two chosen in Full match (519.7 each, difference 0 px); the help copy for Full match wraps to two lines inside the reserved slot |
| QA1-13 | scalar key | all | no `meta-match`, single choice with one highlighted row, exactly as A3-5 (`facet-values` is not `aria-multiselectable`); only the Value head gets the 20 px row |
| QA1-14 | mixed key | all | the Match slot is present and behaves as for a list key; the value list is the union of the single values and the list elements (`channels`: chat 87, email 87, phone 22). Copy is the same as QA1-11 |
| QA1-15 | truncated list key | all | more than 200 distinct elements: the 200 most common are listed, `facet-truncated` reads **Showing the 200 most common values of 340. Type to search.** and a search field filters the list (A3-14); typing an exact value that is not listed and pressing Enter **adds it to the chosen set** (it does not apply the filter by itself for a list key; for a scalar key A3-14 stays) |
| QA1-16 | footer | all | **Cancel** (ghost, sm) and **Add filter** (primary, sm), 24 px high, `Add filter` disabled until one value is chosen; adding closes the popover, writes the URL (QA1-22) and moves focus to the new chip |
| QA1-17 | keyboard | all | Tab order: Key, the value list (roving focus, Up/Down, Space toggles), the Match control (Left/Right selects), Cancel, Add filter; Escape closes and returns focus to the Metadata button; the popover keeps the Popover primitive's focus trap |
| QA1-18 | states | all | loading, empty and error are unchanged from A3-11, A3-12, A3-13 (skeleton 4 rows, **No metadata keys**, **Couldn’t load metadata keys** with Retry). A version whose only list-valued metadata is lists of objects or empty lists is the empty state |

### 2.2 S2 Applied chips, URL and "All matching" (`detail/ItemsTab.tsx`, `lib/metaFilter.ts`)

Current state (`current-meta-chips-*.png`): three chips (`domain: finance` 136 x 26 including its remove button, `source.channel: chat` 162, `source.region.code: sa`
173) in `filter-chips`: 479 x 26 at 1440 and 1024, 261 x 86 (three rows) at the 279 column of 390. A chip is a pill that does not grow past its row.

| Id | Element | Width | Criterion |
|---|---|---|---|
| QA1-19 | chip text | all | one chip per path. Scalar or a single value: **{path}: {value}** (unchanged). Two or more values: **{path}: {v1}, {v2}, … ({mode})** with `(any)` for Partial and `(all)` for Full match; the values are in the order of the facet list (count descending, then value), separated by comma and space. Examples with their measured size: `tags: billing, refund (all)` 178 x 26, `channels: chat, phone (any)` 198 x 26, `domain: finance` 136 x 26 (all at 1440, 1024 and 390) |
| QA1-20 | chip wrapping | all | a chip is never wider than its row and its text is never cut: the Chip button takes `min-inline-size: 0`, `padding-block: --space-xs`, `line-height: 1.3`, `overflow-wrap: anywhere`, `text-align: start` and the wrap `max-inline-size: 100%`. `source.labels: gold, silver, reviewed, needs-review, synthetic (all)` is 403 x 26 at 1440 and 1024 (one line, row 56 px with the other four chips at 1024) and **261 x 38.6** at 390 (two lines; **amended:** the chip row is 261 px wide in the page, not the 279 px column); `scrollWidth <= clientWidth`, computed `text-overflow` is not `ellipsis` |
| QA1-21 | `filter-chips` rows | all | three chips: 26 px (1440 and 1024), 86 px at 279; five chips: 26 px at 1440, 56 px at 1024, 158.6 px at 279 (the long chip counts two lines); chips wrap in a row with `--space-xs` gaps; no horizontal overflow |
| QA1-22 | URL | all | a filter is the repeatable `meta=path:value` per value plus, for a path with two or more values, one `meta_mode=path:any` or `meta_mode=path:all`; e.g. `?tab=items&v=v1&meta=tags:billing&meta=tags:refund&meta_mode=tags:any`. A single value writes no `meta_mode`. Values are written in the facet order (QA1-19) so one filter has one URL. Reloading the URL restores the same chips; a `meta_mode` without a matching `meta`, a mode other than `any` and `all`, a duplicate and more than 20 values of a path are dropped by the page (a bad mode means `all`, the API default) |
| QA1-23 | remove | all | the chip's remove button has the label **Remove filter {chip text}** (e.g. **Remove filter tags: billing, refund (all)**); removing deletes every `meta` and the `meta_mode` of that path from the URL, resets `page` and the row selection and calls `onFilterChange` |
| QA1-24 | replace and limit | all | two filters on the same path replace each other (one chip per path, as A3-10); the limit is **5 paths** (the A3-10 text and tooltip are unchanged), not 5 URL parameters; up to 20 values per path |
| QA1-25 | "All matching" | all | the bulk menu, its counts and the confirm dialog use the same criteria: the dialog sentence names the filter with the chip text (`batchCopy.ts` already uses `metaChipLabel`), e.g. **Disable 26 items matching tags: billing (all)?** is not produced (one value has no suffix); two values read **tags: billing, refund (any)**. The request carries the batch `filter.meta` shape of QA1-55 |
| QA1-26 | toolbar and counts | all | the item count line, the state control, the sort and the export read the same `meta` / `meta_mode` parameters: `GET …/items`, `counts`, `total` and `:download` agree for one filter (QA1-43) |
| QA1-27 | page reset | all | adding or removing a chip sets `page` to 1; the selection is cleared |
| QA1-28 | 279 px | 390 | the popover is 320 px wide and fits the 390 viewport; the chips wrap (QA1-21); the Metadata button keeps 98 x 24 |
| QA1-29 | focus | all | after Add filter focus is on the new chip's text button; after removal focus moves to the Metadata button |
| QA1-30 | readers | all | a person who can only view the dataset sees and uses the same filter (it reads items); a published version is filtered exactly the same |

### 2.3 S3 Facets for list paths (`services/dataset_meta.py`, `items:metadata-facets`)

| Id | Request | Criterion |
|---|---|---|
| QA1-31 | `GET …/versions/{v}/items:metadata-facets` payload | `{"paths": [{"path": "tags", "kind": "list", "values": [{"value": "billing", "count": 26}], "truncated": false, "value_count": 8}], "truncated": false}`. Every path entry has `kind`: **`"scalar"`** (the path holds a scalar on every item that has it), **`"list"`** (a non-empty list of scalars on every item that has a value) or **`"mixed"`** (a scalar on some items and a non-empty list on others). Existing fields keep their meaning; clients that ignore `kind` still get a valid scalar-style facet |
| QA1-32 | values of a list path | the distinct scalar elements over all items (strings, numbers and booleans as JSON text: `"1"`, `"true"`, as today); `count` = the number of **items** that contain the value, counted once per item even when the list repeats it; for a `mixed` path the values of the scalar items and the elements of the list items are one pool. Ordered by count descending, then value; at most 200 values per path (`truncated: true` and `value_count` = the true number beyond 200) |
| QA1-33 | seed numbers (the oracle) | on `support-faq` v1: `tags` kind `list`, 8 values, billing 26, refund 26, account 25, arabic 25, shipping 25, vip 25, fraud 24, urgent 24; `source.labels` kind `list`, 5 values, 39 each; `levels` kind `list`, 4 values ("1" 87, "2" 86, "0" 44, "3" 43); `channels` kind **`mixed`**, 3 values (chat 87, email 87, phone 22); `domain`, `difficulty`, `source.channel`, `source.region.code` kind `scalar` with today's values and counts. `measure/oracle.py` prints these from the public API |
| QA1-34 | not reported | an empty list contributes nothing; a path whose only content is empty lists (`flags`) is **omitted**; lists whose elements are objects, lists or null (`attachments`) contribute no value (their scalar elements, if any, still count); elements longer than 500 characters are skipped (as scalars today); a list is not traversed (no path like `attachments.kind`); a list longer than 200 elements contributes its first 200 to the facets (all of them still match in a filter, QA1-45) |
| QA1-35 | depth and limits | a list may sit at any path of 3 levels or fewer (`source.labels`, `a.b.c`); at most 100 paths (`truncated: true` above), lists and scalars share the budget; paths are listed alphabetically |
| QA1-36 | scan | still one pass over the `metadata` column per version (`yield_per(1000)`); 130 items: under 100 ms; 5,000 items: under 1 s on SQLite |
| QA1-37 | cache | cached 60 s per version; the cache key is `(FACET_SCHEMA = 2, item count, newest item write)`, so a process that still holds a schema-1 entry never serves a payload without `kind`, and any item write makes the next call recompute |
| QA1-38 | permissions | unchanged: needs `view` and item visibility; a private test set a caller cannot read answers the private-test-set 403; a level `none` dataset answers the dataset 403 |
| QA1-39 | disabled items | facets ignore `state` (they describe the version's metadata, as today) |
| QA1-40 | old clients | the payload only adds `kind` and the list paths; the SDK and CLI do not read this route |

### 2.4 S4 Filtering by list paths (`GET …/items`, `:download`, neighbors, `items:batch`)

Grammar, in one place:

```
meta       = path ":" value          repeatable; split on the FIRST colon (the value may hold colons)
meta_mode  = path ":" ("any"|"all")  repeatable; at most one per path; default all
```

| Id | Request | Criterion |
|---|---|---|
| QA1-41 | one value on a path | `meta=path:value` matches an item when the path holds a scalar **equal** to the value (JSON text, as today) **or** a list that **contains** the value. So `meta=tags:billing` returns the 26 items whose `tags` list holds `billing`, `meta=channels:chat` returns the 87 items (the 43 whose list holds `chat` and the 44 whose value is `chat`; both kinds count), `meta=levels:1` returns 87 (numbers match their JSON text) |
| QA1-42 | several values on one path | repeated `meta` values of the **same path** are combined by `meta_mode`: **`all`** (default) = the item holds every value, **`any`** = it holds at least one. Different paths always AND. On the seed: `tags` billing+refund **any 46, all 6**; `tags` billing+fraud any 49, all 1; `channels` chat+phone any 87, all 22; `source.labels` gold+reviewed any 65, all 13; `levels` 0+2 any 130, all 0 |
| QA1-43 | endpoints | the same parameters apply to `GET …/items` (including `counts`, `total` and `next_offset`), `GET …/items:download` (`meta` is repeatable there too), the neighbors route behind the item pager and `POST …/items:batch`; `items:metadata-facets` takes none |
| QA1-44 | scalars are not changed | `meta=domain:finance` is as before (42); `meta=domain:finance&meta=domain:health` is **all** by default: 0 rows, no error; with `meta_mode=domain:any` it is the 72 items of either (a mode on a scalar path is accepted: any = IN, all = AND, so a client needs no knowledge of the kind) |
| QA1-45 | list rules | an empty list matches no value; a list of objects matches no value (`meta=attachments:pdf` returns 0); a list longer than 200 elements matches on every element; an element matches by JSON text with the same typing rules as scalars (a string `"1"` and a number `1` both match `levels:1`; booleans match `true` / `false`); nested lists inside a list are ignored; a path through an array (`attachments.kind`) is not a valid path and matches nothing |
| QA1-46 | `meta_mode` grammar | `meta_mode=tags:any`; the path part is validated like a `meta` path; a value other than `any` or `all`: **422** `meta_mode must look like path:any or path:all`; no colon: the same 422; two modes for one path: **422** `Use one meta_mode per metadata key`; a `meta_mode` whose path has no `meta`: **422** `meta_mode needs a meta filter for {path}` |
| QA1-47 | limits | more than 5 distinct paths over `meta` and `meta_mode`: **422** `Use at most 5 metadata filters` (the count moved from parameters to paths; the text is unchanged); more than 20 values for one path: **422** `Use at most 20 values for one metadata key`; a bad path or a missing colon keep **422** `Metadata path must be dotted keys of at most 3 levels` and `meta must look like path:value` |
| QA1-48 | a single value with a mode | accepted and ignored in effect (`meta=tags:billing&meta_mode=tags:any` = `meta=tags:billing`) |
| QA1-49 | duplicates | the same `path:value` twice counts once |
| QA1-50 | SQLite | a value matches with `json_type(col, '$."a"."b"')` for the scalar test and, for a list, `json_type(...) = 'array' AND EXISTS (SELECT 1 FROM json_each(col, '$."a"."b"') AS je WHERE je.type IN ('text','integer','real','true','false') AND <text of je> = :value)` where `<text of je>` is `'true'` / `'false'` for those types and `CAST(je.value AS TEXT)` otherwise; the `json_type(...) = 'array'` guard is required (`json_each` of a scalar or an object yields rows). Validated on SQLite 3.46 against the Python oracle: billing 33 / refund 32 / any 65 / all 0 on the first seed and the numbers of QA1-42 on the final one |
| QA1-51 | PostgreSQL | `jsonb_typeof(doc #> keys) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(doc #> keys) = 'array' THEN doc #> keys ELSE '[]'::jsonb END) AS e(value) WHERE jsonb_typeof(e.value) IN ('string','number','boolean') AND e.value #>> '{}' = :value)`; the `CASE` keeps the planner from calling `jsonb_array_elements` on a scalar (PostgreSQL does not order `AND` operands). `doc #> keys @> to_jsonb(:value)` is an acceptable index-friendly alternative for string values. The reviewer tests SQLite; PostgreSQL runs when `QYM_TEST_POSTGRES_URL` is set |
| QA1-52 | statements | one SQL statement per request regardless of the number of values (an `OR` or `AND` of `EXISTS` clauses); statement count equal for 1 and 20 values |
| QA1-53 | performance | `GET …/items?meta=tags:billing&meta=tags:refund&meta_mode=tags:any` on 5,000 items: under 1 s on SQLite; the dry run of a batch on the same filter: under 1 s |
| QA1-54 | `items:batch` body | `{"filter": {"search": …, "label": …, "meta": {"tags": {"values": ["billing","refund"], "mode": "any"}, "domain": "finance"}, "item_ids": …, "state": …}, "action": …, "dry_run": …}`: a `meta` value is either a scalar (string, number, boolean: one value) or an object `{"values": [string…], "mode": "any"\|"all"}`; `mode` defaults to `all`; at most 5 keys and 20 values per key |
| QA1-55 | batch errors | a bare list as a meta value: **422** `meta value must be a string, number, boolean or {values, mode}`; `mode` outside any / all: **422** `mode must be any or all`; `values` empty or missing: **422** `values must not be empty`; more than 5 keys: **422** `Use at most 5 metadata filters`; more than 20 values: **422** `Use at most 20 values for one metadata key`; a null or object that is not `{values, mode}`: the first text above |
| QA1-56 | batch semantics | `matched`, `affected`, `sample_item_ids`, the empty-criteria 422 (`Add a search, label, metadata or item filter before a batch edit`), the 409 on a published version, the 422 `No items match this filter`, `expected_affected` and the audit entry are exactly A3-47 to A3-64; the audit entry stores `filter.meta` as sent |
| QA1-57 | batch dry run | `dry_run` default true; for `tags` billing+refund `any` on a draft copy: `matched` 46, `affected` 46 for `delete`, the disabled ones ignored for `disable` |
| QA1-58 | no migration | no column, table or index is added; `dataset_items.metadata` is read as JSON on both dialects |
| QA1-59 | `include_context` and other list parameters | unchanged |
| QA1-60 | OpenAPI | the routes list `meta_mode` as a repeatable query parameter with the grammar above in its description |
| QA1-61 | unknown parameter | any other `meta_*` parameter is ignored (no 422), as every unknown query parameter |
| QA1-62 | SDK and CLI | `qym` reads no `meta` parameter today; nothing changes there |

---

## 3. QA5: Settings spacing and the Access tab

### 3.1 S5 Settings tab layout (`detail/SettingsTab.tsx`, `SettingsTab.module.css`)

Current state (`current-settings-*.png`, `measure/out/current-settings.json`, `current-deadspace.json`): `.wrap` is one column capped at 760 px
(`max-width: 760px`): 63.7% of the 1193 px page column at 1440, so **433 px (36.3%) stay empty on the right**; at 1024 it fills 760 of 777 and at 390 the full 279.
Each card starts with `SectionHeader level="xl"`, whose section recipe adds a 48 px top margin, a hairline and 20 px of padding: the **title text starts 84 px
below the card's top edge** (22.5 px high), and the description of Visibility and Danger zone is cut with an ellipsis on one line (**truncated at 1440 and
1024**, 90 px high and wrapped at 279). Labels sit above full-width inputs: Name, Description and Tags are all 718 px wide at 1440 and 1024 (237 at 390). Heights at
1440 in project mode: General 447.1, Visibility 188.3, Access 373.0, Danger zone 195.5, gaps 14, total **1245.9 px** (Settings without Access: 858.9);
at 1024 the same; at 390: 447.1, 260.3, 476.0, 267.5, total 1492.9. With 12 grants the Access card alone is 978.8 px (1440) and 2183.6 px (390).

Specified (`mock-settings-*.png`, case `qa-settings`). The cards are `Card as="section"` with a `header` slot instead of `SectionHeader level="xl"`.

| Id | Element | Width | Criterion |
|---|---|---|---|
| QA5-1 | `settings-layout` | 1440 | a two-column grid from a **container** width of 900 px (`container-type: inline-size` on the tab panel wrapper, `@container (min-width: 900px)`): the form column takes the rest, the side column is **360 px**, gap `--space-md` (14 px). In the frame (1163): General 789 + 14 + 360; in the page (1193) General 819. The 760 px cap is removed: the grid fills the column, **0 px of empty space on the right** (was 433) |
| QA5-2 | `settings-layout` | 1024, 390 | below 900 px of container width the grid is one column, full column width (777 at 1024, 279 at 390), cards in the order General, Visibility, Danger zone, gap 14 |
| QA5-3 | card header | all | `header` slot: `h2` at `--font-lg` (15 px) 600 primary, a muted `--font-sm` description under it when there is one; the title text starts **15 px** below the card's top edge (was 84); the header is 48.5 px high for General and has the slot's hairline under it. No `SectionHeader` and no 48 px margin inside a card |
| QA5-4 | descriptions | all | never cut: Visibility's description is 61.6 px (4 lines at 360 px), 30.8 px at 777, 77 px at 279; Danger zone's 46.2, 30.8 and 61.6 px; `scrollWidth <= clientWidth`, computed `text-overflow` is not `ellipsis` |
| QA5-5 | `settings-general` | 1440 | 789 x 354.9 in the frame (819 in the page): header 48.5, three `FieldRow` rows (`measure="full"`, `labelCase="sentence"`, `labelAnchor="start"`): label column 120 px (`--field-label-width`) at the start, gap 14, body 599 px (629 in the page); rows 41 (Name), 89 (Description), 93.4 (Tags with its help line and chips); footer 53 px with the hairline |
| QA5-6 | inputs | 1440 | Name 599 x 24, Description 599 x 72 (3 rows), Tags 599 x 24 with the help line **Press Enter to add a tag.** and the tag chips under it; all use the primitives (`TextField hideLabel`, `Textarea hideLabel`) with the visible label in the `FieldRow` and `aria-label` equal to it |
| QA5-7 | rows | 1024 | General is 777 x 354.9: the same rows, body 587 px; Visibility 777 x 134.5, Danger zone 777 x 137.3; the whole tab is **654.6 px** (was 858.9 without Access) |
| QA5-8 | rows | 390 | at 279 the `FieldRow` stacks the label above the body (container under 640): inputs 223 px wide, General 279 x 428.4, Visibility 279 x 180.6, Danger zone 279 x 168.1, the whole tab **805.1 px** (was 1002.9 without Access); no horizontal overflow |
| QA5-9 | total height | 1440 | **354.9 px** (the form column is the tallest; the side column is 165.3 + 14 + 152.7 = 332), from 858.9 without Access and 1245.9 with it: 59% and 71% less |
| QA5-10 | footer | all | **Save changes** (primary, 24 px high, `isDisabled` until the form is dirty and the name is not empty, `loading` while saving) and the status text (`--font-sm`, muted, `aria-live="polite"`) **No changes** / **Unsaved changes**, 53 px footer; a reader (no modify level) has no footer and read-only fields |
| QA5-11 | Visibility card | all | present only when `dataset.can_set_private_test_set`; contents unchanged: title **Visibility**, the description of today (verbatim), the checkbox **Private test set (admins only)** (`private-toggle`) and both confirm dialogs; disabled for a reader; 360 x 165.3 in the frame |
| QA5-12 | Danger zone | all | `Card tone="danger"` (3px `--error` rail), title **Danger zone**, today's description, the **Delete dataset** danger button (`delete-dataset`) with today's confirm dialog; for someone who cannot delete the sentence **Only the dataset creator or a project manager can delete a dataset.**; in an archived project **This project is archived.**; 360 x 152.7 |
| QA5-13 | no Visibility card | 1440 | the side column holds the Danger zone alone (360 x 152.7); General stays 789 wide; no empty card, no placeholder |
| QA5-14 | Access is gone | all | `access-section` is not rendered in Settings and the tab makes **no request to `…/access`** (0 requests on `?tab=settings`) |
| QA5-15 | behaviour | all | the save, rename (slug change navigates to `?tab=settings`), private-test-set and delete behaviours, toasts (**Settings saved**, **Items are now hidden from non-admins**, **Items are visible to the whole project**, **“{name}” moved to Deleted datasets**) and errors are unchanged |
| QA5-16 | spacing scale | all | only tokens: gaps `--space-md` between cards and columns, `--space-sm` inside rows, no pixel margins; the tab never scrolls horizontally |

### 3.2 S6 The Access tab in the strip (`detail/DatasetDetailPage.tsx`, `lib/route.ts`)

Current state: tabs Items / Runs / Lineage / Settings (`tabItems`), `DetailTab = 'items' | 'runs' | 'lineage' | 'settings'`, 34 px high.

Specified (`mock-tabs-*.png`, case `qa-tabs`).

| Id | Element | Width | Criterion |
|---|---|---|---|
| QA5-17 | tab strip | all | order **Items, Runs, Lineage, Access, Settings**; the new tab has `id="access"` and the visible name **Access**; 34 px high (unchanged) |
| QA5-18 | count | all | when the dataset is restricted the tab shows its grant count from `dataset.grant_count` (no extra request): `Access 12` is 92 x 34, without a count `Access` is 66.8 x 34; project-wide datasets show no count; a restricted dataset with no grant shows `0` |
| QA5-19 | URL | all | `?tab=access` (with `v=` kept like the other tabs); `DETAIL_TABS` gains `'access'`; an unknown tab still falls back to `items`; `?tab=settings` keeps working and no longer contains the access controls (no redirect is needed) |
| QA5-20 | who sees it | all | everyone who can open the dataset sees the tab (managers, admins, the creator, members with modify or view); it is never hidden for a reader and stays visible in an archived project; a person with level `none` gets the dataset 403 page as before |
| QA5-21 | selected state | all | the underline tab recipe (`aria-selected`, roving focus, Left / Right / Home / End) with no new motion |
| QA5-22 | header badges | all | the **Restricted** badge in the page header stays as it is (not a link) |
| QA5-23 | prefetch | all | load by default: after the items tab has painted, the page requests `GET …/access` once from an idle callback (bounded: one request, off under `saveData`) so the tab opens without a skeleton; a click on the tab while that request is in flight joins it (0 extra requests) |

### 3.3 S7 The Access tab (`detail/AccessTab.tsx` replaces `AccessSection.tsx`)

Current state (`current-access-*.png`, `current-settings.json`): a `Card` inside Settings with `SectionHeader level="xl"` (84 px to the title), 718 px wide content in a 760 px
card: the mode radios stacked (115.2 px), `access-people` 591.8 px with 12 grants (table 514, add row 43.4, 33 px save bar at the end of the card). Grants table columns Person 360 flex,
Level 160, Added by 150, Remove 48; **the grant date is in the payload (`created_at`) and not shown**. At 279 each grant is a card of 132 px (table 1583.8 for 12). Card heights at 1440: project 373.0,
restricted with none 520.3, with one person 538.8, with twelve 978.8; at 390: 476.0, 691.3, 731.8, 2183.6.

Specified (`mock-access-*.png`, `mock-access-edit-*.png`, cases `qa-access`, `qa-access-edit`). The tab (`access-tab`) is a column of cards with `--space-md` (14 px) gaps, the full width of the
page column (1193 at 1440, 777 at 1024, 279 at 390; 1163 / 777 / 279 in the frame); there is no 760 px cap. Order: **Access mode** card, **People with access** card (restricted only), the **save bar**.

| Id | Element | Width | Criterion |
|---|---|---|---|
| QA5-24 | `access-mode-card` | all | `Card as="section"` with the header slot: `h2` **Access mode** (`--font-lg`, 600) and the sentence (`--font-sm`, muted): manager **Choose who in this project can open and change this dataset.**; the title starts 15 px below the card top |
| QA5-25 | card heights (frame) | 1440 | manager, project-wide **196.3** with the "N saved grants are kept…" help (180.9 without it); restricted **180.9**; the header is 38.9 px |
| QA5-26 | card heights (frame) | 1024 | project-wide **211.6** (196.3 without the saved note) and restricted 196.3 |
| QA5-27 | card heights (frame) | 390 | project-wide **350.2** (319.4 without the saved note), restricted 319.4; the header is 54.3 px (the sentence wraps to two lines) |
| QA5-28 | `access-mode` | 1440, 1024 | `role="radiogroup"` `aria-label="Who can access this dataset"` as two options **side by side** in equal columns from a tab container width of 700 px (`@container (min-width: 700px)`), gap `--space-sm` (8): the `RadioGroup` primitive with a grid class; each option keeps the primitive's look (`min-height: --row-comfortable` 52, padding 8 / 14, 1px `--border-subtle`, `--control-radius`, `--bg-elevated`; selected: 1px `--accent-primary` and the 12% tint; 14 px radio dot). Group height 53.6 (both helps on one line), **69** when the project-wide help carries the saved-grants sentence; at 777 px 69 and 84.4 |
| QA5-29 | `access-mode` | 390 | stacked (container under 700): group 161.3 px high (192.1 with the saved-grants sentence), 237 px wide; no horizontal overflow |
| QA5-30 | option copy (verbatim) | all | **Everyone in the project** / **Every member can view and modify this dataset. This is the default.**; **Only people listed below** / **Everyone else in the project cannot open this dataset. Its runs stay listed with item contents hidden.**; with saved grants and project-wide selected the second help appends **12 saved grants are kept and apply again if you switch back.** (singular **1 saved grant is kept and applies again if you switch back.**); keyboard and ARIA exactly as A1-9 (one Tab stop, arrows move and select, `role="radio"`, `aria-checked`) |
| QA5-31 | `access-always` | all | under the options, one line with a 12 px `lock` glyph and **Project managers, admins and the creator always have full access.** (`--font-sm`, muted): 15.4 px high at 1440 and 1024, 30.8 px at 279 (it wraps, never cut); present in every state with the mode card (also read only) |
| QA5-32 | `access-people` | all | rendered when the selected mode is restricted (also while unsaved); `Card as="section"` with the header slot: `h2` **People with access** and, at the end, `access-count` (`--font-sm`, muted): **{n} people**, **1 person**, **0 people** (the live count including unsaved rows); not rendered in project-wide mode |
| QA5-33 | card heights | 1440, 1024 | people card: none listed **191.4**, one person **209.9**, twelve **649.9** (= header 48.5 + body padding + add row 43.4 + table 514 + gaps); whole tab: project-wide 266.3, none 456.3, one 474.8, twelve **914.8** (at 1024: 281.6, 471.6, 490.1, 930.1) |
| QA5-34 | `access-add` | 1440, 1024 | the add row sits **above** the table (a 12-row list must not bury it): one row 43.4 px high: `Select` "Add person" (**320 px**, 24 high, its label above, placeholder **Choose a project member**, items = `candidates` with the email as description, searchable above 8 candidates), `SegmentedControl` "Level for the new person" (View default), `Button` **Add person** (neutral, disabled until a person is chosen); adding appends the row at the end of the table as unsaved and clears the select |
| QA5-35 | `access-add` | 390 | the controls wrap: 75.4 px high, the select 237 px wide (the column), no overflow; when there are no candidates the select is replaced by **Everyone in the project already has access.** (`--font-sm`, muted) |
| QA5-36 | `access-grants-table` | 1440 | `DataTable variant="embedded"` (`densityLocked`, `zebra={false}`, no toolbar): header 34 px (`--table-header-height`); rows 40 px (`--row-regular`); columns **Person** flex (603 in the frame, **633** in the page), **Level** 160, **Added by** 180, **Added** 130, **Remove** 48 (header text visually hidden, `aria-label` "Remove"); 12 rows = 514 px, 3 rows 154, 1 row 74; no horizontal scroll |
| QA5-37 | `access-grants-table` | 1024 | the same columns; Person is 217 px (names wrap, never cut); 12 rows 514 px |
| QA5-38 | Person cell | all | two lines: display name (`--font-base`, primary, `dir="auto"`, wraps) over the email (`--font-sm`, muted, wraps); the Arabic name **نورة العتيبي** renders right-aligned in its cell without moving the other columns |
| QA5-39 | Level cell | 1440, 1024 | a `SegmentedControl` named `Level for {name}` with **View** and **Modify**, 24 px high; a change marks the tab dirty; read only: a `Tag` (**Modify** accent, **View** neutral) |
| QA5-40 | Added by | 1440, 1024 | `UserPill` (avatar + name) of `granted_by`; a **saved** grant whose granter no longer exists (`granted_by: null`) shows **Unknown user** (muted); an **unsaved** row shows **You** (muted) |
| QA5-41 | Added | 1440, 1024 | the date of `created_at`, `Oct 14, 2026` format, mono `--font-sm` muted (`data-testid="grant-added-at"`); an unsaved row shows the `Tag` **Not saved** (warning). A level change does not change the date (it is the date the person was added) |
| QA5-42 | Remove | 1440, 1024 | `IconButton label="Remove {name}"` icon `close`; removing marks the tab dirty; focus moves to the next row's Remove, or to the Add person select when none remains (A1-14) |
| QA5-43 | empty list | all | restricted and no one listed: the table is replaced by the note `access-empty-note` (warning rail): **No one is listed** / **Only project managers, admins and the creator can open this dataset.** 55.5 px high at 1440 and 1024, 91.5 at 279; saving is allowed; the add row stays above it |
| QA5-44 | `access-save-bar` | 1440, 1024 | `position: sticky; inset-block-end: 0` in the page's scroll host (compositor positioned, DESIGN_LANGUAGE section 7), `min-height: --bar-action-h` (**56 px**), full tab width, 1px `--border-subtle`, `--radius-md`, `--bg-elevated`; the status text at the start (`--font-sm`, `aria-live="polite"`), **Discard** (neutral) and **Save access** (primary) at the end; always rendered for managers so the geometry never changes; with 12 people the bar stays on screen while the table scrolls (its bottom edge equals the host's bottom edge, 0 px; **amended:** 0 px for every scroll position until the content ends, at the very end the bar rests on the content, 31.9 px above the host's bottom padding) |
| QA5-45 | save bar states | all | **No changes** (both buttons disabled), **Unsaved changes** (primary text colour, buttons enabled), **Saving** (Save shows the spinner, Discard disabled), **Couldn’t save access** (error text colour, `--error-text`, buttons enabled, edits kept). Height 56 px in every state; at 279 it is 56 clean and **65.4** when the status wraps above the buttons |
| QA5-46 | save | all | one `PUT /v1/datasets/{ref}/access` with the full state; success toast (tone success) **Access saved**; failure toast (tone error) with the server detail or **Couldn’t save access**; after success the tab is clean (the body remounts from the response); a failed save keeps the edits (A1-20) |
| QA5-47 | dirty definition | all | the signature of mode and `{user_id: level}` differs from the server's: adding and removing the same person is clean again; switching the mode back to the saved one with unchanged people is clean |
| QA5-48 | focus order | all | Access mode radios, Add person select, Level control, Add person button, the table (row by row: Level control, Remove), Discard, Save access |
| QA5-49 | headings | all | each card's title is an `h2`; the tab has no `h1` of its own (the page title is the dataset name); `aria-labelledby` points at the card title |
| QA5-50 | mode switch | all | switching to **Only people listed below** reveals the People card at once (unsaved); switching to **Everyone in the project** hides it and keeps the rows in state, so switching back restores them (A1-10 wording explains it) |
| QA5-51 | candidates | all | managers and admins are never candidates; a person already in the table is not offered; the pool also contains saved grantees removed in this session (removing and re-adding works) |
| QA5-52 | no nested card | all | the table and the add row sit inside the People card with no inner border box; the mode options are the only filled layer inside the Access mode card (calm-surface rule) |

### 3.4 S8 Access tab for everyone else, and its states

| Id | Element | Width | Criterion |
|---|---|---|---|
| QA5-53 | read only: who | all | a person who cannot manage access (`permissions.can_manage_access` false) or an archived project: the Access mode card shows no radios; the sentence is **Only project managers and admins can change who has access.** (archived: **This project is archived.**) and the `dl` `access-summary`: **Who has access** = "Everyone in the project" or "Only people listed below", **Your access** = "Modify" or "View"; 41.6 px high at 1440 and 1024, 58.4 at 279; the head carries a badge at the end: **Restricted** (neutral, `lock` glyph) or **Project-wide** (success) |
| QA5-54 | read only: heights | all | the mode card 168.9 px at 1440 and 1024 (201.1 archived at 279, 231.8 at 279 with the two-line sentence); a restricted dataset adds the People card: 3 people 232.5 (table 154) at 1440 and 1024, 438.5 (table 360) at 279; the whole tab 168.9 (project-wide), 415.4 (restricted) |
| QA5-55 | read only: table | all | Person, Level (Tag), Added by, Added; **no** Remove column, **no** add row, **no** save bar; the Added column is shown (600 px of the table is the Person column at 1440: 651 in the frame) |
| QA5-56 | read only: your level | all | the viewer's own level comes from `your_level` (a person with a grant of View sees **View**; the dev admin sees Modify) |
| QA5-57 | loading | all | the Access mode card keeps its header and shows `Skeleton kind="lines" rows={3} label="Loading access"` after the 300 ms pending delay; the card is as tall as the loaded project-wide form without saved grants: **180.9** at 1440, **196.3** at 1024, **319.4** at 279 (±1 px); the People card is not shown while loading |
| QA5-58 | error | all | a failed `GET …/access` shows `ErrorState compact` titled **Couldn’t load access** with Retry inside the Access mode card (210.8 px at 1440 and 1024, 226.2 at 279): never an empty tab, never the default project-wide form, no save bar; Retry refetches |
| QA5-59 | 279 px: cards | 390 | the tab is 279 px wide, cards stack with the same 14 px gap; heights: mode card 350.2 / 319.4, People card with none 259.4, with one 292.7, with twelve **1665.3**, whole tab with twelve **2068.7** (the 12 grants are cards, see QA5-60) |
| QA5-60 | 279 px: grants | 390 | below 640 px the table is the `DataTable` card list: Person as the card title, Level (full 2-option width), Added by and Added under it, Remove at the card end; each grant card **124.8 px** high (table 1497.4 for 12, 124.8 for one; was 132), no horizontal scroll |
| QA5-61 | 279 px: save bar | 390 | 56 px clean, 65.4 px with a wrapping status; Discard and Save access keep 24 px height and are never covered by the status |
| QA5-62 | leave dialog | all | with unsaved access changes, choosing another tab (strip click or arrow key) opens a `ConfirmDialog` (**amended:** 438 wide in the product, the mock's 440 was drawn without the border; height 162.2): title **Discard access changes?**, body **You have unsaved changes to who can access this dataset. They are lost if you leave this tab.**, buttons **Keep editing** (neutral, focused first) and **Discard changes** (danger); Escape and Keep editing stay on the tab with the edits; Discard changes switches the tab and drops the edits. Without unsaved changes the tab switches at once |
| QA5-63 | no dialog elsewhere | all | the guard is only the tab strip; the browser's own back button and other links are not intercepted |
| QA5-64 | RTL | all | an Arabic display name has `dir="auto"` and does not mirror the table; labels, controls and columns never change sides |
| QA5-65 | axe | all | 0 serious or critical violations in project-wide, restricted, read-only, loading and error at 1440 and 390 |
| QA5-66 | no overflow | all | `scrollWidth <= clientWidth` on `access-tab` and every card at 1440, 1024 and 390 in every state |
| QA5-67 | project-wide with saved grants | all | the saved-grants sentence of QA5-30 is shown only for a dataset that has saved grants; a dataset with none shows the plain help (180.9 / 196.3 / 319.4) |
| QA5-68 | tab and Settings agree | all | the header **Restricted** badge, the tab count and the People count agree after a save (the count in the strip updates without a reload: `grant_count` is invalidated with the dataset query) |
| QA5-69 | permission to see grants | all | every person who can view the dataset sees the grants (A1-37); `candidates` stays empty for a non-manager and the add row is not rendered |
| QA5-70 | a restricted dataset the caller cannot open | all | the dataset 403 page replaces the whole page, the Access tab never renders |
| QA5-71 | very long names | all | a 60-character display name and a 70-character email wrap inside the Person cell; row height grows, no other column moves, nothing is cut |
| QA5-72 | print of numbers | all | `docs/internal/feature-rounds/2026-10-qa-feedback/measure/out/mock-*.json` holds every number of this section; the review reruns `measure-mock.mts` on the gallery and a product equivalent on the implemented page |

### 3.5 S9 API of the Access tab (no new route)

`GET /v1/datasets/{ref}/access` and `PUT /v1/datasets/{ref}/access` (A1-37 to A1-41) are enough. The grant payload already carries the two fields the new column needs:
`granted_by` (the actor who **created** the grant; a level change does not replace it: `PUT` updates `level` and `updated_at` only) and `created_at` (set when the row is created).
`dataset_grants` has `granted_by_user_id` (nullable, `SET NULL` when the user is deleted), `created_at` and `updated_at`: **no column is missing and no migration is needed.**

| Id | Request | Criterion |
|---|---|---|
| QA5-73 | `GET …/access` | unchanged payload: `{"access_mode", "grants": [{"user": {id, name, email}, "level", "granted_by": {id, name, email} \| null, "created_at": ISO}], "can_manage_access", "candidates", "your_level"}`; grants ordered by `created_at` ascending, then name |
| QA5-74 | `granted_by` and `created_at` | for a grant created in a `PUT`: `granted_by` = the caller, `created_at` = the request time; for an unchanged grant of a later `PUT` both are unchanged; changing a level keeps `created_at` and `granted_by` |
| QA5-75 | deleted granter | `granted_by` is `null` after the granting user is deleted; the UI shows **Unknown user** (QA5-40) |
| QA5-76 | catalog and detail payloads | `GET /v1/datasets` and the dataset detail carry `access_mode` and `grant_count` (A1-43), used by the tab count (QA5-18) |
| QA5-77 | permissions | `PUT` answers **403** `Only project managers and admins can change dataset access` without manage; `GET` needs view; the codes and texts of A1-39 to A1-41 are unchanged |
| QA5-78 | one request | the Access tab issues one `GET …/access` per visit (prefetched, QA5-23) and one `PUT` per save; 0 requests while Settings is open |

---

## 4. QG1: link cards without a hover underline

Current state: `frontend/src/styles/base.css` sets `a { text-decoration: none }` and `a:hover { text-decoration: underline }`. Any anchor without its own `:hover`
override underlines **every text it contains** on hover. Measured with `measure/hover-inventory.mts` (every anchor that wraps more than one text element, or is
taller than 36 px, hovered at 1440; `measure/out/hover-inventory-*.json`) and `hover-shots.mts current` (`current-hover-*.png`; computed `textDecorationLine` of the anchor on hover):

| Surface | Anchor | Size (1440) | Rest | Hover today |
|---|---|---|---|---|
| Projects page card | `a[data-project-card]` (`ui/Card` `to`) | 287.8 x 127.4 | `none` | **underline** (name, slug, role, counts: 8 texts); border `rgb(43,43,64)` to `rgb(59,59,84)`, fill `rgb(26,26,40)` to `rgb(34,34,50)`, shadow |
| Datasets catalog card | `a[data-dataset-card]` (`ui/Card` `to`) | 388.3 x 226.4 | `none` | **underline** (13 texts); the same border, fill and shadow change |
| Docs previous / next | `nav[aria-label="Previous and next page"] a` (`LinkButton`, two texts) | 321.1 x 32 | `none` | **underline** (the docs `.article a:hover` outranks the LinkButton rule); fill `rgb(50,50,68)` to `rgb(42,42,60)` |
| Run page dataset link | `a[class*=metaLink]` (name + version tag + alias tag) | 152.1 x 15 | `none` | **underline** (3 texts); colour to `--accent-primary` and the tags dim (its own hover) |
| Experiments launch: "clone the latest" | `a.card` in `StartFrom` (`StartCard to`, eyebrow, title, hint, meta) | not rendered in the seed (no experiment) | `none` | underline by code: `.card { text-decoration: none }` has lower specificity than `a:hover` and no `:hover` of its own |
| Plain inline links (runs list run name, breadcrumbs, docs article text, "View all →") | `a` with one text | 79 x 16 | `none` | underline (kept) |
| Link buttons (`LinkButton`) | `a.button` | 24 to 32 high | `none` | already `none` (`Button.module.css`: "An anchor styled as a button never underlines on hover") |
| Shell navigation, breadcrumbs, section nav | `a` with own `text-decoration: none` rules | 32 high | `none` | already `none` or inline text |

The experiments list rows and the environments list are **not anchors** (`DataTable` rows with `onPress`, and `button.nameLink`): no underline can occur there and nothing changes. Note
the catalog card at 390 is 300 px wide inside a 279 px grid (a pre-existing defect recorded in the previous round, not part of this point).

The rule (decision QD13): **an underline on hover is for running text.** A link whose content is one run of text keeps it. A link that is a box (card, boxed button) or that holds more than one
text element or a badge (dataset link with tags) never underlines; its hover is its own treatment: for a card the `Card` primitive's existing one (border `--border-default`,
fill `--bg-elevated`, `--shadow-card-hover`), for a boxed link the Button hover fill, for a chip-like link the colour change it already has. Implementation: `base.css` becomes
`a:hover:not([data-link='block']) { text-decoration: underline; }`; the surfaces above carry `data-link="block"` (set by `ui/Card` whenever it renders an anchor, by `StartCard` when it renders a `Link`, by the docs pager `LinkButton`, and by `MetaLink`).
The `:not([data-link])` form is explicit and greppable; `:has()` heuristics were rejected (QD13).

Specified (`mock-link-cards-*.png`, `mock-hover-*.png`, case `qa-link-cards`; the mock proves the end state with a local rule):

| Id | Surface | Width | Criterion |
|---|---|---|---|
| QG1-1 | `a[data-project-card]` on `/` | 1440, 390 | on hover `getComputedStyle(a).textDecorationLine === 'none'` (the 8 text elements inside paint no underline: pixel check of the hovered screenshot has 0 underline rows); hover keeps today's treatment: border `rgb(43,43,64)` to `rgb(59,59,84)` (`--border-default`), fill `rgb(26,26,40)` to `rgb(34,34,50)` (`--bg-elevated`), a `--shadow-card-hover`; size 287.8 x 127.4 at 1440, 279 x 127.4 at 390; no `transform` |
| QG1-2 | `a[data-dataset-card]` on the catalog | 1440, 390 | the same: `textDecorationLine` `none` on hover; border `rgb(59,59,84)`, fill `rgb(34,34,50)`, shadow; 388.3 x 226.4 at 1440 |
| QG1-3 | `ui/Card` with `to` or `href` | all | renders `data-link="block"` on its anchor; a unit test renders both and asserts the attribute; a `Card` without `to` / `href` renders none |
| QG1-4 | docs pager `nav[aria-label="Previous and next page"] a` | 1440, 390 | `textDecorationLine` `none` on hover for both links; the Button hover fill `rgb(42,42,60)` is kept (321.1 x 32 at 1440, 179.6 x 32 at 390); `data-link="block"` set |
| QG1-5 | run page dataset link `a[class*=metaLink]` (dataset name, version, alias) | 1440 | `none` on hover; the colour change to `--accent-primary` and the 0.8 opacity on the tags are kept; 152.1 x 15 |
| QG1-6 | `StartCard` rendered as a link (`a`, "clone the latest experiment") | 1440, 390 | `none` on hover; its card border and fill change as for the `Card` recipe (it needs a `.card:hover` / `a.card:hover` rule next to its `.card[role=radio]` one; today it has none); the reviewer checks it with a seeded experiment (not rendered in the design seed) |
| QG1-7 | plain inline links (runs list `a[class*=runName]`, breadcrumbs, `View all →`, docs article links, item index links) | 1440 | **keep** the underline on hover: `textDecorationLine` is `underline` (regression criterion; the mock's `demo-plain-link` shows it) |
| QG1-8 | `LinkButton` anchors (`a.button`) | 1440 | still `none` on hover (unchanged) |
| QG1-9 | `base.css` | n/a | the file contains `a:hover:where(:not([data-link='block']))` (**amended:** `:where()` keeps the old (0,1,1) specificity; a bare `:not([data-link])` adds (0,1,0) and silently beat every component's own `.x:hover { text-decoration: none }`, the sidebar items and the breadcrumbs among them) and no other `a:hover` underline rule; `design-language.test.ts` asserts it and asserts that `ui/Card.tsx` and `StartCard.tsx` emit `data-link="block"` |
| QG1-10 | experiments list rows, environments list rows | 1440 | no anchor is hovered; the name cell is a `button` / row press target; hover colour only: `getComputedStyle(row).textDecorationLine` is `none` for the row and the name button (verified with an experiment and an environment in the review seed) |
| QG1-11 | inventory | 1440, 390 | `measure/hover-inventory.mts 1440 all` and `measure/hover-inventory.mts 1440 all runs` list **0 anchors** that have two or more text elements, or a border or fill, and an underline on hover (today: the five rows of the table above) |
| QG1-12 | keyboard focus | all | unchanged: the 2px `--accent-primary` focus outline on cards, no underline on focus |
| QG1-13 | contrast and non-colour cue | all | removing the underline from block links does not remove their non-colour cue: they are boxes with a border, or tags beside the name; plain text links keep the underline on hover and the accent colour at rest |
| QG1-14 | touch | 390 | no hover state is required to understand a card is a link (cursor, border and the chevron-free card are the same as today) |
| QG1-15 | gallery | all | `/__ui#qa-datasets` `qa-link-cards` shows the end state; `textDecorationLine` on hover is `none` for `demo-card-link`, `demo-pager-link`, `demo-meta-link` and `underline` for `demo-plain-link` (measured: `none`, `none`, `none`, `underline` at 1440 and 390) |
| QG1-16 | no new CSS per page | all | no card or page stylesheet adds its own `text-decoration` hover rule for the surfaces above (the opt-out is the attribute, not eight local overrides) |

---

## 5. Voice and copy checklist (all verbatim)

Labels and helper text: **Metadata**, **Filter by metadata**, **Key**, **Value**, **None selected**, **{n} selected**, **Match**, **Partial**, **Full match**, **Choose two or more values to pick a match mode.**,
**Items that have at least one of the chosen values.**, **Items that have every chosen value. An item may have more.**, **You can choose up to 20 values.**, **Cancel**, **Add filter**, chips **{path}: {v1}, {v2} (any)** / **(all)**,
**Remove filter {chip text}**, **You can combine up to 5 metadata filters.**, **Showing the 200 most common values of {n}. Type to search.**, **No metadata keys**, **Items in this version have no metadata fields to filter on.**, **Couldn’t load metadata keys**.
Key descriptions: **{n} values**, **{n} values · list**, **{n} values · list or value**.
Settings: **General**, **Name**, **Description**, **Tags**, **Press Enter to add a tag.**, **Type a tag and press Enter**, **Save changes**, **No changes**, **Unsaved changes**, **Visibility**, **Private test set (admins only)**, **Danger zone**, **Delete dataset**,
**Only the dataset creator or a project manager can delete a dataset.**, **This project is archived.** (descriptions of Visibility and Danger zone: today's text, unchanged).
Access: **Access**, **Access mode**, **People with access**, **{n} people** / **1 person**, **Who can access this dataset**, **Everyone in the project**, **Only people listed below**, the helps of QA5-30, **Project managers, admins and the creator always have full access.**,
**Add person**, **Choose a project member**, **Level for {name}**, **Level for the new person**, **View**, **Modify**, **Remove {name}**, columns **Person**, **Level**, **Added by**, **Added**, **Not saved**, **You**, **Unknown user**,
**No one is listed**, **Only project managers, admins and the creator can open this dataset.**, **Everyone in the project already has access.**, **Save access**, **Discard**, **Saving**, **Access saved**, **Couldn’t save access**, **Couldn’t load access**,
**Only project managers and admins can change who has access.**, **Who has access**, **Your access**, **Restricted**, **Project-wide**, **Discard access changes?**, the body of QA5-62, **Keep editing**, **Discard changes**, **Loading access**.
No exclamation marks; numbers are in the sentence; apostrophes are typographic (’).

## 6. Superseded criteria of the previous round

| Previous id | What changes |
|---|---|
| A3-2, A3-3 (popover heights) | scalar key 318.9 (the Value head is a 20 px row); list and mixed heights in QA1-4 |
| A3-4 (key select) | descriptions gain `· list` and `· list or value`; list paths are now listed |
| A3-5 (value list) | single choice stays for scalar keys; list and mixed keys are multi-select (QA1-6 to QA1-8) |
| A3-7, A3-8 (chips) | chip text for several values; a chip wraps instead of overflowing (QA1-19, QA1-20) |
| A3-9 (URL) | `meta_mode` joins `meta` (QA1-22) |
| A3-10 (limit) | five **paths**, up to 20 values per path (QA1-24, QA1-47); the tooltip text is unchanged |
| A3-14 (truncated) | on a list key Enter adds the typed value to the chosen set (QA1-15) |
| A3-43, A3-44, A3-45, A3-46, A3-47, A3-64 | list matching, `meta_mode`, `kind` in the facets, the batch `meta` value shape and the key limit (QA1-31 to QA1-56) |
| A1-5 to A1-6, A1-19 to A1-24 | the Access section is no longer a Settings card: its placement, the save bar position and the loading frame move to QA5-24 to QA5-72 (their copy and the PUT contract stay) |
| A1-7, A1-8, A1-11, A1-15, A1-16, A1-17 | option layout side by side, the new **Added** column, the add row above the table, 124.8 px mobile cards |
| A1-10, A1-9, A1-12 to A1-14, A1-18, A1-20, A1-21 | unchanged (copied into QA5-28 to QA5-51) |

## 7. Decisions (what the owner brief left open; reverse by editing the named place)

| Id | Decision | Reason | How to reverse |
|---|---|---|---|
| QD1 | The UI defaults a multi-value choice to **Partial (any)**; the API default for several values on one path without `meta_mode` is **all** | the owner lists "partial" first and a tag filter that widens is what people expect; but a destructive batch with a forgotten mode should narrow, not widen, and repeated `meta` parameters already meant AND. The UI always writes the mode explicitly, so the two defaults never meet | change `DEFAULT_MODE` in `lib/metaFilter.ts` and `DEFAULT_META_MODE` in `services/dataset_meta.py` |
| QD2 | One value on a list path means "contains"; no client-side kind check | the same URL works for a path that is scalar on some items and a list on others | require an explicit `kind` (rejected: needs the facets before every list call) |
| QD3 | The mode is a separate repeatable parameter `meta_mode=path:any\|all`, not part of the value | values may hold colons, commas and bars; a separate parameter needs no escaping and keeps `meta=path:value` as it is | encode as `meta=path:v1\|v2` (rejected: ambiguous) |
| QD4 | Limits: **5 paths**, **20 values per path** (the "5 filters" text is unchanged) | a filter is a path; the previous 5-parameter count would make a 6-value tag filter impossible | `MAX_META_FILTERS`, `MAX_META_VALUES` |
| QD5 | Facet `kind` has three values: `scalar`, `list`, `mixed` | a key can be a string on some items and a list on others (the seed's `channels`); the UI treats `list` and `mixed` the same | collapse `mixed` into `list` |
| QD6 | The chip suffix is **(any)** / **(all)** (the brief's example), the control labels are **Partial** / **Full match** (the owner's words) | the chip must stay short; the help line maps both vocabularies | rename the suffix |
| QD7 | Lists of objects, nested lists, null elements and empty lists are not facet values; a path whose only content is such lists is omitted; no path traverses a list | D7 is dotted object paths; the owner asked for "lists of items" meaning scalars | add a `kind: "objects"` entry later |
| QD8 | Scalar keys stay single-choice | the owner asked for list keys only; multi-value on a scalar key is reachable through the API (QA1-44) | make every key multi-select |
| QD9 | Settings breakpoint 900 px of **container** width, side column 360 px | at 900 the form column is 526 px, enough for a 120 px label and a 370 px field; the side column holds the two cards that carry long descriptions (they wrap at 360) | the two numbers in `SettingsTab.module.css` |
| QD10 | The Access tab sits between Lineage and Settings and shows `grant_count` only for restricted datasets | the order puts the two administration tabs last; a count on a project-wide dataset would read "0" and look like "nobody has access" | tab order in `tabItems`; count rule |
| QD11 | The add row is above the table; the save bar is sticky; leaving the tab with unsaved changes asks | with 12 people the old order buried the add row 560 px down and the save bar below it; losing a hand-built list on a stray click is a data-loss path | move the add row; drop the dialog |
| QD12 | "Added" is `created_at` and "Added by" is `granted_by`; no backend change; a saved grant with `granted_by: null` reads **Unknown user** (today's code shows "You" for it, a bug) | the payload already carries both; "You" for a deleted granter is false | add `granted_at` updated on level changes (rejected: nobody asked) |
| QD13 | The hover rule is an explicit attribute `data-link="block"` on block links and `a:hover:not([data-link='block'])` in `base.css` | one greppable switch instead of eight overrides; `:has()` could not tell an inline link with an icon (keep underline) from a boxed link | revert `base.css` |
| QD14 | The experiments list rows and environments list rows need no change (they are not anchors); `StartCard` as a link does | verified by reading `ExperimentsPage.tsx`, `EnvironmentsList.tsx` and `StartCard.tsx`; the inventory found the four surfaces of the table | n/a |
| QD15 | The Access query is prefetched on idle after the items tab paints | "load by default" (DESIGN_LANGUAGE section 7); the tab then opens without a skeleton | remove the prefetch |
| QD16 | The Settings cards use the `Card` header slot, not `SectionHeader level="xl"` | the xl header is the page-section recipe (48 px margin, hairline); inside a card it wasted 84 px | n/a |
| QD17 | A mode sent for a scalar path is accepted (any = IN, all = AND) | a client does not know the kind; an error would turn a harmless parameter into a failure | return 422 for a mode on a path whose facets say `scalar` (rejected: needs a scan per request) |

## 8. Test plan

| File | Covers |
|---|---|
| `tests/platform/test_dataset_meta_lists.py` (new, SQLite; the Postgres cases skip without `QYM_TEST_POSTGRES_URL`) | QA1-31 to QA1-40 (facets for list, mixed, empty, objects, deep paths, cache key, 200-element cap), QA1-41 to QA1-53 (single value, any, all, scalar compatibility, empty list, objects, numbers and booleans, mode errors, limits, statement count equal for 1 and 20 values, 5,000 items under 1 s), QA1-43 (list, counts, download, neighbors agree) |
| `tests/platform/test_dataset_items_batch.py` (extend) | QA1-54 to QA1-57 (the `{values, mode}` shape, each 422 text, dry run counts 46 / 6, apply, audit entry stores the filter) |
| `tests/platform/test_dataset_access.py` (extend) | QA5-73 to QA5-78 (payload fields, `created_at` and `granted_by` stable across a level change, `null` granter after deleting the user, `grant_count`) |
| `frontend/src/features/datasets/lib/__tests__/metaFilter.test.ts` (extend) | QA1-19, QA1-22, QA1-24 (parse and serialize `meta_mode`, canonical order, dropped bad modes, 20 values, chip labels), QA1-47 client side |
| `frontend/src/features/datasets/detail/__tests__/MetadataFilter.test.tsx` (new) | QA1-2 to QA1-18 (key descriptions, multi-select, Match control disabled below two, help copy, limit line, scalar unchanged, Add filter payload) |
| `frontend/src/features/datasets/detail/__tests__/AccessTab.test.tsx` (replaces `AccessSection.test.tsx`) | QA5-24 to QA5-31, QA5-39 to QA5-51, QA5-53 to QA5-58, QA5-62 (dirty signature, Unknown user, Not saved tag, leave dialog, read only, loading frame) |
| `frontend/src/features/datasets/detail/__tests__/SettingsTab.test.tsx` (new) | QA5-3 to QA5-6, QA5-10 to QA5-15 (no `…/access` request, FieldRow labels, wrapped descriptions) |
| `frontend/src/features/datasets/lib/__tests__/route.test.ts` (extend `lib.test.ts`) | QA5-17, QA5-19 (`access` tab, fallback) |
| `frontend/src/__tests__/design-language.test.ts` (extend) | QG1-9 (the `base.css` selector, `data-link` in `Card.tsx` and `StartCard.tsx`) |
| `frontend/src/ui/__tests__/Card.test.tsx` (extend) | QG1-3 |
| `frontend/e2e/datasets/meta-list-filter.spec.ts` (new) | QA1-1 to QA1-30 on the seeded `support-faq`: key list shows `tags`, `source.labels`, `levels`, `channels`; choose billing + refund: any 46 rows, switch to Full match: 6; chip text, URL, reload, remove; mixed key; popover heights 519.7 / 359.7 / 318.9 at 1440 and 390; chip wrapping at 390 |
| `frontend/e2e/datasets/settings-layout.spec.ts` (new) | QA5-1 to QA5-16: boxes at 1440, 1024, 390 (columns 819 / 360, 0 px empty right, title 15 px from the card top, 354.9-class heights with the page's 1193 column), no horizontal overflow |
| `frontend/e2e/datasets/access-tab.spec.ts` (new; `access.spec.ts` moves its `?tab=settings` calls to `?tab=access`) | QA5-17 to QA5-23 (tab order, count, URL, prefetch), QA5-24 to QA5-72 on project-wide, restricted with 0 / 1 / 12 grants, unsaved, saving, failed, read only (non-admin user), archived, loading, error, sticky bar bottom edge, leave dialog, 390 |
| `frontend/e2e/visual-language/link-cards.spec.ts` (new) | QG1-1 to QG1-8, QG1-10, QG1-11 (hover each surface and read `textDecorationLine`, border and fill; the inventory script as a test) |
| `frontend/e2e/datasets/a11y.spec.ts` (extend) | QA5-65 on the Access tab and Settings |

## 9. Hand-off (build order)

1. **Facets** (`packages/platform/qym_platform/services/dataset_meta.py`): `_walk` collects list elements per item (set, first 200 scalar elements), `metadata_facets` computes `kind`, omits paths with no values, keys the cache with `FACET_SCHEMA = 2`.
2. **Filter** (same file and `api/datasets.py`): `parse_meta_params(meta, meta_mode)` returns `list[MetaFilter(path, values, mode)]`; `_clause` becomes `_value_clause` (scalar equal OR list contains) combined with `or_` / `and_` per path; `apply_meta_filters(db, query, filters)`; add `meta_mode: list[str] = Query(default_factory=list)` to `list_items`, the download route, the neighbors route and the routes that call `_filtered_items_query`; `meta_pairs_from_mapping` accepts `{values, mode}`; texts of QA1-46, QA1-47, QA1-55. No migration.
3. **Frontend filter lib** (`api/datasets.ts` `MetaFacetPath.kind`, `ItemsParams.meta_mode`; `features/datasets/lib/metaFilter.ts` `MetaFilter = {path, values, mode}`; `batchCopy.ts`, `BatchDialog.tsx` batch shape).
4. **Popover and chips** (`detail/MetadataFilter.tsx` and its CSS from `QaDatasetsMocks.module.css`: `.valuesHead`, `.facet[data-multi]`, `.tick`, `.match*`; `detail/ItemsTab.tsx` URL read and write and the chip row; `ui/Chip` wrap rule from `.chipRow > span`).
5. **Link cards** (`styles/base.css`; `ui/Card/Card.tsx`; `features/experiments/launch/entry/StartCard.tsx` and its hover; docs pager in `features/docs/DocsPage.tsx`; `MetaLink` in `features/run-detail/components/RunHero.tsx`; `design-language.test.ts`). Independent of the rest.
6. **Settings** (`detail/SettingsTab.tsx` + `SettingsTab.module.css`: grid, `Card` header slot, `FieldRow` rows, footer; remove the `AccessSection` mount).
7. **Access tab** (`detail/AccessTab.tsx` and `AccessTab.module.css` from `AccessSection.*` and the mock recipe: cards, mode grid, add row on top, Added column, sticky save bar; `lib/route.ts` `DetailTab` and `DETAIL_TABS`; `detail/DatasetDetailPage.tsx`: tab item with `grant_count`, `TabPanel id="access"`, the leave guard with `ConfirmDialog`, the idle prefetch of `useDatasetAccess`; invalidate the dataset query after a save so the count updates).
8. **Tests and e2e** as listed; `frontend/e2e/datasets/access.spec.ts` moves to the new tab; run `cd frontend && npm run check` and `pytest tests/platform/test_design_language.py` through `scripts/heavy.sh`; backend: `pytest tests/platform -k "dataset"` in chunks.

Gallery recipe to move: `.popover`, `.valuesHead`, `.facetList`, `.facet`, `.tick`, `.match*` (QA1); `.settingsGrid`, `.side`, `.fields`, `.footRow`, `.cardHead*` (Settings); `.accessTab`, `.modeGrid`, `.always`, `.addPerson`, `.addSelect`, `.saveBar`, `.skeletonFrame` (Access).

## 10. What could not be measured, and why

* **The sticky save bar in the page's scroll host** (QA5-44): the gallery has no inner scroller, so the mock proves the bar's geometry (56 px, `position: sticky`) but not that its bottom edge equals the host's bottom edge. The reviewer measures it in the product with 12 grants at a 900 px high viewport.
* **The key `Select`'s open list** (the descriptions of QA1-2): the Select primitive's popup is not drawn statically; the descriptions are specified as text and measured in the closed state; the review reads them from the opened listbox.
* **PostgreSQL**: no PostgreSQL server was available (`QYM_TEST_POSTGRES_URL` unset). The SQL of QA1-51 is specified from the existing `#>` / `#>>` code path and PostgreSQL's documented JSON functions and was not run; the SQLite SQL (QA1-50) was run against the Python oracle (the numbers of QA1-42).
* **`StartCard` as a link and the experiments list** (QG1-6, QG1-10): no experiment exists in the seed (they need the Evaluation Service), so the anchor was not rendered; the criteria come from the code and are measured by the reviewer with an experiment from the e2e seed.
* **A non-admin user** (read-only states of QA5-53 to QA5-56): the dev user is a platform admin under `QYM_AUTH_MODE=none` and always has manage access, so these states were measured on the mock only; the reviewer uses the e2e's non-admin users (`access-support.ts`).
* **1193 vs 1163**: the gallery column at 1440 is 1163 px; flex widths (Person, form body, input widths) are quoted for both, every fixed width is identical.
* **The Arabic name in the table** (QA5-38): checked visually on the mock (RTL cell, columns unmoved), not asserted by number.
* **A stale `current-*` full-page screenshot**: the page scrolls inside `main`, so the `current-settings-*` and `current-access-*` PNGs show the first viewport only; the heights in this document come from DOM geometry, not from the image.

---

## 11. Implementation amendments (implementer, 2026-10-21)

Numbers and texts the product could not meet exactly, each measured and asserted by the e2e at the amended value. Owner decisions D1-D7 and E1-E4 are untouched.

| Id | Spec said | Product measures | Reason |
|---|---|---|---|
| QA1-4 | `meta-popover` 320 x 519.7 / 359.7 / 318.9, content 290, at 390 too | the same numbers on the bordered Popover surface (`data-testid` is on the surface; the inner panel is 318 px so the surface is 320). At a 390 x 900 viewport the list-key popover is **448 high** and scrolls inside (the Popover primitive gets `overflow-y: auto`), because the viewport leaves 448 px under the toolbar | a popover cannot be taller than the room the viewport leaves; the e2e measures with a 1500 px high viewport and a separate case for the clamp |
| QA1-20 | long chip 279 x 38.6 at 390 | **261 x 38.6** (rows 86 and 158.6 as specified) | the chip row is 261 px wide in the page (the mock column was 279) |
| QA5-44 | bottom edge equals the host's bottom edge | 0 px at every scroll position until the content ends; **31.9 px** above the host edge at the very end | the host has bottom padding and the bar is sticky inside its content |
| QA5-62 | dialog 440 wide | **438** | the mock's box was drawn without the 1 px border |
| QG1-9 | selector `a:hover:not([data-link='block'])` | `a:hover:where(:not([data-link='block']))` | specificity: see the table row; found by the e2e inventory (sidebar items underlined on hover with the literal selector) |
| QG1-7 | breadcrumbs keep the underline on hover | breadcrumbs never underline (their own `.link:hover { text-decoration: none }`, unchanged) | the spec's list was wrong for breadcrumbs; the rule and the surfaces are as specified |

Additions the spec did not list: the `Tabs` primitive scrolls the selected tab into view when the strip is wider than its column (five dataset tabs at 279 px hid the Access tab); the `Chip` primitive carries the wrap rule of QA1-20 for every chip; a facets payload without `kind` is read as scalar (older servers, mocked payloads).
