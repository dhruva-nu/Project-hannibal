//! End-to-end acceptance test for Phase 2 (#135) — the banking milestone.
//!
//! The centrepiece is [`banking_milestone_lesson`], which asserts the three things the
//! issue's acceptance criteria name: the happy path, a scripted crash between the debit
//! and the credit proving money is neither created nor destroyed *when a transaction is
//! used* — and lost when it is not — and an op-log assertion that a transaction really
//! wrapped both writes.
//!
//! Everything is driven over real protocol bytes by a hand-rolled client, deliberately:
//! this test has to exercise the wire, not a crate's idea of it. Client-library
//! compatibility (psycopg2, SQLAlchemy, node-postgres) is proved separately by
//! `compat/`, which runs this same lesson through the blessed clients in CI.

mod common;

use cannae_core::Emulator;
use cannae_sql::SqlEmulator;
use common::{Conn, Harness};
use serde_json::{json, Value};
use std::sync::Arc;

async fn start() -> Harness {
    Harness::start("sql", |port| {
        Arc::new(SqlEmulator::with_port(port)) as Arc<dyn Emulator>
    })
    .await
}

/// The lesson's schema and opening balances. Two accounts, 1500.00 between them — the
/// number every crash scenario below checks has not moved.
fn bank_fixture() -> Value {
    json!({
        "schema": ["CREATE TABLE accounts (\
            id SERIAL PRIMARY KEY, \
            owner TEXT NOT NULL UNIQUE, \
            balance NUMERIC(12,2) NOT NULL CHECK (balance >= 0))"],
        "rows": { "accounts": [
            { "owner": "ada", "balance": "1000.00" },
            { "owner": "grace", "balance": "500.00" },
        ] }
    })
}

// ---------------------------------------------------------------------------
// A minimal Postgres v3 client. Hand-rolled so the bytes on the wire are what is
// under test; a driver crate would hide exactly the framing this phase adds.
// ---------------------------------------------------------------------------

/// One backend message, in the shape a test wants to assert on.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Backend {
    /// `RowDescription` — the column names.
    Description(Vec<String>),
    /// `DataRow` — one row, `None` for SQL NULL.
    Row(Vec<Option<String>>),
    /// `CommandComplete` and its tag (`UPDATE 1`, `SELECT 2`, `BEGIN`, …).
    Complete(String),
    /// `ErrorResponse`, as `(SQLSTATE, message)`.
    Error(String, String),
    /// `NoticeResponse` — a warning the connection survives.
    Notice(String),
    /// `ReadyForQuery` and its transaction status byte (`I`, `T`, or `E`).
    Ready(char),
    EmptyQuery,
    ParseComplete,
    BindComplete,
    CloseComplete,
    NoData,
    PortalSuspended,
    ParameterDescription(usize),
    /// Anything the tests do not assert on individually (`ParameterStatus`, …).
    Other(char),
}

struct PgClient {
    conn: Conn,
}

impl PgClient {
    /// Open a connection and complete the startup handshake, returning once the server
    /// says it is ready. `application_name` is sent because a real client sends one.
    async fn connect(harness: &Harness) -> Self {
        let mut client = PgClient {
            conn: harness.connect().await,
        };
        let mut body = 196_608i32.to_be_bytes().to_vec();
        for (key, value) in [
            ("user", "student"),
            ("database", "app"),
            ("application_name", "lesson"),
        ] {
            body.extend(cstr(key));
            body.extend(cstr(value));
        }
        body.push(0);
        client.conn.write(&startup_packet(&body)).await;
        let messages = client.until_ready().await;
        assert_eq!(
            messages.last(),
            Some(&Backend::Ready('I')),
            "the handshake must end with an idle ReadyForQuery"
        );
        client
    }

    /// One simple query (`Q`), read to the `ReadyForQuery` that closes it.
    async fn query(&mut self, sql: &str) -> Vec<Backend> {
        self.conn.write(&message(b'Q', &cstr(sql))).await;
        self.until_ready().await
    }

    /// The full extended-protocol exchange for one statement, pipelined the way a
    /// driver pipelines it: `Parse`, `Bind`, `Describe`, `Execute`, `Sync` in one write.
    async fn extended(
        &mut self,
        sql: &str,
        params: &[Option<&str>],
        max_rows: i32,
    ) -> Vec<Backend> {
        let mut frames = message(
            b'P',
            &[cstr(""), cstr(sql), 0i16.to_be_bytes().to_vec()].concat(),
        );
        frames.extend(message(b'B', &bind_body("", "", params)));
        frames.extend(message(b'D', &[vec![b'S'], cstr("")].concat()));
        frames.extend(message(
            b'E',
            &[cstr(""), max_rows.to_be_bytes().to_vec()].concat(),
        ));
        frames.extend(message(b'S', b""));
        self.conn.write(&frames).await;
        self.until_ready().await
    }

    /// Read messages until `ReadyForQuery`, or until the socket closes — which is a
    /// legitimate outcome here, because that is what a `kill_connection` fault looks
    /// like from the client's side.
    async fn until_ready(&mut self) -> Vec<Backend> {
        let mut messages = Vec::new();
        loop {
            let Some(message) = self.read_message().await else {
                return messages;
            };
            let ready = matches!(message, Backend::Ready(_));
            messages.push(message);
            if ready {
                return messages;
            }
        }
    }

    async fn read_message(&mut self) -> Option<Backend> {
        let header = self.conn.read_bytes(5).await?;
        let length = i32::from_be_bytes(header[1..5].try_into().unwrap());
        let body = match length > 4 {
            true => self.conn.read_bytes(length as usize - 4).await?,
            false => Vec::new(),
        };
        Some(decode_backend(header[0], &body))
    }

