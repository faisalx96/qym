from __future__ import annotations

import os

import uvicorn

from qym_platform.log import configure_logging, get_logger

logger = get_logger(__name__)


def main() -> None:
    host = os.environ.get("QYM_PLATFORM_HOST", "0.0.0.0")
    port = int(os.environ.get("QYM_PLATFORM_PORT", "8000"))
    configure_logging()
    logger.info("starting qym platform on %s:%s", host, port)
    uvicorn.run("qym_platform.main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()

