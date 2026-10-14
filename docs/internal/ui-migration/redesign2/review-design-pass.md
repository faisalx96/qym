# Review: design pass (colours + typeface), branch ui/design-pass

Reviewer: independent. Tip reviewed: 2896becf (6 commits on UI-redesign b4c21515). Product code untouched.
Screenshots (scratch, not committed): `.../scratchpad/dr/shots/` (`plex|old|inter|source-<screen>-1440.png`, `plex|old-<screen>-390.png`,
`trk-all.png` tracking test, `blocked-runs-1440.png`). Screens: runs list, runs (2nd project), Arabic run item with JSON, classic run,
compare 4 runs, charts, models, analysis (run analyzer), analysis hub, experiments home, experiments/new, docs, `/__ui`, overview.
The experiments wizard past the "No active environments" gate was NOT rendered (no Evaluation Service stub run); SDK viewer was covered by e2e only, not screenshotted.

## Verdict: MEETS WITH FIXES

Typeface choice is right and fully implemented. Two real defects found: the series palette slot 1 / slot 4 collision and the uppercase
letter-gap artefact (which 0.04em does NOT fix, but `text-rendering: geometricPrecision` does).

## Typeface verdict: IBM Plex Sans + Plex Sans Arabic + Plex Mono is the right choice

- Reproduced by injecting `--font-sans/--font-mono` overrides (old system stack, Inter+Plex Arabic+JetBrains Mono, Source Sans 3+Noto Arabic) on the same seeded app, same screens, 1440 and 390.
- Arabic: Plex Arabic shapes correctly (ligatures, shadda/kasra visible in the logo and prose), the Arabic body size sits level with Latin in mixed rows (Arabic question + English chips + mono ids), RTL blocks keep their leading. Mixed-direction JSON line in `/__ui` (`{"نعم" :"إجابة", ...}`) renders in order. Inter + Plex Arabic looks acceptable too, but Plex is the only pairing drawn together; Source + Noto Arabic mismatches the x-height.
- Numerals: `tnum` works; the specimen decimal columns (1,111.00 / 98.40 / 7.05 / 100.0) align on the point, and score/latency columns in tables line up. Mono has a dotted zero, which separates `0` from `O` in ids.
- Truncation (ellipsised leaf elements, my seed, 1440, runs list): old 7, Plex 9, Inter 9, Source 6; at 390 Plex = old on every screen, no horizontal overflow at either width on any of 14 screens. The +2 at 1440 are long dataset/task chips; acceptable, the widened columns are tracked in `columns.ts`.
- Fallback (all `*.woff2` aborted): Liberation Sans via `Qym Sans Fallback` with size-adjust. Summed text widths within 0.4 to 1.8 percent, page heights identical on runs, Arabic run and docs, 50 px (1.5%) shorter on compare. No material layout shift on swap. PASS.
- Uppercase tracked labels (REAL but small defect): in headless Chromium on Linux, Plex shows uneven gaps ("STAT US", "SI GNALS", "LAT ENCY", "DAT E"). Inter, Liberation and Source do not at the same 0.05em, so it is Plex-specific glyph-advance snapping (no hinting in the subset woff2, integer advances at 10-11 px). Tested on the real table header at 0.05 / 0.04 / 0.03em: uneven at all three, nearly gone only at 0. Adding `text-rendering: geometricPrecision` (subpixel positioning) with 0.05em made the gaps even. So dropping tracking to 0.04em, as the study proposes, does not help. Fix below.

## Q2 Implemented, not only documented: YES

