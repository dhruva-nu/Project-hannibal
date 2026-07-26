#!/usr/bin/env python3
"""A manual test dashboard for a running cannae-service.

Two things a browser cannot do on its own: talk to the control plane across an
origin it does not own, and open a raw TCP connection to a data plane. This script
supplies both — it serves the dashboard page, proxies the control API under `/api`,
and keeps a pool of real client sockets the page drives as if it were the student.

It runs on the host, never inside the emulator image. The shipped binary is a
static scratch build destined for a network-isolated student sandbox; a debug UI
and a TCP client belong nowhere near it.

Usage:
    python3 tools/dashboard.py [--control http://127.0.0.1:9900] [--port 8080]
"""

import argparse
import json
import shlex
import socket
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PAGE = Path(__file__).with_name("dashboard.html")
CONNECT_TIMEOUT = 3.0
CONTROL_TIMEOUT = 10.0

#: How a connection frames what the page types. `line` is echo's newline framing;
#: `resp` is the cache's RESP2, where a command is an array of bulk strings and a
#: reply is a typed frame. The pool remembers this per socket, so the page only ever
#: sends text.
LINE_PROTOCOL = "line"
RESP_PROTOCOL = "resp"
PROTOCOLS = (LINE_PROTOCOL, RESP_PROTOCOL)


class SocketClosed(Exception):
    """The emulator hung up — a killed connection, which is a normal outcome here."""


class NoSuchSocket(Exception):
    """The page referenced a connection this pool never opened or already closed."""


class SocketPool:
    """Live client connections to a data plane, addressed by the ids the page holds.

    Ids are handed out in open order and never reused, so a stale id from the page
    fails loudly instead of landing on somebody else's connection.
    """

    def __init__(self) -> None:
        self._sockets: dict[int, socket.socket] = {}
        self._targets: dict[int, tuple[int, str]] = {}
        self._next_id = 1
        self._lock = threading.Lock()

    def open(self, host: str, port: int, protocol: str) -> int:
        if protocol not in PROTOCOLS:
            raise ValueError(f"unknown protocol {protocol!r}; expected one of {PROTOCOLS}")
        sock = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT)
        with self._lock:
            handle = self._next_id
            self._next_id += 1
            self._sockets[handle] = sock
            self._targets[handle] = (port, protocol)
        return handle

    def send(self, handle: int, text: str, read_timeout: float) -> dict:
        """Send one command and read one reply. Reports a hangup rather than raising."""
        sock, protocol = self._require(handle)
        sock.settimeout(read_timeout)
        try:
            if protocol == RESP_PROTOCOL:
                argv = shlex.split(text)
                if not argv:
                    return {"reply": None, "closed": False, "error": "empty command"}
                sock.sendall(_encode_resp(argv))
                return {"reply": _read_resp(sock), "closed": False}
            sock.sendall(f"{text}\n".encode())
            return {"reply": _read_line(sock), "closed": False}
        except SocketClosed:
            self.close(handle)
            return {"reply": None, "closed": True}
        except TimeoutError:
            return {"reply": None, "closed": False, "timeout": read_timeout}
        except ValueError as error:
            # A malformed frame or an unbalanced quote — the socket is still fine.
            return {"reply": None, "closed": False, "error": str(error)}
        except OSError as error:
            self.close(handle)
            return {"reply": None, "closed": True, "error": str(error)}

    def close(self, handle: int) -> None:
        with self._lock:
            sock = self._sockets.pop(handle, None)
            self._targets.pop(handle, None)
        if sock is not None:
            sock.close()

    def listing(self) -> list[dict]:
        with self._lock:
            return [
                {"id": handle, "port": port, "protocol": protocol}
                for handle, (port, protocol) in sorted(self._targets.items())
            ]

    def _require(self, handle: int) -> tuple[socket.socket, str]:
        with self._lock:
            sock = self._sockets.get(handle)
            target = self._targets.get(handle)
        if sock is None or target is None:
            raise NoSuchSocket(f"connection {handle} is not open")
        return sock, target[1]


def _read_line(sock: socket.socket) -> str:
    """Read one newline-terminated reply. Byte-at-a-time: correct beats fast here."""
    buffer = bytearray()
    while not buffer.endswith(b"\n"):
        chunk = sock.recv(1)
        if not chunk:
            raise SocketClosed
        buffer += chunk
    return buffer.decode(errors="replace").rstrip("\r\n")


def _read_exact(sock: socket.socket, count: int) -> bytes:
    buffer = bytearray()
    while len(buffer) < count:
        chunk = sock.recv(count - len(buffer))
        if not chunk:
            raise SocketClosed
        buffer += chunk
    return bytes(buffer)


