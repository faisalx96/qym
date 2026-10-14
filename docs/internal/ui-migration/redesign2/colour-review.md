# Colour review (final design pass)

Scope: runs list, run detail (overview, items expanded, traces), compare, experiments, analysis, datasets, admin,
login, docs, at 1440 and 390, dark theme. Method: the screenshots in `design-pass-shots/` (`before-*`), computed
WCAG ratios and CIE dE (Lab, D65) from the token hex values, and a Machado 2009 (severity 1.0) protanopia and deuteranopia
simulation of the score ramp and the series palette. Numbers below are reproducible from the hex values in `tokens.css`.

## Violations found (one colour = one meaning per page)

| # | Where | What | Decision |
|---|-------|------|----------|
| 1 | Runs list, compare, charts | Series 1 was teal `#00d4aa`, the accent reserved for selection, links and the primary action: the model dot of `gpt-4o` and compare run A shared its hue with the selected row, the primary button and "Open Runs" | Fixed: series palette has no teal |
| 2 | Compare, run item | Series 3 was purple `#a855f7`, the same hue as metadata tags (`qa_task`, `easy`, `lang: ar`, tone `meta`): "Pass 3" and run C looked like tags | Fixed: no purple in the series palette |
| 3 | Runs list | Series 2 `#00a8ff` is identical to the info/RUNNING blue (`--accent-secondary`) | Fixed for the common slots: sky blue `#38bdf8` is series 1 only where no RUNNING badge sits on the same mark type (dot vs status pill); residual, documented below |
| 4 | Everywhere charts load | `features/runs-list/palette.css` silently redefined `--chart-6..8` (`#ea580c`, `#6366f1`, `#0d9488`, all under 4.5:1 on surface) over the values in `tokens.css`, so there were two palettes and the tested one was not the one rendered | Fixed: file deleted, one palette in `tokens.css` |
| 5 | Series palette | Series 6 `#60a5fa` vs series 2 and series 7 `#34d399` vs series 1 were dE 9 to 10 apart (indistinguishable) | Fixed: new set, see below |
| 6 | Score ramp | Yellow `#eab308` and lime `#84cc16` were dE 4 (protanopia) and 7 to 10 (deuteranopia) apart: bands 3 and 4 look the same to roughly 6% of men | Fixed: `--score-3` `#facc15`, `--score-4` `#4ade80` (dE 21 to 38 under both) |
| 7 | Runs list, compare | `--success` (status COMPLETED, delta good) and band 5 are the same `#10b981`; `--warning` amber and band 3 are near-identical | Kept on purpose: both mean "good" / "caution" in their pairs; a status pill is never next to a score of the same band without the word or the number |
| 8 | Series vs bands | Amber is series 7 and orange series 3 while warning/band 2 use orange-amber hues | Residual; series are always paired with a letter or a name and never encode good/bad |
| 9 | Hairlines | Table rules and card edges (`--border-subtle` 1.14:1 on surface) disappeared on a dim screen, so the surface hierarchy relied on the old grey boxes | Fixed: hairlines lifted, see below |

Admin, login, datasets and trace pages reuse the same tones and showed no new violations in the screenshots (neutral,
accent for the action, danger for destructive rows).

## Contrast measured (before the change, all kept)

On `--bg-surface` / `--bg-elevated` / on its own 12% tint over surface: success 6.8 / 6.2 / 5.7; info 6.6 / 6.0 / 5.5;
warning 8.0 / 7.3 / 6.5; accent 9.0 / 8.2 / 7.2; meta text `#c084fc` 6.5 / 5.9 / 5.4; neutral 6.3 / 5.7 / 5.2; danger
tone `#ef4444` 4.6 / 4.2 / 4.1, which is why danger text already uses `--error-text` (5.15:1 on its tint); bands 2, 3,
4, 5: 6.1 to 9.0 on surface. Only the old series 3 purple (4.34) and the palette.css slots were under 4.5.
The new series are all at 5.8:1 or better on surface (indigo 5.8, pink 6.5, sky 8.0, orange 7.6, cyan 9.5, amber 10.3,
lime 11.4, slate 11.6) and 5.2:1 or better on elevated.

