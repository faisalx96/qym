# Shell variants — UX evaluation and decision

Evaluated 2026-10-11 by the UX sub-agent against the three mocks served by the
Vite dev server (`/app/__mock/shell/{sidebar,topbar,palette}`) with Python
Playwright (Chromium) at 1280x800 and 700x800, axe-core 4.x, and manual review
of the screenshots. Scripts live in the agent scratchpad; raw data in
`/tmp/claude-1000/ux/shots_axe.json` and `/tmp/claude-1000/ux/tasks.json`.
No mock source was changed.

## 1. Decision

**Variant A (sidebar) is chosen**, with the palette from C carried in as an
additive, later feature and two B details borrowed (see §8).

Why A:

- It is the only variant whose chrome is fully labelled and reachable without
  variant-specific axe failures: every serious finding on A is a shared piece
  (brand link name, `FAILED` badge contrast, archived banner contrast) that A, B
  and C all have. C adds a critical `button-name` and 13 serious `link-name`
  failures (the collapsed rail has no accessible names); B adds a nameless
  icon-only Docs link at <=760px.
- It matches the model the brief (01 §3) and every current user already know:
  Global / project / Platform sections, breadcrumb switcher, archived banner.
  B moves admin pages behind a "Platform" dropdown and C hides every label
  behind hover.
- Discoverability is zero-cost: all 13 destinations are visible with text, the
  active page is highlighted, the project is named twice (section title and
  breadcrumb). Mouse task counts are identical across variants (4/2/2/2/1), so
  the sidebar's horizontal cost buys orientation rather than steps.
- Its density cost is bounded and user-controlled: 192px (15% at 1280), or
  56px when collapsed, which equals C's rail. B's full width costs 37px of
  permanent vertical chrome instead.

What A loses versus the others and how it is handled: keyboard reach to the
topbar is long (switcher trigger is the 17th Tab stop; 21 presses to switch
project versus 6 in B) — fixed by adjustment 1 (skip link) and 2 (palette).

## 2. Scoring table (1–5, higher is better)

| Variant | Task success | Steps to complete | Discoverability | a11y | Density | Consistency | Total |
|---|---|---|---|---|---|---|---|
| A sidebar | 4 | 3 | 5 | 4 | 3 | 5 | **24** |
| B topbar | 4 | 4 | 4 | 3 | 5 | 3 | **23** |
| C palette | 4 | 4 | 2 | 2 | 4 | 3 | **19** |

Justification per cell:

- Task success — all three complete a, b, d, e. Task c (Sign out via the user
  menu) fails in all three because of a shared mock bug (§4.3); C also passes c
  through the palette. All get 4, none 5.
- Steps — mouse counts are identical (§4.1). Keyboard: B reaches the switcher
  in 6 presses, A/C in 21 (the sidebar/rail items precede the topbar). C's
  Ctrl+K path is 3–6 presses but only for users who know the shortcut. A 3,
  B 4, C 4.
- Discoverability — A: every page labelled and visible (5). B: tabs visible but
  Admin/Deleted runs live only in a dropdown and <=760px hides all pages behind
  one "Runs v" button (4). C: icons only, labels on hover, shortcut invisible
  except for a small "Go to" button; at <=760px a bare hamburger opens a search
  box (2).
- a11y — counts in §4.2. A: 3 shared serious rules only (4). B: shared + nameless
  Docs link at 700 + user-button name mismatch (3). C: critical button-name,
  13 link-name, hover-only expansion, "Go to" button named "Ctrl K" at 700 (2).
- Density — §4.4. A: 1088px content at 1280 and 644px at 700, 50px chrome (3).
  B: 1280/700 but 87px chrome (5). C: 1224/700, 50px chrome, but the hover
  overlay covers 136px of content and the switcher trigger (4).
- Consistency — §6. A reuses the sections, breadcrumb switcher, banner and
  shell type tokens (5). B invents GitHub-style repo tabs and a Platform
  dropdown (3). C invents a hover rail and a modal palette as the primary nav (3).

## 3. Verified claims from DESIGN_NOTES (all variants unless noted)