def _encode_resp(argv: list[str]) -> bytes:
    """A command as RESP2: an array of bulk strings, which is all any client sends."""
    frame = bytearray(f"*{len(argv)}\r\n".encode())
    for arg in argv:
        raw = arg.encode()
        frame += f"${len(raw)}\r\n".encode() + raw + b"\r\n"
    return bytes(frame)


def _read_resp(sock: socket.socket) -> str:
    """One RESP2 reply, rendered the way `redis-cli` renders it.

    The type tag is the point: a lesson turns on telling a nil apart from an empty
    string, so the reply is shown as `(nil)` / `""` rather than flattened to text.
    """
    header = _read_line(sock)
    if not header:
        raise ValueError("empty RESP frame")
    tag, rest = header[0], header[1:]
    if tag == "+":
        return rest
    if tag == "-":
        return f"(error) {rest}"
    if tag == ":":
        return f"(integer) {rest}"
    if tag == "$":
        length = int(rest)
        if length < 0:
            return "(nil)"
        payload = _read_exact(sock, length + 2)[:length]
        return '"' + payload.decode(errors="replace") + '"'
    if tag == "*":
        count = int(rest)
        if count < 0:
            return "(nil)"
        if count == 0:
            return "(empty array)"
        items = [_read_resp(sock) for _ in range(count)]
        return "\n".join(f"{index}) {item}" for index, item in enumerate(items, 1))
    raise ValueError(f"unknown RESP type tag in {header!r}")


class Dashboard(BaseHTTPRequestHandler):
    control_url: str
    data_host: str
    pool: SocketPool

    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler's contract
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/socket/list":
            self._send_json(200, {"connections": self.pool.listing()})
        elif self.path.startswith("/api/"):
            self._proxy("GET")
        else:
            self._send_json(404, {"error": f"no route for GET {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/socket/"):
            self._socket_command()
        elif self.path.startswith("/api/"):
            self._proxy("POST")
        else:
            self._send_json(404, {"error": f"no route for POST {self.path}"})

    def do_DELETE(self) -> None:  # noqa: N802
        if self.path.startswith("/api/"):
            self._proxy("DELETE")
        else:
            self._send_json(404, {"error": f"no route for DELETE {self.path}"})

    def log_message(self, format: str, *args) -> None:
        """Silence per-request logging — the page polls, and the noise buries errors."""

    def _socket_command(self) -> None:
        body = self._read_body_json()
        try:
            if self.path == "/socket/open":
                handle = self.pool.open(
                    self.data_host,
                    int(body["port"]),
                    body.get("protocol", LINE_PROTOCOL),
                )
                self._send_json(200, {"id": handle})
            elif self.path == "/socket/send":
                result = self.pool.send(
                    int(body["id"]), body.get("line", ""), float(body.get("timeout", 3))
                )
                self._send_json(200, result)
            elif self.path == "/socket/close":
                self.pool.close(int(body["id"]))
                self._send_json(200, {"closed": True})
            else:
                self._send_json(404, {"error": f"no route for {self.path}"})
        except NoSuchSocket as error:
            self._send_json(409, {"error": str(error)})
        except (KeyError, ValueError, TypeError) as error:
            self._send_json(400, {"error": f"bad request: {error}"})
        except OSError as error:
            self._send_json(502, {"error": f"connect failed: {error}"})

    def _proxy(self, method: str) -> None:
        """Forward to the control plane so the page stays same-origin (no CORS)."""
        url = self.control_url + self.path[len("/api") :]
        body = self._read_body_bytes()
        request = urllib.request.Request(
            url,
            data=body or None,
            method=method,
            headers={"content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=CONTROL_TIMEOUT) as response:
                self._send(response.status, response.read(), "application/json")
        except urllib.error.HTTPError as error:
            self._send(error.code, error.read(), "application/json")
        except urllib.error.URLError as error:
            self._send_json(
                502, {"error": f"control plane unreachable: {error.reason}"}
            )

    def _read_body_bytes(self) -> bytes:
        length = int(self.headers.get("content-length") or 0)
        return self.rfile.read(length) if length else b""

    def _read_body_json(self) -> dict:
        raw = self._read_body_bytes()
        return json.loads(raw) if raw else {}

    def _send_json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload).encode(), "application/json")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--control", default="http://127.0.0.1:9900")
    parser.add_argument("--data-host", default="127.0.0.1")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    Dashboard.control_url = args.control.rstrip("/")
    Dashboard.data_host = args.data_host
    Dashboard.pool = SocketPool()

    server = ThreadingHTTPServer((args.host, args.port), Dashboard)
    print(f"cannae dashboard on http://{args.host}:{args.port}")
    print(f"proxying control plane at {Dashboard.control_url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")


if __name__ == "__main__":
    main()