## Colour-vision simulation

Score ramp, adjacent-band dE (lower is worse): normal 35, 42, 55, 55 and protan 38, 21, **4**, 54 and deutan 25, **12**,
**10**, 53 before; after (`#ef4444 #f97316 #facc15 #4ade80 #10b981`): normal 35, 52, 78, 22; protan 38, 32, 38, 23;
deutan 25, 21, 50, 21. Worst adjacent pair went from dE 4 to 21. Bands 4 and 5 are close in hue by design (both
"good"); they differ in lightness and every band is also written as a number or label, so colour never carries the
value alone.

Series palette, closest pair dE (normal / protan / deutan): before 9 / 1 / 6; after (all eight) 22 / 10 / 8. The first
five slots (the ones real runs use: sky, pink, orange, amber, indigo) are at 31 / 20 / 16 (the independent review's tritan
simulation gives 12). Cyan was moved out of the first five after review: as slot 4 it sat 22 / 16 / 15 dE (8 tritan)
from sky slot 1 and run tags A and D were hard to tell apart; it is now slot 7. Slots 6 to 8 are the weak tail; they
already come with a letter or a marker shape beyond 8 series.

Kept on purpose: series 1 sky `#38bdf8` vs the info/RUNNING blue `#00a8ff` (dE 19, 7 tritan). They never encode the same
object (a series is a dot, tag or rail beside a name; info is a status pill or progress bar with a word), and moving
series 1 elsewhere would collide with teal, purple, amber or red, which are all taken.

## Palette changes (token by token)

| Token | Before | After | Why |
|-------|--------|-------|-----|
| `--score-3` | `#eab308` | `#facc15` | separate from lime under protan/deutan |
| `--score-4` | `#84cc16` | `#4ade80` | lime collapsed into yellow; light green keeps the red-to-green order and a lightness step |
| `--chart-1` | `#00d4aa` (teal) | `#38bdf8` | teal is the accent |
| `--chart-2` | `#00a8ff` | `#f472b6` | was the info blue |
| `--chart-3` | `#a855f7` (purple) | `#fb923c` | purple is metadata |
| `--chart-4` | `#f472b6` | `#fbbf24` | cyan moved out of the first five (too close to sky) |
| `--chart-5` | `#fbbf24` | `#818cf8` | distinct, 5.8:1 |
| `--chart-6` | `#60a5fa` (and palette.css `#ea580c`) | `#a3e635` | |
| `--chart-7` | `#34d399` (and palette.css `#6366f1`) | `#22d3ee` | |
| `--chart-8` | `#fb923c` (and palette.css `#0d9488`) | `#cbd5e1` | neutral last slot |
| `--border-subtle` | `#252536` (1.14:1 on surface) | `#2b2b40` (1.25:1) | hairlines readable without grey boxes |
| `--border-default` | `#333348` (1.40:1) | `#3b3b54` (1.59:1) | |
| `--border-strong` | `#4a4a60` (2.0:1) | `#52526c` (2.3:1) | |

Unchanged on purpose: the surface steps (`#101018`, `#14141e`, `#1a1a28`, `#222232`, 1.04 to 1.10:1 apart) because
cards now carry a visible hairline and, where meaning exists, a 3px rail; text ramp, accents, status tones.
Files touched: `styles/tokens.css`, deleted `features/runs-list/palette.css` and its import in `model.ts`,
`__tests__/design-language.test.ts` (pinned `--chart-6..8`), `docs/DESIGN_LANGUAGE.md`. `tones.css` and `marks.css` map
tones and series through the tokens, so nothing hard-codes a hue there (no component in `src` named a series or band hex).
The frozen export templates keep their own copy of the old tokens.
