//! Postgres types over a SQLite engine: which OID a column reports, and how a stored
//! value is rendered as the text a client parses.
//!
//! The trick that makes this cheap is that **SQLite stores the declared type name
//! verbatim** and derives its storage affinity from substrings of it. So a lesson's
//! `balance NUMERIC(12,2)` is created in SQLite as exactly that, `decl_type()` hands
//! it back unchanged, and the per-lesson schema *is* the type manifest — no separate
//! one to keep in step (`plans/infra-emulators.md` §4).

use rusqlite::types::Value;
use serde_json::json;

// The OIDs are protocol constants, fixed in `pg_type.dat` since forever. A client
// keys its parsing off these, which is why they are spelled out rather than derived.
pub const BOOL_OID: i32 = 16;
pub const BYTEA_OID: i32 = 17;
pub const INT8_OID: i32 = 20;
pub const INT2_OID: i32 = 21;
pub const INT4_OID: i32 = 23;
pub const TEXT_OID: i32 = 25;
pub const JSON_OID: i32 = 114;
pub const FLOAT4_OID: i32 = 700;
pub const FLOAT8_OID: i32 = 701;
pub const VARCHAR_OID: i32 = 1043;
pub const DATE_OID: i32 = 1082;
pub const TIME_OID: i32 = 1083;
pub const TIMESTAMP_OID: i32 = 1114;
pub const TIMESTAMPTZ_OID: i32 = 1184;
pub const NUMERIC_OID: i32 = 1700;
pub const UUID_OID: i32 = 2950;
pub const JSONB_OID: i32 = 3802;

/// A declared type's base name mapped to its OID. Matched against the declaration
/// with its parameter list stripped (`NUMERIC(12,2)` → `NUMERIC`), longest first, so
/// `DOUBLE PRECISION` cannot be decided by a prefix.
const DECLARED_OIDS: &[(&str, i32)] = &[
    ("SMALLSERIAL", INT2_OID),
    ("BIGSERIAL", INT8_OID),
    ("SERIAL", INT4_OID),
    ("SMALLINT", INT2_OID),
    ("BIGINT", INT8_OID),
    ("INT2", INT2_OID),
    ("INT4", INT4_OID),
    ("INT8", INT8_OID),
    ("INTEGER", INT4_OID),
    ("INT", INT4_OID),
    ("NUMERIC", NUMERIC_OID),
    ("DECIMAL", NUMERIC_OID),
    ("MONEY", NUMERIC_OID),
    ("DOUBLE PRECISION", FLOAT8_OID),
    ("FLOAT8", FLOAT8_OID),
    ("FLOAT4", FLOAT4_OID),
    ("REAL", FLOAT4_OID),
    ("FLOAT", FLOAT8_OID),
    ("BOOLEAN", BOOL_OID),
    ("BOOL", BOOL_OID),
    ("CHARACTER VARYING", VARCHAR_OID),
    ("VARCHAR", VARCHAR_OID),
    ("CHARACTER", VARCHAR_OID),
    ("CHAR", VARCHAR_OID),
    ("TEXT", TEXT_OID),
    ("TIMESTAMPTZ", TIMESTAMPTZ_OID),
    ("TIMESTAMP WITH TIME ZONE", TIMESTAMPTZ_OID),
    ("TIMESTAMP", TIMESTAMP_OID),
    ("DATE", DATE_OID),
    ("TIME", TIME_OID),
    ("JSONB", JSONB_OID),
    ("JSON", JSON_OID),
    ("UUID", UUID_OID),
    ("BYTEA", BYTEA_OID),
];

/// A column's declared Postgres type, as the lesson's own DDL wrote it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Declared {
    /// The base name, upper-cased and without its parameter list (`NUMERIC`).
    pub base: String,
    /// A `NUMERIC(p,s)` column's scale. This is the reason the declaration is parsed
    /// at all: money must be rendered at its declared scale to be exact.
    pub scale: Option<u32>,
}

