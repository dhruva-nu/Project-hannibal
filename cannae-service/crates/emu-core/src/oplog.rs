//! The operation log — the grading source of truth. Append-only, ordered by a
//! logical `ordinal` counter (never wall clock), so identical runs produce
//! byte-identical logs.

use crate::emulator::Op;
use serde::Serialize;
use serde_json::Value;

/// One recorded operation. `fault` names the action if a rule fired on this op.
#[derive(Clone, Serialize)]
pub struct OpRecord {
    pub emulator: String,
    pub conn_id: u64,
    pub seq: u64,
    pub ordinal: u64,
    pub op: String,
    pub args: Value,
    pub fault: Option<String>,
}

/// Append-only log shared across all connections of all emulators.
#[derive(Default)]
pub struct OpLog {
    records: Vec<OpRecord>,
    ordinal: u64,
}

impl OpLog {
    /// Append one op, returning its index so a fault can be annotated onto it later.
    pub fn append(&mut self, emulator: &str, conn_id: u64, seq: u64, op: &Op) -> usize {
        let record = OpRecord {
            emulator: emulator.to_string(),
            conn_id,
            seq,
            ordinal: self.ordinal,
            op: op.op.clone(),
            args: op.args.clone(),
            fault: None,
        };
        self.ordinal += 1;
        self.records.push(record);
        self.records.len() - 1
    }

    /// Record that `action` fired on the op at `index`.
    pub fn annotate(&mut self, index: usize, action: &str) {
        self.records[index].fault = Some(action.to_string());
    }

    /// Wipe the log and reset the ordinal — a fresh test case, deterministic from zero.
    pub fn clear(&mut self) {
        self.records.clear();
        self.ordinal = 0;
    }

    /// All records, or only those for one emulator.
    pub fn filter(&self, emulator: Option<&str>) -> Vec<OpRecord> {
        match emulator {
            Some(name) => self
                .records
                .iter()
                .filter(|record| record.emulator == name)
                .cloned()
                .collect(),
            None => self.records.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn op(kind: &str) -> Op {
        Op {
            op: kind.to_string(),
            args: json!({"k": kind}),
        }
    }

    #[test]
    fn ordinal_is_monotonic_and_seq_is_carried() {
        let mut log = OpLog::default();
        let first = log.append("echo", 1, 0, &op("connect"));
        let second = log.append("echo", 1, 1, &op("ECHO"));
        assert_eq!((first, second), (0, 1));
        let records = log.filter(None);
        assert_eq!(records[0].ordinal, 0);
        assert_eq!(records[1].ordinal, 1);
        assert_eq!(records[1].seq, 1);
        assert!(records[0].fault.is_none());
    }

    #[test]
    fn annotate_marks_the_fault() {
        let mut log = OpLog::default();
        let idx = log.append("echo", 1, 0, &op("ECHO"));
        log.annotate(idx, "kill_connection");
        assert_eq!(
            log.filter(None)[0].fault.as_deref(),
            Some("kill_connection")
        );
    }

    #[test]
    fn clear_resets_records_and_ordinal() {
        let mut log = OpLog::default();
        log.append("echo", 1, 0, &op("ECHO"));
        log.clear();
        assert!(log.filter(None).is_empty());
        // Ordinal restarts at zero so the next run is byte-identical.
        log.append("echo", 1, 0, &op("ECHO"));
        assert_eq!(log.filter(None)[0].ordinal, 0);
    }

    #[test]
    fn filter_selects_by_emulator() {
        let mut log = OpLog::default();
        log.append("echo", 1, 0, &op("ECHO"));
        log.append("cache", 2, 0, &op("GET"));
        assert_eq!(log.filter(Some("echo")).len(), 1);
        assert_eq!(log.filter(Some("cache")).len(), 1);
        assert_eq!(log.filter(Some("nope")).len(), 0);
        assert_eq!(log.filter(None).len(), 2);
    }
}
