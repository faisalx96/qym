# QA feedback round, October 2026 (datasets access / eval flags follow-up)

Status: IN PROGRESS (started 2026-10-21 from `UI-redesign` e6700a95, platform 2.0.0 / SDK 2.0.0).
Previous round: `docs/internal/feature-rounds/2026-10-dataset-access/` (design doc
`docs/internal/DATASET_ACCESS_AND_EVAL_FLAGS_DESIGN.md`, owner decisions D1-D7 there stay in force).

## 1. The owner's feedback, verbatim

> after the QA review on the new features those are the most important feedback points:
>
> 1- the metadata filter doesn't show keys that include a list of items, it should show them and allow the user to filter by them and add
> button for them to allow the user to choose full match or partial.
> 2- in experimentation creation the user shouldn't be able to change versioning details.
> 3- in experimentation creation, the latency sensitive flag should also show in the homepage.
> 4- in experimentation creation, the evaluation service versions should also show in the customization first page below the environment.
> 5- fix spacing utilization in the dataset settings, and separate the permission into another tab with clearer view.
>
> general UI notes:
> 1- boxes for project, datasets.. shouldn't show an underline below each text when the user hover above them.

## 2. Owner decisions (asked 2026-10-21; final, never re-ask)

| Id | Question | Decision |
|---|---|---|
| E1 | List-valued metadata keys: meaning of "partial" and "full match" | **Partial**: the item's list contains *some* of the chosen values (any of them). **Full match**: *all* chosen values exist in the item's list (the list may hold more). Example key `tags: ["a","b"]`: choosing `a` matches in both modes; choosing `a` and `c` matches in partial only. |
| E2 | What replaces the free-form "Versioning details" box at experiment creation | Remove the box. The launch form shows the Evaluation Service's current versions (`agent`, `image`, `kb` from `GET /evals/versioning-details/current`) **read-only**; experiments record only what the service reports. Nothing user-typed is kept, Rerun carries nothing user-typed. |
| E3 | "Homepage" where the latency-sensitive flag must also show | Three places: the **first Customize page** of experiment creation, the **Runs page** (project home: runs that came from a latency-sensitive experiment), and the **Experiments list**. |
| E4 | Where the separated dataset permissions view lives | A **new top-level "Access" tab** on the dataset page next to Items / Runs / Lineage / Settings. Settings keeps only the rest (name, description, flags, danger zone). |

Standing decisions from the previous round that apply here: D5 two work packages in parallel; D6 full round (numbered criteria, gallery
mocks, screenshots, measured review); D7 dotted nested paths up to 3 levels.

## 3. Work packages

| WP | Branch | Worktree | Scope | Criteria ids |
|---|---|---|---|---|
| QA-A datasets | `feat/qa-datasets` | `../qym-wt-dataset-access` | Point 1 (list facets, partial/full), point 5 (Settings spacing, Access tab), general note 1 (no hover underline on project / dataset / other link cards) | `QA1-n`, `QA5-n`, `QG1-n` |
| QA-B experiments | `feat/qa-experiments` | `../qym-wt-eval-flags` | Point 2 (versioning read-only), point 3 (latency flag on first Customize page, Runs page, Experiments list), point 4 (service versions on first Customize page below the environment) | `QA2-n`, `QA3-n`, `QA4-n` |

Round files live in this folder: `spec-a.md`, `spec-b.md`, `impl-notes-a.md`, `impl-notes-b.md`, `review-a.md`, `review-b.md`, `measure/`,
`shots/`, `GATE.md`. The cycle is AGENTS.md "UI product-feedback rounds": design -> implement -> independent measured review -> fix pass ->
re-review -> `--no-ff` merge into `UI-redesign` -> integration gate.

## 4. Technical notes for the designers (constraints, not decisions)

- Point 1: `services/dataset_meta.py` `_walk` skips lists today (only scalar leaves become facets) and `apply_meta_filters` ANDs exact
  scalar matches (`meta=path:value`). The spec must fix: how a list-valued path is reported by `items:metadata-facets` (values are the
  distinct elements, counts are items, a `kind: "list"` marker), the query parameter shape for several values and the mode
  (partial = any, full = all, E1), the same filter in `items:batch` `filter`, SQLite and Postgres both, and the facets cache key.
  Keys mixing lists and scalars across items, lists of objects (not scalars) and lists longer than the facet limits need a stated rule.
- Point 2: today `launch/entry/RunSettings.tsx` has the "Versioning details" textarea (`PSEUDO.versioning`) and `VersionsBlock.tsx` shows the
  service's current versions on the Models step. `ExperimentCreateRequest.versioning_details` and Rerun carry user-typed keys; the spec says
  what the API does with a client that still sends them (E2: not kept).
- Point 3: the runs list row needs to know its experiment's `latency_sensitive` (`qym run list` carries `experiment {id, name, job_id}`);
  the spec names the payload field and where the tag sits in the row (`features/runs-list`), the Experiments list row tag, and the first
  Customize page control (it is the same value as the Run settings checkbox; one source of truth).
- Point 4: the first Customize page (environment selection) shows, under each selected environment, the same versions block as the Models
  step (`VersionsBlock.tsx`), with the same "Not supported" / error states and Refresh.
- Point 5 and general note 1: measure `detail/SettingsTab.tsx` and `detail/AccessSection.tsx` at 1440 / 1024 / 390 before specifying;
  the hover underline comes from the global `a:hover { text-decoration: underline }` in `frontend/src/styles/base.css`; the spec decides
  the rule (card links opt out; plain text links keep it) and lists every card surface it applies to (projects page, datasets catalog,
  environments, experiments, …).
