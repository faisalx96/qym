# Round 8b design: section separation on the compare and run-detail pages

**Decision (owner decision H6, 2026-10-27, final): recipe A "framed section" on both pages. Recipe B is dropped; its measurements stay in 2.4 and section 4 as the record.**

Branch `ui/redesign8-sections` (from the round-8 tip 0a709a6f). Owner, 2026-10-26: "enhance segments separation from UI viewpoint"
on the compare page and the run details. Dark theme, Chromium, production build on 8984, seeds `seed-compare.ts` (4 runs, plus 4 extra
runs) and the run-detail `seedAll` repeat run (Overview, Repeat, Latency, Deep, Categories, Errors, Items; Reviews, Datasets and
Root cause do not exist in that seed: they use the same primitive, so their boundaries follow the same rule).

## 1. Method and mock kind

- The composed mocks are the **real pages with the recipe stylesheet injected** (`sections/measure/recipe-a.css`, `recipe-b.css`),
  shot by the scripts in `sections/measure/` (`sec-seed.mts`, `sec-measure.mts`, `sec-shots.mts`, `sec-p1.mts`, `sec-nav.mts`; they expect `S` = a scratch dir holding `sec-ids.json` from `sec-seed.mts`, and the platform on 8984). The
  recipe CSS targets `section[data-report-section]` and `section#run-items`, which is exactly what the implementation unifies.
  For recipe A the script also moves every descendant of a panel body that is painted `--bg-surface` to `--bg-elevated` and clears
  the colour of its 1px border (the "inner cards" rule); the compare page's 14 px flex gap is compensated by a smaller margin in the
  mock (the implementation sets that gap to 0 and the primitive owns every distance).
- `/__ui#round8b` holds the boundary specimens of both recipes (`features/dev/Round8bMocks.tsx`, real `SectionHeader`).
- Shots (all in `sections/shots/`): `current-{compare,run}-{1440,390}.png`, `mock-sections-{A,B}-{compare,run}-{1440,390}.png`,
  `mock-sections-{A,B}-boundary-{compare,run}-1440.png` (compare: Averages to Overview; run: Repeat to Latency).
- "Gap" = distance from the last painted pixel of the previous section body to the next title's top. "Edge gap" = previous section
  bottom edge to next section top edge (rule or panel edge). Contrast of a rule is against the backdrop it is drawn on
  (`--bg-base`: 1.33 subtle, 1.69 default, 2.42 strong; against the measured shell backdrop 1.37 / 2.51).

## 2. Measurements

### 2.1 Current React pages (all three widths give the same numbers; only the head height changes with wrapping controls)

| Boundary (every one of 6 compare / 7 run) | gap | edge gap | rule | title | panel |
|---|---|---|---|---|---|
| Compare: Runs to Averages, ..., Errors to Items | 28 (30 before Overview) | 14 (page flex gap) | none | 18/650 | none |
| Run: Overview to Repeat, ..., Errors to Items | 69 (48 margin + 1 rule + 20 padding) | 0 | 1px `--border-subtle`, 1.37:1 | 18/650 | none |

Head height (title + description) is 42 at 1440 on compare (57 at 1024, 65 to 129 at 390), 44 to 66 on run (66 to 178 at 390).
Can a reader tell where a section ends? Compare: no. Sections are told apart only by the 18/650 title; 28 px is below the 32 px
gap between the cards inside one section's body (Category cards, stat boxes), so a title looks like a card caption, not a section start.
Run: partly. The 1.37:1 hairline is as faint as the 1.33:1 card borders inside the bodies, so it reads as one more card edge, not as a rule.

### 2.2 Legacy pages (read-only checkout, 8980)

