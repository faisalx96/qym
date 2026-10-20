"""Per-dataset access: levels, catalog filtering, access routes, run redaction (WP-A, A1-37 to A1-60)."""

from __future__ import annotations

import json

import pytest
from _dataset_access_env import (ADMIN, MEM, MEM2, MEM3, MGR, OUT,
                                 dataset_world, upload)
from qym_platform.db.models import (ApiKey, AuditLog, Dataset, DatasetGrant,
                                    DatasetVersion, Project, ProjectMembership,
                                    ProjectRole, Run, RunItem, RunItemScore,
                                    RunWorkflowStatus, User)
from qym_platform.permissions import (DATASET_ACCESS_DENIED_DETAIL,
                                      DATASET_ACCESS_MANAGE_DETAIL,
                                      DATASET_VIEW_ONLY_DETAIL,
                                      dataset_access_level)
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.dataset_read_tokens import (HEADER, clear_cache,
                                                       issue_token)
from sqlalchemy import event

PARAMS = {"project_slug": "pa"}
SECRET = "restricted-secret-question"


@pytest.fixture()
def world(monkeypatch):
    with dataset_world(monkeypatch) as env:
        yield env


def _upload(client, headers, name="qa", **fields):
    response = upload(
        client,
        headers,
        name,
        [("a", SECRET, "answer", "t"), ("b", "second", "x", "t")],
        publish="true",
        **fields,
    )
    assert response.status_code == 200, response.text
    return response.json()["dataset"]


def _access(client, headers, ref="qa"):
    return client.get(f"/v1/datasets/{ref}/access", params=PARAMS, headers=headers)


def _put(client, headers, mode, grants=(), ref="qa"):
    return client.put(
        f"/v1/datasets/{ref}/access",
        params=PARAMS,
        headers=headers,
        json={
            "access_mode": mode,
            "grants": [{"user_id": u, "level": lv} for u, lv in grants],
        },
    )


def _restrict(client, grants=(), ref="qa"):
    response = _put(client, MGR, "restricted", grants, ref)
    assert response.status_code == 200, response.text
    return response.json()


def _level(factory, user_id, ref="qa"):
    from qym_platform.auth import Principal

    with factory() as db:
        user = db.get(User, user_id)
        dataset = db.query(Dataset).filter(Dataset.slug == ref).one()
        return dataset_access_level(
            db, Principal(user=user, auth_type="proxy_headers"), dataset
        )


# --------------------------------------------------------------- defaults and levels


def test_default_mode_is_project_and_every_member_modifies(world):
    client, factory, _ = world
    created = _upload(client, MEM)
    assert created["access_mode"] == "project" and created["grant_count"] == 0
    for headers in (MGR, MEM, MEM2, ADMIN):
        dataset = client.get("/v1/datasets/qa", params=PARAMS, headers=headers).json()[
            "dataset"
        ]
        assert dataset["permissions"]["can_modify"] is True
        assert dataset["permissions"]["can_view_items"] is True
    with factory() as db:
        assert (
            db.query(DatasetGrant).count() == 0
        )  # the creator is not added as a grant (A1-47)


def test_levels_table_for_every_principal_kind(world):
    client, factory, _ = world
    _upload(client, MEM)  # mem creates the dataset
    _restrict(client, [("mem2", "view"), ("mem3", "modify")])
    assert _level(factory, "admin") == "manage"
    assert _level(factory, "mgr") == "manage"
    assert _level(factory, "mem") == "modify"  # the creator
    assert _level(factory, "mem2") == "view"
    assert _level(factory, "mem3") == "modify"
    assert _level(factory, "out") == "none"  # not a member of the project


def test_member_without_grant_has_no_access_in_restricted_mode(world):
    client, factory, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem2", "view")])
    assert _level(factory, "mem") == "none"
    response = client.get("/v1/datasets/qa", params=PARAMS, headers=MEM)
    assert response.status_code == 403
    assert (
        response.json()["detail"]
        == DATASET_ACCESS_DENIED_DETAIL
        == "You don't have access to this dataset"
    )


