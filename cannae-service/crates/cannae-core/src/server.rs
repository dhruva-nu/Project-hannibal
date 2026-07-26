//! The connection front. Each declared emulator gets a TCP listener; every op runs
//! the normative pipeline (`decode → oplog.append → faults.evaluate → execute-or-fault
//! → respond`). Shared state lives in [`crate::shared::Shared`] so the control plane
//! and the data plane agree on one op log and one fault engine.

use crate::control;
use crate::emulator::{ConnState, Emulator, Op, CONNECT_OP, DISCONNECT_OP};
use crate::shared::Shared;
use serde_json::Value;
use std::io::ErrorKind;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

/// How long to wait out an accept error that retrying cannot immediately fix, so
/// resource pressure backs off instead of spinning a core.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(50);

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

/// What to do about an error from [`TcpListener::accept`].
#[derive(Debug, PartialEq, Eq)]
enum AcceptAction {
    /// The peer vanished mid-handshake. Routine — there is nothing to serve and
    /// nothing worth reporting, so take the next connection immediately.
    Retry,
    /// Anything else: out of descriptors or buffers, or a listener-level failure.
    /// Retrying in a tight loop would burn a core without freeing anything, and a
    /// silently dead port would mis-grade every later lesson — so say so, then wait.
    ReportAndBackOff,
}

fn classify(error: &std::io::Error) -> AcceptAction {
    match error.kind() {
        ErrorKind::ConnectionAborted
        | ErrorKind::ConnectionRefused
        | ErrorKind::ConnectionReset
        | ErrorKind::Interrupted => AcceptAction::Retry,
        _ => AcceptAction::ReportAndBackOff,
    }
}

async fn accept_loop(listener: TcpListener, emu: Arc<dyn Emulator>, shared: Arc<Shared>) {
    loop {
        let error = match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(handle_conn(stream, emu.clone(), shared.clone()));
                continue;
            }
            Err(error) => error,
        };
        if classify(&error) == AcceptAction::ReportAndBackOff {
            eprintln!(
                "{} listener (port {}): accept failed: {error}",
                emu.name(),
                emu.port()
            );
            tokio::time::sleep(ACCEPT_BACKOFF).await;
        }
    }
}

/// Whether the connection loop should keep reading.
enum Flow {
    Continue,
    Break,
}

async fn handle_conn(stream: TcpStream, emu: Arc<dyn Emulator>, shared: Arc<Shared>) {
    // Captured before the id is drawn, so a `/reset` landing anywhere from here on is
    // visible to every check below.
    let mut epoch_changes = shared.epoch_changes();
    let epoch = *epoch_changes.borrow_and_update();

    let conn_id = shared.next_conn_id();
    let mut conn = ConnState { conn_id, seq: 0 };
    let retired = serve_conn(stream, &emu, &shared, &mut conn, &mut epoch_changes, epoch).await;

    // `disconnect` is logged (not evaluated) so reconnects are visible to grading.
    // A retired connection is skipped — the log it belonged to is already gone.
    if !retired && shared.epoch() == epoch {
        shared.append_op(emu.name(), &mut conn, &Op::lifecycle(DISCONNECT_OP));
    }
    // Every path out of the loop above ends here, including a retired connection and a
    // socket a `kill_connection` fault dropped — so an emulator holding per-connection
    // state (an open transaction, a statement cache) always gets to release it.
    emu.end_conn(&conn);
}

/// Run one connection's op loop. Returns whether a `/reset` retired it, which decides
/// whether its `disconnect` still belongs in the log.
async fn serve_conn(
    stream: TcpStream,
    emu: &Arc<dyn Emulator>,
    shared: &Arc<Shared>,
    conn: &mut ConnState,
    epoch_changes: &mut watch::Receiver<u64>,
    epoch: u64,
) -> bool {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    // `connect` is a first-class op, so `after="connect"` faults (e.g. "the DB is
    // down") fire before a single byte is read.
    let connect = Op::lifecycle(CONNECT_OP);
    let mut open = matches!(
        dispatch(&connect, emu, shared, conn, &mut write_half, epoch).await,
        Flow::Continue
    );

    while open {
        // A `/reset` retires this connection: its test case is over and its id has
        // been recycled, so it must stop reading and log nothing further.
        let decoded = tokio::select! {
            decoded = emu.decode(conn, &mut reader) => decoded,
            _ = epoch_changes.changed() => return true,
        };
        match decoded {
            Ok(Some(op)) => {
                open = matches!(
                    dispatch(&op, emu, shared, conn, &mut write_half, epoch).await,
                    Flow::Continue
                );
            }
            Ok(None) | Err(_) => break,
        }
    }
    false
}

/// One turn of the normative pipeline for a single op. `epoch` is the value captured
/// when the connection was accepted; a mismatch means a `/reset` retired it.
async fn dispatch(
    op: &Op,
    emu: &Arc<dyn Emulator>,
    shared: &Arc<Shared>,
    conn: &mut ConnState,
    write_half: &mut OwnedWriteHalf,
    epoch: u64,
) -> Flow {
    // Re-checked here because `decode` and `epoch_changes.changed()` can become ready
    // together and `select!` may pick either: without this, an op decoded just as a
    // reset landed would enter the new log under a recycled conn id.
    if shared.epoch() != epoch {
        return Flow::Break;
    }
    let token = shared.append_op(emu.name(), conn, op);
    let Some(hit) = shared.evaluate(emu, conn.conn_id, op) else {
        return respond(write_half, emu.execute(conn, op)).await;
    };
    shared.annotate(token, &hit.action);
    match hit.action.as_str() {
        // The op is logged (above) but never executed — the socket just drops.
        "kill_connection" => Flow::Break,
        // Send a protocol error frame instead of executing; the connection lives on.
        "inject_error" => respond(write_half, emu.encode_error(conn, op, &hit.params)).await,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_vanished_peer_is_retried_without_noise() {
        for kind in [
            ErrorKind::ConnectionAborted,
            ErrorKind::ConnectionRefused,
            ErrorKind::ConnectionReset,
            ErrorKind::Interrupted,
        ] {
            let error = std::io::Error::new(kind, "peer gave up");
            assert_eq!(classify(&error), AcceptAction::Retry, "{kind:?}");
        }
    }

    #[test]
    fn resource_exhaustion_and_listener_failures_back_off() {
        // EMFILE / ENFILE arrive as raw OS errors, not a named `ErrorKind` — the point
        // of the catch-all arm is that they must never fall into the tight-retry path.
        let too_many_files = std::io::Error::from_raw_os_error(24);
        assert_eq!(
            classify(&too_many_files),
            AcceptAction::ReportAndBackOff,
            "EMFILE must back off, not spin"
        );
        assert_eq!(
            classify(&std::io::Error::from(ErrorKind::OutOfMemory)),
            AcceptAction::ReportAndBackOff
        );
        assert_eq!(
            classify(&std::io::Error::from(ErrorKind::PermissionDenied)),
            AcceptAction::ReportAndBackOff
        );
    }
}
