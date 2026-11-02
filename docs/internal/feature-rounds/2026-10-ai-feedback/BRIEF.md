# Feature round: AI-assisted feedback

Status: MERGED into `UI-redesign` as 9d75a948 on 2026-10-23 (review `review-e.md`: 173 MEETS, 6 MEETS WITH FIXES, 5 DOES NOT MEET documented as limitations; migration `0091` follows `0090`; integration fixes in `fix/sdk-viewer-bundle` dcf23bc9 and `fix/integration-gate2`). DESIGN started 2026-10-23 from `UI-redesign` 0d725715 (platform 2.0.0 / SDK 2.0.0, migration head `0088`;
the multi-dataset round in flight takes `0089` and `0090`, so this round's migration is `0091`, `down_revision` set at
implementation time to the head of `UI-redesign` then).

## 1. Owner request (verbatim, 2026-10-23)

> I need you to develop a new feature of AI assisted feedback the goal is that users can submit their feedback and then
> chat with an agent that understand the system to collect more detailed business needs and justification, then the
> agent if the information collected is enough would prompt the user to confirm a detailed description, priority level,
> and technical complexity, and possible conflicts with other user needs (highlight that a request is duplicated if so).
>
> design the plan and ask me clarifying questions if needed, then start the loop of criteria design agent,
> implementation agent, QA agent.

## 2. Owner decisions (asked 2026-10-23; final, never re-asked)

| Id | Question | Decision |
|---|---|---|
| G1 | What is the feedback about? | **Both, chosen at submission.** Subject `platform` (a need or change request about qym itself; the agent's knowledge pack is qym's own documentation) or `product` (about an evaluated product; the request belongs to a project and may point at a run, experiment or dataset; the agent's pack is that project's facts). |
| G2 | Who sees and triages? | **Everyone sees all, admins triage.** One platform-wide list readable by every signed-in user (duplicate awareness needs it); platform ADMINs set the status (`new`, `accepted`, `planned`, `done`, `declined`) and may revise priority and complexity with a note. |
| G3 | Which LLM? | **A platform-level connection set by admins.** New Admin setting: one OpenAI-compatible connection (base URL, model, key; same encryption as project connections) for the feedback agent, independent of projects. Feedback shows "not configured" until an admin sets it. |
| G4 | Priority and complexity? | **Agent proposes, user confirms, admin can override.** Priority `low / medium / high / critical`; complexity `S / M / L / XL`; the agent's reasoning is shown; the user confirms or changes both before submitting; admins can revise later with a note (history kept). |

## 2b. Owner amendments after the design (2026-10-23)

Owner feedback after reviewing the mocks, verbatim: "1- size wording is not clear (maybe change it to complexity or something else more technical) 2- allow the admins to export the list of feedbacks." Follow-up: "allow multiple format export (CSV, Excel, json, jsonl)"

| Id | Decision |
|---|---|
| G5 | The word "Size" becomes **Complexity** everywhere the person sees it (list column and facet, URL parameter `complexity=`, proposal card, request page, triage panel, history). Scale S / M / L / XL and its guidance words are unchanged; API fields already say `complexity`. |
| G6 | Platform administrators can **export the feedback list** as CSV, Excel, JSON or JSON Lines (`GET /v1/feedback/export?format=csv|xlsx|json|jsonl`, ADMIN only, same filters as the list, drafts never, every matching row, one audit entry per export). The request page still has no export. |

## 3. What exists today (survey 2026-10-23)

- LLM: `project_llm_connections` (`db/models.py:523`: name, base URL, model, encrypted key + last4, default flag),
  `services/llm_connections.py`, `openai_compat.create_chat_completion_compat` (retries over `max_tokens` /
  `response_format` quirks), `services/llm_analyzer.build_client(llm_config) -> AsyncOpenAI`, `api/analysis.py`
  `_resolve_connection` / `_get_llm_config` and `StreamingResponse` (SSE) for analysis output. Key encryption: the
  platform's LLM config encryption (`QYM_LLM_CONFIG_ENCRYPTION_KEY`, see `tests/platform/test_eval_dispatcher.py` `_env`).
- Roles: `UserRole` ADMIN / MEMBER (platform), `ProjectRole` MANAGER / MEMBER. Auth: `QYM_AUTH_MODE`, `principal`.
- Background jobs: `db/background_job_models.py` (`background_jobs`, kinds with scope and heartbeat) if the agent turn
  must outlive a request; `audit_logs` for admin actions.
- Frontend: features under `frontend/src/features/` (admin, datasets, experiments, runs-list, run-detail, reviews,
  shell ...); router `frontend/src/app/router.tsx`; primitives in `frontend/src/ui/`; gallery `/__ui`.
- Nothing named feedback exists (no table, route, page or doc section). Docs: `docs/USER_GUIDE.md` is the knowledge
  source for the `platform` subject.