| Claim | Result |
|---|---|
| Last crumb carries `aria-current="page"` | 1 element in every variant (pass) |
| Switcher trigger `aria-expanded` | `false` closed, `true` open, in A, B, C (pass) |
| User trigger `aria-expanded` | present (`false`) in A, B, C (pass); focus returns to the trigger after Escape (pass) |
| Switcher search is labelled | `<label>` "Search projects" via `aria-labelledby`, autofocused (pass) |
| Settings tabs arrow keys + URL | ArrowRight from Members focuses "API Keys" and the URL becomes `tab=apikeys` (pass) |
| Login mode switch keeps the email value | typed `me@example.com`, clicked "Create an account", field still holds it (pass) |
| Archived: one banner, Read-only tag, Auto-analysis/Reviews hidden, actions disabled | observed in A, B, C at both widths (pass) |
| Escape closes popover/palette | **fails from the search field** (empty field, Escape does nothing in A, B, C); passes when a list item has focus (§4.3) |
| A: ≤760px overlay sidebar closes on Escape / outside click | neither closes it (documented gap, confirmed) |
| C: rail expands on `:focus-within` | yes, width 56 -> 192, labels become visible while tabbing (pass) |
| C: Ctrl+K opens the palette; menu button opens it at ≤760px | both pass |
| B: ≤760px page dropdown navigates | "Runs v" -> Settings lands on `page=settings` (pass) |

## 4. Measured data

### 4.1 Steps per task (click = 1, keypress = 1, typing a value = 1)

Mouse (identical across A, B, C):

| Task | Steps | Verified end state |
|---|---|---|
| a. Arabic QA -> Settings -> Members | 4 (switcher, Arabic QA, Settings, Members tab) | `?project=arabic-qa&page=settings&tab=members` |
| b. Switch project | 2 | chip shows "Arabic QA تقييم" |
| c. Sign out via user menu | 2 attempted — **fails in A, B, C** (URL resets to the runs list, no login form) | mock bug, §4.3 |
| c'. Sign out via palette (C only) | 2 (Go to, Sign out — item is below the fold, needs a scroll) | `?view=login` |
| d. Create project (Name focused) | 2 (switcher, "Create project") | dialog open, Name input focused with visible ring |
| d'. (C) Go to -> "Create project…" | 2 | same |
| e. Run detail -> Runs via breadcrumb | 1 | `?project=demo` |
| e. Run detail -> Runs via browser Back | `page.go_back()` lands on the runs list in all three (the run detail was reached by URL: the mock table rows are not links) |

Keyboard only (from body, Tab/Enter/Arrow; Ctrl+K for C):

| Task | A | B | C |
|---|---|---|---|
| b. switch project (Tab to switcher, Enter, ArrowDown x2, Enter) | 21 | 6 | 21 (palette: 3 = Ctrl+K, type, Enter) |
| a. ... then Settings, Members | 45 | 21 | 47 (palette: 6) |
| c. sign out via menu | 19, fails (§4.3) | 8, fails | 20, fails; palette 3, passes |
| d. create project | 23 | 8 | 23 (palette 3) |

The A/C numbers are dominated by the 14–15 nav items that precede the topbar
in Tab order; B puts the switcher second.

### 4.2 axe-core, serious + critical, by variant (states: default, switcher,
menu, archived, login, projects, settings members, run, create, palette; 1280 and 700)

Shared by all three (page/body pieces, not chrome arrangement):

