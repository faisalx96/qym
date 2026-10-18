# qym Design Language

**The single source of truth for all UI work in this repo.** If you are styling,
editing, or generating anything under `frontend/` (the React app that is the
platform UI, and the SDK-local viewer built from the same sources), follow this
document. It is enforced by `frontend/src/__tests__/design-language.test.ts`
(run by `tests/platform/test_design_language.py`), ESLint and Stylelint —
violations fail CI, so read this before writing CSS, not after.

Scope: everything in `frontend/src/`. The frozen offline export templates in
`packages/platform/qym_platform/export_templates/` are a sanctioned exception
(see section 5).

---

## 1. Vocabulary: design tokens

All colors, sizes, spacing, and fonts come from the `:root` block in
[`tokens.css`](../frontend/src/styles/tokens.css) (shell chrome sizes live in
[`shell.css`](../frontend/src/styles/shell.css), global resets in `base.css`).
The shared scale is defined there only; no other stylesheet may redefine
`--font-*`, `--text-*`, `--bg-*` or `--control-height`.
**Never hardcode a value that has a token.** If you need a value that doesn't
exist, add a token first, then use it.

### Text color ramp

| Token | Value | Contrast (on `--bg-surface`) | Use for | Never for |
|---|---|---|---|---|
| `--text-primary` | `#ededf0` | 14.7:1 | Titles, key values, table content that matters | — |
| `--text-secondary` | `#a8a8ba` | 7.3:1 | Body copy, table cells, descriptions | — |
| `--text-muted` | `#9a9ab2` | 6.3:1 | Labels, meta lines, captions, **table headers**. The minimum color for readable text. | — |
| `--text-dim` | `#6b6b80` | 3.3:1 (below AA) | Placeholders, disabled states, decorative glyphs (chevrons, separators, sort arrows) | **Any readable content**: headers, labels, timestamps, counts, IDs, values |

The dim rule is the one most often violated, and it is absolute: if a human is
expected to read it, it is `--text-muted` or brighter.

Semantic colors (`--success/--warning/--error/--metric-error/--info`), the 5-step score scale
(`--score-1..5`), chart colors (`--chart-1..8`), and accents
(`--accent-primary/secondary/tertiary/tertiary-soft`) are for state and data
encoding — they are not part of the hierarchy ramp and don't substitute for it.

Runs error indicators use the original ⚠ glyph: `--error` for task failures and
`--metric-error` for metric failures. Retry counts use ↻ with `--info`.

### Type scale — every element maps to exactly one role

| Role | Token | Size / weight | Color | Notes |
|---|---|---|---|---|
| Page title | `--font-title` | 22px / 600–650 | primary | One per page. No page invents its own title size. |
| Stat / hero value | `--font-stat` | 26px / 700 | primary or score color | Mono, `tabular-nums`. |
| Modal / empty-state title, mid-tier value | `--font-xl` | 18px / 600–650 | primary | Also emphasized inline stats (e.g. drawer aggregates). |
| Section header | `--font-lg` | 15px / 600 | primary | |
| Card title / sub-header | `--font-md` | 13px / 600 | primary | Also form inputs. |
| Body / table cell / code | `--font-base` | 12px / 400 | secondary | |
| Meta / caption / label / **table header** | `--font-sm` | 11px / 400 (labels 600–650) | muted | Uppercase labels get `letter-spacing: 0.05em`. |
| Badge / pill | `--font-xs` | 10px / 650 | semantic | Badges only — nothing else may be 10px. |

