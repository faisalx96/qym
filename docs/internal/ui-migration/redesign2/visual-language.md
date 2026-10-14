# Redesign 2: visual language (colour, feedback, motion)

Area: `visual-language` (cross-cutting). Investigated against the legacy vanilla UI (worktree `qym-wt-legacy`, port 8877)
and the React app at the `UI-redesign` tip (platform 8878, Vite 5878). Screenshots and measurement scripts are in the
scratchpad `.../scratchpad/vl/` (`shots/L-*.png` legacy, `shots/R-*.png` React, `Ld-N`/`Rd-N` run detail scroll frames,
`census2.txt`, `aud-*.txt`). Nothing in the repo was changed except this file.

---

## 1. Feedback point and reading

> general note on UI: it should feel user friendly and interactive instead of static single colours of information.

**Reading.** In the legacy UI the user sees information carried by colour *and* by surface, and almost everything
that looks clickable answers the pointer. A number is coloured by its score band, a trace kind has its own colour, an
error kind its own rail, a run its own identity colour, bars grow in, tiles lift their border on hover and
the histogram bars brighten (`dashboard.css:5556`). In the React app the same data is shown, but a large share of it is
flat: values in white or grey on one ground, cards that are the same grey as the page, bars that are all the accent
teal, clickable tiles that do nothing on hover, and nothing that moves when data arrives. "Intended UX" here therefore
means: **colour is a data encoding (one meaning per colour), applied to every value that has a meaning; surfaces group and
tint by meaning; every actionable thing has hover, press and focus feedback; data marks animate in once.** It does *not*
mean restoring the legacy gradients, glows and lifts, which the current design language bans for icon actions and which
would reintroduce noise (section 7, Q1).

An honest correction to the premise, measured: the raw number of information colours is close to parity (section 4.1).
The loss is in *where* colour is applied, in surfaces, in feedback and in motion. The spec therefore does not "add more
colour"; it applies the existing tokens to the places that lost them and gives every encoding one rule.

---

## 2. Legacy visual language (anatomy)

Pages compared: runs list, run detail (classic and repeat run), compare, models, charts, overview, experiments,
datasets, analysis. CSS: `dashboard.css` (11,998 lines), `latency_traces.css`, `json_viewer.css`, page-inline styles in
`run.html` and `compare.html`.

### 2.1 How colour carries information

| Information | Legacy encoding | Where (file:line) |
|---|---|---|
| Score band | `.metric-score.score-1..5` text colour, bar fills in band colour, histogram bars per bucket band, big mono numerals coloured (`metric-card-value`, `metric-val`) | `dashboard.css:3794-3811` |
| Run status | Outlined pill with a tinted border (`status-badge.status-*`), dot, RUNNING pulses (`hero-pulse`) | `dashboard.css:4759-4780`, `run.html:155-200` |
| Run / model identity | 3px left rail on each compare run card in `--run-accent`, coloured marker squares, 8-colour compare palette, 20-colour chart palette | `compare.html:973-990, 5760`, `dashboard.js:266` |
| Group identity (categories) | complexity amber, domain blue, source purple; each value card gets a 3px left rail and a label tint (easy green, medium yellow, hard red, expert purple) | `compare.html:1738-1800` |
| Error severity | Task errors red, trace errors amber via 3px left rail + header and icon colour; metric errors a different glyph (circle-x) | `compare.html:1793-1794` |
| Trace kind | LLM blue, Tools amber, Retrieval pink, Eval purple: tinted icon tile, coloured stats, coloured segment of the time-budget bar, coloured bracket | `latency_traces.css`, screenshot `Ld-2.png` |
| Quality vs latency | Quadrants tinted ("Fast and passing" green wash, "Slow and failing" red wash), pass dots blue, fail dots orange, task errors as red open rings | `Ld-1.png` |
| Stat strip | Each cell has a tinted icon tile (Items blue, Completed green, Errors red, Not received amber) and a coloured value | `Ld-0.png` |
| Top bar summary | Each project stat has a coloured dot (runs teal, success green, errors red, models sky, items purple) | `L-runs.png` |
| Origin / ownership / provenance | Task tag purple, "Admin" nav badge purple, owner avatar teal gradient, "Official run" tag | `L-runs.png`, `dashboard.css:3360-3399` |

### 2.2 Surfaces

Legacy wraps nearly every section in a bordered card on `--bg-surface`: measured on the run detail scroll frames about
47% of content pixels sit on `--bg-surface` (compare 48%), against 6.6% on the void/base ground. Cards use a
`border-radius: 10px`, `--border-default`, and add the information tint as a 3px left rail or a faint tinted fill
(`compare.html:1738-1800`). The hero card has a 2px accent gradient line on top (`run.html:102-114`).

### 2.3 Hover, focus, micro-interactions

- 287 `:hover` rules, 153 `transition` declarations, 32 `@keyframes` across the 15 legacy stylesheets (line counts,
  indicative only).
- Tiles: `.breakdown-card:hover` strengthens the border and adds a soft shadow, 150ms (`compare.html:1753`);
  `.dist-segment:hover { filter: brightness(1.15) }` (`dashboard.css:5556`); `.lt-kstat:hover` background plus an
  expanded state that tints with `color-mix(var(--tone) 9%)` and draws a 2px underline (`latency_traces.css:216-219`).
- Bars: `transition: width .4s ease-out` and `barGrow .6s` (`dashboard.css:2670-2696`); histogram columns `lt-rise`
  scaleY 600ms with an ease-out curve (`latency_traces.css:121`); breakdown panels `lt-in` 6px rise 250ms.
- Rows: runs-table hover is only `--bg-hover` (`dashboard.css:2957`); the legacy rows are *not* richer than React's.
- Legacy also uses gradients (25), glows and `translateY(-1px)` lifts on buttons. These are the part that must not come back.

### 2.4 Hover audit (measured)

Method: for each outermost `cursor:pointer` element in the viewport (and 3 to 5 scroll steps), screenshot its box
before and after a real pointer hover; identical pixels = "dead". Script: `scratchpad/vl/audit.mjs`.

| Page | Legacy: reacts / dead | React: reacts / dead |
|---|---|---|
| Run detail | 16 / 6 (dead are selected tabs, selected chips, export link; about 2 real) | 11 / 8 (about 6 real, listed in 3.3) |
| Compare | 12 / 1 (selected chip only) | 6 / 5 (about 4 real) |
| Runs list | 15 / 3 (filter segments that are selected) | 3 / 0 |

Selected-state controls that legitimately do not change on hover were excluded by name; the "real" figures are my
manual read of the audit output.

---

## 3. React visual language (anatomy)

Tokens: `frontend/src/styles/tokens.css`; rules: `docs/DESIGN_LANGUAGE.md`; primitives `frontend/src/ui/*`.

### 3.1 What exists and works

