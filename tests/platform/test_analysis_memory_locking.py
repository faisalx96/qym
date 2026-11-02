"""Analyzer loads stay small and saves hold their locks briefly."""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session

from qym_platform.api import analysis as analysis_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    CorrectionStatus,
    Project,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    User,
)
from qym_platform.services.llm_analyzer import AnalysisResult

RUN_ID = "run-memory"


def _seed(db: Session, count: int) -> tuple[User, Run]:
    actor = User(id="mem-user", email="mem-user@example.com")
    project = Project(
        id="mem-project",
        name="Mem",
        slug="mem",
        created_by_user_id=actor.id,
        is_active=True,
    )
    run = Run(
        id=RUN_ID,
        project_id=project.id,
        created_by_user_id=actor.id,
        owner_user_id=actor.id,
        task="mem-task",
        dataset="mem-dataset",
        metrics=["accuracy"],
        status=RunWorkflowStatus.COMPLETED,
    )
    db.add_all([actor, project, run])
    for index in range(count):
        db.add(
            RunItem(
                run_id=run.id,
                item_id=f"item-{index}",
                index=index,
                input={"question": f"q{index}"},
                expected={"answer": f"e{index}"},
                output={"answer": f"o{index}"},
                item_metadata={"domain": "math"},
            )
        )
        db.add(
            RunItemScore(
                run_id=run.id,
                item_id=f"item-{index}",
                metric_name="accuracy",
                score_numeric=0.0,
                meta={},
            )
        )
    db.commit()
    return actor, run


def test_items_load_without_payloads_and_targets_get_theirs(
    db_session: Session,
) -> None:
    _, run = _seed(db_session, 3)
    db_session.expunge_all()
    run = db_session.get(Run, RUN_ID)

    items, scores = analysis_api._load_run_items_and_scores(
        db_session, run, with_payloads=False
    )

    assert [item.item_id for item in items] == ["item-0", "item-1", "item-2"]
    assert all(not isinstance(item, RunItem) for item in items)
    assert all(item.input is None and item.output is None for item in items)
    assert items[0].item_metadata == {"domain": "math"}
    assert scores["item-1"]["accuracy"].score_numeric == 0.0
    # Nothing ORM-tracked from the load stays in the session.
    assert not any(
        isinstance(obj, (RunItem, RunItemScore))
        for obj in db_session.identity_map.values()
    )

    analysis_api._load_analysis_payloads(db_session, run, None, [items[1]])
    assert items[1].input == {"question": "q1"}
    assert items[1].expected == {"answer": "e1"}
    assert items[1].output == {"answer": "o1"}
    assert items[0].input is None and items[2].output is None

    only, _ = analysis_api._load_run_items_and_scores(
        db_session, run, item_ids=["item-2"]
    )
    assert [(item.item_id, item.output) for item in only] == [
        ("item-2", {"answer": "o2"})
    ]
    assert only[0].trace_content == []


def test_analysis_save_commits_in_item_chunks(db_session: Session, monkeypatch) -> None:
    actor, run = _seed(db_session, 5)
    monkeypatch.setattr(analysis_api, "_ANALYSIS_SAVE_CHUNK_ITEMS", 2)
    commits: list[int] = []
    event.listen(db_session, "after_commit", lambda _session: commits.append(1))
    results = [
        AnalysisResult(
            item_id=f"item-{index}",
            metric_name="accuracy",
            root_cause="Reasoning Error",
            root_causes=["Reasoning Error"],
            root_cause_note="wrong",
            confidence=0.9,
        )
        for index in range(5)
    ]

    response, errors = analysis_api._save_analysis_results(
        db_session, run, [], results, Principal(user=actor, auth_type="none")
    )

    assert errors == 0
    assert [row["persistence_status"] for row in response] == ["persisted"] * 5
    assert len(commits) == 3  # 2 + 2 + 1 items
    db_session.expire_all()
    for index in range(5):
        item = (
            db_session.query(RunItem)
            .filter_by(run_id=RUN_ID, item_id=f"item-{index}")
            .one()
        )
        analysis = item.item_metadata["metric_analyses"]["accuracy"]
        assert analysis["root_cause"] == "Reasoning Error"
    candidates = (
        db_session.query(ReviewCorrection)
        .filter_by(run_id=RUN_ID, is_active=True)
        .all()
    )
    assert sorted(c.item_id for c in candidates) == [f"item-{i}" for i in range(5)]
    assert all(c.status != CorrectionStatus.APPROVED for c in candidates)
