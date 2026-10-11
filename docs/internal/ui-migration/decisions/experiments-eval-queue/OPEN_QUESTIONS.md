# experiments-eval-queue: decisions made alone

Dated one-liners; newest last. Brief §9 questions are answered here.

- 2026-10-11 (Q2) `best_score` column dropped from the experiments list: the API never sent it and the matrix already shows each job's headline metric.
- 2026-10-11 (Q4) Retry `temporary_key_required` handled with an inline key re-entry dialog (one password field per listed slot) that resends the retry with `temporary_keys`; "Clone instead" is offered as the secondary action. The vanilla page only toasted the message.
- 2026-10-11 (Q6) Queue experiment filter is built from the union of experiments seen in `/eval-queue` responses plus the experiment named in the URL (no new endpoint); the URL value stays selectable even when it has no live job.
- 2026-10-11 (Q8) Column-width persistence dropped; the shared `DataTable` has none.
- 2026-10-11 (Q9) "Promote to default preset" navigates to the environment's editor route (`/environments/:envId/default-preset/edit?promote=...`) rather than the settings page; the settings Environments tab mounts the same editor.
- 2026-10-11 (Q10) Polling cadence: the code's 5 s x1.5 backoff to 60 s is kept for live data (not the 10/30/60 in the docs), queue always polls, list/detail poll only while non-terminal, all paused when the tab is hidden. No SSE.
- 2026-10-11 (Q7) Models page gets its own Task and Dataset selects (plus time range and origin) instead of depending on the runs command bar, which another area owns.
- 2026-10-11 Dev harness: `frontend/scripts/fake_eval_service.py` and `seed_experiments.py` added for e2e and dev; the e2e platform runs with `QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true` so loopback services are allowed.