- Five-band score ramp with direction awareness: `ui/ScoreValue`, `ui/DataTable/cells/ScoreBar` (`metricBand` in `lib/metrics.ts:398-431`);
  the runs table, the items table, the models page and the overview tiles are properly coloured.
- Tinted status tones: `Badge` (outline + 9% fill), `Tag` (14% fill), `Button` accent (14%/22%), `Chip` selected (12%).
- A 3px rail idiom already exists: DataTable `rowState`, `OutputCard`, error cards `Panels.module.css:96-110`.
- Motion tokens (`--transition-fast` 150ms, `--motion-step` 180ms, `--motion-step-out`, `--ease-standard`, `--arrive-fade` 200ms) and one global
  `prefers-reduced-motion` kill switch in `styles/base.css:92-100`, so any new animation is automatically covered.
- Better than legacy: empty states (icon, title, explanation, one CTA: `R-exp.png` vs `L-exp.png`), skeletons, error and stale states.

### 3.2 Where it reads as "static single colour"

| # | Observation | Evidence |
|---|---|---|
| 1 | **No Card primitive.** 25 stylesheets declare their own `.card` with at least 10 different recipes (3 backgrounds: surface/base/elevated; 2 border colours; 5 paddings; radius 8/5/12). Only 3 have a hover. None has a tone, rail, selected or pressed state. `--bg-surface` vs `--bg-base` is a 1.06:1 step and `--border-subtle` on surface is 1.14:1, so a card on the page ground is almost invisible ("grey boxes"). | `grep -rl "^\.card" frontend/src` = 25 files; contrast computed from tokens |
| 2 | **Data bars in accent teal, not bands.** `RateBar` defaults to `--chart-1` (`run-detail/components/charts/Charts.tsx:201`); Categories uses it, so 80% / 49% / 25% all draw the same teal, while the legacy colours them lime / orange / red (`Rd-3.png` vs `Ld-3.png`). The accent is also selection, links and primary action, so teal data reads as "selected". | `Charts.tsx:198-213` |
| 3 | **Score numbers without bands**: compare "Per-run averages" cells (`20.0%`, `47.0%` in neutral mono), Models "Ranking by average score", Categories value percentages, hero Execution-context values. | `R-compare.png`, `R-models.png`, `Rd-3.png` |
| 4 | **Chart marks are one colour.** Scatter dots `fill: var(--chart-2)` with a native `<title>` tooltip, no pass/fail or error encoding and no quadrant tint (`Charts.module.css:227-237`); latency histogram all `--chart-2` blue with only p90/p95 tinted (`Latency.module.css:89-104`; legacy: grey bulk, warm tail). | `Rd-1.png` vs `Ld-1.png` |
| 5 | **Neutral chips and tags everywhere.** Task, dataset and "Pass" tags are grey `Tag`s on the runs list; legacy task tags are purple. Selected category chips are all the same teal regardless of the group they select. | `R-runs.png` vs `L-runs.png` |
| 6 | **Dead clickables**: `LinkButton` is an anchor reusing `Button.module.css`, but that CSS keys off `[data-hovered]`, `[data-pressed]` and `[data-focus-visible]` which only React Aria's `Button` sets. The anchor never gets them, so all 55 `<LinkButton>` usages (Export HTML, Back to runs, Sign in...) have no hover or press style (keyboard focus still gets the global `:focus-visible` ring from `styles/base.css:86`) (`ui/LinkButton/LinkButton.tsx`, `ui/Button/Button.module.css:42-87`, only `a.button:hover` removes the underline at line 126). Also dead on hover: latency percentile pins, histogram bins, correlation matrix cells, group toggles (steps), error cards and distribution bars in compare, compare run segments, compare matrix row buttons. | `aud-*.txt` |
| 7 | **No motion on data.** The 10 keyframes are shell and chrome only (`aside-in fade pop pulse rise scope-in shimmer slide spin stepIn`). Bars, rings and fills render at final size; `.fill` in `cells.module.css:56-60` has no transition. `--arrive-fade` is declared and used once (`analyzer.module.css:35`). | grep |
| 8 | **Compare palette wraps at 5.** `runColor = var(--chart-${i % 5 + 1})` (`compare/CompareContext.tsx:40`); compare supports 8 runs (legacy `COLORS` has 8, `compare.html:5760`), so runs 6 to 8 reuse colours of runs 1 to 3. | source |
| 9 | **Tint values hard-coded.** 31 `rgba(...)` literals (24 distinct) across `features/` and `ui/` for the same six hues (9, 12, 14, 16, 18, 22% alphas used interchangeably); only 27 `color-mix` uses. No shared tint step, so every new component invents its own. | grep |
| 10 | **No trace-kind icons.** The `Icon` set has about 50 glyphs, none for LLM, tool, retrieval, evaluator or agent; legacy used emoji tiles. Kind colour exists (`traces/spanKinds.ts`) only as a bar segment. | `ui/Icon/Icon.tsx` |

### 3.3 Real "dead on hover" list (React)

`LinkButton` (55 usages), latency `pin`, latency `bin`, correlation `matrixCell`, steps `groupToggle`, steps header
buttons, compare `distBar`, compare `errorCard`, compare `rowButton`, compare run `seg`. The run-detail category card
and items rows do react (`--bg-hover`), and so do `Button`, `IconButton`, `Select`, `Chip` (unselected) and DataTable rows.

---

## 4. Gap analysis

### 4.1 Distinct information colours per page (measured)

Method: Playwright DOM census (`scratchpad/vl/census2.mjs`): every visible element's text colour, background and
border colour, keep chromatic ones (saturation over 0.3), bucket by hue family; sidebar, avatars, identicons and the
skip link excluded; lazy sections scrolled into view first. "Hues" = distinct hue families; "elements" = elements
carrying a chromatic colour.

| Page (seeded data) | Legacy hues / elements | React hues / elements | Hue families only in legacy |
|---|---|---|---|
| Runs list, 4 runs | 6 / 53 | 5 / 42 | purple |
| Runs list, 402 rows | 7 / 507 | 7 / 473 | none (purple 151 vs 76) |
| Run detail, classic | 10 / 209 | 8 / 245 | purple (15 vs 3), green |
| Run detail, repeat | 10 / 172 | 8 / 193 | purple, green |
| Compare, 4 runs | 9 / 365 | 8 / 307 | green |
| Models | 7 / 89 | 7 / 67 | none |
| Charts | 4 / 36 | 4 / 40 | none |
| Overview | 4 / 24 | 2 / 25 | sky, purple |
| Experiments (4 running) | 3 / 18 | 3 / 21 | none |
| Datasets | 1 / 1 | 1 / 3 | none |

