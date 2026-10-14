# Typeface study (final design pass)

Question from the product owner: which typeface looks best for a bilingual (Arabic UI name and Arabic data, Latin UI
copy, a lot of mono for ids and numbers) evaluation platform with dense tables. Decision: **IBM Plex Sans + IBM Plex
Sans Arabic + IBM Plex Mono** (candidate 3), implemented in `frontend/src/styles/tokens.css`.

Screenshots: `design-pass-shots/` (committed, palette-quantised PNGs). `candidates-*.png` stack the five
candidates (top to bottom: current, Inter, Plex, Source, Geist) over the same crop; `before-*` and `after-*` are the
six screens at 1440 and 390 before and after the pass (runs list, run item expanded with Arabic and JSON, compare
averages, experiments, analysis for a categories run, docs). The type specimen is in `/__ui` ("Typeface specimen"
case, `candidates-specimen.png`).

## Candidates and sources

All files are the variable or static TTFs from the Google Fonts repository
(`https://github.com/google/fonts`, commit `67bc647ce1910e92f461bcc82aae30f21d21a9cc`, path
`ofl/<family>/`, fetched from `https://raw.githubusercontent.com/google/fonts/<commit>/ofl/...`), converted with
fontTools to woff2, Latin and Arabic subsets, hinting dropped, weight axis kept (400 to 700), other axes pinned
(`wdth` 100, Inter `opsz` 14). Licence of every family: SIL Open Font License 1.1 (text in the same folder of that
repo, `OFL.txt`).

| # | Latin | Arabic | Mono | Versions | Subset woff2 |
|---|-------|--------|------|----------|-------------:|
| 1 | current stack | `Qym Arabic` = `local()` Geeza Pro / Segoe UI / Tahoma / Noto Sans Arabic | system | n/a | 0 KB |
| 2 | Inter (`ofl/inter/Inter[opsz,wght].ttf`) 4.001 | IBM Plex Sans Arabic (3 static cuts) 1.101 | JetBrains Mono (`jetbrainsmono/JetBrainsMono[wght].ttf`) 2.211 | | 146 KB |
| 3 | IBM Plex Sans (`ibmplexsans/IBMPlexSans[wdth,wght].ttf`) 3.201 | IBM Plex Sans Arabic (`ibmplexsansarabic/IBMPlexSansArabic-{Regular,Medium,SemiBold}.ttf`) 1.101 | IBM Plex Mono (`ibmplexmono/IBMPlexMono-{Regular,Medium,SemiBold}.ttf`) 2.3 | | **138 KB** |
| 4 | Source Sans 3 (`sourcesans3/SourceSans3[wght].ttf`) 3.052 | Noto Sans Arabic (`notosansarabic/NotoSansArabic[wdth,wght].ttf`) 2.012 | Source Code Pro (`sourcecodepro/SourceCodePro[wght].ttf`) 1.026 | | 116 KB |
| 5 | Geist (`geist/Geist[wght].ttf`) 1.800 | Vazirmatn (`vazirmatn/Vazirmatn[wght].ttf`) 33.003 | Geist Mono (`geistmono/GeistMono[wght].ttf`) 1.701 | | 66 KB |

Candidate 1, how it behaves today: `--font-sans` was `'Qym Arabic', -apple-system, BlinkMacSystemFont, 'Inter',
'Segoe UI', sans-serif`. Latin therefore became San Francisco on macOS, Segoe UI on Windows, and on Linux
(this machine) Liberation Sans, i.e. a different face per OS with different widths. `Qym Arabic` was only a
`local()` alias with an Arabic `unicode-range`, so Arabic resolved to Geeza Pro (macOS), Segoe UI/Tahoma (Windows),
Noto Sans Arabic if installed, otherwise whatever fontconfig picked. Mono was `ui-monospace, SF Mono, Menlo, JetBrains
Mono, Fira Code, Consolas, Liberation Mono`: four more OS-dependent faces. No two platforms shared glyphs or widths,
and nothing was tuned to pair the Arabic with the Latin.

Method: the five sets were loaded through a token override injected into the live app (`@font-face` plus
`--font-sans`/`--font-mono` redefined, same Vite app, same seeded data), and the same six screens plus the specimen
were captured at 1440 and 390 for each (70 screenshots, all looked at; the cropped stacks are committed).

## Measurements (font tables, not eyeballed)

| Candidate | Latin x-height (em) | Arabic nun-top (em) | Arabic / Latin ratio | Avg Latin advance (em) | Mono advance |
|-----------|-----:|-----:|-----:|-----:|-----:|
| Inter + Plex Arabic | 0.546 | 0.489 | 0.90 | 0.516 | 0.600 |
| **Plex + Plex Arabic** | 0.516 | 0.489 | **0.95** | 0.494 | 0.600 |
| Source Sans 3 + Noto Arabic | 0.478 | 0.497 | 1.04 | **0.421** | 0.600 |
| Geist + Vazirmatn | 0.530 | 0.415 | 0.78 | 0.503 | 0.600 |

(Average advance is over a mixed sample sentence; the ratio is the Arabic bowl height over the Latin x-height, 1.0 =
perfectly matched optical size, which is what keeps a mixed Arabic/Latin line from looking like two fonts.)

## Scores (1 to 5, from the screenshots and the table above)

