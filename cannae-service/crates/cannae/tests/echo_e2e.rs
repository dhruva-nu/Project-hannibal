//! End-to-end acceptance test for Phase 0 (#132).
//!
//! Proves: echo runs on the kit, faults arm on the control plane and fire on the
//! data plane, and the op log is byte-identical across identical runs. The harness
//! itself lives in `common`, shared with the cache e2e test.

mod common;

use cannae_core::Emulator;
use cannae_echo::EchoEmulator;
use common::Harness;
use serde_json::json;
use std::sync::Arc;

async fn start() -> Harness {
    Harness::start("echo", |port| {
        Arc::new(EchoEmulator::with_port(port)) as Arc<dyn Emulator>
    })
    .await
}

#[tokio::test]
async fn echoes_seeded_prefix() {
    let h = start().await;
    h.seed(json!({ "prefix": ">>" })).await;
    let mut client = h.connect().await;
    client.send_line("hello").await;
    assert_eq!(client.read_line().await.as_deref(), Some(">>hello\n"));
    assert_eq!(h.state().await["echo_count"], 1);
}

#[tokio::test]
async fn kill_connection_fires_at_the_scripted_op() {
    let h = start().await;
    h.seed(json!({ "prefix": ">>" })).await;
    // Arm before connecting: counting starts at arm time.
    let status = h
        .fault(json!({
            "action": "kill_connection",
            "after": { "op_matches": "ECHO", "count": 2 }
        }))
        .await;
    assert!(status.is_success());

    let mut client = h.connect().await;
    client.send_line("a").await;
    assert_eq!(client.read_line().await.as_deref(), Some(">>a\n"));
    client.send_line("b").await; // 2nd ECHO → kill
    assert_eq!(client.read_line().await, None, "socket should be dropped");

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
    let h = start().await;
    h.seed(json!({ "prefix": "" })).await;
    h.fault(json!({
        "action": "inject_error",
        "after": { "op_matches": "ECHO", "count": 1 },
        "params": { "resp_error": "boom" }
    }))
    .await;

    let mut client = h.connect().await;
    client.send_line("x").await;
    assert_eq!(client.read_line().await.as_deref(), Some("-boom\n"));
    client.send_line("y").await; // connection still open, executes normally
    assert_eq!(client.read_line().await.as_deref(), Some("y\n"));
    assert_eq!(h.state().await["echo_count"], 1); // only "y" executed
}

#[tokio::test]
async fn protocol_action_supplies_replacement_bytes() {
    let h = start().await;
    h.seed(json!({ "prefix": "" })).await;
    h.fault(json!({
        "action": "corrupt",
        "after": { "op_matches": "ECHO", "count": 1 }
    }))
    .await;

    let mut client = h.connect().await;
    client.send_line("hi").await;
    assert_eq!(client.read_line().await.as_deref(), Some("CORRUPTED\n"));
}

#[tokio::test]
async fn delay_action_still_executes() {
    let h = start().await;
    h.seed(json!({ "prefix": "" })).await;
    h.fault(json!({
        "action": "delay",
        "after": { "op_matches": "ECHO", "count": 1 },
        "params": { "ms": 0 }
    }))
    .await;

    let mut client = h.connect().await;
    client.send_line("z").await;
    assert_eq!(client.read_line().await.as_deref(), Some("z\n"));
    assert_eq!(h.log().await[1]["fault"], "delay");
}

#[tokio::test]
async fn after_connect_fires_before_any_bytes() {
    let h = start().await;
    h.fault(json!({
        "action": "kill_connection",
        "after": { "op_matches": "connect", "count": 1 }
    }))
    .await;

    let mut client = h.connect().await;
    assert_eq!(client.read_line().await, None, "killed on connect");

    let log = h.wait_for_log(2).await;
    assert_eq!(log[0]["op"], "connect");
    assert_eq!(log[0]["fault"], "kill_connection");
    assert_eq!(log[1]["op"], "disconnect");
}

#[tokio::test]
async fn conn_next_targets_only_the_next_connection() {
    let h = start().await;
    h.seed(json!({ "prefix": ">>" })).await;
    h.fault(json!({
        "action": "kill_connection",
        "after": { "op_matches": "ECHO", "count": 1 },
        "conn": "next"
    }))
    .await;

    let mut first = h.connect().await; // the targeted connection
    first.send_line("a").await;
    assert_eq!(first.read_line().await, None, "first connection is killed");

    let mut second = h.connect().await; // not targeted
    second.send_line("b").await;
    assert_eq!(second.read_line().await.as_deref(), Some(">>b\n"));
}