Reading: where the React app was built from tiles and tables with the score ramp (runs, models, charts, experiments) it is
at parity. It falls behind exactly where the legacy used purple (task, kind, group identity), per-kind colour and
band-coloured bars (run detail, compare). Pixel share confirms the surface point: on run detail the React frames
are 50% void/base ground and 10% surface, versus legacy 7% and 47%; React has *more* chromatic pixels (4.6% vs 2.8%),
so "more colour" is not the fix.

### 4.2 Gap table

| # | Legacy | React | Why it matters | Proposed change |
|---|---|---|---|---|
| G1 | Bordered cards on surface, 3px tint rail per meaning, hover border | 25 page-local `.card` rules, 10 recipes, no states, near-invisible on the ground | Sections do not group; "grey boxes" is the user's own words (run details point 1) | New `Card` primitive with tone rail, interactive/selected/pressed states, replace page-local cards (sweep) |
| G2 | Category, group, kind values coloured by band or identity | Accent-teal bars, white percentages | Teal means "selected" elsewhere, so data looks selected; numbers with meaning carry none | Tone rules (5.2), `RateBar` delegates to `ScoreBar` bands, `ScoreValue` pill, Categories/Compare/Models sweep |
| G3 | Tinted icon tiles in stat cells; coloured values | `StatStrip` icon slot is muted, values neutral except 4 tones | Summary bands are the first thing read on a page | `StatStrip` tone per item + tinted icon tile + optional delta/trend |
| G4 | Scatter quadrants + pass/fail dots + error rings; grey histogram bulk with warm tail | Single blue dots, blue histogram | Charts are where "interactive" is expected; colour carries no outcome | Chart kit states and encodings (5.5) |
| G5 | Tiles brighten/lift on hover, pins and bars respond | About 6 real dead clickables, 55 `LinkButton`s with no feedback | The strongest single cause of "static" | Fix `LinkButton`; chart mark states; Card states; e2e dead-clickable audit |
| G6 | Bars grow (400 to 600ms ease-out), panels rise 250ms | Nothing animates in; fills snap | Data feels printed, not alive | Motion rules M2 to M4 |
| G7 | 8-colour compare palette | wraps at 5 | Runs 6 to 8 are indistinguishable from 1 to 3 | `--chart-6..8` and `runColor` over 8 |
| G8 | Purple = definition metadata (task tag, kind) | Purple only for version tags; task tag grey | One colour, one meaning; lost scan-ability of the Task column | Tag kinds (5.4) |
| G9 | Coloured dots on top-bar stats | Coloured values, no dots | Minor; keeps the stat identity | Optional, in the sweep (S6) |
| G10 | Emoji kind tiles | No kind icons | Kind identity needs a non-colour cue too | Add 4 icons to `Icon` |
| G11 | Hard-coded gradients/glows | None (correct) | Must not return | Q1: not restoring |
| G12 | Hover on rows is `--bg-hover` only | Same | Parity; no change | none |

---

## 5. Redesign spec

### 5.1 Principles

1. **One colour, one meaning per page.** Six encodings (table in 5.2); a hue may appear on a page as data only in its own encoding.
2. **Accent teal is interaction**: selected, primary action, link, focus, sort. Data marks use bands, status, delta or series, never the accent. Exception kept for parity: series 1 is `--chart-1` (teal), always accompanied by its letter and name.
3. **Colour is never the only cue** (WCAG 1.4.1): bands keep the 2px bar and `title`; delta keeps ▲▼≈ and a sign; severity keeps distinct glyphs (task ⚠, metric ⊗, trace ◷/warning, analysis ✦); series keep letter A to H.
4. **Surfaces group, tint informs.** A card separates a unit; a 3px rail carries its meaning; a faint wash is allowed only for danger and live states.
5. **Every actionable thing answers**, and nothing passive does. Hover only on things that act; passive Badge/Tag/KeyValue never hover.
6. **Calm motion.** Colour changes 150ms, data marks grow once 360ms, no hover transforms, no glow, no gradient; all off under `prefers-reduced-motion` (already global in `styles/base.css`).

### 5.2 The tinted information palette (inside existing tokens)

| Encoding | Meaning | Tokens (existing) | Applied through | Rule |
|---|---|---|---|---|
| **Band** | quality of a value (1 worst to 5 best) | `--score-1..5` | `ScoreValue`, `ScoreBar`, `RateBar`, histogram buckets, category/card rails, stat values | Direction-aware via `lib/metrics.ts`; a metric with no direction or a raw numeric stays neutral; errored values show "Error"/⚠ in `--error` / `--metric-error`, never a band |
| **Status** | lifecycle of a run/job/review | `--success` completed/approved, `--accent-secondary` running, `--error` failed/rejected, `--warning` stopped/draft, neutral submitted/pending | `Badge`, `RunStatusBadge`, hero rail | Running gets a pulsing dot (already `dot`); Approved adds a ✓ glyph so it is distinguishable from Completed |
| **Delta** | change vs a baseline | good `--score-5`, bad `--score-1`, flat `--text-muted` | `DeltaCell`, compare pills, `StatStrip` trend | Colour only when the change exceeds the noise band; "within noise" is flat (matches current compare "≈ +8.0 pts"); sign + arrow always; lower-is-better inverts |
| **Severity / kind** | what failed | task `--error`, metric `--metric-error`, trace `--warning`, analysis `--info` | 3px rail + glyph + title colour on cards and rows | Rail and glyph, never a filled card; counts in the section nav keep the tinted pill |
| **Series** | which run / model / category group | `--chart-1..5` plus new `--chart-6..8` | marker dot + letter, card rail, chart marks, group chips | Never used for good/bad; always paired with letter or name; order is stable per page (A = baseline) |
| **Definition metadata** | what was run: task, version, config | `--accent-tertiary` / `--accent-tertiary-soft` (purple) | `Tag kind=task|version|config` | Purple is only this; origin official = `info` badge, local = neutral; "mine" = accent tag |

Text-on-tint contrast (computed from tokens, text colour on the colour at 12% over `--bg-surface`): score-1/error 4.05 (fails AA), info `#3b82f6` 4.05, purple 3.80; all
others 5.2 or better. Therefore three text variants are required (token additions below): `--error-text`
(`color-mix(error 75%, text-primary)`, 5.15:1, already used inline by Badge and Tag), and use `--accent-secondary`
(5.51) for the info tone and `--accent-tertiary-soft` (5.36) for purple instead of the raw hues. Band 1 text on a tint uses `--error-text`.

### 5.3 Token additions (explicit)

Add to the "Added by the React migration" block of `frontend/src/styles/tokens.css` and log in
`docs/internal/ui-migration/decisions/foundation/OPEN_QUESTIONS.md`. Nothing existing changes.

