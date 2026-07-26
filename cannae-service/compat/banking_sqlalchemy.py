#!/usr/bin/env python3
"""Blessed-client compatibility suite: `SQLAlchemy` (on psycopg2), unmodified.

An ORM is a harder compatibility test than a driver, and for a specific reason: it
fires **introspection probes on connect** before it will run a single line of the
lesson's SQL (`plans/infra-emulators.md` §11 names this as the top compat risk). If
`select pg_catalog.version()` or `show standard_conforming_strings` is unanswered,
`engine.connect()` raises and no lesson runs at all.

It also drives transactions through its own unit-of-work machinery rather than by
sending `BEGIN` — so this suite proves the emulator's transaction tracking survives a
layer that decides for itself when a block opens and closes.

**Reflection is out of scope.** The tables here are declared, not autoloaded: reflecting
means answering the `pg_catalog` shape queries, which nothing in the lesson plan needs.
A lesson that wants reflection is a new entry in the catalog stub list, grown from the
failure — never guessed at.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from decimal import Decimal

import sqlalchemy
from sqlalchemy import (
    CheckConstraint,
    Column,
    Integer,
    MetaData,
    Numeric,
    Table,
    Text,
    create_engine,
    select,
    text,
)
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError

CONTROL = os.environ.get("CANNAE_CONTROL", "http://127.0.0.1:9900")
HOST = os.environ.get("CANNAE_HOST", "127.0.0.1")
PORT = int(os.environ.get("CANNAE_SQL_PORT", "5432"))
URL = f"postgresql+psycopg2://student:student@{HOST}:{PORT}/app"

LESSON_OPS = {"BEGIN", "COMMIT", "ROLLBACK", "SELECT", "INSERT", "UPDATE", "DELETE"}

metadata = MetaData()
accounts = Table(
    "accounts",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("owner", Text, nullable=False, unique=True),
    Column("balance", Numeric(12, 2), nullable=False),
    CheckConstraint("balance >= 0"),
)

SCHEMA = """
CREATE TABLE accounts (
    id      SERIAL PRIMARY KEY,
    owner   TEXT NOT NULL UNIQUE,
    balance NUMERIC(12,2) NOT NULL CHECK (balance >= 0)
)
"""

OPENING_BALANCES = [
    {"owner": "ada", "balance": "1000.00"},
    {"owner": "grace", "balance": "500.00"},
]


def control(method, path, body=None):
    """Call the harness-only control plane. Never reachable from a student sandbox."""
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


def log():
    return control("GET", "/log?emulator=sql")


def lesson_ops():
    return [record["op"] for record in log() if record["op"] in LESSON_OPS]


def state():
    return control("GET", "/state?emulator=sql")


def balance(owner):
    for row in state()["tables"]["accounts"]:
        if row["owner"] == owner:
            return Decimal(row["balance"])
    raise SystemExit(f"FAIL no account for {owner}")


def total():
    return sum(Decimal(row["balance"]) for row in state()["tables"]["accounts"])


def seed():
    control("POST", "/reset")
    control("POST", "/seed", {
        "emulator": "sql",
        "schema": [SCHEMA],
        "rows": {"accounts": OPENING_BALANCES},
    })


def new_engine():
    """`pool_size=1` keeps a scenario on one connection, so `conn="next"` scoping and the
    op log's per-connection ordering mean what a lesson says they mean."""
    return create_engine(URL, pool_size=1, max_overflow=0)


def fresh_bank(faults=()):
    """Warm an engine, *then* set the scene: seed, arm, and hand it back.

    The warm-up is the interesting part. SQLAlchemy initialises its dialect on an
    engine's first connection — the version, schema and isolation-level probes, each
    wrapped in its own transaction by psycopg2 — and that is real traffic the op log
    records faithfully. A lesson's grading assertions are about the statements the
    *student's* code issued, so the engine is brought up and its pool disposed before
    the log is reset. That is also how it looks in production: a connection pool is
    already warm by the time a request arrives.

    `/reset` retires every live socket, which is why the pool is disposed rather than
    kept — the next connection is a fresh one, on a rewound connection counter.
    """
    engine = new_engine()
    with engine.connect():
        pass
    engine.dispose()

    seed()
    for rule in faults:
        control("POST", "/faults", {"emulator": "sql", **rule})
    return engine


def expect(actual, wanted, what):
    if actual != wanted:
        raise SystemExit(f"FAIL {what}\n  expected: {wanted!r}\n  actual:   {actual!r}")
    print(f"  ok  {what}")


# ---------------------------------------------------------------------------
# The lesson's target implementation, written the SQLAlchemy way.
# ---------------------------------------------------------------------------


def transfer_money(engine, sender, recipient, amount):
    """The correct implementation: `engine.begin()` is the transaction block."""
    with engine.begin() as connection:
        connection.execute(
            accounts.update()
            .where(accounts.c.owner == sender)
            .values(balance=accounts.c.balance - amount)
        )
        connection.execute(
            accounts.update()
            .where(accounts.c.owner == recipient)
            .values(balance=accounts.c.balance + amount)
        )


def transfer_money_without_a_transaction(engine, sender, recipient, amount):
    """What a student writes first: each statement commits on its own."""
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.execute(
            accounts.update()
            .where(accounts.c.owner == sender)
            .values(balance=accounts.c.balance - amount)
        )
        connection.execute(
            accounts.update()
            .where(accounts.c.owner == recipient)
            .values(balance=accounts.c.balance + amount)
        )


# ---------------------------------------------------------------------------
# Stages.
# ---------------------------------------------------------------------------


