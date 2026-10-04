"""Checkpoint helpers for incremental evaluation results."""

from __future__ import annotations

import ast
import csv
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .results import METRIC_ERROR_STATUSES


BASE_FIELDS = [
    "dataset_name",
    "run_name",
    "run_metadata",
    "run_config",
    "trace_id",
    "item_id",
    # Repeat runs (samples=k): 1-based pass index. Single runs write "1";
    # legacy files without the column parse as pass 1.
    "pass_number",
    "input",
    "item_metadata",
    "output",
    "expected_output",
    "time",
    "task_started_at_ms",
]


def _parse_pass_number(value: Any) -> int:
    try:
        return max(1, int(float(value)))
    except (TypeError, ValueError):
        return 1


def _is_error_row(row: Dict[str, Any], metrics: Sequence[str]) -> bool:
    """A failed task: the checkpoint writes ``"ERROR: <message>"`` as the
    output and ``"N/A"`` as every score. A scorer error (``"ERROR: ..."`` in
    one score) or a label that contains "ERROR" is not a failed task."""
    output = str(row.get("output", "") or "")
    if not (output.startswith("ERROR:") or output.startswith("ERROR ")):
        return False
    return all(
        str(row.get(f"{metric}_score", "") or "").strip().upper() in ("", "N/A")
        for metric in metrics
    )


def _parse_metric_score(value: Any) -> Optional[float]:
    if value is None:
        return None
    raw = str(value).strip()
    if raw == "":
        return None
    lowered = raw.lower()
    if lowered in {"n/a", "na", "none"}:
        return None
    if raw in {"✓"} or lowered in {"true", "yes", "y"}:
        return 1.0
    if raw in {"✗"} or lowered in {"false", "no", "n"}:
        return 0.0
    if lowered in {"1", "1.0"}:
        return 1.0
    if lowered in {"0", "0.0"}:
        return 0.0
    if raw.endswith("%"):
        try:
            return float(raw[:-1].strip()) / 100.0
        except (ValueError, TypeError):
            return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


def parse_metric_score(value: Any) -> Optional[float]:
    """Public wrapper to parse numeric metric scores."""
    return _parse_metric_score(value)


# Metadata key on a score that a checkpoint row holds but cannot be read.
UNREADABLE_SCORE_KEY = "checkpoint_unreadable"
_LEGACY_RESULT_MAX_LENGTH = 100_000


def checkpoint_score(value: Any) -> Tuple[Any, Dict[str, Any]]:
    """One metric score as its checkpoint cell and its ``__meta__json`` value.

    A scorer error is the ``"ERROR: ..."`` marker. A ``MetricResult`` is its
    number, with its label, explanation and metadata in the meta column, so a
    resumed run reads back the same score.
    """
    if isinstance(value, dict):
        meta = value.get("metadata")
        meta = meta if isinstance(meta, dict) else {}
        if "error" in value:
            return f"ERROR: {value['error']}", meta
        if "score" in value:
            return value.get("score"), meta
        return value, meta
    if hasattr(value, "to_legacy_dict"):  # MetricResult
        legacy = value.to_legacy_dict()
        meta = legacy["metadata"]
        status = str(meta.get("status") or "").strip().lower()
        if status in METRIC_ERROR_STATUSES:
            return f"ERROR: {meta.get('error') or status}", meta
        return legacy["score"], meta
    return value, {}


def _legacy_metric_result(raw: str) -> Optional[Dict[str, Any]]:
    """Read a ``MetricResult(...)`` repr, which older checkpoints wrote.

    Only literal keyword values are read (``ast.literal_eval``); no text is
    run. Returns the score in ``checkpoint_score``'s form, or None when the
    text cannot be read.
    """
    if len(raw) > _LEGACY_RESULT_MAX_LENGTH:
        return None
    try:
        call = ast.parse(raw, mode="eval").body
        if not (
            isinstance(call, ast.Call)
            and isinstance(call.func, ast.Name)
            and call.func.id == "MetricResult"
            and not call.args
            and all(keyword.arg for keyword in call.keywords)
        ):
            return None
        fields = {
            keyword.arg: ast.literal_eval(keyword.value) for keyword in call.keywords
        }
    except (SyntaxError, ValueError, TypeError, MemoryError, RecursionError):
        return None
    score = fields.get("score")
    metadata = fields.get("metadata", {})
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return None
    if not isinstance(metadata, dict):
        return None
    meta = dict(metadata)
    for key in ("label", "explanation"):
        if fields.get(key) is not None:
            meta[key] = fields[key]
    if fields.get("kind") not in (None, "code"):
        meta["kind"] = fields["kind"]
    return {"score": float(score), "metadata": meta}