impl Declared {
    /// Parse `NUMERIC(12,2)`, `character varying(40)`, `text` — whatever SQLite hands
    /// back from `decl_type()`, which is byte-for-byte what the lesson's DDL declared.
    pub fn parse(declaration: &str) -> Self {
        let (name, parameters) = match declaration.split_once('(') {
            Some((name, rest)) => (name, rest.trim_end_matches(')')),
            None => (declaration, ""),
        };
        Declared {
            base: name.trim().to_uppercase(),
            // `NUMERIC(12,2)` → scale 2; `NUMERIC(12)` and bare `NUMERIC` → scale 0,
            // which is what Postgres means by an omitted scale.
            scale: match parameters.is_empty() {
                true => None,
                false => Some(
                    parameters
                        .split_once(',')
                        .map_or(0, |(_, scale)| scale.trim().parse().unwrap_or(0)),
                ),
            },
        }
    }

    pub fn oid(&self) -> i32 {
        DECLARED_OIDS
            .iter()
            .find(|(name, _)| *name == self.base)
            // An unrecognised declaration is reported as text rather than guessed at:
            // every client can render text, so the student sees the value and not a
            // driver-level decoding failure.
            .map_or(TEXT_OID, |(_, oid)| *oid)
    }

    /// Whether values in this column are exact decimals, which must be rendered at
    /// the declared scale rather than however the double happens to print.
    fn numeric_scale(&self) -> Option<u32> {
        match self.oid() == NUMERIC_OID {
            true => Some(self.scale.unwrap_or(0)),
            false => None,
        }
    }
}

/// The OID to report for a result column: its declared type when the column comes
/// straight from a table, otherwise inferred from the value the engine produced.
///
/// `SELECT count(*)` has no declared type, so the fallback is what answers for every
/// computed column — the same position real Postgres is in, which is why an
/// expression column's `RowDescription` there carries no table or column number.
pub fn column_oid(declared: Option<&Declared>, sample: Option<&Value>) -> i32 {
    if let Some(declared) = declared {
        return declared.oid();
    }
    match sample {
        // `count(*)` and friends are 64-bit in Postgres, so int8 is the honest report.
        Some(Value::Integer(_)) => INT8_OID,
        Some(Value::Real(_)) => FLOAT8_OID,
        Some(Value::Blob(_)) => BYTEA_OID,
        _ => TEXT_OID,
    }
}

/// Render one value as the text a client receives, or `None` for SQL NULL.
///
/// Text is the only format the emulator sends (see `crate::session`), so this is the
/// single place a stored value becomes wire bytes.
pub fn encode(value: &Value, declared: Option<&Declared>) -> Option<Vec<u8>> {
    let scale = declared.and_then(Declared::numeric_scale);
    let text = match value {
        Value::Null => return None,
        Value::Integer(number) => match scale {
            // A NUMERIC column SQLite chose to store as an integer still owes the
            // client its declared scale: `1000` in `NUMERIC(12,2)` is `1000.00`.
            Some(scale) => render_numeric(*number as f64, scale),
            None => number.to_string(),
        },
        Value::Real(number) => match scale {
            Some(scale) => render_numeric(*number, scale),
            // Postgres renders float8 with enough digits to round-trip, and Rust's
            // shortest-round-trip default is exactly that.
            None => render_float(*number),
        },
        Value::Text(text) => text.clone(),
        // `bytea` in Postgres' text format is `\x` followed by lowercase hex.
        Value::Blob(bytes) => {
            let mut hex = String::from("\\x");
            for byte in bytes {
                hex.push_str(&format!("{byte:02x}"));
            }
            hex
        }
    };
    Some(text.into_bytes())
}

