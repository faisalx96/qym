# RunEventV1: SDK → Platform Streaming

`RunEventV1` is the versioned NDJSON contract used by the SDK to stream live evaluations. The canonical Pydantic models are in `packages/platform/qym_platform/events.py`; ingestion is implemented in `api/ingest.py`.

## Transport

1. Create a project-bound run with `POST /v1/runs` and a Bearer API key.
2. Send newline-delimited JSON to `POST /v1/runs/{run_id}/events` with `Content-Type: application/x-ndjson`.
3. Finalize with a `run_completed` event.

The platform does not expose a WebSocket ingestion route.

Run creation returns `run_id`, `live_url`, `supports_pass_events`, and `supports_metric_specs`. Clients that may target an older deployment should check the capability flags before sending pass-aware fields.

## Envelope

Every line is one object. Lines end at `\n` only (a trailing `\r` is ignored), so raw U+2028, U+2029 or U+0085 inside a JSON string is safe:

| Field | Rule |
|---|---|
| `schema_version` | Integer literal `1`. |
| `event_id` | UUID; idempotency key. Reuse only when retrying the same event. |
| `sequence` | Integer ≥1, increasing within the run. |
| `sent_at` | RFC 3339 client timestamp. |
| `type` | One of the 12 event types below. |
| `run_id` | UUID matching the URL; mismatches are rejected. |
| `payload` | Object validated according to `type`. |

The platform deduplicates on `(run_id, event_id)` and stores a unique `(run_id, sequence)`. An NDJSON batch is validated line by line and every line gets its own verdict: one invalid line never fails the valid lines of its batch. The response is JSON:

```json
{"ok": true, "applied": 198, "skipped": 1, "rejected": 1,
 "rejected_events": [{"line": 7, "event_id": "…", "sequence": 7,
                      "type": "item_completed", "error": "latency_ms: Field required"}]}
```

- `applied`: new events stored. `skipped`: redelivered events (known `event_id`, or a span whose `span_id` is already stored).
- `rejected`: lines that were not stored and never will be: invalid JSON or envelope, a `run_id` that does not match the URL, a payload that fails its type schema or the run's metric spec, an integer beyond the 32-bit column range, a new `event_id` that reuses a stored or in-batch `sequence`, or a value the database refuses (text longer than its column, such as an `item_id` or `label` over 200 characters, or a NUL character). `rejected_events` explains the first 100; `line` is 1-based. Database errors that can succeed on retry (a lost connection, a timeout) still return `5xx`.
- A request in which every line is rejected returns `422` with the same body plus `detail`. Batch-level problems keep their status codes (`400` bad encoding, `403`, `404`, `410` closed run, `503` maintenance).
- Rejected events must not be resent unchanged. The SDK counts them as dropped, warns once with the first reason, and does not retry them. Clients should retry only network errors, `408`, `429` and `5xx`.
- A reference to a dataset row that no longer exists (`dataset_item_pk`, `dataset_id`, `dataset_version_id`) is ignored; the rest of the event applies.

## Event types

All `pass_number` fields are 1-based and default to `1`, preserving compatibility with classic runs and older clients.

### Run lifecycle

- `run_started`: required `task`, `dataset`, `started_at`; optional `external_run_id`, `model`, `metrics`, `metric_specs`, `dataset_id`, `dataset_version_id`, `dataset_alias`, `total_items`, `run_metadata`, `run_config`.
- `pass_completed`: repeat-run barrier with required `pass_number`, total `samples`, and optional aggregate `metrics`.
- `run_completed`: required `ended_at`; optional `summary`; `final_status` is `COMPLETED`, `FAILED`, or `STOPPED`.
- `run_heartbeat`: required `heartbeat_at`.
- `metadata_update`: optional legacy Langfuse fields plus generic `extra`, which is merged into run metadata.

### Item lifecycle