    /// Whether the connection is gone. Used to prove a `kill_connection` fault really
    /// dropped the socket rather than merely erroring on it.
    async fn is_closed(&mut self) -> bool {
        self.conn.read_bytes(1).await.is_none()
    }
}

fn decode_backend(tag: u8, body: &[u8]) -> Backend {
    match tag {
        b'T' => Backend::Description(
            strings(&body[2..])
                .into_iter()
                // Each field is a name then 18 bytes of metadata, so only every other
                // NUL-terminated run is a name.
                .step_by(1)
                .collect(),
        ),
        b'D' => Backend::Row(data_row(body)),
        b'C' => Backend::Complete(first_string(body)),
        b'E' => Backend::Error(diagnostic(body, b'C'), diagnostic(body, b'M')),
        b'N' => Backend::Notice(diagnostic(body, b'M')),
        b'Z' => Backend::Ready(body[0] as char),
        b'I' => Backend::EmptyQuery,
        b'1' => Backend::ParseComplete,
        b'2' => Backend::BindComplete,
        b'3' => Backend::CloseComplete,
        b'n' => Backend::NoData,
        b's' => Backend::PortalSuspended,
        b't' => {
            Backend::ParameterDescription(i16::from_be_bytes(body[..2].try_into().unwrap()) as usize)
        }
        other => Backend::Other(other as char),
    }
}

/// `RowDescription` column names: an `int16` count, then per column a name and 18 bytes
/// of type metadata.
fn strings(mut body: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    while !body.is_empty() {
        let end = match body.iter().position(|byte| *byte == 0) {
            Some(end) => end,
            None => break,
        };
        names.push(String::from_utf8_lossy(&body[..end]).into_owned());
        // The name's NUL plus table oid, column number, type oid, typmod, size, format.
        let skip = end + 1 + 18;
        if skip >= body.len() {
            break;
        }
        body = &body[skip..];
    }
    names
}

fn data_row(body: &[u8]) -> Vec<Option<String>> {
    let count = i16::from_be_bytes(body[..2].try_into().unwrap());
    let mut values = Vec::new();
    let mut at = 2;
    for _ in 0..count {
        let length = i32::from_be_bytes(body[at..at + 4].try_into().unwrap());
        at += 4;
        match length {
            -1 => values.push(None),
            length => {
                let end = at + length as usize;
                values.push(Some(String::from_utf8_lossy(&body[at..end]).into_owned()));
                at = end;
            }
        }
    }
    values
}

fn first_string(body: &[u8]) -> String {
    let end = body
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(body.len());
    String::from_utf8_lossy(&body[..end]).into_owned()
}

/// One field of an `ErrorResponse` / `NoticeResponse`, which is a sequence of
/// `type byte + NUL-terminated value` ending in a zero byte.
fn diagnostic(body: &[u8], field: u8) -> String {
    let mut at = 0;
    while at < body.len() && body[at] != 0 {
        let kind = body[at];
        let value = first_string(&body[at + 1..]);
        if kind == field {
            return value;
        }
        at += 1 + value.len() + 1;
    }
    String::new()
}

fn cstr(text: &str) -> Vec<u8> {
    let mut bytes = text.as_bytes().to_vec();
    bytes.push(0);
    bytes
}

fn startup_packet(body: &[u8]) -> Vec<u8> {
    let mut frame = ((body.len() + 4) as i32).to_be_bytes().to_vec();
    frame.extend_from_slice(body);
    frame
}

fn message(tag: u8, body: &[u8]) -> Vec<u8> {
    let mut frame = vec![tag];
    frame.extend_from_slice(&((body.len() + 4) as i32).to_be_bytes());
    frame.extend_from_slice(body);
    frame
}

fn bind_body(portal: &str, statement: &str, params: &[Option<&str>]) -> Vec<u8> {
    let mut body = [cstr(portal), cstr(statement)].concat();
    // One format code for all parameters: text.
    body.extend_from_slice(&1i16.to_be_bytes());
    body.extend_from_slice(&0i16.to_be_bytes());
    body.extend_from_slice(&(params.len() as i16).to_be_bytes());
    for param in params {
        match param {
            None => body.extend_from_slice(&(-1i32).to_be_bytes()),
            Some(text) => {
                body.extend_from_slice(&(text.len() as i32).to_be_bytes());
                body.extend_from_slice(text.as_bytes());
            }
        }
    }
    // No result format codes: text for every column.
    body.extend_from_slice(&0i16.to_be_bytes());
    body
}

// ---------------------------------------------------------------------------
// Grading helpers — the same shape the harness will use.
// ---------------------------------------------------------------------------

/// The balance of one account, from `GET /state`. A string because money is an exact
/// decimal and a JSON number is a double.
fn balance(state: &Value, owner: &str) -> String {
    state["tables"]["accounts"]
        .as_array()
        .expect("state must list the accounts table")
        .iter()
        .find(|row| row["owner"] == json!(owner))
        .unwrap_or_else(|| panic!("no account for {owner} in {state}"))["balance"]
        .as_str()
        .expect("a NUMERIC balance is reported as an exact string")
        .to_string()
}

/// Every rupee in the bank. The invariant a transfer must preserve.
fn total(state: &Value) -> i64 {
    state["tables"]["accounts"]
        .as_array()
        .expect("state must list the accounts table")
        .iter()
        .map(|row| paise(row["balance"].as_str().unwrap()))
        .sum()
}

/// A money string as whole paise, so a total can be compared exactly.
fn paise(amount: &str) -> i64 {
    let (whole, fraction) = amount.split_once('.').unwrap_or((amount, "0"));
    whole.parse::<i64>().unwrap() * 100 + format!("{fraction:0<2}")[..2].parse::<i64>().unwrap()
}

