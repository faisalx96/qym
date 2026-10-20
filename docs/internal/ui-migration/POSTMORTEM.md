# UI migration post-mortem (2026-10-11 to 2026-10-17)

What went wrong in the React rewrite and its three product-feedback rounds, ranked by cost, with the
root cause and the rule each failure produced. The rules live in `AGENTS.md` (process and machine),
`docs/DESIGN_LANGUAGE.md` section 7 (design and review standards) and `00-PLAYBOOK.md` (the cycle).
Evidence is in `REVIEW.md`, `redesign*/review-*.md`, `redesign2/FINAL_REVIEW.md` and the session log.

## 1. Two whole-session kills (highest cost: hours of agent work, two restarts)

**What happened.** 2026-10-13 17:03: the kernel OOM killer took a Playwright Chromium, then
`systemd-oomd` killed the terminal scope holding the orchestrator and four agents. 2026-10-14 15:58:
`systemd-oomd` killed the scope again while the agents were only grepping and editing files, because
memory pressure of the whole user slice stayed at 86% against a 50% limit for 20 s (swap thrash, not
exhaustion).

**Root cause.** Four agents ran full suites at the same time on a 15 GB host with a nearly full 4 GB swap
and a 4 GB desktop baseline (VS Code, Firefox, a second Claude session). The first fix, a shared lock,
serialised bursts but bounded nothing resident. `systemd-oomd` measures the user slice as a whole, so
desktop apps count, and it kills the largest scope, which is always the terminal with every agent in it.

**Residual failures after `scripts/heavy.sh`.**
- A `pytest -n 2 tests/platform` run at `--cost 3` was killed by its own cgroup cap (exit 137).
- The final gate's platform step at `--cost 5` waited an hour, silently, because cost plus the 3 GB
  reserve needs 8 GB free and the desktop never leaves more than about 7 GB. A reviewer's `--cost 4`
  Playwright folder waited the same way until the agent lowered it by hand.
- Two long full-folder Playwright runs lost their output mid-run and had to be re-run in chunks.
- 2026-10-19 17:58, a third kill: the adaptive step added after round 6 lowered a reviewer's Playwright folder
  run from 3 GB to 2 GB after five minutes of waiting and admitted it under a 2 GB cap. The capped cgroup
  thrashed (79% pressure), swap was 3.4 of 4 GB full, the user slice crossed the oomd limit and the terminal
  scope holding the orchestrator and the reviewer was killed, then the test scope. The desktop held 9 GB
  before any test (GNOME Shell 5 GB after nine days up). Fix: the script never lowers a cost below what the
  command needs unless `--min-cost` says so, and the reserve grows by 1 GB while swap free is under 1 GB.

**Rules.** `scripts/heavy.sh` for every full suite, build and `pytest -n`, with the cost table in
`AGENTS.md`; the script never admits a run under a cap smaller than its cost and watches swap; platform
pytest runs in four chunks; every heavy run logs to a file and the orchestrator reads the log for the
`waiting` line before assuming progress; at most one sub-agent per agent; servers stopped the moment a
check ends; `free -h` with at least 3 GB available before starting another agent.

## 2. The same pages needed three feedback rounds

