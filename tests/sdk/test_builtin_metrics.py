from qym.metrics.builtin import exact_match


def test_exact_match_returns_numeric_score_for_match():
    result = exact_match("Paris", "Paris")
    assert isinstance(result, dict)
    assert result["score"] == 1.0


def test_exact_match_returns_numeric_score_for_mismatch():
    result = exact_match("Paris", "London")
    assert isinstance(result, dict)
    assert result["score"] == 0.0


def test_faithfulness_reports_reasons_and_missing_context_as_error():
    """C010: verdict reasons use "reason"; missing context is a scorer error."""
    from qym.metrics.builtin import faithfulness

    empty = faithfulness("", None, {"context": "Paris is in France"})
    assert empty == {"score": 0.0, "metadata": {"reason": "Empty output"}}

    missing = faithfulness("Paris", None, {"question": "Where?"})
    assert missing["score"] == 0.0
    assert missing["error"] == "No context found in input_data"
