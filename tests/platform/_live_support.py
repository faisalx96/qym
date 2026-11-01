"""Deterministic live evaluation rows shared by the read API tests."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy.orm import Session

from qym_platform.db.models import (
    LiveCanaryResult,
    LiveDay,
    LiveMetricSpec,
    LiveSource,
    LiveTurn,
    LiveTurnScore,
)


def seed_week(db: Session, project_id: str) -> LiveSource:
    """Seed 40 turns; Nov 1 mix is ok:2/suboptimal:1/problem_a:1/problem_b:1/inconclusive:1, means success=.5 (n=5), compliance=2/3, sql=3/4, viz=5/6, charts=.7 (n=4), diagnosis=None (n=0)."""
    source = LiveSource(
        project_id=project_id,
        key="worker-1",
        name="Production worker",
        environment="production",
        product="Assistant",
        worker={
            "poll_interval_s": 60,
            "judges": {"a": "judge-a", "b": "judge-b"},
            "eval_code_version": "abc123",
        },
        last_turn_at=datetime(2026, 11, 1, 10, 5),
    )
    db.add(source)
    db.flush()
    specs = [
        ("agent_success", "quality", "Agent success", 0.5),
        ("diagnosis", "diagnosis", "Diagnosis", None),
        ("compliance_a", "quality", "Compliance A", None),
        ("service.sql_generation", "service", "SQL generation", 1.0),
        ("service.viz_agent", "service", "Visualization", 1.0),
        ("chart_fidelity", "charts", "Chart fidelity", None),
    ]
    diagnosis_values = [
        {"value": value, "label": label, "tone": tone}
        for value, label, tone in (
            ("ok", "OK", "accent"),
            ("suboptimal", "Suboptimal", "warning"),
            ("problem_a", "Problem A", "danger"),
            ("problem_b", "Problem B", "warning"),
            ("problem_c", "Problem C", "meta"),
            ("inconclusive", "Inconclusive", "neutral"),
        )
    ]
    for position, (name, group, label, threshold) in enumerate(specs):
        categorical = name == "diagnosis"
        db.add(
            LiveMetricSpec(
                source_id=source.id,
                metric_name=name,
                group_name=group,
                label=label,
                position=position,
                score_type="categorical" if categorical else "percentage",
                direction=None if categorical else "maximize",
                pass_threshold=threshold,
                is_primary=name == "agent_success",
                values=diagnosis_values if categorical else None,
            )
        )
    labels = ("ok", "ok", "suboptimal", "problem_a", "problem_b", "inconclusive")
    latencies = (1000, 2000, 3000, 4000, 300000, 360000)
    numeric_scores = {
        "agent_success": (1, 1, 0.5, 0, 0, 1),
        "compliance_a": (1, 1, 1, 1, 0, 0),
        "service.sql_generation": (1, 1, 1, 0.5, 0, 1),
        "service.viz_agent": (1, 1, 1, 1, 1, 0),
        "chart_fidelity": (0.8, 0.6, 0, 1, 0.4, 1),
    }
    for offset, count in enumerate((5, 5, 6, 6, 6, 6, 6)):
        day = date(2026, 10, 26) + timedelta(days=offset)
        first_poll = datetime.combine(day, time(0))
        db.add(
            LiveDay(
                source_id=source.id,
                day=day,
                run_ref=f"daily-{day}",
                status="running" if offset == 6 else "closed",
                turns_seen=count + (2 if offset == 6 else 0),
                evaluated=count - 1,
                failed=1,
                first_poll_at=first_poll,
                last_poll_at=first_poll + timedelta(hours=12),
                closed_at=None if offset == 6 else first_poll + timedelta(hours=23),
                polls=720,
                max_poll_gap_s=7200 if offset == 4 else 60,
                parameters={"eval_code_version": "abc123"},
            )
        )
        for index in range(count):
            midnight = offset == 5 and index == 5
            turn_at = datetime.combine(day, time(10, index))
            if midnight:
                turn_at = datetime(2026, 10, 30, 23, 59)
            label = "problem_c" if offset < 6 and index == 4 else labels[index]
            turn = LiveTurn(
                source_id=source.id,
                day=day,
                turn_id="midnight-turn" if midnight else f"turn-{day}-{index}",
                conversation_id=f"conversation-{day}",
                turn_index=index,
                turn_at=turn_at,
                evaluated_at=datetime.combine(day, time(11, index)),
                received_at=datetime.combine(day, time(11, index, 1)),
                user_ref=f"user-{index % 2}",
                mode="standard",
                status="completed" if index < 3 else "failed",
                outcome="ok" if index < 3 else "agent_failed",
                label=label,
                question=(
                    "Question 1: ما المبيعات؟"
                    if offset == 6 and index == 0
                    else f"Question {index + 1}"
                ),
                answer=f"Answer {index + 1}",
                latency_ms=latencies[index],
            )
            db.add(turn)
            db.flush()
            db.add(
                LiveTurnScore(turn_pk=turn.id, metric_name="diagnosis", score_raw=label)
            )
            for name, values in numeric_scores.items():
                skipped = (name == "agent_success" and index == 5 and not midnight) or (
                    name == "chart_fidelity" and (offset == 3 or index in (2, 5))
                )
                failed_service = name.startswith("service.") and values[index] < 1
                db.add(
                    LiveTurnScore(
                        turn_pk=turn.id,
                        metric_name=name,
                        score_numeric=values[index],
                        skipped=skipped,
                        skip_reason="Not applicable" if skipped else None,
                        meta={"fault": "infra"} if failed_service else {},
                    )
                )
    for canary in ("query", "render"):
        for hour in (9, 11):
            failed = canary == "render" and hour == 11
            db.add(
                LiveCanaryResult(
                    source_id=source.id,
                    canary=canary,
                    checked_at=datetime(2026, 11, 1, hour),
                    status="failed" if failed else "ok",
                    fault="infra" if failed else None,
                    latency_ms=200 if failed else 100,
                    eval_code_version="abc123",
                )
            )
    db.flush()
    return source