| Page | gap / spacing | rule | title | panels |
|---|---|---|---|---|
| Compare | 32 px margin under each block (title top to previous bottom 32) | none | 13/600 (Averages), 15/600 (others) | only Comparison stats (1px #333348, 20 padding) and Item-by-item (1px #252536, 14 padding, 30% surface) |
| Run | 48 margin + 1px #252536 (1.28:1) + 20 padding = same recipe as today's React page | 1px | 18/650 | none |

So the legacy compare page already had 32 px and partial panels; round 8's compare recipe (28, none, 18/650) is a step back in
separation while the type grew. Legacy run is today's recipe; the owner's comment on it ("the run details") is a verdict on that recipe too.

### 2.3 Recipe A "framed section" (injected on the real pages)

| Page | gap | edge gap | boundary mark | head | C-page-1 |
|---|---|---|---|---|---|
| Compare, 1440 / 1024 / 390 | 50 (52 before Overview) | 20 | panel edge 1px `--border-subtle` (1.33:1), fill `--bg-surface` (1.06:1) | 42 to 163 | see 4 |
| Run, 1440 / 1024 / 390 | 50 | 20 | same | 44 to 142 | n/a |

### 2.4 Recipe B "rhythm and rule" (record only, dropped by owner decision H6)

| Page | gap | edge gap | boundary mark | head | C-page-1 |
|---|---|---|---|---|---|
| Compare, 1440 / 1024 / 390 | 63 (65 before Overview) | 48 | 1px `--border-strong` rule, 2.42:1 (2.51 measured), full column | 42 to 163 | see 4 |
| Run, 1440 / 1024 / 390 | 63 | 48 | same | 44 to 142 | n/a |

Jump check (C-nav-2, 1440, click "Overview" in the nav): current section top 10 px under the nav (title 25); A 10 (title 26); B 10
(title 26). The existing tolerance (12 +/- 4) holds with `scroll-margin` unchanged: the rule or panel edge is the anchor, so the
reader sees the boundary, then the title. The scroll-spy is untouched (the same elements are observed).

## 3. The recipe (A, owner decision H6)

One primitive: `ReportSection` (+ `SectionHeader level="xl"`). `CompareSection` is deleted and the compare page renders `ReportSection`
(it keeps `data-part=section-<key>` through a `part` prop, the `aside` slot and one description). The run page's Items section
(`ItemsSection`, today its own `<section>` with a `SectionHeader`) renders through the same primitive too: it is the one run section
that does not carry `data-report-section` today. Page flex gaps are 0; the primitive owns every distance. The first section has no
lead-in and no rule or panel top margin (as today).

### Recipe A: framed section (chosen, owner decision H6)

- `section[data-part=section]`: `background: var(--bg-surface)`, `border: 1px solid var(--border-subtle)`, `border-radius: var(--radius-md)`,
  `padding: var(--space-md)` (14), `margin-block-start: var(--space-lg)` (20) except the first.
- `data-part=section-head` is the band at the top of the panel: no border, no extra padding; 14 px (`--space-md`) to the body.
- Inner cards (run cards, averages table frame, stat boxes, category cards, error cards, item rows, chart frames): `--bg-elevated`
  fill and **no border** (`border-color: transparent`, so geometry does not move). That is the one amendment of Card inside a section
  panel: a card whose parent is a section panel is a `tone="inset"` card, surface to elevated, 1.10:1 on the panel. Panel horizontal
  padding must stay 14: at 20 the four 17.5rem run cards no longer fit one row at 1440 (measured: cards bottom 801).
- Dark/light: tokens only.

## 4. C-page-1 cost (compare, 1440x900, 4 runs)

| | run cards bottom (ceiling 530) | averages table bottom (ceiling 900) | averages title top |
|---|---|---|---|
| current | 510 | 877 | 538 |
| A | 511 | 900 (0 px slack) | 561 |
| B | 496 | 898 (2 px slack) | 559 |

A costs +23 px and B +21 px; both stay inside the ceiling, **no amendment needed**, but only because A uses 14 px panel padding
and a 20 px panel gap and B drops the first section's 14 px top padding (cards bottom 510 to 496) and uses a 48 px lead-in. Any larger
lead-in breaks it: B with a 56 px lead-in gives table bottom 906, with 64 px 934 (that earlier draft needed a 940 ceiling; rejected).
The other widths are unconstrained by C-page-1 (C-page-5/6 page heights: B adds 6 x (63-28) = 210 px to the 4-run compare page, A 6 x 22 = 132 px plus panel padding 6 x 30 = 180).

## 5. Acceptance criteria

Common:

- **C-sec-1** One primitive: every top-level section of both pages (`section[data-report-section]`, including run Items) renders through `ReportSection`;
  `CompareSection` no longer exists; the section's `data-part` is `section` (compare also keeps `section-<key>`), its head `section-head`.
- **C-sec-2** The title is `--font-xl` (18) / 650 on both pages, the description `--font-sm` muted (amended in implementation, owner decision H6: `--font-base` was measured at Averages table bottom 905.05 > 900 at 1440x900; the compare page already used `--font-sm`), at most two lines at >= 1024 (one at 1440) and wrapping (never an ellipsis) at 390.
- **C-sec-3** Same numbers at 1440, 1024 and 390: the measured gap and edge gap below are identical on both pages (tolerance 1 px), and the first section has no lead-in.
- **C-sec-4** C-page-1 holds unamended (cards bottom <= 530, table bottom <= 900 at 1440x900); C-nav-2 (section top lands 12 +/- 4 under the nav) and the scroll-spy still pass.
- **C-sec-5** No horizontal scroll at 390, no nested card (no bordered, same-fill surface inside another).
- **C-sec-6** The hue budget is unchanged: rule, rail and panel use only neutral tokens.

Recipe A (owner decision H6):

- **C-sec-A1** Every section is a panel: `background --bg-surface`, 1px `--border-subtle`, `border-radius --radius-md` (8), padding 14 on all four sides; panel width equals the content column.
- **C-sec-A2** Edge gap between panels = 20 +/- 1 on both pages; gap (previous last painted pixel to next title top) = 50 +/- 2.
- **C-sec-A3** `section-head` is inside the panel: first child, no border, 14 px to the body; no `section-rule` element exists.
- **C-sec-A4** Cards directly or indirectly inside a panel body paint `--bg-elevated` with a transparent border (computed fill rgb(34,34,50)); none paints `--bg-surface` with a visible border.
- **C-sec-A5** Four run cards still sit in one row at 1440 (cards bottom <= 530) with panel padding 14; at 1024 and 390 the cards reflow as in round 8 (C-run-1).
- **C-sec-A6** Averages table bottom <= 900 at 1440x900 (measured 900; no slack: any change to the head height breaks it).

## 6. Design-language amendment (section 3.2, replaces the "Run section header" rule; applies to both pages)

> **Report section** (`ReportSection`, used by the run page and the compare page; `CompareSection` is retired). Every top-level
> section opens with a `section-head`: a `--font-xl` / 650 primary title, one muted `--font-sm` description line and the section
> controls on the right. A section is a panel
> (`--bg-surface`, 1px `--border-subtle`, `--radius-md`, 14px padding) 20px under the previous one with the head inside it; a card
> inside a section panel is an inset card (`--bg-elevated`, no border). The first section has no lead-in or rule. The primitive
> owns the spacing: pages set no gap between sections and sections add no margin of their own. Reason (section 6 amendment rule):
> measured on both pages, the current 1.33:1 hairline is as faint as the card borders in the bodies, and the compare page had 28px
> and no mark; the same rule on both pages replaces two recipes.

## 7. Decision

The design recommended recipe B; the owner chose recipe A on both pages (**owner decision H6**, 2026-10-27, final). Recipe B and its criteria (C-sec-B1..B5) are deleted from this document; the measurements of 2.4 and section 4 remain as the record. A's costs, as the design measured them: the panel edge is the same 1.33:1 line, the gap (50) is smaller than the run page's old 69, panel padding must stay 14 (at 20 the four run cards wrap, cards bottom 801), the first screen ends at exactly 900, and every card family needs the inset variant (done by the `--bg-surface` / `--card-edge` redefinition in the section body, see `sections-impl-notes.md`).

## 8. E2E list for the implementation

`r8-page`: C-page-1 (unamended), C-nav-2, scroll-spy; new `r8b-sections.spec.ts` (compare, run Repeat seed): C-sec-1..6 and C-sec-A1..6 at 1440, 1024
and 390; `run-detail/cutover-layout.spec.ts` (the hairline assertion becomes the panel assertion); `visual-language` gallery spec for `/__ui#round8b`;
`pytest tests/platform/test_design_language.py`; after-shots `after-sections-{compare,run}-{1440,390}.png`.
