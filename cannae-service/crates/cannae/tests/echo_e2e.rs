//! End-to-end acceptance test for Phase 0 (#132).
//!
//! Drives the control plane over raw HTTP and the data plane over raw TCP — the
//! same two-audience shape the real lessons use (`plans/example_*.md`), just
//! without a Python handle. Proves: echo runs on the kit, faults arm on the
//! control plane and fire on the data plane, and the op log is byte-identical
//! across identical runs.

use emu_core::Emu;
use emu_echo::EchoEmulator;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;

/// Grab a free TCP port by binding to :0 and releasing it.
fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// A running emulator plus the URLs a test needs to talk to it.
struct Harness {
    base: String,
    echo_port: u16,
    http: reqwest::Client,
}

impl Harness {
    async fn start() -> Self {
        let echo_port = free_port();
        let control_port = free_port();
        let emu = Arc::new(EchoEmulator::with_port(echo_port));
        let server = Emu::new(vec![emu]);
        let addr = format!("127.0.0.1:{control_port}").parse().unwrap();
        tokio::spawn(async move { server.serve(addr).await.unwrap() });

        let harness = Harness {
            base: format!("http://127.0.0.1:{control_port}"),
            echo_port,
            http: reqwest::Client::new(),
        };
        for _ in 0..100 {
            if harness.http.get(harness.log_url()).send().await.is_ok() {
                return harness;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("control plane never came up");
    }

    fn log_url(&self) -> String {
        format!("{}/log?emulator=echo", self.base)
    }

    async fn seed(&self, prefix: &str) {
        let status = self
            .http
            .post(format!("{}/seed", self.base))
            .json(&json!({ "emulator": "echo", "prefix": prefix }))
            .send()
            .await
            .unwrap()
            .status();
        assert!(status.is_success(), "seed failed: {status}");
    }

    async fn fault(&self, body: Value) -> reqwest::StatusCode {
        self.http
            .post(format!("{}/faults", self.base))
            .json(&body)
            .send()
            .await
            .unwrap()
            .status()
    }

    async fn reset(&self) {
        self.http
            .post(format!("{}/reset", self.base))
            .send()
            .await
            .unwrap();
    }

    async fn log(&self) -> Vec<Value> {
        self.http
            .get(self.log_url())
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }

    async fn log_text(&self) -> String {
        self.http
            .get(self.log_url())
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap()
    }

    async fn state(&self) -> Value {
        self.http
            .get(format!("{}/state?emulator=echo", self.base))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }

    async fn connect(&self) -> EchoClient {
        let stream = TcpStream::connect(("127.0.0.1", self.echo_port))
            .await
            .unwrap();
        let (read_half, writer) = stream.into_split();
        EchoClient {
            reader: BufReader::new(read_half),
            writer,
        }
    }

    /// Poll the op log until it holds `expected` records (lets async `disconnect`
    /// logging settle before we read).
    async fn wait_for_log(&self, expected: usize) -> Vec<Value> {
        for _ in 0..100 {
            let records = self.log().await;
            if records.len() == expected {
                return records;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("log never reached {expected} records");
    }
}

struct EchoClient {
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
}

impl EchoClient {
    async fn send(&mut self, line: &str) {
        self.writer
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
    }

    /// A line reply, or `None` if the connection was closed.
    async fn recv(&mut self) -> Option<String> {
        let mut line = String::new();
        match self.reader.read_line(&mut line).await.unwrap() {
            0 => None,
            _ => Some(line),
        }
    }
}

#[tokio::test]
async fn echoes_seeded_prefix() {
    let h = Harness::start().await;
    h.seed(">>").await;
    let mut client = h.connect().await;
    client.send("hello").await;
    assert_eq!(client.recv().await.as_deref(), Some(">>hello\n"));
    assert_eq!(h.state().await["echo_count"], 1);
}

#[tokio::test]
async fn kill_connection_fires_at_the_scripted_op() {
    let h = Harness::start().await;
    h.seed(">>").await;
    // Arm before connecting: counting starts at arm time.
    let status = h
        .fault(json!({
            "emulator": "echo", "action": "kill_connection",
            "after": { "op_matches": "ECHO", "count": 2 }
        }))
        .await;
    assert!(status.is_success());

    let mut client = h.connect().await;
    client.send("a").await;
    assert_eq!(client.recv().await.as_deref(), Some(">>a\n"));
    client.send("b").await; // 2nd ECHO → kill
    assert_eq!(client.recv().await, None, "socket should be dropped");

    let log = h.wait_for_log(4).await; // connect, ECHO a, ECHO b, disconnect
    assert_eq!(log[0]["op"], "connect");
    assert_eq!(log[2]["op"], "ECHO");
    assert_eq!(log[2]["fault"], "kill_connection");
    assert_eq!(log[3]["op"], "disconnect");
    // The killed op never executed, so only "a" was counted.
    assert_eq!(h.state().await["echo_count"], 1);
}

#[tokio::test]
async fn inject_error_replaces_the_reply_but_keeps_the_connection() {
    let h = Harness::start().await;
    h.seed("").await;
    h.fault(json!({
        "emulator": "echo", "action": "inject_error",
        "after": { "op_matches": "ECHO", "count": 1 },
        "params": { "resp_error": "boom" }
    }))
    .await;

    let mut client = h.connect().await;
    client.send("x").await;
    assert_eq!(client.recv().await.as_deref(), Some("-boom\n"));
    client.send("y").await; // connection still open, executes normally
    assert_eq!(client.recv().await.as_deref(), Some("y\n"));
    assert_eq!(h.state().await["echo_count"], 1); // only "y" executed
}

#[tokio::test]
async fn protocol_action_supplies_replacement_bytes() {
    let h = Harness::start().await;
    h.seed("").await;
    h.fault(json!({
        "emulator": "echo", "action": "corrupt",
        "after": { "op_matches": "ECHO", "count": 1 }
    }))
    .await;

    let mut client = h.connect().await;
    client.send("hi").await;
    assert_eq!(client.recv().await.as_deref(), Some("CORRUPTED\n"));
}

#[tokio::test]
async fn delay_action_still_executes() {
    let h = Harness::start().await;
    h.seed("").await;
    h.fault(json!({
        "emulator": "echo", "action": "delay",
        "after": { "op_matches": "ECHO", "count": 1 },
        "params": { "ms": 0 }
    }))
    .await;

    let mut client = h.connect().await;
    client.send("z").await;
    assert_eq!(client.recv().await.as_deref(), Some("z\n"));
    assert_eq!(h.log().await[1]["fault"], "delay");
}

#[tokio::test]
async fn after_connect_fires_before_any_bytes() {
    let h = Harness::start().await;
    h.fault(json!({
        "emulator": "echo", "action": "kill_connection",
        "after": { "op_matches": "connect", "count": 1 }
    }))
    .await;

    let mut client = h.connect().await;
    assert_eq!(client.recv().await, None, "killed on connect");

    let log = h.wait_for_log(2).await;
    assert_eq!(log[0]["op"], "connect");
    assert_eq!(log[0]["fault"], "kill_connection");
    assert_eq!(log[1]["op"], "disconnect");
}

#[tokio::test]
async fn conn_next_targets_only_the_next_connection() {
    let h = Harness::start().await;
    h.seed(">>").await;
    h.fault(json!({
        "emulator": "echo", "action": "kill_connection",
        "after": { "op_matches": "ECHO", "count": 1 },
        "conn": "next"
    }))
    .await;

    let mut first = h.connect().await; // the targeted connection
    first.send("a").await;
    assert_eq!(first.recv().await, None, "first connection is killed");

    let mut second = h.connect().await; // not targeted
    second.send("b").await;
    assert_eq!(second.recv().await.as_deref(), Some(">>b\n"));
}

#[tokio::test]
async fn reset_restores_baseline_and_faults() {
    let h = Harness::start().await;
    h.seed(">>").await;
    let mut client = h.connect().await;
    client.send("a").await;
    client.recv().await;
    drop(client);
    h.wait_for_log(3).await; // connect, ECHO, disconnect

    h.reset().await;
    assert!(h.log().await.is_empty(), "log cleared");
    assert_eq!(h.state().await["echo_count"], 0, "baseline restored");
}

#[tokio::test]
async fn same_scenario_twice_is_byte_identical() {
    let h = Harness::start().await;

    async fn scenario(h: &Harness) -> String {
        h.seed(">>").await;
        let mut client = h.connect().await;
        for line in ["a", "b", "c"] {
            client.send(line).await;
            client.recv().await;
        }
        drop(client);
        h.wait_for_log(5).await; // connect, 3x ECHO, disconnect
        h.log_text().await
    }

    let first = scenario(&h).await;
    h.reset().await;
    let second = scenario(&h).await;
    assert_eq!(first, second, "op logs must be byte-identical across runs");
}

#[tokio::test]
async fn control_plane_validates_on_install() {
    let h = Harness::start().await;
    let bad = reqwest::StatusCode::BAD_REQUEST;

    // Unknown emulator / action / missing trigger / bad conn scope.
    assert_eq!(
        h.fault(json!({ "emulator": "nope", "action": "kill_connection",
                        "after": { "op_matches": "ECHO", "count": 1 } }))
            .await,
        bad
    );
    assert_eq!(
        h.fault(json!({ "emulator": "echo", "action": "bogus",
                        "after": { "op_matches": "ECHO", "count": 1 } }))
            .await,
        bad
    );
    assert_eq!(
        h.fault(json!({ "emulator": "echo", "action": "kill_connection" }))
            .await,
        bad
    );
    assert_eq!(
        h.fault(json!({ "emulator": "echo", "action": "kill_connection",
                        "after": { "op_matches": "ECHO", "count": 1 }, "conn": "weird" }))
            .await,
        bad
    );

    // A numeric conn id is accepted, and rules can be cleared.
    assert!(h
        .fault(json!({ "emulator": "echo", "action": "kill_connection",
                       "after": { "op_matches": "ECHO", "count": 1 }, "conn": 1 }))
        .await
        .is_success());
    assert!(h
        .http
        .delete(format!("{}/faults", h.base))
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
}

#[tokio::test]
async fn seed_and_state_reject_bad_requests() {
    let h = Harness::start().await;
    let bad = reqwest::StatusCode::BAD_REQUEST;

    // Seed without an emulator field.
    assert_eq!(
        h.http
            .post(format!("{}/seed", h.base))
            .json(&json!({ "prefix": ">>" }))
            .send()
            .await
            .unwrap()
            .status(),
        bad
    );
    // Seed with a non-string prefix (emulator-level validation).
    assert_eq!(
        h.http
            .post(format!("{}/seed", h.base))
            .json(&json!({ "emulator": "echo", "prefix": 7 }))
            .send()
            .await
            .unwrap()
            .status(),
        bad
    );
    // State without an emulator query.
    assert_eq!(
        h.http
            .get(format!("{}/state", h.base))
            .send()
            .await
            .unwrap()
            .status(),
        bad
    );
    // State for an unknown emulator.
    assert_eq!(
        h.http
            .get(format!("{}/state?emulator=nope", h.base))
            .send()
            .await
            .unwrap()
            .status(),
        bad
    );
}
