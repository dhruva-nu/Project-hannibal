"""The Phase 0b acceptance test: real Docker, real networks, real sockets (#133).

This is the test the isolation argument rests on. Everything it asserts is
asserted **from inside a student container** — the only vantage point that
proves anything about what a student can reach.

Needs a Docker daemon and the emulator image, so it is gated:

    docker build -t cannae-service:latest ../cannae-service
    RCE_INFRA_SMOKE=1 uv run pytest tests/integration/test_infra_isolation.py -q
"""

import json
import os

import pytest
import requests

from rce_service.config import CONTROL_PORT
from rce_service.docker import run_code
from rce_service.infra import start_session, stop_session

pytestmark = pytest.mark.skipif(
    os.environ.get("RCE_INFRA_SMOKE") != "1",
    reason="needs Docker + the cannae image; set RCE_INFRA_SMOKE=1 to run",
)

PREFIX = ">> "

# Short enough that every probe fits inside the sandbox's 10s wall clock, long
# enough that a *slow* route is not mistaken for a blocked one.
PROBE_TIMEOUT = 1.5

# Runs in the sandbox. Speaks to the emulator exactly as a lesson would — read
# the connection string from the environment, open a socket — then tries every
# route to the control plane and to the outside world, and reports what happened.
PROBE = f"""
import json, os, socket

TIMEOUT = {PROBE_TIMEOUT}


def reachable(host, port):
    try:
        with socket.create_connection((host, port), TIMEOUT):
            return True
    except OSError:
        return False


host, port = os.environ["ECHO_URL"].removeprefix("tcp://").split(":")
echoes = []
sock = socket.create_connection((host, int(port)), TIMEOUT)
for index in range(3):
    try:
        sock.sendall(f"line{{index}}\\n".encode())
        reply = sock.recv(4096)
    except OSError:
        reply = b""
    if not reply:
        echoes.append("<closed>")
        break
    echoes.append(reply.decode().strip())

try:
    socket.gethostbyname("example.com")
    dns = True
except OSError:
    dns = False

print(json.dumps({{
    "echoes": echoes,
    "control_via_hostname": reachable(host, {CONTROL_PORT}),
    "control_via_harness_ip": reachable("HARNESS_IP", {CONTROL_PORT}),
    "control_via_sandbox_ip": reachable("SANDBOX_IP", {CONTROL_PORT}),
    "neighbour_emulator": reachable("NEIGHBOUR_IP", int(port)),
    "internet": reachable("1.1.1.1", 443),
    "dns": dns,
}}))
"""


def _sandbox_ip(session) -> str:
    """The emulator's address on the run's sandbox network — the one route the
    student genuinely has to it."""
    session.container.reload()
    networks = session.container.attrs["NetworkSettings"]["Networks"]
    return networks[session.sandbox_network.name]["IPAddress"]


def _probe_for(session, neighbour_ip: str) -> str:
    harness_ip = session.control_url.removeprefix("http://").split(":")[0]
    return (
        PROBE.replace("HARNESS_IP", harness_ip)
        .replace("SANDBOX_IP", _sandbox_ip(session))
        .replace("NEIGHBOUR_IP", neighbour_ip)
    )


def _seed(session) -> None:
    requests.post(
        f"{session.control_url}/seed",
        json={"emulator": "echo", "prefix": PREFIX},
        timeout=5,
    ).raise_for_status()


def _arm_kill_on_second_echo(session) -> None:
    requests.post(
        f"{session.control_url}/faults",
        json={
            "emulator": "echo",
            "action": "kill_connection",
            "after": {"op_matches": "ECHO", "count": 2},
            "times": 1,
        },
        timeout=5,
    ).raise_for_status()


def _control(session, path: str, **params) -> object:
    response = requests.get(f"{session.control_url}{path}", params=params, timeout=5)
    response.raise_for_status()
    return response.json()


@pytest.fixture
def echo_run():
    session = start_session(["echo"])
    try:
        yield session
    finally:
        stop_session(session)


@pytest.fixture
def neighbour_run():
    """A second, unrelated run — the one this run must not be able to see."""
    session = start_session(["echo"])
    try:
        yield session
    finally:
        stop_session(session)


def test_the_sandbox_reaches_only_its_own_emulator(echo_run, neighbour_run):
    """Phase 0's definition of done, across the real network topology.

    Harness seeds echo and arms a fault; student code connects by hostname and
    echoes; the fault fires mid-conversation; the harness reads the op log — all
    while the student can reach nothing else at all.
    """
    _seed(echo_run)
    _arm_kill_on_second_echo(echo_run)
    neighbour_ip = _sandbox_ip(neighbour_run)

    result = run_code(_probe_for(echo_run, neighbour_ip), "python", echo_run)

    assert result["exit_code"] == 0, result["stderr"]
    report = json.loads(result["stdout"])

    # The emulator answered on an ordinary hostname, then the armed fault killed
    # the connection on the second op — exactly where the rule said it would.
    assert report["echoes"] == [f"{PREFIX}line0", "<closed>"]

    # Nothing else is reachable: not the control plane by any route, not the
    # neighbouring run, not the internet.
    assert report["control_via_hostname"] is False
    assert report["control_via_harness_ip"] is False
    assert report["control_via_sandbox_ip"] is False
    assert report["neighbour_emulator"] is False
    assert report["internet"] is False
    assert report["dns"] is False

    # The harness, meanwhile, sees the whole conversation.
    log = _control(echo_run, "/log", emulator="echo")
    assert [record["op"] for record in log] == [
        "connect",
        "ECHO",
        "ECHO",
        "disconnect",
    ]
    assert log[2]["fault"] == "kill_connection"
    assert _control(echo_run, "/state", emulator="echo") == {
        "echo_count": 1,
        "prefix": PREFIX,
    }


def test_the_neighbouring_run_saw_none_of_it(echo_run, neighbour_run):
    """No inter-run leakage in either direction: the neighbour's log stays empty
    even though a student container was hammering its address."""
    _seed(echo_run)
    _seed(neighbour_run)

    run_code(_probe_for(echo_run, _sandbox_ip(neighbour_run)), "python", echo_run)

    assert _control(neighbour_run, "/log", emulator="echo") == []


def test_a_lesson_without_infra_is_still_fully_isolated():
    """The unchanged path: no session, no network stack, nothing reachable."""
    code = (
        "import socket\n"
        "try:\n"
        "    socket.create_connection(('1.1.1.1', 443), 1.5)\n"
        "    print('REACHED')\n"
        "except OSError:\n"
        "    print('ISOLATED')\n"
    )

    result = run_code(code, "python")

    assert result["exit_code"] == 0, result["stderr"]
    assert result["stdout"].strip() == "ISOLATED"


def test_the_control_plane_is_not_listening_on_the_sandbox_interface(echo_run):
    """The mechanism behind the probe above, stated directly: `--control-bind`
    puts :9900 on the harness address and nowhere else."""
    binding = f"{echo_run.control_url.removeprefix('http://')}"

    command = echo_run.container.attrs["Config"]["Cmd"]

    assert command[-2:] == ["--control-bind", binding]
    assert "0.0.0.0" not in binding


def test_teardown_removes_the_networks():
    session = start_session(["echo"])
    names = [session.sandbox_network.name, session.harness_network.name]

    stop_session(session)

    from rce_service.docker import _get_client

    remaining = {network.name for network in _get_client().networks.list()}
    assert not remaining & set(names)