- `color-contrast` serious — `FAILED` run badge: `#ef4444` on `#281821`, 4.49:1 at 10px (DataTable, every Runs page).
- `color-contrast` serious — archived banner body text `--text-muted #9a9ab2` on `#78350f` = 3.3:1 (`?project=old`).
- `link-in-text-block` serious — "Unarchive it" link (1.43:1 against surrounding text, no underline) and the run page "Runs" link in a muted paragraph.
- `label-content-name-mismatch` serious — brand link: `aria-label="qym — Projects"` while the visible text is "qym" (A and B; C's brand is icon-only so it passes).
- `region` moderate on switcher-open states (ignored, below serious).

Variant-specific:

| Variant | Extra rules | Nodes |
|---|---|---|
| A | `label-content-name-mismatch` at 700 on the collapsed user trigger (`aria-label="Dev User — user menu"` vs hidden text) | 1 |
| B | `link-name` serious at 700 — icon-only Docs link has no accessible name; `label-content-name-mismatch` on the avatar IconButton at both widths | 1 + 1 |
| C | `button-name` **critical** — rail "Search…" button has an empty name while collapsed; `link-name` serious — all 13 rail links (Projects, Docs, 9 project pages, Admin, Deleted runs) have empty names while collapsed (labels are hidden with CSS, `NavItem` is rendered with `collapsed={false}` so no `aria-label`); `label-content-name-mismatch` on the rail user trigger | 1 + 13 + 1 |

Totals of serious+critical rule hits on the default Runs page at 1280 (rail
collapsed): A 2, B 2, C 4 (one critical). At 700: A 1, B 2, C 0 (rail removed).

Note: the first C screenshots had Playwright's pointer parked at (0,0), which
kept the rail hover-expanded; the rail findings only appear when it is
collapsed, which is its resting state for real users. The 1280 C screenshots
were retaken with the pointer away.

### 4.3 Functional defects found (shared mock code, affect every variant)

1. **User-menu actions never navigate.** Profile, Admin and Sign out close the
   menu and the URL returns to the pre-menu state. `UserMenu.onAction` calls
   `navigate(...)`, then the DropdownMenu's `onOpenChange(false)` calls
   `set({ menu: null })`, which rebuilds the query string from the stale
   `params` of the previous render with `replace`, clobbering the navigation.
   Task c therefore fails via the menu in A, B and C. The palette's
   `runCommand` closes first and navigates last, which is why C's palette
   sign-out works.
2. **Escape in the switcher / palette search field does not close the surface**
   (A popover, B popover, C dialog). It works once focus is on a list item or
   the user-menu. The SearchField appears to consume Escape even when empty.
3. On the Projects landing the breadcrumb reads "Runs" (`useCrumbs` falls back
   to `pageTitleOf('runs')` when there is no project).
4. Mock table rows are not links, so "back from run detail" could only be
   tested by URL navigation plus `go_back()`.

### 4.4 Density and chrome

| Variant | 1280: `main#shell-content` x / width | chrome height above main | 700: x / width | chrome height |
|---|---|---|---|---|
| A | 192 / **1088** (collapsed: 56 / 1224) | 50 | 56 / **644** | 50 |
| B | 0 / **1280** | **87** (50 + 36 + border) | 0 / 700 | 87 |
| C | 56 / 1224 (hover overlay: main stays at 56, rail 192 over it) | 50 | 0 / 700 | 50 |

With the archived banner the content starts 32px lower in all three.

DataTable (`minWidth=900`): the scroller is the table container
(`._container_*`), scrollWidth 976 vs clientWidth 602 (A), 658 (B, C) at 700;
`document.documentElement.scrollWidth` == viewport width in every state at both
widths (no page-level horizontal scroll). At 1280 the container already
overflows by 6px (1052 vs 1046 in A), i.e. the table is 6px wider than its box
even when there is room.

### 4.5 scrollWidth and console

- scrollWidth <= innerWidth: true for all 3 variants x 15–17 states x 2 widths (90 checks).
- Console errors: 0. Page errors: 0 (all variants, all states, all task runs).

### 4.6 Tab order (from body, 60 Tabs, 1280 then 700)

- A 1280: brand -> Projects, Docs -> Runs … Settings (9) -> Admin, Deleted runs
  -> user trigger -> Collapse sidebar -> switcher trigger -> Export CSV ->
  Compare selected -> table row -> wraps. 20 stops, every chrome control
  reached, every stop `:focus-visible` with a visible ring (outline or
  box-shadow). Crumb "Runs" is text (current page), stats not focusable (fine).
  At 700 identical with `aria-label`ed collapsed items ("Expand sidebar",
  "Dev User — user menu").
- B 1280: brand -> switcher -> Docs -> user -> 9 tabs -> Platform -> page
  actions -> row. 17 stops, all ringed. At 700: brand -> switcher ->
  **Docs link with empty name** -> user -> "Runs v" page menu -> Platform ->
  actions -> row (9 stops).
- C 1280: brand -> rail Search… -> 13 rail links (rail expands on focus-within
  so labels are visible) -> user -> switcher -> "Go to" -> actions -> row.
  21 stops, all ringed. At 700: "Open navigation" -> switcher -> button named
  only "Ctrl K" (the "Go to" text is hidden) -> actions -> row (6 stops).
- No focus traps found outside dialogs. The create-project dialog traps focus
  and returns it; the user menu returns focus to its trigger on Escape; the
  switcher popover returns focus to the trigger when closed from a list item.

## 5. Journeys J1–J6 and §7 pain points

- J1 login: identical form in all three; A and C use the centred card, B the
  split page (brand panel dropped at 700). Mode switch keeps field state (§7.9
  fixed, verified). No variant-specific difference in task flow.
- J2 boot / J3 navigation: client-rendered chrome, no pending guard (§7.11); all
  popovers use `replace` so Back is clean (verified: go_back from run detail
  skips popover states). The user-menu navigation bug (§4.3.1) must not be
  carried over.
- J4 landing: identical page body; A keeps Global + Platform sections visible,
  B shows "Projects | Docs" tabs plus the Platform dropdown, C shows the rail
  with no project section. Create project is 2 clicks in every variant.
- J5 profile: reached from the user menu in all three (currently broken by
  §4.3.1), additionally from the palette in C.
- J6 settings: tabs are arrow-key navigable and URL-backed (§7.4 fixed,
  verified). C adds "Manage members" and "API keys" palette actions
  (2 interactions instead of 4 from any page; 6 keypresses keyboard-only).
- §7.10 (a11y of chrome): A fixes every listed item (labels on collapsed items,
  labelled toggle with `aria-expanded`/`aria-controls`, labelled search,
  `aria-current` crumb, `aria-expanded` user trigger, focus return). B fixes
  them but introduces the nameless Docs icon link. C regresses it: the rail
  reproduces the original "tooltip only, no accessible name" defect.
- §7.13 (archived logic): one banner + one nav filter + `isDisabled` actions in
  all three (verified at both widths; B truncates the archived project name to
  "Ar…" at 700 because the chip is capped at 180px and the tag is `flex:none`).
- §7.1–3, 5–8, 12 are implementation items, unaffected by the shell arrangement.

## 6. Consistency with docs/DESIGN_LANGUAGE.md and the qym mental model

- Tokens and type: all three use `--shell-font-xs/sm/md` for chrome, `--font-*`
  for page content, mono only for ids/slugs/stat values; no hardcoded sizes
  seen. Topbar stat labels at `--shell-font-xs` uppercase muted and values mono
  650 match the "meta / caption" and data roles.
- A: same sections and order as `shell.js` (Projects, Docs / project pages /
  Platform), breadcrumb switcher as the control, collapse toggle, archived
  banner. Only change in model: the user trigger moves from the topbar to the
  sidebar footer. Nothing foreign.
- B: horizontal page tabs under a context row and a "Platform" dropdown are new
  to qym; there is no sidebar for the Platform section, so admin pages change
  location depending on whether a project is selected. The split login page is
  also new. The stats cluster competes with the tab strip on one row.
- C: an icon rail with hover expansion and a modal command palette are both new
  patterns; `aria-keyshortcuts`, Kbd chips in the topbar and the "Go to"
  button have no precedent in the design language. The palette's result rows
  use `--font-md` (page scale) inside chrome, mixing the two scales in one
  surface.

## 7. Screenshot index (`/tmp/claude-1000/ux/`)

Pattern `<variant>-<state>-<width>.png` with variant A/B/C and width 1280/700.
States for every variant: `default`, `switcher`, `menu`, `archived`, `login`,
`login-signup`, `login-change`, `projects`, `settings-members`, `run`,
`create`, `profile`, `admin`, `trash`. Variant-specific: `A-collapsed-1280`,
`A-expanded-700`, `C-palette-1280`, `C-palette-700`, `C-rail-hover-1280`,
`C-rail-focus-1280`, `C-menu-palette-700`, `B-pagemenu-open-700`. Task end
states: `<v>-task-a-end-1280` (Arabic QA settings, Members tab),
`<v>-task-c-menu-1280` (user menu open), `<v>-task-d-end-1280` (create
dialog), `A-task-c-end-1280` (sign-out failure state). Focus-ring samples:
`<v>-focus4-<w>`, `<v>-focus13-<w>` (4th and 13th Tab stop). Data:
`shots_axe.json`, `tasks.json`.

## 8. Adjustments to carry into the real AppShell (variant A base)

1. **Add a "Skip to content" / "Skip to toolbar" link** as the first Tab stop
   (visually hidden until focused) so the switcher trigger and page actions are
   reachable in 2–3 presses instead of 17+; also focus `main#shell-content` on
   route change as DESIGN_NOTES already requires.
2. **Keep C's command palette as an additive feature** (Ctrl/Cmd+K and a
   topbar "Go to" button) on top of the sidebar, not instead of it. Reuse its
   grouping (Projects / Pages / Actions) and the "Manage members" / "API keys"
   actions. Do not make it the only route to anything; the rail is dropped.
