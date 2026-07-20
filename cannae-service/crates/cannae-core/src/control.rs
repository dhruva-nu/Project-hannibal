//! The harness-only control plane (`axum`). Endpoints seed state, reset between
//! test cases, read the op log, install/clear fault rules, and dump engine state.
//! Every rule is validated at install time — an unknown emulator or action is a
//! 4xx, never a silently-dead rule.

use crate::faults::{ConnScope, FaultRule};
use crate::oplog::OpRecord;
use crate::server::Shared;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

type ApiError = (StatusCode, String);

const GENERIC_ACTIONS: [&str; 3] = ["kill_connection", "inject_error", "delay"];

pub fn router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/seed", post(seed))
        .route("/reset", post(reset))
        .route("/log", get(get_log))
        .route("/faults", post(install_fault).delete(clear_faults))
        .route("/state", get(get_state))
        .with_state(shared)
}

#[derive(Deserialize)]
struct EmuQuery {
    emulator: Option<String>,
}

/// `POST /seed` — load initial state and snapshot it as the reset baseline.
async fn seed(
    State(shared): State<Arc<Shared>>,
    Json(body): Json<Value>,
) -> Result<StatusCode, ApiError> {
    let name = body
        .get("emulator")
        .and_then(Value::as_str)
        .ok_or(bad_request("missing emulator"))?;
    let emu = shared
        .emulators
        .get(name)
        .ok_or_else(|| bad_request(format!("unknown emulator {name}")))?;
    emu.seed(&body).map_err(bad_request)?;
    shared.set_baseline(name, emu.snapshot());
    Ok(StatusCode::OK)
}

/// `POST /reset` — restore baselines and wipe log, rules, and counters.
async fn reset(State(shared): State<Arc<Shared>>) -> StatusCode {
    shared.reset();
    StatusCode::OK
}

/// `GET /log` — the op log, optionally filtered by `?emulator=`.
async fn get_log(
    State(shared): State<Arc<Shared>>,
    Query(query): Query<EmuQuery>,
) -> Json<Vec<OpRecord>> {
    Json(shared.log_records(query.emulator.as_deref()))
}

/// `DELETE /faults` — remove all installed rules.
async fn clear_faults(State(shared): State<Arc<Shared>>) -> StatusCode {
    shared.clear_faults();
    StatusCode::OK
}

/// `GET /state?emulator=` — dump one emulator's engine state.
async fn get_state(
    State(shared): State<Arc<Shared>>,
    Query(query): Query<EmuQuery>,
) -> Result<Json<Value>, ApiError> {
    let name = query.emulator.ok_or(bad_request("emulator required"))?;
    let emu = shared
        .emulators
        .get(&name)
        .ok_or_else(|| bad_request(format!("unknown emulator {name}")))?;
    Ok(Json(emu.state()))
}

#[derive(Deserialize)]
struct Trigger {
    op_matches: String,
    count: u32,
}

/// `conn` accepts `"any"`, `"next"`, or a numeric connection id.
#[derive(Deserialize)]
#[serde(untagged)]
enum ConnSpec {
    Keyword(String),
    Id(u64),
}

impl Default for ConnSpec {
    fn default() -> Self {
        ConnSpec::Keyword("any".into())
    }
}

fn default_times() -> u32 {
    1
}

#[derive(Deserialize)]
struct FaultSpec {
    emulator: String,
    action: String,
    #[serde(default)]
    after: Option<Trigger>,
    #[serde(default = "default_times")]
    times: u32,
    #[serde(default)]
    conn: ConnSpec,
    #[serde(default)]
    params: Value,
}

/// `POST /faults` — validate and arm one declarative fault rule.
async fn install_fault(
    State(shared): State<Arc<Shared>>,
    Json(spec): Json<FaultSpec>,
) -> Result<StatusCode, ApiError> {
    let emu = shared
        .emulators
        .get(&spec.emulator)
        .ok_or_else(|| bad_request(format!("unknown emulator {}", spec.emulator)))?;

    let known = GENERIC_ACTIONS.contains(&spec.action.as_str())
        || emu.fault_actions().contains(&spec.action.as_str());
    if !known {
        return Err(bad_request(format!("unknown action {}", spec.action)));
    }

    // Every Phase 0 action is triggered, so a trigger is required.
    let trigger = spec.after.ok_or(bad_request("after is required"))?;

    let scope = match spec.conn {
        ConnSpec::Keyword(k) if k == "any" => ConnScope::Any,
        ConnSpec::Keyword(k) if k == "next" => ConnScope::Next(shared.peek_conn_id()),
        ConnSpec::Keyword(k) => return Err(bad_request(format!("unknown conn scope {k}"))),
        ConnSpec::Id(id) => ConnScope::Id(id),
    };

    let params = if spec.params.is_null() {
        Value::Object(Default::default())
    } else {
        spec.params
    };

    shared.install_fault(FaultRule::new(
        spec.emulator,
        spec.action,
        trigger.op_matches,
        trigger.count,
        spec.times,
        scope,
        params,
    ));
    Ok(StatusCode::OK)
}

fn bad_request(message: impl Into<String>) -> ApiError {
    (StatusCode::BAD_REQUEST, message.into())
}
