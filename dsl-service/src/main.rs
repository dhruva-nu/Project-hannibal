mod codegen;

use axum::{Json, Router, routing::post};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct TranslateRequest {
    dsl: String,
    language: String,
}

#[derive(Serialize)]
struct TranslateResponse {
    code: String,
}

async fn translate(Json(req): Json<TranslateRequest>) -> Json<TranslateResponse> {
    let code = codegen::translate(&req.dsl, &req.language);
    Json(TranslateResponse { code })
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/translate", post(translate));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:9000").await.unwrap();
    println!("dsl-service listening on :9000");
    axum::serve(listener, app).await.unwrap();
}