| Criterion | Current | Inter | **Plex** | Source | Geist |
|-----------|:--:|:--:|:--:|:--:|:--:|
| Arabic/Latin x-height and weight match | 1 | 3 | **5** | 3 (Latin too small) | 2 (Vazirmatn reads small) |
| Legibility at `--font-sm` (11px) and `--font-xs` (10px) on dark | 3 | 4 | **4** | 2 (x-height 0.478, badges look tiny) | 4 |
| Tabular numerals (`tnum` in the file) | 2 (system dependent) | 5 | **5** | 4 | 4 |
| Mono pairing (width, weight, zero) | 1 | 3 | **5** (same design, dotted zero) | 4 | 4 |
| Table density (text fitting a fixed column) | 3 | 2 (widest, `cnn-sam...`) | **4** | 5 | 3 |
| Bundle | 5 | 3 (146 KB) | **3 (138 KB)** | 3 | 5 (66 KB) |
| Licence (OFL 1.1, no restrictions on self-hosting) | n/a | 5 | 5 | 5 | 5 |
| Same rendering on every OS | 1 | 5 | 5 | 5 | 5 |
| **Total of 8** | 16 | 30 | **36** | 31 | 32 |

Notes from looking: Inter is the widest sans and truncated chips that fitted before (`cnn-sam...`). Source Sans is the
densest but its small x-height makes 11px labels and badges the weakest of the five, and Noto Arabic next to it looks
oversized. Geist is clean in Latin but Vazirmatn is a Persian-style Arabic that does not match its proportions and
runs larger. Plex Arabic was drawn to match Plex Sans (same stems, same cap height), so mixed lines in a prompt
(Arabic question, Latin SQL, numbers) sit on one rhythm; Plex Mono has the same stroke and a dotted zero, which matters
for run ids and scores.

## Decision

**IBM Plex Sans + Plex Sans Arabic + Plex Mono.**

Three strongest reasons:
1. The only candidate where the Arabic and Latin faces were designed together: Arabic/Latin optical ratio 0.95 and
   shared stem weight, so Arabic data in a Latin UI (every item row, every prompt) stops looking pasted in.
2. One family covers the three roles (UI, Arabic, data) with real tabular figures and a dotted-zero mono, giving
   identical rendering on every OS instead of five different system stacks; moderate width keeps the dense tables
   readable (it is 4% narrower than Inter and 17% wider than Source Sans, which was the price of Source's tiny x-height).
3. Cost is bounded: 138 KB of subset woff2 total (7 files), loaded with `font-display: swap` and metric-matched
   fallbacks, with a CI-enforced 200 KB cap.

Two main trade-offs:
- It is about 3% wider than the old Arial-like fallback: two fixed-width runs-list columns (`model` 124 to 142,
  `dataset` 104 to 116) were widened so identity chips do not truncate; other tables fit unchanged.
- Plex has a slightly formal, technical character (and a taller Arabic line box than the system faces) compared with
  Inter or Geist; and the OFL Reserved Font Name "Plex" applies to the subset files, which keep their original
  internal names (we load them under the CSS names `Qym Sans`/`Qym Arabic`/`Qym Mono`; the licence texts ship beside
  the files).

## What was implemented

- Files: `frontend/src/styles/fonts/` (`plex-sans-latin.woff2` 24 KB variable 400-700, `plex-arabic-{regular,medium,semibold}`
  28 + 30 + 30 KB, `plex-mono-{regular,medium,semibold}` 8.6 KB each, and three `OFL-*.txt`). Only subsets are committed.
- `@font-face` in `tokens.css`: `Qym Sans` and `Qym Mono` with the Latin `unicode-range`, `Qym Arabic` with the Arabic
  ranges (U+0600-06FF, 0750-077F, 200C-200F, FB50-FDFF, FE70-FEFF), all `font-display: swap`. This is the
  `lang`/`dir`-aware part: no attribute plumbing is needed because the range routes Arabic glyphs to the Arabic face
  inside any `--font-sans` or `--font-mono` stack; the existing `[dir='rtl']` 1.7 leading stays.
- No layout shift on swap: `Qym Sans Fallback` = local Arial/Helvetica/Liberation Sans with `size-adjust: 102.55%`,
  `ascent-override: 99.9%`, `descent-override: 26.8%`, `line-gap-override: 0%` (derived from the hhea and advance
  tables: Plex 0.471 em vs Arial 0.459 em average advance); `Qym Mono Fallback` = Menlo/Consolas/Liberation Mono with
  ascent 102.5% and descent 27.5% (advance is 0.600 em on both).
- Tokens: `--font-sans`, `--font-mono` (the old stack removed; Arabic is the shared `Qym Arabic` entry in both).
  The type scale keeps its sizes and line heights (rows are fixed-height tokens), only the 650 weights now resolve to the
  variable axis (Latin) or the SemiBold cut (Arabic, mono).
- `base.css`: `font-kerning: normal`; `table, [role=grid], [role=treegrid]` get `font-variant-numeric: tabular-nums`.
- Shared consumers: the SDK viewer imports the same `tokens.css` (its build inlines the woff2 as data URLs, one
  self-contained bundle). The frozen export templates (`export_templates/run/dashboard.css`) keep their own copy of
  the old system stack on purpose: they are self-contained offline files and embedding ~190 KB of base64 in every
  exported report is not worth it; they remain on system faces.
- Doc and test: `docs/DESIGN_LANGUAGE.md` "Font families" and rule 5; `design-language.test.ts` new case "self-hosts
  the Plex faces and nothing else" (stack tokens, only the five declared families, every woff2 referenced, licence per
  family, payload under 200 KB, no component names a family).

## Caveat found while looking

Uppercase labels with 0.05em tracking (table headers, eyebrows) show slightly uneven letter gaps in headless Chromium on
Linux ("ENVIRONMENT S"). The same raw, unsubsetted Plex TTF reproduces it, it also happens at deviceScaleFactor 2 in
that renderer, and it disappears without tracking, so it is that renderer's glyph positioning, not the subsetting. Worth
a look on macOS/Windows Chrome; if it shows there, drop the uppercase tracking to 0.04em in one place (Text, Eyebrow, table
header recipe).