```css
:root {
  /* Tint steps: how much of a tone mixes into transparent. */
  --tint-faint: 6%;    /* row/section wash (danger, live only) */
  --tint-soft: 12%;    /* Badge, Tag, Chip selected, ScorePill, icon tile fill */
  --tint-strong: 20%;  /* hover/pressed on a tinted fill, selected pill */
  --error-text: color-mix(in srgb, var(--error) 75%, var(--text-primary));  /* 5.15:1 on a 12% error tint */

  /* Series palette 6..8 (legacy compare COLORS, compare.html:5760). 1..5 are --chart-1..5. */
  --chart-6: #60a5fa;
  --chart-7: #34d399;
  --chart-8: #fb923c;

  /* Rail and card geometry. */
  --rail-width: 3px;
  --card-padding: var(--space-md) var(--space-lg);
  --card-padding-compact: var(--space-sm) var(--space-md);
  --shadow-card-hover: 0 2px 12px rgba(0, 0, 0, 0.28);

  /* Motion (extends round 1: --transition-fast, --motion-step, --ease-standard). */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);   /* legacy lt-rise curve */
  --motion-fill: 360ms;                         /* bars/rings/fills growing in or updating */
  --motion-stagger: 24ms;                       /* per-mark delay, capped at 10 marks */
  --motion-flash: 700ms;                        /* live value changed */
  --dim-opacity: 0.45;                          /* siblings of a hovered/selected mark */
}
```

New file `frontend/src/styles/tones.css` (global, imported next to `tokens.css`): maps a `data-tone`, `data-band` or
`data-series` attribute to two custom properties so primitives write one rule each instead of a block per tone.

```css
[data-tone='success'] { --tone: var(--success);          --tone-text: var(--success); }
[data-tone='info']    { --tone: var(--accent-secondary); --tone-text: var(--accent-secondary); }
[data-tone='warning'] { --tone: var(--warning);          --tone-text: var(--warning); }
[data-tone='danger']  { --tone: var(--error);            --tone-text: var(--error-text); }
[data-tone='accent']  { --tone: var(--accent-primary);   --tone-text: var(--accent-primary); }
[data-tone='meta']    { --tone: var(--accent-tertiary);  --tone-text: var(--accent-tertiary-soft); }
[data-tone='neutral'] { --tone: var(--text-muted);       --tone-text: var(--text-muted); }
[data-band='1'] { --tone: var(--score-1); --tone-text: var(--error-text); }
[data-band='2'] { --tone: var(--score-2); --tone-text: var(--score-2); }
/* 3, 4, 5 the same, --tone-text = --score-N */
[data-series='1'] { --tone: var(--chart-1); --tone-text: var(--chart-1); }
/* 2..8 the same */
```

Tint recipe used everywhere: `background: color-mix(in srgb, var(--tone) var(--tint-soft), transparent); color: var(--tone-text);`.
Existing primitives migrate to it so alphas stop drifting (Badge 9%, Tag 14%, Chip 12%, Button 14/22% all become soft/strong).

Design-language test additions (`src/__tests__/design-language.test.ts`): (a) the new tokens exist verbatim; (b) a **shrink-only ratchet**
on raw `rgba(` literals in `features/**` and `ui/**` (today 31 occurrences, 24 distinct; allowed list = the current ones; goal 0 outside tokens/tones);
(c) `tones.css` defines all 7 tones, 5 bands, 8 series; (d) `LinkButton` module contract: Button states are reachable from
an anchor (see 5.6 P1). Docs: add a "Colour as information" recipe to `DESIGN_LANGUAGE.md` section 3 (table 5.2 plus principles 5.1) and amend the
Badge, Tag, Chip, Scores and Data table recipes to reference `--tone`/`--tint-*`. No existing rule is relaxed.

### 5.4 Rules for when to use what

1. A value that is a score gets a band (pill in cards and stat strips, bar plus text in tables, text only inline). A value
   that is a count, latency or raw number stays `--text-primary` mono. Do not colour by magnitude.
2. A label that names a category of metadata uses a `Tag kind`: `task`, `version`, `config` = meta (purple), `dataset` = neutral with identicon,
   `model` = series dot + neutral tag, `owner` = avatar (series hue from the user id, Q3), `origin` = badge (official info, local neutral).
3. A group of related values (a metric card, a category value, an error type, a run) is a `Card` with a rail in the encoding's colour.
   One rail per card; a card inside a card is not allowed.
4. A chart mark takes its colour from the data's encoding (band for scores, outcome for pass/fail, series for runs, kind for spans), grey when it is bulk and
   tone when it is the interesting part (latency: bulk `--bg-active`, p90 `--score-3`, p95 `--score-2`).
5. Washes (6%) only for rows or cards that need attention: failed/error and live. Never zebra-tint.
6. At most one tint fill per row-height region: a table row with a status badge, a task tag and a score bar is already at the limit; do not add washes there.
7. Teal accent is not data (principle 2). `RateBar`, scatter dots and histogram bulk must stop using `--chart-1` / accent as their default.

### 5.5 Interaction states (rows, cards, chips, chart marks)

State attributes follow the existing convention (`data-hovered`, `data-pressed`, `data-selected`, `data-focus-visible`, `data-disabled`) for React Aria
elements and `:hover`, `:active`, `:focus-visible` for plain elements. Focus is the same everywhere: `outline: 2px solid var(--accent-primary); outline-offset: 2px`
(inset -2px inside clipped containers).

| Element | Rest | Hover | Pressed | Selected | Focus-visible | Notes |
|---|---|---|---|---|---|---|
| **Table row** (clickable) | zebra | `--bg-hover` (exists) | `--bg-active` | `--bg-selected` + 2px accent bar (exists) | inset outline (exists) | Add `rowState` wash: `danger` and `live` 6% over zebra; no change otherwise |
| **Card, passive** | `--bg-surface`, `--border-subtle`, rail optional | none | none | n/a | n/a | No hover on passive cards (principle 5) |
| **Card, interactive** | same | border `--border-default`, bg `--bg-elevated`, `--shadow-card-hover`, 150ms | bg `--bg-active` | border `--accent-primary`, bg `--bg-selected` (rail keeps its tone) | outline | `onPress`/`href` makes it interactive; renders `button`/`a` |
| **Chip** | outline | border `--border-strong`, text primary (exists) | bg `--bg-active` | accent (exists) | outline (exists) | Add: hover on **selected** = `--tint-strong`; `tone`/`series` prop makes the selected colour the encoding colour (category groups) |
| **Badge / Tag** | tinted | none | none | n/a | n/a | Passive. An actionable count is a `Chip`, not a Badge |
| **Button / LinkButton / IconButton** | per recipe | per recipe | per recipe | n/a | per recipe | Fix: `LinkButton` must expose the same states (5.6 P1); IconButton rule unchanged (glyph colour only, test `IconButton hover/focus/active`) |
| **Stat cell** (interactive only) | tinted icon tile | bg `--bg-hover` | `--bg-active` | `--tint-soft` of its tone + 2px underline in the tone | outline inset | Only when `onPress` (filter by this stat); otherwise passive |
| **Bar / bin / segment** | tone fill | `filter: brightness(1.12)`, siblings `opacity: var(--dim-opacity)` while any mark is hovered (`:has()`) | brightness 0.95 | 2px `--text-primary` outline, siblings dimmed | 2px accent outline | Cursor pointer only when the mark filters; native `title` replaced by `ChartTooltip` |
| **Scatter dot** | band/outcome fill, 0.7 opacity | opacity 1, `r 3.5 to 5`, 1.5px `--bg-surface` ring kept, tooltip | `r 5` plus accent ring | accent ring | accent ring | Hit area `r 10` transparent (touch) |
| **Heatmap / matrix cell** | tone fill | outline 1px `--text-primary`, row and column headers highlight | n/a | 2px outline | outline | Compare matrix: crosshair highlight of row and column |

