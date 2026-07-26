"""Tests for per-run emulator networking (Phase 0b, issue #133).

Everything is mocked — no Docker daemon. The isolation properties these tests
pin down are asserted again against a real daemon in
``tests/integration/test_infra_isolation.py``; here we prove that the *requests*
we make of Docker are the right ones, and that nothing is ever left behind.
"""

import ipaddress
from unittest.mock import MagicMock, call

import docker
import pytest
import requests

from rce_service import infra
from rce_service.config import CONTROL_PORT, INFRA_EMULATORS, INFRA_LIMITS
from rce_service.exceptions import InfraUnavailable
from rce_service.infra import (
    EmulatorSession,
    infra_session,
    resolve_infra,
    start_session,
    stop_session,
)
from rce_service.settings import settings


@pytest.fixture
def client(mocker):
    """A Docker client whose networks and containers are all MagicMocks.

    Everything it hands out is recorded on ``client.created_networks``, so a test
    can assert on the objects the code under test actually holds.
    """
    client = MagicMock()
    client.created_networks = []

    def create(name, **_):
        network = _network(name)
        client.created_networks.append(network)
        return network

    client.networks.create.side_effect = create
    mocker.patch("rce_service.infra._get_client", return_value=client)
    mocker.patch("rce_service.infra._self_container_id", return_value=None)
    mocker.patch("rce_service.infra._wait_until_ready")
    return client


def _network(name: str):
    network = MagicMock()
    network.name = name
    network.attrs = {"Containers": {}}
    return network


# ── The emulator catalogue ────────────────────────────────────────────────────


class TestResolveInfra:
    def test_no_infra_resolves_to_nothing(self):
        assert resolve_infra([]) == ([], {})

    def test_echo_gets_its_hostname_and_connection_string(self):
        assert resolve_infra(["echo"]) == (["echo"], {"ECHO_URL": "tcp://echo:7777"})

    def test_connection_strings_are_ordinary_urls_on_the_alias_hostname(self):
        # The student must not be able to tell an emulator from the real thing,
        # so every URL points at a plain hostname on the standard port.
        for name, spec in INFRA_EMULATORS.items():
            for variable, url in spec["env"].items():
                assert variable.endswith("_URL"), name
                assert f"{spec['alias']}:" in url, (name, variable)

    def test_a_lesson_can_declare_several_emulators(self):
        aliases, env = resolve_infra(["postgres", "redis"])
        assert aliases == ["db", "cache"]
        assert set(env) == {"DATABASE_URL", "REDIS_URL"}

    def test_an_unknown_emulator_fails_loudly(self):
        with pytest.raises(InfraUnavailable, match="unknown infra emulator 'kafka'"):
            resolve_infra(["kafka"])

    def test_two_emulators_on_one_hostname_fail_loudly(self):
        # postgres and mongo both answer to `db`; the second would shadow the
        # first and point DATABASE_URL at the wrong engine.
        with pytest.raises(InfraUnavailable, match="two emulators on hostname 'db'"):
            resolve_infra(["postgres", "mongo"])


# ── Harness subnet allocation ─────────────────────────────────────────────────


class TestHarnessSubnets:
    def test_blocks_are_distinct_and_inside_the_pool(self):
        blocks = [infra._harness_subnet(i) for i in range(4)]
        assert len(set(blocks)) == 4
        assert all(block.subnet_of(infra.HARNESS_POOL) for block in blocks)

    def test_a_block_has_a_gateway_and_an_emulator_address(self):
        hosts = list(infra._harness_subnet(0).hosts())
        assert len(hosts) >= 2

    def test_allocation_wraps_instead_of_leaving_the_pool(self):
        blocks_in_pool = infra.HARNESS_POOL.num_addresses // 8
        assert infra._harness_subnet(blocks_in_pool) == infra._harness_subnet(0)

    def test_a_taken_block_is_skipped(self, client):
        taken = docker.errors.APIError("Pool overlaps with other one on this address")
        client.networks.create.side_effect = [taken, _network("cannae-ctl-x")]

        network, emulator_ip = infra._create_harness_network(client, "cannae-ctl-x")

        assert network.name == "cannae-ctl-x"
        assert ipaddress.ip_address(emulator_ip) in infra.HARNESS_POOL
        assert client.networks.create.call_count == 2

    def test_a_real_docker_failure_is_not_mistaken_for_a_taken_block(self, client):
        client.networks.create.side_effect = docker.errors.APIError("daemon on fire")

        with pytest.raises(docker.errors.APIError, match="daemon on fire"):
            infra._create_harness_network(client, "cannae-ctl-x")

    def test_running_out_of_blocks_fails_loudly(self, client, mocker):
        mocker.patch.object(infra, "_SUBNET_ATTEMPTS", 3)
        client.networks.create.side_effect = docker.errors.APIError("overlaps")

        with pytest.raises(InfraUnavailable, match="no free /29"):
            infra._create_harness_network(client, "cannae-ctl-x")

    def test_the_emulator_address_is_pinned_in_the_ipam_pool(self, client):
        _, emulator_ip = infra._create_harness_network(client, "cannae-ctl-x")

        kwargs = client.networks.create.call_args.kwargs
        subnet = ipaddress.ip_network(kwargs["ipam"]["Config"][0]["Subnet"])
        assert kwargs["internal"] is True
        assert ipaddress.ip_address(emulator_ip) in subnet


