//! The connection front and shared state. Each declared emulator gets a TCP
//! listener; every op runs the normative pipeline
//! (`decode → oplog.append → faults.evaluate → execute-or-fault → respond`).
//! The control plane and the data plane share one [`Shared`] so a fault armed on
//! the control API fires on the student's own traffic.

use crate::control;
use crate::emulator::{ConnState, Emulator, Op};
use crate::faults::{FaultEngine, FaultHit, FaultRule};
use crate::oplog::{OpLog, OpRecord};
use serde_json::Value;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream};

/// State shared between the control plane and every connection. Connection ids come
/// from a single counter so `conn="next"` scoping and reset are deterministic.
pub struct Shared {
    oplog: Mutex<OpLog>,
    faults: Mutex<FaultEngine>,
    baselines: Mutex<HashMap<String, Value>>,
    conn_counter: AtomicU64,
    pub(crate) emulators: HashMap<String, Arc<dyn Emulator>>,
}

impl Shared {
    pub fn new(emulators: Vec<Arc<dyn Emulator>>) -> Arc<Self> {
        let emulators = emulators
            .into_iter()
            .map(|emu| (emu.name().to_string(), emu))
            .collect();
        Arc::new(Self {
            oplog: Mutex::new(OpLog::default()),
            faults: Mutex::new(FaultEngine::default()),
            baselines: Mutex::new(HashMap::new()),
            conn_counter: AtomicU64::new(1),
            emulators,
        })
    }

    fn next_conn_id(&self) -> u64 {
        self.conn_counter.fetch_add(1, Ordering::SeqCst)
    }

    /// The id the next accepted connection will get — used to bind `conn="next"` rules.
    pub(crate) fn peek_conn_id(&self) -> u64 {
        self.conn_counter.load(Ordering::SeqCst)
    }

    fn append_op(&self, emulator: &str, conn: &mut ConnState, op: &Op) -> usize {
        let seq = conn.seq;
        conn.seq += 1;
        self.oplog
            .lock()
            .unwrap()
            .append(emulator, conn.conn_id, seq, op)
    }

    fn annotate(&self, index: usize, action: &str) {
        self.oplog.lock().unwrap().annotate(index, action);
    }

    fn evaluate(&self, emu: &Arc<dyn Emulator>, conn_id: u64, op: &Op) -> Option<FaultHit> {
        self.faults
            .lock()
            .unwrap()
            .evaluate(emu.name(), op, conn_id, &**emu)
    }

    pub(crate) fn log_records(&self, emulator: Option<&str>) -> Vec<OpRecord> {
        self.oplog.lock().unwrap().filter(emulator)
    }

    pub(crate) fn install_fault(&self, rule: FaultRule) {
        self.faults.lock().unwrap().install(rule);
    }

    pub(crate) fn clear_faults(&self) {
        self.faults.lock().unwrap().clear();
    }

    pub(crate) fn set_baseline(&self, name: &str, snapshot: Value) {
        self.baselines
            .lock()
            .unwrap()
            .insert(name.to_string(), snapshot);
    }

    /// Restore every emulator's seeded baseline and wipe the log, rules, and counters —
    /// a fresh test case, deterministic from zero.
    pub(crate) fn reset(&self) {
        let baselines = self.baselines.lock().unwrap();
        for (name, snapshot) in baselines.iter() {
            if let Some(emu) = self.emulators.get(name) {
                emu.restore(snapshot);
            }
        }
        drop(baselines);
        self.oplog.lock().unwrap().clear();
        self.faults.lock().unwrap().clear();
        self.conn_counter.store(1, Ordering::SeqCst);
    }
}

/// The running service: the shared state plus the machinery to serve it.
pub struct Emu {
    shared: Arc<Shared>,
}

impl Emu {
    pub fn new(emulators: Vec<Arc<dyn Emulator>>) -> Self {
        Self {
            shared: Shared::new(emulators),
        }
    }

    /// Bind one TCP listener per declared emulator, then serve the control plane on
    /// `control_addr`. Runs until the control server stops.
    pub async fn serve(self, control_addr: SocketAddr) -> std::io::Result<()> {
        for emu in self.shared.emulators.values() {
            let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), emu.port());
            let listener = TcpListener::bind(addr).await?;
            let shared = self.shared.clone();
            let emu = emu.clone();
            tokio::spawn(accept_loop(listener, emu, shared));
        }
        let app = control::router(self.shared.clone());
        let listener = TcpListener::bind(control_addr).await?;
        axum::serve(listener, app).await
    }
}

async fn accept_loop(listener: TcpListener, emu: Arc<dyn Emulator>, shared: Arc<Shared>) {
    loop {
        if let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(handle_conn(stream, emu.clone(), shared.clone()));
        }
    }
}

/// Whether the connection loop should keep reading.
enum Flow {
    Continue,
    Break,
}

async fn handle_conn(stream: TcpStream, emu: Arc<dyn Emulator>, shared: Arc<Shared>) {
    let conn_id = shared.next_conn_id();
    let mut conn = ConnState { conn_id, seq: 0 };
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    // `connect` is a first-class op, so `after="connect"` faults (e.g. "the DB is
    // down") fire before a single byte is read.
    let connect = Op::lifecycle("connect");
    let mut open = matches!(
        dispatch(&connect, &emu, &shared, &mut conn, &mut write_half).await,
        Flow::Continue
    );

    while open {
        match emu.decode(&mut conn, &mut reader).await {
            Ok(Some(op)) => {
                open = matches!(
                    dispatch(&op, &emu, &shared, &mut conn, &mut write_half).await,
                    Flow::Continue
                );
            }
            Ok(None) | Err(_) => break,
        }
    }

    // `disconnect` is logged (not evaluated) so reconnects are visible to grading.
    shared.append_op(emu.name(), &mut conn, &Op::lifecycle("disconnect"));
}

/// One turn of the normative pipeline for a single op.
async fn dispatch(
    op: &Op,
    emu: &Arc<dyn Emulator>,
    shared: &Arc<Shared>,
    conn: &mut ConnState,
    write_half: &mut OwnedWriteHalf,
) -> Flow {
    let index = shared.append_op(emu.name(), conn, op);
    let Some(hit) = shared.evaluate(emu, conn.conn_id, op) else {
        return respond(write_half, emu.execute(conn, op)).await;
    };
    shared.annotate(index, &hit.action);
    match hit.action.as_str() {
        // The op is logged (above) but never executed — the socket just drops.
        "kill_connection" => Flow::Break,
        // Send a protocol error frame instead of executing; the connection lives on.
        "inject_error" => respond(write_half, emu.encode_error(&hit.params)).await,
        // Stall, then execute normally. `ms=0` keeps tests deterministic and fast.
        "delay" => {
            let ms = hit.params.get("ms").and_then(Value::as_u64).unwrap_or(0);
            if ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
            }
            respond(write_half, emu.execute(conn, op)).await
        }
        // A protocol-registered action supplies the replacement bytes itself.
        other => respond(write_half, emu.apply_fault(other, &hit.params, conn, op)).await,
    }
}

async fn respond(write_half: &mut OwnedWriteHalf, bytes: Vec<u8>) -> Flow {
    if !bytes.is_empty() && write_half.write_all(&bytes).await.is_err() {
        return Flow::Break;
    }
    Flow::Continue
}
