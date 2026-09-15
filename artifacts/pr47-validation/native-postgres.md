# Native PostgreSQL validation runtime

Status: stopped after the completed validation matrix. Temporary binaries and data remain available for reproduction with the commands below.

PostgreSQL 16.15 on aarch64-apple-darwin24.3.0, compiled by Apple clang version 17.0.0 (clang-1700.0.13.5), 64-bit

- Runtime and fresh data: `/tmp/qym-pr47-pg16-lz4-i29ujy12`.
- Built from [official PostgreSQL source](https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.gz), verified against its [SHA256](https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.gz.sha256): `4f200ca23dfb120ff9838f13ce06014aad1d3c432d16ee9f93ab2000c0eeef7b`.
- Build configuration: `'--prefix=/tmp/qym-pr47-pg16-lz4-i29ujy12/install' '--without-readline' '--without-icu' '--with-lz4' '--with-includes=/opt/homebrew/opt/lz4/include' '--with-libraries=/opt/homebrew/opt/lz4/lib'`.
- Uses existing Homebrew LZ4 1.10.0 read-only; no global install or service registration.
- Actual table storage verified: `pg_column_compression(payload) = lz4` for a 140,000-character value.
- Binds only `127.0.0.1:15449`; fresh databases `qym_native`, `qym_matrix39`, `qym_matrix311` all accept connections.
- Connection template: `postgresql+psycopg2://qym_review:qym_review@127.0.0.1:15449/{database}`. Credentials belong only to this disposable cluster.
- OrbStack and existing installations are untouched. The earlier disposable wheel cluster was stopped and retained; it lacked required LZ4.
- PostgreSQL 16.2 source hit an upstream macOS SDK build issue fixed in 16.9; PostgreSQL 16.15 source compiled without modifications.

## Start existing cluster

```sh
/tmp/qym-pr47-pg16-lz4-i29ujy12/install/bin/pg_ctl start -D /tmp/qym-pr47-pg16-lz4-i29ujy12/data -l /tmp/qym-pr47-pg16-lz4-i29ujy12/postgres.log -w -t 30 -o '-h 127.0.0.1 -p 15449 -k /tmp/qym-pr47-pg16-lz4-i29ujy12/socket -c shared_buffers=64MB -c max_connections=40 -c jit=off'
```

## Stop disposable cluster

```sh
/tmp/qym-pr47-pg16-lz4-i29ujy12/install/bin/pg_ctl stop -D /tmp/qym-pr47-pg16-lz4-i29ujy12/data -m fast -w -t 30
```

Build logs and provenance: `native-postgres-lz4-build.json`. Runtime/connectivity evidence: `native-postgres-runtime.json`. Earlier wheel provenance: `native-postgres-wheel-runtime.json`.
