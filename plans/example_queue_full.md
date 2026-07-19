# Example: `example_queue_full.md` — the emulator teaching **bounded queues & back-pressure**

Companion to [infra-emulators.md](./infra-emulators.md) (Phase 4, AMQP 0-9-1) and
[current-problem.md](../current-problem.md). Sibling of
[example_rollback.md](./example_rollback.md) — same shape: what the student writes, what the
lesson author writes, and the part worth deciding — **how "the queue is full" is expressed**.

Concept taught: *a queue has a bottom, and a producer must not pretend it doesn't.* The student
learns it by watching their fire-and-forget producer silently drop jobs into the void when the
queue fills, then fixing it to respect back-pressure. The full-queue signal is deterministic
because the thing on port 5672 is the queue emulator, not real RabbitMQ.

---

## 1. What the student sees

`queue:5672` speaks AMQP 0-9-1. The student uses **real `pika`** — nothing is mocked, nothing is
imported differently. Their connection string is an ordinary env var
(`AMQP_URL=amqp://guest:guest@queue:5672/`).

The queue `jobs` is declared **bounded**: `x-max-length=2` with `x-overflow=reject-publish`. In
real RabbitMQ, that combination means: once the queue holds its max, the broker **rejects** new
publishes rather than dropping the oldest message. Under **publisher confirms**, a rejected
publish comes back as a `basic.nack` — the producer's `pika` call sees the rejection. The
emulator reproduces exactly this: full queue + confirms on → the publish is nacked.

### Student template (what they fill in)

```python
import pika


def enqueue_job(channel: pika.channel.Channel, payload: str) -> bool:
    """Publish one job onto the `jobs` queue.

    Returns True if the broker accepted (confirmed) the job, False if it was
    rejected because the queue is full. Must never silently lose a job.
    """
    ...  # student implements this
```

### The two solutions the lesson contrasts

**Naive (passes the happy path, drops jobs on a full queue):**

```python
def enqueue_job(channel, payload):
    channel.basic_publish(
        exchange="",
        routing_key="jobs",
        body=payload,
    )
    return True                    # ← lies. Never checked whether the broker took it.
```

Fire-and-forget. With no publisher confirms, `basic_publish` returns nothing meaningful; the
producer reports success for a job the full queue rejected. ₹200 worth of "charge the customer"
jobs evaporate and nobody knows.

**Correct (publisher confirms — surfaces the rejection instead of losing it):**

```python
def enqueue_job(channel, payload):
    try:
        channel.basic_publish(
            exchange="",
            routing_key="jobs",
            body=payload,
            mandatory=True,
        )
        return True                # broker sent basic.ack → job is safely queued
    except pika.exceptions.NackError:
        return False               # broker sent basic.nack → queue full, caller must handle
```

The channel is put in confirm mode (`channel.confirm_delivery()`) during setup, so each publish
blocks for the broker's ack/nack. A full queue yields a `NackError`; the producer reports the
truth and the caller can block, retry, or back-pressure upstream.

The lesson's whole point: **both pass `test_enqueue_when_room`. Only the correct one passes
`test_enqueue_when_full`.** The bounded queue is what separates "it published" from "it was
actually accepted".

---

## 2. What the lesson author writes

### `infra_init` — declare the infra, seed the **bounded** queue

```python
def infra_init():
    queue = setup_queue()                      # spins the AMQP emulator on :5672, control API on :9900
    queue.declare("jobs", max_length=2, overflow="reject-publish")
    return queue
```

`setup_queue()` returns a **control handle** — a thin Python wrapper over the emulator's control
API (`/seed`, `/reset`, `/log`, `/faults`, `/state`). It is **not** the student's `pika` channel;
it talks to the emulator over the harness-only network, which the student container can't reach
(Phase 0b, non-negotiable — students must not reset their own graded state).

Two distinct objects, never confused:

| Object | Whose | Speaks | Used for |
|---|---|---|---|
| `channel` | student's | AMQP 0-9-1 on :5672 | the code under test |
| `queue` | harness's | control API on :9900 | seed, fault, assert |

**Design note — queue-full is a *declaration* property, not a fault.** Unlike the rollback
lesson (where "kill mid-transaction" only exists as an injected fault), a full queue is what a
bounded queue *does on its own* once you publish faster than anything drains it. So the max
length lives in `queue.declare(...)` at seed time, and the queue fills naturally as the producer
publishes. No fault injection is needed to *create* the condition.

We still lean on one control-API affordance to make the edge **deterministic**: there is no
consumer in this lesson, so the queue never drains — the Nth publish that crosses `max_length` is
always the one that gets nacked, every run, byte-for-byte. If a future lesson needs the queue to
fill *despite* a consumer, use the fault API the same shape as the rollback doc:

```python
queue.fail(action="pause_consumers")   # stop delivery so the queue backs up deterministically
```

