# Example: `example_rollback.md` — the emulator teaching **transaction rollback**

Companion to [infra-emulators.md](./infra-emulators.md). This walks one lesson end-to-end so
you can see what the student writes, what the lesson author writes, and — the part the plan
left open — **exactly what `db.fail(...)` takes as arguments**.

Concept taught: *why you wrap a money transfer in a transaction*. The student learns it by
watching their own naive code destroy ₹200 when the "database" dies mid-transfer, then fixing
it. The kill is deterministic because the thing on port 5432 is the SQL emulator, not real
Postgres (see [current-problem.md](../current-problem.md)).

---

## 1. What the student sees

`db:5432` speaks the Postgres wire protocol. The student uses **real SQLAlchemy against real
psycopg2** — nothing is mocked, nothing is imported differently. Their connection string is an
ordinary env var (`DATABASE_URL=postgresql://student:student@db:5432/app`).

### Student template (what they fill in)

```python
from sqlalchemy.orm import Session, declarative_base
from sqlalchemy import Column, Integer, String, Numeric

Base = declarative_base()


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True)
    name = Column(String)
    balance = Column(Numeric(10, 2))


def send_money(
    session: Session,
    sender_id: int,
    receiver_id: int,
    amount: float,
):
    ...  # student implements this
```

### The two solutions the lesson contrasts

**Naive (passes the happy path, loses money on failure):**

```python
def send_money(session, sender_id, receiver_id, amount):
    sender = session.get(Account, sender_id)
    receiver = session.get(Account, receiver_id)

    sender.balance -= amount
    session.commit()          # ← debit committed on its own

    receiver.balance += amount
    session.commit()          # ← if the server dies before this, ₹200 is gone
```

**Correct (one transaction — both writes land or neither does):**

```python
def send_money(session, sender_id, receiver_id, amount):
    with session.begin():                 # BEGIN … COMMIT around both writes
        sender = session.get(Account, sender_id)
        receiver = session.get(Account, receiver_id)
        sender.balance -= amount
        receiver.balance += amount
```

The lesson's whole point: **both pass `test_send_money_success`. Only the correct one passes
`test_failed_transfer`.** The fault case is what separates "it works" from "it's atomic".

---

## 2. What the lesson author writes

### `infra_init` — declare the infra, seed the schema

```python
def infra_init():
    db = setup_db()          # spins the SQL emulator on :5432, control API on :9900
    db.add_table(Account)    # emits CREATE TABLE from the SQLAlchemy model → seeds the engine
    return db
```

`setup_db()` returns a **control handle** — a thin Python wrapper over the emulator's control
API (`/seed`, `/reset`, `/log`, `/faults`, `/state`). It is **not** the student's SQLAlchemy
`session`; it talks to the emulator over the harness-only network, which the student container
can't reach (Phase 0b, non-negotiable — students must not reset their own graded state).

Two distinct objects, never confused:

| Object | Whose | Speaks | Used for |
|---|---|---|---|
| `session` | student's | Postgres wire on :5432 | the code under test |
| `db` | harness's | control API on :9900 | seed, fault, assert |

### The tests

```python
def test_send_money_success(client, session):
    alice = Account(name="Alice", balance=1000)
    bob = Account(name="Bob", balance=500)
    session.add_all([alice, bob])
    session.commit()

    send_money(session, alice.id, bob.id, 200)

    session.refresh(alice)
    session.refresh(bob)
    assert alice.balance == 800
    assert bob.balance == 700


def test_failed_transfer(client, session, db):        # ← note: `db` is a fixture too
    alice = Account(name="Alice", balance=1000)
    bob = Account(name="Bob", balance=500)
    session.add_all([alice, bob])
    session.commit()

    # Arm the fault: the emulator drops the connection right after the FIRST write.
    db.fail(action="kill_connection", after="UPDATE", count=1)

    # The correct solution has BEGIN open, so the debit rolls back with the dropped
    # connection. The naive solution already committed the debit → money vanishes.
    with pytest.raises(OperationalError):             # student's driver sees the drop
        send_money(session, alice.id, bob.id, 200)

    # Assert on the EMULATOR'S state, not the student's session (its connection is dead).
    assert db.state.balance(alice.id) == 1000
    assert db.state.balance(bob.id) == 500
    assert db.state.total() == 1500                   # no money created or destroyed
```

---

## 3. The open question, decided: `db.fail(...)` arguments

The plan flagged "decide what params get sent here". Here is the contract.

