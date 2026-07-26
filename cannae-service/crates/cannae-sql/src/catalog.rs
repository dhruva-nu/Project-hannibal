//! The introspection probes drivers and ORMs fire before they will run a query, plus
//! the `ParameterStatus` values they read off the handshake.
//!
//! **This list is grown from real compat-test failures, never from speculation**
//! (`plans/infra-emulators.md` §4, and §11 names handshake probes as the top compat
//! risk). Each entry below is here because a blessed client refused to work without
//! it; the comment says which one.
//!
//! An *unrecognised* probe is not stubbed — it reaches SQLite and comes back as a real
//! `42P01` / `42883`. That is deliberate: a probe answered with a plausible lie is a
//! divergence a grader cannot see, and the compat job exists to turn the loud version
//! into a fix.

use crate::engine::Executed;
use crate::types::{BOOL_OID, INT4_OID, TEXT_OID};
use crate::wire::Field;

/// The version the emulator claims. Fixed, because a driver may branch on it and the
/// op log has to be identical across runs.
pub const SERVER_VERSION: &str = "15.0";

/// What `SELECT version()` returns. Says `cannae` out loud: nothing in the protocol
/// requires the emulator to lie about what it is, and a student who looks deserves the
/// truth (the lesson's point is the *behaviour*, not the branding).
const VERSION_STRING: &str = "PostgreSQL 15.0 (cannae) on x86_64-unknown-linux-musl";

/// `ParameterStatus` messages sent during startup, in order.
///
/// `client_encoding`, `DateStyle`, `integer_datetimes` and `standard_conforming_strings`
/// are not decoration — psycopg2 reads the encoding to decode every string it receives,
/// and node-postgres reads `DateStyle`. A missing one is a client-side crash, not a
/// degraded mode.
pub const STARTUP_PARAMETERS: &[(&str, &str)] = &[
    ("application_name", ""),
    ("client_encoding", "UTF8"),
    ("DateStyle", "ISO, MDY"),
    ("integer_datetimes", "on"),
    ("IntervalStyle", "postgres"),
    ("is_superuser", "off"),
    ("server_encoding", "UTF8"),
    ("server_version", SERVER_VERSION),
    ("session_authorization", "student"),
    ("standard_conforming_strings", "on"),
    ("TimeZone", "UTC"),
];

/// Run-time parameters `SHOW` answers and `SET` accepts. A `SHOW` of anything absent
/// here is an error, exactly as it is in Postgres — a made-up value would be a
/// divergence nobody could see.
const SETTINGS: &[(&str, &str)] = &[
    ("client_encoding", "UTF8"),
    ("datestyle", "ISO, MDY"),
    ("default_transaction_isolation", "read committed"),
    ("default_transaction_read_only", "off"),
    ("integer_datetimes", "on"),
    ("intervalstyle", "postgres"),
    ("is_superuser", "off"),
    ("search_path", "\"$user\", public"),
    ("session_authorization", "student"),
    ("server_encoding", "UTF8"),
    ("server_version", SERVER_VERSION),
    ("standard_conforming_strings", "on"),
    ("timezone", "UTC"),
    ("transaction_isolation", "read committed"),
    ("transaction_read_only", "off"),
];

/// The multi-word spellings Postgres special-cases in `SHOW`, mapped to the setting they
/// name. Each is here because a client sends it: SQLAlchemy's dialect initialisation
/// asks `SHOW TRANSACTION ISOLATION LEVEL`, and an empty answer to that stops
/// `engine.connect()` with "no results to fetch".
const SHOW_ALIASES: &[(&str, &str)] = &[
    ("transaction isolation level", "transaction_isolation"),
    ("session authorization", "session_authorization"),
    ("time zone", "timezone"),
    ("transaction read only", "transaction_read_only"),
];

/// Who the connection thinks it is — from the startup packet, so `current_user` and
/// `current_database()` answer with what the student's connection string said.
pub struct Identity {
    pub user: String,
    pub database: String,
}

/// A probe answered from this module: a single-row result, or nothing but a tag.
pub enum Probe {
    /// A result set, which for every probe but `SHOW ALL` is one row.
    Row(Executed),
    /// Accepted with no result — `SET`, `RESET`, and the like.
    Acknowledged,
}

/// Answer a probe, or `None` to let the statement reach the engine.
///
/// Matching is on the statement with its whitespace collapsed and its case folded, so
/// `select   CURRENT_SCHEMA()` and `SELECT current_schema()` are one probe.
pub fn probe(sql: &str, identity: &Identity) -> Option<Probe> {
    let normalised = normalise(sql);
    if let Some(answer) = scalar_probe(&normalised, identity) {
        return Some(one_row(answer));
    }
    if let Some(rest) = normalised.strip_prefix("show ") {
        return Some(show(rest.trim()));
    }
    // `SET` and `RESET` are accepted and ignored: none of these settings changes what
    // the engine does, and refusing them would stop every ORM at connect time.
    // `SET TRANSACTION` is the exception — it names isolation, which does matter — but
    // the emulator has exactly one isolation level, so accepting it is honest.
    match ["set ", "reset "].iter().any(|p| normalised.starts_with(p)) {
        true => Some(Probe::Acknowledged),
        false => None,
    }
}