We do **not** use it here — declaring `max_length=2` with no consumer is simpler and already
deterministic. (Feature requests must cite a lesson; this one doesn't need `pause_consumers`.)

### The tests

```python
def test_enqueue_when_room(client, channel):
    # Queue max is 2, currently empty → both jobs fit.
    assert enqueue_job(channel, "charge:alice:200") is True
    assert enqueue_job(channel, "charge:bob:200") is True


def test_enqueue_when_full(client, channel, queue):        # ← `queue` is a fixture too
    # Fill the queue to its max (2). No consumer runs, so nothing drains it.
    assert enqueue_job(channel, "charge:alice:200") is True
    assert enqueue_job(channel, "charge:bob:200") is True

    # The third publish crosses max_length → broker nacks it (reject-publish).
    accepted = enqueue_job(channel, "charge:carol:200")

    # Correct solution: returned False (saw the nack). Naive solution: returned True (lied).
    assert accepted is False

    # Assert on the EMULATOR'S state — the queue never overflowed and no job was lost track of.
    assert queue.state.depth("jobs") == 2                  # never exceeded max_length
    assert queue.state.published_ok("jobs") == 2           # exactly the two that fit
    assert queue.state.rejected("jobs") == 1               # the third, accounted for — not vanished
    assert queue.state.published_ok("jobs") + queue.state.rejected("jobs") == 3   # == attempted
```

---

## 3. How "the queue is full" is expressed (the decided contract)

Two levers, and this lesson deliberately uses only the first:

**1. Declaration (used here) — `queue.declare(name, max_length=..., overflow=...)`**

Installs a bounded queue at seed time via `POST /seed`. Maps one-to-one onto the AMQP
`Queue.Declare` arguments table the emulator already parses:

```python
queue.declare(
    "jobs",
    max_length=2,               # x-max-length: the queue holds at most this many ready messages
    overflow="reject-publish",  # x-overflow: on overflow, NACK the publish (vs "drop-head")
)
```

Raw seed this produces:

```json
{"emulator": "queue", "op": "declare", "queue": "jobs",
 "arguments": {"x-max-length": 2, "x-overflow": "reject-publish"}}
```

Field by field:

- **`max_length`** — the `x-max-length` argument. The bound. The whole lesson exists because this
  number is finite. `2` keeps the test tiny and the crossing point obvious.
- **`overflow`** — the `x-overflow` argument. `"reject-publish"` nacks the offending publish (the
  back-pressure behaviour the lesson teaches). The alternative `"drop-head"` silently evicts the
  oldest message — a *different* lesson (data loss under load) we can author later by flipping
  this one field.

Under publisher confirms, `reject-publish` surfaces to `pika` as a `basic.nack` → `NackError`.
That is the entire signal the correct producer keys off.

**2. Fault API (available, not used here) — `queue.fail(action="pause_consumers")`**

Same shape as `db.fail(...)` in the rollback doc — though `pause_consumers` is an
**immediate** action (applied at install time, no trigger to arm). Only needed when a lesson
has a live consumer and you must still force the queue to back up deterministically. This lesson has no consumer, so
the queue never drains and the declaration alone is fully deterministic — no fault required.

Why this split: a full queue is a property of the queue, not an injected anomaly, so it belongs
in `declare`, right where a real deployment would set `x-max-length`. The fault API stays
reserved for genuinely *injected* conditions (redelivery, pre-ack connection drop), per the
plan's Phase 4 fault list.

---

## 4. How grading actually reads the result

Two independent signals, both from the emulator — neither trusts the student's return value:

1. **State assertion** (`GET /state`) — did the queue honour its bound and is every job
   accounted for? `depth("jobs") == 2` proves the queue never exceeded `max_length`.
   `published_ok + rejected == attempted` proves **no job silently vanished**: every publish
   either landed or was explicitly rejected. The naive solution fails here indirectly — it
   *reported* 3 successes while the emulator only accepted 2, so the harness catches the lie by
   comparing the student's claimed successes against `published_ok`.
2. **Op-log assertion** (`GET /log`) — did the producer *observe* the broker's verdict, or ignore
   it? This is the signal a fire-and-forget publish can't fake:

   ```python
   queue.oplog.assert_order("Basic.Publish", "Basic.Nack")   # the reject reached the producer
   queue.oplog.confirm_mode("jobs") is True                  # channel was in confirm mode
   ```

   The correct solution's log shows the channel entered confirm mode and a `Basic.Nack` was
   emitted for the third publish. The naive solution's log shows `Basic.Publish` with **no
   confirm frames at all** — the producer never asked whether the broker took the job. The grader
   can therefore tell the student *precisely* what went wrong:

   > "Your producer reported 3 jobs enqueued, but the queue only accepted 2 — the third was
   > rejected because the queue was full, and you dropped it on the floor. Your channel never
   > entered confirm mode, so `basic_publish` never told you the broker said no. Call
   > `channel.confirm_delivery()` and handle the `NackError`."

That teachable message — not a silent data-loss bug that surfaces in production — is what
`enqueue_job` grading surfaces.

---

## 5. Fixtures this example assumes (for the harness authors)

```python
@pytest.fixture
def queue():
    handle = infra_init()        # starts emulator, declares the bounded `jobs` queue
    yield handle
    handle.reset()               # POST /reset restores the seeded snapshot between cases

@pytest.fixture
def channel(queue):
    conn = pika.BlockingConnection(pika.URLParameters(os.environ["AMQP_URL"]))  # → queue:5672
    ch = conn.channel()
    ch.confirm_delivery()        # publisher confirms on — the correct solution depends on this
    yield ch
    conn.close()
```

`reset()` between tests is why `test_enqueue_when_room` and `test_enqueue_when_full` don't leak
depth into each other — the same snapshot/reset path the plan lists in the control API table.