# ── Reaching the control plane from the worker ────────────────────────────────


class TestWorkerAttachment:
    _MOUNTINFO = (
        "1234 25 0:52 /docker/containers/"
        + "a" * 64
        + "/resolv.conf /etc/resolv.conf rw\n"
    )

    def test_the_worker_finds_its_own_container_id(self, mocker):
        mocker.patch("pathlib.Path.read_text", return_value=self._MOUNTINFO)
        assert infra._self_container_id() == "a" * 64

    def test_a_bare_host_worker_has_no_container_id(self, mocker):
        mocker.patch("pathlib.Path.read_text", return_value="1234 25 0:52 / / rw\n")
        assert infra._self_container_id() is None

    def test_an_unreadable_mountinfo_is_treated_as_a_bare_host(self, mocker):
        mocker.patch("pathlib.Path.read_text", side_effect=OSError)
        assert infra._self_container_id() is None

    def test_a_containerised_worker_joins_the_harness_network(self, mocker):
        mocker.patch("rce_service.infra._self_container_id", return_value="cafe" * 16)
        network = _network("cannae-ctl-x")

        infra._attach_worker(network)

        network.connect.assert_called_once_with("cafe" * 16)

    def test_a_bare_host_worker_attaches_nothing(self, mocker):
        mocker.patch("rce_service.infra._self_container_id", return_value=None)
        network = _network("cannae-ctl-x")

        infra._attach_worker(network)

        network.connect.assert_not_called()


class TestReadiness:
    def test_it_returns_as_soon_as_the_control_plane_answers(self, mocker):
        get = mocker.patch("requests.get")

        infra._wait_until_ready("http://10.99.0.2:9900", "r1")

        get.assert_called_once_with("http://10.99.0.2:9900/log", timeout=1)

    def test_a_control_plane_that_never_answers_fails_loudly(self, mocker):
        mocker.patch("requests.get", side_effect=requests.exceptions.ConnectionError())
        mocker.patch.dict(INFRA_LIMITS, {"ready_timeout": 0.1})

        with pytest.raises(InfraUnavailable, match="never answered"):
            infra._wait_until_ready("http://10.99.0.2:9900", "r1")


# ── The emulator container ────────────────────────────────────────────────────


class TestEmulatorContainer:
    def test_a_missing_image_fails_loudly_instead_of_pulling(self, client):
        client.images.get.side_effect = docker.errors.ImageNotFound("nope")

        with pytest.raises(InfraUnavailable, match="is missing; build it"):
            infra._require_emulator_image(client)
        client.images.pull.assert_not_called()

    def test_the_control_plane_is_bound_to_the_harness_address_only(self, client):
        infra._start_emulator(client, "r1", ["echo"], "cannae-ctl-r1", "10.99.0.2")

        command = client.containers.run.call_args.kwargs["command"]
        assert command == [
            "--infra",
            "echo",
            "--control-bind",
            f"10.99.0.2:{CONTROL_PORT}",
        ]

    def test_it_starts_on_the_harness_network_at_its_static_address(self, client):
        infra._start_emulator(client, "r1", ["echo"], "cannae-ctl-r1", "10.99.0.2")

        kwargs = client.containers.run.call_args.kwargs
        assert kwargs["network"] == "cannae-ctl-r1"
        assert set(kwargs["networking_config"]) == {"cannae-ctl-r1"}
        client.api.create_endpoint_config.assert_called_once_with(
            ipv4_address="10.99.0.2"
        )

    def test_it_is_hardened_exactly_like_the_student_sandbox(self, client):
        infra._start_emulator(client, "r1", ["echo"], "cannae-ctl-r1", "10.99.0.2")

        kwargs = client.containers.run.call_args.kwargs
        assert kwargs["image"] == settings.cannae_image
        assert kwargs["cap_drop"] == ["ALL"]
        assert kwargs["security_opt"] == ["no-new-privileges"]
        assert kwargs["user"] == "65534:65534"
        assert kwargs["read_only"] is True
        assert kwargs["mem_limit"] == INFRA_LIMITS["memory"]
        assert kwargs["memswap_limit"] == INFRA_LIMITS["memory"]
        assert kwargs["pids_limit"] == INFRA_LIMITS["pid"]
        # A FROM scratch binary writes nothing, so it gets no writable mount.
        assert "tmpfs" not in kwargs
        assert "volumes" not in kwargs


# ── Session lifecycle ─────────────────────────────────────────────────────────