**What happened.** Run detail was redesigned in round 1, again in round 2 (reviewer verdict on
`ui/redesign2-run-detail`: "Approve with fixes. All eight feedback points are met and clearly better
than both the base tip and legacy"), and the product owner's round-3 feedback still said the repeat
analysis "doesn't seem clear or organized", categories "feels overwhelming", and item details are "so
ugly and non user friendly". Compare and the experiments wizard went through the same loop.

**Root cause.** Rounds 1 and 2 went from a prose brief straight to code. "Clear", "cluttered",
"report style" and "refer to the old design" were never turned into numbers, so the implementer chose
the cheapest reading and the reviewer could only confirm that features existed and that the page was
"better than legacy". Nobody measured a mock before code existed, and nobody compared the result to
the legacy page as the usability baseline the owner was pointing at.

**What fixed it.** Round 3 added a design stage: the designer measured the current and legacy pages,
wrote `redesign3/run-detail.md` with about 100 numbered acceptance criteria (each naming the DOM
element, the width and the number), built static mocks in the gallery, and the reviewer measured every
criterion in the browser. One fix pass took the branch from MEETS WITH FIXES to MEETS.

**Rule.** Every product-feedback round is design spec, implementation mapped criterion by criterion,
then an independent measured review. A reviewer verdict without numbers is not a verdict
(`DESIGN_LANGUAGE.md` section 7).

## 3. A finding "fixed" by hiding information

**What happened.** The round-2 final review (F4) said the run header was 440 px tall at 1440 against
160 px in legacy. The fix put owner, project, execution context and versioning behind a chevron,
collapsed by default (95 px), and the re-review accepted it: "nothing from legacy is lost". The owner's
next message was "run details headline have lost and removed too many details fix it". Round 3 (P6)
rebuilt the header as three always-visible bands.

**Root cause.** The height ceiling was treated as the goal. Reachable behind a click was counted as
"not lost". The reviewer checked the number, not the user's question ("what do I see when I open a
run?").

**Rule.** Never meet a size ceiling by hiding fields that were visible by default. Acceptance
criteria for information say "visible without interaction"; the fix for a tall block is density
(chips, columns, clamps with an exact "+ N more"), not disclosure.

## 4. Spec numbers taken from the wrong geometry

**What happened.** P2-12 put the repeat section at 1,750 px at 390 because the mock's column was
350 px wide while the real column is 279 px (measured: 2,023). P3-8 put categories at 460 px because the
mock's 393 px body was compared to a whole section with its 120 px header (measured: 578). The
implementer then reported the repeat panel body (about 1,900) when the criterion meant the section.

**Root cause.** Criteria did not name the element they measure, and mocks were drawn at a width
the product never renders.

**Rule.** Every criterion names its element (`#run-section-repeat`, not "the panel") and the width; mocks
are drawn in the real column widths (1193, 1033, 777, 521, 279 px for the report pages). A ceiling can
be amended only with the measured value and a one-line reason in the spec, and the test must assert
the same number.

## 5. Colour as identity beyond what the palette can carry

**What happened.** Round-2 feedback: "colors for passes are ugly and only 4 colors when there's 10
passes". The round-3 designer showed that ten hues cannot keep the palette's pairwise distance
(CIE76 dE >= 20 on the verified series ramp). Passes now carry no colour; identity is the number and
colour is only the verdict.

**Rule.** Eight series colours is the budget. Anything with more identities than that is labelled by
text, and colour on it means a state (band or verdict), never "which one".

## 6. Non-fixes accepted as fixes

**What happened.** Tracked uppercase Plex labels render unevenly ("DAT E") in headless Chromium on
Linux. The fix pass added `text-rendering: geometricPrecision`, which does not change the rendering,
and the reviewer raised the verdict to MEETS on the strength of the commit. The wording had to be
corrected by the orchestrator.

**Rule.** A fix changes the measured value or the screenshot. If it does not, it is a documented
limitation in the review file, not a fix, and the reviewer measures again instead of trusting the
commit message.

## 7. Orchestration faults (lower cost, each recurring)

| Fault | Effect | Rule |
|---|---|---|
| Design agent re-sent the same hand-back in a loop | wasted tokens, had to be stopped | one hand-back per task; the orchestrator stops a looping agent, it does not message it |
| Agents queued on the shared lock looked idle ("no agent is running at all") | owner alarm, no visibility | heavy runs log to files; status reports quote the `waiting` line and the queue |
| An agent used `pkill -f` by pattern | killed another agent's Playwright | kill only your own PIDs, found by port (`ss -ltnp`) |
| Implementers ran subset gates | the consolidated review found a real pytest failure (`POST /api/analysis-jobs/active-runs` unclassified in the read-only test) and a test defect | full gate before every hand-back; backend touched means `tests/platform` runs |
| Attribution trailer drift after a usage-limit resume | commits carry "Claude Sonnet 5.5" | the trailer is in every brief; the merger checks `git log --format=%b` before merging |
| Two bare messages "9601" never explained | unknown | ask once, record as open, do not guess |
| Vite stub needs the project venv for Playwright's webServer | agents lost time on "python not found" | environment block in every brief (`AGENTS.md`) |