- `@font-face` for Qym Sans / Qym Arabic (3 cuts) / Qym Mono (3 cuts) + two metric fallbacks in `tokens.css`; network shows 7 woff2 files, all 200 from the app origin (24 + 28 + 30 + 30 + 8.6 x 3 KB = 138 KB); no Google Fonts request; `font-display: swap`.
- No component names a family: grep for `font-family` outside tokens.css gives only `var(--font-*)` uses; no `fontFamily`, `sans-serif`, `monospace` in TS/TSX/CSS outside tokens.css and tests. The design test regex (`font-family:\s*(?!\s|var\(|inherit)`) is correct; 48 tests pass including the new "self-hosts the Plex faces and nothing else" case (families, every woff2 referenced, licence per family, payload under 200 KB).
- Licences: three OFL-1.1 texts ship beside the files. The Reserved Font Name "Plex" applies to subsets; they are loaded under the Qym* names, which is the correct handling. (Optional: state in a comment that the files are modified subsets.)
- SDK viewer imports the same tokens; woff2 inlined as base64: bundle 209 KB css + 174 KB js = 384 KB (was ~193 KB). For a localhost offline viewer, which already ships in the wheel, +190 KB is acceptable and keeps the look identical to the platform; the e2e budget (450 KB) and url() allowlist (data:font/woff2 only) are sensible. Using the system stack in the viewer would be a worse choice (Arabic then depends on OS fonts). Acceptable.
- Export templates keep the old stack by design (self-contained files): acceptable, but note exported reports will not match the app; optional follow-up.

## Q3 Colours (own calculation, `scratchpad/dr/col.py`)

Verified: text primary 14.7 / secondary 7.3 / muted 6.25 on surface; chart series 5.8 to 11.6 on surface (5.2 to 10.5 on elevated); bands 4.57 (red) to 11.2 on surface (red 4.16 on elevated, fine for bars, not for body text); borders 1.25 / 1.59 / 2.28. Score ramp adjacent dE: normal 35/52/78/22, protan 38/32/38/23, deutan 25/21/50/21, tritan 19/49/74/13: the claimed fix of bands 3/4 holds. `palette.css` has no consumers (no import, no reference in src or e2e; no hard-coded series/band hex outside tokens.css).

Findings:
1. REQUIRED. Series slots 1 (`#38bdf8` sky) and 4 (`#22d3ee` cyan) are the same hue family: dE 22 normal, 16 protan, 15 deutan, 8 tritan. The colour-review claim "first five slots at 22+ in every simulation" is false (min over slots 1 to 5 is 8 tritan, 15 deutan, 16 protan). It is visible in the app: compare run tags A (sky) and D (cyan) are hard to tell apart in `plex-compare-1440.png`. Fix: move cyan out of the first five. Reordering to sky, pink, orange, amber, indigo, lime, cyan, slate raises the first-five minimum to 12 (all simulations) and the first four to 12 as well (still tritan-limited by orange/pink; acceptable because runs also carry a letter).
2. REQUIRED (small). Uppercase label gap artefact, see typeface section: add `text-rendering: geometricPrecision` to the tracked-uppercase recipes (Text/Eyebrow/table header) or to `body`, keep 0.05em, re-check on macOS/Windows if possible.
3. Optional. Series 1 sky `#38bdf8` vs info/RUNNING blue `#00a8ff` (accent-secondary): dE 19 normal, 7 tritan. Mostly OK because RUNNING is a pill and series is a dot, but pick a less blue slot 1 if a slot 1 dot ever sits next to a RUNNING badge.
4. Status green = band 5 (`#10b981`): acceptable (both mean good, always paired with text/number). Amber `#f59e0b` warning vs series 3 orange (dE 18) and series 5 amber (17): acceptable (series are labelled and never encode good/bad), but do not use series 5 for a "failed/warn" run. Sky = info: see 3. Accent teal `#00d4aa` vs cyan series 4 dE 40: distinct enough; moving cyan to slot 7 (fix 1) reduces the risk further.
5. Run colours in compare (RunTag/RunCards) and model dots in charts/runs list use the same `--chart-*` (sky gpt-5-mini, pink claude); consistent. New series read well on the dark surface; no purple left that could be confused with the metadata tags.

## Q4 Regressions

No overflow at 1440 or 390 on any of 14 screens; no clipped sticky columns seen (experiments settings table and runs sticky columns covered by Playwright, see gate). Runs list columns at 1440: Model/Dataset chips fit; Task/Dataset ellipsis as before. Compare matrix and cards fine at 1440 and 390. Hairlines are now visible without looking heavy. No light theme exists, nothing to check. The only visual regression is the uppercase gap artefact (Linux Chromium only, as far as tested).