def build_checkpoint_header(metrics: Sequence[str]) -> List[str]:
    header = list(BASE_FIELDS)
    for metric in metrics:
        header.append(f"{metric}_score")
        header.append(f"{metric}__meta__json")
    return header


def serialize_checkpoint_row(
    *,
    dataset_name: str,
    run_name: str,
    run_metadata: Dict[str, Any],
    run_config: Dict[str, Any],
    trace_id: str,
    item_id: str,
    item_input: Any,
    item_metadata: Any,
    output: Any,
    expected_output: Any,
    time_seconds: float,
    task_started_at_ms: Optional[int],
    scores: Dict[str, Any],
    metric_meta: Optional[Dict[str, Dict[str, Any]]] = None,
    pass_number: int = 1,
) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "dataset_name": dataset_name,
        "run_name": run_name,
        "run_metadata": json.dumps(run_metadata, ensure_ascii=False),
        "run_config": json.dumps(run_config, ensure_ascii=False),
        "trace_id": trace_id or "",
        "item_id": item_id,
        "pass_number": int(pass_number),
        "input": item_input,
        "item_metadata": json.dumps(item_metadata, ensure_ascii=False)
        if isinstance(item_metadata, dict)
        else str(item_metadata),
        "output": output,
        "expected_output": expected_output,
        "time": time_seconds,
        "task_started_at_ms": task_started_at_ms if task_started_at_ms is not None else "",
    }

    metric_meta = metric_meta or {}
    for metric, score in scores.items():
        row[f"{metric}_score"] = score
        meta_val = metric_meta.get(metric, {})
        row[f"{metric}__meta__json"] = (
            json.dumps(meta_val, ensure_ascii=False, default=str) if meta_val else ""
        )
    return row