**One heading scale across pages** (enforced by `e2e/visual-language/heading-scale.spec.ts`): the page title is
`--font-title` 22/650 (even the visually hidden `h1` of Runs and Charts), a section heading is `--font-xl` 18/650
(`SectionHeader`'s default level; the run, compare, analysis, charts and admin sections), a panel or group heading is
`--font-lg` 15/600 (Overview panels, per-task chart cards, run-detail group titles such as "Response time" and "By pass"),
and a small label is `--font-md` 13/600 uppercase and tracked. No page writes its own heading size.

Major analytical sections use a sentence-case section title (`--font-xl`) followed
by a concise muted `--font-sm` description. Do not introduce a major section
with an uppercase metadata-style label. The run detail page is the exception:
its top-level sections are page sections reached from the sticky section nav
and use the run section header recipe below (`--font-xl` title).

**Floor: no readable text below 11px.** 10px is reserved for badge/pill chrome.
Off-scale values (9px, 10.5px, 11.5px, 12.5px, 13.5px, 14px, 16px, 17px, 20px…)
must snap to the nearest role token.

**Glyph exemption:** decorative glyphs — `×` close buttons, disclosure arrows,
markers, sort hints, emoji, and oversized empty-state icons — use the
`--glyph-*` tokens (`--glyph-md` 20px, `--glyph-lg` 48px), not raw pixels. They
are icons drawn with text, not text. The frozen px inventory in
`design-language.test.ts` (`FROZEN_HARDCODED_SIZES`) starts empty; adding an
entry is a deliberate exemption, named in the commit message.

### Font families

- `--font-sans` — everything humans read: names, descriptions, prose, buttons,
  headers, labels.
- `--font-mono` — **data only**: IDs, row numbers, JSON, code, metric/latency
  values, timestamps, version strings. Never for prose or UI chrome. When in
  doubt: if it could contain a sentence, it's sans.
- One typeface family, three scripts: **IBM Plex Sans** (Latin), **IBM Plex Sans Arabic** and
  **IBM Plex Mono**, self-hosted as subsetted woff2 in `src/styles/fonts/` (SIL OFL, licence texts beside
  the files; choice and measurements in `docs/internal/ui-migration/redesign2/typeface-study.md`).
  `@font-face` lives in `tokens.css`: `Qym Sans` and `Qym Mono` are Latin-only by `unicode-range`, `Qym Arabic`
  is Arabic-only, so Arabic text in a sans or mono block renders in the Arabic face at its own optical size
  with no `lang` plumbing. All use `font-display: swap`, and `Qym Sans Fallback` / `Qym Mono Fallback`
  (local Arial / Menlo with `size-adjust` and `ascent-override`) keep layout still during the swap.
- The stacks are `--font-sans` and `--font-mono` and nothing else; never name a family in a component.
  DM Sans, Georgia, Google Fonts imports and `@fontsource` packages stay banned (the CI test checks).
  New files must be subsetted (Latin + Arabic), woff2, with a licence file; total font payload is capped
  at 200 KB by the design test.
- The system tail of the mono stack still names **Menlo** (the only mono face Chrome on macOS can see by name);
  any hardcoded mono stack names Menlo too; CI checks both.
- Tables (`table`, `grid`, `treegrid`) set `font-variant-numeric: tabular-nums` once in `base.css`.
- **Text direction.** Every block that shows user or model text goes through
  `TextBlock` (`src/ui/TextBlock`) or takes `textDirAttrs(text)` from
  `@/lib/text`: mostly-Arabic text gets `dir="rtl" lang="ar"`, anything else
  `dir="auto"`. Put it on the block element, never an inline span inside a
  left-to-right block; use `text-align: start`, never `left`. Code and JSON
  editors whose lines mix scripts use `unicode-bidi: plaintext` on every layer
  (CodeMirror: `EditorView.perLineTextDirection`). Arabic blocks get the 1.7
  leading from `tokens.css`, which component line-heights cannot override.
  `TextBlock` is also the only place `dangerouslySetInnerHTML` is allowed
  (ESLint).

### Shell chrome scale

The sidebar/topbar run 2px larger than page content, via explicit
`--shell-font-xs..lg` tokens (12–17px) defined in `shell.css`. Use these only
for navigation chrome. Never redefine `--font-*` in a scope — that fork was
removed on purpose; one token name means one value everywhere.

### Spacing, surfaces, borders

- Spacing: `--space-xs/sm/md/lg/xl` (4/8/14/20/32px).
- Surfaces (dark → light): `--bg-void` page ground, `--bg-base` content area,
  `--bg-surface` cards/panels, `--bg-elevated` table headers/inputs/nested
  surfaces, `--bg-hover`/`--bg-active` interaction states.
- Borders: `--border-subtle` (default hairlines), `--border-default`
  (inputs, popovers), `--border-strong` (emphasis/dividers).

---

## 2. Hard rules (CI-enforced)

Enforced by `npm run test:design` (vitest), ESLint (TSX rules) and Stylelint.

1. **Tokens only** for font sizes and text grays. No hardcoded `font-size: Npx`
   (CSS Modules; Stylelint also rejects it) or `fontSize` in a TSX `style`
   prop (ESLint), outside the frozen glyph allowlist.
2. **`--text-dim` never on readable content.**
3. **No readable text below 11px.**
4. **Mono for data, sans for words.**
5. **No new font families** beyond the self-hosted Plex set; DM Sans / Georgia / Google Fonts / `@fontsource` are banned.
6. **The old grays `#7a7a90` and `#50505e` must not reappear** (they were the
   pre-2026-07 sub-AA ramp).
7. **No hardcoded colours.** Hex and `white` are rejected for `color` and
   `background` in CSS (Stylelint) and in TSX `style` props (ESLint). Use
   `var(--…)`.
8. **Surfaces are always themed.** The app is dark only and `:root` declares
   `color-scheme: dark` (also set in `index.html`), so anything the browser
   draws itself (form controls, `<dialog>`, scrollbars, native popups) comes up
   dark even before a stylesheet has loaded. No stylesheet paints a surface in
   raw `#fff`/`white`; use `var(--bg-*)`.
9. **The shared scale is defined once.** Only `tokens.css` declares
   `--font-*`, `--text-*`, `--bg-*` and `--control-height`.
10. **Features compose primitives.** Feature CSS does not restyle a primitive
    (no `--control-height` heights, no `--font-xs` outside Badge/Tag, no
    pill-shaped clickable chips of its own); `--docs-font-*` / `--docs-body`
    are only referenced from `features/docs/`.
11. **`dangerouslySetInnerHTML` only inside `src/ui/TextBlock`.**
12. **Tints come from the tone recipe.** No `rgba()` literal outside `tokens.css`
    (tints are `color-mix(in srgb, var(--tone) var(--tint-soft), transparent)`,
    scrims and scrollbars are tokens); `tones.css` maps every tone, band and series.
13. **Pages do not declare their own `.card`.** Use `ui/Card` (see "Card").
14. **Hover is colour, border and opacity only**: no `transform`, `translate` or
    `scale` in a `:hover` / `[data-hovered]` rule.
15. **`LinkButton` shares Button's states**: `a.button:hover`, `:active` and
    `:focus-visible` exist in `Button.module.css`.

---

## 3. Component recipes: the React primitives

Every shared control and display element is a primitive in
[`frontend/src/ui/<Name>/`](../frontend/src/ui/): `<Name>.tsx`, a CSS Module
`<Name>.module.css` whose **first line names the recipe it implements**, and an
`index.ts` (import from `@/ui`). Do not build page-local copies; if a primitive
is missing a variant, extend the primitive. State is expressed in `data-*`
attributes (`data-selected`, `data-hovered`, `data-focus-visible`, …). The UI
gallery at `/__ui` (Vite dev server) shows every primitive in every state.
The recipe contracts (heights, radii, fonts, z-index tokens) are pinned per
primitive in `design-language.test.ts`.

The recipes, by intent:

- **Control** (`TextField`, `Select`, `MultiSelect`, `SearchField`, `NumberField`,
  `Textarea`, `Button`, `LinkButton`, `SegmentedControl`): one aligned density,
  `--control-height` (24px) and `--control-radius`, `--font-sm`, sans. There are
  no compact or roomy variants. Buttons come in neutral, accent (primary) and
  danger tones; a danger action states what will be deleted. Brand colour
  belongs to an integration action only (e.g. Langfuse), never to generic
  controls. The 42px authentication fields (`TextField`),
  textareas, sliders and composite controls are separate recipes and do not
  inherit `--control-height`. In a mixed header action cluster, actions and an
  adjacent status badge share the 24px control height.
- **Multiselect** (`MultiSelect`): content in fixed order: search, actions
  (Select all and None/Clear), then `--dropdown-option-height` option rows.
  Each option may expose an explicit "Only" action; never hide it behind
  double-click.
- **Tabs and switchers** (`Tabs`, `SegmentedControl`): section navigation is
  underline-only tabs (`role="tablist"`/`tab`, `aria-selected`, roving focus and
  Left/Right/Home/End from React Aria). In-place view/metric/repeat/time
  switching uses `SegmentedControl`: 24px high, only the selected option has the
  Qym-green fill, one sliding indicator, no motion under
  `prefers-reduced-motion`. Pages never add their own selection animation. The
  run detail page's sticky section nav (jump links, `aria-current` on the section
  in view, sliding green underline, page-wide Filters + Clear, back-to-top) is
  the one jump-link variant; no percentages or progress bars in it.
