"""A source's Live 'today' is a day in its day_key_timezone, never the UTC day."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from sqlalchemy.orm import sessionmaker

from qym_platform.db.models import LiveSource, LiveTurn
from qym_platform.services import live_overview
from qym_platform.settings import PlatformSettings

# 22:30 UTC on November 5 is already November 6 in Riyadh (UTC+3).
NOW = datetime(2026, 11, 5, 22, 30)


@pytest.mark.parametrize(
    "zone, today",
    [
        ("Asia/Riyadh", date(2026, 11, 6)),
        ("UTC", date(2026, 11, 5)),
        ("America/New_York", date(2026, 11, 5)),
        # An empty or unknown zone falls back to the UTC date.
        ("", date(2026, 11, 5)),
        ("UTC+03:00", date(2026, 11, 5)),
        ("Not/AZone", date(2026, 11, 5)),
        ("../etc/passwd", date(2026, 11, 5)),
    ],
)
def test_source_today_is_the_day_in_the_source_zone(zone, today):
    source = LiveSource(day_key_timezone=zone)
    assert live_overview.source_today(source, NOW) == today
    aware = NOW.replace(tzinfo=timezone.utc)
    assert live_overview.source_today(source, aware) == today


def test_source_status_carries_today_in_the_source_zone():
    status = live_overview.source_status(
        LiveSource(day_key_timezone="Asia/Riyadh"), PlatformSettings(), NOW
    )
    assert status["today"] == "2026-11-06"
    status = live_overview.source_status(
        LiveSource(day_key_timezone="UTC+03:00"), PlatformSettings(), NOW
    )
    assert status["today"] == "2026-11-05"


def test_overview_without_a_day_or_day_rows_reads_the_source_today(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        source = LiveSource(
            project_id="p",
            key="riyadh",
            name="Riyadh worker",
            environment="test",
            day_key_timezone="Asia/Riyadh",
        )
        db.add(source)
        db.flush()
        # One turn on the UTC day, two on the source's day; no LiveDay rows.
        for day, count in ((date(2026, 11, 5), 1), (date(2026, 11, 6), 2)):
            for i in range(count):
                db.add(
                    LiveTurn(
                        source_id=source.id,
                        day=day,
                        turn_id=f"{day}-{i}",
                        turn_at=NOW,
                        status="completed",
                        question="Question",
                    )
                )
        db.commit()
        payload = live_overview.overview_payload(
            db, source, None, 7, PlatformSettings(), NOW
        )
    assert payload["status"]["today"] == "2026-11-06"
    assert payload["day"]["in_qym"] == 2
