#!/usr/bin/env python3
"""Blessed-client compatibility suite: `psycopg2`, unmodified, against the emulator.

Two things are being proved at once:

1. **Compatibility** — a real driver connects and operates without knowing it is not
   talking to Postgres. Nothing here is emulator-aware except the harness calls, which
   stand in for what the grader does; the connection is a plain `postgresql://` DSN.
2. **The banking milestone lesson** (#135) — `transfer_money()` is graded the way the
   harness grades it: from `/state` and the op log, not from what the driver returned.

Its siblings run the same lesson through SQLAlchemy (`banking_sqlalchemy.py`) and
node-postgres (`banking.mjs`).
"""

import json
import os
import sys
import urllib.error
import urllib.request
from decimal import Decimal

import psycopg2
import psycopg2.errorcodes

CONTROL = os.environ.get("CANNAE_CONTROL", "http://127.0.0.1:9900")
HOST = os.environ.get("CANNAE_HOST", "127.0.0.1")
PORT = int(os.environ.get("CANNAE_SQL_PORT", "5432"))
DSN = f"postgresql://student:student@{HOST}:{PORT}/app"

#: Drivers chatter on connect and around every transaction (`startup`, `parse`, `bind`,
#: `sync`). That is real traffic and the log records it faithfully; a grader cares about
#: the statements the student's own code issued, so it filters to these.
LESSON_OPS = {"BEGIN", "COMMIT", "ROLLBACK", "SELECT", "INSERT", "UPDATE", "DELETE"}

#: What a dropped connection looks like to psycopg2: the statement in flight fails with
#: `OperationalError`, and anything attempted on the connection afterwards — including
#: the commit `with connection:` tries on the way out — is an `InterfaceError`.
CRASHED = (psycopg2.OperationalError, psycopg2.InterfaceError)

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
    """One account's balance from `/state`, as an exact decimal.

    The emulator reports `NUMERIC` as a string precisely so this can be exact — a JSON
    number is a double, and money in a double is how a bank loses a paisa.
    """
    rows = state()["tables"]["accounts"]
    for row in rows:
        if row["owner"] == owner:
            return Decimal(row["balance"])
    raise SystemExit(f"FAIL no account for {owner} in {rows}")


def total():
    """Every rupee in the bank — the invariant a transfer must preserve."""
    return sum(Decimal(row["balance"]) for row in state()["tables"]["accounts"])


def fresh_bank(faults=()):
    """Reset, seed, arm any rules — *then* connect.

    Order matters and mirrors the lesson flow: `/reset` retires every live socket, so a
    connection made before it would find itself dropped. The harness always sets the
    scene before the student's code runs.
    """
    control("POST", "/reset")
    control("POST", "/seed", {
        "emulator": "sql",
        "schema": [SCHEMA],
        "rows": {"accounts": OPENING_BALANCES},
    })
    for rule in faults:
        control("POST", "/faults", {"emulator": "sql", **rule})
    return psycopg2.connect(DSN)


def expect(actual, wanted, what):
    if actual != wanted:
        raise SystemExit(f"FAIL {what}\n  expected: {wanted!r}\n  actual:   {actual!r}")
    print(f"  ok  {what}")


# ---------------------------------------------------------------------------
# The lesson's target implementation, written the way a student writes it. No
# emulator awareness anywhere — just psycopg2.
# ---------------------------------------------------------------------------


def transfer_money(connection, sender, recipient, amount):
    """The correct implementation: both writes inside one transaction."""
    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE accounts SET balance = balance - %s WHERE owner = %s",
                (amount, sender),
            )
            cursor.execute(
                "UPDATE accounts SET balance = balance + %s WHERE owner = %s",
                (amount, recipient),
            )


def transfer_money_without_a_transaction(connection, sender, recipient, amount):
    """What a student writes first: two independent statements, each auto-committed."""
    connection.autocommit = True
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE accounts SET balance = balance - %s WHERE owner = %s",
            (amount, sender),
        )
        cursor.execute(
            "UPDATE accounts SET balance = balance + %s WHERE owner = %s",
            (amount, recipient),
        )


# ---------------------------------------------------------------------------
# Stages.
# ---------------------------------------------------------------------------


