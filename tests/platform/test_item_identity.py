import pytest

from qym_platform.item_identity import (
    MUTABLE_METADATA_KEYS,
    build_compare_identity,
    finalize_compare_alignment,
)


def test_platform_compare_identity_prefers_non_positional_item_id():
    duplicate_counts = {}

    identity = build_compare_identity(
        item_id="case-123",
        input_value="What is 2+2?",
        expected_value="4",
        metadata={"domain": "math"},
        duplicate_counts=duplicate_counts,
    )

    assert identity == {
        "compare_item_id": "case-123",
        "compare_alignment_source": "item_id",
    }


def test_platform_compare_identity_falls_back_to_fingerprint_for_legacy_row_ids():
    duplicate_counts = {}

    identity = build_compare_identity(
        item_id="row_000001",
        input_value="What is 2+2?",
        expected_value="4",
        metadata={"domain": "math"},
        duplicate_counts=duplicate_counts,
    )

    assert identity["compare_item_id"].startswith("csv_")
    assert identity["compare_alignment_source"] == "fingerprint"


# Keys whose leak into the fingerprint was a shipped regression stay covered
# even if someone drops them from MUTABLE_METADATA_KEYS. retry_count split BIRD
# items across runs and inflated the "0 runs" bucket on the compare page.
_REGRESSION_MUTABLE_KEYS = {"analysis_error", "retry_count", "trace_stats"}


@pytest.mark.parametrize(
    "key", sorted(MUTABLE_METADATA_KEYS | _REGRESSION_MUTABLE_KEYS)
)
def test_platform_compare_identity_ignores_mutable_metadata_in_fingerprint(key):
    def identity(metadata):
        return build_compare_identity(
            item_id="row_000001",
            input_value="What is 2+2?",
            expected_value="4",
            metadata=metadata,
            duplicate_counts={},
        )

    clean = identity({"domain": "math"})

    assert clean["compare_alignment_source"] == "fingerprint"
    assert identity({"domain": "math", key: 1}) == clean
    assert identity({"domain": "math", key: {"changed": "value"}}) == clean
    # Control: immutable metadata still changes the fingerprint.
    assert identity({"domain": "physics", key: 1}) != clean


def test_platform_compare_identity_recomputes_generated_csv_item_ids():
    first_identity = build_compare_identity(
        item_id="csv_9d87abc4a109c976c595__0001",
        input_value="What is 2+2?",
        expected_value="4",
        metadata={"domain": "math"},
        duplicate_counts={},
    )

    second_identity = build_compare_identity(
        item_id="csv_912a92090d65db565175__0001",
        input_value="What is 2+2?",
        expected_value="4",
        metadata={"domain": "math"},
        duplicate_counts={},
    )

    assert first_identity["compare_item_id"] == second_identity["compare_item_id"]
    assert first_identity["compare_alignment_source"] == "fingerprint"
    assert second_identity["compare_alignment_source"] == "fingerprint"


def test_platform_finalize_compare_alignment_marks_duplicate_compare_keys_unalignable():
    payload = {
        "run": {"run_name": "legacy-run"},
        "snapshot": {
            "rows": [
                {"compare_item_id": "dup-key"},
                {"compare_item_id": "dup-key"},
            ]
        },
    }

    result = finalize_compare_alignment(payload)

    assert result["run"]["compare_alignment_status"] == "unalignable"
    assert result["run"]["compare_alignment_issues"] == ["duplicate compare_item_id: dup-key"]
