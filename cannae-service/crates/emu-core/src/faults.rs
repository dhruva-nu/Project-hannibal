//! The fault engine. Rules are declarative and share one contract across all
//! emulators (`plans/infra-emulators.md` §1). A rule is *armed* when installed and
//! *fires* when a matching op flows through the connection loop — counting starts at
//! arm time, so traffic before installation can never trip it.

use crate::emulator::{Emulator, Op};
use serde_json::Value;

/// Which connection(s) a rule watches.
pub enum ConnScope {
    /// Any connection (default).
    Any,
    /// Only the connection opened next after the rule was armed. Carries the id that
    /// connection will be assigned.
    Next(u64),
    /// A specific connection id from the op log.
    Id(u64),
}

/// One installed fault rule plus its runtime firing state.
pub struct FaultRule {
    emulator: String,
    action: String,
    op_matches: String,
    count: u32,
    times: u32,
    scope: ConnScope,
    params: Value,
    matched: u32,
    fired: u32,
}

impl FaultRule {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        emulator: String,
        action: String,
        op_matches: String,
        count: u32,
        times: u32,
        scope: ConnScope,
        params: Value,
    ) -> Self {
        Self {
            emulator,
            action,
            op_matches,
            count,
            times,
            scope,
            params,
            matched: 0,
            fired: 0,
        }
    }
}

/// What the connection loop needs to act on a fired rule.
pub struct FaultHit {
    pub action: String,
    pub params: Value,
}

/// The set of installed rules, evaluated on every logged op.
#[derive(Default)]
pub struct FaultEngine {
    rules: Vec<FaultRule>,
}

impl FaultEngine {
    pub fn install(&mut self, rule: FaultRule) {
        self.rules.push(rule);
    }

    pub fn clear(&mut self) {
        self.rules.clear();
    }

    /// Evaluate every rule against one op. First rule to fire wins; at most one fault
    /// per op. Mutates each candidate rule's match/fire counters.
    pub fn evaluate(
        &mut self,
        emulator: &str,
        op: &Op,
        conn_id: u64,
        emu: &dyn Emulator,
    ) -> Option<FaultHit> {
        for rule in self.rules.iter_mut() {
            if rule.emulator != emulator || rule.fired >= rule.times {
                continue;
            }
            if !scope_matches(&rule.scope, conn_id) {
                continue;
            }
            let type_matches =
                op.op == rule.op_matches || emu.op_class_matches(op, &rule.op_matches);
            if !type_matches || !emu.matches(op, &rule.params) {
                continue;
            }
            rule.matched += 1;
            if rule.matched < rule.count {
                continue;
            }
            rule.fired += 1;
            return Some(FaultHit {
                action: rule.action.clone(),
                params: rule.params.clone(),
            });
        }
        None
    }
}