/// The statement ops a student's own code issued, in order — a grader filters the log
/// down to these, because the protocol chatter around them (`startup`, `parse`, `bind`,
/// `sync`) is real traffic the log records faithfully.
const LESSON_OPS: &[&str] = &[
    "BEGIN", "COMMIT", "ROLLBACK", "SELECT", "INSERT", "UPDATE", "DELETE",
];

fn lesson_ops(log: &[Value]) -> Vec<String> {
    log.iter()
        .map(|record| record["op"].as_str().unwrap_or_default().to_string())
        .filter(|op| LESSON_OPS.contains(&op.as_str()))
        .collect()
}

/// The student's `transfer_money()`, written the way the lesson asks for it: both writes
/// inside one transaction.
async fn transfer_in_transaction(client: &mut PgClient, from: &str, to: &str, amount: &str) {
    client.query("BEGIN").await;
    client
        .query(&format!(
            "UPDATE accounts SET balance = balance - {amount} WHERE owner = '{from}'"
        ))
        .await;
    client
        .query(&format!(
            "UPDATE accounts SET balance = balance + {amount} WHERE owner = '{to}'"
        ))
        .await;
    client.query("COMMIT").await;
}

/// The same transfer written the way a student writes it *first*: two independent
/// statements, no transaction. Correct until something goes wrong between them.
async fn transfer_without_transaction(client: &mut PgClient, from: &str, to: &str, amount: &str) {
    client
        .query(&format!(
            "UPDATE accounts SET balance = balance - {amount} WHERE owner = '{from}'"
        ))
        .await;
    client
        .query(&format!(
            "UPDATE accounts SET balance = balance + {amount} WHERE owner = '{to}'"
        ))
        .await;
}

/// Arm the mid-transfer crash: drop the socket on the *second* `UPDATE`, so the debit
/// has already happened and the credit never will.
async fn arm_crash_between_the_two_writes(harness: &Harness, op_matches: &str) {
    harness
        .arm(json!({
            "action": "kill_connection",
            "after": { "op_matches": op_matches, "count": 2 },
            "conn": "next",
        }))
        .await;
}

// ---------------------------------------------------------------------------
// The milestone lesson.
// ---------------------------------------------------------------------------

/// The definition of done for #135, asserted the way the harness will assert it: from
/// `GET /state` and `GET /log`, never from what the client returned.
#[tokio::test]
async fn banking_milestone_lesson() {
    let harness = start().await;

    // (a) The happy path. Balances move, and nothing else does.
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;
    transfer_in_transaction(&mut client, "ada", "grace", "100.00").await;

    let state = harness.state().await;
    assert_eq!(balance(&state, "ada"), "900.00");
    assert_eq!(balance(&state, "grace"), "600.00");
    assert_eq!(
        total(&state),
        150_000,
        "a transfer moves money, it does not make it"
    );

    // (c) The op log proves a transaction wrapped both writes. This is the grading
    // signal: not "is the answer right" but "did they do it the way that survives".
    let log = harness.log().await;
    assert_eq!(
        lesson_ops(&log),
        vec!["BEGIN", "UPDATE", "UPDATE", "COMMIT"],
        "both writes must sit between BEGIN and COMMIT"
    );
    let writes: Vec<&Value> = log
        .iter()
        .filter(|record| record["op"] == "UPDATE")
        .collect();
    assert_eq!(writes.len(), 2);
    for write in writes {
        assert_eq!(
            write["args"]["in_transaction"],
            json!(true),
            "every write is logged with the transaction state it ran under: {write}"
        );
        assert_eq!(write["args"]["tables"], json!(["accounts"]));
    }

    // (b) The scripted crash, with a transaction: the debit is rolled back with the
    // connection, so no money is created and none is destroyed.
    harness.reset().await;
    arm_crash_between_the_two_writes(&harness, "UPDATE").await;
    let mut client = PgClient::connect(&harness).await;
    transfer_in_transaction(&mut client, "ada", "grace", "100.00").await;
    assert!(client.is_closed().await, "the fault must drop the socket");

    let state = harness.state().await;
    assert_eq!(
        total(&state),
        150_000,
        "money is neither created nor destroyed"
    );
    assert_eq!(balance(&state, "ada"), "1000.00", "the debit rolled back");
    assert_eq!(balance(&state, "grace"), "500.00");

    // (b, the other half) The same crash without a transaction: the debit committed on
    // its own, the credit never ran, and 100.00 has left the bank. This is what the
    // lesson exists to show — and it must be *reproducible*, not a race.
    harness.reset().await;
    arm_crash_between_the_two_writes(&harness, "UPDATE").await;
    let mut client = PgClient::connect(&harness).await;
    transfer_without_transaction(&mut client, "ada", "grace", "100.00").await;
    assert!(client.is_closed().await);

    let state = harness.state().await;
    assert_eq!(balance(&state, "ada"), "900.00");
    assert_eq!(balance(&state, "grace"), "500.00");
    // 900.00 + 500.00 = 1400.00. A hundred rupees left the bank and nothing recorded it.
    assert_eq!(total(&state), 140_000, "100.00 was destroyed by the crash");
}

/// The same crash expressed as "kill it *inside* the transaction" — the trigger reads
/// the transaction state off the op rather than a lesson author counting statements.
#[tokio::test]
async fn a_crash_can_be_armed_on_being_inside_a_transaction() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    arm_crash_between_the_two_writes(&harness, "in_transaction").await;

    let mut client = PgClient::connect(&harness).await;
    transfer_in_transaction(&mut client, "ada", "grace", "250.00").await;
    assert!(client.is_closed().await);

    let state = harness.state().await;
    assert_eq!(total(&state), 150_000);
    assert_eq!(balance(&state, "ada"), "1000.00");

    // The rule fired on the second op that ran with the block already open — the credit.
    let log = harness.log().await;
    let faulted: Vec<&Value> = log
        .iter()
        .filter(|r| r["fault"] == "kill_connection")
        .collect();
    assert_eq!(faulted.len(), 1, "{log:?}");
    assert_eq!(faulted[0]["op"], "UPDATE");
    assert_eq!(faulted[0]["args"]["in_transaction"], json!(true));
}

