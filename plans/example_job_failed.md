# Example: `example_job_failed.md` — the emulator teaching **at-least-once delivery**

Companion to [infra-emulators.md](./infra-emulators.md) (Phase 4, AMQP 0-9-1) and
[current-problem.md](../current-problem.md). Sibling to
[example_rollback.md](./example_rollback.md). This walks one queue lesson end-to-end so you can
see what the student writes, what the lesson author writes, and — the part the plan left open —
**exactly what `queue.fail(...)` takes as arguments**.

Concept taught: *why a queue consumer must be idempotent*. A queue promises **at-least-once**
delivery: if a worker dies after doing the work but before acking, the broker requeues the
message with `redelivered=1` and hands it to the next worker. The student learns it by watching
their own naive consumer charge a customer ₹200 **twice**, then fixing it. The redelivery is
deterministic because the thing on port 5672 is the queue emulator, not real RabbitMQ.

---

## 1. What the student sees

`queue:5672` speaks AMQP 0-9-1. The student uses **real `pika`** — nothing is mocked, nothing is
imported differently. Their connection string is an ordinary env var
(`AMQP_URL=amqp://guest:guest@queue:5672/`).

### Student template (what they fill in)

```python
import pika

def process_payment(
    channel: pika.channel.Channel,
    method: pika.spec.Basic.Deliver,
    properties: pika.spec.BasicProperties,
    body: bytes,
):
    ...  # student implements this callback
```

The message body is JSON: `{"payment_id": "pay_abc", "customer": "alice", "amount": 200}`.
The `payment_id` is stable across a redelivery — the same logical payment carries the same id.

### The two solutions the lesson contrasts

**Naive (acks correctly, but charges twice on redelivery):**

```python
def process_payment(channel, method, properties, body):
    msg = json.loads(body)

    charge_customer(msg["customer"], msg["amount"])   # ← side-effect, no idempotency guard

    channel.basic_ack(delivery_tag=method.delivery_tag)   # acks only after the work — good...
```

Acking after the work is right. But nothing stops the *same* `payment_id` being charged again
when the broker redelivers — so the customer pays ₹400 for one order.

**Correct (idempotency key makes the redelivery a no-op):**

```python
def process_payment(channel, method, properties, body):
    msg = json.loads(body)

    if not already_processed(msg["payment_id"]):          # dedupe on the stable id
        charge_customer(msg["customer"], msg["amount"])
        mark_processed(msg["payment_id"])

    channel.basic_ack(delivery_tag=method.delivery_tag)   # second delivery: skip work, still ack
```

The lesson's whole point: **both pass `test_processes_once`. Only the correct one passes
`test_redelivery_charges_once`.** The redelivery scenario is what separates "it works" from
"it's idempotent".

---

## 2. What the lesson author writes

### `infra_init` — declare the queue, seed a message

```python
def infra_init():
    queue = setup_queue()                          # spins the AMQP emulator on :5672, control API on :9900
    queue.declare("payments")                      # Queue.Declare → seeds the engine
    queue.publish("payments", {                    # Basic.Publish → one job waiting
        "payment_id": "pay_abc",
        "customer": "alice",
        "amount": 200,
    })
    return queue
```

`setup_queue()` returns a **control handle** — a thin Python wrapper over the emulator's control
API (`/seed`, `/reset`, `/log`, `/faults`, `/state`). It is **not** the student's `pika`
connection; it talks to the emulator over the harness-only network, which the student container
can't reach (Phase 0b, non-negotiable — students must not reset their own graded state).

Two distinct objects, never confused:

| Object | Whose | Speaks | Used for |
|---|---|---|---|
| `channel` | student's | AMQP wire on :5672 | the code under test |
| `queue` | harness's | control API on :9900 | seed, fault, assert |

### The tests

```python
def test_processes_once(client, channel):
    # Happy path: one delivery, one charge.
    consume_one(channel, "payments", process_payment)

    assert charge_ledger("alice") == 200


def test_redelivery_charges_once(client, channel, queue):   # ← note: `queue` is a fixture too
    # Arm the fault: the emulator drops the consumer AFTER the first delivery but BEFORE its ack,
    # so the message is unacked → requeued with redelivered=1 → handed to the next worker.
    queue.fail(action="drop_before_ack", after="deliver", count=1)

    # First worker: gets the job, does the charge, dies before ack (dropped by the fault).
    with pytest.raises(pika.exceptions.ConnectionClosedByBroker):
        consume_one(channel, "payments", process_payment)

    # Second worker: the broker redelivers the same payment_id (redelivered=1).
    consume_one(reconnect(channel), "payments", process_payment)

    # Assert on the EMULATOR'S state — the message was delivered twice, charge must have run once.
    assert queue.state.charge_count("alice") == 1
    assert queue.state.depth("payments") == 0             # queue drained, message acked exactly once
```

