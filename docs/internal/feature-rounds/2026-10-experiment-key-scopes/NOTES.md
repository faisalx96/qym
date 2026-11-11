# Experiment key scopes: gate (2026-10-29, tip d689068b)

Backend `pytest tests/platform`, 5 chunks of 48 files (SQLite, then PostgreSQL 16 on port 55436):

| chunk | -n | SQLite | PostgreSQL |
|---|---|---|---|
| aa | 1 | 887 passed, 213 skipped | 1086 passed, 14 skipped |
| ab | 1 | 881 passed, 229 skipped | 1104 passed, 6 skipped |
| ac | 2 | 457 passed, 212 skipped | 640 passed, 29 skipped |
| ad | 2 | 650 passed, 144 skipped | 792 passed, 2 skipped |
| ae | 2 | 325 passed, 95 skipped, 6 errors | 419 passed, 1 skipped, 6 errors |

The 6 errors are `test_xss_rendering_browser.py`: the Python Playwright package wants
chromium_headless_shell-1243, the machine has 1248. Environment, not this change.

Frontend: `npm run check` 208 files / 1691 tests (+ design test 54), `npm run build` ok,
`test_design_language.py` 1 passed, Playwright `e2e/shell` 99 passed / 8 skipped,
`e2e/experiments` 250 passed.

Shots (1440 px): `shots/keys-closed-1440.png`, `shots/keys-open-1440.png`.