def smoke():
    """The SQL surface a banking lesson needs, through the driver's own API."""
    connection = fresh_bank()
    connection.autocommit = True
    with connection.cursor() as cursor:
        cursor.execute("SELECT owner, balance FROM accounts ORDER BY id")
        expect(
            cursor.fetchall(),
            [("ada", Decimal("1000.00")), ("grace", Decimal("500.00"))],
            "SELECT decodes NUMERIC as an exact Decimal",
        )
        expect(cursor.rowcount, 2, "rowcount comes from CommandComplete")

        cursor.execute("SELECT balance FROM accounts WHERE owner = %s", ("ada",))
        expect(cursor.fetchone(), (Decimal("1000.00"),), "a parameterised SELECT")

        cursor.execute(
            "INSERT INTO accounts (owner, balance) VALUES (%s, %s) RETURNING id",
            ("turing", "250.00"),
        )
        expect(cursor.fetchone(), (3,), "INSERT ... RETURNING hands back the new id")

        cursor.execute("UPDATE accounts SET balance = balance + 1 WHERE owner = 'turing'")
        expect(cursor.rowcount, 1, "UPDATE reports the rows it changed")
        cursor.execute("DELETE FROM accounts WHERE owner = 'turing'")
        expect(cursor.rowcount, 1, "DELETE reports the rows it removed")

        cursor.execute("SELECT count(*) FROM accounts")
        expect(cursor.fetchone(), (2,), "count(*) is an integer")
        cursor.execute("SELECT balance FROM accounts WHERE owner = 'nobody'")
        expect(cursor.fetchall(), [], "an empty result set is empty, not an error")

    # Connection introspection reads the parameters the handshake sent.
    expect(connection.get_dsn_parameters()["dbname"], "app", "the connection knows its database")
    expect(connection.encoding, "UTF8", "client_encoding came from the handshake")


def happy_path():
    """(a) The transfer works, and the op log shows it was done the safe way."""
    connection = fresh_bank()
    transfer_money(connection, "ada", "grace", "100.00")

    expect(balance("ada"), Decimal("900.00"), "the sender was debited")
    expect(balance("grace"), Decimal("600.00"), "the recipient was credited")
    expect(total(), Decimal("1500.00"), "a transfer moves money, it does not make it")

    # (c) The grading signal: not "is the answer right" but "did they do it the way that
    # survives a crash". Both writes must sit inside the transaction block.
    expect(
        lesson_ops(),
        ["BEGIN", "UPDATE", "UPDATE", "COMMIT"],
        "both writes sit between BEGIN and COMMIT",
    )
    writes = [record for record in log() if record["op"] == "UPDATE"]
    expect(
        [record["args"]["in_transaction"] for record in writes],
        [True, True],
        "each write is logged with the transaction state it ran under",
    )
    expect(
        [record["args"]["tables"] for record in writes],
        [["accounts"], ["accounts"]],
        "and with the table it touched",
    )


def crash_between_the_two_writes():
    """(b) The scripted crash. With a transaction, money survives it."""
    crash = [{
        "action": "kill_connection",
        # The *second* UPDATE: the debit has already happened and the credit never will.
        "after": {"op_matches": "UPDATE", "count": 2},
        "conn": "next",
    }]

    connection = fresh_bank(faults=crash)
    try:
        transfer_money(connection, "ada", "grace", "100.00")
    except CRASHED as error:
        # Exactly what a real mid-statement crash raises: the statement fails with
        # `OperationalError`, and psycopg2's `with connection:` then cannot commit or
        # roll back, so the block exits with `InterfaceError`. The student's code sees a
        # dropped connection, not an emulator.
        print(f"  ok  the driver raises {type(error).__name__}, as a real crash would")
    else:
        raise SystemExit("FAIL the crash must surface to the driver")

    expect(total(), Decimal("1500.00"), "money is neither created nor destroyed")
    expect(balance("ada"), Decimal("1000.00"), "the debit rolled back with the connection")
    expect(balance("grace"), Decimal("500.00"), "and the credit never happened")

    # The other half of the lesson: the same crash without a transaction destroys money,
    # reproducibly. This is what the lesson exists to show.
    connection = fresh_bank(faults=crash)
    try:
        transfer_money_without_a_transaction(connection, "ada", "grace", "100.00")
    except CRASHED:
        pass
    expect(balance("ada"), Decimal("900.00"), "the debit committed on its own")
    expect(balance("grace"), Decimal("500.00"), "the credit never ran")
    expect(total(), Decimal("1400.00"), "100.00 was destroyed by the crash")


