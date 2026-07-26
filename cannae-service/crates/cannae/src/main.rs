//! The `cannae` binary — parses run configuration and starts the declared emulators.
//! One process, many personalities: `--infra cache` (later `postgres,queue`) starts
//! only the listeners a lesson declares, plus the control plane.

use cannae_core::{Emu, Emulator};
use std::net::SocketAddr;
use std::sync::Arc;

/// Build an emulator from a `name` or `name:port` spec. This registry is the one
/// place that knows the concrete emulator types; the kit stays protocol-agnostic.
///
/// The port override exists for CI and local runs, where the standard port is often
/// already taken by the real thing. Lessons always use the default — a student's
/// `redis://cache:6379` must be the URL they would write in production.
fn make(spec: &str) -> Result<Arc<dyn Emulator>, String> {
    let (name, port) = split_spec(spec)?;
    match name {
        "echo" => Ok(Arc::new(port.map_or_else(
            cannae_echo::EchoEmulator::new,
            cannae_echo::EchoEmulator::with_port,
        ))),
        // Two spellings, deliberately. A lesson declares the *product* it wants
        // (`rce-service`'s `INFRA_EMULATORS` sends `--infra redis`), while the
        // emulator identifies itself by its *role* — `cache` is what a fault rule's
        // `emulator` field and `?emulator=` name (`plans/infra-emulators.md` §1).
        "cache" | "redis" => Ok(Arc::new(port.map_or_else(
            cannae_cache::CacheEmulator::new,
            cannae_cache::CacheEmulator::with_port,
        ))),
        _ => Err(format!("unknown emulator: {name}")),
    }
}

/// Build every emulator a `--infra` list declares.
///
/// Two specs that resolve to the same role (`redis,cache`) or the same port are refused
/// here: the kit registers emulators by name, so a duplicate role would leave one of
/// them unreachable from `?emulator=` while both still fought over the port. Naming the
/// clash beats an `AddrInUse` that does not say which specs collided.
fn build(infra: &str) -> Result<Vec<Arc<dyn Emulator>>, String> {
    let mut emulators: Vec<Arc<dyn Emulator>> = Vec::new();
    for spec in infra.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let emu = make(spec)?;
        if let Some(clash) = emulators
            .iter()
            .find(|other| other.name() == emu.name() || other.port() == emu.port())
        {
            return Err(format!(
                "--infra {spec} collides with {} on :{}",
                clash.name(),
                clash.port()
            ));
        }
        emulators.push(emu);
    }
    match emulators.is_empty() {
        true => Err("no emulators declared (use --infra)".to_string()),
        false => Ok(emulators),
    }
}

fn split_spec(spec: &str) -> Result<(&str, Option<u16>), String> {
    let Some((name, port)) = spec.split_once(':') else {
        return Ok((spec, None));
    };
    let port = port
        .parse()
        .map_err(|_| format!("bad port in --infra {spec}"))?;
    Ok((name, Some(port)))
}

fn usage() -> &'static str {
    "cannae — protocol emulator service\n\
     \n\
     USAGE:\n\
     \x20 cannae --infra <csv> [--control-bind <addr>]\n\
     \n\
     OPTIONS:\n\
     \x20 --infra <csv>          comma-separated emulators to start, each\n\
     \x20                        `name` or `name:port`:\n\
     \x20                          cache  Redis (RESP2), default :6379\n\
     \x20                                 (also spelled `redis`)\n\
     \x20                          echo   line echo, default :7777\n\
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

    let emulators = build(&config.infra).unwrap_or_else(|message| {
        eprintln!("{message}");
        std::process::exit(2);
    });

    for emu in &emulators {
        println!("cannae {} on :{}", emu.name(), emu.port());
    }
    println!("cannae control plane on {control}");
    if let Err(error) = Emu::new(emulators).serve(control).await {
        eprintln!("serve error: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> Vec<String> {
        line.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn every_registered_emulator_builds_on_its_standard_port() {
        assert_eq!(make("cache").unwrap().port(), 6379);
        assert_eq!(make("echo").unwrap().port(), 7777);
    }

    /// `rce-service`'s `INFRA_EMULATORS` declares this emulator as `redis` and passes
    /// that spelling straight through to `--infra`. If this stops resolving, every
    /// caching lesson boots a container with a dead port.
    #[test]
    fn the_product_name_a_lesson_declares_resolves_to_the_cache() {
        let emu = make("redis").unwrap();
        assert_eq!((emu.name(), emu.port()), ("cache", 6379));
    }

    #[test]
    fn a_spec_may_override_the_port() {
        let emu = make("cache:16379").unwrap();
        assert_eq!((emu.name(), emu.port()), ("cache", 16379));
        assert_eq!(make("echo:1234").unwrap().port(), 1234);
    }

    #[test]
    fn bad_specs_are_refused_rather_than_started_wrong() {
        // A silently-skipped emulator would leave the lesson's port dead.
        assert!(make("valkey").is_err());
        assert!(make("cache:nope").is_err());
        assert!(make("cache:99999").is_err());
    }

    #[test]
    fn an_infra_list_starts_every_emulator_it_declares() {
        let emulators = build("cache, echo:1234").unwrap();
        let started: Vec<_> = emulators
            .iter()
            .map(|emu| (emu.name(), emu.port()))
            .collect();
        assert_eq!(started, vec![("cache", 6379), ("echo", 1234)]);
    }

    /// `redis` and `cache` are one emulator under two spellings. The kit keys emulators
    /// by name, so declaring both would drop one from the control plane while both bound
    /// :6379 — a lesson would then grade against an emulator it cannot reach.
    #[test]
    fn a_collision_inside_one_infra_list_is_named_not_discovered_at_bind_time() {
        let Err(clash) = build("redis,cache") else {
            panic!("two spellings of one emulator must not both start");
        };
        assert!(clash.contains("cache"), "{clash}");
        assert!(build("cache:7000,echo:7000").is_err(), "same port");
        assert!(build("cache,cache:16379").is_err(), "same role");
        // Distinct roles on distinct ports are the normal case.
        assert!(build("cache,echo").is_ok());
    }

    #[test]
    fn an_empty_infra_list_is_refused_rather_than_serving_nothing() {
        assert!(build("").is_err());
        assert!(build(" , ").is_err());
    }

    #[test]
    fn argv_parsing_defaults_and_rejects() {
        let config = parse(&args("--infra cache --control-bind 127.0.0.1:1")).unwrap();
        let config = config.unwrap();
        assert_eq!(
            (config.infra.as_str(), config.control.as_str()),
            ("cache", "127.0.0.1:1")
        );
        assert!(parse(&args("--help")).unwrap().is_none());
        assert!(parse(&args("--infra")).is_err());
        assert!(parse(&args("--nope x")).is_err());
    }
}
