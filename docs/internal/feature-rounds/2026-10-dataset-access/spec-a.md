# WP-A: dataset access, disabled items, batch edits by metadata (design specification)

Status: design stage. Branch `feat/dataset-access` (from `UI-redesign` 38d710c5). No product component, route or model is changed by this
stage. The code added is the gallery mock `frontend/src/features/dev/DatasetAccessMocks.tsx` (+ `.module.css`, wired into `/__ui#dataset-access`
through `UiGalleryPage.tsx`), the seed and measurement scripts under `measure/`, the screenshots under `shots/` and this document. The mocks are the
visual contract: where this text and a mock disagree, the number in this text wins and the mock is a bug. The CSS in `DatasetAccessMocks.module.css`
is the proposed recipe, ready to move into the real components. The product design is `docs/internal/DATASET_ACCESS_AND_EVAL_FLAGS_DESIGN.md`
(owner decisions D1-D7 in its section 8 are final and are not re-opened here).

Measured 2026-10-20 at 1440, 1024 and 390 px on the Vite dev server (5981) over the platform on 8981 (SQLite, `QYM_AUTH_MODE=none`), Playwright
1.x Chromium headless shell, dark scheme, one browser context per width. Column widths of the real pages: 1193 px at 1440, 777 at 1024,
279 at 390. The gallery frame is 1163 px wide at 1440 (the gallery has its own gutters), 777 at 1024 and 279 at 390; every number below that says
"frame" was measured in the gallery, every number that says "page" in the product. Layouts differ between 1163 and 1193 only in free space.

## 0. Reading guide

The owner's features, in the design document's words (its section "Five features, two work packages"; WP-B rows are listed for completeness
and are specified in `spec-b.md`):

| WP | Feature | Backend | UI |
|---|---|---|---|
| A | 1. Per-dataset permissions (view / modify) | `dataset_grants` table, `datasets.access_mode`, permission helpers, access routes | Dataset Settings "Access" section, catalog chips, per-dataset read-only plumbing |
| A | 2. Deactivate items temporarily | `dataset_items.disabled_*`, `state` filter on item reads, enable/disable routes, revisions | Items tab state filter + chips, item pane / item page actions and banner |
| A | 3. Batch edit by metadata | metadata filter on item list, `items:batch` action route, metadata facets route | Metadata filter in the items toolbar, "Apply to all N matching" bulk menu with dry-run confirm |
| B | 4. Per-experiment dataset read token | `eval_dataset_tokens` service (mirror of `eval_submitter_keys`), 2 columns on `eval_experiments`, dispatcher injection, revoke on settle | Experiment detail "Credentials" row, token list shows experiment tokens |
| B | 5. Latency-sensitive runs | `eval_experiments.latency_sensitive`, request field, dispatcher body field, env cap, review warnings | Launch "Run settings" switch, review pane row, detail / list / queue tags, job deferral status |

Feature to surface to criteria (all in WP-A):

| Feature | Surface | Criteria |
|---|---|---|
| 1 permissions | S1 catalog card | A1-1 to A1-4 |
| 1 | S2 Settings, Access section (manager, read-only, loading, error, mobile) | A1-5 to A1-24 |
| 1 | S3 dataset page for a viewer, 403 page | A1-25 to A1-31 |
| 1 | S4 run pages and compare, redacted item contents | A1-32 to A1-36 |
| 1 | S5 API: access routes, enforcement, payloads | A1-37 to A1-60 |
| 2 disabled items | S6 items table (state control, rows, counts) | A2-1 to A2-12 |
| 2 | S7 item pane and item page (action, banner) | A2-13 to A2-28 |
| 2 | S8 Disable item dialog | A2-29 to A2-35 |
| 2 | S9 version header, version list, download, publish dialog | A2-36 to A2-42 |
| 2 | S10 item history and compare | A2-43 to A2-48 |
| 2 | S11 API: state on reads, enable and disable routes, revisions | A2-49 to A2-66 |
| 3 batch by metadata | S12 Metadata filter popover and chips | A3-1 to A3-14 |
| 3 | S13 All matching menu, selected-rows actions | A3-15 to A3-26 |
| 3 | S14 batch confirm dialog | A3-27 to A3-42 |
| 3 | S15 API: `meta=`, facets, `items:batch` | A3-43 to A3-64 |

Count: A1 60, A2 66, A3 64 = **190 numbered criteria**. Section 8 records the decisions I took (with reasons and how to reverse), section 9
the test plan, section 10 the hand-off.

Vocabulary: "frame" and "page" as above; "primary content" = the thing the page is for; `data-testid` values written in `code` are part of the
contract and the implementer must add them to the real components (the mock carries the same ids).

### Screenshots (`docs/internal/feature-rounds/2026-10-dataset-access/shots/`, dark, each under 300 KB)

| File pattern | What |
|---|---|
| `current-catalog-{1440,1024,390}.png` | catalog with a private test set card today |
| `current-items-draft-*`, `current-items-published-*`, `current-items-selection-*` | the items tab toolbar, rows and the selection bar today |
| `current-item-pane-{1440,1024}.png` | the docked editor pane (460 px) today; at 390 the pane does not open (cards open the item page) |
| `current-item-page-draft-*`, `current-item-page-published-*` | item page header and actions today |
| `current-settings-*` | Settings tab: General, Visibility, Danger zone today |
| `current-compare-*` | dataset compare page today |
| `mock-catalog-*`, `mock-access-*`, `mock-access-readonly-*`, `mock-viewer-*`, `mock-run-redaction-*` | feature 1 as specified |
| `mock-toolbar-*`, `mock-menus-*`, `mock-meta-popover-*`, `mock-batch-dialog-*` | features 2 and 3: toolbar, menus, popover, dialogs |
| `mock-item-state-*`, `mock-disable-dialog-*`, `mock-version-meta-*`, `mock-history-compare-*` | feature 2: pane, page, dialog, version header, history, compare |

Not photographed as "current": the 403 page, the read-only dataset page and the run-page placeholder, because the dev user is a platform admin
under `QYM_AUTH_MODE=none` and always has manage access, so those states cannot be produced before the feature exists. They are specified from
the existing recipes (`ErrorState`, `RunHero .banner`, `ItemCard .muted`) and measured on the mock only; the reviewer verifies them in the
implemented product with a non-admin test user (see Test plan, Playwright `datasets/access.spec.ts`).

