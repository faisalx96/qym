"""Regression: choosing "Empty / Missing" for a versioning key must not break the overview.

Found while porting test_versioning_filter_browser.py: the overview computes the
other keys' facet values with a select-from-RunVersion join, and the NOT EXISTS
subquery of the ``__empty__`` option auto-correlated away its own FROM
(``InvalidRequestError`` -> HTTP 500 on POST /api/dashboard/overview).
"""

from __future__ import annotations

import pytest

from test_dashboard_durable_summaries import drain
from test_run_versioning_filter import _dashboard, _run_ids, _seed, client  # noqa: F401


@pytest.mark.parametrize(
    "selection",
    [
        {"agent_version": ["__empty__"]},
        {"prompt_version": ["__empty__"]},
        {"agent_version": ["v1", "__empty__"]},
        {"agent_version": ["__empty__"], "kb_version": ["381"]},
    ],
)
def test_overview_with_an_empty_versioning_selection(database, client, selection):  # noqa: F811
    _seed(database)
    drain(database)
    response = _dashboard(client, "overview", {"versioning": selection})
    assert response.status_code == 200
    # The overview's run set is the one the runs list shows.
    assert response.json()["total_runs"] == len(_run_ids(client, selection))