def test_view_grant_reads_but_cannot_change(world):
    client, _, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem2", "view")])
    assert client.get("/v1/datasets/qa", params=PARAMS, headers=MEM2).status_code == 200
    items = client.get("/v1/datasets/qa/versions/v1/items", params=PARAMS, headers=MEM2)
    assert items.status_code == 200 and items.json()["total"] == 2
    permissions = client.get("/v1/datasets/qa", params=PARAMS, headers=MEM2).json()[
        "dataset"
    ]["permissions"]
    assert permissions["access_level"] == "view"
    assert (
        permissions["can_modify"] is False and permissions["can_manage_access"] is False
    )
    denied = DATASET_VIEW_ONLY_DETAIL
    assert denied == "You can view this dataset but not change it"
    writes = [
        client.patch(
            "/v1/datasets/qa", params=PARAMS, headers=MEM2, json={"description": "x"}
        ),
        client.post(
            "/v1/datasets/qa/versions",
            params=PARAMS,
            headers=MEM2,
            json={"version": "v2", "from_version": "v1"},
        ),
        client.post(
            "/v1/datasets/qa/aliases/staging",
            params=PARAMS,
            headers=MEM2,
            json={"version": "v1"},
        ),
        client.post(
            "/v1/datasets/qa/versions/v1/items",
            params=PARAMS,
            headers=MEM2,
            json={"input": "q"},
        ),
        client.post(
            "/v1/datasets/qa/versions/v1/items:bulk",
            params=PARAMS,
            headers=MEM2,
            json={"upserts": []},
        ),
        client.post(
            "/v1/datasets/qa/versions/v1/items/a:disable",
            params=PARAMS,
            headers=MEM2,
            json={},
        ),
        client.post(
            "/v1/datasets/qa/versions/v1/items:batch",
            params=PARAMS,
            headers=MEM2,
            json={"filter": {"search": "a"}, "action": "disable"},
        ),
    ]
    for response in writes:
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == denied


def test_modify_grant_edits_but_cannot_change_access_or_slug(world):
    client, _, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem3", "modify")])
    assert (
        client.patch(
            "/v1/datasets/qa", params=PARAMS, headers=MEM3, json={"description": "d"}
        ).status_code
        == 200
    )
    draft = client.post(
        "/v1/datasets/qa/versions",
        params=PARAMS,
        headers=MEM3,
        json={"version": "v2", "from_version": "v1"},
    )
    assert draft.status_code == 200
    created = client.post(
        "/v1/datasets/qa/versions/v2/items",
        params=PARAMS,
        headers=MEM3,
        json={"input": "q"},
    )
    assert created.status_code == 200
    slug = client.patch(
        "/v1/datasets/qa", params=PARAMS, headers=MEM3, json={"slug": "other"}
    )
    assert slug.status_code == 403
    changed = _put(client, MEM3, "project")
    assert changed.status_code == 403
    assert changed.json()["detail"] == DATASET_ACCESS_MANAGE_DETAIL


def test_every_dataset_route_answers_403_for_level_none(world):
    client, _, _ = world
    _upload(client, MGR)
    client.post(
        "/v1/datasets/qa/versions",
        params=PARAMS,
        headers=MGR,
        json={"version": "v2", "from_version": "v1"},
    )
    _restrict(client, [])
    base = "/v1/datasets/qa"
    gets = [
        base,
        f"{base}/versions",
        f"{base}/runs",
        f"{base}/lineage",
        f"{base}/access",
        f"{base}/versions/v1",
        f"{base}/versions/v1/items",
        f"{base}/versions/v1/items/a",
        f"{base}/versions/v1/items/a/runs",
        f"{base}/versions/v1/items/a/neighbors",
        f"{base}/versions/v1/items/a/lineage",
        f"{base}/versions/v1/items:metadata-facets",
        f"{base}/versions/v2:compare",
        f"{base}/versions/v1:download",
        f"/api/datasets/qa/versions/v1/items/a/revisions",
    ]
    for path in gets:
        response = client.get(path, params={**PARAMS, "base": "v1"}, headers=MEM)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DATASET_ACCESS_DENIED_DETAIL
    posts = [
        (f"{base}/versions", {"version": "v9"}),
        (f"{base}/versions/v2:publish", {}),
        (f"{base}/aliases/staging", {"version": "v1"}),
        (f"{base}/versions/v2/items", {"input": "q"}),
        (f"{base}/versions/v2/items:bulk", {"upserts": []}),
        (f"{base}/versions/v2/items/a:disable", {}),
        (f"{base}/versions/v2/items/a:enable", {}),
        (
            f"{base}/versions/v2/items:batch",
            {"filter": {"search": "a"}, "action": "disable"},
        ),
    ]
    for path, body in posts:
        response = client.post(path, params=PARAMS, headers=MEM, json=body)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DATASET_ACCESS_DENIED_DETAIL
    assert (
        client.patch(
            base, params=PARAMS, headers=MEM, json={"description": "x"}
        ).status_code
        == 403
    )
    assert client.delete(base, params=PARAMS, headers=MEM).status_code == 403
    assert (
        client.delete(
            f"{base}/versions/v2/items/a", params=PARAMS, headers=MEM
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{base}/versions/v2/items/a",
            params=PARAMS,
            headers=MEM,
            json={"input": "z"},
        ).status_code
        == 403
    )


