"""The harness half of a compatibility suite: the control plane, and the assertions.

Every script in this directory plays two roles at once. It is the **harness** — seeding
state, arming fault rules, and grading from `/state` and the op log — and it is the
**student**, whose code runs against the data plane through a real, unmodified client
library.

This module is the harness half, and it is shared because it is identical for every
client and every emulator. The student half is what differs, and that is the half worth
writing once per client: `psycopg2` interpolating parameters into a simple query is a
genuinely different thing to prove than `node-postgres` pipelining an extended one.

Nothing here touches a data plane. That asymmetry is the point — the control plane is
reachable only from the harness network, never from a student's sandbox.
"""

import json
import os
import urllib.error
import urllib.request

CONTROL = os.environ.get("CANNAE_CONTROL", "http://127.0.0.1:9900")
HOST = os.environ.get("CANNAE_HOST", "127.0.0.1")


def port(variable: str, default: int) -> int:
    """A data-plane port, overridable so a suite can run beside the real thing."""
    return int(os.environ.get(variable, str(default)))


def control(method: str, path: str, body: dict | None = None):
    """Call the harness-only control plane.

    A rejection is fatal rather than returned: a suite that seeded badly must fail where
    it seeded, not three assertions later against state it never loaded.
    """
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{CONTROL}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"control {method} {path} failed: {error.code} {error.read().decode()}")
    return json.loads(payload) if payload else None


def reset() -> None:
    control("POST", "/reset")


def seed(emulator: str, body: dict) -> None:
    control("POST", "/seed", {"emulator": emulator, **body})


def arm(emulator: str, rule: dict) -> None:
    control("POST", "/faults", {"emulator": emulator, **rule})


def log(emulator: str) -> list[dict]:
    return control("GET", f"/log?emulator={emulator}")


def state(emulator: str) -> dict:
    return control("GET", f"/state?emulator={emulator}")


def ops(emulator: str, lesson_ops) -> list[str]:
    """The ops the student's own code issued, in order.

    Client libraries chatter — `CLIENT SETINFO` on connect, `parse`/`bind`/`sync` around
    every statement — and the op log records all of it faithfully. A grader filters to
    the ops the lesson is about, which is what `lesson_ops` names.
    """
    return [record["op"] for record in log(emulator) if record["op"] in lesson_ops]


def expect(actual, wanted, what: str) -> None:
    if actual != wanted:
        raise SystemExit(f"FAIL {what}\n  expected: {wanted!r}\n  actual:   {actual!r}")
    print(f"  ok  {what}")


def run_stages(banner: str, stages, name: str) -> int:
    """Run each stage in order, announcing it. Returns a process exit code."""
    print(banner)
    for stage in stages:
        print(f"{stage.__name__}:")
        stage()
    print(f"{name} compatibility suite passed")
    return 0
