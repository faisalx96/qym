# Shell design notes — three app-shell variants

Written by the design sub-agent for the foundation agent (playbook step 3). The
three variants are real TSX prototypes under `__mocks__/<variant>/`, served by the
dev server at `/app/__mock/shell/<variant>`. They share the fixture data
(`fixtures.ts`), the URL-driven mock state (`shared/state.ts`) and most chrome
pieces (`shared/`); only the *arrangement* of navigation differs. Every variant is
built from the foundation primitives in `frontend/src/ui/` (Button, IconButton,
Popover, DropdownMenu, Dialog, FormDialog, SearchField, Tabs, Tag, Identicon,
DataTable, StatStrip, PageHeader, EmptyState, Kbd, Text).

Dev server: `cd frontend && QYM_PLATFORM_PORT=8800 npx vite --port 5800 --strictPort --host 127.0.0.1`.

## 0. What is shared (identical in A, B and C)

| Piece | Where | Behaviour |
|---|---|---|
| Mock state | `shared/state.ts` | Everything lives in the query string: `?view=login\|projects`, `?project=<slug>` (`demo` default, `old` = archived), `?page=<id>` (`runs` default; `profile`/`admin`/`trash`/`docs` are project-less), `?tab=<id>`, `?run=<id>`, `?login=signin\|signup\|change`, `?collapsed=1`, `?expanded=1`, `?switcher=open`, `?menu=open`, `?palette=open`, `?create=open`. `set()` uses `replace` history, so opening/closing popovers never pollutes Back. |
| Brand | `Chrome.tsx` `Brand` | Green `ق` mark + "qym", links to the projects landing, `aria-label="qym — Projects"`. |
| Project context | `Chrome.tsx` `ProjectChip` | Identicon (seeded by slug) + name (`dir="auto"`, ellipsis) + `Archived` warning tag when `is_active:false`. Used in the switcher trigger, the switcher list, the sidebar/rail section title and the palette. |
| Breadcrumbs | `Chrome.tsx` `Breadcrumbs` | `<nav aria-label="Breadcrumb"><ol>`; the switcher trigger is the leading crumb, the last crumb carries `aria-current="page"`; run ids render mono (`data-mono`). Fixes §7.10 (current crumb had no `aria-current`). |
| Topbar stats | `Chrome.tsx` `TopbarStats` | `role="group" aria-label="Page statistics"`, label `--shell-font-xs` uppercase muted, value mono `--shell-font-sm` 650. Rendered only on the project Runs list (not on run detail, settings or global pages) — this mirrors `useTopbarStats` being page-driven. Hidden ≤760px (the page's StatStrip repeats the numbers). |
| Archived state | `Chrome.tsx` `ArchivedNotice` + `Tag "Read-only"` in the topbar + `hiddenWhenArchived` nav filter | One `role="status"` banner under the topbar with an "Unarchive it" deep link to `settings?tab=danger` for admins; Auto-analysis and Reviews disappear from the nav; page actions render `isDisabled`. |
| Project switcher body | `Switcher.tsx` `ProjectSwitcherList` | Labelled SearchField (autofocus), `<ul aria-label="Projects">`, current item `aria-current="true"` + check, ArrowUp/Down move between items, Escape closes (Popover/Dialog), "Create project" footer. Fixes §7.10 (search had `placeholder` only). |
| Create project | `Switcher.tsx` `CreateProjectDialog` | FormDialog: Name (autofocus) + Slug (mono, derived from name until edited, validated `^[a-z0-9-]{2,40}$`), Enter submits, focus trapped, returned to the trigger on close. Opened from the switcher footer, the projects landing "New project" button, and (C only) the palette action. |
| User menu | `UserMenu.tsx` | DropdownMenu with a header card (avatar, name, email, role tag), items Profile / Admin (admin only) / Sign out (separator before). Trigger gets `aria-expanded`/`aria-haspopup` from the primitive. Fixes §7.10 (user popover lacked `aria-expanded`/`aria-controls`, focus did not return). |
| Login | `LoginView.tsx` | One form for sign-in / sign-up / change-password (`?login=`), `aria-labelledby` title, `role="status"` error, 42px "auth" fields, provider buttons under an "Or continue with" separator. Mode switch re-renders only the changed fields (not the whole form) — §7.9. `layout="card"` (A, C) or `layout="split"` (B). |
| Projects landing | `ProjectsLanding.tsx` | PageHeader (title / description / meta / "New project" action when ADMIN or any MANAGER role), search + "Show archived (n)" switch, card grid (`<ul aria-label="Projects">`, cards are links), EmptyState for no match. |
| Sample pages | `Pages.tsx` | Runs list (full-width: PageHeader + StatStrip + DataTable `minWidth=900`), run detail, Settings (constrained, Tabs with `?tab=` in the URL, arrow keys from the primitive — fixes §7.4), generic placeholders. |
| Chrome type | `shared.module.css` | Chrome text uses `--shell-font-xs/sm/md` (12/13/15px) only; page content uses `--font-*`. No hardcoded sizes or colors; `--text-dim` only on the crumb separator and the switcher chevron (decorative). |

All three variants therefore score identically on J1 (login), J4 (landing), J5/J6
page bodies and the dialogs; the comparison is about **where navigation lives**
and what that costs in horizontal room, discoverability and keyboard reach.

## A — `sidebar/`: persistent sidebar, refined

URL: `/app/__mock/shell/sidebar`

**Rationale.** Keep the model users already know (`shell.js` sidebar + topbar)
but fix its defects: a real `<nav>` per section, `aria-current`, `aria-label` on
collapsed items (not `data-tooltip` only), a labelled collapse toggle with
`aria-expanded`/`aria-controls`, the project named in the sidebar itself, and a
user footer instead of a topbar avatar.

**Layout.** `aside` 192px (`--sidebar-w`) / 56px collapsed (`--sidebar-collapsed-w`),
`--bg-base`, three sections — *Global* (Projects, Docs), *<project> pages*
(section title is a small `ProjectChip`; Runs, Overview, Charts, Models,
Experiments, Datasets, Auto-analysis, Reviews, Settings), *Platform* (Admin with
an `Admin` accent tag, Deleted runs; admins only) — and a footer with the user
trigger (avatar + name + email). Topbar 50px: collapse toggle · breadcrumb
switcher · crumbs · stats slot (right) · `Read-only` tag when archived.

**Optimises for:** zero-cost discovery (every page is one click, always visible),
orientation (active item highlighted with the accent icon and `--bg-active`), and
the admin's view of the three scopes at once.

**Trade-offs.** 192px of permanent horizontal cost on data-dense pages (Runs,
Charts, Compare) unless the user collapses it; the project section title and the
breadcrumb switcher both show the project (deliberate redundancy — the sidebar
title is orientation, the breadcrumb is the control). Collapsed state depends on
hover/focus tooltips (`data-tooltip` + `aria-label`).

**Density / type.** Nav items 32px tall, `--shell-font-sm` 500 (600 active),
section titles `--shell-font-xs` uppercase 650 muted. Topbar `--shell-font-sm`.

**Project context:** the sidebar section title (identicon + name) **and** the
breadcrumb switcher trigger (identicon + name + `Archived` tag + chevron).

**Topbar stats:** right end of the topbar. **Create project:** switcher footer and
the landing's "New project" button.

**Login:** centred 400px card (`layout="card"`) with brand mark, radial accent glow
on `--bg-void`.

**≤760px:** auto-collapses to the 56px icon rail (`useMediaQuery(NARROW)`); the
toggle then sets `?expanded=1`, which overlays the full sidebar on top of the
content (`position:absolute`, popover shadow) instead of squeezing it. Topbar
stats hide; the data table keeps `100vw − 56px`.

**a11y.** `aside[aria-label="Sidebar"]`, one `<nav aria-label>` per section,
`aria-current="page"`, collapsed items `aria-label` + tooltip on `:focus-visible`,
toggle `aria-expanded` + `aria-controls="mock-sidebar"`, user trigger `aria-label`
when collapsed. Tab order: brand → global nav → project nav → platform nav → user →
toggle → switcher → crumbs → page. The overlay sidebar at ≤760px has no focus
trap (it is navigation, not a dialog) and does not close on outside click — keep
or add Escape-to-collapse in the implementation.

**§7 pain points fixed:** 4 (settings tabs keyboard + URL), 9 (login mode switch
keeps field state), 10 (all items), 11 (no pending guard; client-rendered chrome),
13 (archived = one banner + one nav filter + `isDisabled` on page actions).

## B — `topbar/`: single topbar with horizontal page nav

URL: `/app/__mock/shell/topbar`

**Rationale.** Give data-dense pages the full viewport width by moving all
navigation into two topbar rows. Row 1 is *context* (brand · switcher + crumbs ·
Docs · user avatar); row 2 is *pages* (underline tabs for the current project, or
Projects/Docs when there is no project) plus the admin "Platform" dropdown and
the stats slot.

**Layout.** `header` = row 1 (50px, `--topbar-h`) + row 2 (36px, `--page-nav-h`),
both `--bg-base`; `main` below is the only scroller. No `aside`.

**Optimises for:** horizontal room (tables get `100vw − 2×14px`), a compact look
on 13" laptops, and a familiar "GitHub repo tabs" model: project first, section
second.

**Trade-offs.** Two rows cost 86px vertically vs 50px in A/C. Nine project tabs
need ~700px; at narrower widths the tab strip scrolls (`overflow-x:auto`, hidden
scrollbar) and the Platform/stats cluster competes for the same row. Global pages
(Profile, Admin, Deleted runs) only reach row 2 when no project is selected, so
from inside a project the admin goes through the Platform dropdown or the user
menu — one extra step versus A/C. The `aria-current` tab is the only project
affordance besides the switcher chip.

**Density / type.** Tabs `--shell-font-sm` 600 muted, active primary with a 2px
accent underline; row-1 links `--shell-font-sm` 500.

**Project context:** only the breadcrumb switcher trigger in row 1 (identicon +
name + `Archived` tag); `max-width: 320px` (180px at ≤760px, ellipsis).

**Topbar stats:** right end of row 2 (next to Platform). **Create project:**
switcher footer and the landing button.

**Login:** split page (`layout="split"`): a brand panel (mark, `qym · قيِّم`,
three bullets, `Enter` hint) on the left and the form on the right; the panel is
dropped ≤760px.

**≤760px:** row 2 replaces the tab strip with a single "<current page> ▾"
DropdownMenu (`.pageMenu`), the Docs link becomes icon-only, the switcher
narrows; stats hide.

**a11y.** `nav[aria-label="<project> pages"]` with `aria-current="page"` links,
Platform and page dropdowns are React-Aria menus (arrow keys, typeahead, Escape),
user trigger is an IconButton with a full `aria-label`. Tab order: brand →
switcher → crumbs → Docs → user → tabs… → Platform → page. The scrolling tab
strip has no overflow indicator; focused off-screen tabs scroll into view via the
browser only.

**§7 pain points fixed:** 4, 9, 10, 11, 13 (as A). Does **not** change anything
for 1–3, 5–8, 12 (those are implementation/back-end items in every variant).

## C — `palette/`: icon rail + Ctrl/Cmd+K command palette

URL: `/app/__mock/shell/palette`

**Rationale.** Treat navigation as search: a 56px icon rail keeps every page one
click away for mouse users, while the palette (`Ctrl/⌘+K`, the rail's "Search…"
button, or the topbar "Go to" button) is the primary path for keyboard users and
for cross-project jumps (switch project → page → action in one box). The
breadcrumb switcher opens the same dialog in `scope="projects"`.

**Layout.** `aside.rail` 56px (`--sidebar-collapsed-w`), expands to 192px on
`:hover` / `:focus-within` as an **overlay** (content never reflows); sections
mirror A (Global / <project> pages / Platform) with labels revealed only when
expanded; footer user trigger. Topbar 50px: (≤760px menu button) · switcher ·
crumbs · stats · `Read-only` · "Go to ⌘K".

**Palette** (`CommandPalette.tsx`): Dialog titled "Go to" / "Switch project",
labelled SearchField, groups *Projects* (chip + slug tag, current gets a check and
`aria-current`), *Pages* (project pages with the project name as hint, then
global/Platform pages), *Actions* (Create project…, Manage members → `settings?tab=members`,
API keys → `settings?tab=apikeys`, Profile, Sign out). ArrowDown from the input
moves into the results, Enter in the input runs the first result, Escape closes,
footer shows the key hints.

**Optimises for:** keyboard speed (any page or project in ≤3 keystrokes + Enter),
horizontal room (56px fixed), and a single discoverable entry point for actions
that are otherwise buried in settings tabs.

**Trade-offs.** Hover-expanding rails are hard to use with touch and screen
magnifiers and the expanded overlay covers the first 136px of content; icons
without labels are weak for new users (the rail relies on `aria-label` + CSS
tooltip). The palette is modal — it steals the page's state (filters are kept
because it is a separate dialog, but the user loses sight of the table). The
visible "Go to" button is small; discoverability of `⌘K` is the known risk of this
pattern. Two surfaces for switching projects (palette scope vs. the rail) must
stay in sync in the real implementation.