- `item_started`: required `item_id`, zero-based `index`, and `input`; optional `pass_number`, `expected`, `item_metadata`, `dataset_item_pk`.
- `item_attempt_started`: required `item_id`, `attempt_number`; optional `index`, `pass_number`, trace fields, `task_started_at_ms`.
- `item_attempt_finished`: required `item_id`, `attempt_number`, and `status` (`completed` or `failed`); optional `index`, `pass_number`, latency, trace fields, `error`, and `is_last_attempt`.
- `item_completed`: required `item_id`, `output`, non-negative `latency_ms`; optional `index`, `pass_number`, `is_final_pass`, item/task metadata, trace fields, task start time, and retry count.
- `item_failed`: required `item_id`, `error`; optional `index`, `pass_number`, latency, trace fields, task start time, and retry count.

### Scores and traces

- `metric_scored`: required `item_id`, `metric_name`; optional `pass_number`, `score_numeric`, typed `score_value`, `score_raw`, `meta`, `label`, and `explanation`.
- `span_completed`: required `trace_id`, `span_id`, `name`; optional parent, kind, timings, duration, status, attributes, events, and links.

## Repeat runs

A repeat evaluation is one run whose `run_config.samples=k`. The SDK executes sequential dataset passes:

```text
run_started            run_config.samples = 3
  pass 1 item/score events (pass_number = 1)
pass_completed         pass_number = 1, samples = 3
  pass 2 item/score events (pass_number = 2)
pass_completed         pass_number = 2, samples = 3
  pass 3 item/score events (pass_number = 3, is_final_pass = true)
pass_completed         pass_number = 3, samples = 3
run_completed
```

The platform stores each pass's final attempt/output and each metric's numeric score, label, metadata, and explanation. `run_item_scores` remains a reduced mean for compatibility; lossless data lives in `run_item_attempts` and `run_item_pass_scores`. `report_k` may be stored in `run_config` to report subset estimators from a larger pass pool.

## Minimal classic-run example

```json
{"schema_version":1,"event_id":"5d8f7d2e-7a9f-4e3a-8b15-0b4f9c2b4c0e","sequence":1,"sent_at":"2026-08-03T12:00:00Z","type":"run_started","run_id":"2c2a0c9d-1c66-4e7f-9c03-2f04c9d1a0a3","payload":{"task":"qa_task","dataset":"qa.csv","metrics":["exact_match"],"run_metadata":{},"run_config":{},"started_at":"2026-08-03T12:00:00Z"}}
{"schema_version":1,"event_id":"b8c2f55a-1a62-4ef1-a91e-5f5c7b2d0b3f","sequence":2,"sent_at":"2026-08-03T12:00:01Z","type":"item_started","run_id":"2c2a0c9d-1c66-4e7f-9c03-2f04c9d1a0a3","payload":{"item_id":"row_000001","index":0,"input":"What is X?","expected":"X is ...","item_metadata":{}}}
{"schema_version":1,"event_id":"2f83f9a4-8f2c-4bde-9c2e-0c2a6e1f1e2a","sequence":3,"sent_at":"2026-08-03T12:00:02Z","type":"metric_scored","run_id":"2c2a0c9d-1c66-4e7f-9c03-2f04c9d1a0a3","payload":{"item_id":"row_000001","metric_name":"exact_match","score_numeric":1,"score_raw":true,"meta":{}}}
{"schema_version":1,"event_id":"d7c8b1d0-3f4a-4e5f-9a0b-1c2d3e4f5a6b","sequence":4,"sent_at":"2026-08-03T12:00:02Z","type":"item_completed","run_id":"2c2a0c9d-1c66-4e7f-9c03-2f04c9d1a0a3","payload":{"item_id":"row_000001","output":"X is ...","latency_ms":412}}
{"schema_version":1,"event_id":"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","sequence":5,"sent_at":"2026-08-03T12:00:03Z","type":"run_completed","run_id":"2c2a0c9d-1c66-4e7f-9c03-2f04c9d1a0a3","payload":{"ended_at":"2026-08-03T12:00:03Z","final_status":"COMPLETED","summary":{"total_items":1,"success_count":1,"error_count":0}}}
```

## Compatibility

- The platform accepts `schema_version=1`; new optional fields may be added within v1.
- Breaking payload changes require a new schema version.
- Older clients omit `pass_number` and behave as `samples=1`.
- Later valid item/score events reopen a run that was lazily marked `STOPPED` after lease timeout.