def test_upload_to_an_existing_restricted_dataset_needs_modify(world):
    client, _, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem2", "view")])
    for headers in (MEM, MEM2):
        response = upload(client, headers, "qa", [("c", "q", "a", "t")], version="v2")
        assert response.status_code == 403, response.text
    assert (
        upload(client, MGR, "qa", [("c", "q", "a", "t")], version="v2").status_code
        == 200
    )


def test_cross_project_user_gets_the_project_error_not_the_dataset_403(world):
    client, _, _ = world
    _upload(client, MGR)
    _restrict(client, [])
    response = client.get("/v1/datasets/qa", params=PARAMS, headers=OUT)
    assert response.status_code == 403 and response.json()["detail"] == "Access denied"


# --------------------------------------------------------------- access routes


def test_get_access_payload_shape_and_candidates(world):
    client, _, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem2", "modify"), ("mem", "view")])
    body = _access(client, MGR).json()
    assert (
        body["access_mode"] == "restricted"
        and body["can_manage_access"] is True
        and body["your_level"] == "manage"
    )
    assert [g["user"]["id"] for g in body["grants"]] == ["mem2", "mem"] or {
        g["user"]["id"] for g in body["grants"]
    } == {"mem", "mem2"}
    first = body["grants"][0]
    assert set(first) == {"user", "level", "granted_by", "created_at"}
    assert set(first["user"]) == {"id", "name", "email"}
    assert first["granted_by"]["id"] == "mgr"
    assert [c["id"] for c in body["candidates"]] == [
        "mem3"
    ]  # not managers, admins or granted users
    viewer = _access(client, MEM).json()
    assert (
        viewer["can_manage_access"] is False
        and viewer["candidates"] == []
        and viewer["your_level"] == "view"
    )
    assert (
        len(viewer["grants"]) == 2
    )  # grants are visible to everyone who can view (decision A-3)


def test_access_denied_for_none_level_and_viewer_cannot_put(world):
    client, _, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem2", "view")])
    assert _access(client, MEM3).status_code == 403
    assert _put(client, MEM2, "project").status_code == 403


def test_grants_order_by_created_at_then_name(world):
    client, factory, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem3", "view"), ("mem", "view"), ("mem2", "view")])
    names = [g["user"]["name"] for g in _access(client, MGR).json()["grants"]]
    assert names == sorted(names)  # same created_at: ordered by name
    from datetime import datetime, timedelta

    with factory() as db:
        grant = db.query(DatasetGrant).filter(DatasetGrant.user_id == "mem3").one()
        grant.created_at = datetime.utcnow() - timedelta(days=1)
        db.commit()
    ids = [g["user"]["id"] for g in _access(client, MGR).json()["grants"]]
    assert ids[0] == "mem3"