/// Without a transaction there is nothing for `in_transaction` to match, so the same
/// rule stays dormant — which is what makes it a statement *about* the student's code.
#[tokio::test]
async fn the_in_transaction_trigger_never_fires_without_a_transaction() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    arm_crash_between_the_two_writes(&harness, "in_transaction").await;

    let mut client = PgClient::connect(&harness).await;
    transfer_without_transaction(&mut client, "ada", "grace", "100.00").await;

    let state = harness.state().await;
    assert_eq!(balance(&state, "ada"), "900.00");
    assert_eq!(balance(&state, "grace"), "600.00", "the transfer completed");
    assert!(harness
        .log()
        .await
        .iter()
        .all(|record| record["fault"].is_null()));
}

// ---------------------------------------------------------------------------
// The protocol the lesson rests on.
// ---------------------------------------------------------------------------

/// The handshake, in the order a real client drives it: ask for TLS, be refused, then
/// start up in plaintext on the same socket.
#[tokio::test]
async fn tls_is_refused_and_the_client_carries_on_in_plaintext() {
    let harness = start().await;
    let mut conn = harness.connect().await;
    conn.write(&startup_packet(&80877103i32.to_be_bytes()))
        .await;
    assert_eq!(
        conn.read_bytes(1).await,
        Some(b"N".to_vec()),
        "the refusal is a bare byte with no length prefix"
    );

    let mut body = 196_608i32.to_be_bytes().to_vec();
    body.extend(cstr("user"));
    body.extend(cstr("student"));
    body.push(0);
    conn.write(&startup_packet(&body)).await;
    let mut client = PgClient { conn };
    let messages = client.until_ready().await;
    assert_eq!(messages.last(), Some(&Backend::Ready('I')));
    // Authentication then the parameters a client decodes strings with.
    assert!(messages.contains(&Backend::Other('R')), "{messages:?}");
    assert!(messages.contains(&Backend::Other('S')), "{messages:?}");
    assert!(messages.contains(&Backend::Other('K')), "{messages:?}");
    assert_eq!(
        harness.op_names().await,
        vec!["connect", "ssl_request", "startup"]
    );
}

/// `ReadyForQuery`'s status byte is a protocol obligation and the grading signal both.
#[tokio::test]
async fn the_transaction_status_byte_tracks_the_block() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    let status = |messages: &Vec<Backend>| match messages.last() {
        Some(Backend::Ready(status)) => *status,
        other => panic!("expected a ReadyForQuery, got {other:?}"),
    };
    assert_eq!(status(&client.query("SELECT 1").await), 'I');
    assert_eq!(status(&client.query("BEGIN").await), 'T');
    assert_eq!(status(&client.query("SELECT 1").await), 'T');
    // An error inside the block poisons it, and the status says so.
    assert_eq!(status(&client.query("SELECT * FROM nope").await), 'E');
    assert_eq!(status(&client.query("ROLLBACK").await), 'I');
}

/// Inside a poisoned block Postgres refuses everything but the two statements that end
/// it. A lesson that did not see this would teach that an error mid-transaction is
/// recoverable without a rollback.
#[tokio::test]
async fn a_failed_transaction_refuses_everything_until_it_ends() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    client.query("BEGIN").await;
    client
        .query("UPDATE accounts SET balance = 0 WHERE owner = 'ada'")
        .await;
    assert!(matches!(
        client.query("SELECT * FROM nope").await.first(),
        Some(Backend::Error(code, _)) if code == "42P01"
    ));
    let refused = client.query("SELECT 1").await;
    assert!(
        matches!(refused.first(), Some(Backend::Error(code, _)) if code == "25P02"),
        "{refused:?}"
    );
    // Committing a poisoned block rolls it back, and *says* ROLLBACK — a client that
    // reported "committed" here would hide a lost transaction.
    assert_eq!(
        client.query("COMMIT").await.first(),
        Some(&Backend::Complete("ROLLBACK".into()))
    );
    assert_eq!(
        balance(&harness.state().await, "ada"),
        "1000.00",
        "the write inside the poisoned block is gone"
    );
}

/// Postgres warns rather than failing on a redundant transaction statement, and so must
/// this: a lesson that taught a bare `COMMIT` was fatal would teach something false.
#[tokio::test]
async fn redundant_transaction_statements_warn_rather_than_fail() {
    let harness = start().await;
    let mut client = PgClient::connect(&harness).await;
    for sql in ["COMMIT", "ROLLBACK"] {
        let messages = client.query(sql).await;
        assert!(
            matches!(messages.first(), Some(Backend::Notice(text)) if text.contains("no transaction")),
            "{sql}: {messages:?}"
        );
        assert_eq!(messages[1], Backend::Complete(sql.to_string()));
    }
    client.query("BEGIN").await;
    let messages = client.query("BEGIN").await;
    assert!(
        matches!(messages.first(), Some(Backend::Notice(text)) if text.contains("already a transaction")),
        "{messages:?}"
    );
    assert_eq!(messages.last(), Some(&Backend::Ready('T')));
}

