"""HIGH priority policy text (plan §5.3, D9).

A ``HIGH`` job preempts every running ``LOW``/``NORMAL`` job on its environment, for
all users. Launching (or retrying) at ``HIGH`` needs a project manager and an explicit
``acknowledge_preemption: true``. The UI mirrors this text in
``_static/dashboard/eval_environments.js`` (``HIGH_PRIORITY_WARNING``).
"""

from __future__ import annotations

from typing import Iterable

HIGH_PRIORITY_WARNING = (
    "Launching at HIGH cancels every running LOW/NORMAL job on {env} for all users."
)
PREEMPTION_ACK_REQUIRED = "preemption_acknowledgement_required"


def high_priority_warning(env_names: Iterable[str]) -> str:
    """The §5.3 warning for one or more environment names."""
    return HIGH_PRIORITY_WARNING.format(env=", ".join(env_names))
