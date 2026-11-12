import os
import pytest
from unittest.mock import MagicMock, AsyncMock
import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parents[1]
sdk_root = repo_root / "packages" / "sdk"
platform_root = repo_root / "packages" / "platform"
for p in (str(sdk_root), str(platform_root), str(repo_root)):
    if p not in sys.path:
        sys.path.insert(0, p)

# PlatformSettings reads ``.env`` from the working directory. Keep a developer's
# repo-root .env (auth mode, secrets, database) out of the suite so local runs
# match CI, and give modules that build settings at import the CI defaults.
os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")
os.environ.setdefault("QYM_ENVIRONMENT", "test")
try:
    from qym_platform import settings as _platform_settings
except ImportError:  # SDK-only environment without the platform's dependencies
    _platform_settings = None
if _platform_settings is not None:
    for _settings_cls in (
        _platform_settings.PlatformSettings,
        _platform_settings.ProductEvalSettings,
    ):
        _settings_cls.model_config["env_file"] = None
    # Every platform app factory calls configure_logging() once per process.
    # Do it before any test so the first create_app() inside a test cannot
    # reset a root level that caplog.set_level() just lowered.
    from qym_platform.log import configure_logging as _configure_platform_logging

    _configure_platform_logging()

# ``import qym`` loads the cwd .env, and a path-less load_dotenv() (Alembic's
# env.py, insightor_eval.py) walks up from its own file; both reach the repo
# .env. Tests that write their own .env in tmp_path still load it.
try:
    import dotenv
except ImportError:
    dotenv = None
if dotenv is not None:
    _repo_dotenv = repo_root / ".env"
    _load_dotenv = dotenv.load_dotenv

    def _load_dotenv_outside_repo(dotenv_path=None, stream=None, *args, **kwargs):
        if stream is None and (
            dotenv_path is None or Path(dotenv_path).resolve() == _repo_dotenv
        ):
            return False
        return _load_dotenv(dotenv_path, stream, *args, **kwargs)

    dotenv.load_dotenv = _load_dotenv_outside_repo

mock_langfuse_pkg = MagicMock()
mock_langfuse_pkg.__path__ = []
sys.modules["langfuse"] = mock_langfuse_pkg

# Mock other optional heavy deps that may not be installed in test env
for _mod in ("arabic_reshaper", "bidi", "bidi.algorithm", "openpyxl"):
    if _mod not in sys.modules:
        _m = MagicMock()
        _m.__path__ = []
        sys.modules[_mod] = _m


@pytest.fixture
def mock_langfuse():
    mock = MagicMock()
    return mock


@pytest.fixture
def mock_dataset():
    mock = MagicMock()
    mock.get_items.return_value = []
    return mock


@pytest.fixture
def mock_task():
    return MagicMock()


@pytest.fixture
def postgres_engine():
    """Isolated PostgreSQL schema for one test; skips when QYM_TEST_POSTGRES_URL is unset.

    Creates the current ORM schema with ``Base.metadata.create_all`` and drops the
    schema on teardown. Use it for behaviour that SQLite cannot exercise
    (partitioning, jsonb, FK enforcement, real query plans).
    """
    import os
    from uuid import uuid4

    from sqlalchemy import create_engine, text

    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    from qym_platform.db.base import Base
    import qym_platform.db.models  # noqa: F401 - registers every table on Base

    schema = "qym_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


DURATIONS = Path(__file__).with_name(".test_durations.json")
SMALL_TEST = (
    0.15  # seconds: the mean CI time of the tests that the durations file leaves out
)


def duration_key(nodeid: str) -> str:
    """The JUnit "classname::name" of a node id (the key of tests/.test_durations.json)."""
    path, *parts = nodeid.split("::")
    classname = ".".join([path[:-3].replace("/", ".")] + parts[:-1])
    return f"{classname}::{parts[-1]}" if parts else classname


def pytest_collection_modifyitems(config, items):
    """QYM_TEST_SHARD="K/N" keeps the K-th of N slices of the tests (CI runs N jobs in parallel).

    Slices have about equal time: tests/.test_durations.json holds each test's last CI time
    (scripts/test_durations.py writes it from the CI JUnit files). The longest tests are placed
    first, each in the slice with the least time so far; a test with no time (under 0.5 s, or new)
    counts as SMALL_TEST seconds.
    The order is fixed by time then node id, so every xdist worker keeps the same tests.
    """
    shard = os.environ.get("QYM_TEST_SHARD")
    if not shard:
        return
    import json

    index, total = (int(part) for part in shard.split("/"))
    known = json.loads(DURATIONS.read_text()) if DURATIONS.is_file() else {}
    cost = {
        item.nodeid: known.get(duration_key(item.nodeid), SMALL_TEST) for item in items
    }
    loads = [0.0] * total
    slot_of = {}
    for nodeid in sorted(cost, key=lambda n: (-cost[n], n)):
        slot = min(range(total), key=lambda k: (loads[k], k))
        loads[slot] += cost[nodeid]
        slot_of[nodeid] = slot
    keep, drop = [], []
    for item in items:
        (keep if slot_of[item.nodeid] == index - 1 else drop).append(item)
    items[:] = keep
    config.hook.pytest_deselected(items=drop)
