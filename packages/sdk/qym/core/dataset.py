"""Dataset wrappers for evaluation."""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import os
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Union
from urllib import parse, request

from .item_identity import build_identity_fingerprint
from ..utils.errors import CsvDatasetSchemaError, DatasetNotFoundError

logger = logging.getLogger(__name__)

#: The platform, the service and the SDK share this limit (spec QC-8, QC-D16).
MAX_RUN_DATASETS = 50
#: ``run_items.item_id`` is ``VARCHAR(200)`` on the platform.
MAX_ITEM_ID_CHARS = 200
#: The run label is cut at an entry boundary past this many characters.
MAX_LABEL_CHARS = 120
#: Item metadata keys the union run adds to every item (single runs get none).
UNION_TAG_KEYS = (
    "qym_dataset",
    "qym_dataset_version",
    "qym_dataset_index",
    "qym_item_id",
    "qym_dataset_version_id",
)
_RAW_ID_META_CHARS = 1000


@dataclass(frozen=True)
class CsvDatasetItem:
    """Single dataset item loaded from CSV."""

    id: str
    input: Any
    expected_output: Any = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    dataset_item_pk: Optional[int] = None


class CsvDataset:
    """Load evaluation items from a local CSV file.

    Column mapping is user-configurable so existing CSVs don't need renaming.

    Parsing rules:
    - If a cell starts with '{' or '[', we attempt JSON parsing (dict/list).
    - Otherwise, values are kept as strings to avoid surprising coercions.
    - Multiple input columns are returned as a dictionary keyed by column name.
    """

    def __init__(
        self,
        path: str | Path,
        *,
        input_col: str | Sequence[str] = "input",
        expected_col: str | None = "expected_output",
        id_col: str | None = None,
        metadata_cols: Sequence[str] | None = None,
        name: str | None = None,
    ) -> None:
        self.path = Path(path)
        self.input_cols = self._normalize_input_cols(
            input_col,
            file_path=str(self.path),
        )
        self.input_col = (
            self.input_cols[0] if len(self.input_cols) == 1 else list(self.input_cols)
        )
        self.expected_col = expected_col
        self.id_col = id_col
        self.metadata_cols = list(metadata_cols) if metadata_cols else []
        self.name = name or self.path.name

        self._items: Optional[List[CsvDatasetItem]] = None

        if self.path.suffix.lower() != ".csv":
            raise CsvDatasetSchemaError(
                "Custom dataset must be a .csv file",
                file_path=str(self.path),
            )
        if not self.path.exists():
            raise CsvDatasetSchemaError(
                "CSV file not found",
                file_path=str(self.path),
            )

    @staticmethod
    def _normalize_input_cols(
        input_col: str | Sequence[str],
        *,
        file_path: str,
    ) -> List[str]:
        """Return validated input column names."""
        if isinstance(input_col, str):
            input_cols = [input_col]
        else:
            try:
                input_cols = list(input_col)
            except TypeError as exc:
                raise CsvDatasetSchemaError(
                    "input_col must be a string or sequence of strings",
                    file_path=file_path,
                ) from exc
        if not input_cols:
            raise CsvDatasetSchemaError(
                "At least one input column is required",
                file_path=file_path,
            )
        invalid = [
            col
            for col in input_cols
            if not isinstance(col, str) or not col.strip()
        ]
        if invalid:
            raise CsvDatasetSchemaError(
                "Input columns must be non-empty strings",
                file_path=file_path,
            )
        duplicates = sorted({col for col in input_cols if input_cols.count(col) > 1})
        if duplicates:
            raise CsvDatasetSchemaError(
                f"Duplicate input column(s): {', '.join(duplicates)}",
                file_path=file_path,
            )
        return input_cols

    @staticmethod
    def _parse_cell(raw: Any, *, file_path: str, row: int, column: str) -> Any:
        """Parse a CSV cell into a Python value with minimal magic."""
        if raw is None:
            return ""
        text = str(raw)
        stripped = text.lstrip()
        if not stripped:
            return ""
        first = stripped[0]
        if first not in ("{", "["):
            return text
        try:
            return json.loads(stripped)
        except Exception as exc:
            raise CsvDatasetSchemaError(
                f"Invalid JSON value: {exc}",
                file_path=file_path,
                row=row,
                column=column,
            ) from exc

    def _load_items(self) -> List[CsvDatasetItem]:
        file_path = str(self.path)
        try:
            with self.path.open("r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                fieldnames = list(reader.fieldnames or [])
                if not fieldnames:
                    raise CsvDatasetSchemaError("CSV has no header row", file_path=file_path)

                def _require_col(col: str) -> None:
                    if col not in fieldnames:
                        raise CsvDatasetSchemaError(
                            "Missing required column",
                            file_path=file_path,
                            column=col,
                        )

                for c in self.input_cols:
                    _require_col(c)
                if self.expected_col:
                    _require_col(self.expected_col)
                if self.id_col:
                    _require_col(self.id_col)
                for c in self.metadata_cols:
                    _require_col(c)

                rows = list(reader)
                generated_counts: Dict[str, int] = defaultdict(int)
                items: List[CsvDatasetItem] = []
                # DictReader yields data rows; CSV line numbers are 1-based with header at row=1.
                # So the first data row is row=2.
                for i, row in enumerate(rows):
                    csv_row_num = i + 2

                    if row is None:
                        continue

                    if self.id_col:
                        raw_id = row.get(self.id_col, "")
                        item_id = str(raw_id).strip()
                        if not item_id:
                            raise CsvDatasetSchemaError(
                                "Empty id value",
                                file_path=file_path,
                                row=csv_row_num,
                                column=self.id_col,
                            )

                    if len(self.input_cols) == 1:
                        input_col = self.input_cols[0]
                        raw_input = row.get(input_col, "")
                        parsed_input = self._parse_cell(
                            raw_input,
                            file_path=file_path,
                            row=csv_row_num,
                            column=input_col,
                        )
                    else:
                        parsed_input = {
                            c: self._parse_cell(
                                row.get(c, ""),
                                file_path=file_path,
                                row=csv_row_num,
                                column=c,
                            )
                            for c in self.input_cols
                        }

                    parsed_expected: Any = None
                    if self.expected_col:
                        raw_expected = row.get(self.expected_col, "")
                        parsed_expected = self._parse_cell(
                            raw_expected,
                            file_path=file_path,
                            row=csv_row_num,
                            column=self.expected_col,
                        )

                    md: Dict[str, Any] = {}
                    for c in self.metadata_cols:
                        md[c] = self._parse_cell(
                            row.get(c, ""),
                            file_path=file_path,
                            row=csv_row_num,
                            column=c,
                        )

                    if not self.id_col:
                        fingerprint = build_identity_fingerprint(
                            input_value=parsed_input,
                            expected_value=parsed_expected,
                            metadata=md,
                        )
                        generated_counts[fingerprint] += 1
                        item_id = f"csv_{fingerprint}__{generated_counts[fingerprint]:04d}"

                    items.append(
                        CsvDatasetItem(
                            id=item_id,
                            input=parsed_input,
                            expected_output=parsed_expected,
                            metadata=md,
                        )
                    )

                return items
        except CsvDatasetSchemaError:
            raise
        except Exception as exc:
            raise CsvDatasetSchemaError(
                f"Failed to read CSV: {exc}",
                file_path=file_path,
            ) from exc

    def get_items(self) -> List[CsvDatasetItem]:
        if self._items is None:
            self._items = self._load_items()
        return self._items

    @property
    def size(self) -> int:
        return len(self.get_items())

    def __len__(self) -> int:
        return self.size

    def __repr__(self) -> str:
        return f"CsvDataset(name='{self.name}', path='{self.path}', items={self.size})"


class JsonlDataset:
    """Load evaluation items from a local JSONL file.

    Each line must be an object with `input` and optional `expected_output`,
    `metadata`, `labels`, and `item_id`/`id`.
    """

    def __init__(self, path: str | Path, *, name: str | None = None) -> None:
        self.path = Path(path)
        self.name = name or self.path.name
        self.version: Optional[str] = None
        self.id: Optional[str] = None
        self.dataset_version_id: Optional[str] = None
        self._items: Optional[List[CsvDatasetItem]] = None
        if self.path.suffix.lower() != ".jsonl":
            raise CsvDatasetSchemaError(
                "JSONL dataset must be a .jsonl file",
                file_path=str(self.path),
            )
        if not self.path.exists():
            raise CsvDatasetSchemaError(
                "JSONL file not found",
                file_path=str(self.path),
            )

    def get_items(self) -> List[CsvDatasetItem]:
        if self._items is not None:
            return self._items
        items: List[CsvDatasetItem] = []
        counts: Dict[str, int] = defaultdict(int)
        try:
            for idx, line in enumerate(
                self.path.read_text(encoding="utf-8").splitlines(),
                start=1,
            ):
                text = line.strip()
                if not text:
                    continue
                obj = json.loads(text)
                if not isinstance(obj, dict):
                    raise CsvDatasetSchemaError(
                        "JSONL line must be an object",
                        file_path=str(self.path),
                        row=idx,
                    )
                input_value = obj.get("input")
                expected = obj.get("expected_output", obj.get("expected"))
                metadata = obj.get("metadata") or {}
                item_id = str(obj.get("item_id") or obj.get("id") or "").strip()
                if not item_id:
                    fingerprint = build_identity_fingerprint(
                        input_value=input_value,
                        expected_value=expected,
                        metadata=metadata,
                    )
                    counts[fingerprint] += 1
                    item_id = f"ds_{fingerprint}__{counts[fingerprint]:04d}"
                items.append(
                    CsvDatasetItem(
                        id=item_id,
                        input=input_value,
                        expected_output=expected,
                        metadata=metadata,
                    )
                )
        except CsvDatasetSchemaError:
            raise
        except Exception as exc:
            raise CsvDatasetSchemaError(
                f"Failed to read JSONL: {exc}",
                file_path=str(self.path),
            ) from exc
        self._items = items
        return items

    @property
    def size(self) -> int:
        return len(self.get_items())

    def __len__(self) -> int:
        return self.size


class InMemoryDataset:
    """Small in-memory dataset for generated tests and programmatic evals."""

    def __init__(
        self,
        items: Sequence[Dict[str, Any]],
        *,
        name: str = "in-memory",
        version: str | None = None,
    ) -> None:
        self.name = name
        self.version = version
        self.id: Optional[str] = None
        self.dataset_version_id: Optional[str] = None
        self._items = [
            CsvDatasetItem(
                id=str(item.get("item_id") or item.get("id") or f"item_{idx}"),
                input=item.get("input"),
                expected_output=item.get("expected_output", item.get("expected")),
                metadata=dict(item.get("metadata") or {}),
            )
            for idx, item in enumerate(items)
        ]

    def get_items(self) -> List[CsvDatasetItem]:
        return list(self._items)

    @property
    def size(self) -> int:
        return len(self._items)

    def __len__(self) -> int:
        return self.size


DATASET_READ_TOKEN_HEADER = "X-Qym-Dataset-Read-Token"


class QymDataset:
    """Load a versioned dataset from the qym platform."""

    def __init__(
        self,
        dataset_name: str,
        *,
        version: str | None = None,
        alias: str | None = None,
        platform_url: str | None = None,
        api_key: str | None = None,
        project_slug: str | None = None,
        read_token: str | None = None,
    ) -> None:
        self.name = dataset_name
        self.version = version
        self.alias = alias or (None if version else "production")
        self.platform_url = (
            platform_url or os.getenv("QYM_BASE_URL") or ""
        ).rstrip("/")
        self.api_key = api_key or os.getenv("QYM_API_KEY")
        # Optional admin-issued dataset read token, set by a service (e.g. the
        # Evaluation Service) so runs can read private test sets. Sent only on
        # dataset reads; the API key still authenticates and owns the run.
        self.read_token = read_token or os.getenv("QYM_DATASET_READ_TOKEN") or None
        self.project_slug = project_slug
        self.id: Optional[str] = None
        self.dataset_version_id: Optional[str] = None
        self._version_label: Optional[str] = None
        self.input_cols: List[str] = []
        self._items: Optional[List[CsvDatasetItem]] = None
        # Items the version holds but a run leaves out (disabled in the draft).
        self.disabled_count: int = 0
        if not self.platform_url or not self.api_key:
            raise DatasetNotFoundError(
                f"Dataset '{dataset_name}' is not a local file and qym platform credentials are missing. "
                "Set QYM_BASE_URL and QYM_API_KEY, or pass CsvDataset/JsonlDataset."
            )

    def _fetch_json(self, path: str) -> Dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if self.read_token:
            headers[DATASET_READ_TOKEN_HEADER] = self.read_token
        req = request.Request(f"{self.platform_url}{path}", headers=headers)
        try:
            with request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except Exception as exc:
            raise DatasetNotFoundError(
                f"Failed to load qym dataset '{self.name}': {exc}"
            ) from exc

    def get_items(self) -> List[CsvDatasetItem]:
        if self._items is not None:
            return self._items
        dataset_ref = parse.quote(self.name, safe="")
        version_ref = parse.quote(
            self.version or self.alias or "production",
            safe="",
        )
        # Disabled items stay out of runs: ask for the active set explicitly.
        params: Dict[str, str] = {"limit": "1000", "state": "active"}
        if self.project_slug:
            params["project_slug"] = self.project_slug
        items: List[CsvDatasetItem] = []
        offset = 0
        version_data: Dict[str, Any] = {}
        while True:
            params["offset"] = str(offset)
            path = (
                f"/v1/datasets/{dataset_ref}/versions/{version_ref}/items?"
                f"{parse.urlencode(params)}"
            )
            data = self._fetch_json(path)
            dataset_data = data.get("dataset") or {}
            version_data = data.get("version") or version_data
            if dataset_data:
                self.id = str(dataset_data.get("id") or "") or self.id
                self.name = str(dataset_data.get("name") or self.name)
            if version_data:
                schema = version_data.get("schema") or {}
                schema_input_cols = schema.get("input_cols") or []
                if isinstance(schema_input_cols, str):
                    schema_input_cols = [schema_input_cols]
                if isinstance(schema_input_cols, list):
                    self.input_cols = [
                        col for col in schema_input_cols if isinstance(col, str) and col
                    ]
                self.dataset_version_id = (
                    str(version_data.get("id") or "")
                    or self.dataset_version_id
                )
                self._version_label = (
                    str(version_data.get("version") or "")
                    or self._version_label
                )
                try:
                    self.disabled_count = int(version_data.get("disabled_count") or 0)
                except (TypeError, ValueError):
                    self.disabled_count = 0
            for item in data.get("items") or []:
                items.append(
                    CsvDatasetItem(
                        id=str(item.get("item_id") or item.get("id")),
                        input=item.get("input"),
                        expected_output=item.get("expected_output"),
                        metadata=dict(item.get("metadata") or {}),
                        dataset_item_pk=item.get("id"),
                    )
                )
            next_offset = data.get("next_offset")
            if next_offset is None:
                break
            offset = int(next_offset)
        if version_data and not self.version:
            self.version = self._version_label
        self._items = items
        return items

    @property
    def size(self) -> int:
        return len(self.get_items())

    def __len__(self) -> int:
        return self.size

    def __repr__(self) -> str:
        return (
            f"QymDataset(name='{self.name}', "
            f"version='{self.version or self.alias}', items={self.size})"
        )


def resolve_dataset(
    dataset: Union[str, "DatasetRef"],
    *,
    version: str | None = None,
    alias: str | None = None,
    platform_url: str | None = None,
    api_key: str | None = None,
) -> Any:
    """Resolve a dataset string to a local or qym-platform dataset object.

    A :class:`DatasetRef` is accepted too: its version or alias win over the
    keyword arguments.
    """
    if isinstance(dataset, DatasetRef):
        if Path(dataset.name).expanduser().exists() and (dataset.version or dataset.alias):
            raise ValueError("a local file has no version")
        version, alias = dataset.version, dataset.alias
        dataset = dataset.name
    path = Path(dataset).expanduser()
    if path.exists():
        suffix = path.suffix.lower()
        if suffix == ".csv":
            return CsvDataset(path)
        if suffix == ".jsonl":
            return JsonlDataset(path)
        raise CsvDatasetSchemaError(
            "Unsupported dataset file extension",
            file_path=str(path),
        )
    return QymDataset(
        dataset,
        version=version,
        alias=alias,
        platform_url=platform_url,
        api_key=api_key,
    )


# ---------------------------------------------------------------------------
# Several datasets in one run (SDK 2.1.0)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DatasetRef:
    """One dataset of a run: a platform name or a local path, plus its version.

    ``version`` and ``alias`` are mutually exclusive; with neither, the dataset's
    ``production`` alias is used (exactly like a plain name today). A reference
    carries its own version and ignores ``config.dataset_version`` /
    ``dataset_alias``.
    """

    name: str
    version: Optional[str] = None
    alias: Optional[str] = None

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("a dataset needs a name")
        if self.version is not None and self.alias is not None:
            raise ValueError("a dataset takes a version or an alias, not both")

    @classmethod
    def parse(cls, text: str) -> "DatasetRef":
        """The command-line grammar: ``name``, ``name@v3``, ``name@alias:production``.

        A value that is an existing path is a local file (no suffix parsing, so
        ``./a@b.csv`` works). Otherwise the text is split at the LAST ``@``.
        """
        if not isinstance(text, str) or not text.strip():
            raise ValueError("dataset value is empty")
        value = text.strip()
        if Path(value).expanduser().exists() or "@" not in value:
            return cls(value)
        name, _, suffix = value.rpartition("@")
        if not name:
            raise ValueError(f"dataset '{text}' has no name before '@'")
        if not suffix:
            raise ValueError(f"dataset '{text}' has an empty version after '@'")
        if suffix.startswith("alias:"):
            alias = suffix[len("alias:"):]
            if not alias:
                raise ValueError(f"dataset '{text}' has an empty alias after 'alias:'")
            return cls(name, alias=alias)
        return cls(name, version=suffix)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "DatasetRef":
        """The Evaluation Service's entry: ``{"dataset": n, "version": v, "alias": a}``."""
        name = data.get("dataset", data.get("name"))
        return cls(str(name or ""), data.get("version") or None, data.get("alias") or None)

    def __str__(self) -> str:
        return _requested_label(self)


#: A dataset in ``Evaluator(dataset=...)``: a name, a reference or a dataset object.
DatasetLike = Union[str, DatasetRef, Any]


def _display_name(name: str) -> str:
    """A platform dataset's name, or a local file's file name."""
    try:
        path = Path(name).expanduser()
        return path.name if path.exists() else name
    except OSError:
        return name


def _requested_label(entry: Any) -> str:
    """How an entry was asked for: ``name``, ``name@v3`` or ``name@production``."""
    if isinstance(entry, DatasetRef):
        suffix = entry.version or entry.alias
        name = _display_name(entry.name)
        return f"{name}@{suffix}" if suffix else name
    if isinstance(entry, str):
        return _display_name(entry)
    return str(
        getattr(entry, "dataset_name", None) or getattr(entry, "name", None) or "unknown"
    )


def _is_dataset_object(value: Any) -> bool:
    return callable(getattr(value, "get_items", None))


def _normalize_entries(
    datasets: Union[DatasetLike, Sequence[DatasetLike]],
) -> List[DatasetLike]:
    """The list of entries of a ``dataset`` argument, validated cheaply (no network)."""
    if isinstance(datasets, (list, tuple)):
        entries = list(datasets)
        if not entries:
            raise ValueError("dataset list is empty")
    else:
        entries = [datasets]
    for entry in entries:
        if not (
            isinstance(entry, (str, DatasetRef)) or _is_dataset_object(entry)
        ):
            raise TypeError(
                "dataset must be a name, a DatasetRef, a dataset object or a list of them"
            )
    if len(entries) > MAX_RUN_DATASETS:
        raise ValueError(f"at most {MAX_RUN_DATASETS} datasets per run")
    return entries


def dataset_label(datasets: Union[DatasetLike, Sequence[DatasetLike]]) -> str:
    """The run label of a ``dataset`` argument, without loading anything (QC-15)."""
    if isinstance(datasets, (list, tuple)) and len(datasets) >= 2:
        return _join_label([_requested_label(entry) for entry in datasets])
    entry = datasets[0] if isinstance(datasets, (list, tuple)) and datasets else datasets
    if isinstance(entry, DatasetRef):
        return entry.name
    return _requested_label(entry)


def _join_label(parts: Sequence[str]) -> str:
    """``a@v3 + a@v4 + b``; past 120 characters cut at an entry boundary."""
    label = " + ".join(parts)
    if len(label) <= MAX_LABEL_CHARS:
        return label
    for keep in range(len(parts) - 1, 0, -1):
        candidate = " + ".join(parts[:keep]) + f" + {len(parts) - keep} more"
        if len(candidate) <= MAX_LABEL_CHARS:
            return candidate
    tail = f" + {len(parts) - 1} more"
    return parts[0][: MAX_LABEL_CHARS - len(tail)] + tail


def resolve_datasets(
    datasets: Union[DatasetLike, Sequence[DatasetLike]],
    *,
    version: str | None = None,
    alias: str | None = None,
    platform_url: str | None = None,
    api_key: str | None = None,
) -> Any:
    """Resolve a ``dataset`` argument: the object itself for one entry, a
    :class:`UnionDataset` for two or more.

    A plain string takes ``version`` / ``alias`` (the config's defaults); a
    :class:`DatasetRef` carries its own and ignores them.
    """
    entries = _normalize_entries(datasets)
    resolved: List[tuple] = []
    for entry in entries:
        if isinstance(entry, DatasetRef):
            if Path(entry.name).expanduser().exists() and (entry.version or entry.alias):
                raise ValueError("a local file has no version")
            obj = resolve_dataset(
                entry.name,
                version=entry.version,
                alias=entry.alias,
                platform_url=platform_url,
                api_key=api_key,
            )
        elif isinstance(entry, str):
            obj = resolve_dataset(
                entry,
                version=version,
                alias=alias,
                platform_url=platform_url,
                api_key=api_key,
            )
        else:
            obj = entry
        resolved.append((entry, obj))
    if len(resolved) == 1:
        return resolved[0][1]
    return UnionDataset(resolved)


@dataclass
class UnionEntry:
    """One dataset of a :class:`UnionDataset`."""

    position: int
    requested: str
    dataset: Any
    #: Filled by ``get_items()``.
    name: str = ""
    version: Optional[str] = None
    alias: Optional[str] = None
    dataset_id: Optional[str] = None
    dataset_version_id: Optional[str] = None
    items: int = 0
    disabled_items: int = 0
    local_path: Optional[str] = None


def _short(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]


def union_item_id(label: str, raw_id: str) -> str:
    """``"{label}/{raw_id}"``, shortened deterministically past 200 characters."""
    full = f"{label}/{raw_id}"
    if len(full) <= MAX_ITEM_ID_CHARS:
        return full
    label = f"ds-{_short(label)}"
    full = f"{label}/{raw_id}"
    if len(full) <= MAX_ITEM_ID_CHARS:
        return full
    suffix = f"~{_short(raw_id)}"
    room = MAX_ITEM_ID_CHARS - len(label) - 1 - len(suffix)
    return f"{label}/{raw_id[:max(room, 0)]}{suffix}"


class UnionDataset:
    """The concatenation of several datasets, evaluated as ONE run.

    Items load sequentially in list order. With two or more entries every item id
    becomes ``"{name}@{version}/{raw id}"`` (unique even when two versions of one
    dataset share ids) and every item's ``metadata`` gains the ``qym_*`` tags that
    the platform uses to attribute scores to a source dataset.
    """

    def __init__(self, entries: Sequence[tuple]) -> None:
        self.entries: List[UnionEntry] = [
            UnionEntry(
                position=index,
                requested=_requested_label(requested),
                dataset=obj,
            )
            for index, (requested, obj) in enumerate(entries)
        ]
        #: The run label (``a@v3 + a@v4 + b``): deterministic from the request.
        self.name = _join_label([entry.requested for entry in self.entries])
        self._items: Optional[List[CsvDatasetItem]] = None
        self.id: Optional[str] = None
        self.dataset_version_id: Optional[str] = None
        self.version: Optional[str] = None
        self.alias: Optional[str] = None
        self.input_cols: List[str] = []
        self.disabled_count: int = 0

    # -- loading ---------------------------------------------------------------

    def get_items(self) -> List[CsvDatasetItem]:
        if self._items is not None:
            return self._items
        loaded: List[List[CsvDatasetItem]] = []
        for entry in self.entries:
            try:
                loaded.append(list(entry.dataset.get_items()))
            except DatasetNotFoundError as exc:
                raise DatasetNotFoundError(self._not_found_message(entry, exc)) from exc
            self._describe_entry(entry, len(loaded[-1]))
        self._check_duplicates()
        items: List[CsvDatasetItem] = []
        overwritten = False
        for entry, entry_items in zip(self.entries, loaded):
            label = (
                f"{entry.name}@{entry.version}" if entry.version else entry.name
            )
            if entry.items == 0:
                logger.warning(
                    "dataset %s%s has no active items",
                    entry.name,
                    f" {entry.version}" if entry.version else "",
                )
            for item in entry_items:
                raw_id = str(getattr(item, "id", ""))
                metadata = dict(getattr(item, "metadata", None) or {})
                if any(key in metadata for key in UNION_TAG_KEYS):
                    overwritten = True
                metadata.update(
                    {
                        "qym_dataset": entry.name,
                        "qym_dataset_version": entry.version,
                        "qym_dataset_index": entry.position,
                        "qym_item_id": raw_id[:_RAW_ID_META_CHARS],
                        "qym_dataset_version_id": entry.dataset_version_id,
                    }
                )
                items.append(
                    CsvDatasetItem(
                        id=union_item_id(label, raw_id),
                        input=getattr(item, "input", None),
                        expected_output=getattr(item, "expected_output", None),
                        metadata=metadata,
                        dataset_item_pk=getattr(item, "dataset_item_pk", None),
                    )
                )
        if overwritten:
            logger.warning(
                "item metadata keys %s were overwritten by the union run's tags",
                ", ".join(UNION_TAG_KEYS),
            )
        first = self.entries[0]
        self.id = first.dataset_id
        self.dataset_version_id = first.dataset_version_id
        self.version = first.version
        self.alias = first.alias
        self.disabled_count = sum(entry.disabled_items for entry in self.entries)
        column_sets = [
            list(getattr(entry.dataset, "input_cols", None) or [])
            for entry in self.entries
        ]
        if all(cols == column_sets[0] for cols in column_sets):
            self.input_cols = column_sets[0]
        else:
            self.input_cols = []
            logger.warning(
                "datasets have different input columns; input_mapping is not "
                "applied by column name"
            )
        self._items = items
        return items

    @staticmethod
    def _not_found_message(entry: UnionEntry, exc: Exception) -> str:
        """Name the entry that failed (``Dataset 'x' version 'v9' not found``)."""
        obj = entry.dataset
        name = str(getattr(obj, "name", None) or entry.requested)
        version = getattr(obj, "version", None) or getattr(obj, "alias", None)
        detail = str(exc)
        if "404" in detail or "not found" in detail.lower():
            where = f" version '{version}'" if version else ""
            return f"Dataset '{name}'{where} not found"
        return f"Failed to load dataset '{name}': {detail}"

    def _describe_entry(self, entry: UnionEntry, count: int) -> None:
        obj = entry.dataset
        entry.name = str(getattr(obj, "name", None) or entry.requested)
        entry.items = count
        entry.disabled_items = int(getattr(obj, "disabled_count", 0) or 0)
        path = getattr(obj, "path", None)
        entry.local_path = str(path) if path is not None else None
        entry.dataset_id = getattr(obj, "id", None) or None
        entry.dataset_version_id = getattr(obj, "dataset_version_id", None) or None
        version = getattr(obj, "version", None)
        entry.version = str(version) if version else None
        # The alias the platform resolved (a plain name reports "production", an
        # explicit version reports None); local files have none.
        entry.alias = getattr(obj, "alias", None) if isinstance(obj, QymDataset) else None

    def _check_duplicates(self) -> None:
        seen = set()
        for entry in self.entries:
            if entry.dataset_version_id:
                key: tuple = ("id", entry.dataset_version_id)
            elif entry.local_path:
                key = ("path", str(Path(entry.local_path).resolve()))
            else:
                key = ("name", entry.name, entry.version)
            if key in seen:
                raise ValueError(
                    f"dataset {entry.name}{' ' + entry.version if entry.version else ''}"
                    " is listed twice"
                )
            seen.add(key)

    # -- description -----------------------------------------------------------

    def describe(self) -> List[Dict[str, Any]]:
        """One dict per entry, in order (the upload's ``datasets`` list)."""
        self.get_items()
        return [
            {
                "dataset": entry.name,
                "dataset_id": entry.dataset_id,
                "dataset_version_id": entry.dataset_version_id,
                "version": entry.version,
                "alias": entry.alias,
                "items": entry.items,
                "disabled_items": entry.disabled_items,
            }
            for entry in self.entries
        ]

    @property
    def size(self) -> int:
        return len(self.get_items())

    def __len__(self) -> int:
        return self.size

    def __repr__(self) -> str:
        return f"UnionDataset(name='{self.name}', entries={len(self.entries)})"
