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
#: reply is a typed frame; `pgwire` is Postgres protocol v3, which needs a handshake
#: before it will take a query at all. The pool remembers this per socket, so the page
#: only ever sends text.
LINE_PROTOCOL = "line"
RESP_PROTOCOL = "resp"
PG_PROTOCOL = "pgwire"
PROTOCOLS = (LINE_PROTOCOL, RESP_PROTOCOL, PG_PROTOCOL)


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
        try:
            # Postgres will not take a query until it has been through startup, so the
            # handshake happens here rather than on the page's first send.
            if protocol == PG_PROTOCOL:
                _pg_startup(sock)
        except BaseException:
            sock.close()
            raise
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
            if protocol == PG_PROTOCOL:
                sock.sendall(_pg_message(b"Q", _cstr(text)))
                return {"reply": _read_pg_reply(sock), "closed": False}
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


# ---------------------------------------------------------------------------
# Postgres wire protocol v3. Enough of it to be the student: start up, send a simple
# query, and render the reply the way `psql` renders it — including the transaction
# status byte, which is what the banking lesson turns on.
# ---------------------------------------------------------------------------

#: Protocol version 3.0, the only one the emulator speaks.
PG_VERSION = 196_608

#: What the dashboard connects as. The emulator uses trust auth, so these are only
#: what `current_user` / `current_database()` will report back.
PG_IDENTITY = {"user": "student", "database": "app", "application_name": "cannae-dashboard"}

#: The transaction status byte in every `ReadyForQuery`, spelled out for the page.
PG_STATUS = {"I": "idle", "T": "in transaction", "E": "transaction aborted"}


def _cstr(text: str) -> bytes:
    return text.encode() + b"\0"


def _pg_message(tag: bytes, body: bytes) -> bytes:
    """One frontend message: tag, then a length that counts itself, then the body."""
    return tag + (len(body) + 4).to_bytes(4, "big") + body


def _pg_startup(sock: socket.socket) -> None:
    """Complete the handshake, leaving the connection ready for a query."""
    sock.settimeout(CONNECT_TIMEOUT)
    body = PG_VERSION.to_bytes(4, "big")
    for key, value in PG_IDENTITY.items():
        body += _cstr(key) + _cstr(value)
    body += b"\0"
    sock.sendall((len(body) + 4).to_bytes(4, "big") + body)
    # Drain the authentication, parameters and key data down to the first ready.
    _read_pg_messages(sock)


def _read_pg_messages(sock: socket.socket) -> list[tuple[str, bytes]]:
    """Read `(tag, body)` until `ReadyForQuery`, which closes every exchange."""
    messages = []
    while True:
        header = _read_exact(sock, 5)
        length = int.from_bytes(header[1:5], "big")
        body = _read_exact(sock, length - 4) if length > 4 else b""
        tag = chr(header[0])
        messages.append((tag, body))
        if tag == "Z":
            return messages


def _read_pg_reply(sock: socket.socket) -> str:
    return _render_pg(_read_pg_messages(sock))


def _render_pg(messages: list[tuple[str, bytes]]) -> str:
    """Render one exchange the way `psql` would, plus the transaction status.

    The status line is not decoration: `idle` / `in transaction` / `transaction
    aborted` is the emulator's own transaction tracking, and seeing it move is how you
    check a fault did what the lesson claims.
    """
    lines: list[str] = []
    columns: list[str] = []
    rows: list[list[str]] = []
    for tag, body in messages:
        if tag == "T":
            columns, rows = _pg_columns(body), []
        elif tag == "D":
            rows.append(_pg_row(body))
        elif tag == "C":
            if columns:
                lines.extend(_pg_table(columns, rows))
                columns, rows = [], []
            lines.append(_first_cstr(body))
        elif tag == "I":
            lines.append("(empty query)")
        elif tag in ("E", "N"):
            fields = _pg_fields(body)
            label = "error" if tag == "E" else "warning"
            lines.append(f"({label}) {fields.get('C', '')} {fields.get('M', '')}".strip())
        elif tag == "Z":
            status = chr(body[0]) if body else "?"
            lines.append(f"-- {PG_STATUS.get(status, status)}")
    return "\n".join(lines)


def _pg_columns(body: bytes) -> list[str]:
    """`RowDescription`: a count, then per column a name and 18 bytes of type metadata."""
    names = []
    at = 2
    for _ in range(int.from_bytes(body[:2], "big")):
        end = body.index(b"\0", at)
        names.append(body[at:end].decode(errors="replace"))
        at = end + 1 + 18
    return names


def _pg_row(body: bytes) -> list[str]:
    """`DataRow`. A NULL is length -1, which stays distinguishable from an empty value."""
    values = []
    at = 2
    for _ in range(int.from_bytes(body[:2], "big")):
        length = int.from_bytes(body[at : at + 4], "big", signed=True)
        at += 4
        if length < 0:
            values.append("(null)")
            continue
        values.append(body[at : at + length].decode(errors="replace"))
        at += length
    return values


def _pg_fields(body: bytes) -> dict[str, str]:
    """An `ErrorResponse` / `NoticeResponse`: `type byte + value`, ending in a zero."""
    fields = {}
    at = 0
    while at < len(body) and body[at] != 0:
        kind = chr(body[at])
        value = _first_cstr(body[at + 1 :])
        fields[kind] = value
        at += 1 + len(value.encode()) + 1
    return fields


def _pg_table(columns: list[str], rows: list[list[str]]) -> list[str]:
    """A result set as an aligned table, so a multi-column row stays readable."""
    widths = [
        max(len(column), *(len(row[index]) for row in rows)) if rows else len(column)
        for index, column in enumerate(columns)
    ]
    header = " | ".join(column.ljust(widths[index]) for index, column in enumerate(columns))
    rule = "-+-".join("-" * width for width in widths)
    body = [
        " | ".join(value.ljust(widths[index]) for index, value in enumerate(row))
        for row in rows
    ]
    plural = "" if len(rows) == 1 else "s"
    return [header, rule, *body, f"({len(rows)} row{plural})"]


def _first_cstr(body: bytes) -> str:
    end = body.index(b"\0") if b"\0" in body else len(body)
    return body[:end].decode(errors="replace")


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
        except SocketClosed:
            # A handshake the emulator hung up on — an `after="connect"` fault, most
            # likely, which is a legitimate thing to be testing.
            self._send_json(502, {"error": "the emulator closed the connection during the handshake"})
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