Hover affordance for cards and marks is **colour, border and opacity only**. No `translateY`, no scale, no glow (keeps the IconButton and DataTable rules
coherent; legacy lifts and glows stay retired).

Touch (`@media (hover: none)`): reveal-on-hover parts (row actions, copy buttons: already handled) stay visible; pressed states carry the feedback; mark hit areas at least 24px;
chart tooltip opens on tap and pins (same behaviour as `HelpMarker`).

### 5.6 Motion rules (consistent with round 1)

All durations and curves are tokens; the global reduced-motion rule in `base.css` turns every one of these off, and the stagger delay is also set to 0 by
`@media (prefers-reduced-motion: reduce)` in the primitive.

| Rule | What | Timing | Where |
|---|---|---|---|
| M1 | Hover, press, focus, selection colour changes | `--transition-fast` (150ms) on `background-color, border-color, color, opacity, filter, box-shadow` only | every interactive primitive |
| M2 | **Data marks grow in once per mount**: bar fill `inline-size`, histogram `scaleY` from the bottom, ring dash, stacked segments `scaleX` from the logical start (flips in RTL) | `--motion-fill` (360ms) `--ease-out`; stagger `--motion-stagger` per mark, max 10 marks (240ms) | `ScoreBar`, `RateBar`, histograms, stacked bars, rings |
| M3 | **Value changes morph** (filter changes, live updates): same transition on the same properties, no replay of the entrance | 360ms `--ease-out` | same |
| M4 | Lazy section mount fades up | `--arrive-fade` (200ms) opacity plus 6px rise, once | `ReportSection lazy` body |
| M5 | Live value changed (SSE update on a running run): tint flash fades out | `--motion-flash` (700ms) `tint-soft` of info | `ScoreBar`/`StatStrip` value on `data-flash` |
| M6 | Expand/collapse | `Collapse` 180ms (unchanged) | existing |
| M7 | Toast, dialog, drawer, popover | unchanged (round 1) | existing |
| M8 | Never | hover transform, glow, gradient, infinite animation other than skeleton shimmer and the running-status dot | n/a |

Entrance animation is driven by a `data-enter` attribute set once by a `useFirstMount` hook (so a re-render, sort or filter does not replay it).

### 5.7 Per-primitive change list

| # | Primitive | Change | API |
|---|---|---|---|
| P1 | `LinkButton` / `Button` | Make anchor states real: add `:hover` and `:active` selectors beside each `[data-hovered]`/`[data-pressed]`/`[data-focus-visible]` rule in `Button.module.css` (or wrap RAC `Link`). Add test: a rendered `LinkButton` has a computed background change on hover and press | none |
| P2 | `Badge` | Rewrite on `--tone`: `color: var(--tone-text); border-color: var(--tone); background: tint-soft`. Add `glyph?: ReactNode` (Approved ✓). Still passive | `tone` unchanged, new `glyph` |
| P3 | `Tag` | Add `kind='task' | 'config' | 'dataset' | 'model' | 'origin'`; `task`, `version`, `config` use tone `meta`; `model` renders the series dot. `data-tone` path replaces the per-tone blocks | `kind` extended; optional `series?: 1-8` |
| P4 | `Chip` | `tone?`, `series?` props set `data-tone`/`data-series`; selected uses `--tone` (default accent); hover on selected `--tint-strong`; pressed `--bg-active` | `tone?: ChipTone; series?: 1-8` |
| P5 | `ScoreValue` | New `variant='text' (default) | 'pill'`. Pill: `tint-soft` fill of the band, text `--tone-text`, 20px high, keeps the 2px bar/title as non-colour cue and the ⚠/↻/CI children. Neutral when no direction | `variant?` |
| P6 | `ScoreBar` (cells) | M2/M3 on `.fill`; `size='sm'(6px) | 'lg'(14px, value inside the bar, for Charts matrix)`; `max`/`color` unchanged | `size?` |
| P7 | `RateBar` (run-detail charts) | Delete its own colour logic: delegate to `ScoreBar`/band; `tone` prop only for series use (`series?: 1-8`) | `tone` replaced by `band`/`series` |
| P8 | `StatStrip` | Per item: `tone?` extended to `'info' | 'success' | 'warning' | 'danger' | 'accent' | 'meta' | 'neutral'`; `icon` renders in a 24px tile (`tint-soft` of the tone, glyph in `--tone-text`); `trend?: {delta: number; verdict: 'good'|'bad'|'flat'; label: string}` renders the delta pill; `onPress?` makes the cell a button with hover/pressed/selected | `items[].tone/trend/onPress` |
| P9 | `KeyValueGrid` | Per item: `kind?: 'config' | 'metadata' | 'default'` (label suffix and a `meta` tint for config/metadata), `tone?`, `icon?`; `variant='tiles'` with `--bg-elevated` tiles at card rhythm for the hero "Execution context" (answers run details point 1) | `items[].kind/tone/icon`, `variant?` |
| P10 | `DataTable` | `rowState` gains `tint` wash for `error` and `live` (6%), `DeltaCell` renders the pill variant when `emphasis`, no change to hover/zebra/selected | `DeltaCell emphasis?` |
| P11 | **New `Card`** | See 5.8 | see 5.8 |
| P12 | **New chart kit** `ui/Chart/` | `ChartTooltip`, `useMarkHover` (sibling dim via `:has`), `Mark` (button-or-g wrapper with the 5.5 states), `Scatter`/`Histogram`/`StackBar` moved out of run-detail and given the encodings below | see 5.9 |
| P13 | `Icon` | Add `wrench`, `brain` (LLM), `bot` (agent), `target` (eval); keep outlines, 16px grid | names only |
| P14 | `ReportSection` | `lazy` bodies get the M4 arrival | none |

### 5.8 `Card` primitive (new)

