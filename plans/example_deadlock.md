# Example: `example_deadlock.md` — the emulator teaching **deadlock & retry**

Companion to [infra-emulators.md](./infra-emulators.md) and [example_rollback.md](./example_rollback.md).
This walks one lesson end-to-end so you can see what the student writes, what the lesson author
writes, and — reusing the `db.fail(...)` contract from the rollback doc — **how a deadlock is
made deterministic instead of flaky**.

Concept taught: *two transactions that lock the same two rows in opposite orders deadlock, and
the loser must retry*. The student learns it by watching their own naive code hang two
connections against each other, get one killed with SQLSTATE `40P01`, and crash — then fixing it
with canonical lock ordering plus a retry loop. The deadlock is deterministic because the thing
on port 5432 is the SQL emulator, not real Postgres (see [current-problem.md](../current-problem.md)),
so the same test never flakes.

---

## 1. What the student sees

`db:5432` speaks the Postgres wire protocol. The student uses **real SQLAlchemy against real
psycopg2** — nothing is mocked, nothing is imported differently. Their connection string is an
ordinary env var (`DATABASE_URL=postgresql://student:student@db:5432/app`).

Same `Account` model as the rollback lesson — Alice and Bob, balances in ₹.

### Student template (what they fill in)

```python
from sqlalchemy.orm import Session, declarative_base
from sqlalchemy import Column, Integer, String, Numeric, select

Base = declarative_base()


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True)
    name = Column(String)
    balance = Column(Numeric(10, 2))


def transfer_between(
    session: Session,
    a_id: int,
    b_id: int,
    amount: float,
):
    ...  # student implements this — lock both accounts, then move the money
```

### The two solutions the lesson contrasts

**Naive (locks in caller-supplied order → deadlocks under concurrency):**

```python
def transfer_between(session, a_id, b_id, amount):
  pass

```

Two callers — `transfer_between(s1, alice, bob, 100)` and `transfer_between(s2, bob, alice, 50)`
— lock in opposite orders. Each holds one row and waits for the other → cycle. One connection
gets `40P01` and, with no retry, the whole transfer crashes.

**Correct (canonical lock order + retry on `40P01`):**

```python
from sqlalchemy.exc import OperationalError

def transfer_between(session, a_id, b_id, amount):
    lo, hi = sorted((a_id, b_id))            # ALWAYS lock lower id first — no cycle possible
    for attempt in range(3):
        try:
            with session.begin():
                accounts = {
                    acc.id: acc
                    for acc in session.execute(
                        select(Account).where(Account.id.in_((lo, hi)))
                        .order_by(Account.id).with_for_update()
                    ).scalars()
                }
                accounts[a_id].balance -= amount
                accounts[b_id].balance += amount
            return
        except OperationalError as e:
            session.rollback()
            if _sqlstate(e) == "40P01" and attempt < 2:
                continue                     # deadlock victim → retry the whole txn
            raise
```

The lesson's whole point: **both pass `test_transfer_success`. Only the correct one passes
`test_deadlock_is_retried`.** Canonical ordering makes the cycle impossible in the first place;
the retry loop is the belt-and-braces that survives a deadlock the emulator forces anyway.

---

## 2. What the lesson author writes

### `infra_init` — declare the infra, seed the schema

```python
def infra_init():
    db = setup_db()          # spins the SQL emulator on :5432, control API on :9900
    db.add_table(Account)    # emits CREATE TABLE from the SQLAlchemy model → seeds the engine
    return db
```

`setup_db()` returns the same **control handle** described in [example_rollback.md](./example_rollback.md#2-what-the-lesson-author-writes)
— a thin wrapper over the emulator's control API (`/seed`, `/reset`, `/log`, `/faults`,
`/state`) reachable only from the harness network, never the student container.

Two distinct objects, never confused:

| Object | Whose | Speaks | Used for |
|---|---|---|---|
| `session` | student's | Postgres wire on :5432 | the code under test |
| `db` | harness's | control API on :9900 | seed, fault, assert |

### The tests

```python
def test_transfer_success(client, session):
    alice = Account(name="Alice", balance=1000)
    bob = Account(name="Bob", balance=500)
    session.add_all([alice, bob])
    session.commit()

    transfer_between(session, alice.id, bob.id, 200)

    session.refresh(alice)
    session.refresh(bob)
    assert alice.balance == 800
    assert bob.balance == 700


def test_deadlock_is_retried(client, session, db):        # ← `db` is a fixture too
    alice = Account(name="Alice", balance=1000)
    bob = Account(name="Bob", balance=500)
    session.add_all([alice, bob])
    session.commit()

    # Arm the fault: the first UPDATE on the next connection loses the deadlock and
    # comes back with Postgres SQLSTATE 40P01 — exactly what a real victim would see.
    db.fail(action="inject_error", sqlstate="40P01", after="UPDATE", count=1)

    # Correct solution catches 40P01, rolls back, and retries — succeeds on attempt 2.
    # Naive solution has no retry → the OperationalError propagates and it crashes.
    transfer_between(session, alice.id, bob.id, 200)

    # Assert on the EMULATOR'S state — the source of truth for both connections.
    assert db.state.balance(alice.id) == 800
    assert db.state.balance(bob.id) == 700
    assert db.state.total() == 1500                       # no money created or destroyed
```