`db.fail(...)` installs one declarative fault rule via `POST /faults` and returns immediately —
it **arms** the emulator; the fault **fires** later, when the student's code trips the trigger
(mechanics: plan §1, *armed on the control plane, fired on the data plane* — the control API
and the wire listener are one process sharing one fault engine). It maps one-to-one onto the
plan's fault-rule contract.

```python
db.fail(
    action="kill_connection",   # WHAT the emulator does when the trigger hits
    after="UPDATE",             # trigger: fire after an op whose type matches this
    count=1,                    # ...on the Nth matching op (1 = the first). default 1
    times=1,                    # how many times this rule may fire before it retires. default 1
    conn="any",                 # which connection(s) the rule watches. default "any"
    sqlstate=None,              # only for action="inject_error": the Postgres SQLSTATE to return
)
```

Field by field:

- **`action`** *(required)* — the fault behavior. For the SQL emulator:
  - `"kill_connection"` — drop the TCP connection mid-flight (this lesson).
  - `"inject_error"` — return a real error frame instead of executing; pair with `sqlstate`
    (`"40001"` serialization failure, `"40P01"` deadlock) to teach **retry** lessons.
  - `"delay"` — stall the response N ms (`ms=...`), for timeout/latency lessons.
- **`after`** — the trigger op type: `"UPDATE"`, `"INSERT"`, `"DELETE"`, `"SELECT"`, `"COMMIT"`,
  `"BEGIN"`. Matched against the emulator's op log as each frame is processed. `connect` and
  `disconnect` are themselves logged ops, so `after="connect"` fires the moment the student's
  driver connects — a "the DB is down" lesson is one line, no special case.
- **`count`** — fire on the *Nth* occurrence of `after` **counted from the moment the rule is
  armed**. `count=1` + `after="UPDATE"` = "right after the debit, before the credit" — the
  exact point real Postgres can't be killed at deterministically. This is the whole feature.
  Arm-time counting is also why this test is safe: the seed `INSERT`s/`COMMIT` above ran
  *before* `db.fail(...)`, so they can never trip the rule.
- **`times`** — how many times the rule is allowed to fire before it retires. `times=1` (default)
  = one-shot. Set `times=2` for "the retry also fails" scenarios (the rule keeps firing on
  subsequent matches until `times` is spent).
- **`conn`** — which connection(s) the rule watches: `"any"` (default — safe because of
  arm-time counting; note the seeded `session` here already holds its connection, so "next
  connection" would never see the `UPDATE`), `"next"` (only the connection opened next after
  arming), or a `conn_id` from `/log` for multi-connection lessons.
- **`sqlstate`** — only meaningful with `action="inject_error"`; the Postgres SQLSTATE string the
  emulator returns so the student's driver raises the same exception it would in production.
  On the wire, protocol-specific extras like this travel in a `params` bag the generic fault
  engine never interprets — it hands them to the SQL emulator's action handler.

Why these and not fewer: `action` + `after` + `count` are the irreducible core — *what* happens,
*on which kind of op*, *at which occurrence*. `times`, `conn`, and `sqlstate` all earn their
place from a concrete lesson (retry-that-also-fails, multi-connection deadlock, teach-the-real-
exception), per the plan's "feature requests must cite a lesson" rule.

The raw wire this call produces:

```json
{"emulator": "sql", "action": "kill_connection",
 "after": {"op_matches": "UPDATE", "count": 1}, "times": 1, "conn": "any"}
```

---

## 4. How grading actually reads the result

Two independent signals, both from the emulator — neither trusts the student's return value:

1. **State assertion** (`GET /state`) — did the invariant hold? `db.state.total() == 1500` proves
   money was conserved. The naive solution fails here: it left ₹800 in Alice and never credited
   Bob → total ₹1300, ₹200 destroyed.
2. **Op-log assertion** (`GET /log`) — did they do it *for the right reason*? This is the signal
   a real DB can't give you:

   ```python
   db.oplog.assert_order("BEGIN", "UPDATE", "UPDATE", "COMMIT")
   ```

   The correct solution's log shows `BEGIN` before the first `UPDATE`. The naive solution's log
   shows a bare `UPDATE` + `COMMIT`, then the connection dies before the second pair — no
   enclosing transaction. The grader can therefore tell the student *precisely* what went wrong:

   > "Your transfer debited Alice but the server crashed before crediting Bob, and ₹200
   > vanished. Your SQL log shows no `BEGIN` before the first `UPDATE` — the two writes weren't
   > in one transaction. Wrap them in `session.begin()`."

That teachable message — not a stack trace — is what `send_money` grading surfaces (plan §7).

---