```ts
interface CardProps {
  tone?: 'success'|'info'|'warning'|'danger'|'accent'|'meta'|'neutral'; // rail colour; default none
  band?: 1|2|3|4|5;                // rail from a score band
  series?: 1|2|3|4|5|6|7|8;        // rail from a series colour
  rail?: 'start' | 'none';         // default 'start' when a tone/band/series is set
  wash?: 'danger' | 'live';        // faint 6% tint, the only two allowed
  compact?: boolean;               // --card-padding-compact
  onPress?: () => void; href?: string; to?: string;   // makes it interactive
  isSelected?: boolean;
  as?: 'div'|'section'|'article'|'li';
  header?: ReactNode; footer?: ReactNode;             // optional structure, hairline between
}
```

Recipe: `--bg-surface`, `1px solid --border-subtle`, `--radius-md`, `--card-padding`, rail = `border-inline-start: var(--rail-width) solid var(--tone)` (logical, so RTL
mirrors), states per 5.5. The first line of `Card.module.css` names the recipe (the design test requires it) and the gallery shows every tone and state.

```
 passive              interactive (hover)           selected
+-|---------------+   +-|---------------+          +-|---------------+
|3|  Quality      |   |3|  Quality   >  |          |3|  Quality      |  accent border
|r|  49.4%  (pill)|   |r|  49.4%        |  border  |r|  49.4%        |  bg-selected
|a|  237 items    |   |a|  237 items    |  strong  |a|  237 items    |
|i|               |   |i|               |  +shadow |i|               |
|l+---------------+   |l+---------------+          |l+---------------+
```

### 5.9 Chart encodings (for `ui/Chart` and the run-detail/compare charts)

| Chart | Today | Target |
|---|---|---|
| Score histogram (Overview) | band-coloured buckets (good) | add M2 grow, hover state 5.5, `ChartTooltip` with count and %, click selects (outline) |
| Latency histogram | all `--chart-2`, p90/p95 tinted | bulk `--bg-active`, bins above p90 `--score-3`, above p95 `--score-2`, error portion hatched (exists); pins get hover |
| Quality vs latency scatter | single blue | dot fill by outcome: pass = band 5, fail = band 1 at 0.7 opacity; task error = open ring `--error` on the x axis; two faint wash rectangles (fast and passing: success `tint-faint`, slow and failing: danger `tint-faint`) with the label in the corner; legend with the same swatches |
| Time budget stacked bar | span-kind colours (good) | add the kind icon tile in the stat cards (P13) and M2 `scaleX`; hover dims the other segments and highlights the matching card |
| Correlation matrix | blue to pink diverging | keep; add cell hover outline and tooltip |
| Category/rate bars | accent | band via `ScoreBar` (P7) |
| Compare per-run averages | neutral text | `ScoreValue pill` per run, `DeltaCell` pill vs baseline (noise rule), series dot header |
| Compare cross-highlight | none | hovering a run marker, legend entry, matrix column or chart series sets `data-series-active=N` on the report root; every mark with a different `data-series` dims to `--dim-opacity` |

Tooltip: `ChartTooltip` is the existing `Tooltip` primitive positioned by the pointer or mark (so it is `role="tooltip"`, keyboard-focusable via the mark); it replaces
the native `<title>`, which appears after about a second and cannot carry markup.

### 5.10 Wireframes (desktop 1280+, and 390)

Run detail summary and category band cards (desktop):

```
 Overview                                         [Items 240] [Completed 237] [Errors 20] [Not received 3]
                                                    (blue tile) (green tile)   (red tile)   (amber tile)
+-|------------------------+ +-|------------------------+ +-|------------------------+
|R|  exact_match   (19.8%) | |O|  quality       (49.4%) | |O|  hallucination (47.7%)|   rail + pill = band
|e|  ▕██▎░░░░░░░░░░         | |r|  ▕▇▇▇▇▇▇▇▇▇▇▇ buckets  | |r|  ▕▇▇▇▇▇▇▇▇▇▇▇          |   bars grow in 360ms
|d|  Pass 20% Fail 75% ...  | |a|  8 scorer errors       | |a|  12 errors              |
+-|------------------------+ +-|------------------------+ +-|------------------------+

 Categories     [complexity 4]  [domain 5]  [source 2]         <- chips take the group series colour when selected
 complexity  quality · overall (49%)
 +-|---------+ +-|---------+ +-|---------+ +-|---------+     rail and bar = band of the value
 |g| easy    | |y| medium  | |o| hard    | |p| expert  |     (80% lime, 49% orange, 48% orange, 25% red)
 |r| 80% ▕██▕ | |e| 49% ▕█▕ | |a| 48% ▕█▕ | |r| 25% ▕▌▕ |
 |n| 54 items | |l| 51 items| |n| ...     | |e| ...     |
 +-|---------+ +-|---------+ +-|---------+ +-|---------+
```

Compare, per-run averages (desktop):

```
 Run            correct               quality               Latency   Errors
 ●A baseline    [ 20.0% ]  baseline   [ 47.0% ]  baseline   1.3s      2 task · 1 scorer
 ●B sonnet-4    [ 37.5% ]  ▲ +17.5    [ 62.3% ]  ▲ +15.3    1.3s ▼-3%  1 task · 2 scorer
 ●C gpt-5-nano  [  5.0% ]  ▼ -15.0    [ 36.2% ]  ▼ -10.8    1.2s      1 task · 2 scorer
 [ n% ] = ScoreValue pill (band tint)   ▲▼ pill only outside the noise band, else  ≈ +8.0 pts (flat)
 hovering ●B (dot, legend, matrix column or chart series) dims every mark of A, C, D to 45%
```

Mobile (390): cards stack one per row, the rail stays on the inline start, `StatStrip` is a 2-column grid (exists at 800px), score pills drop the CI text, chart tooltips open on tap and pin,
hit areas 24px, no hover-only reveal.

```
+-|-------------------+
|R| exact_match  19.8%|
|e| ▕██▎░░░░░░░░       |
|d| Pass 20% Fail 75% |
+-|-------------------+
```

Responsive rules: 1920 uses the same tokens; card grid stays container-query driven (2/3/4 per row, already `ReportSection`); at 768 the stat strip wraps to 2 columns and the compare cross-highlight
still works from the legend; at 390 the rules above.

---

## 6. Work plan

Hours are implementation plus tests for one agent. "Dep" = must land first. Each task ends with `npm run check`, `pytest tests/platform/test_design_language.py`, and a pass over `/__ui`.

### Foundation (visual-language owner, the three area agents wait only on T1, T2, T3 and T5)