**Density / type.** Rail items 32px, icons 16px; palette rows `--dropdown-option-height`,
`--font-md`; group titles `--font-sm` uppercase muted.

**Project context:** breadcrumb switcher trigger (identicon + name + `Archived`
tag + chevron, `aria-haspopup="dialog"` + `aria-expanded`); the rail section title
appears only while expanded.

**Topbar stats:** topbar, before the Read-only tag and the "Go to" button.
**Create project:** palette action, switcher footer (projects scope) and the
landing button.

**Login:** centred card, as A.

**≤760px:** the rail is removed entirely; a `menu` IconButton ("Open navigation")
opens the palette, the "Go to" button collapses to icon + `Ctrl K` chip; stats hide.

**a11y.** Rail = `aside[aria-label="Navigation rail"]` with the same `<nav>`
structure as A (icons carry `aria-label` through `NavItem`; the CSS reveals labels
on `:focus-within`, so keyboard users see labels while tabbing). Palette = React-Aria
Dialog (focus trapped, returned on close), results are real links/buttons (`data-command`),
groups are `<section aria-label>`. `aria-keyshortcuts` on the rail search button.
Known gaps: results are not a `listbox` (no `aria-activedescendant`), so a screen
reader hears a list of links; the hover-expand has no reduced-motion handling
(width transition uses `--transition-fast`); no `Escape` on the expanded rail.

