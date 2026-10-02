# Durable dashboard projections

The browser dashboard reads numerical projections through `/api/dashboard/*`.
The legacy `/api/runs` endpoint remains immediately source-backed for API and CLI
compatibility. Inputs, outputs, trace bodies, score explanations, and analysis
text are not copied into the projection read path.

Migration `0048` creates the durable outbox, numerical record state, run
summaries, hour/day rollups, fixed histogram definitions, partition checkpoints,
and dead-letter tables. It seeds existing run identifiers for asynchronous
backfill. The migration schema is frozen and does not import current ORM models.
PostgreSQL source versions use `BIGINT`; SQLite uses its non-reusing integer
sequence. Event UUIDs independently identify records returned from batched
inserts.

The application starts one `DashboardSummaryWorker` per process and stops it on
shutdown. Each worker owns its sessions. A tick processes at most 20 partitions,
500 events per partition, then bounded dirty-bucket repair and retention. The
poll interval defaults to one second. These constructor limits may be adjusted
when embedding the worker. Database row locks coordinate multiple workers;
shared buckets are locked in the same order, including timestamp corrections.
Backfill locks source rows before its partition, matching the write path.

Each source mutation and its numeric snapshot commit together. Record versions
reject duplicate and older delivery; deletes retain tombstones. Counters and
histograms apply old-to-new deltas in batches. Exact medians and extrema use
numeric state, without reopening source item or trace bodies. Owner names,
approvals, metric specs, and dataset-alias changes enqueue dimension refreshes.
Expired live runs are reconciled in bounded background work using the existing
run-lifecycle rules.

A response includes freshness and publication revision. A source sequence alone
cannot identify a published snapshot because transactions can commit out of
sequence. Run publication counters therefore advance separately, and filtered
view revisions derive from the relevant run counters. A terminal run's previous
published descriptor and numerical values remain visible until its pending
outbox and all backfill source kinds have completed. New terminal historical
runs are published only when their complete numerical snapshot is ready.

The catalog revision hashes every run's publication counter, presence, list
status and hidden flag; on PostgreSQL the hash is computed in the database, and a request reads it once for its page,
overview and KPIs. Each API process reuses page, overview, catalog and KPI
snapshots keyed by that revision (and by filters, sort and hidden-task policy);
an idle entry expires after five minutes and any published change misses it.
Deleting, restoring, submitting, approving, rejecting and withdrawing a review
decision update the run's dimension in the same transaction (and bump the
publication counter of an already published summary; a pending summary stays
at revision 0 so the run keeps showing as pending), so the next list request
shows the change without waiting for the worker, which later republishes the
same values.

On PostgreSQL the Runs, Charts and Models overview is aggregated in the
database, in one statement, with the same numbers as the Python build (sums
add in the same order). It reads each run's overview inputs from
`dashboard_run_overview`, typed values the summary worker stores when it
publishes the run (the `backfill_dashboard_overview` job, queued by migration
`0069`, stores them for older runs). A stored row counts only while its revision
equals the summary's publication counter; any other run is read from its JSON,
so a missing or stale row is slower, never wrong. The computed overview is
stored in `dashboard_overview_snapshots`, so every process and pod reuses it.
The project-wide part is one entry per project, catalog revision, day and
hidden-task policy. Each filter, search and sort adds an entry that holds only
its filtered part, keyed by those and by the filters, sort and collation; a
read joins it with the project-wide part. Every key also carries the stored
payload's shape number (`SHARED_SHAPE`), so a release that changes the payload
never reads an older release's entries. A time range that no later request
repeats (Last 7 and Last 30 days: now minus N days, to the millisecond) gets
no entry of its own: it reuses the project-wide part and builds its filtered
part each time. A request reads the store on its own snapshot connection and
writes after releasing it. Entries of a replaced revision go two minutes after
it changes, any entry after a day, and a project keeps at most 200 filter
entries (its project-wide parts are not counted); purging a run or deleting a
project removes the project's entries. SQLite builds the overview in Python,
as before.

Filters accept `q`, a case-insensitive search (at most 200 characters) over the
run's displayed name (`external_run_id`), its run name, and the start of its
run ID. On PostgreSQL the trigram index `ix_dashboard_run_dimensions_search_trgm`
serves it; the `build_runs_search_index` job (migration `0070`) builds it
CONCURRENTLY. Without `pg_trgm` the job logs that the index was skipped and
finishes, and the search scans the project's runs. A page orders narrow keys first and then reads only the page's rows; the
nearest distinct means shown beside each metric value come from one query over
the page's (task, model, dataset) groups.

While an authorized project's historical backfill is unfinished, freshness also
reports `backfilling: true`. This includes the gap between the final source scan
and first summary publication. Ordinary updates and newly created runs do not
enable this flag. Other projects' backfills do not affect it.

During that period, Runs, Charts and Models use the existing `/api/runs` path.
The browser fetches the complete project history in 100-run pages with at most
three requests in flight, then applies it together. Counts, filters, sorting,
charts and selections therefore include historical runs whose projections are
not published yet. Failed pages leave the previous complete display intact;
offset shifts causing duplicate or missing runs trigger one complete retry.
Session expiry removes the data and stops polling. This temporary path retains
the pre-P1 full-history memory and query cost, polls every 15 seconds, and skips
session-storage serialization. Once backfill finishes, the next refresh returns
to bounded projection paging with the user's filters, page and selections.

The initial late-event horizon is 30 days (`MAX_LATE_EVENT_AGE`). Older events
and invalid schemas enter `dashboard_dead_letters`; persistent processing
failures do so after five attempts. The partition remains `repair_required`, so
freshness never claims it is current. Dead letters retain source identity,
version, and failure details. Normal maintenance prunes only old tombstones and
published outbox records behind settled, unleased partition watermarks. It does
not prune unresolved repair evidence.

After inspecting a failed partition, an operator can request a source rebuild:

```python
from qym_platform.db.session import SessionLocal
from qym_platform.services.dashboard_summaries import request_dashboard_repair

with SessionLocal() as db:
    request_dashboard_repair(db, run_id)
    db.commit()
```

This explicit repair retires snapshots through its durable source-version
boundary, preserves tombstone versions, and resumes bounded source backfill.
Pending old updates cannot resurrect a source-deleted record. The dead-letter
rows remain as evidence. Live writes continue through the transactional outbox.

Validation evidence is in `artifacts/p1-validation/dashboard-durability-final.xml`,
and `artifacts/p1-validation/dashboard-worker-benchmark.json`. The core
suite covers SQLite and PostgreSQL, differential numerical parity with the
legacy endpoint, source rollback, retries, out-of-order commits, root causes,
repeat deletion, alias changes, leases, retention, liveness, migration,
backfill with live updates, concurrent shared buckets, and terminal publication.
