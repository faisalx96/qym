# Admin force stop

The Admin Runs tab offers **Force stop** for running, pending and stopped runs
that have not already been force stopped. This includes a run automatically
stopped by heartbeat expiry: an administrator can seal it against reconnection.
Completed, failed and reviewed runs cannot be force stopped.

`POST /api/runs/{run_id}/force-stop` requires an authenticated platform admin.
It sets `status=STOPPED`, `status_reason=admin_force_stopped` and `ended_at`,
preserves the last runner event timestamp and stored results, and records one
`run.force_stopped` audit entry. Repeated requests succeed without changing the
timestamp or adding audit entries. The endpoint also accepts deleted run IDs
for administrative cleanup. Deleting and restoring a run does not remove its
force-stop marker. No database migration is needed.

The endpoint and SDK event ingestion lock the same run row. A batch that acquired
the lock first can commit before the stop. Once Force stop commits, ingestion
rejects every subsequent batch with HTTP 410 and `X-Qym-Run-State: force_stopped`,
before parsing events or modifying items, scores, spans, metadata or event history.
Duplicates are rejected too. A completion committed first wins; the stop returns
409 instead of overwriting completed results. Stale-run recovery and other stop
paths refresh under row locks so they cannot overwrite an admin stop.

Stopped runs leave the live-run query and appear as STOPPED in recent runs.
The admin page discards older in-flight responses. Its list refresh continues
to discover other live runs. The legacy live detail page ends polling on a
terminal status, including when some items never finished; it also ends polling
on auth loss, deletion and navigation. Detail polls do not overlap.

The updated SDK treats HTTP 410 as a permanent rejection of that run. It stops
heartbeats, batch uploads, per-event fallback and direct finalization uploads,
discards the rejected backlog, releases blocked producers and reports the closure
once. Flush reports failure because rejected events were not delivered. Local
evaluation and checkpoints can continue; this operation cannot terminate a
Python process in Coder.

Deploy the platform change to enforce the stop for every SDK version. Upgrade
users' SDKs to stop their uploaders after the rejection. Older SDKs may continue
issuing requests, but the platform will reject their updates.

Validation covers admin authorization, idempotency, restoration, late events,
stale readers, PostgreSQL transaction ordering, SDK disk backpressure, all
delivery paths, and browser cancellation, failure, delayed replies and polling.
