"""Security invariants for dependency-aware execution (SUB7 of #103) and for
per-run emulator networking (issue #133).

These tests exist to fail loudly if any constraint of the two-phase design
regresses. The invariants, from #103:

1. Student code NEVER runs during the network-on phase.
2. Install scripts are disabled (wheels-only pip, ``--ignore-scripts`` npm).
3. The run container sees the cache read-only; the installer gets no Docker
   socket.
4. The run sandbox is exactly as locked down as before deps existed.

And from #133:

5. A lesson without infra is byte-for-byte the old fully-isolated sandbox; a
   lesson with infra swaps *only* the network stack, for an ``internal`` one
   carrying nothing but its own emulator.

Everything is mocked — no Docker daemon, no network. The isolation properties of
invariant 5 are additionally proved against a real daemon, from inside a real
student container, in ``tests/integration/test_infra_isolation.py``.
"""

import base64
from unittest.mock import MagicMock

import pytest

from rce_service import docker as rce_docker
from rce_service import installer, two_phase
from rce_service.config import LIMITS, RUNTIME
from rce_service.deps import DEPS_PROVIDERS
from rce_service.deps.cache import install_phase_mounts, run_phase_mounts
from rce_service.docker import run_code
from rce_service.infra import EmulatorSession
from rce_service.install_queue import InstallQueue
from rce_service.installer import INSTALL_LIMITS, install_packages
from rce_service.two_phase import prepare_dependencies

_PY = DEPS_PROVIDERS["python"]


def _session() -> EmulatorSession:
    sandbox = MagicMock()
    sandbox.name = "cannae-sbx-r1"
    return EmulatorSession(
        run_id="r1",
        container=MagicMock(),
        sandbox_network=sandbox,
        harness_network=MagicMock(),
        control_url="http://10.99.0.2:9900",
        student_env={"ECHO_URL": "tcp://echo:7777"},
    )


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


# ── Invariant 5: infra changes the network stack and nothing else ─────────────

# Everything the run container is given that is *not* about networking. If an
# infra lesson ever differs here, the sandbox has been weakened by the back door.
_POSTURE_KEYS = [
    "read_only",
    "cap_drop",
    "security_opt",
    "user",
    "mem_limit",
    "memswap_limit",
    "pids_limit",
    "tmpfs",
    "volumes",
]


class TestInfraSandboxPosture:
    def _run(self, mocker, session):
        client = _mock_client(mocker, "rce_service.docker._get_client")
        run_code("print(1)", "python", session)
        return client.containers.run.call_args.kwargs

    def test_no_infra_keeps_the_network_stack_switched_off(self, mocker):
        kwargs = self._run(mocker, None)

        assert kwargs["network_mode"] == "none"
        assert "network" not in kwargs

    def test_infra_puts_the_student_on_the_runs_own_network(self, mocker):
        kwargs = self._run(mocker, _session())

        # `network_mode` and `network` are mutually exclusive in the Docker API,
        # so this is also proof the "none" stack is genuinely gone.
        assert kwargs["network"] == "cannae-sbx-r1"
        assert "network_mode" not in kwargs

    def test_the_lockdown_is_identical_with_and_without_infra(self, mocker):
        isolated = self._run(mocker, None)
        with_infra = self._run(mocker, _session())

        for key in _POSTURE_KEYS:
            assert isolated[key] == with_infra[key], key

    def test_the_student_gets_connection_strings_but_not_the_control_url(self, mocker):
        session = _session()

        environment = self._run(mocker, session)["environment"]

        assert environment["ECHO_URL"] == "tcp://echo:7777"
        assert environment["PYTHONPATH"] == _PY.runtime_env["PYTHONPATH"]
        assert not any(session.control_url in value for value in environment.values())

    def test_a_lesson_cannot_shadow_the_dependency_resolution_env(self, mocker):
        # student_env is lesson-authored data. If it could overwrite PYTHONPATH /
        # NODE_PATH the run container would resolve imports from somewhere we did
        # not choose, so the provider's env is applied last and wins.
        session = _session()
        session.student_env["PYTHONPATH"] = "/tmp/attacker"  # nosec B108

        environment = self._run(mocker, session)["environment"]

        assert environment["PYTHONPATH"] == _PY.runtime_env["PYTHONPATH"]
