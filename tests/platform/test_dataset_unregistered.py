"""The catalog lists dataset names that runs used but no dataset registers (C030).

Runs sent with a name that no dataset carries keep ``dataset_id`` empty, so the
Datasets page said "No datasets yet" next to hundreds of runs. ``GET
/v1/datasets:unregistered`` gives each such name with its live run count; a name
that a live dataset carries is left out.
"""

from __future__ import annotations

from datetime import datetime

from qym_platform.db.models import Run, RunWorkflowStatus

from test_dataset_p1_datasets import MEM, MGR, _upload, env  # noqa: F401  (fixture)


def _run(run_id: str, dataset: str, deleted: bool = False) -> Run:
    return Run(
        id=run_id,
        project_id="pa",
        created_by_user_id="mgr",
        owner_user_id="mgr",
        task="t",
        dataset=dataset,
        metrics=["m"],
        run_metadata={},
        run_config={"run_name": run_id},
        status=RunWorkflowStatus.COMPLETED,
        deleted_at=datetime(2026, 10, 1) if deleted else None,
    )


def test_unregistered_names_come_with_their_run_counts(env):
    client, factory, _ = env
    assert _upload(client, MGR, "Support QA", [("a", "q", "a", "t")], publish="true").status_code == 200
    with factory() as db:
        db.add_all(
            [
                _run("r1", "text2sql-golden-v1"),
                _run("r2", "text2sql-golden-v1"),
                _run("r3", "faq-arabic"),
                _run("r4", "faq-arabic", deleted=True),
                # a registered name (any case) is not listed, even without a dataset_id
                _run("r5", "support qa"),
                _run("r6", "support-qa"),
            ]
        )
        db.commit()
    response = client.get("/v1/datasets:unregistered", params={"project_slug": "pa"}, headers=MEM)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "names": [{"name": "text2sql-golden-v1", "runs": 2}, {"name": "faq-arabic", "runs": 1}],
        "total": 2,
    }