fn scope_matches(scope: &ConnScope, conn_id: u64) -> bool {
    match scope {
        ConnScope::Any => true,
        ConnScope::Next(target) | ConnScope::Id(target) => *target == conn_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::emulator::{ConnState, Reader};
    use async_trait::async_trait;
    use serde_json::json;

    /// A stand-in emulator for exercising trigger matching without a live socket.
    struct Mock;

    #[async_trait]
    impl Emulator for Mock {
        fn name(&self) -> &str {
            "mock"
        }
        fn port(&self) -> u16 {
            0
        }
        async fn decode(
            &self,
            _conn: &mut ConnState,
            _reader: &mut Reader,
        ) -> std::io::Result<Option<Op>> {
            unimplemented!("faults tests never decode")
        }
        fn execute(&self, _conn: &mut ConnState, _op: &Op) -> Vec<u8> {
            Vec::new()
        }
        fn apply_fault(&self, _a: &str, _p: &Value, _c: &mut ConnState, _o: &Op) -> Vec<u8> {
            Vec::new()
        }
        fn encode_error(&self, _params: &Value) -> Vec<u8> {
            Vec::new()
        }
        fn op_class_matches(&self, op: &Op, class: &str) -> bool {
            class == "read" && op.op == "GET"
        }
        fn matches(&self, op: &Op, params: &Value) -> bool {
            match params.get("key") {
                Some(key) => op.args.get("key") == Some(key),
                None => true,
            }
        }
        fn seed(&self, _body: &Value) -> Result<(), String> {
            Ok(())
        }
        fn snapshot(&self) -> Value {
            Value::Null
        }
        fn restore(&self, _snap: &Value) {}
        fn state(&self) -> Value {
            Value::Null
        }
    }

    fn op(kind: &str) -> Op {
        Op {
            op: kind.to_string(),
            args: Value::Null,
        }
    }

    fn rule(action: &str, op_matches: &str, count: u32, times: u32, scope: ConnScope) -> FaultRule {
        FaultRule::new(
            "mock".into(),
            action.into(),
            op_matches.into(),
            count,
            times,
            scope,
            json!({}),
        )
    }

    #[test]
    fn fires_on_the_nth_match_only() {
        let mut engine = FaultEngine::default();
        engine.install(rule("kill_connection", "UPDATE", 2, 1, ConnScope::Any));
        let mock = Mock;
        assert!(engine.evaluate("mock", &op("UPDATE"), 1, &mock).is_none());
        let hit = engine.evaluate("mock", &op("UPDATE"), 1, &mock).unwrap();
        assert_eq!(hit.action, "kill_connection");
    }

    #[test]
    fn retires_after_times_is_spent() {
        let mut engine = FaultEngine::default();
        engine.install(rule("kill_connection", "UPDATE", 1, 2, ConnScope::Any));
        let mock = Mock;
        assert!(engine.evaluate("mock", &op("UPDATE"), 1, &mock).is_some());
        assert!(engine.evaluate("mock", &op("UPDATE"), 1, &mock).is_some());
        assert!(engine.evaluate("mock", &op("UPDATE"), 1, &mock).is_none());
    }

    #[test]
    fn ignores_other_emulators_and_op_types() {
        let mut engine = FaultEngine::default();
        engine.install(rule("kill_connection", "UPDATE", 1, 1, ConnScope::Any));
        let mock = Mock;
        assert!(engine.evaluate("other", &op("UPDATE"), 1, &mock).is_none());
        assert!(engine.evaluate("mock", &op("SELECT"), 1, &mock).is_none());
    }

    #[test]
    fn scope_next_and_id_target_one_connection() {
        let mut engine = FaultEngine::default();
        engine.install(rule("kill_connection", "ECHO", 1, 1, ConnScope::Next(2)));
        engine.install(rule("inject_error", "ECHO", 1, 1, ConnScope::Id(5)));
        let mock = Mock;
        assert!(engine.evaluate("mock", &op("ECHO"), 1, &mock).is_none());
        assert_eq!(
            engine
                .evaluate("mock", &op("ECHO"), 2, &mock)
                .unwrap()
                .action,
            "kill_connection"
        );
        assert_eq!(
            engine
                .evaluate("mock", &op("ECHO"), 5, &mock)
                .unwrap()
                .action,
            "inject_error"
        );
    }

    #[test]
    fn op_class_matches_lets_a_class_trigger() {
        let mut engine = FaultEngine::default();
        engine.install(rule("inject_error", "read", 1, 1, ConnScope::Any));
        let mock = Mock;
        assert!(engine.evaluate("mock", &op("GET"), 1, &mock).is_some());
    }

    #[test]
    fn key_scoping_narrows_via_matches() {
        let mut engine = FaultEngine::default();
        engine.install(FaultRule::new(
            "mock".into(),
            "inject_error".into(),
            "GET".into(),
            1,
            1,
            ConnScope::Any,
            json!({"key": "user:1"}),
        ));
        let mock = Mock;
        let miss = Op {
            op: "GET".into(),
            args: json!({"key": "user:2"}),
        };
        let hit = Op {
            op: "GET".into(),
            args: json!({"key": "user:1"}),
        };
        assert!(engine.evaluate("mock", &miss, 1, &mock).is_none());
        assert!(engine.evaluate("mock", &hit, 1, &mock).is_some());
    }

    #[test]
    fn clear_removes_all_rules() {
        let mut engine = FaultEngine::default();
        engine.install(rule("kill_connection", "ECHO", 1, 1, ConnScope::Any));
        engine.clear();
        assert!(engine.evaluate("mock", &op("ECHO"), 1, &Mock).is_none());
    }
}
