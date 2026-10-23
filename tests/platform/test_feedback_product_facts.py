"""Product knowledge: one project's facts, bounded, no secrets (QE-168)."""

from __future__ import annotations

from datetime import datetime

import pytest

from _feedback_support import make_env


@pytest.fixture(params=["sqlite", "postgres"])
def env(request, monkeypatch):
    with make_env(monkeypatch, request.param) as e:
        yield e


def seed(env):
    from qym_platform.db.models import (
        Dataset,
        DatasetVersion,
        DatasetVersionStatus,
        EvalEnvironment,
        Project,
        Run,
        RunWorkflowStatus,
    )

    with env.db() as db:
        admin = env.users["admin"]
        db.add_all([Project(id="p1", name="Support agent", slug="support-agent", created_by_user_id=admin),
                    Project(id="p2", name="Other secret project", slug="other", created_by_user_id=admin)])
        db.flush()
        db.add(EvalEnvironment(id="e1", project_id="p1", name="staging-service", base_url="https://secret-host.internal/evals",
                               api_key_encrypted="ENCRYPTED-SECRET-KEY", api_key_last4="9999"))
        db.add(EvalEnvironment(id="e2", project_id="p2", name="other-env", base_url="https://other.internal"))
        ds = Dataset(id="d1", project_id="p1", name="tickets", slug="tickets", created_by_user_id=admin, access_mode="restricted")
        db.add(ds)
        db.add(Dataset(id="d2", project_id="p2", name="other-dataset", slug="other-dataset", created_by_user_id=admin))
        db.flush()
        db.add(DatasetVersion(id="v1", dataset_id="d1", version="v3", status=DatasetVersionStatus.PUBLISHED, item_count=120, created_by_user_id=admin))
        db.add(Run(id="r1", project_id="p1", created_by_user_id=admin, owner_user_id=admin, task="answer-ticket", dataset="tickets",
                   model="gpt-x", metrics=["accuracy", "tone"], status=RunWorkflowStatus.COMPLETED, created_at=datetime.utcnow(),
                   run_config={"api_key": "RUN-CONFIG-SECRET"}))
        db.commit()


def test_facts_name_the_project_and_nothing_secret_or_foreign(env):
    from qym_platform.feedback_agent.knowledge import build_project_facts

    seed(env)
    with env.db() as db:
        facts = build_project_facts(db, "p1", "run", "r1")
    for needle in ("Support agent", "staging-service", "tickets", "v3", "120 items", "restricted", "answer-ticket", "gpt-x", "accuracy", "Chosen run"):
        assert needle in facts, needle
    for secret in ("secret-host", "ENCRYPTED-SECRET-KEY", "9999", "RUN-CONFIG-SECRET", "other-env", "other-dataset", "Other secret", "@example.test", "https://"):
        assert secret not in facts, secret
    assert len(facts) <= 6000


def test_facts_are_truncated_with_a_more_marker(env):
    from qym_platform.db.models import Dataset, Project
    from qym_platform.feedback_agent.knowledge import build_project_facts

    with env.db() as db:
        db.add(Project(id="p1", name="Big", slug="big", created_by_user_id=env.users["admin"]))
        db.flush()
        for i in range(40):
            db.add(Dataset(project_id="p1", name=f"dataset-{i}-" + "x" * 180, slug=f"d{i}", created_by_user_id=env.users["admin"]))
        db.commit()
        facts = build_project_facts(db, "p1")
    assert len(facts) <= 6000 and facts.rstrip().splitlines()[-1].startswith("+")


def test_sections_and_unknown_project(env):
    from qym_platform.feedback_agent.knowledge import build_project_facts

    seed(env)
    with env.db() as db:
        assert build_project_facts(db, "p1", section="environments") == "Environments: staging-service"
        assert build_project_facts(db, "nope") == ""
        assert "Chosen" not in build_project_facts(db, "p1", "run", "r-of-another-project")