---

## 3. The fault, decided: reuse `db.fail(...)`, `inject_error` + `sqlstate="40P01"`

No new API. This lesson is entirely covered by the `db.fail(...)` contract already defined in
[example_rollback.md §3](./example_rollback.md#3-the-open-question-decided-dbfail-arguments):

```python
db.fail(action="inject_error", sqlstate="40P01", after="UPDATE", count=1)
```

- **`action="inject_error"`** — instead of executing the op, the emulator returns a real Postgres
  error frame, so the student's driver raises the same `OperationalError` it would in production.
- **`sqlstate="40P01"`** — the Postgres **`deadlock_detected`** SQLSTATE. (Its sibling `40001`,
  `serialization_failure`, drives the same retry lesson under `SERIALIZABLE` isolation — swap the
  string, same fault.) The student's code branches on this exact string, so teaching the real
  SQLSTATE matters.
- **`after="UPDATE", count=1`** — fire on the first write, i.e. the moment the transaction would
  actually be chosen as the deadlock victim.

### Two mechanisms; this lesson uses the simpler one

The plan (§4) lists both `kill inside transaction` and `inject_error (… 40001/40P01)` as SQL
faults. There are two ways to produce a deadlock:

1. **`inject_error` (what this lesson uses).** The emulator doesn't need to *observe* a real lock
   cycle — the harness simply *declares* "the next UPDATE is the victim" and returns `40P01`.
   Deterministic by construction, one line of setup, and it exercises exactly the code path that
   matters: catch → rollback → retry. This is the whole point of protocol emulation — we script
   the failure instead of racing for it.
2. **Real two-connection lock-cycle detection (stretch).** The emulator's engine could track
   `SELECT … FOR UPDATE` row locks per connection, detect a genuine A-waits-B-waits-A cycle
   across two live student connections, and kill the victim on its own — no `db.fail` at all.
   This is more faithful (it also *catches* a student whose canonical-ordering fix is wrong) but
   it needs a lock table + wait-for graph in the engine. **Deferred**: it's the only way to grade
   "did canonical ordering actually prevent the cycle?", so it lands when a lesson needs that
   assertion. Until then, `inject_error` grades the retry behavior, which is the concept here.

Because we reuse the existing signature, no new parameters are introduced — consistent with the
rollback doc and the plan's "feature requests must cite a lesson" rule.

The raw wire this call produces:

```json
{"emulator": "sql", "action": "inject_error",
 "after": {"op_matches": "UPDATE", "count": 1}, "times": 1, "conn": "any",
 "params": {"sqlstate": "40P01"}}
```

(`sqlstate` rides in the `params` bag — the generic fault engine matches the trigger and
hands `params` to the SQL emulator, whose `encode_error` builds the real Postgres
`ErrorResponse` frame. The op is logged but not executed. See plan §1, *the kit/protocol
seam*.)

---

## 4. How grading actually reads the result

Two independent signals, both from the emulator — neither trusts the student's return value:

1. **State assertion** (`GET /state`) — did the money move correctly *and* survive the deadlock?
   `db.state.balance(alice.id) == 800`, `db.state.balance(bob.id) == 700`, and
   `db.state.total() == 1500` prove the transfer completed exactly once after the retry. The
   naive solution never reaches this — it crashes on the un-caught `40P01`, leaving balances
   untouched (`1000 / 500`).
2. **Op-log assertion** (`GET /log`) — did they *retry for the right reason*? This is the signal a
   real DB can't give you deterministically:

   ```python
   db.oplog.assert_order(
       "BEGIN", "UPDATE",        # first attempt — this UPDATE is the injected 40P01 victim
       "ROLLBACK",               # student caught the deadlock and rolled back
       "BEGIN", "UPDATE", "UPDATE", "COMMIT",   # retry — same transaction, this time it lands
   )
   ```

   The correct solution's log shows the failed `UPDATE`, a `ROLLBACK`, then a **fresh `BEGIN`**
   and the writes again → a real retry. The naive solution's log stops at the first
   `UPDATE`/`ROLLBACK` with no second `BEGIN` — no retry. The grader can therefore tell the
   student precisely what went wrong:

   > "Your transfer hit a deadlock (SQLSTATE `40P01`) and gave up. The database picked your
   > transaction as the victim and rolled it back — that's normal and expected under contention.
   > Your SQL log shows no second `BEGIN` after the rollback: you never retried. Catch
   > `OperationalError`, check for `40P01`, and re-run the transaction."

That teachable message — not a stack trace — is what `transfer_between` grading surfaces (plan §7).

---