def test_put_validation_texts(world):
    client, _, _ = world
    _upload(client, MGR)
    bad_mode = _put(client, MGR, "secret")
    assert (
        bad_mode.status_code == 422
        and bad_mode.json()["detail"] == "access_mode must be project or restricted"
    )
    bad_level = _put(client, MGR, "restricted", [("mem", "owner")])
    assert (
        bad_level.status_code == 422
        and bad_level.json()["detail"] == "level must be view or modify"
    )
    duplicate = _put(client, MGR, "restricted", [("mem", "view"), ("mem", "modify")])
    assert (
        duplicate.status_code == 422
        and duplicate.json()["detail"] == "Duplicate grant for user mem"
    )
    outsider = _put(client, MGR, "restricted", [("out", "view")])
    assert outsider.status_code == 422
    assert (
        outsider.json()["detail"] == "User out is not an active member of this project"
    )
    nobody = _put(client, MGR, "restricted", [("ghost", "view")])
    assert nobody.status_code == 422
    # Managers and admins in the list are accepted (and ignored in effect).
    ok = _put(client, MGR, "restricted", [("mgr", "view")])
    assert ok.status_code == 200


def test_put_is_a_full_replace_and_returns_the_get_payload(world):
    client, factory, _ = world
    _upload(client, MGR)
    first = _put(client, MGR, "restricted", [("mem", "view"), ("mem2", "modify")])
    assert first.status_code == 200
    assert first.json() == _access(client, MGR).json()
    second = _put(client, ADMIN, "restricted", [("mem2", "view"), ("mem3", "modify")])
    body = second.json()
    levels = {g["user"]["id"]: g["level"] for g in body["grants"]}
    assert levels == {"mem2": "view", "mem3": "modify"}
    with factory() as db:
        assert db.query(DatasetGrant).count() == 2


def test_grants_are_kept_in_project_mode_and_apply_again(world):
    client, factory, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem2", "view")])
    assert _level(factory, "mem2") == "view"
    project_mode = _put(client, MGR, "project", [("mem2", "view")])
    assert project_mode.status_code == 200
    assert _level(factory, "mem2") == "modify"  # project mode: every member modifies
    assert _level(factory, "mem3") == "modify"
    catalog = client.get("/v1/datasets", params=PARAMS, headers=MGR).json()["datasets"][
        0
    ]
    assert catalog["access_mode"] == "project" and catalog["grant_count"] == 0
    with factory() as db:
        assert db.query(DatasetGrant).count() == 1  # stored
    _put(client, MGR, "restricted", [("mem2", "view")])
    assert _level(factory, "mem2") == "view" and _level(factory, "mem3") == "none"


def test_access_change_is_audited_without_emails(world):
    client, factory, _ = world
    _upload(client, MGR)
    _put(client, MGR, "restricted", [("mem", "view")])
    _put(client, MGR, "restricted", [("mem", "modify"), ("mem2", "view")])
    with factory() as db:
        rows = (
            db.query(AuditLog)
            .filter(AuditLog.action == "dataset.access_changed")
            .order_by(AuditLog.id)
            .all()
        )
        assert len(rows) == 2
        last = rows[-1]
        assert last.actor_user_id == "mgr" and last.entity_type == "dataset"
        assert last.before["access_mode"] == "restricted" and last.before["grants"] == [
            {"user_id": "mem", "level": "view"}
        ]
        assert last.after["grants"] == [
            {"user_id": "mem", "level": "modify"},
            {"user_id": "mem2", "level": "view"},
        ]
        assert "@" not in json.dumps([last.before, last.after])


def test_removed_member_grants_are_inert_and_dropped_on_next_put(world):
    client, factory, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem2", "modify")])
    with factory() as db:
        db.query(ProjectMembership).filter(ProjectMembership.user_id == "mem2").delete()
        db.commit()
    assert _level(factory, "mem2") == "none"
    assert [g["user"]["id"] for g in _access(client, MGR).json()["grants"]] == []
    _put(client, MGR, "restricted", [])
    with factory() as db:
        assert db.query(DatasetGrant).count() == 0


def test_grants_survive_soft_delete_and_restore(world):
    client, factory, _ = world
    created = _upload(client, MGR)
    _restrict(client, [("mem2", "view")])
    assert (
        client.delete("/v1/datasets/qa", params=PARAMS, headers=MGR).status_code == 200
    )
    with factory() as db:
        assert db.query(DatasetGrant).count() == 1
    restored = client.post(
        f"/v1/datasets/{created['id']}:restore", params=PARAMS, headers=MGR
    )
    assert restored.status_code == 200
    assert restored.json()["dataset"]["access_mode"] == "restricted"
    assert _level(factory, "mem2") == "view"