- **Disclosure** (`Disclosure`): a closed-by-default group inside a section,
  one trigger row (chevron, `--font-md` title, muted `--font-sm` summary such as
  "Default fields") and a panel that animates its height in `--transition-fast`
  (none under `prefers-reduced-motion`). Use it instead of a nested card for
  advanced settings; never inside another Disclosure.
- **Action rail** (auto-analysis, `features/analyzer/blocks/ActionRail`): a page-level sticky bottom bar of
  `--action-rail-height`, always mounted, with a fixed primary-button width (`--action-primary-width`) so
  label changes never move neighbours. Exactly one accent button per state. The sections above it reserve
  their space (`--results-slot-min-height`) so state changes insert nothing above existing content.
- **Steppers and disclosure motion** (`Stepper`, `Collapse`): a wizard's progress rail is
  `Stepper`: an ordered list of always-clickable buttons (`aria-current="step"`), a 4px
  bar per step that fills with a `scaleX` transition (logical origin, flips in RTL), a
  `--accent-primary` bar for done and current steps, info and danger count tags, and a
  compact "Step n of N" form with a jump select below 760px. Disclosures animate with
  `Collapse` (`grid-template-rows` 0fr to 1fr, never a px height; closed content is `inert`
  and `visibility: hidden`). Motion tokens: `--motion-step` (180ms), `--motion-step-out`
  (140ms), `--ease-standard`, `--transition-fast` for hover; every animation is off under
  `prefers-reduced-motion`. A wizard step panel enters with a 180ms opacity and 8px rise;
  pages never add other selection animations.
- **Run section header**: every top-level run-page section opens with a
  `--font-xl` / 650 primary title, one muted `--font-base` description line,
  the section controls on the right, a `--border-subtle` hairline above and
  about 48px from the previous section. The header owns the spacing; sections add
  no top or bottom margin of their own.
- **Report page and scope sidebar** (`ReportSection`, `ReportLayout`, `ScopeBar`,
  `QuickFilterGroup`): run detail and compare are one stacked report. Every
  analytic topic is a full-width `ReportSection` (run section header, `xl`
  title, container-query body so cards respond to the real column width: 2 / 3 /
  4 per row, never a fixed 380px column); sections below the fold mount lazily
  (`lazy`, once, with a reserved `minHeight`) and are hidden, not shown empty,
  when the run has no such data. The quick-filter sidebar (`--report-sidebar-width`
  300px, 320px from 1920px) exists only while the reader has narrowed the item
  set (a scope: any chip, rule or search; sort, page, metric and layout are not
  scope). The `ScopeBar` above the report lists "N of M items" with removable
  chips, Clear all, View N items and the Hide / Show toggle (stored in
  `localStorage qym:report-sidebar-hidden`). Under 1200px the sidebar is a
  `Drawer` (360px) opened from the ScopeBar. The sidebar's first group lists the active
  chips (the ScopeBar then shows only the count and actions; below 1200px the sticky
  ScopeBar carries the chips). Lazy section bodies are not in the DOM until they near the
  viewport, so browser find-in-page cannot see them and the scrollbar thumb grows as they mount. Sidebar and ScopeBar fade with
  `--transition-fast` and not at all under `prefers-reduced-motion`.
- **Badge** (`Badge`, `RunStatusBadge`): status and outcome labels, 20px minimum
  (`--badge-height`), fully rounded, tinted 1px outline, sans `--font-xs` / 650.
  Tones: success (completed/approved/improved), info (running), danger
  (failed/rejected/regressed), warning (draft/stopped), neutral
  (submitted/within-noise). Built on `--tone`/`--tone-text` and `--tint-soft`; plus `accent` and `meta`.
  `glyph` adds a decorative non-colour cue (Approved gets a check: same tone as Completed). A Badge is passive:
  an actionable count is a `Chip`.
- **Tag** (`Tag`): roles, provenance, versions, passive metadata and compact
  counts; 20px minimum, borderless, `--control-radius`, tinted or elevated
  fill. Roles, counts, data and versions are mono; other tags are sans. A tag
  may grow vertically when its content wraps. `kind` says what the label is: `task`, `version` and `config` are
  definition metadata and take the `meta` (purple) tone; `dataset` is neutral; `model` (+ `series`) renders the series
  dot; `origin` is neutral (official is `tone="info"`). Passive: no hover.
- **Chip** (`Chip`): interactive filters only; `--chip-height`, rounded outline,
  sans `--font-sm` / 600, counts mono. Passive metadata never uses the chip
  recipe. `tone` or `series` sets the colour of the selected state (a status
  filter in its status tone, a category group in its series colour); hover on a
  selected chip deepens to `--tint-strong`, pressed is `--bg-active`.
- **Icon action** (`IconButton`, `CopyButton`): a single icon-only action, a
  24px borderless square with `--control-radius` and a transparent resting
  surface. Hover and keyboard focus change only the glyph colour (Qym green);
  no tile, tint, ring or glow on pointer hover. Keyboard focus keeps the thin
  focus outline. Semantic actions keep their meaning (approve/submit green,
  reject/delete red). Help markers and passive icons are not icon actions.
  Every copy action is `CopyButton` with the shared overlapping-rectangles
  glyph from `Icon`.
- **Connected statistics** (`StatStrip`): primary summary bands; the strip owns
  the outer border, cells have dividers and no card borders, labels sit above
  mono values, and a leading icon aligns to the top of the label/value stack.
  Tiny card-footer metadata, the Runs-table repeat-run group metrics row, and
  compact model-card metric matrices are not stat strips. With a section
  heading, use the compact one-row variant.
- **Explanations** (`HelpMarker`, `Tooltip`): the focusable 12px
  `--info-marker-size` marker with a tooltip (`role="tooltip"`). Hover/focus
  opens it, click/touch pins it, outside click and Escape close it.
