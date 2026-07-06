"""Tests for the sandboxed installer (SUB3).

Container hardening, install-script suppression, allowlist re-enforcement,
timeout/failure handling, and the success-marker contract. Docker is always
mocked.
"""

from unittest.mock import MagicMock

import pytest
import requests.exceptions

from rce_service.deps import DEPS_PROVIDERS
from rce_service.deps.cache import install_phase_mounts
from rce_service.deps.javascript import _npm_install_cmd
from rce_service.deps.python import _pip_install_cmd
from rce_service.exceptions import DependencyInstallError, UnpermittedDependency
from rce_service.installer import INSTALL_LIMITS, install_packages
from rce_service.prewarm import prewarm_all

_PY = DEPS_PROVIDERS["python"]
_JS = DEPS_PROVIDERS["javascript"]


def _mock_client(mocker, *, exit_code=0, wait_raises=None, stderr=b""):
    container = MagicMock()
    if wait_raises:
        container.wait.side_effect = wait_raises
    else:
        container.wait.return_value = {"StatusCode": exit_code}
    container.logs.return_value = stderr
    client = MagicMock()
    client.containers.run.return_value = container
    mocker.patch("rce_service.installer._get_client", return_value=client)
    return container, client


def _run_kwargs(client) -> dict:
    return client.containers.run.call_args.kwargs


# ── install_cmd builders ──────────────────────────────────────────────────────


class TestInstallCommands:
    def test_pip_installs_wheels_only(self):
        cmd = _pip_install_cmd(["numpy", "pandas"], "/opt/rce-cache/python")
        assert "--only-binary=:all:" in cmd
        assert cmd[-4:] == ["--target", "/opt/rce-cache/python", "numpy", "pandas"]

    def test_npm_disables_install_scripts(self):
        cmd = _npm_install_cmd(["axios"], "/opt/rce-cache/node")
        assert "--ignore-scripts" in cmd
        assert cmd[-3:] == ["--prefix", "/opt/rce-cache/node", "axios"]


# ── Hardening ─────────────────────────────────────────────────────────────────


class TestInstallerHardening:
    def test_container_is_locked_down_except_network_and_cache(self, mocker):
        _, client = _mock_client(mocker)

        install_packages(_PY, ["numpy"])

        kwargs = _run_kwargs(client)
        assert "network_mode" not in kwargs  # network stays ON for downloads
        assert kwargs["cap_drop"] == ["ALL"]
        assert kwargs["security_opt"] == ["no-new-privileges"]
        assert kwargs["user"] == "65534:65534"
        assert kwargs["read_only"] is True
        assert kwargs["volumes"] == install_phase_mounts(_PY)

    def test_no_docker_socket_is_mounted(self, mocker):
        _, client = _mock_client(mocker)

        install_packages(_PY, ["numpy"])

        assert not any(
            "docker.sock" in mount for mount in _run_kwargs(client)["volumes"]
        )

    def test_command_is_the_package_manager_never_student_code(self, mocker):
        _, client = _mock_client(mocker)

        install_packages(_PY, ["numpy"])

        shell = _run_kwargs(client)["command"][2]
        assert shell.startswith("pip install --only-binary=:all:")

    def test_npm_command_carries_ignore_scripts(self, mocker):
        _, client = _mock_client(mocker)

        install_packages(_JS, ["axios"])

        assert "--ignore-scripts" in _run_kwargs(client)["command"][2]


# ── Allowlist, markers, failure handling ──────────────────────────────────────


class TestInstallPackages:
    def test_empty_package_list_starts_nothing(self, mocker):
        _, client = _mock_client(mocker)

        install_packages(_PY, [])

        client.containers.run.assert_not_called()

    def test_unlisted_package_is_refused_before_any_container(self, mocker):
        _, client = _mock_client(mocker)

        with pytest.raises(UnpermittedDependency) as exc:
            install_packages(_PY, ["numpy", "leftpad"])

        assert exc.value.package == "leftpad"
        client.containers.run.assert_not_called()

    def test_markers_are_written_only_after_a_successful_install(self, mocker):
        _, client = _mock_client(mocker)

        install_packages(_PY, ["numpy", "pandas"])

        shell = _run_kwargs(client)["command"][2]
        install, markers = shell.split(" && ", 1)
        assert "touch" not in install
        assert "/opt/rce-cache/python/.installed/numpy" in markers
        assert "/opt/rce-cache/python/.installed/pandas" in markers

    def test_nonzero_exit_raises_with_stderr(self, mocker):
        _mock_client(mocker, exit_code=1, stderr=b"no matching distribution")

        with pytest.raises(DependencyInstallError) as exc:
            install_packages(_PY, ["numpy"])

        assert exc.value.packages == ["numpy"]
        assert "no matching distribution" in exc.value.reason

    def test_timeout_kills_the_installer_and_raises(self, mocker):
        container, _ = _mock_client(
            mocker, wait_raises=requests.exceptions.ReadTimeout()
        )

        with pytest.raises(DependencyInstallError) as exc:
            install_packages(_PY, ["numpy"])

        container.kill.assert_called_once()
        assert f"{INSTALL_LIMITS['time']}s" in exc.value.reason

    def test_timeout_still_raises_when_kill_fails(self, mocker):
        container, _ = _mock_client(
            mocker, wait_raises=requests.exceptions.ReadTimeout()
        )
        container.kill.side_effect = RuntimeError("container already gone")

        with pytest.raises(DependencyInstallError) as exc:
            install_packages(_PY, ["numpy"])

        assert f"{INSTALL_LIMITS['time']}s" in exc.value.reason

    def test_installer_slot_is_released_after_failure(self, mocker):
        _mock_client(mocker, exit_code=1, stderr=b"boom")
        for _ in range(INSTALL_LIMITS["concurrency"] + 1):
            with pytest.raises(DependencyInstallError):
                install_packages(_PY, ["numpy"])

    def test_container_is_cleaned_up_on_success(self, mocker):
        container, _ = _mock_client(mocker)

        install_packages(_PY, ["numpy"])

        container.remove.assert_called_once()


# ── Prewarm ───────────────────────────────────────────────────────────────────


class TestPrewarm:
    def test_prewarm_installs_every_allowlist(self, mocker):
        installed = mocker.patch("rce_service.prewarm.install_packages")

        prewarm_all()

        calls = {
            call.args[0].language: call.args[1] for call in installed.call_args_list
        }
        assert calls["python"] == sorted(_PY.allowlist)
        assert calls["javascript"] == sorted(_JS.allowlist)