| ID | Task | Files | Tests | h | Dep |
|---|---|---|---|---|---|
| T1 | Tokens, `tones.css`, motion tokens, `DESIGN_LANGUAGE.md` recipe, design test ratchet | `styles/tokens.css`, `styles/tones.css` (new), `main.tsx` import, `docs/DESIGN_LANGUAGE.md`, `__tests__/design-language.test.ts`, `decisions/foundation/OPEN_QUESTIONS.md` | design test | 4 | none |
| T2 | `Card` primitive plus gallery section | `ui/Card/*`, `ui/index.ts`, `dev/` gallery | Vitest states (data attrs, rail, interactive role, selected), axe | 5 | T1 |
| T3 | `LinkButton`/`Button` anchor states (P1) | `ui/Button/Button.module.css`, `ui/LinkButton/*` | Vitest computed style on `:hover` via class assertion; Playwright hover on "Export HTML" | 1.5 | none |
| T4 | `Badge`, `Tag`, `Chip` on `--tone` plus new props (P2 to P4) | `ui/Badge`, `ui/Tag`, `ui/Chip` | primitives tests, design test contracts | 4 | T1 |
| T5 | `ScoreValue` pill, `ScoreBar` size/motion, `RateBar` delegation (P5 to P7), `useFirstMount` | `ui/ScoreValue`, `ui/DataTable/cells`, `ui/motion/useFirstMount.ts` (new), `run-detail/components/charts/Charts.tsx` | band tests, motion class set once, reduced motion | 5 | T1 |
| T6 | `StatStrip` tones/tiles/trend/onPress (P8) | `ui/StatStrip` | Vitest | 4 | T1 |
| T7 | `KeyValueGrid` kinds/tiles (P9) | `ui/KeyValueGrid` | Vitest | 3 | T1 |
| T8 | Chart kit (P12): `ChartTooltip`, mark states, sibling dim, scatter outcome and quadrants, latency bulk/tail, series palette 6 to 8, `runColor` over 8, cross-highlight context | `ui/Chart/*`, `compare/CompareContext.tsx`, run-detail charts | Vitest for model and a11y, Playwright hover specs | 10 | T1, T5 |
| T9 | `DataTable` row wash and `DeltaCell` pill (P10) | `ui/DataTable` | table tests | 3 | T1, T5 |
| T10 | `Icon` additions (P13), `ReportSection` arrival (P14) | `ui/Icon`, `ui/ReportSection` | snapshot of names | 2 | T1 |
| T11 | E2E: dead-clickable audit (pixel diff, allow-list for selected controls) on runs, run detail, compare; reduced-motion spec (`getAnimations()` is empty with emulation); contrast axe on tinted primitives | `frontend/e2e/visual-language/{hover-audit,motion,contrast}.spec.ts` | those | 4 | T2 to T9 |

Foundation total about 45.5h. Independent from the start: T1, T3. After T1: T2, T4, T5, T6, T7, T10 in parallel. After T5: T8, T9. T11 last.

### Area application (each area agent applies the palette to its own page; reuse, do not restyle primitives)

| ID | Area | Checklist | h |
|---|---|---|---|
| A1 | **Runs page** | Task tag kind `task`; dataset tag neutral; row wash for failed and live; filter chips take the status tone when selected (Chip `tone`); owner avatar hue (Q3); score cells with M2 grow; top-bar stats keep value colours (dots optional S6); `Analyze` action tone meta; stat summary in the pass-analysis section uses `StatStrip` tones; filters shown directly (other area) get Chip states; check `ScoreBar` lg for passes analysis | 5 |
| A2 | **Run detail** | Hero: status rail (3px on hero card, `Card tone`), `KeyValueGrid variant=tiles` with `config`/`metadata` kinds replaces grey boxes; StatStrip tones and tinted tiles; metric cards `Card band`; Categories: `Card band` per value, group chips in series colours, `RateBar` via bands; Errors: `Card tone` severity with glyphs, interactive states; Latency: kind tiles with icons, scatter and histogram encodings (T8); Deep: heatmap hover; Repeat: `Chip series` for passes, bands for pass@k; Items: left rail by outcome (exists) plus pass/fail tags, JSON sections as `Card`s; every dead clickable from 3.3 fixed | 12 |
| A3 | **Compare** | Run cards as `Card series` with rail and letter; per-run averages with `ScoreValue pill` and `DeltaCell` pill outside the noise band; metric tiles with tinted icons; distribution and error cards interactive (states); cross-highlight context (T8); palette over 8; matrix crosshair; categories as run-detail | 9 |

### General sweep (one agent, after T1 to T10, independent of A1 to A3, about 14h)

| ID | Task | h |
|---|---|---|
| S1 | Replace the 25 page-local `.card` classes with `Card` (listed by `grep -rl "^\.card" frontend/src`); keep layouts, delete CSS | 8 |
| S2 | Replace the 31 `rgba(` tint literals with `--tone` recipe; lower the ratchet to 0 outside `tokens.css`/`tones.css` | 2 |
| S3 | Models page: ranking list with bands and medal glyph, metric tiles already coloured; Overview: stat tones, live and approved empty states keep icon; Charts page: `ScoreBar size=lg` with value inside the bar for the matrix | 2 |
| S4 | Experiments (progress and status tones), Datasets (type tags), Reviews (state tones), Settings (danger zone tone) | 1.5 |
| S5 | Sweep `cursor:pointer` elements without feedback using the e2e audit; fix or remove the pointer | 0.5 |
| S6 | Optional: coloured dots on top-bar stats | 0.5 |

Grand total about 86h (foundation 45.5, areas 26, sweep 14.5).

Risks: (1) `color-mix` needs Chrome 111, Safari 16.2, Firefox 113, already used in `Button`, `Tag`, `Badge`; no new floor. (2) Sibling dimming with `:has()` needs Chrome 105, Safari 15.4, Firefox 121; fall back to no dimming (graceful). (3) Tints lower text contrast: only the three text variants listed are allowed; the e2e contrast spec guards it. (4) Card migration touches 25 files with visual diffs; do it with screenshots per page. (5) Entrance motion over a 5,000-item page: marks are capped at 10 staggered and only visible, lazily mounted sections animate. (6) Area agents and this foundation touch `ui/` simultaneously; T1 to T5 must merge before A1 to A3 start styling, otherwise they invent local colours again.

---

## 7. Open questions (recommended default is what implementation uses)

| # | Question | Default |
|---|---|---|
| Q1 | Restore the legacy gradient top line, glows and button lifts? | No. They conflict with the icon-action rule and add noise; the 3px rail and tint carry the same information |
| Q2 | Should series 1 stay teal (`--chart-1`, same as the accent)? | Yes, for parity with legacy model colours, always with letter and name; selection never relies on teal alone |
| Q3 | Owner avatar hue by user id (series palette) or keep one teal avatar? | By user id, series palette; the "mine" marker remains the accent tag |
| Q4 | Row washes for failed and live rows? | Yes, 6%, only those two states |
| Q5 | Distinguish Approved from Completed (both success today)? | Add a check glyph to Approved; same tone |
| Q6 | Task tag purple (legacy) vs neutral? | Purple (`meta`), shared with version and config tags |
| Q7 | Custom chart tooltips instead of native titles? | Yes, `ChartTooltip` |
| Q8 | Entrance animation on by default for all data marks? | Yes, once per mount, 360ms, off under reduced motion; no user setting |
| Q9 | Card wash vs rail only? | Rail only, wash only for danger and live |
| Q10 | Emoji kind tiles vs outline icons? | Outline icons (T10), consistent with the rest of the app |

