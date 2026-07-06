"""Tests for two-phase orchestration (SUB5).

The prepare step (resolve → ensure cache) in front of every execution path,
and the run container's unchanged lockdown plus its two dependency-related
additions: a read-only cache mount and the resolution env var.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from rce_service import two_phase
from rce_service.config import RUNTIME
from rce_service.deps.cache import run_phase_mounts
from rce_service.docker import run_code
from rce_service.exceptions import UnpermittedDependency
from rce_service.two_phase import prepare_dependencies

_PY_PROVIDER = RUNTIME["python"]["deps"]


def _mock_docker(mocker):
    container = MagicMock()
    container.wait.return_value = {"StatusCode": 0}
    container.logs.side_effect = [b"output\n", b""]
    mock_client = MagicMock()
    mock_client.containers.run.return_value = container
    mocker.patch("rce_service.docker._get_client", return_value=mock_client)
    return mock_client


# ── prepare_dependencies ──────────────────────────────────────────────────────


class TestPrepareDependencies:
    async def test_ensures_resolved_packages_before_the_run(self, mocker):
        ensure = mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())

        packages = await prepare_dependencies("import numpy", "python")

        assert packages == ["numpy"]
        ensure.assert_awaited_once_with(_PY_PROVIDER, ["numpy"])

    async def test_stdlib_only_code_never_touches_the_queue(self, mocker):
        ensure = mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())

        assert await prepare_dependencies("import os, json", "python") == []

        ensure.assert_not_awaited()

    async def test_unpermitted_import_raises_before_the_queue(self, mocker):
        ensure = mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())

        with pytest.raises(UnpermittedDependency) as exc:
            await prepare_dependencies("import leftpad", "python")

        assert exc.value.package == "leftpad"
        ensure.assert_not_awaited()

    async def test_same_path_works_for_javascript(self, mocker):
        ensure = mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())

        packages = await prepare_dependencies(
            "const a = require('axios')", "javascript"
        )

        assert packages == ["axios"]
        ensure.assert_awaited_once_with(RUNTIME["javascript"]["deps"], ["axios"])


# ── run container posture ─────────────────────────────────────────────────────


class TestRunContainerPosture:
    def test_cache_is_mounted_read_only_with_resolution_env(self, mocker):
        mock_client = _mock_docker(mocker)

        run_code("print(1)", "python")

        kwargs = mock_client.containers.run.call_args.kwargs
        assert kwargs["volumes"] == run_phase_mounts(_PY_PROVIDER)
        assert kwargs["environment"] == {"PYTHONPATH": "/opt/rce-cache/python"}

    def test_lockdown_is_unchanged_by_the_cache_mount(self, mocker):
        mock_client = _mock_docker(mocker)

        run_code("print(1)", "python")

        kwargs = mock_client.containers.run.call_args.kwargs
        assert kwargs["network_mode"] == "none"
        assert kwargs["read_only"] is True
        assert kwargs["cap_drop"] == ["ALL"]
        assert kwargs["user"] == "65534:65534"
