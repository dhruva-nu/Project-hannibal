"""Security invariants for dependency-aware execution (SUB7 of #103).

These tests exist to fail loudly if any constraint of the two-phase design
regresses. The invariants, from #103:

1. Student code NEVER runs during the network-on phase.
2. Install scripts are disabled (wheels-only pip, ``--ignore-scripts`` npm).
3. The run container sees the cache read-only; the installer gets no Docker
   socket.
4. The run sandbox is exactly as locked down as before deps existed.

And, from #153, one more the emulators must not weaken:

5. A lesson run never gets a control channel, and a request that declares no
   emulators is the run it was before emu existed.

Everything is mocked — no Docker daemon, no network.
"""

import base64
from unittest.mock import MagicMock

import pytest

from rce_service import docker as rce_docker
from rce_service import emu, installer, two_phase
from rce_service.config import LIMITS, RUNTIME
from rce_service.deps import DEPS_PROVIDERS
from rce_service.deps.cache import install_phase_mounts, run_phase_mounts
from rce_service.docker import run_code
from rce_service.install_queue import InstallQueue
from rce_service.installer import INSTALL_LIMITS, install_packages
from rce_service.two_phase import prepare_dependencies

_PY = DEPS_PROVIDERS["python"]


def _mock_client(mocker, target: str):
    container = MagicMock()
    container.wait.return_value = {"StatusCode": 0}
    container.logs.side_effect = [b"", b""]
    client = MagicMock()
    client.containers.run.return_value = container
    mocker.patch(target, return_value=client)
    return client


# ── Invariant 1: student code never enters the network-on phase ───────────────


class TestStudentCodeNeverOnline:
    async def test_installer_command_carries_no_student_code(self, mocker):
        queue = InstallQueue()
        mocker.patch.object(queue, "_is_cached", return_value=False)
        mocker.patch.object(two_phase, "install_queue", queue)
        installer_client = _mock_client(mocker, "rce_service.installer._get_client")

        student_code = "import numpy\nprint('EXFILTRATE')"
        await prepare_dependencies(student_code, "python")

        kwargs = installer_client.containers.run.call_args.kwargs
        shell = kwargs["command"][2]
        assert "network_mode" not in kwargs  # this container IS online…
        assert "EXFILTRATE" not in shell  # …so the code must not be in it
        assert base64.b64encode(student_code.encode()).decode() not in shell
        assert shell.startswith("pip install")

    def test_the_container_that_runs_student_code_is_offline(self, mocker):
        run_client = _mock_client(mocker, "rce_service.docker._get_client")

        run_code("import numpy\nprint('EXFILTRATE')", "python")

        kwargs = run_client.containers.run.call_args.kwargs
        assert kwargs["network_mode"] == "none"
        assert (
            "EXFILTRATE" in kwargs["command"][2]
            or base64.b64encode(b"import numpy\nprint('EXFILTRATE')").decode()
            in kwargs["command"][2]
        )


# ── Invariant 2: install scripts are disabled, for every language ─────────────

_SCRIPT_HARDENING = {"python": "--only-binary=:all:", "javascript": "--ignore-scripts"}


class TestInstallScriptsDisabled:
    def test_every_registered_language_declares_its_hardening_flag(self):
        # Adding a language without deciding its script-suppression flag is a
        # security decision skipped — this forces the conversation.
        assert set(_SCRIPT_HARDENING) == set(DEPS_PROVIDERS)

    @pytest.mark.parametrize(("language", "flag"), sorted(_SCRIPT_HARDENING.items()))
    def test_install_cmd_carries_the_flag(self, language, flag):
        provider = DEPS_PROVIDERS[language]
        cmd = provider.install_cmd(sorted(provider.allowlist), provider.cache_path)
        assert flag in cmd


# ── Invariant 3: mount posture ────────────────────────────────────────────────


class TestMountPosture:
    @pytest.mark.parametrize(
        "provider", DEPS_PROVIDERS.values(), ids=lambda p: p.language
    )
    def test_run_phase_cache_is_read_only(self, provider):
        assert all(m["mode"] == "ro" for m in run_phase_mounts(provider).values())

    @pytest.mark.parametrize(
        "provider", DEPS_PROVIDERS.values(), ids=lambda p: p.language
    )
    def test_installer_mounts_only_its_own_cache(self, provider):
        mounts = install_phase_mounts(provider)
        assert set(mounts) == {provider.cache_volume}
        assert "/var/run/docker.sock" not in mounts

    def test_installer_container_gets_no_docker_socket(self, mocker):
        client = _mock_client(mocker, "rce_service.installer._get_client")

        install_packages(_PY, ["numpy"])

        volumes = client.containers.run.call_args.kwargs["volumes"]
        assert not any("docker.sock" in source for source in volumes)