def retryable_errors():
    """A scripted serialization failure, and the retry that answers it."""
    connection = fresh_bank(faults=[{
        "action": "inject_error",
        "after": {"op_matches": "UPDATE", "count": 1},
        "params": {"sqlstate": "40001"},
    }])
    try:
        transfer_money(connection, "ada", "grace", "100.00")
    except psycopg2.errors.SerializationFailure as error:
        expect(
            error.pgcode,
            psycopg2.errorcodes.SERIALIZATION_FAILURE,
            "the driver maps the SQLSTATE to its own exception class",
        )
    else:
        raise SystemExit("FAIL an injected 40001 must raise SerializationFailure")

    connection.rollback()
    expect(total(), Decimal("1500.00"), "the poisoned transaction changed nothing")

    # The rule has retired, so the student's retry is the code path the lesson teaches.
    transfer_money(connection, "ada", "grace", "100.00")
    expect(balance("ada"), Decimal("900.00"), "the retry succeeds")


def transaction_state():
    """The transaction status byte, read through psycopg2's own view of it."""
    from psycopg2.extensions import (
        TRANSACTION_STATUS_IDLE,
        TRANSACTION_STATUS_INERROR,
        TRANSACTION_STATUS_INTRANS,
    )

    connection = fresh_bank()
    status = connection.get_transaction_status
    expect(status(), TRANSACTION_STATUS_IDLE, "a fresh connection is idle")

    cursor = connection.cursor()
    cursor.execute("SELECT 1")
    expect(status(), TRANSACTION_STATUS_INTRANS, "psycopg2 opened a block for the query")

    try:
        cursor.execute("SELECT * FROM does_not_exist")
    except psycopg2.errors.UndefinedTable as error:
        expect(error.pgcode, "42P01", "an unknown table is 42P01")
    expect(status(), TRANSACTION_STATUS_INERROR, "the block is poisoned")

    # Everything but ROLLBACK is refused until the block ends — the behaviour a lesson
    # about error handling inside transactions turns on.
    try:
        cursor.execute("SELECT 1")
    except psycopg2.errors.InFailedSqlTransaction as error:
        expect(error.pgcode, "25P02", "a statement in a failed block is 25P02")
    else:
        raise SystemExit("FAIL a poisoned block must refuse further statements")

    connection.rollback()
    expect(status(), TRANSACTION_STATUS_IDLE, "ROLLBACK clears it")
    cursor.execute("SELECT 1")
    expect(cursor.fetchone(), (1,), "and the connection is usable again")


def constraint_errors():
    """A student's mistake raises the driver's own exception, with the real SQLSTATE."""
    connection = fresh_bank()
    connection.autocommit = True
    cursor = connection.cursor()

    cases = [
        ("UPDATE accounts SET balance = -1 WHERE owner = 'ada'",
         psycopg2.errors.CheckViolation, "23514", "an overdraft trips the CHECK"),
        ("INSERT INTO accounts (owner, balance) VALUES ('ada', 1)",
         psycopg2.errors.UniqueViolation, "23505", "a duplicate owner is a unique violation"),
        ("INSERT INTO accounts (owner, balance) VALUES (NULL, 1)",
         psycopg2.errors.NotNullViolation, "23502", "a null owner is a not-null violation"),
        ("SELECT nope FROM accounts",
         psycopg2.errors.UndefinedColumn, "42703", "an unknown column is 42703"),
    ]
    for sql, exception, sqlstate, what in cases:
        try:
            cursor.execute(sql)
        except exception as error:
            expect(error.pgcode, sqlstate, what)
        else:
            raise SystemExit(f"FAIL {sql} must raise {exception.__name__}")

    expect(total(), Decimal("1500.00"), "and nothing was written")
    cursor.execute("SELECT 1")
    expect(cursor.fetchone(), (1,), "the connection survives every error")


def main():
    print(f"psycopg2 {psycopg2.__version__.split()[0]} → {DSN}")
    for stage in (
        smoke,
        happy_path,
        crash_between_the_two_writes,
        retryable_errors,
        transaction_state,
        constraint_errors,
    ):
        print(f"{stage.__name__}:")
        stage()

    print("psycopg2 compatibility suite passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