---

## Summary for the orchestrator

1. Premise corrected by measurement: colour count is near parity (React 8 vs legacy 10 hues on run detail, 8 vs 9 on compare, equal on runs/models/charts); the "static" feel comes from where colour sits, flat surfaces, dead clickables and no motion.
2. Biggest gap 1: no `Card` primitive (25 page-local `.card` rules, 10 recipes, 3 with hover); cards are 1.06:1 against the ground, hence "grey boxes".
3. Gap 2: data without encoding: Categories bars all accent teal (`RateBar` default), compare averages, models ranking, chart marks one colour; legacy used bands, kind and group colours.
4. Gap 3: feedback: `LinkButton` has no hover or press style (55 usages, CSS keys on RAC data attributes); about 6 more dead clickables on run detail, 4 on compare (legacy about 2 and 0).
5. Gap 4: no data motion (fills snap), compare palette wraps at 5 colours while it supports 8.
6. Spec: one-colour-one-meaning palette (band, status, delta, severity, series, definition metadata) on existing tokens; additions are `--tint-faint/soft/strong`, `--error-text`, `--chart-6..8`, rail/card/motion tokens and a global `tones.css`; no value of any existing token changes; no glow, gradient or hover transform.
7. New primitives: `Card` (tone/band/series rail, interactive states) and a chart kit (`ChartTooltip`, mark states, sibling dim, cross-highlight); changes to Badge, Tag, Chip, ScoreValue pill, ScoreBar, RateBar, StatStrip, KeyValueGrid, DataTable row wash, LinkButton, Icon.
8. Work plan: foundation 45.5h (T1 and T3 start immediately, T2/T4 to T7/T10 parallel after T1), areas runs 5h, run detail 12h, compare 9h, sweep 14.5h; total about 86h.
9. Tests: tokens/`tones.css`/rgba-ratchet in the design test, primitive Vitest states, Playwright dead-clickable pixel audit, reduced-motion and contrast specs.
10. Defaults: no gradients/glows (Q1), series 1 stays teal (Q2), owner hue by id (Q3), 6% wash only for failed/live (Q4), check glyph on Approved (Q5), task tag purple (Q6), custom chart tooltips (Q7), entrance animation once (Q8), rail only (Q9), outline icons (Q10).

---

## Decisions (implementation of the foundation T1 to T11 and sweep S1 to S6)

All ten open questions use the recommended defaults (Q1 no gradients, glows or lifts; Q2 series 1 stays teal; Q3 owner
avatar hue by id is left to A1; Q4 6% wash for failed and live rows; Q5 check glyph on Approved; Q6 task tag purple;
Q7 custom chart tooltips; Q8 entrance animation on by default, once; Q9 rail only, wash for danger and live; Q10 outline icons).

- **Tokens.** Added exactly the 5.3 block plus `--hover-brightness` (1.12), `--scrim`, `--scrim-light` and `--scrollbar-*`
  (so `base.css` and the dialogs have no raw `rgba()`). `--shadow-card-hover` keeps its one rgba inside `tokens.css`.
  New global `styles/marks.css` (chart mark states, series cross-highlight) next to `tones.css`; both are imported by
  `main.tsx` and the SDK viewer entry.
- **Ratchets are zero, not shrink-only.** Raw `rgba(` outside `tokens.css` is 0 (the 31 literals of the brief were 17 by
  the time of this pass; Badge, Tag, Chip and Button went through the tone recipe, scrims and scrollbars became tokens).
  `.card` declared by a page is 0 except the entries in the allow-list of the design test (see S1 below).
- **Card.** Interactive cards render `div role="button"` (not `button`) so a card can hold block content; the contract is
  that an interactive card holds no other interactive element. Selected fill is `--tint-soft` of the accent (the brief's
  `--bg-selected` is a translucent colour and does not composite over the surface). Hover brightens nothing: border,
  fill and `--shadow-card-hover` only.
- **Chart kit location.** `Scatter`, histogram and split bar stayed in `run-detail/components/charts/Charts.tsx`
  (moving them would collide with A2 and A3, which edit them next); the reusable parts live in `ui/Chart`
  (`ChartTooltipHost`, `Mark`, `SeriesHighlightRoot`, `useSeriesHighlight`) and are used by every chart there.
  Scatter dots stay pointer-only (`tabIndex -1`); the items table is the keyboard route (1,500 tab stops would be a trap).
- **Scatter encodings.** Outcome comes from `LatencyItem.passed`; task errors are plotted on the x axis as open rings;
  quadrant washes use the median latency and a 0.5 score split and only appear for metrics that declare a direction.
- **Motion.** `useEntrance` (container flag times the first-mount flag) is the single gate: `DataTable` turns the flag off
  after its first paint of data, so virtualised rows that scroll in, sort or page never replay the grow-in. The flash
  attribute is `data-changed` (the global `[data-flash]` already outlines launch-form fields). `base.css` also zeroes
  `animation-delay` and `transition-delay` under reduced motion so the stagger cannot hold a mark invisible.
- **ScoreValue pill** drops the 2px bar (a bar on a pill reads as a bug); the number and `Band n of 5` title remain the
  non-colour cue. Band 1 text now uses `--error-text` (5.15:1) on text and pill.
- **ScoreBar lg** draws the value twice (void colour clipped to the fill, primary colour over the track) so it stays AA at
  any fill; it needs `container-type` on the track (`100cqw`).
- **StatStrip** with `onPress` renders a `button` inside the cell and moves `help` outside it (no nested buttons).
- **S3.** Models ranking values are band pills (`ScoreValue variant="pill"`, medal glyph already present). The brief's
  "Charts page: ScoreBar lg for the matrix" has no target: the Charts page has no matrix (`ScoreBar size="lg"` exists and is
  in the gallery for the passes analysis of A1). Overview stat tones were already set.
- **S4.** Experiments, Datasets, Reviews and Settings already used `Badge`/`Tag` tones and `Card tone="danger"` after S1;
  Reviews Approved got the check glyph.
- **S5.** The hover audit (`e2e/visual-language/hover-audit.spec.ts`) found the dead clickables; fixed here: `LinkButton`,
  latency pins, bins and steps header buttons, correlation matrix cells, chart marks. Still pending (A3, listed in the
  spec's `PENDING` set, which must shrink to empty): compare `_seg`, `_distBar`, `_rowButton`.
- **S6** (coloured dots on top-bar stats) is not done; it is optional in the brief.
- **Commit trailer.** Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (the attribution the
  environment prescribes) instead of the Fable line quoted in the implementation brief.