/// The extended protocol is what JDBC, psycopg3 and node-postgres use. A parameter
/// arrives as text and is compared by the target column's affinity, so `'1'` finds the
/// integer `1` exactly as it would in Postgres.
#[tokio::test]
async fn the_extended_protocol_carries_parameters_and_describes_its_columns() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    let messages = client
        .extended(
            "SELECT owner, balance FROM accounts WHERE id = $1",
            &[Some("1")],
            0,
        )
        .await;
    assert_eq!(
        messages,
        vec![
            Backend::ParseComplete,
            Backend::BindComplete,
            Backend::ParameterDescription(1),
            Backend::Description(vec!["owner".into(), "balance".into()]),
            Backend::Row(vec![Some("ada".into()), Some("1000.00".into())]),
            Backend::Complete("SELECT 1".into()),
            Backend::Ready('I'),
        ]
    );

    // A write reports its rowcount and describes no rows at all.
    let messages = client
        .extended(
            "UPDATE accounts SET balance = balance - $1 WHERE owner = $2",
            &[Some("100.00"), Some("ada")],
            0,
        )
        .await;
    assert!(messages.contains(&Backend::NoData), "{messages:?}");
    assert!(
        messages.contains(&Backend::Complete("UPDATE 1".into())),
        "{messages:?}"
    );
    assert_eq!(balance(&harness.state().await, "ada"), "900.00");

    // A NULL parameter is not an empty string.
    let messages = client
        .extended("SELECT count(*) FROM accounts WHERE owner = $1", &[None], 0)
        .await;
    assert!(
        messages.contains(&Backend::Row(vec![Some("0".into())])),
        "{messages:?}"
    );

    let log = harness.log().await;
    assert!(log.iter().any(|record| record["op"] == "parse"));
    assert!(log.iter().any(|record| record["op"] == "bind"));
    assert!(log.iter().any(|record| record["op"] == "sync"));
    // A parameterised write is still logged as an `UPDATE` on `accounts`, so the same
    // fault rules and the same grading assertions work whichever protocol a driver uses.
    let write = log.iter().find(|record| record["op"] == "UPDATE").unwrap();
    assert_eq!(write["args"]["tables"], json!(["accounts"]));
}

/// A row limit suspends the portal and the client re-executes — the flow a driver uses
/// to stream a large result.
#[tokio::test]
async fn a_row_limit_suspends_the_portal() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    let messages = client
        .extended("SELECT owner FROM accounts ORDER BY id", &[], 1)
        .await;
    assert_eq!(
        messages
            .iter()
            .filter(|m| matches!(m, Backend::Row(_)))
            .count(),
        1
    );
    assert!(messages.contains(&Backend::PortalSuspended), "{messages:?}");

    // The same portal, re-executed: the remaining row, then the completion.
    client
        .conn
        .write(
            &[
                message(b'E', &[cstr(""), 0i32.to_be_bytes().to_vec()].concat()),
                message(b'S', b""),
            ]
            .concat(),
        )
        .await;
    let messages = client.until_ready().await;
    assert_eq!(
        messages,
        vec![
            Backend::Row(vec![Some("grace".into())]),
            Backend::Complete("SELECT 1".into()),
            Backend::Ready('I'),
        ]
    );
}

/// A batch in one `Query` message becomes one op per statement — otherwise the `UPDATE`
/// a fault rule arms against would be a substring of one log entry rather than an entry.
#[tokio::test]
async fn a_batch_becomes_one_op_per_statement_with_one_ready_at_the_end() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    let messages = client
        .query(
            "BEGIN; UPDATE accounts SET balance = balance - 10 WHERE owner = 'ada'; \
             UPDATE accounts SET balance = balance + 10 WHERE owner = 'grace'; COMMIT",
        )
        .await;
    assert_eq!(
        messages
            .iter()
            .filter(|m| matches!(m, Backend::Ready(_)))
            .count(),
        1,
        "one exchange, one ReadyForQuery: {messages:?}"
    );
    assert_eq!(
        messages
            .iter()
            .filter(|m| matches!(m, Backend::Complete(_)))
            .count(),
        4
    );
    assert_eq!(
        lesson_ops(&harness.log().await),
        vec!["BEGIN", "UPDATE", "UPDATE", "COMMIT"]
    );
    assert_eq!(total(&harness.state().await), 150_000);
}

/// An error stops the batch where it happened: the statements after it never run, so
/// they never reach the log either.
#[tokio::test]
async fn an_error_abandons_the_rest_of_the_batch() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    let messages = client
        .query("SELECT 1; SELECT * FROM nope; UPDATE accounts SET balance = 0")
        .await;
    assert_eq!(
        messages
            .iter()
            .filter(|m| matches!(m, Backend::Ready(_)))
            .count(),
        1,
        "{messages:?}"
    );
    assert!(
        messages
            .iter()
            .any(|m| matches!(m, Backend::Error(code, _) if code == "42P01")),
        "{messages:?}"
    );
    // The failing statement is in the log — the pipeline logs before it evaluates, so a
    // grader sees what the student actually sent. What is absent is everything *after*
    // it: the `UPDATE` never ran, so it never happened.
    let ops = lesson_ops(&harness.log().await);
    assert_eq!(ops, vec!["SELECT", "SELECT"], "{ops:?}");
    assert!(!ops.contains(&"UPDATE".to_string()));
    assert_eq!(balance(&harness.state().await, "ada"), "1000.00");
}

/// An empty query string is a real thing clients send, and it has its own reply.
#[tokio::test]
async fn an_empty_query_gets_its_own_message() {
    let harness = start().await;
    let mut client = PgClient::connect(&harness).await;
    assert_eq!(
        client.query("").await,
        vec![Backend::EmptyQuery, Backend::Ready('I')]
    );
    assert_eq!(
        client.query("-- nothing but a comment").await,
        vec![Backend::EmptyQuery, Backend::Ready('I')]
    );
}

// ---------------------------------------------------------------------------
// The rest of the fault surface.
// ---------------------------------------------------------------------------