# ── Invariant 4: the run sandbox is unchanged ─────────────────────────────────


class TestRunSandboxUnchanged:
    @pytest.mark.parametrize("language", sorted(RUNTIME))
    def test_full_lockdown_snapshot(self, mocker, language):
        client = _mock_client(mocker, "rce_service.docker._get_client")
        provider = RUNTIME[language]["deps"]

        run_code("x = 1" if language == "python" else "const x = 1", language)

        kwargs = client.containers.run.call_args.kwargs
        assert kwargs["network_mode"] == "none"
        assert kwargs["read_only"] is True
        assert kwargs["cap_drop"] == ["ALL"]
        assert kwargs["security_opt"] == ["no-new-privileges"]
        assert kwargs["user"] == "65534:65534"
        assert kwargs["mem_limit"] == LIMITS["memory"]
        assert kwargs["memswap_limit"] == LIMITS["memory"]
        assert kwargs["pids_limit"] == LIMITS["pid"]
        assert kwargs["tmpfs"] == {"/tmp": "size=64m,mode=1777"}
        assert kwargs["volumes"] == run_phase_mounts(provider)
        assert kwargs["environment"] == provider.runtime_env

    def test_install_concurrency_is_separate_from_the_run_semaphore(self):
        assert installer._install_semaphore is not rce_docker._semaphore
        assert INSTALL_LIMITS["concurrency"] == 2  # network-on cap, run cap is 5


# ── Invariant 5: emulators change the command, never the posture ──────────────

_LESSON = {"services": ["postgres"], "seed": {"postgres": ["SELECT 1"]}}

# Every flag that would give something inside the sandbox a way to talk to the
# control plane. emu keeps them behind argv precisely so this list can be
# checked here; the config file cannot enable any of them.
_CONTROL_FLAGS = ["--dev-control-socket", "--dev-control-bind"]


class TestALessonRunHasNoControlChannel:
    def test_the_wrapped_command_asks_for_no_control_plane(self, mocker):
        # If this ever fails, read the threat model in plans/emu-service.md
        # before "fixing" it: student code runs as emu's own uid, so a control
        # channel it can reach lets the code being graded disarm the faults
        # grading it. That is measured, not theorised — verify-sandbox.sh
        # demonstrates the disarm.
        client = _mock_client(mocker, "rce_service.docker._get_client")

        run_code("x = 1", "python", _LESSON)

        shell = client.containers.run.call_args.kwargs["command"][2]
        for flag in _CONTROL_FLAGS:
            assert flag not in shell

    def test_emu_is_given_nothing_but_a_config(self, mocker):
        # Stronger than an allowlist of forbidden flags: whatever emu grows
        # next, rce-service still passes exactly one argument.
        client = _mock_client(mocker, "rce_service.docker._get_client")

        run_code("x = 1", "python", _LESSON)

        shell = client.containers.run.call_args.kwargs["command"][2]
        wrapper = shell.split(f"exec {emu.BINARY} ", 1)[1].split(" -- ", 1)[0]
        assert wrapper == f"run --config {emu.CONFIG_PATH}"


class TestEmulatorsDoNotWeakenTheSandbox:
    def test_the_lockdown_is_the_same_one_with_emulators(self, mocker):
        client = _mock_client(mocker, "rce_service.docker._get_client")

        run_code("x = 1", "python", _LESSON)

        kwargs = client.containers.run.call_args.kwargs
        assert kwargs["network_mode"] == "none"
        assert kwargs["read_only"] is True
        assert kwargs["cap_drop"] == ["ALL"]
        assert kwargs["security_opt"] == ["no-new-privileges"]
        assert kwargs["user"] == "65534:65534"
        assert "cap_add" not in kwargs

    def test_the_binary_is_the_only_addition_and_it_is_read_only(self, mocker):
        client = _mock_client(mocker, "rce_service.docker._get_client")

        run_code("x = 1", "python", _LESSON)

        volumes = client.containers.run.call_args.kwargs["volumes"]
        assert set(volumes) == {emu.BINARY_VOLUME, _PY.cache_volume}
        assert all(mount["mode"] == "ro" for mount in volumes.values())

    def test_a_request_with_no_emulators_is_the_run_it_always_was(self, mocker):
        client = _mock_client(mocker, "rce_service.docker._get_client")

        run_code("x = 1", "python")

        kwargs = client.containers.run.call_args.kwargs
        assert kwargs["volumes"] == run_phase_mounts(_PY)
        assert kwargs["environment"] == _PY.runtime_env
        assert emu.BINARY not in kwargs["command"][2]
