"""Seed rows into a database migrated to an older revision.

ORM models describe the head schema. A populated-upgrade test that seeds at
an older revision must not insert columns that later migrations add (for
example ``projects.archived_at`` from 0065), so rows are inserted through a
Core table holding only the columns that exist now, with the ORM's own types
and Python-side defaults.
"""

from __future__ import annotations

from typing import Any, Dict

from sqlalchemy import MetaData, Table, inspect


def insert_at_revision(connection, model, *rows: Dict[str, Any]) -> None:
    """Insert ``rows`` (keyed by ORM attribute or column name) into ``model``'s
    table, using only the columns the live schema has."""
    table = model.__table__
    mapper = getattr(model, "__mapper__", None)
    live = {column["name"] for column in inspect(connection).get_columns(table.name)}
    partial = Table(
        table.name,
        MetaData(),
        *[column._copy() for column in table.columns if column.name in live],
    )
    for row in rows:
        values = {}
        for key, value in row.items():
            name = key
            if mapper is not None and key in mapper.attrs and hasattr(mapper.attrs[key], "columns"):
                name = mapper.attrs[key].columns[0].name
            if name not in live:
                if value is None:
                    continue
                raise AssertionError(
                    f"{table.name}.{name} does not exist at this revision; seed it after upgrading"
                )
            values[name] = value
        connection.execute(partial.insert().values(values))