def connects_at_all():
    """The stage that fails first when a catalog probe is missing.

    `engine.connect()` runs SQLAlchemy's dialect initialisation — the version, schema and
    `standard_conforming_strings` probes. Everything below depends on it.
    """
    seed()
    engine = new_engine()
    with engine.connect() as connection:
        expect(connection.execute(text("SELECT 1")).scalar(), 1, "the dialect initialised")
        expect(
            engine.dialect.server_version_info,
            (15, 0),
            "SQLAlchemy read the server version off the handshake",
        )
        expect(
            connection.execute(text("select current_schema()")).scalar(),
            "public",
            "and the default schema",
        )


def smoke():
    """The query surface, expressed as SQLAlchemy Core rather than SQL strings."""
    engine = fresh_bank()
    with engine.connect() as connection:
        rows = connection.execute(
            select(accounts.c.owner, accounts.c.balance).order_by(accounts.c.id)
        ).all()
        expect(
            [tuple(row) for row in rows],
            [("ada", Decimal("1000.00")), ("grace", Decimal("500.00"))],
            "a Core select decodes NUMERIC as an exact Decimal",
        )

        one = connection.execute(
            select(accounts.c.balance).where(accounts.c.owner == "ada")
        ).scalar()
        expect(one, Decimal("1000.00"), "a bound parameter narrows the query")

        result = connection.execute(
            accounts.insert().values(owner="turing", balance="250.00")
        )
        expect(result.rowcount, 1, "an insert reports its rowcount")
        expect(
            connection.execute(sqlalchemy.func.count().select().select_from(accounts)).scalar(),
            3,
            "count() sees the new row inside the transaction",
        )
        connection.rollback()
        expect(total(), Decimal("1500.00"), "and the rollback undid it")


def happy_path():
    """(a) and (c): the transfer works, and the log proves a transaction wrapped it."""
    engine = fresh_bank()
    transfer_money(engine, "ada", "grace", "100.00")

    expect(balance("ada"), Decimal("900.00"), "the sender was debited")
    expect(balance("grace"), Decimal("600.00"), "the recipient was credited")
    expect(total(), Decimal("1500.00"), "a transfer moves money, it does not make it")
    expect(
        lesson_ops(),
        ["BEGIN", "UPDATE", "UPDATE", "COMMIT"],
        "SQLAlchemy's unit of work becomes a real BEGIN/COMMIT on the wire",
    )
    expect(
        [r["args"]["in_transaction"] for r in log() if r["op"] == "UPDATE"],
        [True, True],
        "each write is logged with the transaction state it ran under",
    )


def crash_between_the_two_writes():
    """(b) The scripted crash, through an ORM's transaction handling."""
    crash = [{
        "action": "kill_connection",
        "after": {"op_matches": "UPDATE", "count": 2},
        "conn": "next",
    }]

    engine = fresh_bank(faults=crash)
    try:
        transfer_money(engine, "ada", "grace", "100.00")
    except (OperationalError, DBAPIError) as error:
        expect(error.connection_invalidated, True, "SQLAlchemy invalidates the dead connection")
    else:
        raise SystemExit("FAIL the crash must surface to SQLAlchemy")

    expect(total(), Decimal("1500.00"), "money is neither created nor destroyed")
    expect(balance("ada"), Decimal("1000.00"), "the debit rolled back with the connection")

    engine = fresh_bank(faults=crash)
    try:
        transfer_money_without_a_transaction(engine, "ada", "grace", "100.00")
    except (OperationalError, DBAPIError):
        pass
    expect(balance("ada"), Decimal("900.00"), "without a transaction, the debit stuck")
    expect(total(), Decimal("1400.00"), "100.00 was destroyed by the crash")


def retryable_errors():
    """A scripted serialization failure and the retry that answers it."""
    engine = fresh_bank(faults=[{
        "action": "inject_error",
        "after": {"op_matches": "UPDATE", "count": 1},
        "params": {"sqlstate": "40001"},
    }])
    try:
        transfer_money(engine, "ada", "grace", "100.00")
    except DBAPIError as error:
        expect(error.orig.pgcode, "40001", "the SQLSTATE reaches through SQLAlchemy intact")
    else:
        raise SystemExit("FAIL an injected 40001 must raise")

    expect(total(), Decimal("1500.00"), "the poisoned transaction changed nothing")
    transfer_money(engine, "ada", "grace", "100.00")
    expect(balance("ada"), Decimal("900.00"), "the retry succeeds")


def constraint_errors():
    """A constraint violation must arrive as SQLAlchemy's own `IntegrityError`."""
    engine = fresh_bank()
    with engine.connect() as connection:
        try:
            connection.execute(
                accounts.update().where(accounts.c.owner == "ada").values(balance="-1.00")
            )
        except IntegrityError as error:
            expect(error.orig.pgcode, "23514", "an overdraft is a CHECK violation")
        else:
            raise SystemExit("FAIL an overdraft must raise IntegrityError")
        connection.rollback()

        try:
            connection.execute(accounts.insert().values(owner="ada", balance="1.00"))
        except IntegrityError as error:
            expect(error.orig.pgcode, "23505", "a duplicate owner is a unique violation")
        else:
            raise SystemExit("FAIL a duplicate must raise IntegrityError")
        connection.rollback()

    expect(total(), Decimal("1500.00"), "and nothing was written")


def main():
    print(f"SQLAlchemy {sqlalchemy.__version__} → {URL}")
    for stage in (
        connects_at_all,
        smoke,
        happy_path,
        crash_between_the_two_writes,
        retryable_errors,
        constraint_errors,
    ):
        print(f"{stage.__name__}:")
        stage()

    print("SQLAlchemy compatibility suite passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
