# Admin + Docs — design variants (area 09)

Written by the design sub-agent. Three admin variants and three docs variants,
all real TSX under `admin/__mocks__/<variant>/` and `docs/__mocks__/<variant>/`,
reachable at `/app/__mock/admin/{tabs,rail,sections}` and
`/app/__mock/docs/{three-column,two-column,hybrid}` on the dev server.

Every variant renders inside a static stand-in for the shell
(`_shared/MockChrome.tsx`: same `--sidebar-w` / `--topbar-h` geometry, one
scroller `main#shell-content`) because mock routes mount outside `RequireAuth`
and the real `AppShell` needs the auth context. The admin content region uses
the `constrained` (1120px) container exactly like `ProjectSettingsPage` /
`ProfilePage`; docs use their own full-width grid.

The four admin panels (`_shared/RunsPanel`, `ProjectsPanel`, `UsersPanel`,
`MaintenancePanel`) are shared and take a `danger` style prop, so the variants
differ in **navigation** and in **how destructive actions are presented** — the
two halves of design question A — without three copies of the tables.

## Shared decisions (apply to every admin variant)

| Pain point (brief §7) | Resolution in the mocks |
|---|---|
| Inline messages never clear; two of three lack `role=status` | Every mutation shows a `useToast()` toast (visible) and writes to one visually hidden `role=status aria-live=polite` line (`_shared/StatusLine.tsx`, `data-status-line`). Nothing stays on screen. |
| "Total Runs" semantics | `StatStrip` item **"Runs, all projects"** with sub-line "incl. N in archived projects" and a `help` marker explaining that deleted runs are excluded and the lists below only show active projects (`_shared/AdminStats.tsx`). |
| Maintenance header is one long sentence | `KeyValueGrid columns=3 dense` (tabs, sections) or a `StatStrip variant="compact-header"` (rail); workers are `Badge`s ("summary alive" / "maintenance down"), refresh age + Refresh button sit in the `SectionHeader` aside. |
| Params is a one-line text input | `Textarea mono rows=3` with live JSON validation (`errorMessage`: "Not valid JSON" / "Params must be a JSON object"); the submit button is disabled while invalid. |
| Job log is an unbounded `<pre>` | `Drawer` (560px) with a `KeyValueGrid` of timings/params, the error in a warning notice, progress message, and a scrollable `<pre>` capped at 60vh. |
| Live dot is decorative only | `RunStatusBadge` (text + dot for the info tone) in the status column; the header carries a `Badge tone=info dot` "polling" with "every 10 s · updated Ns ago" text. |
| "Disabled" in red reads like a failure | `Badge tone=neutral` "disabled" (and "archived"); red is reserved for failures and danger actions. |
| `db_stats.error` on SQLite | First-class notice ("Table statistics need PostgreSQL… Jobs still work.") with the raw error in muted mono; tables are only rendered when stats exist. A "Demo: Postgres" ghost button toggles the fixture so reviewers can see both states. |
| Create user: no validation, `existing` ignored | Email regex validation with an inline `errorMessage`; Enter submits (real `<form>`); a duplicate shows an info toast "already exists — opened for editing" and opens the Edit dialog. |
| Force-stop copy mentions "Coder" | Generic: "The runner keeps executing until it notices; every further update it sends is rejected and lost." The dialog also states what is kept (completed items). |
| Edit dialog a11y | Foundation `Dialog` (focus trap, Escape, restore); the server error line is `role=alert`; the one-time password block is a readonly mono `TextField` + `CopyButton` with "It is not shown again." While a save/reset is pending every control and the close affordances are locked (`hideClose`, `isKeyboardDismissDisabled`, `dismissOnBackdrop=false`). |

Typed confirmation for irreversible jobs: the kind must be typed exactly
(`mismatch` error shown once something is typed), the Select marks irreversible
kinds in the option description, the help line shows a red "Irreversible" label,
and the irreversible job row carries a `Badge tone=danger` "irreversible".

## Admin variant 1 — `tabs` (PageHeader → StatStrip → Tabs, inline danger)

- **Navigation**: foundation `Tabs` with counts (Runs 3 live, Projects 3, Users 5), URL-synced (`?tab=` in the mock; `/admin/<tab>` for real). Exactly the `ProjectSettingsPage` composition, so it is the most consistent option.
- **Danger**: inline `Button variant="danger"` in every row (Force stop, Archive, Disable, Cancel job). Confirm dialogs are the terminal step with `tone="danger"`. Irreversible job: inline typed field + a red "Queue job" button.
- **Trade-offs**: a column of red buttons on a long users/live-runs list is visually loud (the "noise" half of question A); the stat strip occupies 72px of vertical space above the tabs on every tab. Fast: one click to reach every action.

## Admin variant 2 — `rail` (left sub-navigation, overflow menus)

- **Navigation**: a sticky left rail (`--settings-prompt-rail-width`, same recipe as the AI-prompts rail in settings) with one route per section; each item carries its count and a hint ("3 live", "2 active jobs"), which folds the stat strip into the navigation. The topbar crumb reads "Admin › Runs". ≤900px the rail becomes a horizontal strip.
- **Danger**: every row has one `IconButton more` → `DropdownMenu`; the destructive item is `tone="danger"` and separated, with disabled items explained via `description` ("You cannot disable your own account"). Danger tone appears only on the menu item and the confirm dialog.
- **Trade-offs**: destructive actions are two clicks away and not scannable (good for "not noisy", worse for the "watch and force-stop" journey where speed matters); the rail costs ~220px of width so tables are tighter (column widths were reduced to fit); the stat strip's "Runs, all projects" help text is lost (no HelpMarker in the rail). Menus need the user to learn where actions live.