---

## 3. The open question, decided: `queue.fail(...)` arguments

The plan lists queue faults (§Phase 4) but leaves the harness-facing shape open. Here is the
contract — deliberately the **same shape** as `db.fail(...)` in the rollback doc: `action` +
trigger (`after`/`count`) + `times`.

`queue.fail(...)` installs one declarative fault rule via `POST /faults` and returns immediately —
it **arms** the emulator; the fault **fires** later, when the student's consumer trips the
trigger (mechanics: plan §1, *armed on the control plane, fired on the data plane*). It maps
one-to-one onto the plan's fault-rule contract.

```python
queue.fail(
    action="drop_before_ack",   # WHAT the emulator does when the trigger hits
    after="deliver",            # trigger: fire after an AMQP op whose type matches this
    count=1,                    # ...on the Nth matching op (1 = the first). default 1
    times=1,                    # how many times this rule may fire before it retires. default 1
)
```

Field by field:

- **`action`** *(required)* — the fault behavior. For the queue emulator:
  - `"drop_before_ack"` — drop the consumer connection after a delivery but before its ack, so
    the broker requeues the message with `redelivered=1` (**this lesson** — the natural,
    protocol-honest way to force a redelivery).
  - `"redeliver"` — push the same message to the consumer a second time directly (`times=N`),
    without a connection drop. Blunter; use when a lesson wants a clean duplicate without also
    teaching the crash.
  - `"delay_delivery"` — stall a `Basic.Deliver` N ms (`ms=...`), for consumer-timeout lessons.
  - `"reorder"` — swap the delivery order of two queued messages, for out-of-order lessons.
- **`after`** — the trigger op type: `"deliver"`, `"publish"`, `"ack"`, `"consume"`. Matched
  against the emulator's op log as each AMQP frame is processed. `connect` and `disconnect`
  are themselves logged ops, so `after="connect"` fires the moment the consumer connects —
  and the log's `connect` entries are how grading *sees* the reconnect between the two
  deliveries in this lesson.
- **`count`** — fire on the *Nth* occurrence of `after`, **counted from the moment the rule is
  armed** (the seed publish at `infra_init` went through the control API, and any earlier wire
  traffic wouldn't count either). `count=1` + `after="deliver"` = "right after the first
  message reaches the worker, before it can ack" — the exact point real RabbitMQ can't be
  killed at deterministically. This is the whole feature.
- **`times`** — how many times the rule may fire before it retires. `times=1` (default) = one-shot.
  Set `times=2` for "the redelivery also crashes before ack" scenarios.

Why these and not more: `action` + `after` + `count` are the irreducible core — *what* happens,
*on which kind of op*, *at which occurrence*. `times` earns its place from a concrete lesson
(the crash-loop consumer), per the plan's "feature requests must cite a lesson" rule.

The raw wire this call produces:

```json
{"emulator": "queue", "action": "drop_before_ack",
 "after": {"op_matches": "deliver", "count": 1}, "times": 1}
```

---

## 4. How grading actually reads the result

Two independent signals, both from the emulator — neither trusts the student's return value:

1. **State assertion** (`GET /state`) — did the invariant hold? `queue.state.charge_count("alice")
   == 1` proves the customer paid once. The naive solution fails here: it charged on both
   deliveries → count of 2, ₹200 double-billed. `queue.state.depth("payments") == 0` confirms the
   message was eventually acked exactly once and the queue drained.
2. **Op-log assertion** (`GET /log`) — did they do it *for the right reason*? The emulator sees
   **every AMQP frame**, so "did they ack only after the work?" is a log query, not a heuristic:

   ```python
   queue.oplog.assert_delivered_twice("pay_abc", redelivered_on=2)   # 2nd Deliver had redelivered=1
   queue.oplog.assert_ack_count("pay_abc", 1)                        # exactly one Basic.Ack landed
   queue.oplog.assert_order("deliver", "charge", "ack")              # ack came AFTER the side-effect
   ```

   The correct solution's log shows: `Deliver(redelivered=0)` → charge → *(connection drops, no
   ack)* → `Deliver(redelivered=1)` → *(dedupe: no charge)* → `Ack`. One charge, one ack across two
   deliveries. The naive solution's log shows a charge on **both** deliveries. The grader can
   therefore tell the student *precisely* what went wrong:

   > "The queue redelivered payment `pay_abc` after your first worker died before acking — that's
   > at-least-once delivery working as designed. Your consumer charged Alice ₹200 on **both**
   > deliveries. Dedupe on `payment_id` so the redelivery is a no-op."

That teachable message — not a stack trace — is what `process_payment` grading surfaces (plan §7).

---