**§7 pain points fixed:** 4, 9, 10, 11, 13 (as A), plus a shortcut for §7.6's
"settings are many clicks away" symptom (Manage members / API keys actions).

## Rendering fix applied during this session

`shared.module.css`: at ≤760px with an archived project the topbar overflowed
in all three variants (the `Read-only` tag wrapped to two lines, the current crumb
collapsed to "R…", and B's project chip clipped the identicon). Fixed by hiding
`.topbarStats` ≤760px, giving `.projectName` `min-width:0` with the tag/identicon
`flex:none`, and letting the Button label wrapper inside `.switcherTrigger` shrink
(`display:inline-flex; min-width:0`, `justify-content:flex-start`, `overflow:hidden`).
No variant-specific file changed, so the comparison stays fair.

## Things the real AppShell must keep regardless of the winner

- Breadcrumb switcher trigger = `ProjectChip` + chevron, with `aria-expanded`;
  the last crumb has `aria-current="page"`; run ids mono.
- Switcher: labelled search, arrow-key list, current item marked, Create footer,
  `qym:last-project-slug` write on switch (not for archived).
- `hiddenWhenArchived` on the nav model (Auto-analysis, Reviews) + one banner +
  `Read-only` tag; actions `isDisabled`, never hidden ad hoc.
- Topbar stats are page-owned (`useTopbarStats`) and only on list pages; hide
  ≤760px.
- Login modes share one form; the status line is `role="status"`; provider links
  are `<a>` to `/v1/auth/login/{provider}?next=`.
- Mock-state-in-URL pattern (`useSearchParamsState`) for `?tab=` on settings.
- The main scroller is `main#shell-content[tabindex=-1]` so route changes can
  focus it.