/// A retryable error on demand, which is what a retry lesson has to retry. The abort
/// that comes with it is the important half: without it the client would be told its
/// transaction was poisoned while the engine went on to commit it.
#[tokio::test]
async fn an_injected_serialization_failure_aborts_the_transaction() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    harness
        .arm(json!({
            "action": "inject_error",
            "after": { "op_matches": "UPDATE", "count": 1 },
            "params": { "sqlstate": "40001" },
        }))
        .await;

    let mut client = PgClient::connect(&harness).await;
    client.query("BEGIN").await;
    let messages = client
        .query("UPDATE accounts SET balance = balance - 100 WHERE owner = 'ada'")
        .await;
    assert!(
        matches!(messages.first(), Some(Backend::Error(code, text))
            if code == "40001" && text.contains("serialize")),
        "{messages:?}"
    );
    assert_eq!(
        messages.last(),
        Some(&Backend::Ready('E')),
        "the block is poisoned, exactly as a real serialization failure poisons it"
    );
    assert_eq!(
        client.query("COMMIT").await.first(),
        Some(&Backend::Complete("ROLLBACK".into()))
    );
    assert_eq!(balance(&harness.state().await, "ada"), "1000.00");

    // The rule is retired, so the student's retry succeeds — which is the lesson.
    transfer_in_transaction(&mut client, "ada", "grace", "100.00").await;
    assert_eq!(balance(&harness.state().await, "ada"), "900.00");
}

/// A deadlock is the same shape with a different code, and the default message reads
/// like the real thing so a student searching the error text finds real answers.
#[tokio::test]
async fn a_deadlock_can_be_injected_by_sqlstate_alone() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    harness
        .arm(json!({
            "action": "inject_error",
            "after": { "op_matches": "write", "count": 1 },
            "params": { "sqlstate": "40P01" },
        }))
        .await;
    let mut client = PgClient::connect(&harness).await;
    let messages = client
        .query("DELETE FROM accounts WHERE owner = 'ada'")
        .await;
    assert_eq!(
        messages.first(),
        Some(&Backend::Error("40P01".into(), "deadlock detected".into()))
    );
    assert_eq!(
        messages.last(),
        Some(&Backend::Ready('I')),
        "no block was open"
    );
    assert_eq!(total(&harness.state().await), 150_000);
}

/// `params.table` narrows a rule to statements touching one table, so an unrelated
/// statement does not consume the rule.
#[tokio::test]
async fn a_rule_can_be_narrowed_to_one_table() {
    let harness = start().await;
    harness
        .seed(json!({
            "schema": [
                "CREATE TABLE accounts (owner TEXT PRIMARY KEY, balance NUMERIC(12,2))",
                "CREATE TABLE audit (note TEXT)",
            ],
            "rows": { "accounts": [{ "owner": "ada", "balance": "1000.00" }] }
        }))
        .await;
    harness
        .arm(json!({
            "action": "inject_error",
            "after": { "op_matches": "write", "count": 1 },
            "params": { "sqlstate": "40001", "table": "accounts" },
        }))
        .await;

    let mut client = PgClient::connect(&harness).await;
    // An unrelated write must not consume the rule.
    assert_eq!(
        client
            .query("INSERT INTO audit (note) VALUES ('hello')")
            .await
            .first(),
        Some(&Backend::Complete("INSERT 0 1".into()))
    );
    let messages = client
        .query("UPDATE accounts SET balance = 0 WHERE owner = 'ada'")
        .await;
    assert!(
        matches!(messages.first(), Some(Backend::Error(code, _)) if code == "40001"),
        "{messages:?}"
    );
}

/// Per-statement latency. `ms = 0` keeps the assertion about the pipeline rather than
/// about a clock, exactly as the echo and cache tests do.
#[tokio::test]
async fn a_statement_can_be_delayed_and_still_runs() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    harness
        .arm(json!({
            "action": "delay",
            "after": { "op_matches": "statement", "count": 1 },
            "params": { "ms": 0 },
        }))
        .await;
    let mut client = PgClient::connect(&harness).await;
    let messages = client
        .query("UPDATE accounts SET balance = balance - 100 WHERE owner = 'ada'")
        .await;
    assert!(
        messages.contains(&Backend::Complete("UPDATE 1".into())),
        "{messages:?}"
    );
    assert_eq!(balance(&harness.state().await, "ada"), "900.00");
    assert_eq!(harness.log().await[2]["fault"], "delay");
}

/// "The database is down" is `after="connect"` — no special case, because the kit emits
/// `connect` as a first-class op.
#[tokio::test]
async fn the_database_can_be_down_before_a_byte_is_read() {
    let harness = start().await;
    harness
        .arm(json!({
            "action": "kill_connection",
            "after": { "op_matches": "connect", "count": 1 },
        }))
        .await;
    let mut conn = harness.connect().await;
    conn.write(&startup_packet(&196_608i32.to_be_bytes())).await;
    assert_eq!(conn.read_bytes(1).await, None, "the socket must be dropped");
}

// ---------------------------------------------------------------------------
// Determinism and reset.
// ---------------------------------------------------------------------------

/// `/reset` rewinds the rows, the log, the rules and the counters together — and, for
/// this emulator, every live session too: a recycled connection id must never inherit
/// the previous test case's open transaction.
#[tokio::test]
async fn reset_rewinds_the_rows_and_forgets_every_session() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;

    let mut client = PgClient::connect(&harness).await;
    client.query("BEGIN").await;
    client
        .query("UPDATE accounts SET balance = 0 WHERE owner = 'ada'")
        .await;
    harness.reset().await;

    let state = harness.state().await;
    assert_eq!(balance(&state, "ada"), "1000.00");
    assert!(harness.log().await.is_empty());

    // A fresh connection takes the recycled id 1 and must start out idle.
    let mut client = PgClient::connect(&harness).await;
    assert_eq!(
        client.query("SELECT 1").await.last(),
        Some(&Backend::Ready('I')),
        "a recycled connection id must not inherit an open transaction"
    );
    assert_eq!(harness.log().await[0]["conn_id"], json!(1));
}

