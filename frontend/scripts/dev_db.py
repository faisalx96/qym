"""Create the platform schema in a local SQLite file for `npm run dev` / e2e.

Alembic's migration chain is written for PostgreSQL (ALTER CONSTRAINT), so a
throwaway dev/e2e database is created straight from the ORM metadata, exactly
as the platform's own browser tests do. Usage:

    python frontend/scripts/dev_db.py sqlite:////abs/path/.qym-dev.db
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine


def main(url: str) -> None:
    os.environ.setdefault("QYM_DATABASE_URL", url)
    from qym_platform.db import models  # noqa: F401  (registers every table)
    from qym_platform.db.base import Base

    engine = create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    print(f"schema ready: {url}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "sqlite:///.qym-dev.db")