3. **Fix the menu-close race**: popover/menu `onOpenChange(false)` handlers must
   not rebuild the URL from stale search params after an action navigated
   (derive the patch from the current location, or skip the close write when
   the action already navigated). Add a test: user menu -> Sign out lands on
   `/app/login`; Profile lands on `/app/profile`.
4. **Escape must close the switcher and the palette from the search field**
   (empty or not): let Escape propagate from SearchField when the value is
   empty, or handle it in the popover/dialog.
5. **≤760px overlay sidebar**: close on Escape, on outside click/tap and after
   choosing a nav item; return focus to the toggle; add a scrim or at least
   `aria-modal`-free `inert` on the content is not required, but outside-click
   close is.
6. **Stats hidden ≤760px** (already done in the mock) and keep stats out of the
   sidebar/rail; keep the `Read-only` tag next to the crumb.
7. **Brand link name**: use `aria-label="qym"` or drop the label and add
   visually-hidden text "Projects" so the visible text is contained in the
   accessible name (axe `label-content-name-mismatch`).
8. **Collapsed user trigger**: give it `aria-label="Dev User — user menu"` only
   when the text is hidden (already so) and make the label start with the
   visible text; or render the name visually-hidden instead of removing it.
9. **Archived banner colors**: text on `#78350f` must be `--text-primary`
   (or a lighter warning surface) to pass 4.5:1; the "Unarchive it" link needs
   an underline or a 3:1 difference from surrounding text. Same for the
   "Runs" link in the run-detail muted paragraph (page content, but the
   pattern `<Text tone="muted"><a>` recurs).
