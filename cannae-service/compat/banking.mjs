#!/usr/bin/env node
// Blessed-client compatibility suite: `node-postgres` (`pg`), unmodified.
//
// The Node sibling of `banking.py` — same lesson, same op-log grading, a different
// client. It matters for one specific reason the Python suites cannot cover: psycopg2
// interpolates parameters itself and sends **simple** queries, while node-postgres uses
// the **extended** protocol — `Parse`/`Bind`/`Describe`/`Execute`/`Sync`, pipelined.
// So this is the suite that proves the extended flow is right.
//
// Nothing here is emulator-aware apart from the control-plane calls the *harness*
// makes; the database is reached over a plain postgresql:// connection string.

import pg from "pg";

import { HOST, arm, expect, log, ops, port, reset, runStages, seed, state } from "./harness.mjs";

const PORT = port("CANNAE_SQL_PORT", 5432);
const URL = `postgresql://student:student@${HOST}:${PORT}/app`;

// Drivers chatter around every statement (`parse`, `bind`, `describe`, `sync`). That is
// real traffic and the log records it faithfully; a grader cares about the statements
// the student's own code issued, so it filters to these.
const LESSON_OPS = new Set([
  "BEGIN", "COMMIT", "ROLLBACK", "SELECT", "INSERT", "UPDATE", "DELETE",
]);

const SCHEMA = `
CREATE TABLE accounts (
    id      SERIAL PRIMARY KEY,
    owner   TEXT NOT NULL UNIQUE,
    balance NUMERIC(12,2) NOT NULL CHECK (balance >= 0)
)`;

const OPENING_BALANCES = [
  { owner: "ada", balance: "1000.00" },
  { owner: "grace", balance: "500.00" },
];

const lessonOps = () => ops("sql", LESSON_OPS);

/** One account's balance, as the exact decimal string `/state` reports. */
async function balance(owner) {
  const rows = (await state("sql")).tables.accounts;
  const row = rows.find((candidate) => candidate.owner === owner);
  if (!row) throw new Error(`FAIL no account for ${owner} in ${JSON.stringify(rows)}`);
  return row.balance;
}

/**
 * Every rupee in the bank, in whole paise — the invariant a transfer must preserve.
 * Integers, deliberately: money in a float is how a bank loses a paisa.
 */
async function totalPaise() {
  return (await state("sql")).tables.accounts.reduce((sum, row) => sum + paise(row.balance), 0);
}