# --------------------------------------------------------------- catalog


def test_catalog_omits_unreadable_datasets_and_counts_follow(world):
    client, _, _ = world
    _upload(client, MGR, "open")
    _upload(client, MGR, "secret")
    _put(client, MGR, "restricted", [("mem2", "view")], "secret")
    names = lambda headers: [
        d["slug"]
        for d in client.get("/v1/datasets", params=PARAMS, headers=headers).json()[
            "datasets"
        ]
    ]
    assert names(MEM) == ["open"]
    assert names(MEM2) == ["open", "secret"]
    assert names(MGR) == ["open", "secret"] and names(ADMIN) == ["open", "secret"]
    body = client.get("/v1/datasets", params=PARAMS, headers=MEM).json()
    assert body["total"] == 1
    card = client.get("/v1/datasets", params=PARAMS, headers=MEM2).json()["datasets"][1]
    assert card["access_mode"] == "restricted" and card["grant_count"] == 1


def test_launch_pickers_can_list_datasets_the_caller_cannot_open(world):
    client, _, _ = world
    _upload(client, MGR, "open")
    _upload(client, MGR, "secret")
    _put(client, MGR, "restricted", [], "secret")
    listed = client.get(
        "/v1/datasets", params={**PARAMS, "include_inaccessible": "true"}, headers=MEM
    ).json()["datasets"]
    by_slug = {d["slug"]: d for d in listed}
    assert set(by_slug) == {"open", "secret"}
    assert by_slug["secret"]["permissions"]["access_level"] == "none"
    assert by_slug["secret"]["permissions"]["can_view_items"] is False
    assert by_slug["secret"]["access_mode"] == "restricted"


def test_creator_keeps_seeing_a_restricted_dataset(world):
    client, _, _ = world
    _upload(client, MEM)
    _restrict(client, [])
    assert [
        d["slug"]
        for d in client.get("/v1/datasets", params=PARAMS, headers=MEM).json()[
            "datasets"
        ]
    ] == ["qa"]


def test_catalog_statement_count_is_flat(world):
    client, factory, engine = world
    for n in range(3):
        _upload(client, MGR, f"d{n:02d}")
        _put(client, MGR, "restricted", [("mem", "view")], f"d{n:02d}")

    def count_statements() -> int:
        statements: list[str] = []

        def capture(conn, cursor, statement, params, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", capture)
        try:
            assert (
                client.get("/v1/datasets", params=PARAMS, headers=MEM).status_code
                == 200
            )
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        return len(statements)

    few = count_statements()
    for n in range(3, 30):
        name = f"d{n:02d}"
        with factory() as db:
            project = db.get(Project, "pa")
            db.add(
                Dataset(
                    id=f"ds-{name}",
                    project_id=project.id,
                    name=name,
                    slug=name,
                    created_by_user_id="mgr",
                    access_mode="restricted",
                )
            )
            db.flush()
            db.add(
                DatasetGrant(
                    dataset_id=f"ds-{name}",
                    user_id="mem",
                    level="view",
                    granted_by_user_id="mgr",
                )
            )
            db.commit()
    many = count_statements()
    assert many == few, (few, many)


# --------------------------------------------------------------- runs on a restricted dataset


def _seed_run(factory, name="qa", run_id="run-1"):
    with factory() as db:
        dataset = db.query(Dataset).filter(Dataset.slug == name).one()
        version = (
            db.query(DatasetVersion)
            .filter(DatasetVersion.dataset_id == dataset.id)
            .first()
        )
        run = Run(
            id=run_id,
            project_id="pa",
            created_by_user_id="mgr",
            owner_user_id="mgr",
            task="task",
            dataset=name,
            dataset_id=dataset.id,
            dataset_version_id=version.id,
            metrics=["exact_match"],
            status=RunWorkflowStatus.DRAFT,
        )
        db.add(run)
        db.flush()
        db.add(
            RunItem(
                run_id=run_id,
                item_id="a",
                index=0,
                input=SECRET,
                expected="answer",
                output="the model said answer",
                item_metadata={"topic": "t"},
            )
        )
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id="a",
                metric_name="exact_match",
                score_numeric=1.0,
                explanation=f"matched {SECRET}",
                meta={"judge_prompt": SECRET, "status": "ok"},
            )
        )
        db.commit()


