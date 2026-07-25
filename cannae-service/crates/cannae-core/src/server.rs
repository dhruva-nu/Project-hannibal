//! The connection front. Each declared emulator gets a TCP listener; every op runs
//! the normative pipeline (`decode → oplog.append → faults.evaluate → execute-or-fault
//! → respond`). Shared state lives in [`crate::shared::Shared`] so the control plane
//! and the data plane agree on one op log and one fault engine.

use crate::control;
use crate::emulator::{ConnState, Emulator, Op};
use crate::shared::Shared;
use serde_json::Value;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream};

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
    let token = shared.append_op(emu.name(), conn, op);
    let Some(hit) = shared.evaluate(emu, conn.conn_id, op) else {
        return respond(write_half, emu.execute(conn, op)).await;
    };
    shared.annotate(token, &hit.action);
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