- **Data table** (`DataTable`, own `<table>` markup, `role="grid"`; `treegrid` when rows expand): sticky header
  `--table-header-height` in `--font-sm`, `--text-muted`, `--bg-elevated`, uppercase, `letter-spacing: 0.05em`, 650;
  body cells `--font-base`, `--text-secondary`, sans (this header/cell recipe is locked in `.thead th` / `.tbody td`).
  Row height comes from the density tokens `--row-compact` 32 / `--row-regular` 40 / `--row-comfortable` 52 (two-line
  and wrapped cells raise the minimum to comfortable); zebra alternates `--bg-base` and `--bg-surface` by logical row;
  hover `--bg-hover`; selected `--bg-selected` plus a 2px accent bar; `rowState` draws a 3px rail (error, warn, live,
  new) and `error` and `live` also wash the row at `--tint-faint` (6%), the only washes allowed in a table. Numeric/ID columns add mono and `tabular-nums` per column type, scalar numbers are right-aligned; a column
  whose primary content is a score bar aligns its header to the bar's left edge. Column groups render a
  `--table-group-height` band above the header. Sort glyph, header menu and resize divider show on hover/focus only;
  pinned columns (start/end) are opaque, with an edge shadow while content scrolls under them. Wide tables expose only
  the persistent mirrored horizontal scrollbar rail (never both native and mirror). Below 640px tables that declare
  column `priority` become stacked cards. Chrome parts (`DataTable.Toolbar`, `DataTable.Footer`, selection bar, Columns
  and Density menus) sit inside the card on `--bg-surface`. `ScoreBar` takes `size='lg'` (14 to 16px track, value inside the bar), `series` and `index`; `DeltaCell emphasis`
  renders the pill outside the noise band. Cell kit (`ScoreBar`, `DeltaCell`, `TwoLine`, `IdCell`,
  `RelativeTime`, `TagsCell`, `UserCell`, `ProgressCell`, `StatusCell`, `NumberCell`) lives in `ui/DataTable/cells`.
  Pages never restyle table cells; they supply columns.
  **Column layout** (`reorderable`, `storageScope`, `maxPinShare`, `Column.lockOrder`): the Columns menu lists every column in
  display order, one row each: drag handle (pointer, touch, or keyboard: Space lifts, arrows move, Space drops, Esc
  cancels), visibility checkbox, muted group tag and a freeze toggle (`aria-pressed`, "Freeze Status"); the line between
  the frozen block and the scrolling columns can be dragged across. A menu header names the frozen count and any column
  suspended by the cap (the frozen block never takes more than `maxPinShare` = 50% of the scroller; the first frozen
  column always stays). The header menu has Freeze / Unfreeze, Move left / right / to start, Hide, and
  `Alt+Shift+Arrow` moves the focused header. Layout (order, pins, widths, hidden, density) is one object saved under
  `qym:data-table:v2:<storageKey>:<userId>`; an unscoped layout is adopted once. Handles and freeze toggles hide under 640px.
- **Filter bar** (`features/runs-list/FilterBar`, `MultiSelect triggerVariant="bar"`, toolbar `rows` slot): row 1 is search,
  Time, Origin and the table controls; row 2 one 24px trigger per facet (96 to 168px, label then `· value`, accent tint
  when active), `More filters` for versioning keys and facets that do not fit (priority Status, Model, Task, Dataset,
  User, Version) and one `Clear n`; row 3 the chips (status chips take the status tone). A list applies on each click, no
  Done button. Under 600px the bar is search plus `Filters n`, opening every facet in a drawer.
- **Passes panel** (`features/runs-list/passes`): one surface and a 2px accent rail, sticky at the scroller start
  (`--dt-scroller-width`); header line (title, metric Select, threshold chip with popover, one help marker), a compact
  `StatStrip` (`bar`, `barBand`) of Pass@k, Pass^k, Avg@k, Consistency, Reliability, and an embedded `DataTable` that mirrors
  the parent's visible metric columns; issues are one glyph plus count per pass (`!` danger, `~` warning, retry info).
- **Scores** (`ScoreValue`): score-bearing values use the five-band
  `--score-1..5` ramp, direction-aware via `src/lib/metrics.ts`. Lower-is-better
  metrics read the ramp inverted; a metric that declares no direction stays
  neutral (no good/bad colour, Pass/Fail, "best" or winner). A lower-is-better
  metric leaves task and scorer errors out of its mean; an errored value shows
  "Error" or the warning glyph in `--metric-error`, never a coloured score, a
  "best" or a histogram bucket, and the error count sits beside the mean. Raw
  numeric metrics stay neutral and confidence intervals stay muted. `variant="pill"`
  shows the band as a `--tint-soft` fill (cards, stat strips, compare averages); the
  number and the `Band n of 5` title stay the non-colour cue.
- **Pagination** (`Pagination`): every paginated view uses it. Borderless
  rounded-square icon buttons for First, Previous, Next, Last around a direct
  page entry (28x24px, growing only with the digit count) and total, mono; no
  connected pill and no visible action names. The Runs view pins it inside the
  status bar with the range summary. Pass page-size options only where changing
  the size is supported. After a page change in an item-by-item detail view the
  scroll host returns to the start of the whole Items section (below the sticky
  section nav), after layout has settled.
- **Page hero** (`PageHeader`): `Text` roles: title `--font-title` / 650 /
  primary; description `--font-base` / muted, one line with ellipsis; meta line
  `--font-base` / muted with `·` separators.
- **Stat card / stat value** (`Text`, `StatStrip`): label `--font-sm` / 600 /
  muted / uppercase; value `--font-stat` / 700 / mono / `tabular-nums`
  (primary, or a `--score-N` colour when it encodes a score). Mid-tier stats in
  drawers and tiles use `--font-xl`.
- **Eyebrow** (`Eyebrow`): `--font-sm` (`--font-xs` only inside a pill), 600-700,
  muted, uppercase, `letter-spacing` 0.05em-0.12em.
- **Dialog and Drawer** (`Dialog`, `ConfirmDialog`, `FormDialog`, `Drawer`,
  `Popover`, `Toast`): title `--font-xl`, body `--font-sm`-`--font-base`
  secondary; z-index from the `--z-*` tokens only. Every modal surface has
  `role="dialog"`, `aria-modal`, a label from its title, focus moved in on open,
  Tab kept inside, Escape closing, and focus returned to the trigger (React
  Aria provides this; do not hand-roll). Destructive confirms start on Cancel.
  A closed drawer that stays mounted is `inert`. Never close a modal by toggling
  `display`.
- **Failed requests** (`ErrorState`, `StaleBanner`): a failed load is never an
  empty or "not found" state. `ErrorState` names the cause (session ended, no
  access, not found only for a real 404, server error, network) and offers Retry;
  it never shows a create action. A refresh that fails after data was shown
  keeps the rows dimmed under a `StaleBanner` that says how old they are and
  whether the latest filter change is applied.