def test_run_on_a_restricted_dataset_is_listed_but_item_contents_are_redacted(world):
    client, factory, _ = world
    _upload(client, MGR)
    _seed_run(factory)
    _restrict(client, [("mem2", "view")])
    data = client.get("/api/runs/run-1", headers=MEM)
    assert data.status_code == 200  # the run stays open, with its scores (D1)
    assert SECRET not in data.text
    body = data.json()
    assert body["run"]["items_restricted"] is True
    assert body["run"]["items_restricted_reason"] == "dataset_access"
    row = body["snapshot"]["rows"][0]
    assert row["content_restricted"] is True and row["metric_values"] == [1.0]
    details = client.post(
        "/api/runs/run-1/items/details", json={"item_ids": ["a"]}, headers=MEM
    )
    assert details.status_code == 200 and SECRET not in details.text
    # F1: the placeholder names the right cause, in the table rows and in the details.
    from qym_platform.permissions import DATASET_ACCESS_PLACEHOLDER

    assert DATASET_ACCESS_PLACEHOLDER == "Hidden: you don\u2019t have access to this dataset\u2019s items."
    assert details.json()["rows"][0]["input"] == DATASET_ACCESS_PLACEHOLDER
    assert DATASET_ACCESS_PLACEHOLDER in data.text
    assert "private test set" not in data.text.lower()
    assert "private test set" not in details.text.lower()
    for path in ("/api/runs/run-1/spans", "/api/runs/run-1/items/a/trace"):
        response = client.get(path, headers=MEM)
        assert SECRET not in response.text, path
    # The JSON scan of the whole compare payload: no input, expected, output or reason text.
    compare = client.get("/api/compare", params={"files": ["run-1"]}, headers=MEM)
    assert compare.status_code == 200
    for word in (SECRET, "the model said answer"):
        assert word not in compare.text
    # A user with a grant, a manager and an admin see the content.
    for headers in (MEM2, MGR, ADMIN):
        allowed = client.get("/api/runs/run-1", headers=headers)
        assert allowed.status_code == 200 and SECRET in allowed.text
        assert "items_restricted" not in allowed.json()["run"]


def test_private_test_set_reason_wins_over_dataset_access(world):
    client, factory, _ = world
    _upload(client, MGR)
    _seed_run(factory)
    _restrict(client, [])
    with factory() as db:
        db.query(Dataset).filter(Dataset.slug == "qa").one().private_test_set = True
        db.commit()
    body = client.get("/api/runs/run-1", headers=MEM).json()
    assert body["run"]["items_restricted"] is True
    assert body["run"]["items_restricted_reason"] == "private_test_set"


def test_hidden_dataset_run_ids_for_a_page_of_runs(world):
    from qym_platform.auth import Principal
    from qym_platform.permissions import (hidden_dataset_run_ids,
                                          run_item_hidden_reasons)

    client, factory, _ = world
    _upload(client, MGR, "open")
    _upload(client, MGR, "locked")
    _seed_run(factory, "open", "run-open")
    _seed_run(factory, "locked", "run-locked")
    _put(client, MGR, "restricted", [], "locked")
    with factory() as db:
        runs = db.query(Run).all()
        mem = Principal(user=db.get(User, "mem"), auth_type="proxy_headers")
        admin = Principal(user=db.get(User, "admin"), auth_type="proxy_headers")
        assert hidden_dataset_run_ids(db, mem, runs) == {"run-locked"}
        assert run_item_hidden_reasons(db, mem, runs) == {
            "run-locked": "dataset_access"
        }
        assert hidden_dataset_run_ids(db, admin, runs) == set()


# --------------------------------------------------------------- launch gate, private flag, tokens


def test_private_test_set_stays_orthogonal(world):
    client, factory, _ = world
    _upload(client, ADMIN)
    with factory() as db:
        db.query(Dataset).filter(Dataset.slug == "qa").one().private_test_set = True
        db.commit()
    # A manager is not a platform admin: dataset access is manage, items stay hidden.
    response = client.get(
        "/v1/datasets/qa/versions/v1/items", params=PARAMS, headers=MGR
    )
    assert (
        response.status_code == 403 and "private test set" in response.json()["detail"]
    )
    perms = client.get("/v1/datasets/qa", params=PARAMS, headers=MGR).json()["dataset"][
        "permissions"
    ]
    assert perms["access_level"] == "manage" and perms["can_view_items"] is False
    assert (
        client.get(
            "/v1/datasets/qa/versions/v1/items", params=PARAMS, headers=ADMIN
        ).status_code
        == 200
    )


