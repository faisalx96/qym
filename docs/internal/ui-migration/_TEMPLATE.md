# <Area name> — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

## 1. Surface inventory
Table: page/route | HTML file | JS/CSS files it loads | entry function(s) | approx LOC

## 2. User journeys (as-is)
Numbered journeys a user actually performs here. For each: entry point, steps,
what the user sees at each step, success/empty/error states, keyboard shortcuts,
URL/query-param state (deep links), persisted state (localStorage keys, cookies).

## 3. Functional inventory
Every feature in this area, grouped by screen section. Mark each
MUST-KEEP / NICE / DROP-CANDIDATE with one line of justification. Include hidden
behaviors: polling, live updates (SSE/WebSocket), debounced searches, infinite
scroll, optimistic updates, confirmation dialogs, toasts, clipboard, downloads.

## 4. Data & API contract
Table: method | path | query/body | response shape (field names + types) | used by.
Note auth headers, pagination style, error envelope, and anything the backend
returns that the UI reshapes client-side. Point to the FastAPI route file:line.

## 5. Shared dependencies
Which shared primitives this area uses (from ui_components.js, qym_table.js,
json_viewer.js, shell.js, dashboard.js, qym_safe.js, qym_live.js, etc.) and
what each is used FOR here. Flag anything this area defines that other areas
import.

## 6. Design-token usage
Which tokens/roles from docs/DESIGN_LANGUAGE.md this area relies on; any
area-specific CSS that should become a component style; any sanctioned
exception.

## 7. UX pain points observed
Honest list of what is clunky, slow, confusing, or inaccessible today
(a11y: focus order, labels, contrast, keyboard). These feed the design agent.

## 8. Migration notes
- Proposed React component tree (names only, nested bullets) and route(s).
- State that belongs in URL vs. local vs. server cache (TanStack Query keys).
- Backend changes this area will likely need (SPA fallback, missing endpoints,
  CORS for the Vite dev server, etc.).
- Risks / gotchas (huge payloads, virtualization, timing, race conditions).
- Suggested Playwright scenarios (5-10 one-liners) the UX-test agent should run.

## 9. Open questions
Decisions the component agent must make itself (and log) because the current
code is ambiguous.
