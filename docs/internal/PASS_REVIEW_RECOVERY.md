# Pass review recovery

Migration `0051` adds a nullable pass number to review corrections. A null value
keeps the existing aggregate or classic-run scope. Repeat-pass approvals now
create one review record per issue, with that pass's output and scores.

The migration recovers approvals already saved in pass metadata. It preserves
review timestamps, reviewers, and pending siblings, and leaves other passes
unchanged. It also adds approved labels and details missing from project catalogs.
Recovery is idempotent. Catalog changes create new versions; historical versions
and explicitly archived category labels are preserved.

Deploy this change with migration `0051` and the updated application together.
The normal platform migration step runs it. Users do not need to approve those
issues again. No production migration has been run during development.

Validation includes isolated SQLite regression tests, an actual PostgreSQL
upgrade from `0050`, and concurrent approvals publishing different categories.