class TestStartSession:
    def test_both_networks_are_internal_and_named_for_the_run(self, client):
        session = start_session(["echo"])

        assert [n.name for n in client.created_networks] == [
            f"cannae-sbx-{session.run_id}",
            f"cannae-ctl-{session.run_id}",
        ]
        assert all(
            c.kwargs["internal"] is True for c in client.networks.create.call_args_list
        )

    def test_every_run_gets_its_own_networks(self, client):
        first, second = start_session(["echo"]), start_session(["echo"])

        assert first.run_id != second.run_id
        assert first.sandbox_network.name != second.sandbox_network.name
        assert first.harness_network.name != second.harness_network.name

    def test_the_emulator_answers_to_its_alias_on_the_sandbox_network(self, client):
        session = start_session(["echo"])

        session.sandbox_network.connect.assert_called_once_with(
            session.container, aliases=["echo"]
        )

    def test_the_session_carries_the_student_env_and_a_private_control_url(
        self, client
    ):
        session = start_session(["echo"])

        assert session.student_env == {"ECHO_URL": "tcp://echo:7777"}
        assert session.control_url.endswith(f":{CONTROL_PORT}")
        # The control URL is a harness-network address, never handed to the student.
        assert not any(
            session.control_url in value for value in session.student_env.values()
        )

    def test_the_worker_waits_for_the_control_plane_before_returning(
        self, client, mocker
    ):
        ready = mocker.patch("rce_service.infra._wait_until_ready")

        session = start_session(["echo"])

        ready.assert_called_once_with(session.control_url, session.run_id)

    def test_an_unknown_emulator_never_touches_docker(self, client):
        with pytest.raises(InfraUnavailable):
            start_session(["kafka"])

        client.networks.create.assert_not_called()

    def test_a_failure_part_way_leaves_nothing_behind(self, client, mocker):
        mocker.patch(
            "rce_service.infra._wait_until_ready",
            side_effect=InfraUnavailable("never answered"),
        )
        cleanup = mocker.patch("rce_service.infra._cleanup_container")

        with pytest.raises(InfraUnavailable):
            start_session(["echo"])

        cleanup.assert_called_once()
        assert len(client.created_networks) == 2
        for network in client.created_networks:
            network.remove.assert_called_once_with()


class TestTeardown:
    def _session(self) -> EmulatorSession:
        return EmulatorSession(
            run_id="r1",
            container=MagicMock(),
            sandbox_network=_network("cannae-sbx-r1"),
            harness_network=_network("cannae-ctl-r1"),
            control_url="http://10.99.0.2:9900",
            student_env={},
        )

    def test_it_removes_the_container_and_both_networks(self, mocker):
        cleanup = mocker.patch("rce_service.infra._cleanup_container")
        session = self._session()

        stop_session(session)

        cleanup.assert_called_once_with(session.container, "cannae-r1")
        session.sandbox_network.remove.assert_called_once_with()
        session.harness_network.remove.assert_called_once_with()

    def test_leftover_endpoints_are_detached_so_removal_can_succeed(self, mocker):
        mocker.patch("rce_service.infra._cleanup_container")
        session = self._session()
        session.harness_network.attrs = {"Containers": {"worker": {}, "other": {}}}

        stop_session(session)

        session.harness_network.disconnect.assert_has_calls(
            [call("worker", force=True), call("other", force=True)], any_order=True
        )

    def test_a_stubborn_endpoint_does_not_stop_the_sweep(self, mocker):
        mocker.patch("rce_service.infra._cleanup_container")
        session = self._session()
        session.harness_network.attrs = {"Containers": {"gone": {}}}
        session.harness_network.disconnect.side_effect = docker.errors.APIError("gone")

        stop_session(session)

        session.harness_network.remove.assert_called_once_with()

    def test_a_network_that_refuses_to_go_never_raises(self, mocker):
        mocker.patch("rce_service.infra._cleanup_container")
        session = self._session()
        session.sandbox_network.remove.side_effect = docker.errors.APIError("in use")

        stop_session(session)  # must not raise

        session.harness_network.remove.assert_called_once_with()

    def test_nothing_created_means_nothing_to_remove(self, mocker):
        cleanup = mocker.patch("rce_service.infra._cleanup_container")

        infra._tear_down(None, [None, None], "r1")

        cleanup.assert_not_called()


class TestInfraSessionContextManager:
    async def test_a_lesson_without_infra_gets_no_session(self, mocker):
        start = mocker.patch("rce_service.infra.start_session")

        async with infra_session([]) as session:
            assert session is None

        start.assert_not_called()

    async def test_the_session_is_released_even_when_the_body_raises(self, mocker):
        started = MagicMock()
        mocker.patch("rce_service.infra.start_session", return_value=started)
        stop = mocker.patch("rce_service.infra.stop_session")

        with pytest.raises(RuntimeError):
            async with infra_session(["echo"]) as session:
                assert session is started
                raise RuntimeError("body blew up")

        stop.assert_called_once_with(started)