- **Loading and empty** (`Skeleton`, `EmptyState`): a skeleton appears only
  after the pending delay (`useDelayedPending`, 300 ms) and respects
  `prefers-reduced-motion`. `EmptyState` is for a successful empty result only:
  glyph icon in `--text-dim`, low opacity, title `--font-xl` / 650 / primary,
  body `--font-md` / muted, line-height 1.5 or more.
- **Calm surface** (run detail, applies everywhere): a container (card, drawer, expanded item) is the only filled layer; inside
  it at most one more fill level, reserved for code and JSON viewers, inputs and the selected or open state. Parts are
  separated by a `--border-subtle` hairline and `--space-md` rhythm, never by nested tiles; colour carries status, band,
  series (a pass is `--chart-1..3`) or a selected state only. Stats in a group are a `StatStrip` (`StatStripItem.group`
  labels runs of cells), key/value groups a `KeyValueGrid`.
- **Field row, structured value, split pane** (`FieldRow`, `StructuredValue`, `SplitPane`): `FieldRow` puts a label, its
  body (reading measure `--field-measure`, 76ch) and actions on one logical row whose `dir` follows the content, so an
  Arabic input mirrors with the label next to the text; under 640px of container width the label stacks above. An object,
  array or JSON string is a `StructuredValue`: one hairline section per top-level key (collapsible, copyable, typed body:
  text, chips, table, tree), Sections | Raw (`localStorage qym:json-view`), expand all, a key index above four keys.
  `SplitPane` is the window splitter (`role="separator"`, drag, Left/Right 2%, Home/End, double click resets, persisted in
  a per-viewer key). `DataTable detailFit="viewport"` (default) keeps an expanded detail as wide as the visible scroller;
  `ScoreBar marker` draws a baseline tick; `Drawer` takes `eyebrow`, `meta` and `scrim="heavy"`.
- **Text blocks** (`TextBlock`, `JsonViewer`, `KeyValueGrid`): see Text
  direction above; code and JSON are mono. `KeyValueGrid variant="tiles"` puts each pair on a `--bg-elevated`
  tile (the run "Execution context"); an item `kind` of `config` or `metadata` adds a suffix and the `meta` tone,
  `tone` adds a 3px start rail on a tile, `icon` a leading glyph.

### Colour as information

One colour, one meaning per page. A hue appears as data only in its own encoding; teal (`--accent-primary`) is
interaction (selected, primary action, link, focus, sort), never data. Colour is never the only cue: bands keep the
number and the `Band n of 5` title, deltas keep the arrow and sign, severities keep their glyph (task warning, metric
cross, trace clock, analysis sparkle), series keep their letter or name.

| Encoding | Meaning | Tokens | Applied through | Rule |
|---|---|---|---|---|
| Band | quality of a value | `--score-1..5` | `ScoreValue` (text, pill), `ScoreBar`, `RateBar`, histogram buckets, `Card band`, stat values | direction-aware (`lib/metrics.ts`); a metric with no direction or a raw number stays neutral; an errored value shows Error in `--error` / `--metric-error`, never a band |
| Status | lifecycle of a run, job, review | `--success` completed/approved, `--accent-secondary` running, `--error` failed/rejected, `--warning` stopped/draft, neutral submitted/pending | `Badge`, `RunStatusBadge` | running has the pulsing dot; approved adds the check glyph |
| Delta | change vs a baseline | good `--score-5`, bad `--score-1`, flat `--text-muted` | `DeltaCell`, `StatStrip trend` | colour only beyond the noise band; sign and arrow always; lower-is-better inverts |
| Severity / kind | what failed | task `--error`, metric `--metric-error`, trace `--warning`, analysis `--info` | 3px rail, glyph, title colour | rail and glyph, never a filled card |
| Series | which run, model, category group | `--chart-1..8` | marker dot and letter, `Card series`, chart marks, `Chip series`, `Tag kind=model` | never good or bad; always paired with letter or name; A is the baseline; series 1 is sky blue (teal is reserved for selection, links and the primary action), never relied on alone |
| Definition metadata | what was run | `--accent-tertiary` (purple) | `Tag kind=task|version|config`, `KeyValueGrid kind` | purple is only this |

Palette rules from the design pass (`docs/internal/ui-migration/redesign2/colour-review.md`): the score ramp is
red `#ef4444`, orange `#f97316`, yellow `#facc15`, light green `#4ade80`, green `#10b981`; adjacent bands stay at
least dE 21 apart under protanopia and deuteranopia (the old yellow/lime pair was dE 4 to 10). The eight series
are sky, pink, orange, amber, indigo, lime, cyan, slate: no teal, purple or red, every one at least 4.5:1 on
`--bg-surface` and `--bg-elevated`; series colours live in `tokens.css` only (no second palette file).
Hairlines are `--border-subtle/default/strong` at 1.25 / 1.59 / 2.3 : 1 on `--bg-surface`.

**Tint recipe.** `tones.css` maps `data-tone` (success, info, warning, danger, accent, meta, neutral), `data-band` (1 to 5)
and `data-series` (1 to 8) to `--tone` and `--tone-text` (the AA-safe text variant: `--error-text` for danger and band 1,
`--accent-tertiary-soft` for meta). A primitive then writes one rule:
`background: color-mix(in srgb, var(--tone) var(--tint-soft), transparent); color: var(--tone-text);`. The tint steps are
`--tint-faint` 6% (row or card wash for danger and live only), `--tint-soft` 12% (Badge, Tag, Chip selected, pill, icon
tile), `--tint-strong` 20% (hover or pressed on a tinted fill, selected pill). No raw `rgba()` outside `tokens.css`
(scrims and scrollbars are tokens). At most one tint fill per row-height region; never zebra-tint; a card inside a card
is not allowed.

- **Run name and entities**: a run is written by `RunName` (sans, a link when it has a target, mono only when the label is a
  bare id) and the task, dataset and model by `TaskTag`, `DatasetTag` and `ModelTag`, on every surface (runs list,
  overview, admin, run header, compare cards, analysis header). An input shows as `promptPreview` (its prompt line, never
  raw JSON) wherever it is a table cell (dataset items, analysis targets).
- **Scroll cue** (`useScrollCue` and `scrollCue`): a region that scrolls sideways fades the edge that still has content
  (overrides tables in the wizard, the compare section tabs on a phone).