## 4. Scope (one work package, WP-E "AI-assisted feedback")

Branch `feat/ai-feedback`, worktree `../qym-wt-ai-feedback`. Migration `0091`.

1. **Data**: `feedback_requests` (id, subject `platform|product`, project_id nullable (required for `product`),
   target {kind: run|experiment|dataset, id} nullable, title, summary (one line), description (detailed, confirmed),
   business_need, justification, priority, complexity, agent_priority, agent_complexity, agent_reasoning JSON,
   status, duplicate_of_id nullable, conflicts JSON [{request_id, kind: duplicate|conflict|related, note}],
   submitter_user_id, created_at, confirmed_at, updated_at, triage history JSON or a `feedback_request_events` table
   for admin revisions with notes) and `feedback_messages` (request_id, seq, role user|assistant|tool, content,
   tool_name, tool_payload JSON, created_at). Platform setting rows for the agent connection (`platform_settings`
   or a new `platform_llm_connections` table; the design decides and records it).
2. **Agent (server side)**: `services/feedback_agent.py`. One conversation per request; every user message answers
   with the assistant's next question(s) or, when enough is known, a **proposal** (structured output: description,
   business need, justification, priority + reasoning, complexity + reasoning, conflicts and duplicates with
   request ids and a note). Grounding: the knowledge pack (subject `platform`: a condensed feature catalogue built
   from `docs/USER_GUIDE.md` at build time or startup, bounded in size; subject `product`: the project's
   environments, datasets, metric names and the last N runs' task labels) and a **search tool** over existing
   requests (title, summary, business need; lexical first, the design may add embeddings as a later option) so that
   duplicates and conflicts are real records. Streaming of assistant text to the browser (SSE, as analysis does).
   The agent never invents a request id. Prompt-injection: user text is data; the proposal is validated server
   side (ids must exist, scales must be in range).
3. **Flow**: Feedback → New → subject (+ project, optional target) → first message → chat → proposal card →
   confirm (edit priority, complexity, description allowed) → request `new`. Transcript kept and shown on the
   request page. Abandoned drafts (no confirmation) are kept as `draft` for the submitter only, resumable, and
   deleted after 30 days (a setting).
4. **Triage (admins)**: status changes, priority and complexity revisions with a note, marking a request as a
   duplicate of another (both pages link), decline with a reason. Every action in `audit_logs`.
5. **UI**: `/feedback` list (columns: title, subject, project, priority, complexity, status, submitter, date; filters;
   duplicates grouped under their canonical request; search), `/feedback/new` (subject step then chat), `/feedback/:id`
   (confirmed card, conflicts/duplicates panel, transcript, admin triage panel), Admin → "Feedback agent" connection
   page (test connection button), a "Feedback" entry in the app shell navigation. "Not configured" and "agent
   unavailable" states; the chat works with the keyboard; 1440 / 1024 / 390.
6. **Docs**: USER_GUIDE section, OPERATIONS (setting, encryption, data retention), RELEASE_NOTES, AGENTS.md env table.
7. **Tests**: platform (SQLite + PostgreSQL) with a stub OpenAI-compatible server (fixture; the frontend dev stub if
   one exists, else a small FastAPI stub in `tests/platform/`), Vitest, Playwright with the stub serving scripted
   conversations; design-language test.

## 5. Process (AGENTS.md "UI product-feedback rounds", playbook)

1. **Design**: measure the pages this feature borrows from (runs list, run detail, admin pages) at 1440 / 1024 / 390;
   write `spec-e.md` with numbered acceptance criteria (QE-1…; DOM element, width, number), decisions log (QE-D1…),
   the agent's conversation protocol (states, what "enough information" means as a checklist the model must fill,
   the proposal JSON schema, the search tool contract, the knowledge pack format), the data model, API routes,
   and the test plan; **composed page mocks first** (`/__ui#ai-feedback`: list, new/chat mid-conversation, proposal
   card, request page, admin triage, admin connection page; whole pages in the app shell with realistic data, shots
   at 1440 and 390), state sheets as the appendix.
2. **Implement** criterion by criterion (criterion -> change -> test table, after-screenshots); full gate through the
   session's gate lock (`scratchpad/gated-heavy.sh`) including `tests/platform` on SQLite and PostgreSQL (Podman).
3. **Review** by an independent agent with measurements; fix pass; `--no-ff` merge into `UI-redesign` after the
   multi-dataset round's merges; integration gate.

Ports (platform / Vite; eval fakes +100/+101; stub LLM +1000): design 9006/6012, implement 9008/6014, review 9010/6016.
Each agent: own `QYM_E2E_DB`, own scratch file names, `pytest -n 2` through the gate lock, never `pkill -f`, never a
scratch venv (the project `.venv` only).