#[tokio::test]
async fn reset_restores_baseline_and_faults() {
    let h = start().await;
    h.seed(json!({ "prefix": ">>" })).await;
    let mut client = h.connect().await;
    client.send_line("a").await;
    client.read_line().await;
    drop(client);
    h.wait_for_log(3).await; // connect, ECHO, disconnect

    h.reset().await;
    assert!(h.log().await.is_empty(), "log cleared");
    assert_eq!(h.state().await["echo_count"], 0, "baseline restored");
}

/// `/reset` rewinds the connection-id counter, so a socket left over from the previous
/// test case would otherwise share an id with a freshly accepted one — two live
/// connections under one `conn_id`, which breaks both `conn` scoping and the
/// per-connection ordering that grading relies on.
#[tokio::test]
async fn reset_retires_live_connections_before_recycling_their_ids() {
    let h = start().await;
    h.seed(json!({ "prefix": ">>" })).await;

    let mut stale = h.connect().await; // conn 1 of the old test case
    stale.send_line("a").await;
    assert_eq!(stale.read_line().await.as_deref(), Some(">>a\n"));

    h.reset().await;
    assert_eq!(
        stale.read_line_or_timeout().await,
        None,
        "a connection from the previous test case must be dropped, not carried over"
    );

    let mut fresh = h.connect().await; // gets the recycled id 1
    fresh.send_line("b").await;
    assert_eq!(fresh.read_line().await.as_deref(), Some(">>b\n"));

    // Only the fresh connection is in the log: the retired one logged nothing after
    // the reset, not even its `disconnect`.
    let log = h.wait_for_log(2).await;
    assert_eq!(log[0]["op"], "connect");
    assert_eq!(log[1]["op"], "ECHO");
    assert!(
        log.iter().all(|record| record["conn_id"] == 1),
        "recycled id must name exactly one connection: {log:?}"
    );
}

/// A trigger naming an op that can never fire would install a rule that silently never
/// fires — so it is rejected at install time, like an unknown emulator or action.
#[tokio::test]
async fn unfireable_triggers_are_rejected_at_install() {
    let h = start().await;
    let bad = reqwest::StatusCode::BAD_REQUEST;

    // A typo'd op type.
    assert_eq!(
        h.fault(json!({ "action": "kill_connection",
                        "after": { "op_matches": "ECHOO", "count": 1 } }))
            .await,
        bad
    );
    // `disconnect` is logged without fault evaluation, so a rule on it could never fire.
    assert_eq!(
        h.fault(json!({ "action": "kill_connection",
                        "after": { "op_matches": "disconnect", "count": 1 } }))
            .await,
        bad
    );
    // An op class echo does not register.
    assert_eq!(
        h.fault(json!({ "action": "kill_connection",
                        "after": { "op_matches": "read", "count": 1 } }))
            .await,
        bad
    );
    // A misspelled spec field is rejected too, not silently defaulted to `times: 1`.
    assert!(!h
        .fault(json!({ "action": "kill_connection", "timess": 3,
                       "after": { "op_matches": "ECHO", "count": 1 } }))
        .await
        .is_success());

    // The two triggers that can fire are both accepted.
    for op_matches in ["ECHO", "connect"] {
        assert!(
            h.fault(json!({ "action": "kill_connection",
                            "after": { "op_matches": op_matches, "count": 1 } }))
                .await
                .is_success(),
            "{op_matches} must be installable"
        );
    }
}

#[tokio::test]
async fn same_scenario_twice_is_byte_identical() {
    let h = start().await;

    async fn scenario(h: &Harness) -> String {
        h.seed(json!({ "prefix": ">>" })).await;
        let mut client = h.connect().await;
        for line in ["a", "b", "c"] {
            client.send_line(line).await;
            client.read_line().await;
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
    let h = start().await;
    let bad = reqwest::StatusCode::BAD_REQUEST;

    // Unknown emulator / action / missing trigger / bad conn scope.
    assert_eq!(
        h.fault_raw(json!({ "emulator": "nope", "action": "kill_connection",
                            "after": { "op_matches": "ECHO", "count": 1 } }))
            .await,
        bad
    );
    assert_eq!(
        h.fault(json!({ "action": "bogus",
                        "after": { "op_matches": "ECHO", "count": 1 } }))
            .await,
        bad
    );
    assert_eq!(h.fault(json!({ "action": "kill_connection" })).await, bad);
    assert_eq!(
        h.fault(json!({ "action": "kill_connection",
                        "after": { "op_matches": "ECHO", "count": 1 }, "conn": "weird" }))
            .await,
        bad
    );

    // A numeric conn id is accepted, and rules can be cleared.
    assert!(h
        .fault(json!({ "action": "kill_connection",
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
    let h = start().await;
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
            .json(&json!({ "prefix": 7 }))
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