### How it was measured (`measure/`)

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd <worktree>
python frontend/scripts/dev_db.py sqlite:///$PWD/.qym-design-a.db
QYM_AUTH_MODE=none QYM_DATABASE_URL=sqlite:///$PWD/.qym-design-a.db QYM_ENVIRONMENT=development python -m uvicorn qym_platform.main:app --port 8981 &
(cd frontend && QYM_PLATFORM_PORT=8981 npm run dev -- --port 5981) &
curl -X POST localhost:8981/v1/projects -H 'content-type: application/json' -d '{"name":"Access demo","slug":"access-demo"}'
node docs/internal/feature-rounds/2026-10-dataset-access/measure/seed-a.mts http://127.0.0.1:8981   # 3 datasets, 130 items, 2 runs
node .../measure/shots-current.mts     # current-*.png + baseline/current.json
node .../measure/shots-mock.mts        # mock-*.png (optional case-prefix arguments)
node .../measure/measure-mock.mts      # baseline/mock.json: box of every data-testid named below, at 1440 / 1024 / 390
python .../measure/shrink-shots.py     # quantises any PNG over 290 KB
```

`lib-a.mts` holds the shared launch and page helpers. The machine's `.venv` had lost its interpreter (system Python moved to 3.14), so the design run used a
throwaway venv outside the repository; nothing in the repository depends on it.

Seed (`seed-a.mts`, public API only): project `access-demo`; `support-faq` (public; v1 published with 130 items and alias `production`, v2 draft forked
from v1 with item `faq-001` edited; metadata `domain` (finance for the first 42 items, health, retail, legal for the rest), `difficulty`,
`source.region.code` (sa, ae, eg, kw), `source.channel`), `legal-clauses` (40 items; stands in for the restricted dataset), `pricing-golden`
(private test set, 24 items), a 20-item run on `support-faq` v1 and one on `legal-clauses` v1. Numbers in the copy ("130 items", "6 disabled",
"40 of 130 match") come from this seed plus the disabled state the mocks add.

## 1. Summary of what changes where

| Surface | Today (measured) | Specified |
|---|---|---|
| Catalog card | name `truncate`d (150 px at 1440, 61.8 px at 390), one `Badge` "Private test set" (112 x 20) top right | badge cluster `data-testid="da-card-badges"`: "Private test set", "Restricted", "View only"; name wraps; cluster under the title when the card is under 440 px |
| Settings tab | cards General 447 px, Visibility 188 px, Danger zone 196 px high at 760 wide | new "Access" card between Visibility and Danger zone, 388 to 619 px high at 760 wide |
| Dataset page | every member edits | per dataset `can_modify`: viewers get the archived-project experience plus a "View only" badge |
| Items toolbar | 40 px at 1440 (one line), 97 px at 390; search 260 x 24 | adds Metadata button (98 x 24), state control (203 x 24), chips, All matching menu (108 x 24); heights 40 / 65 / 161 default |
| Item pane / page | no state | footer action "Disable item…", banner, page action |
| Version header | "130 items" | "130 items (6 disabled)" |

---

## 2. Feature 1: per-dataset permissions

### 2.1 S1 Catalog card (`catalog/CatalogPage.tsx`, `DatasetCard`)

Current state (`current-catalog-*.png`, `baseline/current.json`): grid 1193 px (1440), 777 (1024), 279 (390); card 388.3 x 198.4 at 1440, 381.5 x 198.4
at 1024, **300 px at 390 inside a 279 px grid (21 px wider than its column, an existing defect the spec does not fix beyond the criteria below)**; the card
name is `Text variant="lg" truncate`: 150.2 px wide at 1440 ("pricing-golden" fits), **61.8 px at 390** (cut); the private badge is `Badge tone="warning"`
112.2 x 20, 10 px / 650. At 390 the title wraps to 50 px in height.

Specified (`mock-catalog-*.png`, case `da-catalog`): the head is a three-area grid (icon, title, badges); the badges form one column of `Badge`es
right aligned; under 440 px of card width they move to a row under the title (container query on `.cardWrap`).

| Id | Element (`data-testid`) | Width | Criterion |
|---|---|---|---|
| A1-1 | `da-card-badges` of a card whose dataset has `access_mode = restricted` | 1440, 1024, 390 | contains a `Badge tone="neutral"` with a 12 px `lock` glyph and the text **Restricted** (`data-testid="restricted-badge"`, 98.7 x 20 measured, 10 px / 650 as every Badge); a private test set that is also restricted shows both, "Private test set" first; a restricted dataset on which the viewer has only view access adds `Badge tone="neutral"` **View only** (91.5 wide on the page header, same size on the card) |
| A1-2 | `da-card-name` | 1440, 1024, 390 | the name is never cut: computed `text-overflow` is not `ellipsis`, `scrollWidth <= clientWidth`; the `truncate` prop is removed. Measured 254.3 px at 1440 frame, 257.5 at 1024, **155 px at 390** (was 61.8) |
| A1-3 | `da-card-head` | 1440, 1024, 390 | cards under 440 px wide (every card at 1440 with 3 columns is 336 to 388 px; every card at 390) lay the cluster in a row below the title: head height 76 px without badges, 96 px with badges at all three widths; cluster width = head width (336.3 / 339.5 / 237) |
| A1-4 | catalog list | 1440 | a dataset on which the viewer has level `none` is not in the list (the API omits it); the topbar counts and the "3 datasets · 2 runs" line count only the datasets returned |

Voice: "Restricted", "View only", "Private test set" (existing). No tooltips: the badge text is the meaning; the Settings page explains it.

### 2.2 S2 Settings tab, Access section (`detail/SettingsTab.tsx`)

Current state (`current-settings-*.png`): `wrap` is a column, max 760 px, gap 14 px: General (447 px high), Visibility (188 px; 260 at 390; only for
`can_set_private_test_set`), Danger zone (196 px; 268 at 390). Each is a `Card as="section"` with a `SectionHeader` (title `--font-xl`; description
`truncate`d on one line, see "General" above it which carries the hairline and ~48 px of top spacing that every section header has).

Specified (`mock-access-*.png`, `mock-access-readonly-*.png`, cases `da-access`, `da-access-readonly`): a new `Card as="section"`
`data-testid="access-section"`, `aria-labelledby` its title, placed **between Visibility and Danger zone** (and between General and Danger zone
for a viewer who has no Visibility card). Contents, in order, all inside one card (no nested card; the table is `DataTable variant="embedded"`):

1. `SectionHeader title="Access"` (no description in the header; the sentence is a separate `Text variant="base" tone="muted"` so it can wrap at 390).
2. The sentence: **Choose who in this project can open and change this dataset.** (read-only: **Only project managers and admins can change who has access.**)
3. `role="radiogroup"` `aria-label="Who can access this dataset"` (`data-testid="access-mode"`), two options (`access-mode-project`, `access-mode-restricted`).
4. Note, `Text variant="sm" tone="muted"`: **Project managers, admins and the creator always have full access.**
5. When restricted: `access-people` (heading "People with access", count, grants table or the empty note, the add row).
6. `access-save-bar`: Save access (primary), Discard (neutral), status text.

| Id | Element | Width | Criterion |
|---|---|---|---|
| A1-5 | `access-section` | 1440, 1024 | 760 px wide (the existing `.wrap` cap), directly after the Visibility card (or General) and before Danger zone; heights in the frame: project mode 388.4, restricted with three people 618.8, restricted with no one 520.3 px |
| A1-6 | `access-section` | 390 | 279 px wide; heights 506.8 (project), 995.7 (three people), 691.3 (no one) |
| A1-7 | `access-mode` | 1440, 1024 | two option rows, each `min-height: var(--row-comfortable)` (52); project row 53.6 px high with its help line on one line; the group is 718 px wide (card content); row padding 8 / 14, 1px `--border-subtle`, `--control-radius`, fill `--bg-elevated`; selected: 1px `--accent-primary` border and a 12% accent tint; the 14 px radio dot is filled `--accent-primary` with a 3 px inset ring |
| A1-8 | `access-mode` | 390 | rows 69 px high (help text wraps to two or three lines), group 237 px wide; no horizontal overflow (`scrollWidth <= clientWidth`) |
| A1-9 | each option | all | title `--font-md` 600 primary; help `--font-sm` muted. Copy verbatim: **Everyone in the project** / **Every member can view and modify this dataset. This is the default.**; **Only people listed below** / **Everyone else in the project cannot open this dataset. Its runs stay listed with item contents hidden.** The group is keyboard reachable: Tab enters on the selected option, Arrow keys move and select, Space selects; `role="radio"`, `aria-checked` |
| A1-10 | restricted option help | all | when the dataset has saved grants and project mode is selected, the restricted option's help appends: **3 saved grants are kept and apply again if you switch back.** (the number is the saved count; singular: "1 saved grant is kept and applies again if you switch back.") |
| A1-11 | `access-grants-table` | 1440, 1024 | columns **Person** 360 px (flex), **Level** 160, **Added by** 150, **Remove** 48 (header text visually hidden, `aria-label` "Remove"); header 34 px (`--table-header-height`); rows 40 px (`--row-regular`); no zebra; no density or column menus (`densityLocked`, no toolbar); the table is 718 px wide |
| A1-12 | Person cell | all | two lines: display name (`--font-base` primary, wraps, `dir="auto"`) over email (`--font-sm` muted, wraps); neither is truncated |
| A1-13 | Level cell | 1440, 1024 | a `SegmentedControl` named `Level for {name}` with options **View** and **Modify**, 24 px high; changing it marks the section dirty |
| A1-14 | Remove cell | 1440, 1024 | `IconButton` `label="Remove {name}"`, icon `close`; removing marks the section dirty; focus moves to the next row's Remove, or to the Add person select when none remains |
| A1-15 | `access-add` | 1440, 1024 | one row, 43.4 px high: `Select` "Add person" (240 px, searchable when more than 8 candidates, items = `candidates` with the email as description, placeholder **Choose a project member**), `SegmentedControl` "Level for the new person" (View default), `Button` **Add person** (neutral, disabled until a person is chosen). Adding appends the row at the end and clears the select |
| A1-16 | `access-add` | 390 | the controls wrap to up to three lines; height 75.4 px; no overflow |
| A1-17 | grants table | 390 | below 640 px the table is a card list (`DataTable` card mode: Person as the card title, Level and Added by under it, Remove at the card's end): each card at most 120 px high; no horizontal scroll; the Level control keeps its full 2-option width |
| A1-18 | candidates | all | the select lists project members who are not managers or admins and not yet granted; when there are none the select is replaced by the muted line **Everyone in the project already has access.** |
| A1-19 | `access-save-bar` | 1440, 1024 | a hairline above (`--border-subtle`), 33 px high: **Save access** (primary), **Discard** (neutral), status text right aligned (`--font-sm` muted, `aria-live="polite"`). Status: **No changes** (both buttons disabled), **Unsaved changes** (enabled), **Saving** (Save shows the spinner, Discard disabled). 56.4 px high at 390 (wraps) |
| A1-20 | save | all | one `PUT /v1/datasets/{ref}/access` with the full state; success toast (tone success) **Access saved**; failure toast (tone error) with the server detail or **Couldn’t save access**; after success the section is clean; a failed save keeps the edits |
| A1-21 | empty restricted list | all | when restricted and no grant is listed, the table is replaced by a note (`access-empty-note`, warning rail): title **No one is listed**, body **Only project managers, admins and the creator can open this dataset.**; saving is allowed. 55.5 px high at 1440, 91.5 at 390 |
| A1-22 | read-only (a person who cannot manage access: `permissions.can_manage_access = false`, or an archived project) | all | no radio, no select, no buttons: a `dl` (`access-summary`, 41.6 px high at 1440, 58.4 at 390) with **Who has access** = "Everyone in the project" or "Only people listed below", and **Your access** = "Modify" or "View"; when restricted the grants table is shown read-only (Level as a `Tag`: "Modify" accent, "View" neutral; no Remove column). The sentence reads **Only project managers and admins can change who has access.** (archived project: **This project is archived.**) |
| A1-23 | loading | all | the section keeps its header and shows `Skeleton kind="lines" rows={5} label="Loading access"` after the 300 ms pending delay; the card's height at the placeholder frame equals the loaded project-mode height, +- 1 px |
| A1-24 | error | all | a failed `GET …/access` shows `ErrorState compact` titled **Couldn’t load access** with Retry (never an empty section, never the default project-mode form) |

### 2.3 S3 Dataset page for a viewer, and the 403 page

Current state: `DatasetDetailPage` takes `readOnly` from the project (`useProjectContext().readOnly`, archived projects). With `readOnly` it hides: the
rename pencil, the "+ Add a description" button, Add item / Import / Publish / Set as production / Create draft, the "Name version…" and "Upload file as
new version…" menu entries, the Items "Add item" buttons and row selection, the Delete row action, the Settings fields (read-only), the Danger zone
button. That is the experience a viewer gets.

Specified (`mock-viewer-*.png`, case `da-viewer`): `readOnly = project.readOnly || !dataset.permissions.can_modify`, passed down to every component
that takes `readOnly` today; no new "disabled" visuals (edit affordances are hidden, not disabled).

| Id | Element | Width | Criterion |
|---|---|---|---|
| A1-25 | `da-viewer-hero` / `view-only-badge` | 1440, 1024, 390 | next to the dataset title a `Badge tone="neutral"` with a 12 px `eye` glyph and the text **View only** (91.5 x 20), followed by a `HelpMarker` labelled "About view only access" whose text is **You can open this dataset but not change it. Ask a project manager for modify access.** Shown only when `permissions.access_level = 'view'`; not shown for an archived project (the project's own notice stays) |
| A1-26 | `da-viewer-actions` | all | contains only the version switcher and the More actions menu; no Add item, Import, Publish, Create draft, Set as production, rename pencil or description button; the More menu keeps Compare and Download, drops "Name version…" and "Upload file as new version…" |
| A1-27 | Items tab for a viewer | 1440, 1024 | the toolbar has no Add item button, no All matching menu, no selection checkboxes (the select column is absent); Metadata filter and the state control stay (read actions); the row actions menu has Open item and Copy as JSON only. Toolbar height 40 at 1440, 65 at 1024 |
| A1-28 | Item pane and item page for a viewer | all | fields are read-only, no footer, no Disable/Enable action, no Save, no Delete; the disabled banner (if any) has no button |
| A1-29 | Settings tab for a viewer | all | General fields read-only (as for an archived project), Visibility checkbox disabled for non-admins as today, Access section read-only (A1-22), Danger zone shows the existing text `DELETE_RULE` unless the viewer is the creator or a manager |
| A1-30 | `da-403` | 1440, 1024, 390 | a dataset the viewer cannot open (`GET /v1/datasets/{ref}` answers 403) renders `ErrorState` (not "not found", never Retry): title **You don’t have access to this dataset**, body **Ask a project manager to add you. Its runs stay listed with item contents hidden.**, meta line `HTTP 403 · You don't have access to this dataset`, one neutral button **Back to datasets** (link to the catalog). Height 189 px at 1440 and 1024, 229 at 390; same for the item URL (`?item=`) and the compare URL of that dataset |
| A1-31 | deep links | all | the browser tab title for that page is **Datasets**; no request other than the failed `GET` is made (no versions, no items) |

