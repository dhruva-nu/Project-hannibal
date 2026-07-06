"""Tests for structured dependency-error responses (SUB6).

The exception → payload mapping, the ``UnsupportedLanguage`` message, and the
stream event shape. Pure logic — no Docker, no HTTP.
"""

from rce_service.dependency_errors import (
    dependency_error_info,
    dependency_error_result,
)
from rce_service.events import DependencyErrorEvent
from rce_service.exceptions import (
    DependencyInstallError,
    UnpermittedDependency,
    UnsupportedLanguage,
)

# ── exception → payload mapping ───────────────────────────────────────────────


class TestDependencyErrorInfo:
    def test_unpermitted_dependency_maps_to_not_allowed(self):
        info = dependency_error_info(UnpermittedDependency("leftpad", "python"))
        assert info["kind"] == "not_allowed"
        assert info["package"] == "leftpad"
        assert "leftpad" in info["reason"]

    def test_install_failure_maps_to_install_failed(self):
        info = dependency_error_info(
            DependencyInstallError(["numpy"], "python", "mirror down")
        )
        assert info["kind"] == "install_failed"
        assert info["package"] == "numpy"

    def test_install_failure_reason_is_capped_not_a_full_traceback(self):
        info = dependency_error_info(
            DependencyInstallError(["numpy"], "python", "x" * 10_000)
        )
        assert len(info["reason"]) <= 300

    def test_result_is_a_run_that_never_started(self):
        result = dependency_error_result(UnpermittedDependency("leftpad", "python"))
        assert result["exit_code"] == -1
        assert result["stdout"] == "" and result["stderr"] == ""
        assert result["timed_out"] is False
        assert result["dependency_error"]["kind"] == "not_allowed"


class TestUnsupportedLanguage:
    def test_message_names_the_language_and_suggests_another(self):
        error = UnsupportedLanguage("cobol not wired up", "cobol")
        assert error.lang == "cobol"
        assert str(error) == "cobol is not supported yet, please try another language"


# ── stream event shape ────────────────────────────────────────────────────────


class TestDependencyErrorEvent:
    def test_event_serializes_with_its_own_event_type(self):
        event = DependencyErrorEvent(
            exec_id="x", package="leftpad", reason="nope", kind="not_allowed"
        )
        assert event.to_dict() == {
            "exec_id": "x",
            "package": "leftpad",
            "reason": "nope",
            "kind": "not_allowed",
            "event_type": "dependency_error",
        }
