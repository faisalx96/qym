# Foundation — decisions taken alone and open questions

Dated lines; each is a decision the foundation agent made without a human.

- 2026-10-11 — **Login is an SPA route** (`/app/login`, reads `GET /v1/auth/providers`).
  The vanilla `/login` stays untouched for the legacy pages (brief 01 §9.1).
  `/app/*` bounces unauthenticated sessions to `/app/login?next=…` server-side.
- 2026-10-11 — **Project resolution is client-side** for `/app/projects/:slug/*`
  (brief 01 §9.2): the SPA fallback only checks the session; `ProjectLayout`
  renders Not Found / Access Denied / archived panels from the by-slug status.
- 2026-10-11 — **Legacy `/run/:id` redirects** to `/projects/:slug/runs/:id`
  once `GET /api/runs/{id}?view=compact` names the project (brief 01 §9.3);
  remembered slug is only a fallback.
- 2026-10-11 — **`qym:me` snapshot dropped** (brief 01 §9.4); logout still clears it.
- 2026-10-11 — **Topbar stats** keep the imperative shape via a context hook
  `useTopbarStats(stats, {scope})` (brief 01 §9.5).
- 2026-10-11 — **Settings `?tab=` is persistent** (brief 01 §9.6).
- 2026-10-11 — **Profile stays read-only** (no `PATCH /v1/me`; brief 01 §9.7).
- 2026-10-11 — **proxy_headers/none 401** shows a static "No user identity" panel (brief 01 §9.8).
- 2026-10-11 — **Export mode** (`__QYM_EXPORT__`) is left to the run-detail area (brief 01 §9.9).
- 2026-10-11 — **Build lands in `_static/app/`** (gitignored; wheel + Docker build it);
  the design-language test lints `frontend/src` sources, not the bundle (brief 01 §9.10).
- 2026-10-11 — **Headless library: React Aria Components** (brief 02 §9.2). Measured
  bundle: aria chunk 84 kB / 27.6 kB gzip for the full primitive set — under the 120 kB gate.
- 2026-10-11 — **New tokens added** to `tokens.css` (brief 02 §4): `--accent-primary-hover`,
  `--error-hover`, `--focus-ring`, `--shadow-popover`, `--shadow-dialog`, `--z-dropdown`,
  `--z-dialog`, `--z-toast`, `--z-tooltip`, plus `--glyph-md/lg` (decorative glyph sizes),
  `--skeleton-wait/min`, `--arrive-fade`.
- 2026-10-11 — **Button sizes** `sm`=24 px (default) and `md`=32 px (dialog footers,
  page actions); 42 px only as `TextField size="auth"` (brief 02 §9.3).
- 2026-10-11 — **Score non-colour cue**: `data-band` + a 2 px left bar in the band
  colour, ⚠/↻ glyphs unchanged (brief 02 §9.4).
- 2026-10-11 — **Segmented indicator memory dropped**; the transition is kept and
  disabled under reduced motion (brief 02 §9.5).
- 2026-10-11 — **Status → tone mapping** per brief 02 §9.6 (COMPLETED/APPROVED success,
  RUNNING/STOPPING info, FAILED/REJECTED danger, STOPPED/DRAFT warning, PENDING/SUBMITTED neutral).
- 2026-10-11 — **Toasts top-right** only (brief 02 §9.7); the runs-page top-center toast is gone.
- 2026-10-11 — **Scroll hold not ported** (brief 02 §9.1); add an opt-in hook only if
  an area's Playwright run shows jumps.
- 2026-10-11 — **Scroll mirror not ported** as a primitive; the runs area decides
  (brief 02 §3). `ScrollMirror` is therefore absent from `src/ui`.
- 2026-10-11 — **Toasts are hand-rolled** (React Aria's toast API is still `UNSTABLE_`).
- 2026-10-11 — **Focus ring** is 2 px accent at 2 px offset everywhere (brief 02 §7.15).
- 2026-10-11 — `aria-modal="true"` is set on dialogs via a ref because React Aria
  filters the attribute (it uses `aria-hidden` on the rest of the page instead).
- 2026-10-11 — Vitest's jsdom setup stubs `Element.prototype.getAnimations` so React
  Aria exit animations resolve; the real browser is covered by Playwright.

## Open for the reviewer

1. `tests/test_restructure.py` asserts `_static/app` is *not* in package-data? (It
   does not; it only checks `_static/dashboard/*`.) The wheel now needs `npm run build`
   before `pip wheel`; no script enforces that yet — propose `scripts/build_wheel.sh`.
2. `/docs-guide` hash routes (`#section/page`) vs the proposed `/docs/:section/:page`
   — admin-docs area to decide; both paths are registered.
3. Under `QYM_AUTH_MODE=proxy_headers` without local auth the SPA's 401 panel can
   only say "identity missing"; should the platform expose a help URL in the bootstrap?

## Design decision (playbook step 3)

- 2026-10-11 — **Shell navigation model: Variant A, persistent sidebar** (UX_DECISION.md in
  this folder: A 24 vs B topbar 23 vs C palette 19; identical mouse step counts, A has no
  variant-specific axe hits and matches the existing mental model). C's Ctrl/Cmd+K command
  palette was carried over as an additive feature (projects, pages, actions); B's icon-only
  avatar trigger is used ≤760px. The 15 adjustments in UX_DECISION.md are implemented in
  `frontend/src/features/shell/AppShell.tsx` and the primitives.
- 2026-10-11 — Known pre-existing failure on `UI-redesign`:
  `tests/platform/test_p1_navigation_browser.py::test_spa_navigation_leaves_no_listeners_or_stale_handlers`
  fails identically on the untouched branch (vanilla shell listener count); not touched here.

## Visual language, redesign round 2 (2026-10-14)

Tokens added to the "Added by the React migration" family in `frontend/src/styles/tokens.css` (no existing value changed):
`--tint-faint` 6%, `--tint-soft` 12%, `--tint-strong` 20%, `--error-text`, `--chart-6..8`, `--rail-width`, `--card-padding`,
`--card-padding-compact`, `--shadow-card-hover`, `--ease-out`, `--motion-fill`, `--motion-stagger`, `--motion-flash`,
`--dim-opacity`, `--hover-brightness`, `--scrim`, `--scrim-light`, `--scrollbar-*`. New global stylesheets `tones.css`
(tone, band, series maps) and `marks.css` (chart mark states). Decisions are in
`docs/internal/ui-migration/redesign2/visual-language.md` "## Decisions".
