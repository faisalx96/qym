# Round 9 implementation notes B: one environment page, clickable environment tables (points 7 and 9)

Branch `ui/redesign9-envs` (from design tip 355b7e6e). Spec: `experiments.md` sections 8, 10, 11.3, 11.5. Decision J1
(orchestrator, final): `?from=settings` is honoured, the back link reads "Project settings" and returns to
`/projects/<slug>/settings?tab=environments`; otherwise "All environments". Frontend only: no backend, route table or
migration change, so `tests/platform` was not re-run (only `test_design_language.py`).

## Criterion -> change -> test

Tests are in `frontend/e2e/experiments/r9-environments.spec.ts` (R9 file) and the updated `environments.spec.ts` (ENV).

| Criterion | Change | Test |
|---|---|---|
| C-7-1 route | `EnvironmentsPanel.tsx`: `EnvironmentDrawer` deleted; `EnvironmentsList` takes `rowHref`, settings passes `environmentPath(slug, id)?from=settings`; Experiments passes the bare path. One route (`EnvironmentsRoutes`) and one host (`EnvironmentPage`) | R9 "both entries land on the same page" (URL cell click in both places, same pathname, 0 `[role=dialog]`); ENV "a row opens the one environment page" |
| C-7-2 same DOM, 1193 px | `EnvironmentPanelBody` is the only body; `data-part="env-page"` on it; `Section.tsx` emits `data-part="env-section-<status\|schema\|tasks\|groups\|preset\|saved-presets\|ranking\|policies\|connection>"` | R9: section list equal in both entries and contains all 9, `innerText` equal after normalising relative times, body width 1190..1196 and equal in both |
| C-7-3 390 | same component, no change needed | R9 "C-7-3": all sections, body 277..281 px, `scrollWidth - clientWidth <= 0` |
| C-7-4 legacy URLs | `EnvironmentsPanel` returns `<Navigate replace>` to the page when `?env=` is present and not a `promote` hand-off; `promote=` effect unchanged | R9 "C-7-4" (one history entry: Back lands on the settings list; promote still reaches `default-preset/edit`); ENV same deep link; `e2e/shell/navigation.spec.ts` URL list unchanged and green |
| C-7-5 header | unchanged `PageHeader` (h1 name, URL description, Disabled tag, Experiments tabs); back link is `Project settings` or `All environments` (J1) | R9: h1, selected Environments tab, both back links and their hrefs, `All environments` absent from the settings entry |
| C-7-6 footer | `SettingsForm`: `data-part="env-footer"`, Close and `onClose` removed everywhere, buttons `size="sm"`; `.footer` now the action-bar recipe (`--bg-elevated`, `--border-default`, `--shadow-popover`, `min-height: var(--bar-action-h)`) | R9: two buttons in order, height 56..57 px, 0 Close |
| C-7-7 Tasks | `TasksSection` (`EnvironmentSections.tsx`, after Schema): `useEnvTasks`, `Tag kind="task"` per task, "default: <name>", Refresh; no `task` capability, status `unsupported` (404/405/422) -> "This service does not offer task selection." and 0 tags; loading line holds the 24 px control height (`.taskSkel`) | R9 "C-7-7": 2 tags + default on a task service; the line and 0 tags on a service without tasks |
| C-9-1 row | `EnvironmentsList` passes `rowHref`; the primitive sets `data-clickable`, `cursor: pointer`; `data-part="env-row"` through `rowProps` | R9 table test: attribute, computed cursor `pointer`, height 40 |
| C-9-2 any cell | same (`rowHref`); the row handler already ignores `INTERACTIVE`, menus and drags | R9 "C-9-2": every cell without a button navigates; row menu opens without navigating; a 114 px text drag does not navigate |
| C-9-3 hover | `EnvironmentsTable.module.css`: `tr:hover .nameLink` underline, `tr:hover .chev` colour `--text-primary` (rest `--text-muted`); fill is the primitive's `--bg-hover` | R9: pointer on the URL cell, every `td` `rgb(42, 42, 60)`, name `underline`, chevron colour differs from rest |
| C-9-4 focus | primitive's `:focus-visible` band (2px accent inset on every cell); one tab stop | R9: row focused via arrow keys, `td` box-shadow is the inset ring (shot `after-page-environments-table-focus-1440.png`). The 3:1 contrast of `--accent-primary` against `--bg-hover` is a token fact (not re-measured) |
| C-9-5 keyboard | primitive: Enter opens, Space ignored (no selection), Ctrl/Cmd+click and Ctrl/Cmd+Enter `window.open` | R9: Space keeps the URL, Enter opens, Ctrl-click opens a popup with the page |
| C-9-6 name link | `<Link to={rowHref(env)}>` (`data-part="env-row-link"`), `Disabled` Tag stays beside it | R9: `getByRole('link')` with the href in both places |
| C-9-7 chevron | `open` column (`Chevron`, `data-part="env-row-chevron"`, 14 px `chevron-right`, no card priority); hover-only Manage row action removed (`run-default`, `test` stay) | R9: 2 chevrons for 2 rows at rest, svg 14 x 14 |
| C-9-8 cards | no `priority` on `open` so the card list skips the column; the name cell appends the chevron when `ctx.card`, absolutely placed at the name line's end (`.name > .chev`) | R9 cards test at 390: 2 `li[data-clickable]` with 2 chevrons, width >= 277, `cursor: pointer`, More/Less does not navigate, a click on the card body navigates (both places) |
| C-9-9 both places | same component and props apart from the href | R9: list of `data-part`s inside a row equal in both places (computed cursor asserted in both) |

Changed assertions (never deleted): `environments.spec.ts` (list test clicks the URL cell and the name link instead of the `Manage <name>`
icon button; the settings test replaces "opens the drawer from ?env=" with the page and redirect assertions), `a11y.spec.ts` (title and label of the former
drawer test; it now axe-checks the environment page reached from the settings deep link).

## Deviations and mock bugs

* Mock `mock-page-environment-*` crumbs for the settings entry read like the Experiments ones; the real breadcrumb component is unchanged (spec: "page crumbs unchanged").
* The mock footer is `justify-content: space-between` with two buttons; the real footer keeps the existing spacer, "Unsaved changes" tag and Save at the end.
* The Tasks "Refresh" button is shown only when the service declares `task` (otherwise nothing to refresh).
* A read-only viewer sees no footer at all (unchanged: the footer needs `canEdit`).
* The 640 px-drawer CSS in `EnvironmentPage.module.css` had no drawer-only rules; nothing else was removed.

## Shots (`redesign9/shots/`)

`after-page-environment-{experiments,settings}-{1440,390}.png`, `after-page-environments-table-{1440,390}.png`,
`after-page-environments-table-{hover,focus}-1440.png` (made by `QYM_R9_SHOTS=<dir> npx playwright test e2e/experiments/r9-environments.spec.ts -g shots`;
the "shots" test is skipped when the variable is unset).
