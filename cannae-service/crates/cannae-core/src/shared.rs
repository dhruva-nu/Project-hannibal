//! State shared between the control plane and every connection: the op log, the
//! fault engine, seeded baselines, and the connection-id counter. A fault armed
//! on the control API and a connection running on the data plane both go through
//! this one struct, which is what lets `db.fail(...)` reach the student's socket.

use crate::emulator::{ConnState, Emulator, Op};
use crate::faults::{FaultEngine, FaultHit, FaultRule};
use crate::oplog::{OpLog, OpRecord, OpToken};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

/// State shared between the control plane and every connection. Connection ids come
/// from a single counter so `conn="next"` scoping and reset are deterministic.
pub struct Shared {
    oplog: Mutex<OpLog>,
    faults: Mutex<FaultEngine>,
    baselines: Mutex<HashMap<String, Value>>,
    conn_counter: AtomicU64,
    /// Bumped by every [`Shared::reset`]. A connection captures the epoch it was
    /// accepted in and stops the moment that value changes, which is what makes
    /// rewinding `conn_counter` safe — see [`Shared::reset`].
    epoch: watch::Sender<u64>,
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
            epoch: watch::channel(0).0,
            emulators,
        })
    }

    /// The current epoch. A connection compares this against the one it captured to
    /// tell whether a `/reset` has retired it.
    pub(crate) fn epoch(&self) -> u64 {
        *self.epoch.borrow()
    }

    /// A receiver that fires on the next `/reset`. Taken at accept time so no bump can
    /// be missed between iterations of the connection loop.
    pub(crate) fn epoch_changes(&self) -> watch::Receiver<u64> {
        self.epoch.subscribe()
    }

    pub(crate) fn next_conn_id(&self) -> u64 {
        self.conn_counter.fetch_add(1, Ordering::SeqCst)
    }

    /// The id the next accepted connection will get — used to bind `conn="next"` rules.
    pub(crate) fn peek_conn_id(&self) -> u64 {
        self.conn_counter.load(Ordering::SeqCst)
    }

    pub(crate) fn append_op(&self, emulator: &str, conn: &mut ConnState, op: &Op) -> OpToken {
        let seq = conn.seq;
        conn.seq += 1;
        self.oplog
            .lock()
            .unwrap()
            .append(emulator, conn.conn_id, seq, op)
    }

    /// Record that `action` fired on the op `token` points at. A no-op if a
    /// `/reset` cleared the log in between — see [`OpLog::annotate`].
    pub(crate) fn annotate(&self, token: OpToken, action: &str) {
        self.oplog.lock().unwrap().annotate(token, action);
    }

    pub(crate) fn evaluate(
        &self,
        emu: &Arc<dyn Emulator>,
        conn_id: u64,
        op: &Op,
    ) -> Option<FaultHit> {
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
    ///
    /// Rewinding `conn_counter` is what keeps op logs byte-identical across runs, but it
    /// recycles ids that connections from the previous test case may still hold. Bumping
    /// the epoch first retires every one of them, so a recycled id can never name two
    /// live sockets at once.
    pub(crate) fn reset(&self) {
        self.epoch.send_modify(|epoch| *epoch += 1);

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