@dataclass
class CheckpointState:
    path: str
    dataset_name: Optional[str]
    run_name: Optional[str]
    metrics: List[str]
    completed_item_ids: Set[str]
    error_item_ids: Set[str]
    # Repeat runs: every (item_id, pass_number) pair that already has a row.
    # Legacy files (no pass_number column) map every row to pass 1.
    completed_pairs: Set[Tuple[str, int]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.completed_pairs is None:
            self.completed_pairs = {(item_id, 1) for item_id in self.completed_item_ids}


class CheckpointWriter:
    def __init__(
        self,
        path: str,
        *,
        metrics: Sequence[str],
        flush_each_item: bool = True,
        fsync: bool = False,
    ) -> None:
        self.path = path
        self.metrics = list(metrics)
        self.flush_each_item = flush_each_item
        self.fsync = fsync
        self._file = None
        self._writer = None

    def open(self) -> None:
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        file_exists = os.path.exists(self.path) and os.path.getsize(self.path) > 0
        header = build_checkpoint_header(self.metrics)
        if file_exists:
            # Appending (resume): reuse the file's existing header so rows stay
            # aligned — a legacy file without pass_number keeps its old format
            # (extra keys such as pass_number are dropped via extrasaction).
            with open(self.path, "r", newline="", encoding="utf-8") as existing:
                existing_header = next(csv.reader(existing), None)
            if existing_header:
                header = existing_header
        self._file = open(self.path, "a", newline="", encoding="utf-8")
        self._writer = csv.DictWriter(
            self._file, fieldnames=header, extrasaction="ignore"
        )
        if not file_exists:
            self._writer.writeheader()
            self._flush()

    def append_row(self, row: Dict[str, Any]) -> None:
        if not self._writer:
            raise RuntimeError("CheckpointWriter is not open")
        self._writer.writerow(row)
        self._flush()

    def _flush(self) -> None:
        if not self._file:
            return
        if self.flush_each_item:
            self._file.flush()
            if self.fsync:
                try:
                    os.fsync(self._file.fileno())
                except Exception:
                    pass

    def close(self) -> None:
        if self._file:
            try:
                self._file.flush()
                if self.fsync:
                    os.fsync(self._file.fileno())
            except Exception:
                pass
            try:
                self._file.close()
            except Exception:
                pass
        self._file = None
        self._writer = None


def load_checkpoint_state(path: str) -> Optional[CheckpointState]:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return None
        fieldnames = reader.fieldnames
        metrics = sorted(
            {
                name[:-6]
                for name in fieldnames
                if name.endswith("_score") and "__meta__" not in name
            }
        )
        completed: Set[str] = set()
        completed_pairs: Set[Tuple[str, int]] = set()
        error_ids: Set[str] = set()
        dataset_name: Optional[str] = None
        run_name: Optional[str] = None
        for row in reader:
            if not row:
                continue
            if dataset_name is None:
                dataset_name = row.get("dataset_name") or None
            if run_name is None:
                run_name = row.get("run_name") or None
            item_id = str(row.get("item_id", "") or "")
            if not item_id:
                continue
            completed.add(item_id)
            completed_pairs.add((item_id, _parse_pass_number(row.get("pass_number"))))
            if _is_error_row(row, metrics):
                error_ids.add(item_id)
        return CheckpointState(
            path=path,
            dataset_name=dataset_name,
            run_name=run_name,
            metrics=metrics,
            completed_item_ids=completed,
            error_item_ids=error_ids,
            completed_pairs=completed_pairs,
        )


def iter_checkpoint_rows(path: str) -> Iterable[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row:
                yield row


def parse_checkpoint_row(
    row: Dict[str, Any], metrics: Sequence[str]
) -> Tuple[str, Dict[str, Any], bool]:
    item_id = str(row.get("item_id", "") or "")
    is_error = _is_error_row(row, metrics)
    result: Dict[str, Any] = {
        "input": row.get("input", ""),
        "output": row.get("output", ""),
        "expected": row.get("expected_output", ""),
        "trace_id": row.get("trace_id", ""),
        "time": float(row.get("time") or 0.0),
        "pass_number": _parse_pass_number(row.get("pass_number")),
    }
    raw_item_metadata = row.get("item_metadata", "")
    if raw_item_metadata:
        try:
            parsed_item_metadata = json.loads(raw_item_metadata)
            if isinstance(parsed_item_metadata, dict):
                result["item_metadata"] = parsed_item_metadata
        except Exception:
            pass
    raw_started = row.get("task_started_at_ms", "")
    try:
        result["task_started_at_ms"] = int(float(raw_started)) if raw_started not in (None, "") else None
    except (ValueError, TypeError):
        result["task_started_at_ms"] = None

    scores: Dict[str, Any] = {}
    metric_meta: Dict[str, Dict[str, Any]] = {}
    for metric in metrics:
        score_val = row.get(f"{metric}_score", "")
        score_num = _parse_metric_score(score_val)
        raw_score = str(score_val or "").strip()
        if score_num is not None:
            scores[metric] = score_num
        elif raw_score.startswith("MetricResult("):
            # Never a guessed score: an unreadable one is left out, and marked.
            scores[metric] = _legacy_metric_result(raw_score) or {
                "score": None,
                "metadata": {UNREADABLE_SCORE_KEY: True},
            }
        else:
            scores[metric] = score_val
        meta_raw = row.get(f"{metric}__meta__json", "")
        if meta_raw:
            try:
                parsed = json.loads(meta_raw)
                if isinstance(parsed, dict):
                    metric_meta[metric] = parsed
            except Exception:
                pass

    result["scores"] = scores
    if metric_meta:
        for metric, meta in metric_meta.items():
            if isinstance(scores.get(metric), dict):
                scores[metric]["metadata"] = {**scores[metric]["metadata"], **meta}
            else:
                scores[metric] = {"score": scores.get(metric), "metadata": meta}
    return item_id, result, is_error
