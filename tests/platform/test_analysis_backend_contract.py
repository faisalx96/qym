"""Backend contracts of Auto-analysis that the vanilla playground.js checks used to pin
down next to its markup (test_dashboard_static.py): the route table, the
prompt-content guarantees and the timeout-retry events. The analyzer UI itself is
the React app (frontend/e2e/analyzer)."""

from __future__ import annotations

from pathlib import Path

PLATFORM = Path(__file__).resolve().parents[2] / "packages" / "platform" / "qym_platform"


def _read(*parts: str) -> str:
    return PLATFORM.joinpath(*parts).read_text(encoding="utf-8")


def test_analysis_router_serves_the_documents_context_rules_and_versions_api() -> None:
    from qym_platform.api.analysis import router

    served = {
        (method, route.path)
        for route in router.routes
        for method in getattr(route, "methods", None) or ()
    }
    run = "/api/runs/{run_id:path}"
    project = "/api/projects/{project_slug}"
    for method, path in (
        ("GET", f"{run}/analysis-documents"),
        ("POST", f"{run}/analysis-documents"),
        ("PATCH", f"{run}/analysis-documents/{{document_id}}"),
        ("DELETE", f"{run}/analysis-documents/{{document_id}}"),
        ("PATCH", f"{run}/analysis-context"),
        ("POST", f"{run}/analysis-rules/infer"),
        ("GET", f"{project}/analysis-config"),
        ("GET", f"{project}/analysis-documents"),
        ("PATCH", f"{project}/analysis-context"),
        ("POST", f"{project}/analysis-rules/infer"),
        ("POST", f"{run}/analysis-rule-versions/{{version_ref}}:publish"),
        ("GET", f"{run}/analysis-rule-versions/{{version_ref}}:compare"),
        ("POST", f"{run}/analysis-rule-versions/{{version_id}}/activate"),
    ):
        assert (method, path) in served, (method, path)
    assert any(p == f"{run}/analysis-rule-aliases/{{alias_name}}" for _, p in served)


def test_auto_analysis_preserves_prompt_content_and_exposes_timeout_retry() -> None:
    analysis_api = _read("api", "analysis.py")
    analyzer_service = _read("services", "llm_analyzer.py")
    document_service = _read("services", "document_extractor.py")

    assert "_fit_prompt_messages" not in analyzer_service
    assert "_bounded_message_content" not in analyzer_service
    assert "LLM_RETRY_TIMEOUT_SECONDS = 240.0" in analyzer_service
    assert "max_timeout_retries=_analysis_max_retries()" in analysis_api
    assert "request_timeout_seconds=request.timeout_seconds" in analysis_api
    assert "_analysis_request_concurrency(request.concurrency)" in analysis_api
    assert '"context_limit_exceeded"' in analyzer_service
    assert '"analysis_timeout"' in analyzer_service
    assert "MAX_ANALYZER_REQUEST_CHARS" not in analyzer_service
    assert "AnalyzerRequestSizeError" not in analyzer_service
    assert "analysis_request_too_large" not in analyzer_service
    assert 'phase="retrying"' in analysis_api
    assert '"type": "retrying"' in analysis_api
    assert '"type": "aggregating"' in analysis_api
    assert "DocumentContentLimitError" not in document_service
    assert "MAX_REFERENCE_DOCUMENT_CONTENT_CHARS" not in document_service
    assert '"document_content_characters": None' in analysis_api
    assert '"final_prompt_characters": None' in analysis_api
    assert "text = text[:max_chars]" not in document_service


def test_human_root_causes_are_protected_and_inference_sources_are_checked() -> None:
    analysis_api = _read("api", "analysis.py")

    assert "NO_INFERENCE_SOURCES" in analysis_api
    assert "def _is_human_metric_analysis(" in analysis_api
    assert "allow_human_overwrite: bool = False" in analysis_api
    assert "allow_human_overwrite=request.allow_human_overwrite" in analysis_api
