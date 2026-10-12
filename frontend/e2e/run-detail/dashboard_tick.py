"""Drain the dashboard summary worker a few ticks so seeded runs appear in the Runs list order.

The e2e platform runs with QYM_ROLE=api (no background loops), so the runs list / pager
projection is only filled when something ticks the worker. Used by the pager spec.
"""
from qym_platform.db import models  # noqa: F401
from sqlalchemy.orm import configure_mappers

configure_mappers()
from qym_platform.db.session import SessionLocal  # noqa: E402
from qym_platform.services.dashboard_summaries import DashboardSummaryWorker  # noqa: E402

worker = DashboardSummaryWorker(SessionLocal)
for _ in range(8):
    worker.tick()