/// The determinism guarantee (`plans/infra-emulators.md` §8): a single-connection
/// scenario run twice produces a byte-identical op log.
#[tokio::test]
async fn the_same_scenario_twice_is_byte_identical() {
    let harness = start().await;
    let mut logs = Vec::new();
    for _ in 0..2 {
        harness.seed(bank_fixture()).await;
        arm_crash_between_the_two_writes(&harness, "UPDATE").await;
        let mut client = PgClient::connect(&harness).await;
        transfer_in_transaction(&mut client, "ada", "grace", "100.00").await;
        assert!(client.is_closed().await);
        logs.push(harness.log_text().await);
        harness.reset().await;
    }
    assert_eq!(
        logs[0], logs[1],
        "identical runs must produce identical logs"
    );
    assert!(!logs[0].is_empty());
}

/// The probes an ORM fires before it will run a lesson's SQL, over the real protocol.
#[tokio::test]
async fn the_catalog_probes_an_orm_opens_with_are_answered() {
    let harness = start().await;
    let mut client = PgClient::connect(&harness).await;

    let value = |messages: &Vec<Backend>| {
        messages
            .iter()
            .find_map(|message| match message {
                Backend::Row(row) => row.first().cloned().flatten(),
                _ => None,
            })
            .unwrap_or_else(|| panic!("expected a row in {messages:?}"))
    };
    assert!(value(&client.query("select pg_catalog.version()").await).starts_with("PostgreSQL"));
    assert_eq!(
        value(&client.query("select current_schema()").await),
        "public"
    );
    // The startup packet said `app` and `student`, and these must agree with it.
    assert_eq!(
        value(&client.query("select current_database()").await),
        "app"
    );
    assert_eq!(value(&client.query("select current_user").await), "student");
    assert_eq!(
        value(&client.query("show standard_conforming_strings").await),
        "on"
    );
    assert_eq!(
        client.query("SET search_path TO public").await.first(),
        Some(&Backend::Complete("SET".into()))
    );
    // `SELECT 1` is not a stub — it reaches the engine and is answered by it.
    assert_eq!(value(&client.query("SELECT 1").await), "1");
}

/// A rule that could never fire is the worst failure mode for a grading harness, so
/// every one of these is refused when it is armed rather than discovered at 3am.
#[tokio::test]
async fn rules_that_could_never_fire_or_would_fire_blind_are_refused() {
    let harness = start().await;
    let rejected = [
        // A trigger the emulator cannot produce.
        json!({ "action": "kill_connection", "after": { "op_matches": "VACUUM", "count": 1 } }),
        json!({ "action": "kill_connection", "after": { "op_matches": "disconnect", "count": 1 } }),
        // An injected error with no SQLSTATE: the code is what a student's `except`
        // clause matches, so defaulting it would make a retry test that never retries.
        json!({ "action": "inject_error", "after": { "op_matches": "UPDATE", "count": 1 } }),
        json!({
            "action": "inject_error",
            "after": { "op_matches": "UPDATE", "count": 1 },
            "params": { "sqlstate": "400" },
        }),
        // A table-scoped rule on a trigger that names no table.
        json!({
            "action": "kill_connection",
            "after": { "op_matches": "connect", "count": 1 },
            "params": { "table": "accounts" },
        }),
        json!({
            "action": "kill_connection",
            "after": { "op_matches": "COMMIT", "count": 1 },
            "params": { "table": "accounts" },
        }),
        json!({
            "action": "kill_connection",
            "after": { "op_matches": "UPDATE", "count": 1 },
            "params": { "table": 7 },
        }),
        // An action no emulator registers.
        json!({ "action": "expire_key", "after": { "op_matches": "UPDATE", "count": 1 } }),
    ];
    for rule in rejected {
        assert!(
            harness.fault(rule.clone()).await.is_client_error(),
            "must be refused: {rule}"
        );
    }

    // And the rules a lesson really writes are accepted.
    for rule in [
        json!({ "action": "kill_connection", "after": { "op_matches": "statement", "count": 3 } }),
        json!({ "action": "kill_connection", "after": { "op_matches": "in_transaction", "count": 1 } }),
        json!({
            "action": "inject_error",
            "after": { "op_matches": "read", "count": 1 },
            "params": { "sqlstate": "40001", "message": "try again", "table": "accounts" },
        }),
        json!({ "action": "delay", "after": { "op_matches": "COMMIT", "count": 1 }, "params": { "ms": 1 } }),
    ] {
        harness.arm(rule).await;
    }
}

/// Binary format is refused rather than mis-decoded: a value read with the wrong codec
/// is a wrong answer that looks like a right one.
#[tokio::test]
async fn binary_parameters_are_refused_by_name() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    let mut bind = [cstr(""), cstr("")].concat();
    bind.extend_from_slice(&1i16.to_be_bytes());
    bind.extend_from_slice(&1i16.to_be_bytes()); // binary
    bind.extend_from_slice(&1i16.to_be_bytes());
    bind.extend_from_slice(&4i32.to_be_bytes());
    bind.extend_from_slice(&1i32.to_be_bytes());
    bind.extend_from_slice(&0i16.to_be_bytes());

    let frames = [
        message(
            b'P',
            &[cstr(""), cstr("SELECT $1"), 0i16.to_be_bytes().to_vec()].concat(),
        ),
        message(b'B', &bind),
        message(b'E', &[cstr(""), 0i32.to_be_bytes().to_vec()].concat()),
        message(b'S', b""),
    ]
    .concat();
    client.conn.write(&frames).await;
    let messages = client.until_ready().await;
    assert!(
        matches!(messages.iter().find(|m| matches!(m, Backend::Error(..))),
            Some(Backend::Error(code, text)) if code == "0A000" && text.contains("binary")),
        "{messages:?}"
    );
    // After an error the extended protocol ignores everything until `Sync`, which then
    // sends the one `ReadyForQuery` the client is waiting for.
    assert_eq!(messages.last(), Some(&Backend::Ready('I')));
    assert_eq!(
        messages
            .iter()
            .filter(|m| matches!(m, Backend::Ready(_)))
            .count(),
        1,
        "{messages:?}"
    );
}