- **Series 1 to 8** (`--chart-1..8`, defined once in `tokens.css`): sky, pink, orange, amber, indigo, lime, cyan, slate
  (the design pass order; cyan sits outside the first five because it is close to sky), so no run colour in the
  first five repeats another's hue under any colour-vision simulation.

- **Sticky bars** (`--bar-nav-h` 44px, `--bar-action-h` 56px): two heights across the app. The navigation bar of a
  report (run-detail `SectionNav`, the compare bar) is `--bar-nav-h`; an action bar (the experiment home launch bar,
  the analysis action rail, the run items toolbar) is `--bar-action-h`. Pages set `min-height` from the token, never a
  number. Enforced by `design-language.test.ts`.

- **Card** (`Card`): the one grouping surface. `--bg-surface`, 1px `--border-subtle`, `--radius-md`, padding
  `--card-padding` (`compact`: `--card-padding-compact`), optional `header` / `footer` slots with a hairline. A 3px
  inline-start rail (`--rail-width`, logical so RTL mirrors) carries the meaning: `tone`, `band` or `series`
  (`rail="none"` drops it; `rail="bottom"` moves it under a tile that reads as a gauge, as the sweep stat tiles; `left` is
  the default and the only other spelling). `wash="danger"|"live"` adds the 6% tint and is the only wash. A passive card has no hover.
  `onPress` (div `role="button"`, Enter and Space), `href` or `to` (anchors) make it interactive: hover raises the
  border to `--border-default`, the fill to `--bg-elevated` and adds `--shadow-card-hover`; pressed is `--bg-active`;
  `isSelected` draws the accent border and a soft accent fill while the rail keeps its tone; focus is the 2px accent
  outline. `fill` makes the card a flex column whose body takes the remaining height (a card a grid row stretches gives
  the extra height to its plot, never to empty space under it). An interactive card holds no other interactive element. Never restyle a card per page: pass layout via
  `className`, meaning via props.
- **Chart kit** (`ui/Chart`, `styles/marks.css`): every data mark is a `Mark` inside a `ChartTooltipHost`. A mark
  carries `data-mark`; with `onPick` it is interactive (a `button`, or an SVG element with `role="button"`, Enter and
  Space) and answers with `filter: brightness(var(--hover-brightness))` while its siblings dim to `--dim-opacity`
  (`:has`, graceful where unsupported); selected draws a 2px `--text-primary` outline (stroke on SVG) and dims the rest;
  focus is the 2px accent outline. Colour, outline and opacity only: no transform, scale or glow. `tip` opens a
  `role="tooltip"` (markup allowed) on hover and keyboard focus, pinned by a touch tap, closed by Escape; it replaces the
  native `<title>`. `SeriesHighlightRoot` + `useSeriesHighlight(n)` (compare) sets `data-series-active=n` so every
  `[data-mark][data-series]` of another series dims. Encodings: scores take bands (`bucketTone`), outcomes pass = band 5,
  fail = band 1, task error = an open `--error` ring on the axis, latency bulk is `--bg-active` and only the tail is
  `--score-3` (p90) and `--score-2` (p95), series come from `--chart-1..8`. A scatter shows two faint quadrant washes
  (fast and passing, slow and failing) and a legend with the same swatches. Hit areas are at least 24px.
