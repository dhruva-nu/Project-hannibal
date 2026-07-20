//! The `cannae` binary — parses run configuration and starts the declared emulators.
//! One process, many personalities: `--infra echo` (later `postgres,redis`) starts
//! only the listeners a lesson declares, plus the control plane.

use emu_core::{Emu, Emulator};
use std::net::SocketAddr;
use std::sync::Arc;

/// Build an emulator by name. This registry is the one place that knows the
/// concrete emulator types; the kit stays protocol-agnostic.
fn make(name: &str) -> Option<Arc<dyn Emulator>> {
    match name {
        "echo" => Some(Arc::new(emu_echo::EchoEmulator::new())),
        _ => None,
    }
}

fn usage() -> &'static str {
    "cannae — protocol emulator service (Phase 0)\n\
     \n\
     USAGE:\n\
     \x20 cannae --infra <csv> [--control-bind <addr>]\n\
     \n\
     OPTIONS:\n\
     \x20 --infra <csv>          comma-separated emulators to start (e.g. echo)\n\
     \x20 --control-bind <addr>  control API bind address (default 0.0.0.0:9900)\n\
     \x20 --help                 print this help and exit\n"
}

struct Config {
    infra: String,
    control: String,
}

/// Parse argv. Returns `Err` with a message on bad input, `Ok(None)` for `--help`.
fn parse(args: &[String]) -> Result<Option<Config>, String> {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return Ok(None);
    }
    let mut config = Config {
        infra: "echo".into(),
        control: "0.0.0.0:9900".into(),
    };
    let mut i = 0;
    while i < args.len() {
        let value = || {
            args.get(i + 1)
                .cloned()
                .ok_or(format!("{} needs a value", args[i]))
        };
        match args[i].as_str() {
            "--infra" => config.infra = value()?,
            "--control-bind" => config.control = value()?,
            other => return Err(format!("unknown argument: {other}")),
        }
        i += 2;
    }
    Ok(Some(config))
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let config = match parse(&args) {
        Ok(Some(config)) => config,
        Ok(None) => {
            print!("{}", usage());
            return;
        }
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };

    let control: SocketAddr = config.control.parse().unwrap_or_else(|error| {
        eprintln!("bad --control-bind: {error}");
        std::process::exit(2);
    });

    let mut emulators = Vec::new();
    for name in config
        .infra
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match make(name) {
            Some(emu) => emulators.push(emu),
            None => {
                eprintln!("unknown emulator: {name}");
                std::process::exit(2);
            }
        }
    }
    if emulators.is_empty() {
        eprintln!("no emulators declared (use --infra)");
        std::process::exit(2);
    }

    println!("cannae control plane on {control}");
    if let Err(error) = Emu::new(emulators).serve(control).await {
        eprintln!("serve error: {error}");
        std::process::exit(1);
    }
}