function paise(amount) {
  const [whole, fraction = "0"] = amount.split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

/** Reset, seed, arm any rules — *then* connect, the order the lesson flow uses. */
async function freshBank(faults = []) {
  await reset();
  await seed("sql", { schema: [SCHEMA], rows: { accounts: OPENING_BALANCES } });
  for (const rule of faults) {
    await arm("sql", rule);
  }
  const client = new pg.Client({ connectionString: URL });
  // node-postgres emits `error` on the client when the socket dies under it, and an
  // unhandled one takes the process down. A dropped connection is the point of half
  // these stages, so the listener is not optional — any real app needs it too. The
  // rejection on the statement in flight is what the assertions read.
  client.on("error", () => {});
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// The lesson's target implementation, written the way a student writes it.
// ---------------------------------------------------------------------------

async function transferMoney(client, sender, recipient, amount) {
  await client.query("BEGIN");
  await client.query("UPDATE accounts SET balance = balance - $1 WHERE owner = $2", [amount, sender]);
  await client.query("UPDATE accounts SET balance = balance + $1 WHERE owner = $2", [amount, recipient]);
  await client.query("COMMIT");
}

/** What a student writes first: two statements, each auto-committed on its own. */
async function transferMoneyWithoutATransaction(client, sender, recipient, amount) {
  await client.query("UPDATE accounts SET balance = balance - $1 WHERE owner = $2", [amount, sender]);
  await client.query("UPDATE accounts SET balance = balance + $1 WHERE owner = $2", [amount, recipient]);
}

// ---------------------------------------------------------------------------
// Stages.
// ---------------------------------------------------------------------------

async function smoke() {
  const client = await freshBank();
  try {
    let result = await client.query("SELECT owner, balance FROM accounts ORDER BY id");
    expect(result.rows, OPENING_BALANCES, "a SELECT returns rows keyed by column name");
    expect(result.rowCount, 2, "rowCount comes from CommandComplete");
    expect(
      result.fields.map((field) => field.name),
      ["owner", "balance"],
      "RowDescription names the columns",
    );

    // The extended protocol: a parameterised statement goes out as Parse/Bind/Execute.
    result = await client.query("SELECT balance FROM accounts WHERE id = $1", [1]);
    expect(result.rows, [{ balance: "1000.00" }], "a bound parameter narrows the query");
    expect(
      result.rows[0].balance,
      "1000.00",
      "pg hands NUMERIC back as an exact string, not a float",
    );

    result = await client.query(
      "INSERT INTO accounts (owner, balance) VALUES ($1, $2) RETURNING id",
      ["turing", "250.00"],
    );
    expect(result.rows, [{ id: 3 }], "INSERT ... RETURNING hands back the new id");

    result = await client.query("DELETE FROM accounts WHERE owner = $1", ["turing"]);
    expect(result.rowCount, 1, "DELETE reports the rows it removed");

    // A column with no declared type is reported as `int8`, which is what Postgres uses
    // for aggregates — and pg renders int8 as a string so a 64-bit value cannot lose
    // precision in a JS number. A bare `SELECT 1` gets the same treatment here where
    // Postgres would say int4; that divergence is in the README, and the fix for a
    // lesson that cares is to select a declared column.
    result = await client.query("SELECT count(*) AS n FROM accounts");
    expect(result.rows, [{ n: "2" }], "count(*) is int8, which pg reports as a string");
    result = await client.query("SELECT 1 AS n");
    expect(result.rows, [{ n: "1" }], "so is a bare integer literal — a known divergence");

    result = await client.query("SELECT balance FROM accounts WHERE owner = $1", ["nobody"]);
    expect(result.rows, [], "an empty result set is empty, not an error");

    // A NULL parameter is not an empty string.
    result = await client.query("SELECT count(*) AS n FROM accounts WHERE owner = $1", [null]);
    expect(result.rows, [{ n: "0" }], "a NULL parameter matches nothing");
  } finally {
    await client.end();
  }
}

async function happyPath() {
  const client = await freshBank();
  try {
    await transferMoney(client, "ada", "grace", "100.00");

    expect(await balance("ada"), "900.00", "the sender was debited");
    expect(await balance("grace"), "600.00", "the recipient was credited");
    expect(await totalPaise(), 150000, "a transfer moves money, it does not make it");

    // The grading signal: not "is the answer right" but "did they do it the way that
    // survives a crash".
    expect(
      await lessonOps(),
      ["BEGIN", "UPDATE", "UPDATE", "COMMIT"],
      "both writes sit between BEGIN and COMMIT",
    );
    const writes = (await log("sql")).filter((record) => record.op === "UPDATE");
    expect(
      writes.map((record) => record.args.in_transaction),
      [true, true],
      "each write is logged with the transaction state it ran under",
    );
    expect(
      writes.map((record) => record.args.tables),
      [["accounts"], ["accounts"]],
      "and with the table it touched — even though the SQL arrived via Parse",
    );
  } finally {
    await client.end();
  }
}

async function crashBetweenTheTwoWrites() {
  // The *second* UPDATE: the debit has already happened and the credit never will.
  const crash = [{
    action: "kill_connection",
    after: { op_matches: "UPDATE", count: 2 },
    conn: "next",
  }];

  let client = await freshBank(crash);
  let raised = null;
  try {
    await transferMoney(client, "ada", "grace", "100.00");
  } catch (error) {
    raised = error;
  }
  expect(raised !== null, true, "the crash surfaces to the driver as a connection error");
  expect(await totalPaise(), 150000, "money is neither created nor destroyed");
  expect(await balance("ada"), "1000.00", "the debit rolled back with the connection");
  expect(await balance("grace"), "500.00", "and the credit never happened");

  // The other half of the lesson: the same crash without a transaction destroys money,
  // reproducibly. This is what the lesson exists to show.
  client = await freshBank(crash);
  try {
    await transferMoneyWithoutATransaction(client, "ada", "grace", "100.00");
  } catch {
    // Expected: the socket is gone.
  }
  expect(await balance("ada"), "900.00", "the debit committed on its own");
  expect(await balance("grace"), "500.00", "the credit never ran");
  expect(await totalPaise(), 140000, "100.00 was destroyed by the crash");
}

async function retryableErrors() {
  const client = await freshBank([{
    action: "inject_error",
    after: { op_matches: "UPDATE", count: 1 },
    params: { sqlstate: "40001" },
  }]);
  try {
    let raised = null;
    try {
      await transferMoney(client, "ada", "grace", "100.00");
    } catch (error) {
      raised = error;
    }
    expect(raised?.code, "40001", "the SQLSTATE reaches the client as `error.code`");
    expect(
      raised?.message.includes("serialize"),
      true,
      "with the message real Postgres would send",
    );

    // The block is poisoned, and everything but ROLLBACK is refused until it ends.
    let refused = null;
    try {
      await client.query("SELECT 1");
    } catch (error) {
      refused = error;
    }
    expect(refused?.code, "25P02", "a statement in a failed block is 25P02");

    await client.query("ROLLBACK");
    expect(await totalPaise(), 150000, "the poisoned transaction changed nothing");

    // The rule has retired, so the student's retry is the code path the lesson teaches.
    await transferMoney(client, "ada", "grace", "100.00");
    expect(await balance("ada"), "900.00", "the retry succeeds");
  } finally {
    await client.end();
  }
}

async function constraintErrors() {
  const client = await freshBank();
  try {
    const cases = [
      ["UPDATE accounts SET balance = -1 WHERE owner = 'ada'", "23514", "an overdraft trips the CHECK"],
      ["INSERT INTO accounts (owner, balance) VALUES ('ada', 1)", "23505", "a duplicate owner is a unique violation"],
      ["INSERT INTO accounts (owner, balance) VALUES (NULL, 1)", "23502", "a null owner is a not-null violation"],
      ["SELECT * FROM nope", "42P01", "an unknown table is 42P01"],
      ["SELECT nope FROM accounts", "42703", "an unknown column is 42703"],
      ["NOT SQL AT ALL", "42601", "nonsense is a syntax error"],
    ];
    for (const [sql, code, what] of cases) {
      let raised = null;
      try {
        await client.query(sql);
      } catch (error) {
        raised = error;
      }
      expect(raised?.code, code, what);
    }
    expect(await totalPaise(), 150000, "and nothing was written");
    // The connection survives every one of them.
    expect(
      (await client.query("SELECT id FROM accounts ORDER BY id")).rows,
      [{ id: 1 }, { id: 2 }],
      "the connection is still usable, and a declared int4 arrives as a number",
    );
  } finally {
    await client.end();
  }
}

await runStages(
  `node-postgres → ${URL}`,
  [smoke, happyPath, crashBetweenTheTwoWrites, retryableErrors, constraintErrors],
  "node-postgres",
);