/// Render an exact decimal at `scale` digits, rounding **half away from zero** — which
/// is what Postgres `NUMERIC` does and what a student expects of money. Rust's `{:.2}`
/// rounds half to even, so it would render `0.125` as `0.12` where Postgres says `0.13`.
///
/// The digits are assembled around a manually placed decimal point rather than by
/// dividing back down, because dividing would reintroduce the binary error the rounding
/// just removed.
fn render_numeric(number: f64, scale: u32) -> String {
    if !number.is_finite() {
        return render_float(number);
    }
    let factor = 10f64.powi(scale as i32);
    let digits = format!("{:.0}", (number.abs() * factor + 0.5).floor());
    let sign = match number < 0.0 && digits != "0" {
        true => "-",
        false => "",
    };
    if scale == 0 {
        return format!("{sign}{digits}");
    }
    // One leading digit is guaranteed, so `0.5` at scale 2 reads `0.50` and not `.50`.
    let padded = format!("{digits:0>width$}", width = scale as usize + 1);
    let point = padded.len() - scale as usize;
    format!("{sign}{}.{}", &padded[..point], &padded[point..])
}

/// Postgres always writes a float with a decimal point or an exponent, so a client
/// that keys its parsing off the shape does not read `1` as an integer.
fn render_float(number: f64) -> String {
    let text = number.to_string();
    match text.contains(['.', 'e', 'E']) || !number.is_finite() {
        true => text,
        false => format!("{text}."),
    }
}

/// A `bool` column stores 0/1 in SQLite but Postgres sends `t`/`f`, and every client
/// decodes those. Applied after [`encode`], on the column's own values only.
pub fn encode_bool(value: &Value) -> Option<Vec<u8>> {
    let truthy = match value {
        Value::Null => return None,
        Value::Integer(number) => *number != 0,
        Value::Real(number) => *number != 0.0,
        Value::Text(text) => !matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "" | "0" | "f" | "false" | "n" | "no" | "off"
        ),
        Value::Blob(bytes) => !bytes.is_empty(),
    };
    Some(match truthy {
        true => b"t".to_vec(),
        false => b"f".to_vec(),
    })
}

/// Render one value for `GET /state`, which is what a grader asserts on.
///
/// Money is a string, deliberately: a `NUMERIC(12,2)` balance is an exact decimal and
/// a JSON number is a double, so `"900.00"` is the only rendering that cannot drift.
/// Everything else keeps its natural JSON type.
pub fn to_json(value: &Value, declared: Option<&Declared>) -> serde_json::Value {
    if declared.and_then(Declared::numeric_scale).is_some() {
        return match encode(value, declared) {
            None => serde_json::Value::Null,
            Some(text) => serde_json::Value::String(String::from_utf8_lossy(&text).into_owned()),
        };
    }
    if declared.map(Declared::oid) == Some(BOOL_OID) {
        return match encode_bool(value) {
            Some(text) => serde_json::Value::Bool(text == b"t"),
            None => serde_json::Value::Null,
        };
    }
    match value {
        Value::Null => serde_json::Value::Null,
        Value::Integer(number) => serde_json::json!(number),
        Value::Real(number) => serde_json::json!(number),
        Value::Text(text) => serde_json::Value::String(text.clone()),
        Value::Blob(_) => match encode(value, declared) {
            Some(hex) => serde_json::Value::String(String::from_utf8_lossy(&hex).into_owned()),
            None => serde_json::Value::Null,
        },
    }
}

/// Render one value for a snapshot, which must round-trip through [`from_json`]
/// *losslessly* — a snapshot is replayed by every `/reset`, so a value that changed
/// storage type on the way through would drift a little on each test case.
///
/// The one type whose `/state` rendering is not reversible is `bytea`: `"\xff"` reads
/// back as text, not bytes. So a blob becomes a byte array here, exactly as
/// `cannae-cache` does for a non-UTF-8 cache value.
pub fn to_snapshot_json(value: &Value, _declared: Option<&Declared>) -> serde_json::Value {
    match value {
        Value::Null => serde_json::Value::Null,
        Value::Integer(number) => serde_json::json!(number),
        Value::Real(number) => serde_json::json!(number),
        Value::Text(text) => serde_json::Value::String(text.clone()),
        Value::Blob(bytes) => serde_json::Value::Array(bytes.iter().map(|b| json!(b)).collect()),
    }
}