### 2.4 S4 Run pages and compare: redacted item contents (`run-detail/components/RunHero.tsx`, `items/ItemCard.tsx`, `compare/components/items/OutputCard.tsx`)

Current state: `run.items_restricted` (private test set, non-admin) shows `RunHero .banner` titled "Private test set" and per-item the line "Item bodies are
visible to admins only on a private test set." The same flag already gates editing scores, traces, analysis.

Specified (`mock-run-redaction-*.png`, case `da-run-redaction`): the same flag now also becomes true when the reader's dataset level is `none`
(design doc D1); the payload carries the cause: `run.items_restricted_reason: "private_test_set" | "dataset_access" | null` (decision A-12).

| Id | Element | Width | Criterion |
|---|---|---|---|
| A1-32 | `restricted-dataset-banner` (reason `dataset_access`) | 1440, 1024, 390 | the existing `.banner` recipe (warning border, `--bg-elevated`), a `lock` icon (14 px), title **Restricted dataset** (`--font-md` 600 primary), body **This run was evaluated on a dataset you don’t have access to. Scores and latencies are shown, but item inputs, expected outputs, outputs, traces, and analysis are hidden.** Height 55.5 at 1440 (one line), 73.5 at 1024, 127.5 at 390 |
| A1-33 | `run-item-redacted` (each item card of such a run) | all | the item bar (number, verdict, metric) stays; the input, expected, output, trace and metric reason blocks are replaced by one line `--font-base` muted: **Hidden: you don’t have access to this dataset’s items.** (reason `private_test_set` keeps today's text) |
| A1-34 | compare `OutputCard` | all | same line replaces the output block; same flag logic as A1-33 |
| A1-35 | runs list, run header, scores | all | unchanged: the run is listed, scores, latencies, status, dataset name and version tag are visible (D1) |
| A1-36 | API | n/a | the run payload and every item-shaped payload for a run whose dataset level is `none` go through `redact_item_content` (extension of `private_test_set_run_ids` to `hidden_dataset_run_ids(db, principal, run_ids)`); verified by A1-57 |

---

## 3. Feature 2: disabled items (draft versions only, owner decision D2)

### 3.1 S6 Items tab: state control, rows, counts (`detail/ItemsTab.tsx`)

Current state (`current-items-*.png`, `baseline/current.json`): the toolbar is the `DataTable.Toolbar`: left search (260 x 24), right the count "130 items" (mono),
Add item, Columns, Density; selection replaces nothing: a "2 selected · Delete 2 · Clear selection" cluster is inserted before the search (275 x 24).
Toolbar height 40 at 1440 and 1024 (one line), **97 at 390**. Rows are 52 px high (two-line input); columns at 1440: select 40, # 64, ID 140, Input 268,
Expected 268, Metadata 180, Runs 70, Latency 93, actions 68; at 1024 Input and Expected are 200. At 390 rows are cards (148 px for the first row).
With the pane open at 1440 the table is 719 px wide and the pane 460 x 700.

Specified (`mock-toolbar-*.png`, case `da-toolbar`):

- `filters` slot: the **Metadata** button (A3) then the **state control**; `chips` slot: label chip then metadata chips; `count` slot: "N items" for the selected state; `trailing`: the **All matching** menu, then Add item.
- The state control is a `SegmentedControl` `label="Item state"` (`data-testid="items-state"`), URL parameter `state` (`active` default, omitted from the URL; `disabled`; `all`), options with the count in mono after the label: **Active 124**, **Disabled 6**, **All 130**.

| Id | Element | Width | Criterion |
|---|---|---|---|
| A2-1 | `items-state` | 1440, 1024, 390 | 24 px high, 202.9 px wide with the default counts; options in order Active, Disabled, All; the selected option has the Qym-green fill and its count stays readable (same colour as the label, `color: inherit`, contrast >= 4.5:1 on the green); the control sits right after the Metadata button on the same line; the count `<span>` is mono tabular |
| A2-2 | `items-state` default | all | opens on **Active**; `?state=` absent; choosing Disabled or All writes `state=disabled` / `state=all` with `replace` and resets `page`; a remembered choice is not stored (the default view is the primary content) |
| A2-3 | counts | all | `Active`, `Disabled`, `All` show the counts for the **current criteria** (search, label, metadata filters) and ignore the state itself, so with the three filters of the mock they read 40 / 2 / 42 and without filters 124 / 6 / 130; they come from the item list response field `counts` (A2-52); `All = Active + Disabled` |
| A2-4 | toolbar height, default | 1440 / 1024 / 390 | one line at 1440: **40 px**; two lines at 1024: **65 px**; **161 px** at 390 (stacked controls); it does not change between loading and loaded |
| A2-5 | toolbar height, filtered | 1440 / 1024 / 390 | three metadata and label chips (chip row 26 px high at 1440 and 1024, 56 at 390 where chips wrap): 67 / 99 / 257 px |
| A2-6 | `count` | all | "124 items" for Active, "6 items" for Disabled, "130 items" for All; with search: "N items matching “q”" (unchanged) |
| A2-7 | disabled row | 1440, 1024 | under Disabled or All a disabled row keeps the row height (52 px, identical to an active row), all cell text uses `--text-muted`, and the ID cell shows the id followed by `Badge tone="neutral"` **Disabled** (20 px high); the row is **never** hidden or dimmed by `opacity` alone (the badge and the muted colour are the cues) |
| A2-8 | ID column | all | the ID column is shown whenever the state control is not Active (width 180 instead of 140, so id and badge fit on one line); under Active it follows today's rule |
| A2-9 | disabled card | 390 | in card mode the card title line shows the index, then the **Disabled** badge; the card body text is `--text-muted` |
| A2-10 | selection | all | disabled rows stay selectable; the selection cluster (A3-23) works on either state |
| A2-11 | empty states | all | Disabled with none: `EmptyState compact` title **No disabled items**, body **Items you disable in a draft appear here.**; an empty filtered result: **No items match these filters** with the button **Clear filters** (clears search, label and metadata, keeps the state) |
| A2-12 | published version | all | the state control and counts are the same; no checkboxes; a disabled item in a published version shows the same muted row and badge |

### 3.2 S7 Item pane and item page (`detail/ItemPane.tsx`, `item/ItemPage.tsx`)

Current state (`current-item-pane-*.png`, `current-item-page-*.png`): the docked pane is 460 x 700 (1440 and 1024), header 41 px (id, position, previous, next, Open page,
close), scroll body of three `FieldEditor`s, footer (draft only) of status text plus Save changes (24 px buttons). The item page header is 50.4 px at 1440, 71.2
at 1024, 168 at 390; its actions are 345.8 x 24 at 1440 (Create draft to edit on published versions; Delete, Previous, Next, Save changes on drafts).

Specified (`mock-item-state-*.png`, case `da-item-state`): state is part of the item payload (`state`, `disabled`).

| Id | Element | Width | Criterion |
|---|---|---|---|
| A2-13 | `da-pane` of an active item on a draft the user can edit | 1440, 1024 | the footer (41 px) shows **Disable item…** (`item-state-action`, neutral, 105 x 24) at the start, then the status text and **Save changes** at the end; pane width stays 460 |
| A2-14 | pane, active item, published version, user can modify | all | footer (41 px) has one button **Create a draft to disable** (`item-state-action`, 161 x 24); pressing it opens the existing create-draft dialog (`CreateDraftDialog`), and after the draft exists the page opens that item in the draft |
| A2-15 | pane, disabled item, draft | all | header shows `Badge tone="neutral"` **Disabled** after the position; the banner (A2-19) sits at the top of the body with a neutral **Enable** button (`enable-item`, 64 x 24) under it; the footer has no state action (the banner owns it); fields render in `--text-muted` |
| A2-16 | pane, disabled item, published version | all | same banner without Enable and with the extra line (A2-19); footer button **Create a draft to enable** (164 x 24) |
| A2-17 | pane, viewer | all | no footer at all, no button; the banner (if disabled) has no button; pane height 193.4 (active) |
| A2-18 | item page header actions | 1440 / 1024 | draft: **Disable item…** (`item-state-action`, 32 px high, `size="md"`) before Delete, Previous, Next, Save changes; published: the existing **Create draft to edit** (accent) followed by **Create a draft to disable** (neutral); actions container 358 px wide (draft) / 507 px (published, disabled) at one line, 32 px high; wraps to 72 to 112 px at 390 |
| A2-19 | `disabled-banner` | all | a note block with the warning rail (3 px `--rail-width`, 6% tint, `--warning`), a 14 px `warning` icon; title (`--font-md` 600 primary) **Disabled by {name} on {date}** (date as `formatDate`, e.g. "Oct 20, 2026"); line 2 **Reason: {reason}** or **No reason given**; on a published version a third line **Runs on this version skip it. Create a draft to change that.** Heights 55.5 (two lines) and 75.5 (three lines) at 460 px; 75 / 113 at 279; the reason wraps (`overflow-wrap: anywhere`), never truncated |
| A2-20 | item page banner | all | the same note above the tabs, full column width (1163 in the frame, 279 at 390), with **Enable** (32 px, `size="md"`) under it on drafts |
| A2-21 | **Enable** | all | one click, no confirmation (reversible); the button shows the spinner while the request runs; success toast **Item faq-003 enabled**; the banner, badge and counts update without a reload |
| A2-22 | disabling a viewed item under the Active filter | all | the pane stays open on that item (now disabled); the list refetches and the row leaves the Active list on the next render; pane "n / total" keeps counting the loaded rows |
| A2-23 | keyboard | all | `Disable item…` is in the Tab order after the last field; `Enter` opens the dialog; `Esc` closes it and focus returns to the button; `Enable` is reachable by Tab as the first control of the body |
| A2-24 | `Item` history tab | all | see S10 |
| A2-25 | read-only text colours | all | the disabled text colour is `--text-muted` (6.3:1 on `--bg-surface`), never `--text-dim` |
| A2-26 | loading | all | the pane and page skeletons are unchanged; the footer button is absent until the item has loaded (no layout shift: footer height 41 px reserved) |
| A2-27 | error | all | a failed enable or disable shows an error toast with the server detail (**Create a draft to change item state** on 409) and leaves the state unchanged |
| A2-28 | item page, viewer / archived | all | no action buttons; banner shown without a button |

### 3.3 S8 Disable item dialog (`Dialog size md` = 440 px; mock `da-disable-dialog`)

| Id | Element | Width | Criterion |
|---|---|---|---|
| A2-29 | `da-modal` | 1440, 1024 | 440 px wide, 279.7 px high (default and saving), 311.7 with an error; at 390 it is 279 px wide (`max-width: 100%`) and 297.7 px high |
| A2-30 | title and body | all | title **Disable item faq-003?** (`--font-md` 600); body **The item stays in this draft but is left out of runs once the draft is published. You can enable it again in any draft.** |
| A2-31 | reason | all | `Textarea` labelled **Reason (optional)**, 3 rows, `dir="auto"`, `maxLength` 500; a counter `reason-counter` (mono, `--font-sm` muted, 52.8 x 14) reads `{n} / 500` and updates on input |
| A2-32 | footer | all | **Cancel** (neutral, focus on open for the destructive-free dialog stays on the Reason field) and **Disable item** (primary, `size="md"`); the primary shows the spinner and Cancel is disabled while saving |
| A2-33 | error | all | the server detail in `--error-text` under the field, `role="alert"`; the dialog stays open |
| A2-34 | success | all | closes, toast **Item faq-003 disabled**, state control counts update |
| A2-35 | selected rows | all | with rows selected the same dialog is titled **Disable 2 items?** with body **They stay in this draft and are left out of runs once it is published. You can enable them again in any draft.** and the primary **Disable 2**; success toast **2 items disabled** |

### 3.4 S9 Version header, version list, download, publish dialog

Current: the page meta line reads "2 versions · 1 run · 130 items · forked from v1 · source: derived · …"; `VersionSwitcher` rows read "130 items · 0 runs · 2m ago".

Specified (`mock-version-meta-*.png`, case `da-version-meta`):

| Id | Element | Width | Criterion |
|---|---|---|---|
| A2-36 | `meta-items` in the page meta line | all | **130 items (6 disabled)** when `version.disabled_count > 0`, else "130 items" (singular/plural as today); "(6 disabled)" is `--text-secondary`; the meta line stays one line at 1440 (16.8 px high) and wraps at 390 (37.6 px) |
| A2-37 | `version-row` in the `VersionSwitcher` | all | `130 items (6 disabled) · 0 runs · 2 min ago`, 55.4 px high row, 360 px wide popover list; no overflow |
| A2-38 | tab count `Items 130` and the topbar stat | all | stay the version's total (`item_count`) |
| A2-39 | `download-menu` | all | the More menu keeps **↓ Download JSONL** (active items only, `include_disabled=false`) and, only when `disabled_count > 0`, adds **↓ Download JSONL with disabled items** (`include_disabled=true`) |
| A2-40 | `publish-disabled-note` | all | the Publish dialog gains, when the draft has disabled items, a note block (info rail): **6 items are disabled. Runs on v2 skip them.** (singular: "1 item is disabled. Runs on v2 skip it."); 34 px high at 398 px wide |
| A2-41 | published header | all | same "(6 disabled)" text |
| A2-42 | catalog card stats | all | "130 items" stays the total (`catalogItemCount`); disabled count is not shown on the card |

### 3.5 S10 Item history and compare

Current: `ItemHistoryTab` lists revisions as a `Badge` (created success, deleted danger, else warning), `#n`, the editor pill and the date, then `FieldDiff`s.
Compare (`DatasetComparePage`) has the tabs Changed / Added / Removed / Unchanged, a summary of four tiles, and `ChangedRow` with a "changed" `Tag`.

Specified (`mock-history-compare-*.png`, case `da-history-compare`):

| Id | Element | Width | Criterion |
|---|---|---|---|
| A2-43 | `rev-disabled`, `rev-enabled` | all | a revision with `change_type` `disabled` shows `Badge tone="warning"` **disabled**; `enabled` shows `Badge tone="success"` **enabled**; then `#n`, the editor pill ("Edited By:") and the date; below, `--font-base` secondary text **Reason: {reason}** or **No reason given**; no `FieldDiff` blocks for these two types; 110.2 px high at 390, 58.8 at 1024 and 1440 |
| A2-44 | "Revert to this" | all | not offered on `disabled`/`enabled` revisions (the Enable button is the inverse) |
| A2-45 | compare summary | 1440, 1024, 390 | the summary strip shows **Added**, **Removed**, **Changed**, **Unchanged** as today and, only when non-zero, **Disabled** and **Enabled** (equal tiles, `flex: 1 1 120px`, label `--font-sm` uppercase muted, value `--font-xl` mono); 60.6 px high at 1440 and 1024, 197.7 at 390 (tiles wrap two per row) |
| A2-46 | `compare-state-row` | all | an item whose only difference is state appears in **Changed** with `Tag tone="warning"` changed, the id (mono) and `state-diff`: the label **state**, `Badge tone="success"` **Active**, an arrow glyph, `Badge tone="neutral"` **Disabled**; a changed item that also changed content shows the state diff in addition to the field diffs |
| A2-47 | lineage tab | all | the per-version change counts line gains "n disabled" and "n enabled" after the existing counts when non-zero |
| A2-48 | keyboard and a11y | all | badges carry text (never colour only); `state-diff` has `aria-label="state changed from Active to Disabled"` |

### 3.6 S11 Backend: item state (design doc 2.1 to 2.3; migration `0087_dataset_access_and_item_state`)

`state` default, payload shapes and the exact strings (every string is verbatim, ASCII apostrophes in server details):

| Id | Request | Criterion |
|---|---|---|
| A2-49 | `GET …/versions/{v}/items` (no `state`) | returns only active items; every item object has `"state": "active"` or `"disabled"` and `"disabled": null` or `{"at": ISO, "by": {"id","email","display_name"}, "reason": str}` |
| A2-50 | `…/items?state=disabled` and `?state=all` | disabled only / both; `total`, `next_offset` follow the filter; an unknown value answers **422** `state must be active, disabled or all` |
| A2-51 | `GET …/items/{item_id}` | always returns the item whatever its state (state and `disabled` included) |
| A2-52 | list response `counts` | `{"counts": {"active": 124, "disabled": 6, "all": 130}}` computed for the current `search`, `label` and `meta` criteria and ignoring `state`; one extra grouped statement, not one per state |
| A2-53 | version payloads (`GET …/versions`, `…/versions/{v}`, items context) | gain `disabled_count` (int, 0 default); `item_count` stays the total; a dataset's `latest_version` and `production_version` carry it too |
| A2-54 | `POST …/items/{item_id}:disable` body `{"reason": "…"}` (optional; max 500) | needs modify; draft only; **200** `{"item": {…state disabled…}, "changed": true}`; reason longer than 500: **422** `Reason must be 500 characters or fewer`; a published version: **409** `Create a draft to change item state`; an unknown item: **404** `Dataset item not found` |
| A2-55 | `POST …/items/{item_id}:enable` | modify, draft only, **200** `{"item": …, "changed": true}`; published: **409** `Create a draft to change item state` |
| A2-56 | idempotence | disabling a disabled item (or enabling an active one) answers **200** with `"changed": false`, writes no revision and no audit row |
| A2-57 | revisions | each effective toggle writes one `DatasetItemRevision` with `change_type` `disabled`/`enabled`, `before` / `after` = `{"disabled": bool, "reason": str}`; `GET /api/datasets/{d}/versions/{v}/items/{id}/revisions` returns them with the actor; the audit action is `dataset.item_disabled` / `dataset.item_enabled` |
| A2-58 | `_copy_items` | a new draft copies `disabled_at`, `disabled_by_user_id`, `disabled_reason` from its parent; enabling in the draft does not change the parent |
| A2-59 | published versions | all item-write routes keep answering **409** `Only draft dataset versions can be edited`; the state routes use their own text (A2-54); `items:bulk` upserts keep the flag of an existing row and create new rows active; the flag is not a field of the item PATCH body |
| A2-60 | hashes | the flag is excluded from `fingerprint` and `search_text`; `content_hash` includes it, so publishing two drafts that differ only in disabled items yields different hashes |
| A2-61 | download | `GET …:download` omits disabled items unless `include_disabled=true`; the JSONL lines carry no extra field in either case |
| A2-62 | SDK path | a request without `state` (the SDK today) gets active items only; no SDK change is needed |
| A2-63 | compare | `GET …:compare` `changed` entries gain a pseudo-field `{"field": "state", "before": "active", "after": "disabled"}` in `field_diffs` and the summary gains `disabled`, `enabled` integers; unchanged items whose state differs move to `changed` |
| A2-64 | lineage | `change_counts` gains `disabled` and `enabled` |
| A2-65 | permissions | disable/enable need level `modify` (403 `You can view this dataset but not change it` for `view`); an API key needs `datasets:write` |
| A2-66 | migration | `0087` adds `dataset_items.disabled_at DATETIME NULL`, `disabled_by_user_id VARCHAR(36) NULL`, `disabled_reason VARCHAR(500) NOT NULL DEFAULT ''`, index `ix_dataset_items_version_disabled (dataset_version_id, disabled_at)`; constant defaults only (quick DDL); `downgrade()` drops them |

---

## 4. Feature 3: batch edit by metadata (dotted paths up to 3 levels, owner decision D7)

### 4.1 S12 Metadata filter popover and chips (`detail/ItemsTab.tsx`, new `detail/MetadataFilter.tsx`)

Specified (`mock-meta-popover-*.png`, `mock-toolbar-*.png`, cases `da-meta-popover`, `da-toolbar`). The toolbar's `filters` slot holds the
**Metadata** button (`metadata-filter`, `Button size="sm"` with a 12 px `plus` icon, 98 x 24) which opens a `Popover` (`placement="bottom start"`, label "Filter by metadata").

| Id | Element | Width | Criterion |
|---|---|---|---|
| A3-1 | `metadata-filter` | all | 98 x 24; appears for every user who can see items (also viewers); hidden for a private test set a user cannot read |
| A3-2 | `meta-popover` | 1440, 1024 | 320 px wide, padding 14, gap 14, `--bg-elevated`, 1px `--border-default`, `--shadow-popover`, radius `--dropdown-radius`; loaded 310.3 px high, truncated variant 355.1 |
| A3-3 | `meta-popover` | 390 | 279 px wide (max-width 100% of the viewport minus gutters); heights 310.3 / 355.1 |
| A3-4 | key | all | a `Select` labelled **Key** listing every dotted path from the facets response (e.g. `domain`, `difficulty`, `source.channel`, `source.region.code`), each with a description "4 values"; searchable; paths are shown as written (never uppercased, never cut) |
| A3-5 | values | all | a list (`facet-values`, 290 px wide, max 320 px high, scrolls) of the values of the chosen key, each row `--dropdown-option-height` (32) with the value and its count (mono, muted) at the end; the selected value uses `--bg-selected`; `aria-label` **Values of {key}**; keyboard: Up/Down, Enter selects |
| A3-6 | footer | all | **Cancel** (ghost, sm) and **Add filter** (primary, sm, disabled until a value is chosen); adding closes the popover and focuses the new chip |
| A3-7 | applied filter chips | 1440, 1024 | `Chip isSelected` with remove: text **{path}: {value}** (e.g. "domain: finance", "source.region.code: sa"), 26 px high, after the label chip, in a wrapping row (`filter-chips`: 26 px at one line, 429 px wide for the three of the mock); remove label **Remove filter {path}: {value}** |
| A3-8 | chips | 390 | wrap to as many rows as needed: 56 px for the three chips, no overflow, chip text never cut |
| A3-9 | URL | all | each filter is `meta=path:value` (repeatable) in the URL; removing a chip removes only its parameter and resets `page` and the row selection |
| A3-10 | limits | all | at most **5** metadata filters; at five the Metadata button is disabled with the tooltip **You can combine up to 5 metadata filters.**; two filters on the same path replace each other |
| A3-11 | loading | all | while `GET …:metadata-facets` runs the popover shows `Skeleton kind="lines" rows={4} label="Loading metadata keys"` (133.5 px high popover); the request starts when the popover opens and is cached for 60 s per version (a refetch happens after any item write) |
| A3-12 | empty | all | no scalar metadata in the version: `EmptyState compact`, title **No metadata keys**, body **Items in this version have no metadata fields to filter on.** (167.1 px) |
| A3-13 | error | all | `ErrorState compact` titled **Couldn’t load metadata keys** with Retry (174.5 px) |
| A3-14 | truncated | all | when a path has more than 200 values (`truncated: true`) the list shows the 200 most common and the line (`facet-truncated`, `--font-sm` muted) **Showing the 200 most common values of 340. Type to search.**; typing a value that is not listed and pressing Enter applies it as an exact match |

### 4.2 S13 "All matching" menu and selected-rows actions

Specified (`mock-toolbar-*.png`, `mock-menus-*.png`). The menu exists only when at least one **criterion** is active (search, label, metadata filter or selected ids; the state control alone is not a criterion).

| Id | Element | Width | Criterion |
|---|---|---|---|
| A3-15 | `all-matching` (draft, editable) | all | `DropdownMenu` trigger, neutral sm button **All matching** with a 12 px chevron, 108 x 24, in the toolbar's trailing cluster before Add item; label "Actions on all matching items" |
| A3-16 | menu items | all | **Disable all 40 matching…**, **Enable all 2 matching…**, separator, **Delete all 42 matching…** (danger text). Numbers are the `counts` of the current criteria: Disable uses `counts.active`, Enable `counts.disabled`, Delete `counts.all`. A zero count renders the item disabled (muted) with the text unchanged ("Enable all 0 matching…") |
| A3-17 | menu panel | all | `--dropdown-width` 240 px, items `--dropdown-option-height` 32 min, 7 px radius; same recipe as `DropdownMenu` |
| A3-18 | published version | all | in place of the trigger one neutral sm button **Create a draft to edit items** (`batch-published-entry`, 179 x 24) which opens the existing create-draft dialog; no menu |
| A3-19 | viewer / archived | all | neither the menu nor the button is rendered |
| A3-20 | no criterion | all | the menu is not rendered (no filter, no search, nothing selected); the user is told nothing: the Metadata button and the search field are the way in |
| A3-21 | selection cluster | 1440 | with rows selected the selection cluster (before the search) reads **2 selected**, **Disable 2…** (neutral sm), **Enable 2** (neutral sm), **Delete 2** (danger sm), **Clear selection** (ghost); the toolbar becomes 99 px (cluster row 32 plus the filtered row) in the filtered example, 131 at 1024, 321 at 390 |
| A3-22 | **Disable 2…** | all | opens the Disable dialog with a count (A2-35); **Enable 2** applies at once (reversible) with toast **2 items enabled** |
| A3-23 | selection across states | all | selecting disabled rows and pressing **Disable 2…** is allowed and reports "0 changed" (A3-52 `affected`): toast **No change: the 2 items were already disabled** |
| A3-24 | select all matching | all | the existing "Select all N matching" banner keeps working and now respects `state`, `search`, `label` and `meta`; it is capped by `fetchMatchingItemIds` as today |
| A3-25 | focus | all | after a menu item closes the menu, focus moves into the dialog; on close it returns to **All matching** |
| A3-26 | counts while filtering | all | changing a filter refreshes the menu numbers and the state control counts within one list response; no separate request |

### 4.3 S14 Batch confirm dialog (`Dialog size lg` = 600 px; mock `da-batch-dialog`)

The dialog opens in the **checking** state and sends the dry run (`dry_run: true`) at once; the confirm button stays disabled until it answers.

| Id | Element | Width | Criterion |
|---|---|---|---|
| A3-27 | `da-modal` | 1440, 1024 | 600 px wide; heights in the frame: checking 198.2, disable 371.1 (with reason), enable 246.6; at 390 the dialog is 279 px wide |
| A3-28 | checking | all | title **Checking matching items…**, `Skeleton kind="lines" rows={4}`, primary button disabled with the final label's width; the footer height is the final height |
| A3-29 | `batch-numbers` | all | the affected count in `--font-stat`-class mono (26 px, 700, tabular) followed by one sentence in `--font-base` secondary: **{affected} of {total} items match {filters}{suffix}.** `{filters}` = "domain: finance, source.region.code: sa" (the chips joined by a comma and a space; search as `search “text”`, label as `label: x`); `{suffix}` = " and are active" (disable), " and are disabled" (enable), none (delete). Example: "40 of 130 items match domain: finance, source.region.code: sa and are active." (39 px high, 558 px wide at 1440; 70 px at 390 where it wraps) |
| A3-30 | `batch-ids` | all | label **First items** (`--font-sm` 650 muted) over up to 5 `Tag kind="data"` ids (the first 5 of `sample_item_ids`), then **and {n} more** (muted) when `affected` is larger; for 2 affected items only 2 tags and no "and … more" (never a negative number); 20 px high at 1440, 44 at 390 |
| A3-31 | disable | all | title **Disable {n} items?**; **Reason (optional)** `Textarea` (2 rows, 500 max, counter `{k} / 500`); line **The items stay in this draft and are left out of runs once it is published.**; primary **Disable {n}** |
| A3-32 | enable | all | title **Enable {n} items?**; line **The items are included in runs again once this draft is published.**; primary **Enable {n}**; no reason field |
| A3-33 | delete up to 50 | all | title **Delete {n} items?**; danger note (3 px `--error` rail, 6% tint, `warning` icon): title **This removes the items from this draft**, body **Published versions keep their copy.**; primary danger **Delete {n}**; focus starts on **Cancel** (destructive confirm rule) |
| A3-34 | delete over 50 | all | adds `TextField` labelled **Type {n} to confirm** (mono, placeholder `{n}`, 44.5 px high at 558 px wide); the danger button stays disabled until the trimmed text equals the number; Enter in the field confirms only when it matches; mismatch text **The text does not match.** |
| A3-35 | applying | all | the primary shows the spinner, Cancel is disabled, the dialog cannot be closed with Esc or the backdrop while the request runs |
| A3-36 | success | all | dialog closes; toast (success) **Disabled 40 items** / **Enabled 2 items** / **Deleted 120 items** (singular "1 item"); the list, counts, facets and `disabled_count` refetch; an open pane whose item was deleted closes (existing `onDeleted` rule); selection clears |
| A3-37 | count changed | all | when the apply answers **409** `The matching items changed. Review the new count and try again.` the dialog shows that line in `--error-text` (`batch-changed`, `role="alert"`), its primary becomes **Review again** (re-runs the dry run) and nothing was written |
| A3-38 | dry-run error | all | **Couldn’t check the matching items. Try again.** in `--error-text` with an accent **Retry** button (32 px); the primary is disabled |
| A3-39 | other errors | all | any other apply error: the server detail in `--error-text`, the dialog stays open, primary re-enabled |
| A3-40 | zero | all | a dry run with `affected = 0` is not shown as a dialog: toast (info) **No items to change** and the menu entry was already disabled (A3-16); this only happens when counts were stale |
| A3-41 | selected ids | all | for selected rows the dialog states **{k} of {k} selected items** in place of the filter sentence and uses `filter.item_ids` |
| A3-42 | a11y | all | `role="dialog"` (alertdialog for delete), title as its label, focus moved in, Tab trapped, Esc closes unless applying, focus returns to the trigger (the existing `Dialog`) |

### 4.4 S15 Backend: `meta=`, facets, `items:batch` (design doc 3.1)

| Id | Request | Criterion |
|---|---|---|
| A3-43 | `GET …/items?meta=domain:finance` and `:download?meta=…` | repeatable, AND across parameters; split on the **first** colon (the value may contain colons); exact match on scalar leaf values; numbers and booleans match their JSON text (`meta=difficulty:2`, `meta=flag:true`); the same `meta` applies to `counts` and `total` |
| A3-44 | dotted paths | `source.region.code:sa` walks nested objects (`json_extract` on SQLite, `#>>` on Postgres); a path through a non-object, or a missing key, matches nothing (no error) |
| A3-45 | validation | a `meta` without a colon: **422** `meta must look like path:value`; a path with more than 3 levels, an empty segment or a character outside `[A-Za-z0-9_-]`: **422** `Metadata path must be dotted keys of at most 3 levels`; more than 5 `meta` parameters: **422** `Use at most 5 metadata filters` |
| A3-46 | `GET …/items:metadata-facets` | `{"paths": [{"path": "domain", "values": [{"value": "finance", "count": 42}], "truncated": false, "value_count": 4}], "truncated": false}`; every scalar leaf path to depth 3, at most 100 paths (top-level `truncated: true` when more) and 200 values per path (path-level `truncated: true` with `value_count` the true number), values as strings, ordered by count descending then value; arrays and deeper levels are skipped; needs `view` and item visibility; cached 60 s per version and invalidated by any item write; at most 1 scan of the `metadata` column |
| A3-47 | `POST …/items:batch` body | `{"filter": {"search": str?, "label": str?, "meta": {path: value}?, "item_ids": [str]? (max 1000), "state": "active"\|"disabled"\|"all" (default "all")}, "action": "disable"\|"enable"\|"delete", "reason": str?, "dry_run": bool (default **true**), "expected_affected": int?}` |
| A3-48 | response | `{"matched": 42, "affected": 40, "sample_item_ids": ["faq-001", …20 max], "version_status": "draft", "dry_run": true}`; `matched` counts items passing the filter (including `state`), `affected` the rows the action changes (disable ignores already disabled, enable ignores active, delete = matched) |
| A3-49 | dry run | writes nothing (no revision, no audit, no `updated_at` change); published versions answer 409 for every call, the dry run included (A3-52) |
| A3-50 | apply | `dry_run: false` performs one set-based `UPDATE` (disable/enable) or `DELETE`, one `DatasetItemRevision` row per changed item (bulk insert), one version-row write, one audit entry `dataset.items_batch` with `{filter, action, matched, affected}`; the whole call is one transaction |
| A3-51 | empty criteria | a filter with no `search`, `label`, `meta` or `item_ids` (state alone does not count): **422** `Add a search, label, metadata or item filter before a batch edit` |
| A3-52 | published | **409** `Create a draft to edit items` for every action and for the dry run; checked before the 422s below |
| A3-53 | nothing matches | `matched = 0`: **422** `No items match this filter` (dry run and apply) |
| A3-54 | `expected_affected` | when present and different from the computed `affected` on apply: **409** `The matching items changed. Review the new count and try again.` and nothing is written |
| A3-55 | validation | `action` outside the three: **422** `action must be disable, enable or delete`; `reason` over 500: **422** `Reason must be 500 characters or fewer`; reason with `enable`/`delete` is ignored |
| A3-56 | permissions | needs level `modify` (403 `You can view this dataset but not change it`), scope `datasets:write` for keys |
| A3-57 | visibility | a private test set a caller cannot read answers the private-test-set 403 (same as item reads) |
| A3-58 | delete | removes the items of the draft (cascading the item revisions as `deleted` rows, the same as `items:bulk` deletes); the version `item_count` is recomputed |
| A3-59 | performance | a batch of 5,000 matching items runs in a constant number of statements (no per-item queries); the dry run and the apply on a 5,000-item version each finish in under 1 s on SQLite |
| A3-60 | `item_ids` | ids that do not exist are ignored and reported: `missing_item_ids` (up to 20) in the response |
| A3-61 | search and label | `search` and `label` have the exact semantics of the list endpoint |
| A3-62 | counts | `counts` (A2-52) respects `meta` and `item_ids` is not a list parameter |
| A3-63 | audit | the entry appears in the dataset history with the filter and counts |
| A3-64 | 5 filters | the batch `meta` object has at most 5 keys (same 422 text as A3-45) |

---

## 5. Feature 1 backend (S5): the access model and routes (design doc 1.2 to 1.4; migration `0087`)

Exact strings: **403** `You don't have access to this dataset` (level `none`), **403** `You can view this dataset but not change it` (level `view` on a modify route),
**403** `Only project managers and admins can change dataset access` (access PUT without manage).

| Id | Request | Criterion |
|---|---|---|
| A1-37 | `GET /v1/datasets/{ref}/access?project_slug=` | needs `view`; **200** `{"access_mode": "project"\|"restricted", "grants": [{"user": {"id","name","email"}, "level": "view"\|"modify", "granted_by": {"id","name","email"}\|null, "created_at": ISO}], "can_manage_access": bool, "candidates": [{"id","name","email"}], "your_level": "view"\|"modify"\|"manage"}`; `grants` are visible to every person who can view the dataset; `candidates` only when `can_manage_access`, else `[]` |
| A1-38 | grants order | by `created_at` ascending, then name |
| A1-39 | `PUT /v1/datasets/{ref}/access` body `{"access_mode": …, "grants": [{"user_id","level"}]}` | full replace; needs `manage` else **403** (text above); **200** returns the GET payload; the grants of a `project` dataset are stored and kept (they apply again if the mode is switched back) |
| A1-40 | PUT validation | unknown `access_mode`: **422** `access_mode must be project or restricted`; unknown level: **422** `level must be view or modify`; duplicate user: **422** `Duplicate grant for user {user_id}`; a user who is not an active member of the dataset's project: **422** `User {user_id} is not an active member of this project`; managers and admins in `grants` are accepted and ignored in effect |
| A1-41 | audit | `dataset.access_changed` with `before` / `after` = `{access_mode, grants: [{user_id, level}]}`; visible in the dataset history |
| A1-42 | `dataset_access_level` | `none` / `view` / `modify` / `manage` exactly as the table in design doc 1.3: admins and project managers `manage`; the creator `modify` (delete as today); a member with a grant the grant's level; a member without a grant `modify` in `project` mode and `none` in `restricted` mode; an API key the key owner's level (scopes still apply); a dataset read token lifts `none` to `view` for item reads of its project only |
| A1-43 | catalog `GET /v1/datasets` | omits datasets with level `none` (one grants query for the page, no N+1: statement count equal at 3 and 30 datasets); every payload carries `access_mode` and `grant_count` (0 for `project` mode datasets) |
| A1-44 | detail and sub-routes | every dataset route resolves through `_get_dataset` and answers 403 for `none` (detail, versions, items, runs, lineage, compare, download, neighbors, revisions, aliases) |
| A1-45 | `permissions` object | `_dataset_payload.permissions` gains `access_level`, `can_view_items`, `can_modify`, `can_manage_access` (booleans except `access_level`); existing keys unchanged; `can_modify` is false for `view` |
| A1-46 | writes | routes that write items, versions, aliases other than `production`, name, description, tags, publish, bulk, batch need `modify` (403 `You can view this dataset but not change it`); slug rename, `production` alias, restore, delete and access need `manage` (existing manager-only texts stay for those that have them) |
| A1-47 | creation | creating a dataset sets `access_mode = 'project'`; the creator is not added as a grant (the creator rule covers them) |
| A1-48 | private test set | stays orthogonal: a viewer of a private test set still gets the private-test-set 403 on item reads |
| A1-49 | cross project | a user of another project gets the existing project access error, never the dataset 403 |
| A1-50 | runs | `GET /v1/runs`, run detail and compare payloads of a run on a dataset with level `none`: the run is listed and scored; item-shaped content is redacted (`hidden_dataset_run_ids`); `items_restricted` is true and `items_restricted_reason` is `"dataset_access"` (`"private_test_set"` when the cause is the private flag; private wins when both) |
| A1-51 | experiments and launch | no gate (owner decision D3): launching on a restricted dataset by any member is allowed; the dataset picker lists every dataset of the project (WP-B shows the chip) |
| A1-52 | default | every existing dataset migrates to `access_mode = 'project'`; no behaviour change for any existing user |
| A1-53 | migration | `0087` adds `datasets.access_mode VARCHAR(16) NOT NULL DEFAULT 'project'` and table `dataset_grants(id, dataset_id FK CASCADE indexed, user_id FK CASCADE indexed, level VARCHAR(16) NOT NULL, granted_by_user_id FK SET NULL, created_at, updated_at, UNIQUE(dataset_id, user_id))` |
| A1-54 | dataset deletion and restore | grants are kept on soft delete and restore; hard FK cascade only |
| A1-55 | member removal | removing a user from the project makes their grants inert (the level function requires an active membership); they are deleted lazily on the next PUT |
| A1-56 | slugs | the 403 for `none` does not reveal anything beyond the dataset's existence (design doc: slugs are not secret inside a project) |
| A1-57 | redaction test | for a user with level `none`: item reads 403; run item payloads contain no `input`, `expected_output`, `output`, trace or reason text (JSON scan) |
| A1-58 | list queries | the catalog, dashboard dataset pickers and the runs filters that list datasets use the same visibility rule |
| A1-59 | read token | a request with a valid dataset read token and an API key reads items of a restricted dataset of the key's project (and not of another project) |
| A1-60 | audit rows | `dataset.access_changed` rows list the actor, dataset id and counts; no grant emails in the audit `after` beyond user ids |

---

## 6. Loading, empty, error, read-only and mobile coverage (cross-check)

| State | Criteria |
|---|---|
| Loading | A1-23, A2-26, A3-11, A3-28 |
| Empty | A1-18, A1-21, A2-11, A3-12, A3-20 |
| Error | A1-24, A1-30, A2-27, A3-13, A3-37 to A3-39 |
| Read-only / viewer | A1-22, A1-25 to A1-29, A2-17, A2-28, A3-19 |
| Permission denied | A1-30, A1-31, A1-44 |
| Mobile (390) | A1-6, A1-8, A1-16, A1-17, A2-9, A3-3, A3-8 |
| Keyboard | A1-9, A2-23, A3-5, A3-25, A3-42 |

## 7. Voice and copy checklist

Short sentences, no exclamation marks, numbers in the sentence, typographic apostrophes in the UI (’), ASCII in server details. Labels: Access, Restricted,
View only, Active, Disabled, All, Metadata, All matching, Disable item…, Enable, Save access, Discard, Add person. Dialog titles end with a question mark and
state the number. Toasts name the count ("Disabled 40 items").

---

## 8. Decisions (what the design doc left open; reverse by editing the named place)

| Id | Decision | Reason | How to reverse |
|---|---|---|---|
| A-1 | The access mode is a radio group, built as a new `RadioGroup` primitive (`ui/RadioGroup`, React Aria `RadioGroup`/`Radio`, recipe `.option` in the mock CSS) | the two choices need a sentence each; a `SegmentedControl` of 24 px cannot carry them at 279 px; the repo has no radio primitive | swap for `SegmentedControl` with the helper text underneath |
| A-2 | "Restricted", "View only" and "Disabled" are `Badge tone="neutral"`, not `Chip` as the design doc writes | DESIGN_LANGUAGE 3.3: a `Chip` is an interactive filter, passive labels are `Badge`/`Tag`; neutral keeps the hue budget (warning stays the draft/private colour) | change the tone prop |
| A-3 | Grants are visible (read-only) to everyone who can view the dataset; only managers get `candidates` and edit controls | a viewer who must "ask a project manager" should see who has modify; project members already see each other | return `grants: []` for non-managers in A1-37 and hide the table in A1-22 |
| A-4 | Switching to "Everyone in the project" keeps saved grants and the PUT stores them | avoids losing a list by a misclick; the option help says so | PUT clears grants when the mode is `project` |
| A-5 | The Access section has its own Save access / Discard bar (one PUT) | the General card's Save changes patches name, description and tags; mixing the two requests hides which one failed | merge into the General save |
| A-6 | The state counts live in the labels of the state control; the toolbar count line shows only the selected state's total | a 24 px toolbar at 1440 has no room for a second count line (sum of controls 1,150 px of 1,177); the numbers stay visible at rest | add a second count line when the table is under 1,100 px |
| A-7 | The ID column is always on when the state is not Active (width 180) | the Disabled badge needs a cell; the `#` cell is 64 px | put the badge in the Input cell |
| A-8 | The disable action lives in the pane footer and in the item page header; the banner owns Enable | the pane header has no room (460 px: id, position, four icon buttons); footers exist already for drafts | move to a 32 px row under the pane header |
| A-9 | Selected rows get Disable 2… / Enable 2 in the selection bar, implemented as `items:batch` with `filter.item_ids` (max 1000) | the design only describes filter batches; without it a hand picked set could not be disabled | remove the two buttons and the `item_ids` filter key |
| A-10 | `dry_run` defaults to **true**; apply needs `"dry_run": false` | an omitted flag must never delete data | default false |
| A-11 | `expected_affected` (optional) makes the apply fail with 409 when the count moved since the dry run | the dialog showed a number; applying a different number would be a surprise | drop A3-54 |
| A-12 | `items_restricted_reason` on runs: `private_test_set` or `dataset_access` | the banner text differs; one boolean could not choose | one text for both |
| A-13 | The batch `state` filter key is sent per action (disable: active, enable: disabled, delete: all); `counts` on the list response feed the menu numbers | numbers in the menu and the dialog agree with the table | compute counts with a second request |
| A-14 | Disabling a disabled item (and enabling an active one) is a 200 with `changed: false` | idempotent retries and double clicks | answer 409 |
| A-15 | Compare shows state as a pseudo-field `state` in `field_diffs` plus summary tiles Disabled and Enabled | one existing diff mechanism; the owner asked for a separate state column | add a dedicated column to the compare payload |
| A-16 | The "Disabled by…" note is a dataset-local block (rail + tint, the ConfirmDialog `.warning` recipe) and does not import WP-B's launch `Callout` | WP-B changes the launch Callout in parallel; no shared edit | promote to `ui/Callout` after both merge |
| A-17 | The Access description is a separate `Text`, not the `SectionHeader` description | the header description is `truncate`d and the sentence must stay readable at 279 px | add a `wrapDescription` prop to `SectionHeader` |
| A-18 | At most 5 metadata filters; keys limited to `[A-Za-z0-9_-]` | bounds the SQL and the URL; keys with dots or spaces cannot be addressed by a dotted path | lift in `_parse_meta` |
| A-19 | The facets response has a top-level `truncated` (more than 100 paths) in addition to the per-path flag | the Select needs to say the list is partial | omit |
| A-20 | The 403 page is `ErrorState` with a Back button, not a redirect | D1 says datasets are discoverable; the message tells who to ask | redirect to the catalog with a toast |
| A-21 | Dialog widths: Disable item 440 (md), batch confirm 600 (lg) | the batch dialog carries numbers, ids and a reason; 600 keeps the ids on one line | use md and let ids wrap |
| A-22 | Only the catalog card and the dataset page show "View only"; run pages never do | the run page is about a run, not the reader's edit rights | none |

## 9. Test plan

| File | Covers |
|---|---|
| `tests/platform/test_dataset_access.py` | A1-37 to A1-60 (levels table for every principal kind, catalog filtering and statement count at 3 and 30 datasets, 403 texts, PUT validation and audit, grants kept in project mode, API key and read token cases, run redaction JSON scan, private test set orthogonality, cross project) |
| `tests/platform/test_dataset_item_state.py` | A2-49 to A2-66 (default `active`, `state` values and 422, `counts`, `disabled_count`, disable/enable and 409/422 texts, idempotence, revisions and audit, copy into the next draft, `content_hash` difference, download, compare pseudo-field, lineage counts, migration up and down on SQLite) |
| `tests/platform/test_dataset_items_batch.py` | A3-43 to A3-64 (`meta` parsing and nested paths on SQLite and, with `QYM_TEST_POSTGRES_URL`, Postgres; facets payload and cache invalidation; batch dry run, apply, 409 and 422 texts, `expected_affected`, 5,000 item statement count) |
| `frontend/src/features/datasets/lib/__tests__/metaFilter.test.ts` | A3-9, A3-10, A3-45 client side (URL parse and serialise, dotted path validation, chip label text, five filter cap) |
| `frontend/src/features/datasets/lib/__tests__/itemState.test.ts` | A2-2, A2-3, A2-36, A2-40 (state URL default, count labels, "(6 disabled)" text, singular and plural) |
| `frontend/src/features/datasets/lib/__tests__/batchCopy.test.ts` | A3-29 to A3-34 (sentence builder, id list with "and n more" never negative, typed-confirmation rule over 50) |
| `frontend/src/features/datasets/detail/__tests__/AccessSection.test.tsx` | A1-7 to A1-24 (modes, dirty and saving states, read-only summary, empty note, loading and error) with Testing Library and axe |
| `frontend/e2e/datasets/access.spec.ts` | A1-1 to A1-4, A1-5 to A1-31 in the browser at 1440 and 390 with two seeded users (a manager and a non-admin member; the spec creates the second user through the admin API and sends `X-User-Email`): measures the numbers of A1-5 to A1-8, A1-11, A1-25, A1-30, axe on Settings, 403 page, run placeholder (A1-32 to A1-34) |
| `frontend/e2e/datasets/item-state-batch.spec.ts` | A2-1 to A2-48 and A3-1 to A3-42 (state control and counts, disabled row, pane footer and banner, dialogs, version meta, history, compare, metadata popover, All matching, batch dry run and apply, published replacement entry, mobile toolbar heights 161 / 257, keyboard paths) |
| `frontend/src/features/dev/__tests__` (existing gallery smoke, if any) | the mock renders |

Every spec asserts the number of its criterion on the named element (`data-testid`); an amendment changes the number here and in the test together (DESIGN_LANGUAGE 6).

## 10. Hand-off (build order)

1. **Backend model and migration** (`packages/platform/qym_platform/db/models.py`, `migrations/versions/0087_dataset_access_and_item_state.py`, `down_revision = "0086"`; WP-B's `0088` will use `down_revision = "0087"`): `Dataset.access_mode`, `DatasetGrant`, `DatasetItem.disabled_at/by/reason`, index. Keep `frontend/scripts/dev_db.py` working (ORM metadata).
2. **`permissions.py`**: `dataset_access_level`, `require_dataset_access`, `hidden_dataset_run_ids` (extend `private_test_set_run_ids`). **`api/datasets.py`**: `_get_dataset` returns 403 for `none`; every write route uses `_require_dataset_access(level)`; `_dataset_permissions`, `_dataset_payloads` (one grants query), catalog filter; `GET/PUT …/access`; audit.
3. **Item state** in `api/datasets.py`: `_filtered_items_query(state, meta)`, `counts`, `_item_payload.state/disabled`, `:disable`, `:enable`, `_copy_items`, hashes, download, compare, lineage, revisions.
4. **Batch**: `services/dataset_meta.py` (parse `meta`, dialect expressions, facets with the 60 s cache), `items:metadata-facets`, `items:batch`.
5. **Run payloads**: `items_restricted_reason` in `api/runs.py` and the run, compare and item serialisers that use `redact_item_content`.
6. **SDK**: `platform/client.py` and `core/dataset.py` pass `state=active`; local viewer text "n disabled items skipped" (design doc 2.2).
7. **API client** (`frontend/src/api/datasets.ts`): types `access_mode`, `grant_count`, `permissions.*`, `state`, `disabled`, `counts`, `disabled_count`, `items_restricted_reason`; hooks `useDatasetAccess`, `useSaveDatasetAccess`, `useMetadataFacets`, `useDisableItem`, `useEnableItem`, `useItemsBatch`; extend `useDatasetItems`/`fetchMatchingItemIds` with `state` and `meta`.
8. **UI primitives**: `ui/RadioGroup` (recipe `.option`, `.dot` from the mock CSS; first CSS line names the recipe; gallery entry).
9. **Frontend files**: `catalog/CatalogPage.tsx` (badge cluster, name wrap), `detail/SettingsTab.tsx` + new `detail/AccessSection.tsx`, `detail/DatasetDetailPage.tsx` (`readOnly` per dataset, View only badge, meta line, 403), `detail/ItemsTab.tsx` (+ new `MetadataFilter.tsx`, state control, chips, All matching, disabled rows), `detail/ItemsWorkspace.tsx` (selection actions, batch dialog), `detail/ItemPane.tsx`, `item/ItemPage.tsx`, `item/ItemHistoryTab.tsx`, `components/VersionSwitcher.tsx`, `components/dialogs.tsx` (PublishDialog note, DisableItemDialog, BatchDialog), `compare/DatasetComparePage.tsx`, run pages (`RunHero.tsx`, `ItemCard.tsx`, compare `OutputCard.tsx`), `lib/route.ts` (`state`, `meta` params), `lib/metaFilter.ts`, `lib/versions.ts`.
10. **Docs**: `docs/USER_GUIDE.md` (datasets: access, disabled items, batch edits), `docs/internal/DB_SCHEMA.md`, the SDK README note on `state=active`.
11. **Gate**: `scripts/heavy.sh --cost 3 -- npm run check`, `pytest tests/platform/test_design_language.py`, the three new pytest files in a `heavy.sh --cost 4` chunk, the two Playwright specs (`--workers 1` each), then the criterion -> change -> test table and after screenshots at the same names (`after-*.png`).

Known limitations (documented, not fixed here): the 21 px overflow of the catalog card at 390 (existing); the `SectionHeader` top spacing above "Access" is the existing section-header recipe; the interactive popover and menus are static panels in the gallery (the real `Popover` and `DropdownMenu` portals are not opened there).


## 11. Amendments made while implementing (measured in the product; the e2e asserts these numbers)

| Id | Spec number | Amended to | Reason |
|---|---|---|---|
| A1-5 / A1-6 | project mode 388.4 / 506.8 px | 388.4 / 506.8 with saved grants kept; **373.0 / 476.0** with none | the mock always had three saved grants, which add the second help line "3 saved grants are kept…" (15.4 px, 30.8 px at 390) |
| A1-23 | placeholder equals the loaded height +-1 px | met with a reserved frame (191.5 px, 276.5 px at 390) | amendment-free; recorded because the frame heights are literal |
| A1-22 | summary 41.6 / 58.4 | met (the summary keeps two columns at 390) | the mock's container query never applied |
| A3-3 | popover 279 px at 390 | **320 px** at every width | the popover fits the 390 px viewport; 279 was the gallery frame |
| A3-17 | menu panel 240 px | **content sized (178 px)** | `DropdownMenu` sizes to its items; the primitive has no width prop |
| A2-5 | filtered toolbar at 390: 257 px | **225 px** (1440: 67, 1024: 99 unchanged) | the real trailing cluster wraps one row less than the mock frame |
| A3-10 | the Metadata button is disabled at five filters | reads disabled (`data-limit`, muted fill) but stays focusable | a natively disabled button gets no tooltip; the hint shows on focus |
| A2-63 | `field_diffs` pseudo-field `{field: "state", ...}` | `fields` contains `"state"` and `before.state` / `after.state` are `active` / `disabled` | one existing diff shape; the UI renders the state diff from it |
| A2-57 | revision `before` / `after` = `{disabled, reason}` | the same plus `item_id` | compare and the item lineage match revisions by `item_id` |
| A3-60 | `GET …/items` catalog | `GET /v1/datasets` gains `include_inaccessible` | WP-B's launch picker lists datasets the caller cannot open (owner decision D3) |