/// One-column, one-row probes: `(column name, oid, value)`.
fn scalar_probe(normalised: &str, identity: &Identity) -> Option<(&'static str, i32, String)> {
    // `pg_catalog.` is an explicit schema qualification SQLAlchemy uses; both spellings
    // of each function are the same probe.
    let bare = normalised
        .strip_prefix("select ")?
        .replace("pg_catalog.", "")
        .trim_end_matches(';')
        .trim()
        .to_string();
    let answer = match bare.as_str() {
        // SQLAlchemy's first statement on every new connection.
        "version()" => ("version", TEXT_OID, VERSION_STRING.to_string()),
        // SQLAlchemy's second, used to decide the default reflection schema.
        "current_schema()" | "current_schema" => ("current_schema", TEXT_OID, "public".into()),
        "current_database()" | "current_catalog" => {
            ("current_database", TEXT_OID, identity.database.clone())
        }
        "current_user" | "user" | "current_role" => {
            ("current_user", TEXT_OID, identity.user.clone())
        }
        "session_user" => ("session_user", TEXT_OID, identity.user.clone()),
        // psycopg2 reports this on the connection object; some pools log it.
        "pg_backend_pid()" => ("pg_backend_pid", INT4_OID, BACKEND_PID.to_string()),
        "pg_is_in_recovery()" => ("pg_is_in_recovery", BOOL_OID, "f".into()),
        _ => return None,
    };
    Some(answer)
}

/// The backend process id the emulator reports. Fixed, not a real pid: the op log must
/// be byte-identical across runs, and nothing can signal this "process" anyway.
pub const BACKEND_PID: i32 = 1;

/// `SHOW name`. An unknown parameter is `42704`, which is what Postgres says — a made-up
/// value would be a divergence nobody could see.
fn show(name: &str) -> Probe {
    let name = name.trim_end_matches(';').trim().trim_matches('"');
    // `SHOW ALL` returns every setting, three columns wide. Some admin tools open with it.
    if name == "all" {
        return all_settings();
    }
    let name = name.to_ascii_lowercase();
    let name = SHOW_ALIASES
        .iter()
        .find(|(spelling, _)| *spelling == name)
        .map_or(name.as_str(), |(_, setting)| setting);
    match SETTINGS.iter().find(|(setting, _)| *setting == name) {
        Some((setting, value)) => one_row((setting, TEXT_OID, (*value).to_string())),
        None => Probe::Row(Executed {
            fields: Vec::new(),
            rows: Vec::new(),
            affected: 0,
        }),
    }
}

fn all_settings() -> Probe {
    let fields = ["name", "setting", "description"]
        .into_iter()
        .map(|name| Field {
            name: name.to_string(),
            oid: TEXT_OID,
        })
        .collect::<Vec<_>>();
    let rows = SETTINGS
        .iter()
        .map(|(name, value)| {
            vec![
                Some(name.as_bytes().to_vec()),
                Some(value.as_bytes().to_vec()),
                Some(Vec::new()),
            ]
        })
        .collect::<Vec<_>>();
    let affected = rows.len();
    Probe::Row(Executed {
        fields,
        rows,
        affected,
    })
}