/// Turn a JSON value from a seed fixture into something SQLite can store. An array of
/// `0..=255` is a `bytea`, which is also the form [`to_snapshot_json`] emits.
pub fn from_json(column: &str, value: &serde_json::Value) -> Result<Value, String> {
    match value {
        serde_json::Value::Null => Ok(Value::Null),
        serde_json::Value::Bool(flag) => Ok(Value::Integer(i64::from(*flag))),
        serde_json::Value::String(text) => Ok(Value::Text(text.clone())),
        serde_json::Value::Number(number) => match number.as_i64() {
            Some(whole) => Ok(Value::Integer(whole)),
            // `as_f64` only returns `None` for a number no `f64` can hold, which
            // `serde_json` will not produce from valid JSON.
            None => Ok(Value::Real(number.as_f64().unwrap_or_default())),
        },
        serde_json::Value::Array(bytes) => bytes
            .iter()
            .map(|byte| {
                byte.as_u64()
                    .filter(|byte| *byte <= u8::MAX as u64)
                    .map(|byte| byte as u8)
                    .ok_or_else(|| format!("{column}: byte-array values must hold 0..=255"))
            })
            .collect::<Result<Vec<u8>, _>>()
            .map(Value::Blob),
        // An object would have to be guessed at — a JSON column's text, or something
        // else? A fixture says which by writing the value it means.
        _ => Err(format!(
            "{column}: a row value must be a string, number, boolean, null, \
             or a byte array (write a JSON column as its text form)"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn declared(declaration: &str) -> Declared {
        Declared::parse(declaration)
    }

    #[test]
    fn a_declaration_is_split_into_a_base_name_and_a_scale() {
        assert_eq!(
            declared("NUMERIC(12,2)"),
            Declared {
                base: "NUMERIC".into(),
                scale: Some(2)
            }
        );
        assert_eq!(declared("numeric (12, 4)").scale, Some(4));
        // An omitted scale is zero, exactly as Postgres reads `NUMERIC(12)`.
        assert_eq!(declared("NUMERIC(12)").scale, Some(0));
        assert_eq!(declared("  text  ").base, "TEXT");
        assert_eq!(declared("TEXT").scale, None);
        // A garbled scale falls back to zero rather than failing a query mid-flight.
        assert_eq!(declared("NUMERIC(12,x)").scale, Some(0));
    }

    #[test]
    fn every_type_a_lesson_may_declare_maps_to_its_real_oid() {
        let expected = [
            ("SERIAL", INT4_OID),
            ("BIGSERIAL", INT8_OID),
            ("SMALLSERIAL", INT2_OID),
            ("integer", INT4_OID),
            ("INT", INT4_OID),
            ("int2", INT2_OID),
            ("int4", INT4_OID),
            ("int8", INT8_OID),
            ("SMALLINT", INT2_OID),
            ("BIGINT", INT8_OID),
            ("NUMERIC(12,2)", NUMERIC_OID),
            ("decimal", NUMERIC_OID),
            ("money", NUMERIC_OID),
            ("DOUBLE PRECISION", FLOAT8_OID),
            ("float8", FLOAT8_OID),
            ("float", FLOAT8_OID),
            ("REAL", FLOAT4_OID),
            ("float4", FLOAT4_OID),
            ("BOOLEAN", BOOL_OID),
            ("bool", BOOL_OID),
            ("VARCHAR(40)", VARCHAR_OID),
            ("character varying(40)", VARCHAR_OID),
            ("CHAR(2)", VARCHAR_OID),
            ("character(2)", VARCHAR_OID),
            ("TEXT", TEXT_OID),
            ("TIMESTAMPTZ", TIMESTAMPTZ_OID),
            ("timestamp with time zone", TIMESTAMPTZ_OID),
            ("TIMESTAMP", TIMESTAMP_OID),
            ("DATE", DATE_OID),
            ("TIME", TIME_OID),
            ("JSONB", JSONB_OID),
            ("json", JSON_OID),
            ("UUID", UUID_OID),
            ("BYTEA", BYTEA_OID),
        ];
        for (declaration, oid) in expected {
            assert_eq!(declared(declaration).oid(), oid, "{declaration}");
        }
        // Anything unrecognised is reported as text, so the student sees the value.
        assert_eq!(declared("hstore").oid(), TEXT_OID);
    }

    #[test]
    fn a_computed_column_takes_its_oid_from_the_value_the_engine_produced() {
        assert_eq!(column_oid(None, Some(&Value::Integer(3))), INT8_OID);
        assert_eq!(column_oid(None, Some(&Value::Real(1.5))), FLOAT8_OID);
        assert_eq!(column_oid(None, Some(&Value::Text("a".into()))), TEXT_OID);
        assert_eq!(column_oid(None, Some(&Value::Blob(vec![1]))), BYTEA_OID);
        assert_eq!(column_oid(None, Some(&Value::Null)), TEXT_OID);
        // No rows at all: nothing to infer from, so text.
        assert_eq!(column_oid(None, None), TEXT_OID);
        // A declared type always wins over the sample.
        assert_eq!(
            column_oid(Some(&declared("NUMERIC(12,2)")), Some(&Value::Integer(3))),
            NUMERIC_OID
        );
    }

    /// The property the banking lesson rests on: a balance is rendered at its declared
    /// scale, so `1000 - 100` reads as `900.00` and not `900` or `899.9999999`.
    #[test]
    fn money_is_rendered_at_its_declared_scale() {
        let money = declared("NUMERIC(12,2)");
        let render =
            |value: Value| String::from_utf8(encode(&value, Some(&money)).unwrap()).unwrap();
        assert_eq!(render(Value::Integer(1000)), "1000.00");
        assert_eq!(render(Value::Real(900.0)), "900.00");
        assert_eq!(render(Value::Real(999.9)), "999.90");
        // Half rounds away from zero, as Postgres NUMERIC does — Rust's `{:.2}` would
        // round this to `0.12`.
        assert_eq!(render(Value::Real(0.125)), "0.13");
        assert_eq!(render(Value::Real(-0.125)), "-0.13");
        assert_eq!(render(Value::Real(0.5)), "0.50");
        assert_eq!(
            render(Value::Real(-0.001)),
            "0.00",
            "negative zero has no sign"
        );
        assert_eq!(render(Value::Real(f64::NAN)), "NaN");
        // A scale-free NUMERIC still gets a decimal-free rendering.
        assert_eq!(
            String::from_utf8(encode(&Value::Integer(7), Some(&declared("NUMERIC"))).unwrap())
                .unwrap(),
            "7"
        );
    }

    #[test]
    fn encoding_covers_every_stored_type() {
        let text = |value: Value, decl: Option<&Declared>| {
            encode(&value, decl).map(|bytes| String::from_utf8(bytes).unwrap())
        };
        assert_eq!(text(Value::Null, None), None);
        assert_eq!(text(Value::Integer(-3), None).unwrap(), "-3");
        assert_eq!(text(Value::Text("ada".into()), None).unwrap(), "ada");
        assert_eq!(
            text(Value::Blob(vec![0x00, 0xff]), None).unwrap(),
            "\\x00ff"
        );
        // Postgres always writes a float with a point or an exponent.
        assert_eq!(text(Value::Real(1.0), None).unwrap(), "1.");
        assert_eq!(text(Value::Real(1.5), None).unwrap(), "1.5");
        assert_eq!(text(Value::Real(f64::INFINITY), None).unwrap(), "inf");
        // A float8 column takes the same shortest-round-trip rendering.
        let float = declared("DOUBLE PRECISION");
        assert_eq!(text(Value::Real(0.1), Some(&float)).unwrap(), "0.1");
    }

    #[test]
    fn a_boolean_is_sent_as_the_t_or_f_every_client_decodes() {
        let flag = |value: Value| encode_bool(&value).map(|b| String::from_utf8(b).unwrap());
        assert_eq!(flag(Value::Integer(1)).unwrap(), "t");
        assert_eq!(flag(Value::Integer(0)).unwrap(), "f");
        assert_eq!(flag(Value::Real(0.0)).unwrap(), "f");
        assert_eq!(flag(Value::Real(2.5)).unwrap(), "t");
        assert_eq!(flag(Value::Text("true".into())).unwrap(), "t");
        assert_eq!(flag(Value::Text("FALSE".into())).unwrap(), "f");
        assert_eq!(flag(Value::Text("no".into())).unwrap(), "f");
        assert_eq!(flag(Value::Text("".into())).unwrap(), "f");
        assert_eq!(flag(Value::Blob(vec![1])).unwrap(), "t");
        assert_eq!(flag(Value::Blob(Vec::new())).unwrap(), "f");
        assert_eq!(flag(Value::Null), None);
    }

    /// `/state` is what a grader asserts on, so money stays an exact string while
    /// everything else keeps the JSON type it naturally has.
    #[test]
    fn state_json_keeps_money_exact_and_everything_else_natural() {
        let money = declared("NUMERIC(12,2)");
        assert_eq!(to_json(&Value::Real(900.0), Some(&money)), json!("900.00"));
        assert_eq!(to_json(&Value::Null, Some(&money)), json!(null));
        assert_eq!(to_json(&Value::Integer(7), None), json!(7));
        assert_eq!(to_json(&Value::Real(1.5), None), json!(1.5));
        assert_eq!(to_json(&Value::Text("ada".into()), None), json!("ada"));
        assert_eq!(to_json(&Value::Null, None), json!(null));
        assert_eq!(to_json(&Value::Blob(vec![0xff]), None), json!("\\xff"));

        let flag = declared("BOOLEAN");
        assert_eq!(to_json(&Value::Integer(1), Some(&flag)), json!(true));
        assert_eq!(to_json(&Value::Integer(0), Some(&flag)), json!(false));
        assert_eq!(to_json(&Value::Null, Some(&flag)), json!(null));
    }

    #[test]
    fn a_seeded_row_value_becomes_something_sqlite_can_store() {
        assert_eq!(from_json("c", &json!(null)), Ok(Value::Null));
        assert_eq!(from_json("c", &json!(true)), Ok(Value::Integer(1)));
        assert_eq!(from_json("c", &json!(false)), Ok(Value::Integer(0)));
        assert_eq!(from_json("c", &json!(7)), Ok(Value::Integer(7)));
        assert_eq!(from_json("c", &json!(1.5)), Ok(Value::Real(1.5)));
        assert_eq!(
            from_json("c", &json!("1000.00")),
            Ok(Value::Text("1000.00".into()))
        );
        // A byte array is a bytea — the form a snapshot writes a blob as.
        assert_eq!(
            from_json("c", &json!([0, 255])),
            Ok(Value::Blob(vec![0, 255]))
        );
        assert!(from_json("c", &json!([256])).is_err());
        assert!(from_json("c", &json!(["a"])).is_err());
        // An object would have to be guessed at, so a fixture must say what it means.
        assert!(from_json("balance", &json!({})).is_err());
    }

    /// A snapshot is replayed by every `/reset`, so it must round-trip exactly — and
    /// `/state`'s `\xff` rendering of a blob does not, which is why the two differ.
    #[test]
    fn a_snapshot_rendering_round_trips_through_from_json() {
        for value in [
            Value::Null,
            Value::Integer(-3),
            Value::Real(1.5),
            Value::Text("ada".into()),
            Value::Blob(vec![0, 255, 128]),
        ] {
            let rendered = to_snapshot_json(&value, Some(&declared("NUMERIC(12,2)")));
            assert_eq!(from_json("c", &rendered), Ok(value.clone()), "{value:?}");
        }
    }
}