- **Stat tiles** (`ui/StatTiles`, round 3 P2): seven or fewer equal, separate, centred tiles (the repeat analysis). Each is a
  passive `Card compact rail="bottom"` (rail in the value's band; none for latency and errors): a `--font-sm` 600 uppercase
  label with its `HelpMarker`, the value in `--font-stat` mono, one plain sentence in `--font-sm` muted (at most 22ch wide).
  No groups, no hover. The grid answers to the report column: one row of N from 900px, a 12-column 4 + 3 split below that,
  two per row and a full-width last tile under 480px. `StatStrip` stays for connected summary bands.
- **Categories** (run detail, round 3 P3): one key at a time. A `SegmentedControl` "Category" (up to 5 keys that fit the column,
  else a searchable `Select`; stored in `?category=`) over one `Card`: header with the key, the value count, the "Overall average"
  tick legend and an Order control (worst first by default); rows `[value][bar + %][items][pass][latency]` as buttons that toggle the
  item filter (`aria-pressed`, `--bg-selected` and an accent bar, never a band fill). The bar follows the value name (value column at
  most 220px), is a 12px track in the average's band (neutral without a direction) with a 2 x 18px `--text-primary` tick at the
  overall average. Six rows show first, then "Show all N values". Under 640px a row is two lines (name, items, pass / full-width bar).
- **Items table header and ItemBar** (round 3 P4): the column header sticks at the sticky line only over collapsed rows. For an
  expanded item it is held above the detail (it stops when its bottom touches the detail's top, scrolls away, and returns to the line
  when the line crosses the detail's bottom; `useStickyShift` takes the detail spans, pure geometry in `stickyShift.ts`). The
  expanded item starts with an `ItemBar` (`--row-compact`, opaque, number, verdict, input preview, Copy link, Collapse) that
  takes the sticky line. The table scroller is an overflow container, so the bar is translated by the same hook, not CSS sticky.
- **Item details** (round 3 P5): the expanded item is `direction: ltr` and left anchored: Input, Expected and Tags are
  `FieldRow labelAnchor="start"` (label column `--field-label-width`, the value block as wide as its text up to
  `--field-measure`; only the value carries `dir`), then the Output region, a full-width divider (1px `--border-strong`, 20px
  above) and the Metrics region. Output keys are collapsed key rows (`StructuredValue variant="keys"` / `KeyTree`: chevron, key,
  one-line preview; open: the value, Copy, per-key Expand all / Collapse all recursive; the region has global Expand all / Collapse
  all and Sections | Raw). A repeat item has a pass rail (a chip per pass with number and verdict glyph, at most three read side by
  side). **A pass has no colour**: its identity is text, colour on a pass is only its verdict. Metrics are one matrix
  (metric rows by pass columns, Mean, 8 rows then "Show N more"), values are mono 600 band-coloured text (no tinted cells, no
  outline: the selected row takes `--bg-selected` and a 2px `--accent-primary` bar at its inline start; a single pass's Reason is a
  `fit-content` block anchored at the column's inline start, whatever its direction) and open ONE detail panel below (round 5 R3).
  The panel (`--bg-elevated`, `container-type: inline-size`, `direction: ltr`) has a one-row header (mono name, `ScoreValue`, "Pass n",
  "edited", then the text button "Edit score" and Close), a hairline, then: **prose blocks** (reason, reasoning, explanation, label,
  then any string over 60 characters) with the eyebrow label stacked above the text (13px, line 1.6, 76ch, `dir` on the text only) so a
  label can never overlap its text; **facts** (`dl`: humanized sentence-case key `--font-sm` 650 in a `--field-label-width` column,
  ellipsis + raw key in `title`, value next to it; the row stacks under 420px); **tables** for `{columns, rows}`, arrays of arrays and
  arrays of two or more uniform plain objects (`detectTable`; eyebrow with the row count over an embedded `DataTable`, every header
  sortable, 12 rows then "Show N more rows", scrolls inside); and collapsed key rows for everything else. Label roles are exactly
  three: eyebrow (11px 650 uppercase), fact key (11px 650 sentence case), tree key (12px 600 mono). `FieldRow` labels and `KeyTree`
  keys are cut at their column (ellipsis, title) instead of painting over the value. Score edits happen in that panel.
- **Items toolbar and correlation matrix** (round 5 R4): the toolbar row aligns its controls to one bottom edge, so a control with a
  label above (analysis metric, threshold, sort) and one without share a vertical centre; the metric correlation grid is as wide as its
  card body and its cells are as wide as their column (at least 20px, scrolling inside the card beyond that). A trace opens on its
  content tab (messages, response, input / output, documents), never on Metrics, Scores or Raw; only a content pick is remembered.
- **Run header** (round 3 P6): three bands, nothing behind a chevron. Band 1 identity and actions (name, passes tag, Copy run id,
  status, Export, pager; a stop reason is one muted line under it). Band 2 seven labelled facts (`dl`, 7 / 4 / 2 columns by
  column width). Band 3 `KeyValueTag` chips (24px passive key / value, key at most 20 characters, value at most 30) in the groups
  Versioning, Config, Metadata, clamped to two lines (three on a phone) with an exact "+ N more" (`qym:run-hero-more`).
- **Box plot** (`run-detail/components/charts/BoxPlot.tsx`, round 3 P7, round 5 R2): the one glyph set for a distribution: box p25 to p75, a
  2.5px median line, whiskers p5 to p95 with caps, a hollow mean diamond, dots outside the whiskers (at most 40 per side, min and max
  always kept). **One tone per plot** (`data-band` of the median for a score with a direction, so a failing pass is red; `data-series="1"`,
  `--chart-1`, for latency, tokens, cost, undirected numerics and step rows; the slow latency tail keeps `--score-2`); stroke, box fill
  (`--tint-strong` over the surface), whiskers, median and mean all take `--tone`. **No number row**: the median is printed above its line,
  the data minimum and maximum under a 1px baseline at the ends of the data (one merged "a to b" label when they would collide), and all six
  numbers plus the IQR are in the box tooltip and the `aria-label` (which ends with "band n of 5" for a band tone). Total is the one fact the
  plot cannot show: plain text "Total **64.0K**" in the card header, additive quantities only (numeric metrics, tokens, cost; never latency,
  scores or negative values). The key is a `HelpMarker` "How to read the box plot" in the header; cards that stack rows (per pass, Steps) keep
  one muted key line. The picture is one `role="img"` named by a sentence; the clickable marks (box, whiskers, min, max) are a transparent
  overlay in tab order. Rows (`BoxTrack`) draw the same glyph per pass and per step. Box plot cards flow in their own grid rows under the
  histograms (`slot="box"`: 80px plot, no 146px minimum).
- **Chart card and bar recipe** (`run-detail/components/charts`, round 3 P1): every chart on the run page lives in one
  `ChartCard` (a `Card fill` with a header: title left, then meta, legend and the card's own controls right; a plot slot
  of at least 146px that grows with a stretched grid row). Bars use one column recipe (`BarColumns`, round 5 R1 "well and foot"): each bucket is a
  two-row grid, the well (flex column `[spacer][count][bar]`, the spacer taking `1 - p` and the bar `p` of the free
  height, `--p` = count / max) and a foot of one constant height per plot (`--foot` = 4px + 14px per line: axis label,
  optional note and sub line). The well's bottom border (1px `--border-default`, bridged across the 4px gaps) is the drawn
  x axis and every bar bottom stands on it; a thinned axis label is a blank line (U+00A0), never a missing one, so no
  column can end higher than its neighbour. The count sits on the bar's top edge (a 16px line, 2px above it) and is visible
  at rest, never hover-only (the tooltip only adds the longer sentence). Bars are at most 44px wide with a 4px gap and a
  3px minimum when the count is above 0; an empty score bucket draws no count, pass/fail bars and "Passes passed"
  draw `0` in `--text-muted`. Axis labels follow one rule for every plot: every k-th label with
  `k = ceil(labelWidth / pitch)` (`pitch` = column + gap, `labelWidth` = characters x 7 + 6), column 0 always; the full list
  stays in the `aria-label`. When counts are wider than the pitch the plot is `data-dense`: each count takes the lowest of three 18px tiers whose box clears
  the earlier counts it overlaps (`countTiers`; no layout change). Boolean metrics are the same plot (Pass, Fail, Error columns, percentage under the label), not a
  horizontal split bar. Bars rise and counts fade in together on mount; nothing animates under
  `prefers-reduced-motion` (`animation: none`). Overview cards flow in `repeat(auto-fit, minmax(260px, 1fr))`.
- **Run identity (compare)**: a run is always `RunTag`: a 10px `--radius-sm` swatch in its series colour
  (`--chart-1..8`, `runColor`/`runSeries` in `CompareContext`), the mono letter (the unique key beyond 8 runs and for
  colour-blind readers) and the name (`run_name`, label as fallback, truncated, full label in the tooltip). Run
  colour is identity, never verdict: text is never run-coloured. Elements that belong to a run carry
  `useRunMark(index)` (`data-mark`, `data-series`, hover and keyboard focus-visible handlers) inside the page's
  `SeriesHighlightRoot`, so hovering a run dims every other run's cards, cells, rows and legend entries (no layout
  change; instant under reduced motion). `ScoreBar` takes `marker` (a decorative tick at the baseline position, used by
  compare category cards) and `height="md"`.
- **Motion** (`ui/motion`, tokens `--motion-fill` 360ms, `--ease-out`, `--motion-stagger` 24ms, `--motion-flash` 700ms):
  M1 colour changes use `--transition-fast`; M2 data marks (bar fills, histogram bars, rings, scatter dots) grow in once
  per mount (`data-enter` from `useEntrance`, which a container turns off for rows that scroll in later) with a stagger of
  `--motion-stagger` per mark capped at 10; M3 a changed value morphs with the same transition and never replays the
  entrance; M4 a lazy `ReportSection` body fades up once (`--arrive-fade`, 6px); M5 a live value flashes a
  `--tint-soft` info tint (`data-changed`, `live`); M6 and M7 are unchanged. Never: a hover transform, glow, gradient, or
  an infinite animation other than the skeleton shimmer and the running-status dot. `base.css` zeroes every duration and
  delay under `prefers-reduced-motion`.

---

## 4. Page anatomy

Every page presents, in order: **page title -> description -> meta line ->
tabs (if any) -> content**, via `PageHeader`. Constrained pages (settings,
admin, projects, overview, models) use the `constrained` container, capped at
`--page-max-w` (1233px, the width the report pages fill at 1440), from
`@/features/shell/layout`; a text-first page (profile) asks for `narrow`
(`--page-narrow-w`). Data-dense pages (runs, charts, datasets, compare) use
`fullWidth` with their own layout. `e2e/visual-language/page-width.spec.ts` checks the widths agree.

Styles live in the page or component's CSS Module next to its `.tsx`, built from
tokens and primitives. Class names are local (CSS Modules), so no prefixing is
needed. Set the document title with `useDocumentTitle`.

---

## 5. Sanctioned exceptions

- **Docs pages** (`frontend/src/features/docs/`): prose reading pages keep a
  larger independent heading/body scale (28/20/16/15/13px) and a brighter
  `--docs-body`. They still use the shared color ramp for labels and the
  tokenized `--code-*` syntax palette. The scale is carried by the
  `--docs-font-*` tokens in `src/styles/tokens.css` (never px literals) and only
  `features/docs` may reference them.
- **Offline export templates**
  (`packages/platform/qym_platform/export_templates/run/`): the frozen,
  self-contained run page behind `GET /api/runs/{id}/export-html` and
  `/api/compare/export-html`. It must work from a single `.html` file with no
  server, so it keeps its own inlined stylesheet and is not subject to the token
  and lint rules. It is not restyled with the app; do not import app code into it.
- **SDK-local viewer** (`frontend/src/sdk-viewer/`, built to
  `packages/sdk/qym/_static/ui/`): shares the primitives and tokens; the same
  rules apply.
- **`tmp/mockups/` (gitignored)**: design scratch files and mocks live here,
  outside the shipped packages, and are exempt from all rules. Do not add
  scratch mocks under `packages/*/_static/`: they get served and shipped. In-app
  design variants use dev-only mock routes (`/__mock/<area>/<variant>`, see
  `frontend/README.md`).

---

## 7. Design and review standards for feedback rounds

Learned in the October 2026 redesign rounds (`docs/internal/ui-migration/POSTMORTEM.md`). These rules decide
how a product complaint becomes a spec and how a reviewer judges the result; the recipes in section 3 are what
they produced.

- **Numbers before code.** A complaint ("too cluttered", "not clear", "refer to the old design") is turned into
  numbered acceptance criteria before anything is built. Each criterion names the element it measures (an id or a
  component, never "the panel"), the width, and the value: heights, counts, gaps, what is visible without a click,
  URL state, keyboard path, axe result. Mocks are drawn in the real column widths of the report pages (1193,
  1033, 777, 521 and 279 px for 1440 to 390), never in a convenient width.
- **Density, never disclosure, for default information.** A block that is too tall is made denser (chips, columns,
  clamps with an exact "+ N more", compact rows) and never fixed by moving default-visible facts behind a chevron,
  tab or hover. "Reachable" is not "visible". Criteria about information say "visible without interaction".
- **Legacy is the usability baseline, not the design.** When the owner says "refer to the old design", the legacy
  page defines what the user must be able to see and do in one glance (one metric from a dropdown, every
  statistic in its own box, the inputs next to their labels); its faults (sideways scrolling chip rows, nested
  boxes) are fixed, not copied. Every spec point carries a legacy screenshot and says what it keeps and what it
  does differently.
- **One idea per row, one control per choice.** A report section is a stack of full-width rows, each one visual
  or one table; two visuals share a row only from 1100 px and only when they explain each other. A choice among
  more than five values is a `Select` (URL-backed), not a chip row. Statistics are separate, equal, centred tiles;
  groups and nested frames are not a way to organise them.
- **Hue budget.** Eight series colours (`--chart-1..8`) is the limit, verified pairwise at CIE76 dE >= 20. Anything
  with more identities than that (passes, steps, categories) is identified by text; colour on it means a state
  (score band, verdict, kind), never "which one". Counts and values are drawn at rest, never hover-only.
- **Distributions.** A quantity that used to print min / avg / max shows the box plot recipe (section 3): median, minimum and
  maximum visible on the plot, all six numbers in the tooltip; a total (card header) only for additive quantities.
- **Bidirectional text.** The layout of an item is one left-anchored grid; `dir` is set on value text only. Arabic
  content never moves labels, keys or controls to the other side of the page.
- **Reviewer method.** The reviewer measures every criterion in the browser (DOM geometry, computed styles,
  counts, screenshots at 1440 and 390) and records the number next to met / not met, then judges each feedback
  point as the owner would, against the mock and the legacy screenshot. "All features present" and "better than
  before" are not verdicts.
- **Amendments.** A criterion's number may change only with the measured value and a one-line reason in the
  spec, and the e2e test must assert the amended number on the same element. Spec and product never disagree.
- **A fix changes a measurement.** If a commit does not move the measured value or the screenshot (for example a
  rendering property that does not alter the raster), it is recorded as a limitation, not accepted as a fix.

---

## 6. Self-check before you finish (any LLM session: run these)

```bash
cd frontend
npm run test:design      # this document, as a test
npm run check            # typecheck + eslint + stylelint + vitest + design test
cd .. && pytest tests/platform/test_design_language.py -q   # thin runner of the design test
```

Open `/__ui` on the Vite dev server (`npm run dev`) to see the primitives in
every state. If your change legitimately adds a decorative glyph size, add it
to `FROZEN_HARDCODED_SIZES` in `design-language.test.ts` **in the same commit**,
with the selector named in the diff so the reviewer can see what was exempted.
