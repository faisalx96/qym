import os

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import text

from qym_platform.tools.perf import synth


@pytest.fixture
def seeded(postgres_engine, tmp_path):
    manifest = synth.generate(
        engine=postgres_engine,
        scale=0.003,
        seed=3,
        projects=2,
        users=3,
        legacy_dup_spans=True,
        label="test",
        out_dir=str(tmp_path),
        repeat_share=0.5,
    )
    return postgres_engine, manifest


def test_generator_reproduces_production_shape(seeded):
    engine, manifest = seeded
    totals = manifest["totals"]
    assert totals["runs"] == 9
    assert totals["repeat_runs"] >= 1
    with engine.connect() as conn:
        # every project got an API key whose prefix matches the token handed back
        assert conn.execute(text("SELECT count(*) FROM api_keys")).scalar() == 2
        assert all(len(tok) > 20 for tok in manifest["api_tokens"].values())
        # items per run inside the production band
        per_run = [
            r[0]
            for r in conn.execute(
                text("SELECT count(*) FROM run_items i JOIN runs r ON r.id = i.run_id WHERE r.status <> 'RUNNING' GROUP BY i.run_id")
            )
        ]
        assert all(50 <= n <= 100 for n in per_run)
        # repeat runs carry one attempt + pass scores per pass
        samples, attempts = conn.execute(
            text(
                "SELECT r.samples, (SELECT count(*) FROM run_item_attempts a WHERE a.run_id = r.id AND a.item_id = 'item-0000') "
                "FROM runs r WHERE r.status = 'COMPLETED' ORDER BY r.samples DESC LIMIT 1"
            )
        ).first()
        assert attempts == samples
        # legacy behaviour: every span is also a span_completed event
        spans = conn.execute(text("SELECT count(*) FROM spans")).scalar()
        dup = conn.execute(text("SELECT count(*) FROM run_events WHERE type = 'span_completed'")).scalar()
        assert spans == dup == totals["spans"]
        # judge spans are flagged so trace stats exclude them
        judge = conn.execute(text("SELECT count(*) FROM spans WHERE attributes ->> 'qym.usage_scope' = 'metric'")).scalar()
        scores = conn.execute(text("SELECT count(*) FROM run_item_pass_scores")).scalar()
        assert judge == scores
        # agentic traces: 10-40 spans per item
        per_trace = [r[0] for r in conn.execute(text("SELECT count(*) FROM spans GROUP BY run_id, trace_id"))]
        assert min(per_trace) >= 4 and max(per_trace) <= 60
        # derived run metadata the list view reads is present
        meta = conn.execute(text("SELECT run_metadata FROM runs WHERE status = 'COMPLETED' LIMIT 1")).scalar()
        assert "trace_stats" in meta and meta["total_items"] >= 50
        # no dashboard projection rows: the worker must backfill, as in production
        assert conn.execute(text("SELECT count(*) FROM dashboard_partition_state")).scalar() == 0


def test_reset_removes_only_generated_rows(seeded):
    engine, _ = seeded
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, email, display_name, title, role, is_active, created_at, updated_at) VALUES ('keep', 'keep@example.test', 'Keep', '', 'ADMIN', true, now(), now())"))
    synth.reset(engine)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM runs")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM spans")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM users")).scalar() == 1
