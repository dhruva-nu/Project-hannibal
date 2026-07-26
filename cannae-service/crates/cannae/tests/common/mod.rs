//! Shared scaffolding for the end-to-end tests: boot an emulator in-process, drive
//! its control plane over raw HTTP and its data plane over raw TCP — the same
//! two-audience shape the real lessons use (`plans/example_*.md`).

#![allow(dead_code)] // Each e2e target uses a different slice of this.

use cannae_core::{Emu, Emulator};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;

/// Hand out a free TCP port, distinct from every port already handed out.
///
/// Probing with :0 and releasing races: tests run concurrently, so two harnesses can
/// be handed the same port in the window before either one's server binds it — the
/// loser then dies with `AddrInUse`. Remembering the handouts closes that window.
pub fn free_port() -> u16 {
    static CLAIMED: Mutex<Vec<u16>> = Mutex::new(Vec::new());

    let mut claimed = CLAIMED.lock().unwrap();
    loop {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        if !claimed.contains(&port) {
            claimed.push(port);
            return port;
        }
    }
}

/// A running emulator plus the URLs a test needs to talk to it.
pub struct Harness {
    pub base: String,
    pub emulator: &'static str,
    pub data_port: u16,
    pub http: reqwest::Client,
}

impl Harness {
    /// Boot `emulator` on a free data port with its control plane on another, and
    /// block until the control plane answers.
    pub async fn start(
        emulator: &'static str,
        build: impl FnOnce(u16) -> Arc<dyn Emulator>,
    ) -> Self {
        let data_port = free_port();
        let control_port = free_port();
        let server = Emu::new(vec![build(data_port)]);
        let addr = format!("127.0.0.1:{control_port}").parse().unwrap();
        tokio::spawn(async move { server.serve(addr).await.unwrap() });

        let harness = Harness {
            base: format!("http://127.0.0.1:{control_port}"),
            emulator,
            data_port,
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

    pub fn log_url(&self) -> String {
        format!("{}/log?emulator={}", self.base, self.emulator)
    }

    /// `POST /seed`, with `emulator` filled in. Panics on rejection — a test that
    /// seeds badly must fail there, not three assertions later.
    pub async fn seed(&self, mut body: Value) {
        body["emulator"] = json!(self.emulator);
        let status = self.post("seed", &body).await;
        assert!(status.is_success(), "seed failed: {status}");
    }

    /// `POST /faults`, with `emulator` filled in. Returns the status so validation
    /// tests can assert on a 4xx.
    pub async fn fault(&self, mut body: Value) -> reqwest::StatusCode {
        body["emulator"] = json!(self.emulator);
        self.post("faults", &body).await
    }

    /// `POST /faults` exactly as given — for the tests that check what happens when
    /// the `emulator` field itself is wrong.
    pub async fn fault_raw(&self, body: Value) -> reqwest::StatusCode {
        self.post("faults", &body).await
    }

    /// Like [`Self::fault`], but asserts the rule was accepted.
    pub async fn arm(&self, body: Value) {
        let status = self.fault(body.clone()).await;
        assert!(status.is_success(), "arming {body} failed: {status}");
    }

    pub async fn reset(&self) {
        self.post("reset", &json!({})).await;
    }

    async fn post(&self, path: &str, body: &Value) -> reqwest::StatusCode {
        self.http
            .post(format!("{}/{path}", self.base))
            .json(body)
            .send()
            .await
            .unwrap()
            .status()
    }

    pub async fn log(&self) -> Vec<Value> {
        self.http
            .get(self.log_url())
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }

    pub async fn log_text(&self) -> String {
        self.http
            .get(self.log_url())
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap()
    }

    /// The op types in the log, in order — what a grader reads to answer "did they
    /// check the cache before the backing store?".
    pub async fn op_names(&self) -> Vec<String> {
        self.log()
            .await
            .iter()
            .map(|record| record["op"].as_str().unwrap_or_default().to_string())
            .collect()
    }

    pub async fn state(&self) -> Value {
        self.http
            .get(format!("{}/state?emulator={}", self.base, self.emulator))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }

    pub async fn connect(&self) -> Conn {
        let stream = TcpStream::connect(("127.0.0.1", self.data_port))
            .await
            .unwrap();
        let (read_half, writer) = stream.into_split();
        Conn {
            reader: BufReader::new(read_half),
            writer,
        }
    }

    /// Poll the op log until it holds `expected` records (lets async `disconnect`
    /// logging settle before we read).
    pub async fn wait_for_log(&self, expected: usize) -> Vec<Value> {
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

/// One client connection to the data plane.
pub struct Conn {
    pub reader: BufReader<OwnedReadHalf>,
    pub writer: OwnedWriteHalf,
}

impl Conn {
    pub async fn write(&mut self, bytes: &[u8]) {
        // A closed socket is a legitimate outcome (a `kill_connection` rule fired),
        // so a failed write is left for the following read to observe.
        let _ = self.writer.write_all(bytes).await;
    }

    pub async fn send_line(&mut self, line: &str) {
        self.write(format!("{line}\n").as_bytes()).await;
    }

    /// One line of reply, or `None` if the connection was closed.
    pub async fn read_line(&mut self) -> Option<String> {
        let mut line = String::new();
        match self.reader.read_line(&mut line).await.unwrap() {
            0 => None,
            _ => Some(line),
        }
    }

    /// Exactly `count` bytes, or `None` if the connection closed first.
    pub async fn read_bytes(&mut self, count: usize) -> Option<Vec<u8>> {
        let mut buf = vec![0u8; count];
        self.reader.read_exact(&mut buf).await.ok()?;
        Some(buf)
    }

    /// Like [`Self::read_line`], but panics instead of blocking forever if the server
    /// neither replies nor closes — so a regression fails the test rather than
    /// hanging CI until the job timeout.
    pub async fn read_line_or_timeout(&mut self) -> Option<String> {
        tokio::time::timeout(Duration::from_secs(5), self.read_line())
            .await
            .expect("server neither replied nor closed the connection")
    }
}