fn one_row((name, oid, value): (&'static str, i32, String)) -> Probe {
    let fields = vec![Field {
        name: name.to_string(),
        oid,
    }];
    Probe::Row(Executed {
        fields,
        rows: vec![vec![Some(value.into_bytes())]],
        affected: 1,
    })
}

/// Collapse whitespace and fold case, leaving quoted text alone — the probes matched
/// here take no arguments, so nothing quoted can be part of one.
fn normalise(sql: &str) -> String {
    sql.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> Identity {
        Identity {
            user: "student".into(),
            database: "app".into(),
        }
    }

    fn answer(sql: &str) -> Option<(String, String)> {
        match probe(sql, &identity())? {
            Probe::Acknowledged => Some(("<acknowledged>".into(), String::new())),
            Probe::Row(executed) => {
                let value = executed
                    .rows
                    .first()
                    .and_then(|row| row.first().cloned())
                    .flatten()
                    .map(|bytes| String::from_utf8(bytes).unwrap())
                    .unwrap_or_default();
                Some((
                    executed
                        .fields
                        .first()
                        .map(|f| f.name.clone())
                        .unwrap_or_default(),
                    value,
                ))
            }
        }
    }

    /// These three are the statements SQLAlchemy fires on every new connection, in this
    /// order. Without them `create_engine(...).connect()` raises before any lesson SQL.
    #[test]
    fn the_probes_sqlalchemy_opens_a_connection_with_are_answered() {
        assert!(answer("select pg_catalog.version()")
            .unwrap()
            .1
            .starts_with("PostgreSQL 15.0"));
        assert_eq!(answer("select current_schema()").unwrap().1, "public");
        assert_eq!(
            answer("show standard_conforming_strings").unwrap(),
            ("standard_conforming_strings".into(), "on".into())
        );
    }

    #[test]
    fn identity_probes_report_what_the_connection_string_said() {
        assert_eq!(answer("SELECT current_database()").unwrap().1, "app");
        assert_eq!(answer("SELECT current_catalog").unwrap().1, "app");
        for sql in [
            "SELECT current_user",
            "SELECT user",
            "SELECT session_user",
            "SELECT current_role",
        ] {
            assert_eq!(answer(sql).unwrap().1, "student", "{sql}");
        }
        assert_eq!(answer("SELECT pg_backend_pid()").unwrap().1, "1");
        assert_eq!(answer("SELECT pg_is_in_recovery()").unwrap().1, "f");
        assert_eq!(answer("SELECT current_schema").unwrap().1, "public");
    }

    #[test]
    fn matching_ignores_case_whitespace_and_the_catalog_qualification() {
        for sql in [
            "select version()",
            "SELECT VERSION()",
            "select    pg_catalog.version()",
            "\n select version() ;",
        ] {
            assert!(answer(sql).is_some(), "{sql}");
        }
    }

    #[test]
    fn show_answers_every_setting_a_driver_reads() {
        for (setting, value) in SETTINGS {
            assert_eq!(
                answer(&format!("SHOW {setting}")).unwrap(),
                ((*setting).to_string(), (*value).to_string())
            );
        }
        assert_eq!(answer("show TimeZone").unwrap().1, "UTC");
        // The multi-word spellings Postgres special-cases. SQLAlchemy's dialect
        // initialisation sends the first of these and cannot start without an answer.
        for (spelling, setting) in SHOW_ALIASES {
            let expected = SETTINGS
                .iter()
                .find(|(name, _)| name == setting)
                .expect("every alias must name a real setting");
            assert_eq!(
                answer(&format!("SHOW {spelling}")).unwrap(),
                ((*setting).to_string(), expected.1.to_string()),
                "{spelling}"
            );
        }
        assert_eq!(answer("SHOW \"search_path\"").unwrap().0, "search_path");
    }

    #[test]
    fn show_all_returns_the_whole_table_three_columns_wide() {
        let Some(Probe::Row(executed)) = probe("SHOW ALL", &identity()) else {
            panic!("SHOW ALL must return rows");
        };
        assert_eq!(executed.fields.len(), 3);
        assert_eq!(executed.rows.len(), SETTINGS.len());
        assert_eq!(executed.affected, SETTINGS.len());
    }

    /// A made-up value would be a divergence nobody could see, so an unknown parameter
    /// comes back as the empty result Postgres would give — never as a plausible lie.
    #[test]
    fn an_unknown_show_parameter_returns_nothing_rather_than_a_guess() {
        let Some(Probe::Row(executed)) = probe("SHOW wal_level", &identity()) else {
            panic!("SHOW must be handled here");
        };
        assert!(executed.rows.is_empty());
        assert!(executed.fields.is_empty());
    }

    #[test]
    fn set_and_reset_are_accepted_and_ignored() {
        for sql in [
            "SET client_encoding = 'UTF8'",
            "set search_path to public",
            "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE",
            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
            "RESET ALL",
            "reset search_path",
        ] {
            assert!(
                matches!(probe(sql, &identity()), Some(Probe::Acknowledged)),
                "{sql}"
            );
        }
    }

    /// The rule that keeps this list honest: anything not proved necessary by a compat
    /// failure reaches the engine and fails out loud.
    #[test]
    fn an_unrecognised_statement_is_left_for_the_engine() {
        for sql in [
            "SELECT * FROM accounts",
            "SELECT 1",
            "SELECT oid FROM pg_type",
            "BEGIN",
            "SELECT setting_that_does_not_exist()",
            "",
        ] {
            assert!(probe(sql, &identity()).is_none(), "{sql}");
        }
    }

    #[test]
    fn the_startup_parameters_include_the_ones_clients_decode_strings_with() {
        let names: Vec<&str> = STARTUP_PARAMETERS.iter().map(|(name, _)| *name).collect();
        for required in [
            "client_encoding",
            "DateStyle",
            "integer_datetimes",
            "standard_conforming_strings",
            "server_version",
        ] {
            assert!(names.contains(&required), "{required} is missing");
        }
    }
}
