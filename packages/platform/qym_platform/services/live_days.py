"""Resolve calendar days in a live source's reporting timezone."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from qym_platform.datetime_utils import ensure_utc
from qym_platform.db.models import LiveSource


def source_zone(source: LiveSource) -> ZoneInfo:
    """Return the reporting zone, tolerating invalid legacy values on reads."""
    try:
        return ZoneInfo(source.day_key_timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError, OSError):
        return ZoneInfo("UTC")


def source_today(source: LiveSource, now: datetime) -> date:
    """Return today's source-local date, treating a naive clock as UTC."""
    return ensure_utc(now).astimezone(source_zone(source)).date()