## Q5 Gate

- `npm run check`: typecheck, eslint, stylelint pass; Vitest 139 files, 1255 tests passed; design-language 48 passed.
- `e2e:sdk` (heavy.sh cost 3): 41 passed, 1 failed (`qa-fixes.spec.ts:140` "elapsed clock stops while reconnecting").
- Playwright `visual-language`, `runs-list`, `compare` (heavy.sh cost 4): 360 passed, 1 skipped, 0 failed.
- `qa-fixes.spec.ts:140`: run alone 3 times at the branch tip: 3/3 pass (4.2 s each). It only failed inside the full parallel run. The test reads `textContent` of the Elapsed label before and after a 2.5 s wait following a server kill: no layout, font or size dependency, so the font change cannot cause it; it is a timing race (reconnect state vs. the first read) under load. I did not run it at UI-redesign (would need a second build); the reasoning from the diff (no change to sdk-viewer logic, only CSS tokens and a bundle-size assertion) stands. Pre-existing flake, not a design-pass regression.

## Required fixes
1. Reorder the series palette so cyan is not in slots 1 to 5 (tokens.css, pinned in design-language.test.ts for `--chart-6..8`, plus docs/DESIGN_LANGUAGE.md and colour-review.md numbers); correct the false claim in colour-review.md.
2. `text-rendering: geometricPrecision` on tracked uppercase labels; correct the typeface-study caveat (0.04em does not fix it).

## Optional
- Different slot 1 hue or a documented rule vs RUNNING pill; mention exports keep system fonts in DESIGN_LANGUAGE; render and review the experiments wizard steps with an environment seeded.

## Re-review (commit 3262448c)

Verdict: MEETS (fix 1 verified; fix 2 does not do what it claims, residual accepted, doc wording to soften).

1. Series order: VERIFIED. Tokens now sky, pink, orange, amber, indigo, lime, cyan, slate; colour-review.md table and DESIGN_LANGUAGE.md match the tokens. My calculation: min dE over slots 1 to 5 is 31 normal / 20 protan / 16 deutan / 12 tritan (was 22 / 16 / 15 / 8); the worst pair overall is now sky vs cyan (slots 1 and 7, dE 8 tritan, 16 protan), acceptable as slot 7 is rarely reached and runs carry a letter. All series are still 5.2:1 or better on surface and elevated. Screenshot `rr-geo-compare.png`: tags A sky, B pink, C orange, D amber are clearly distinct.
2. `text-rendering: geometricPrecision` on body: the computed value reaches every header cell, but it does NOT fix the uneven gaps. At the tip "DAT E" and "LAT ENCY" are still uneven (`rr-geo-runs.png`, `rr-geo-arabic.png`, zoom `z-all.png`). Compared with `auto` the crops are nearly identical, and the artefact stays at tracking 0, 0.04, 0.06 and 0.08em and with kerning off, so it is a small-size rasterisation snap of the bold Plex T-E pair in headless Chromium on Linux, not a tracking or positioning setting. My earlier statement that it "made the gaps even" came from a crop (RUN / STATUS / SIGNALS) whose glyph positions happened to land well; that was an over-generalisation and is withdrawn. Severity: low, cosmetic, Linux headless only as far as tested (macOS/Windows not checked). Action: keep the property (harmless) but soften the base.css comment and the typeface-study wording from "fix" to "mitigation; some pairs stay uneven on Linux"; do not change tracking.
3. Side effects of geometricPrecision (same pages with `body{text-rendering:auto}` as the before): summed leaf text widths 0.1% (runs), 0.4% (Arabic run) and 0.8% (compare) narrower; page heights 0.5% and 1.4% shorter. Body text, Arabic shaping and mono ids look the same in `rr-geo-*` vs `rr-auto-*`; no new truncation. No visible side effect.

Servers stopped (5957 and 8957 free). No heavy command was needed.