/// A frontend message the emulator does not implement is reported, not ignored.
#[tokio::test]
async fn an_unimplemented_frontend_message_is_reported() {
    let harness = start().await;
    let mut client = PgClient::connect(&harness).await;
    client
        .conn
        .write(&[message(b'W', b""), message(b'S', b"")].concat())
        .await;
    let messages = client.until_ready().await;
    assert!(
        matches!(messages.first(), Some(Backend::Error(code, _)) if code == "08P01"),
        "{messages:?}"
    );
    assert!(harness
        .log()
        .await
        .iter()
        .any(|record| record["op"] == "unknown_message"));
}

/// Constraints are enforced and reported with the SQLSTATE a driver branches on — the
/// `CHECK` on the balance is what stops a lesson from overdrawing an account.
#[tokio::test]
async fn constraint_violations_carry_the_code_a_client_matches_on() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    for (sql, expected) in [
        (
            "UPDATE accounts SET balance = -1 WHERE owner = 'ada'",
            "23514",
        ),
        (
            "INSERT INTO accounts (owner, balance) VALUES ('ada', 1)",
            "23505",
        ),
        (
            "INSERT INTO accounts (owner, balance) VALUES (NULL, 1)",
            "23502",
        ),
        ("SELECT * FROM nope", "42P01"),
        ("SELECT nope FROM accounts", "42703"),
        ("NOT SQL AT ALL", "42601"),
    ] {
        let messages = client.query(sql).await;
        assert!(
            matches!(messages.first(), Some(Backend::Error(code, _)) if code == expected),
            "{sql} should be {expected}: {messages:?}"
        );
        // The connection survives every one of them.
        assert_eq!(messages.last(), Some(&Backend::Ready('I')), "{sql}");
    }
    assert_eq!(total(&harness.state().await), 150_000);
}

/// Two connections hold independent transactions, and a write conflict between them is
/// a real serialization failure — the thing a retry lesson is built on.
#[tokio::test]
async fn two_connections_conflict_and_the_loser_gets_a_retryable_error() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut first = PgClient::connect(&harness).await;
    let mut second = PgClient::connect(&harness).await;

    first.query("BEGIN").await;
    first
        .query("UPDATE accounts SET balance = 1 WHERE owner = 'ada'")
        .await;
    let messages = second
        .query("UPDATE accounts SET balance = 2 WHERE owner = 'ada'")
        .await;
    assert!(
        matches!(messages.first(), Some(Backend::Error(code, _)) if code == "40001"),
        "{messages:?}"
    );
    // Once the first connection lets go, the retry succeeds.
    first.query("ROLLBACK").await;
    assert_eq!(
        second
            .query("UPDATE accounts SET balance = 2 WHERE owner = 'ada'")
            .await
            .first(),
        Some(&Backend::Complete("UPDATE 1".into()))
    );
    assert_eq!(balance(&harness.state().await, "ada"), "2.00");
}

/// Seeding is validated: a fixture that would seed nothing is a 4xx, not a silent
/// empty database a grader would read as "the student deleted everything".
#[tokio::test]
async fn a_broken_fixture_is_refused_at_seed_time() {
    let harness = start().await;
    for body in [
        json!({ "schemas": [] }),
        json!({ "schema": ["CREATE TABLE t (id INT)"], "rows": { "nope": [{ "a": 1 }] } }),
        json!({ "schema": ["NOT SQL"] }),
    ] {
        let status = harness
            .http
            .post(format!("{}/seed", harness.base))
            .json(&{
                let mut body = body.clone();
                body["emulator"] = json!("sql");
                body
            })
            .send()
            .await
            .unwrap()
            .status();
        assert!(status.is_client_error(), "must be refused: {body}");
    }
}

/// `RETURNING` is how a student reads back what a write did, and it is native here.
#[tokio::test]
async fn returning_hands_back_the_row_a_write_produced() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;
    let messages = client
        .query(
            "UPDATE accounts SET balance = balance - 100 WHERE owner = 'ada' \
             RETURNING owner, balance",
        )
        .await;
    assert!(
        messages.contains(&Backend::Row(vec![
            Some("ada".into()),
            Some("900.00".into())
        ])),
        "{messages:?}"
    );
    assert!(
        messages.contains(&Backend::Complete("UPDATE 1".into())),
        "{messages:?}"
    );

    let messages = client
        .query("INSERT INTO accounts (owner, balance) VALUES ('turing', 1) RETURNING id")
        .await;
    assert!(
        messages.contains(&Backend::Row(vec![Some("3".into())])),
        "{messages:?}"
    );
}

/// `Close` releases a prepared statement, and using it afterwards is an error rather
/// than a stale result.
#[tokio::test]
async fn a_closed_statement_is_gone() {
    let harness = start().await;
    harness.seed(bank_fixture()).await;
    let mut client = PgClient::connect(&harness).await;

    let frames = [
        message(
            b'P',
            &[cstr("s1"), cstr("SELECT 1"), 0i16.to_be_bytes().to_vec()].concat(),
        ),
        message(b'C', &[vec![b'S'], cstr("s1")].concat()),
        message(b'B', &bind_body("", "s1", &[])),
        message(b'S', b""),
    ]
    .concat();
    client.conn.write(&frames).await;
    let messages = client.until_ready().await;
    assert!(messages.contains(&Backend::CloseComplete), "{messages:?}");
    assert!(
        messages
            .iter()
            .any(|m| matches!(m, Backend::Error(code, _) if code == "26000")),
        "{messages:?}"
    );
}