## Admin variant 3 — `sections` (single page, jump bar, quiet actions)

- **Navigation**: all four sections stacked under one `PageHeader`; a sticky jump bar (`aria-label="On this page"`, `aria-current="location"`) scroll-spies the shell scroller and mirrors into `#hash`; `SectionHeader level="xl"` separates sections. Deep link `#users` scrolls on load.
- **Danger**: quiet `Button variant="ghost"` with a stop icon in rows; red appears **only** on the terminal `ConfirmDialog`. For the irreversible job the typed confirmation moves into the dialog (`requireText`), so the form stays plain and the "Queue job…" ellipsis signals the extra step.
- **Trade-offs**: quiet actions are easy to miss on first use (discoverability) and ghost buttons on hover look like links; one page means maintenance polling, live polling and the users table all mount at once (more requests, heavier page); scrolling past three tables to reach maintenance is slower than a tab. Back/forward between sections is hash-only.

## Docs variants — design question B

Shared implementation `docs/__mocks__/_shared/DocsMock.tsx` with `layout` and
`search` props. Shared behaviour: nav rail with `SearchField hint="/"`
(`/` focuses from anywhere, Enter opens the first hit, Escape clears, hidden
`aria-describedby` explains the keys); active nav item scrolled into view on
mount (`scrollIntoView({block:'nearest'})` inside the sticky rail, which is its
own scroller); headings get an `aria-label`led `#` anchor that is invisible
until hover/focus (no "#" read aloud as text); `IntersectionObserver` scroll-spy
on the shell scroller with `rootMargin 0 0 -75% 0`; code block with language
header + `CopyButton`; `tip` / `warn` callouts as `role=note`; table scroll
wrapper; prev/next `LinkButton`s with a label stack; "Last updated · Edit this
page" line. Prose uses only the `--docs-*` tokens (sanctioned exception) and the
`--code-*` palette for the hand-tokenised Shiki output.

- **`three-column`** (nav · article · TOC, in-place nav filter). Search filters sections/pages in place; heading matches nest under their page as sub-items with a list icon, so the crumb is the nav hierarchy itself. ≤1100px the TOC becomes a `<details>` "On this page" disclosure at the top of the article whose summary shows the current heading (TOC substitute requirement). Trade-off: filtering hides the rest of the IA while typing, and a page with many heading hits grows the list.
- **`two-column`** (nav · article with an inline "On this page" block, results popover). The TOC is a card at the top of the article (auto-fill grid, current entry highlighted) — always visible at every width, so no substitute is needed and the article can use the full `--docs-content-max`. Search opens a results list under the field (`role=listbox`, first result pre-selected, crumb "Section › Page", heading hits marked). Trade-offs: the inline TOC is not sticky, so the current-heading highlight is only visible at the top of the page; the grid flattens h2/h3 hierarchy to an indent.
- **`hybrid`** (three columns + results popover). Same layout as `three-column`, search as in `two-column`: the nav stays intact while a popover lists page and heading matches with crumbs. Trade-off: two overlapping list surfaces (popover over nav) at narrow widths.

## Foundation primitives that were missing (not added; listed for the reviewer)

1. **`SubNav` / vertical route rail** — `Tabs orientation="vertical"` exists but is a tablist, not links; the rail variant hand-rolls anchor styling (`rail/Mock.module.css`) copied from the settings prompt-rail recipe. A `NavRail` primitive (`aria-current`, count slot, sticky, collapses to a horizontal strip) would be reused by settings too.
2. **`JumpBar` / anchor nav with scroll-spy** — the sections variant and the docs TOC both implement `aria-current="location"` lists with their own IntersectionObserver/scroll handlers. A `useScrollSpy(rootRef, ids)` hook + an `AnchorNav` primitive would dedupe them.
3. **`OneTimeSecret`** — readonly mono field + copy + "not shown again" note; brief §8 says to reuse it for API key / dataset-token reveal in Project Settings. Mocked inline in `UsersPanel.tsx` (`.secretBlock`).
4. **`Notice` / inline callout** — a non-blocking warning/info strip (used for `db_stats.error`, job error, docs tip/warn). `StaleBanner` and `ErrorState` are too specific; `EmptyState` is too tall.
5. **`ProgressCell`** — bar + "done/total" mono text used in live runs; mocked in `RunsPanel.tsx`.
6. **`CodeBlock`** with header/language/copy and the tokenised palette — docs-only today but the run detail and playground areas will need the same recipe.
7. **`Disclosure`** (`<details>` styled) — used for the narrow-width TOC substitute.
8. **`Table` for prose** — a plain styled `<table>` recipe for docs (DataTable is a react-aria grid and is wrong for static prose tables).
9. `Dialog` has no `busy` prop that locks close affordances in one go; the edit dialog sets `hideClose` + `isKeyboardDismissDisabled` + `dismissOnBackdrop=false` separately.
10. `SearchField` does not expose `aria-activedescendant`/listbox wiring for an attached results popover (the popover variants use a plain `role=listbox` with buttons; keyboard navigation inside the results is Tab-based).
