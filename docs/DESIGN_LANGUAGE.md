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
(`--score-1..5`), chart colors (`--chart-1..5`), and accents
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

Major analytical sections use a sentence-case `--font-lg` section title followed
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
- No other families. No webfonts (DM Sans and Georgia were removed; the CI test
  bans them).
- The mono stack is system faces only: `ui-monospace, SFMono-Regular, 'SF Mono',
  Menlo, …, Consolas, 'Liberation Mono', monospace`. **Menlo must stay**: it is
  the only mono face Chrome on macOS can see by name; without it the generic
  `monospace` resolves to Courier. Any hardcoded mono stack names Menlo too; CI checks both.
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
5. **No new font families**; DM Sans / Georgia / webfont imports are banned.
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
| Series | which run, model, category group | `--chart-1..8` | marker dot and letter, `Card series`, chart marks, `Chip series`, `Tag kind=model` | never good or bad; always paired with letter or name; A is the baseline; series 1 is teal for parity, never relied on alone |
| Definition metadata | what was run | `--accent-tertiary` (purple) | `Tag kind=task|version|config`, `KeyValueGrid kind` | purple is only this |

**Tint recipe.** `tones.css` maps `data-tone` (success, info, warning, danger, accent, meta, neutral), `data-band` (1 to 5)
and `data-series` (1 to 8) to `--tone` and `--tone-text` (the AA-safe text variant: `--error-text` for danger and band 1,
`--accent-tertiary-soft` for meta). A primitive then writes one rule:
`background: color-mix(in srgb, var(--tone) var(--tint-soft), transparent); color: var(--tone-text);`. The tint steps are
`--tint-faint` 6% (row or card wash for danger and live only), `--tint-soft` 12% (Badge, Tag, Chip selected, pill, icon
tile), `--tint-strong` 20% (hover or pressed on a tinted fill, selected pill). No raw `rgba()` outside `tokens.css`
(scrims and scrollbars are tokens). At most one tint fill per row-height region; never zebra-tint; a card inside a card
is not allowed.

- **Card** (`Card`): the one grouping surface. `--bg-surface`, 1px `--border-subtle`, `--radius-md`, padding
  `--card-padding` (`compact`: `--card-padding-compact`), optional `header` / `footer` slots with a hairline. A 3px
  inline-start rail (`--rail-width`, logical so RTL mirrors) carries the meaning: `tone`, `band` or `series`
  (`rail="none"` drops it). `wash="danger"|"live"` adds the 6% tint and is the only wash. A passive card has no hover.
  `onPress` (div `role="button"`, Enter and Space), `href` or `to` (anchors) make it interactive: hover raises the
  border to `--border-default`, the fill to `--bg-elevated` and adds `--shadow-card-hover`; pressed is `--bg-active`;
  `isSelected` draws the accent border and a soft accent fill while the rail keeps its tone; focus is the 2px accent
  outline. An interactive card holds no other interactive element. Never restyle a card per page: pass layout via
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
admin, profile, projects, overview) use the `constrained` container (1120px)
from `@/features/shell/layout`; data-dense pages (runs, charts, datasets,
compare) use `fullWidth` with their own layout.

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