def _api_key(
    factory,
    user_id,
    token="key-token",
    scopes=("datasets:read", "datasets:write", "runs:read"),
):
    with factory() as db:
        db.add(
            ApiKey(
                id=f"key-{token}",
                user_id=user_id,
                project_id="pa",
                name="test",
                prefix=api_key_prefix(token),
                key_hash=hash_api_key(token),
                scopes=list(scopes),
            )
        )
        db.commit()
    return {"Authorization": f"Bearer {token}"}


def test_api_key_gets_the_key_owners_level_and_scopes_still_apply(world):
    client, factory, _ = world
    _upload(client, MGR)
    _restrict(client, [("mem2", "view")])
    owner_none = _api_key(factory, "mem", "k-none")
    owner_view = _api_key(factory, "mem2", "k-view")
    owner_view_ro = _api_key(factory, "mem2", "k-ro", scopes=("datasets:read",))
    assert (
        client.get("/v1/datasets/qa/versions/v1/items", headers=owner_none).status_code
        == 403
    )
    assert (
        client.get("/v1/datasets/qa/versions/v1/items", headers=owner_view).status_code
        == 200
    )
    denied = client.post(
        "/v1/datasets/qa/versions/v1/items", headers=owner_view, json={"input": "q"}
    )
    assert (
        denied.status_code == 403
        and denied.json()["detail"] == DATASET_VIEW_ONLY_DETAIL
    )
    scoped = client.get("/v1/datasets/qa", headers=owner_view_ro)
    assert scoped.status_code == 200


def test_dataset_read_token_lifts_none_to_view_on_item_reads_only(world):
    client, factory, _ = world
    _upload(client, MGR)
    _restrict(client, [])
    clear_cache()
    with factory() as db:
        _, token = issue_token(
            db, project_id="pa", name="svc", created_by_user_id="admin"
        )
    key = _api_key(factory, "mem", "k-svc")
    with_token = {**key, HEADER: token}
    items = client.get("/v1/datasets/qa/versions/v1/items", headers=with_token)
    assert items.status_code == 200 and items.json()["total"] == 2
    assert (
        client.get(
            "/v1/datasets/qa/versions/v1/items/a", headers=with_token
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/v1/datasets/qa/versions/v1:download", headers=with_token
        ).status_code
        == 200
    )
    # Without the token the same key is refused; the token never opens other routes or writes.
    assert (
        client.get("/v1/datasets/qa/versions/v1/items", headers=key).status_code == 403
    )
    assert client.get("/v1/datasets/qa/versions", headers=with_token).status_code == 403
    assert (
        client.post(
            "/v1/datasets/qa/versions/v1/items", headers=with_token, json={"input": "q"}
        ).status_code
        == 403
    )


def test_dataset_read_token_does_not_cross_projects(world):
    client, factory, _ = world
    _upload(client, MGR)
    _restrict(client, [])
    clear_cache()
    with factory() as db:
        _, token = issue_token(
            db, project_id="pb", name="svc-b", created_by_user_id="admin"
        )
    key = _api_key(factory, "mem", "k-x")
    response = client.get(
        "/v1/datasets/qa/versions/v1/items", headers={**key, HEADER: token}
    )
    assert (
        response.status_code == 403
        and response.json()["detail"] == DATASET_ACCESS_DENIED_DETAIL
    )


def test_launching_is_not_gated_by_dataset_access(world):
    # Owner decision D3: the catalog hides a restricted dataset, but nothing in the
    # run/experiment flow checks dataset grants; the dataset still exists in the project.
    client, factory, _ = world
    _upload(client, MGR)
    _restrict(client, [])
    with factory() as db:
        dataset = db.query(Dataset).filter(Dataset.slug == "qa").one()
        assert dataset.access_mode == "restricted" and dataset.project_id == "pa"
