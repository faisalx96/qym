"""Deterministic performance rows shared by the runner route and page route tests.

Every ``seed_*`` function adds rows and flushes; the caller commits. Tokens are
stored encrypted, so call ``use_encryption_key(monkeypatch)`` before seeding a
target with tokens.
"""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from typing import Any, Optional

from cryptography.fernet import Fernet
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from qym_platform.db.models import (
    PERFORMANCE_ACTIVE_RUN_STATUSES,
    PERFORMANCE_FINAL_RUN_STATUSES,
    ApiKey,
    Dataset,
    DatasetItem,
    DatasetVersion,
    DatasetVersionStatus,
    PerformanceRun,
    PerformanceRunner,
    PerformanceTarget,
    PerformanceTargetToken,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.secrets import decrypt_llm_api_key, encrypt_llm_api_key
from qym_platform.security import api_key_prefix, hash_api_key

NOW = datetime(2026, 11, 20, 11, 0)
RUNNER_KEY = "runner-1"
RUNNER_TOKEN = "performance-runner-token"
OTHER_TOKEN = "qa-other-project-key"
INSTANCE = "instance-1"
INSTANCE_HEADER = "X-Qym-Runner-Instance"
# name -> value; the hints are the last 4 characters ("41bd", "0c2e").
TOKENS = {
    "refresh_token": "example-refresh-token-41bd",
    "access_token": "example-access-token-0c2e",
}
TIERS = ("simple", "medium", "complex")


def use_encryption_key(monkeypatch) -> str:
    """Give this test an encryption key, as a deployment sets it; returns the key."""
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", key)
    return key


def runner_path(project_id: str, key: str = RUNNER_KEY) -> str:
    """Path of the runner routes of one runner key (main app, no prefix)."""
    return f"/v1/projects/{project_id}/performance/runners/{key}"


def runner_headers(
    token: str = RUNNER_TOKEN, instance: str = INSTANCE
) -> dict[str, str]:
    """The two headers every runner route needs."""
    return {"Authorization": f"Bearer {token}", INSTANCE_HEADER: instance}


def seed_user(
    db: Session,
    project: Optional[Project] = None,
    *,
    suffix: str = "1",
    role: Optional[ProjectRole] = ProjectRole.MEMBER,
    user_role: UserRole = UserRole.MEMBER,
) -> User:
    """A user; with ``project`` and ``role`` also a member of that project."""
    user = User(
        id=f"performance-user-{suffix}",
        email=f"performance-user-{suffix}@example.test",
        display_name=f"QA - Person {suffix}",
        role=user_role,
    )
    db.add(user)
    db.flush()
    if project is not None and role is not None:
        db.add(ProjectMembership(project_id=project.id, user_id=user.id, role=role))
        db.flush()
    return user


def seed_project(db: Session, suffix: str = "1") -> tuple[User, Project]:
    """A project and the Manager who created it."""
    owner = seed_user(db, suffix=f"owner-{suffix}")
    project = Project(
        id=f"performance-project-{suffix}",
        name=f"QA - Performance project {suffix}",
        slug=f"performance-project-{suffix}",
        created_by_user_id=owner.id,
    )
    db.add(project)
    db.flush()
    db.add(
        ProjectMembership(
            project_id=project.id, user_id=owner.id, role=ProjectRole.MANAGER
        )
    )
    db.flush()
    return owner, project


def seed_api_key(
    db: Session,
    project: Project,
    user: User,
    *,
    token: str = RUNNER_TOKEN,
    key_id: Optional[str] = None,
    name: str = "QA - Runner key",
) -> ApiKey:
    """A project API key whose bearer value is ``token``."""
    key = ApiKey(
        id=key_id or f"performance-key-{api_key_prefix(token)}",
        user_id=user.id,
        project_id=project.id,
        name=name,
        prefix=api_key_prefix(token),
        key_hash=hash_api_key(token),
        scopes=[],
    )
    db.add(key)
    db.flush()
    return key


def seed_runner(
    db: Session,
    project: Project,
    *,
    api_key: Optional[ApiKey] = None,
    user: Optional[User] = None,
    key: str = RUNNER_KEY,
    instance_id: Optional[str] = INSTANCE,
    now: datetime = NOW,
    **changes: Any,
) -> PerformanceRunner:
    """A registered, idle runner heard from at ``now``.

    With ``api_key`` that key is the chosen runner key (chosen by ``user``) and
    the key the runner registered with.
    """
    values: dict[str, Any] = {
        "project_id": project.id,
        "key": key,
        "name": "QA - Runner",
        "info": {"runner_version": "0.1.0", "host": "qa-runner-host"},
        "instance_id": instance_id,
        "registered_at": now if instance_id else None,
        "registered_key_id": api_key.id if api_key and instance_id else None,
        "reported_state": "idle" if instance_id else None,
        "last_heartbeat_at": now if instance_id else None,
        "runner_key_id": api_key.id if api_key else None,
        "runner_key_changed_at": now if api_key else None,
        "runner_key_changed_by_user_id": user.id if api_key and user else None,
        "created_at": now,
        "updated_at": now,
    }
    values.update(changes)
    runner = PerformanceRunner(**values)
    db.add(runner)
    db.flush()
    return runner


def seed_target(
    db: Session,
    project: Project,
    *,
    user: Optional[User] = None,
    name: str = "QA - Preprod",
    base_url: str = "https://target.example.test",
    tokens: Optional[dict[str, str]] = None,
    now: datetime = NOW,
    **changes: Any,
) -> PerformanceTarget:
    """A target with its tokens encrypted (default: both of ``TOKENS``; ``{}`` for none)."""
    values: dict[str, Any] = {
        "project_id": project.id,
        "name": name,
        "base_url": base_url,
        "created_by_user_id": user.id if user else None,
        "created_at": now,
        "updated_at": now,
    }
    values.update(changes)
    target = PerformanceTarget(**values)
    db.add(target)
    db.flush()
    for token_name, value in (TOKENS if tokens is None else tokens).items():
        seed_token(db, target, token_name, value, user=user, now=now)
    return target


def seed_token(
    db: Session,
    target: PerformanceTarget,
    name: str,
    value: str,
    *,
    user: Optional[User] = None,
    version: int = 1,
    expires_at: Optional[datetime] = None,
    now: datetime = NOW,
) -> PerformanceTargetToken:
    """One saved token: the value encrypted, its last 4 characters as the hint."""
    token = PerformanceTargetToken(
        target_id=target.id,
        name=name,
        token_encrypted=encrypt_llm_api_key(value),
        token_hint=value[-4:],
        version=version,
        expires_at=expires_at,
        updated_by_user_id=user.id if user else None,
        created_at=now,
        updated_at=now,
    )
    db.add(token)
    db.flush()
    return token


def token_value(token: PerformanceTargetToken) -> str:
    """The stored token, decrypted (for assertions only)."""
    return decrypt_llm_api_key(token.token_encrypted)


def target_tokens(
    db: Session, target: PerformanceTarget
) -> dict[str, PerformanceTargetToken]:
    """The target's token rows by name, read from the database."""
    rows = db.scalars(
        select(PerformanceTargetToken).where(
            PerformanceTargetToken.target_id == target.id
        )
    )
    return {row.name: row for row in rows}


def seed_dataset(
    db: Session,
    project: Project,
    user: User,
    *,
    name: str = "QA - Load questions",
    version: str = "v1",
    status: DatasetVersionStatus = DatasetVersionStatus.PUBLISHED,
    tiers: tuple[Optional[str], ...] = TIERS,
    per_tier: int = 2,
    now: datetime = NOW,
) -> DatasetVersion:
    """A dataset version with ``per_tier`` questions per entry of ``tiers``.

    An entry of ``None`` makes items without a ``metadata.tier``. The first item
    of each tier has a follow-up question. Item ids are ``<tier>-<n>``.
    """
    slug = "-".join(name.lower().replace("-", " ").split())
    dataset = Dataset(
        project_id=project.id,
        name=name,
        slug=slug,
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(dataset)
    db.flush()
    row = DatasetVersion(
        dataset_id=dataset.id,
        version=version,
        status=status,
        item_count=len(tiers) * per_tier,
        content_hash=f"{slug}-{version}".ljust(64, "0")[:64],
        created_by_user_id=user.id,
        published_by_user_id=(
            user.id if status is DatasetVersionStatus.PUBLISHED else None
        ),
        published_at=now if status is DatasetVersionStatus.PUBLISHED else None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    index = 0
    for tier in tiers:
        for number in range(1, per_tier + 1):
            index += 1
            item_id = f"{tier or 'plain'}-{number}"
            metadata: dict[str, Any] = {"must_not_contain": ["no data"]}
            if tier is not None:
                metadata["tier"] = tier
            if number == 1:
                metadata["follow_up"] = f"Follow-up to {item_id}?"
            db.add(
                DatasetItem(
                    dataset_version_id=row.id,
                    item_id=item_id,
                    index=index,
                    input=f"Question {item_id}?",
                    expected_output=None,
                    item_metadata=metadata,
                    labels=[],
                    fingerprint=f"fp-{slug}-{version}-{item_id}",
                    created_at=now,
                    updated_at=now,
                )
            )
    db.flush()
    return row


def run_config(
    db: Session,
    target: PerformanceTarget,
    version: Optional[DatasetVersion] = None,
    *,
    test_type: str = "breakpoint",
    note: str = "",
) -> dict[str, Any]:
    """The frozen settings of a run, in the shape the runner guide gives (section 4.2).

    A small Breakpoint plan (levels 10 and 20, 60 s holds) or, for Smoke and Soak,
    one steady stage; token names with hints and versions as saved now.
    """
    tokens = [
        {"name": name, "hint": row.token_hint, "version": row.version}
        for name, row in sorted(target_tokens(db, target).items())
    ]
    if test_type == "breakpoint":
        plan: dict[str, Any] = {
            "baseline_users": 5,
            "max_users": 20,
            "step_users": 10,
            "hold_seconds": 60,
            "limit_ms": 180000,
            "max_error_rate_pct": 10,
            "follow_up_rate": 0.3,
            "abort_on_break": True,
            "timeout_seconds": 540,
            "users": None,
            "duration_seconds": None,
            "min_quality": None,
            "max_no_data_pct": None,
            "levels": [10, 20],
            "total_seconds": 300,
            "warmup_seconds": 30,
            "stages": [
                {"role": "baseline", "target_users": 5, "start_s": 0, "end_s": 60},
                {"role": "ramp", "target_users": 10, "start_s": 60, "end_s": 90},
                {"role": "hold", "target_users": 10, "start_s": 90, "end_s": 150},
                {"role": "ramp", "target_users": 20, "start_s": 150, "end_s": 180},
                {"role": "hold", "target_users": 20, "start_s": 180, "end_s": 240},
                {"role": "cooldown", "target_users": 5, "start_s": 240, "end_s": 270},
                {"role": "cooldown", "target_users": 0, "start_s": 270, "end_s": 300},
            ],
        }
    else:
        seconds = 180 if test_type == "smoke" else 7200
        plan = {
            "baseline_users": None,
            "max_users": None,
            "step_users": None,
            "hold_seconds": None,
            "limit_ms": 180000,
            "max_error_rate_pct": 10,
            "follow_up_rate": None,
            "abort_on_break": None,
            "timeout_seconds": 540,
            "users": 1 if test_type == "smoke" else 10,
            "duration_seconds": seconds,
            "min_quality": 70,
            "max_no_data_pct": 20,
            "levels": [1 if test_type == "smoke" else 10],
            "total_seconds": seconds,
            "warmup_seconds": 0,
            "stages": [
                {
                    "role": "steady",
                    "target_users": 1 if test_type == "smoke" else 10,
                    "start_s": 0,
                    "end_s": seconds,
                }
            ],
        }
    dataset: dict[str, Any] = {
        "id": "performance-dataset",
        "name": "QA - Load questions",
        "version_id": "performance-dataset-version",
        "version": "v1",
        "item_count": 6,
        "content_hash": "0" * 64,
        "tier_counts": {"simple": 2, "medium": 2, "complex": 2},
        "single_kind": False,
    }
    if version is not None:
        parent = db.get(Dataset, version.dataset_id)
        items = db.scalars(
            select(DatasetItem).where(DatasetItem.dataset_version_id == version.id)
        ).all()
        counts = {tier: 0 for tier in TIERS}
        for item in items:
            tier = (item.item_metadata or {}).get("tier")
            if tier in counts:
                counts[tier] += 1
        single_kind = bool(items) and not any(counts.values())
        if single_kind:
            counts["medium"] = len(items)
        dataset = {
            "id": parent.id,
            "name": parent.name,
            "version_id": version.id,
            "version": version.version,
            "item_count": len(items),
            "content_hash": version.content_hash,
            "tier_counts": counts,
            "single_kind": single_kind,
        }
    settings = target.settings or {}
    return {
        "schema": 1,
        "test_type": test_type,
        "target": {
            "id": target.id,
            "name": target.name,
            "is_production": target.is_production,
            "base_url": target.base_url,
            "chat_path": target.chat_path,
            "auth_server": settings.get("auth_server"),
            "token_refresh_path": target.auth_path,
            "refresh_cookie_name": settings.get("refresh_cookie_name"),
        },
        "tokens": tokens,
        "plan": plan,
        "mix": (
            {"simple": 0, "medium": 100, "complex": 0}
            if dataset["single_kind"]
            else {"simple": 50, "medium": 35, "complex": 15}
        ),
        "dataset": dataset,
        "options": {"store_answers": True, "question_sent_lines": True},
        "note": note,
    }


def seed_run(
    db: Session,
    project: Project,
    runner: PerformanceRunner,
    target: PerformanceTarget,
    *,
    version: Optional[DatasetVersion] = None,
    user: Optional[User] = None,
    status: str = "queued",
    test_type: str = "breakpoint",
    now: datetime = NOW,
    **changes: Any,
) -> PerformanceRun:
    """A run in ``status`` with the times that status implies, all equal to ``now``.

    Every status but ``queued`` and ``expired`` carries the claim by the runner's
    instance and a sign of life; from ``running`` on also a start time and one
    progress report; ``stopping`` a stop request; a final status a finish time.
    ``changes`` overrides any column: a run stopped before its claim is
    ``status="stopped", claimed_at=None, claim_instance_id=None,
    last_seen_at=None, started_at=None, last_report_at=None, progress_seq=0``.
    """
    assert status in PERFORMANCE_ACTIVE_RUN_STATUSES + PERFORMANCE_FINAL_RUN_STATUSES
    config = run_config(db, target, version, test_type=test_type)
    number = db.scalar(
        select(func.coalesce(func.max(PerformanceRun.number), 0)).where(
            PerformanceRun.project_id == project.id
        )
    )
    values: dict[str, Any] = {
        "project_id": project.id,
        "number": int(number or 0) + 1,
        "runner_id": runner.id,
        "target_id": target.id,
        "dataset_id": config["dataset"]["id"],
        "dataset_version_id": version.id if version is not None else None,
        "test_type": test_type,
        "status": status,
        "config": config,
        "requested_by_user_id": user.id if user else None,
        "requested_at": now,
        "updated_at": now,
    }
    claimed = status not in ("queued", "expired")
    if claimed:
        values.update(
            claimed_at=now, claim_instance_id=runner.instance_id, last_seen_at=now
        )
    if status in (
        "running",
        "stopping",
        "finished",
        "stopped",
        "failed",
        "interrupted",
    ):
        values.update(started_at=now, last_report_at=now, progress_seq=1)
    if status == "stopping":
        values.update(
            stop_requested_at=now, stop_requested_by_user_id=user.id if user else None
        )
    if status in PERFORMANCE_FINAL_RUN_STATUSES:
        values.update(finished_at=now)
    values.update(changes)
    run = PerformanceRun(**values)
    db.add(run)
    db.flush()
    return run


def seed_performance(
    db: Session,
    *,
    suffix: str = "1",
    runner_token: str = RUNNER_TOKEN,
    other_token: str = OTHER_TOKEN,
    tokens: Optional[dict[str, str]] = None,
    now: datetime = NOW,
) -> SimpleNamespace:
    """Everything a run needs, ready to start one: no run exists yet.

    Returns ``owner`` (Manager), ``member`` (Member), ``project``, ``api_key``
    (bearer ``runner_token``, the chosen runner key), ``other_key`` (bearer
    ``other_token``, same project, not chosen), ``runner`` (registered, fresh at
    ``now``), ``target`` (with ``tokens``, default both of ``TOKENS``) and
    ``version`` (a published dataset version with two questions per kind).
    A second project in one database needs its own ``suffix`` and bearer values.
    """
    owner, project = seed_project(db, suffix)
    member = seed_user(db, project, suffix=f"member-{suffix}")
    api_key = seed_api_key(
        db, project, owner, token=runner_token, key_id=f"performance-key-{suffix}"
    )
    other_key = seed_api_key(
        db,
        project,
        owner,
        token=other_token,
        key_id=f"performance-other-key-{suffix}",
        name="QA - Other key",
    )
    runner = seed_runner(db, project, api_key=api_key, user=owner, now=now)
    target = seed_target(db, project, user=owner, tokens=tokens, now=now)
    version = seed_dataset(db, project, owner, now=now)
    return SimpleNamespace(
        owner=owner,
        member=member,
        project=project,
        api_key=api_key,
        other_key=other_key,
        runner=runner,
        target=target,
        version=version,
    )


# ---------------------------------------------------------------------------
# Added for the runner route tests: the clock, request bodies, and what a page
# does to a run (stop, a new token), written straight to the rows.
# ---------------------------------------------------------------------------


def at_time(monkeypatch, when: datetime) -> datetime:
    """Set qym's receive time for the runner routes; returns ``when``."""
    monkeypatch.setattr("qym_platform.services.performance_ingest.utcnow", lambda: when)
    return when


def stamp(when: datetime) -> str:
    """A naive UTC time as the runner sends it."""
    return when.isoformat() + "Z"


def progress_numbers(**changes: Any) -> dict[str, Any]:
    """A progress object in the shape of guide 4.3: level 10 done, level 20 running."""
    progress: dict[str, Any] = {
        "phase": "hold",
        "step": None,
        "elapsed_s": 200.0,
        "planned_s": 300,
        "level": 20,
        "users": 20,
        "users_max": 20,
        "answers": {
            "sent": 40,
            "finished": 36,
            "ok": 35,
            "errors": 1,
            "interrupted": 0,
            "in_flight": 4,
            "oldest_in_flight_s": 12.5,
            "follow_ups": 6,
            "warmup": 2,
        },
        "errors_by_kind": {
            "auth": 0,
            "rate_limit": 0,
            "server": 1,
            "network": 0,
            "run_failed": 0,
            "other": 0,
        },
        "p95_ms": 61000,
        "levels": [
            {"level": 10, "state": "done", "hold_elapsed_pct": 100, "answers": 20},
            {"level": 20, "state": "running", "hold_elapsed_pct": 33.3, "answers": 8},
        ],
        "auth": {
            "state": "ok",
            "token_versions": {"refresh_token": 1, "access_token": 1},
        },
        "waiting_for_token": None,
        "dropped": {"questions": 0, "log_lines": 0},
    }
    progress.update(changes)
    return progress


def progress_report(
    seq: int,
    status: str = "running",
    progress: Optional[dict[str, Any]] = None,
    *,
    now: datetime = NOW,
    **extra: Any,
) -> dict[str, Any]:
    """The body of a progress report; ``progress`` defaults to ``{}``."""
    return {
        "seq": seq,
        "status": status,
        "at": stamp(now),
        "progress": {} if progress is None else progress,
        **extra,
    }


def question_record(seq: int, **changes: Any) -> dict[str, Any]:
    """One question record in the shape of guide 4.4."""
    record: dict[str, Any] = {
        "seq": seq,
        "asked_at": stamp(NOW),
        "elapsed_s": 95.5,
        "stage": "hold",
        "level": 10,
        "user": 3,
        "tier": "simple",
        "question_id": "simple-1",
        "is_followup": False,
        "question": "Question simple-1?",
        "status": "ok",
        "http_status": 200,
        "error_kind": None,
        "duration_ms": 4200,
        "ttfb_ms": 1300,
        "quality": 100,
        "no_data": False,
        "warmup": False,
        "attempts": 1,
        "answer": "Answer to simple-1",
        "answer_truncated": False,
    }
    record.update(changes)
    return record


def log_line(
    seq: int, message: str = "runner: line", level: str = "info"
) -> dict[str, Any]:
    """One log line in the shape of guide 4.5."""
    return {"seq": seq, "at": stamp(NOW), "level": level, "message": message}


def summary_body(test_type: str = "breakpoint", **changes: Any) -> dict[str, Any]:
    """A summary in the shape of guide 4.7: breaks at 20 users, safe load 10."""
    summary: dict[str, Any] = {
        "schema": 1,
        "test_type": test_type,
        "verdict": "breakpoint_found" if test_type == "breakpoint" else "pass",
        "verdict_reason": None,
        "ended_by": "auto_stop" if test_type == "breakpoint" else "plan",
        "exit_code": 99 if test_type == "breakpoint" else 0,
        "started_at": stamp(NOW),
        "ended_at": stamp(NOW),
        "target_url": "https://target.example.test/change/api/chat",
        "headline": {
            "safe_load_users": 10 if test_type == "breakpoint" else None,
            "breaking_level_users": 20 if test_type == "breakpoint" else None,
            "breaking_reason": "latency" if test_type == "breakpoint" else None,
            "recommended_max_users": 8 if test_type == "breakpoint" else None,
            "p95_at_safe_load_ms": 61000.5 if test_type == "breakpoint" else None,
            "answers_measured": 28,
            "duration_s": 212.4,
            "p95_ms": 190000,
            "answers_total": 36,
            "errors_total": 1,
            "error_rate_pct": 2.78,
            "ttfb_p95_ms": 30100,
            "max_users": 20,
            "quality_mean": 98.5,
        },
        "thresholds": [
            {
                "scope": "run",
                "metric": "llm_response_duration",
                "expression": "p(95)<180000",
                "measured": 190000,
                "ok": False,
            }
        ],
        "levels": (
            [
                summary_level(10, answers=20, result="pass", hold_elapsed_pct=100),
                summary_level(20, answers=8, result="break", hold_elapsed_pct=53.3),
            ]
            if test_type == "breakpoint"
            else []
        ),
    }
    summary.update(changes)
    return summary


def summary_level(
    level: int, *, answers: int, result: str, hold_elapsed_pct: float, **changes: Any
) -> dict[str, Any]:
    """One entry of a Breakpoint summary's ``levels`` with every field the runner sends (guide 4.7)."""
    measured = answers > 0
    tier = {"answers": None, "avg_ms": None, "p95_ms": None}
    entry: dict[str, Any] = {
        "level": level,
        "answers": answers,
        "interrupted": 0,
        "p50_ms": 30000 if measured else None,
        "p90_ms": 60000 if measured else 0,
        "p95_ms": (190000 if result == "break" else 61000) if measured else 0,
        "p99_ms": 200000 if measured else None,
        "avg_ms": 35000 if measured else 0,
        "min_ms": 9000 if measured else None,
        "max_ms": 210000 if measured else 0,
        "ttfb_p50_ms": 9000 if measured else None,
        "ttfb_p95_ms": 17000 if measured else None,
        "error_pct": 0,
        "no_data_pct": 0 if measured else None,
        "auth_error_pct": 0 if measured else None,
        "auth_contaminated": False,
        "quality_mean": 98.0 if measured else 0,
        "follow_ups": 0,
        "per_minute": round(answers / 3, 1),
        "hold_start_s": 0,
        "hold_end_s": 180,
        "by_tier": {"simple": dict(tier), "medium": dict(tier), "complex": dict(tier)},
        "passed": result == "pass",
        "latency_breach": result == "break",
        "error_breach": False,
        "has_data": measured,
        "result": result,
        "hold_elapsed_pct": hold_elapsed_pct,
    }
    entry.update(changes)
    return entry


def press_stop(
    db: Session,
    run: PerformanceRun,
    *,
    user: Optional[User] = None,
    reason: Optional[str] = None,
    now: datetime = NOW,
) -> None:
    """What Stop does to the row (guide 2.2): a queued run is stopped at once, a claimed one is stopping."""
    run.stop_requested_at = now
    run.stop_requested_by_user_id = user.id if user else None
    run.stop_reason = reason
    if run.status == "queued":
        run.status = "stopped"
        run.finished_at = now
    elif run.status in ("starting", "running"):
        run.status = "stopping"
    db.flush()


def supply_token(
    db: Session,
    run: PerformanceRun,
    name: str,
    value: str,
    *,
    user: Optional[User] = None,
    now: datetime = NOW,
) -> PerformanceTargetToken:
    """What saving a new token from the run page does: version + 1, nobody is asked any more."""
    token = db.scalars(
        select(PerformanceTargetToken).where(
            PerformanceTargetToken.target_id == run.target_id,
            PerformanceTargetToken.name == name,
        )
    ).one()
    token.token_encrypted = encrypt_llm_api_key(value)
    token.token_hint = value[-4:]
    token.version += 1
    token.updated_by_user_id = user.id if user else None
    token.updated_at = now
    run.token_needed = None
    db.flush()
    return token


def make_run(
    factory,
    *,
    project_id: str = "performance-project-1",
    status: str = "queued",
    **changes: Any,
) -> str:
    """Seed and commit a run on the project's runner, target and dataset version; returns its id."""
    with factory() as db:
        project = db.get(Project, project_id)
        runner = db.scalars(
            select(PerformanceRunner).where(PerformanceRunner.project_id == project_id)
        ).one()
        target = db.scalars(
            select(PerformanceTarget).where(PerformanceTarget.project_id == project_id)
        ).one()
        version = db.scalars(
            select(DatasetVersion)
            .join(Dataset, Dataset.id == DatasetVersion.dataset_id)
            .where(Dataset.project_id == project_id)
        ).first()
        changes.setdefault("version", version)
        run = seed_run(db, project, runner, target, status=status, **changes)
        db.commit()
        return run.id


def get_run(factory, run_id: str) -> PerformanceRun:
    """The run as the database has it now, detached."""
    with factory() as db:
        run = db.get(PerformanceRun, run_id)
        db.refresh(run)
        db.expunge(run)
        return run


# ---------------------------------------------------------------------------
# Added for the page route tests: the pages' clock, and the rows a runner leaves
# behind (questions, log lines, events, a report file), written straight to the
# tables.
# ---------------------------------------------------------------------------


def page_time(monkeypatch, when: datetime) -> datetime:
    """Set qym's clock for the page routes; returns ``when``."""
    monkeypatch.setattr("qym_platform.services.performance_views.utcnow", lambda: when)
    return when


def seed_questions(
    db: Session, run: PerformanceRun, count: int, *, first_seq: int = 1, **changes: Any
) -> list[Any]:
    """``count`` asked questions with rising ``seq``; ``changes`` overrides any column.

    A value that is a function is called with the row's ``seq``.
    """
    from qym_platform.db.models import PerformanceQuestion

    rows = []
    for seq in range(first_seq, first_seq + count):
        values: dict[str, Any] = {
            "run_id": run.id,
            "seq": seq,
            "asked_at": NOW,
            "elapsed_s": 90.0 + seq,
            "stage": "hold",
            "level": 10,
            "user_number": 1 + seq % 5,
            "tier": TIERS[seq % 3],
            "question_id": f"{TIERS[seq % 3]}-{seq}",
            "is_followup": False,
            "question": f"Question {seq}?",
            "status": "ok",
            "http_status": 200,
            "error_kind": None,
            "duration_ms": 1000.0 * seq,
            "ttfb_ms": 100.0 * seq,
            "quality": 100.0,
            "no_data": False,
            "warmup": False,
            "attempts": 1,
            "answer": f"Answer {seq}",
            "answer_truncated": False,
        }
        for name, value in changes.items():
            values[name] = value(seq) if callable(value) else value
        rows.append(PerformanceQuestion(**values))
    db.add_all(rows)
    run.questions_received = (run.questions_received or 0) + count
    db.flush()
    return rows


def seed_log_lines(
    db: Session,
    run: PerformanceRun,
    count: int,
    *,
    first_seq: int = 1,
    level: Any = "info",
    message: Any = None,
) -> list[Any]:
    """``count`` log lines with rising ``seq``; ``level`` and ``message`` may be functions of it."""
    from qym_platform.db.models import PerformanceLogLine

    rows = [
        PerformanceLogLine(
            run_id=run.id,
            seq=seq,
            at=NOW,
            level=level(seq) if callable(level) else level,
            message=(
                message(seq)
                if callable(message)
                else (message or f"runner: line {seq}")
            ),
        )
        for seq in range(first_seq, first_seq + count)
    ]
    db.add_all(rows)
    run.log_lines_received = (run.log_lines_received or 0) + count
    db.flush()
    return rows


def seed_event(
    db: Session,
    runner: PerformanceRunner,
    *,
    run: Optional[PerformanceRun] = None,
    at: datetime = NOW,
    level: str = "info",
    code: str = "note",
    message: str = "A note from the runner",
    details: Optional[dict[str, Any]] = None,
    source: str = "runner",
) -> Any:
    """One line on the runner's timeline, for a run when ``run`` is given."""
    from qym_platform.db.models import PerformanceEvent

    event = PerformanceEvent(
        runner_id=runner.id,
        run_id=run.id if run is not None else None,
        at=at,
        level=level,
        code=code,
        message=message,
        details=details or {},
        source=source,
    )
    db.add(event)
    db.flush()
    return event


def seed_report(
    db: Session,
    run: PerformanceRun,
    html: str = "<!doctype html><title>Report</title><script>1</script>",
    *,
    received_at: datetime = NOW,
) -> Any:
    """The stored report file of a run, compressed as the runner route stores it."""
    import hashlib
    import zlib

    from qym_platform.db.models import PerformanceReport

    raw = html.encode("utf-8")
    stored = zlib.compress(raw)
    report = PerformanceReport(
        run_id=run.id,
        content_type="text/html; charset=utf-8",
        html=stored,
        html_size=len(raw),
        byte_size=len(raw),
        sha256=hashlib.sha256(raw).hexdigest(),
        received_at=received_at,
    )
    db.add(report)
    run.report_received_at = received_at
    db.flush()
    return report