10. **`FAILED` badge** (`--error #ef4444` on its tinted background, 4.49:1 at
    10px): adjust the badge surface or text tone so the 10px badge reaches
    4.5:1; this is a DataTable/Badge primitive issue, not shell.
11. **Collapsed sidebar items**: keep `aria-label` + tooltip on
    `:focus-visible` (verified working in A); do not copy C's CSS-hidden-label
    approach anywhere.
12. **DataTable scroller**: the container overflows by 6px even at 1280 (1052
    vs 1046); make the table respect its container (box-sizing / the sticky
    border) so no scrollbar appears when there is room.
13. **Borrow from B**: the icon-only avatar IconButton with full `aria-label`
    for narrow widths, and the `max-width` + ellipsis rule on the switcher
    chip, but keep ≥120px of name before truncating (B showed "Ar…" at 700 when
    the Archived tag was present).
14. **Projects landing breadcrumb**: show "Projects", not "Runs"
    (`useCrumbs` when `view === 'projects'`).
15. **Persist collapse** in `qym:sidebar-collapsed` and auto-collapse ≤760px as
    today; the collapsed width stays 56px so the Runs table has the same room
    as C's rail gives.

## 9. Open risks

- The two real pain points of A (long Tab order, 192px on dense pages) are
  mitigated by adjustments 1, 2 and 15, not removed; if Charts/Compare need
  more than 1088px at 1280, the collapsed-by-default rule for those pages
  should be decided in the compare/analyzer area.
- Adding the palette (adjustment 2) creates two surfaces for switching
  projects; they must share one list component and one `qym:last-project-slug`
  write path.
- The shared bugs in §4.3 live in the foundation primitives (DropdownMenu /
  SearchField close handling), so they will reappear in every feature area
  unless fixed in `frontend/src/ui/`.
- axe was run on a mock with static data; contrast results for badges and the
  archived banner depend on the final token values in `dashboard.css`.
- Only Chromium was used; the hover/focus-within behaviour and `:focus-visible`
  rings were not checked in Firefox/WebKit.
