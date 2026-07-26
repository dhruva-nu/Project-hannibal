//! Postgres frontend/backend protocol v3 framing — the only wire format the SQL
//! emulator speaks.
//!
//! Two shapes of frontend message exist and the difference is load-bearing: the
//! *startup* packet is length-prefixed with **no type byte**, everything after it is
//! `tag + length + body`. A connection therefore has a phase, which is why
//! [`crate::session::Session`] remembers whether it has been through startup.
//!
//! TLS is refused (`SSLRequest` → `N`), exactly as `plans/infra-emulators.md` §4
//! specifies: the emulator lives on an internal Docker network the student cannot
//! route off, so a certificate would buy nothing and every blessed client accepts
//! the refusal and continues in plaintext.

use cannae_core::Reader;
use std::collections::BTreeMap;
use std::io;
use tokio::io::AsyncReadExt;

/// Ceiling on one regular message. Postgres allows 1GB; the emulator container is
/// capped at 128MB and the client is untrusted student code, so a header claiming
/// more than this is refused before a byte is allocated.
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;

/// Ceiling on the startup packet, which carries only connection parameters. Real
/// Postgres uses 10000; a little more is harmless and a lot is a broken client.
const MAX_STARTUP_BYTES: usize = 64 * 1024;

/// `SSLRequest`, sent as a startup packet before any real one.
const SSL_REQUEST_CODE: i32 = 80877103;
/// `GSSENCRequest` — the same "can we encrypt?" question, refused the same way.
const GSSENC_REQUEST_CODE: i32 = 80877104;
/// `CancelRequest`, sent on a *second* connection to cancel work on the first.
const CANCEL_REQUEST_CODE: i32 = 80877102;
/// Protocol version 3.0, the only one any current client speaks.
const PROTOCOL_V3: i32 = 196_608;

/// Where a connection is in its lifecycle, which decides how the next bytes frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Nothing read yet: the next packet is a startup packet, with no type byte.
    Startup,
    /// Startup is done: every later message is `tag + length + body`.
    Running,
}

/// The transaction status byte in every `ReadyForQuery`. This is both a protocol
/// obligation and the grading signal the banking lesson turns on, so it is one type
/// rather than a bare `u8` (`plans/infra-emulators.md` §4).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TxStatus {
    /// No transaction open.
    #[default]
    Idle,
    /// Inside a transaction block.
    Open,
    /// Inside a transaction block that has failed: every statement but `COMMIT` /
    /// `ROLLBACK` is refused until the block ends.
    Failed,
}

impl TxStatus {
    pub fn code(self) -> u8 {
        match self {
            TxStatus::Idle => b'I',
            TxStatus::Open => b'T',
            TxStatus::Failed => b'E',
        }
    }
}

/// One decoded frontend message. Only the messages the emulator implements have a
/// variant; anything else is [`Frontend::Unknown`], which is answered with a real
/// protocol error rather than ignored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Frontend {
    /// `SSLRequest` or `GSSENCRequest` — both mean "may we encrypt?", both refused.
    EncryptionRequest,
    /// `CancelRequest`. Carries no useful state here: the emulator runs one statement
    /// at a time, so there is never in-flight work to cancel.
    Cancel,
    /// The real startup packet's connection parameters (`user`, `database`, …).
    Startup(BTreeMap<String, String>),
    Query(String),
    Parse {
        name: String,
        sql: String,
    },
    Bind {
        portal: String,
        statement: String,
        /// Per-parameter format codes: 0 text, 1 binary. Kept verbatim so
        /// [`crate::session`] can refuse binary loudly instead of mis-decoding.
        formats: Vec<i16>,
        /// `None` is a SQL NULL parameter, which is distinct from an empty string.
        params: Vec<Option<Vec<u8>>>,
        result_formats: Vec<i16>,
    },
    Describe {
        /// `S` for a prepared statement, `P` for a portal.
        kind: u8,
        name: String,
    },
    Execute {
        portal: String,
        /// 0 means "every row"; a positive value asks for at most that many and
        /// leaves the portal suspended.
        max_rows: i32,
    },
    Close {
        kind: u8,
        name: String,
    },
    Sync,
    Flush,
    Terminate,
    /// A message tag the emulator does not implement, kept so it can be reported.
    Unknown(u8),
}

/// Read one startup packet. `Ok(None)` on clean EOF — a client that connected and
/// went away without saying anything, which is what a port scan looks like.
pub async fn read_startup(reader: &mut Reader) -> io::Result<Option<Frontend>> {
    let Some(length) = read_length(reader).await? else {
        return Ok(None);
    };
    let body = read_body(reader, length, MAX_STARTUP_BYTES).await?;
    let mut scan = Scan::new(&body);
    let code = scan.i32()?;
    match code {
        SSL_REQUEST_CODE | GSSENC_REQUEST_CODE => Ok(Some(Frontend::EncryptionRequest)),
        CANCEL_REQUEST_CODE => Ok(Some(Frontend::Cancel)),
        PROTOCOL_V3 => Ok(Some(Frontend::Startup(scan.parameters()?))),
        // A version we do not speak is refused by name. Guessing would hand the
        // client a stream framed for a protocol neither side agreed on.
        other => Err(protocol_error(format!(
            "unsupported protocol version {}.{} (expected 3.0)",
            other >> 16,
            other & 0xffff
        ))),
    }
}

/// Read one post-startup message. `Ok(None)` on clean EOF.
pub async fn read_message(reader: &mut Reader) -> io::Result<Option<Frontend>> {
    let Some(tag) = read_tag(reader).await? else {
        return Ok(None);
    };
    let length = read_length(reader)
        .await?
        .ok_or_else(|| protocol_error(format!("EOF inside a '{}' message", tag as char)))?;
    let body = read_body(reader, length, MAX_MESSAGE_BYTES).await?;
    let mut scan = Scan::new(&body);
    let message = match tag {
        b'Q' => Frontend::Query(scan.string()?),
        b'P' => parse_message(&mut scan)?,
        b'B' => bind_message(&mut scan)?,
        b'D' => Frontend::Describe {
            kind: scan.u8()?,
            name: scan.string()?,
        },
        b'E' => Frontend::Execute {
            portal: scan.string()?,
            max_rows: scan.i32()?,
        },
        b'C' => Frontend::Close {
            kind: scan.u8()?,
            name: scan.string()?,
        },
        b'S' => Frontend::Sync,
        b'H' => Frontend::Flush,
        b'X' => Frontend::Terminate,
        other => Frontend::Unknown(other),
    };
    Ok(Some(message))
}

/// `Parse` also carries the parameter type OIDs the client wants. They are dropped:
/// every parameter is taken in its text form and handed to SQLite, which applies the
/// target column's affinity — so a client's guess at a type cannot change the result.
fn parse_message(scan: &mut Scan) -> io::Result<Frontend> {
    let name = scan.string()?;
    let sql = scan.string()?;
    let declared = scan.i16()?;
    for _ in 0..declared.max(0) {
        scan.i32()?;
    }
    Ok(Frontend::Parse { name, sql })
}

fn bind_message(scan: &mut Scan) -> io::Result<Frontend> {
    let portal = scan.string()?;
    let statement = scan.string()?;
    let formats = scan.i16_list()?;
    let mut params = Vec::new();
    for _ in 0..scan.i16()?.max(0) {
        params.push(scan.nullable_bytes()?);
    }
    Ok(Frontend::Bind {
        portal,
        statement,
        formats,
        params,
        result_formats: scan.i16_list()?,
    })
}

async fn read_tag(reader: &mut Reader) -> io::Result<Option<u8>> {
    match reader.read_u8().await {
        Ok(tag) => Ok(Some(tag)),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(None),
        Err(error) => Err(error),
    }
}

/// Read the four-byte length prefix, which counts itself. `Ok(None)` on clean EOF.
async fn read_length(reader: &mut Reader) -> io::Result<Option<i32>> {
    let mut bytes = [0u8; 4];
    match reader.read_exact(&mut bytes).await {
        Ok(_) => Ok(Some(i32::from_be_bytes(bytes))),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(None),
        Err(error) => Err(error),
    }
}

/// Read the body a length prefix describes, proving the header affordable before
/// allocating for it.
async fn read_body(reader: &mut Reader, length: i32, max: usize) -> io::Result<Vec<u8>> {
    // The prefix counts its own four bytes, so anything below that is nonsense and
    // `length - 4` would underflow into a gigantic allocation.
    if length < 4 || length as usize > max {
        return Err(protocol_error(format!(
            "message length {length} outside 4..={max}"
        )));
    }
    let mut body = vec![0u8; length as usize - 4];
    reader.read_exact(&mut body).await?;
    Ok(body)
}

/// A cursor over one message body. Every read is bounds-checked, so a truncated or
/// hostile frame is a protocol error rather than a panic.
struct Scan<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Scan<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Scan { bytes, at: 0 }
    }

    fn take(&mut self, count: usize) -> io::Result<&'a [u8]> {
        let end = self
            .at
            .checked_add(count)
            .filter(|end| *end <= self.bytes.len());
        let end = end.ok_or_else(|| {
            protocol_error(format!(
                "message body is {} bytes, needed {count} more at offset {}",
                self.bytes.len(),
                self.at
            ))
        })?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u8(&mut self) -> io::Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn i16(&mut self) -> io::Result<i16> {
        Ok(i16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn i32(&mut self) -> io::Result<i32> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }

    /// One NUL-terminated string. Invalid UTF-8 is refused rather than replaced:
    /// SQL text or a parameter silently mangled would run as something the student
    /// never wrote.
    fn string(&mut self) -> io::Result<String> {
        let end = self.bytes[self.at..]
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(|| protocol_error("unterminated string in a message body"))?;
        let text = std::str::from_utf8(self.take(end)?)
            .map_err(|_| protocol_error("a message string is not valid UTF-8"))?
            .to_string();
        self.at += 1; // the NUL
        Ok(text)
    }

    /// An `int16` count followed by that many `int16`s — the shape of both format
    /// code lists in `Bind`.
    fn i16_list(&mut self) -> io::Result<Vec<i16>> {
        let count = self.i16()?.max(0);
        (0..count).map(|_| self.i16()).collect()
    }

    /// A length-prefixed value where `-1` is SQL NULL, not an empty value.
    fn nullable_bytes(&mut self) -> io::Result<Option<Vec<u8>>> {
        match self.i32()? {
            -1 => Ok(None),
            length if length < 0 => Err(protocol_error(format!(
                "parameter length {length} is neither a size nor NULL"
            ))),
            length => Ok(Some(self.take(length as usize)?.to_vec())),
        }
    }

    /// The startup packet's `key\0value\0…\0` parameter list.
    fn parameters(&mut self) -> io::Result<BTreeMap<String, String>> {
        let mut parameters = BTreeMap::new();
        while self.at < self.bytes.len() {
            let key = self.string()?;
            if key.is_empty() {
                break;
            }
            parameters.insert(key, self.string()?);
        }
        Ok(parameters)
    }
}

fn protocol_error(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

/// One result column, as `RowDescription` describes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Field {
    pub name: String,
    pub oid: i32,
}

/// A Postgres error or notice: the SQLSTATE the client's driver keys its behaviour
/// off, plus the message a student reads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PgError {
    pub sqlstate: String,
    pub message: String,
}

impl PgError {
    pub fn new(sqlstate: impl Into<String>, message: impl Into<String>) -> Self {
        PgError {
            sqlstate: sqlstate.into(),
            message: message.into(),
        }
    }
}

/// A body under construction. Separate from [`Out`] so a message's length prefix is
/// always computed from the finished body, never hand-counted.
#[derive(Default)]
struct Body(Vec<u8>);

impl Body {
    fn u8(&mut self, value: u8) -> &mut Self {
        self.0.push(value);
        self
    }

    fn i16(&mut self, value: i16) -> &mut Self {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }

    fn i32(&mut self, value: i32) -> &mut Self {
        self.0.extend_from_slice(&value.to_be_bytes());
        self
    }

    fn string(&mut self, value: &str) -> &mut Self {
        self.0.extend_from_slice(value.as_bytes());
        self.0.push(0);
        self
    }
}

/// The backend messages one op replies with, accumulated in order.
///
/// A reply is a *sequence* of messages, not one frame — a `SELECT` answers with
/// `RowDescription`, a `DataRow` per row, `CommandComplete`, and (in the simple
/// protocol) `ReadyForQuery`. Building them into one byte string means the kit's
/// `execute` contract (`Op` → `Vec<u8>`) needs no widening.
#[derive(Default)]
pub struct Out(Vec<u8>);

impl Out {
    pub fn new() -> Self {
        Out::default()
    }

    pub fn finish(self) -> Vec<u8> {
        self.0
    }

    fn message(&mut self, tag: u8, body: Body) -> &mut Self {
        self.0.push(tag);
        // The prefix counts itself, hence the +4.
        self.0
            .extend_from_slice(&((body.0.len() + 4) as i32).to_be_bytes());
        self.0.extend_from_slice(&body.0);
        self
    }

    fn empty_message(&mut self, tag: u8) -> &mut Self {
        self.message(tag, Body::default())
    }

    /// The one-byte answer to `SSLRequest` / `GSSENCRequest`: no, carry on in
    /// plaintext. Deliberately *not* length-prefixed — this reply predates framing.
    pub fn encryption_refused(&mut self) -> &mut Self {
        self.0.push(b'N');
        self
    }

    /// Trust authentication: no password is asked for and none is checked. §10 of the
    /// plan puts real auth out of scope, and a lesson prop that pretended to verify a
    /// password would teach that the check happened.
    pub fn authentication_ok(&mut self) -> &mut Self {
        self.message(b'R', {
            let mut body = Body::default();
            body.i32(0);
            body
        })
    }

    pub fn parameter_status(&mut self, name: &str, value: &str) -> &mut Self {
        self.message(b'S', {
            let mut body = Body::default();
            body.string(name).string(value);
            body
        })
    }

    /// The cancellation key a client would present on a `CancelRequest`. Fixed, not
    /// random: the op log has to be byte-identical across runs, and nothing here
    /// consults the key anyway.
    pub fn backend_key_data(&mut self, pid: i32, secret: i32) -> &mut Self {
        self.message(b'K', {
            let mut body = Body::default();
            body.i32(pid).i32(secret);
            body
        })
    }

    pub fn ready_for_query(&mut self, status: TxStatus) -> &mut Self {
        self.message(b'Z', {
            let mut body = Body::default();
            body.u8(status.code());
            body
        })
    }

    /// `RowDescription`. Table OID, column number, type size and type modifier are
    /// all sent as "unknown" (`0` / `-1`), which is legal for any type and is what a
    /// column computed by an expression gets from real Postgres too. Every blessed
    /// client reads the name and the type OID and ignores the rest.
    pub fn row_description(&mut self, fields: &[Field]) -> &mut Self {
        self.message(b'T', {
            let mut body = Body::default();
            body.i16(fields.len() as i16);
            for field in fields {
                body.string(&field.name)
                    .i32(0)
                    .i16(0)
                    .i32(field.oid)
                    .i16(-1)
                    .i32(-1)
                    .i16(0);
            }
            body
        })
    }

    /// One row. `None` is SQL NULL (length `-1`), which every client distinguishes
    /// from an empty string — and which a lesson about missing rows turns on.
    pub fn data_row(&mut self, values: &[Option<Vec<u8>>]) -> &mut Self {
        self.message(b'D', {
            let mut body = Body::default();
            body.i16(values.len() as i16);
            for value in values {
                match value {
                    None => body.i32(-1),
                    Some(bytes) => {
                        body.i32(bytes.len() as i32);
                        body.0.extend_from_slice(bytes);
                        &mut body
                    }
                };
            }
            body
        })
    }

    pub fn command_complete(&mut self, tag: &str) -> &mut Self {
        self.message(b'C', {
            let mut body = Body::default();
            body.string(tag);
            body
        })
    }

    /// The reply to a query string that held no statement — a distinct message from
    /// `CommandComplete`, and clients do tell them apart.
    pub fn empty_query(&mut self) -> &mut Self {
        self.empty_message(b'I')
    }

    pub fn parse_complete(&mut self) -> &mut Self {
        self.empty_message(b'1')
    }

    pub fn bind_complete(&mut self) -> &mut Self {
        self.empty_message(b'2')
    }

    pub fn close_complete(&mut self) -> &mut Self {
        self.empty_message(b'3')
    }

    /// The answer to `Describe` for a statement that returns no rows.
    pub fn no_data(&mut self) -> &mut Self {
        self.empty_message(b'n')
    }

    /// `Execute` hit its row limit with rows still to come; the client re-executes.
    pub fn portal_suspended(&mut self) -> &mut Self {
        self.empty_message(b's')
    }

    /// `ParameterDescription`. Every parameter is reported as `text`: nothing here
    /// infers parameter types, and text is the format the emulator accepts, so
    /// saying so is what keeps a client from sending binary the emulator refuses.
    pub fn parameter_description(&mut self, count: usize) -> &mut Self {
        self.message(b't', {
            let mut body = Body::default();
            body.i16(count as i16);
            for _ in 0..count {
                body.i32(crate::types::TEXT_OID);
            }
            body
        })
    }

    pub fn error(&mut self, error: &PgError) -> &mut Self {
        self.diagnostic(b'E', "ERROR", error)
    }

    /// A warning that is not an error — `COMMIT` with no transaction open, say. Real
    /// Postgres warns and carries on, and so must this: a lesson that taught a bare
    /// `COMMIT` was fatal would teach something false.
    pub fn notice(&mut self, error: &PgError) -> &mut Self {
        self.diagnostic(b'N', "WARNING", error)
    }

    fn diagnostic(&mut self, tag: u8, severity: &str, error: &PgError) -> &mut Self {
        self.message(tag, {
            let mut body = Body::default();
            // `S` is the localised severity and `V` the machine-readable one; drivers
            // read whichever they were written against, so both are sent.
            body.u8(b'S')
                .string(severity)
                .u8(b'V')
                .string(severity)
                .u8(b'C')
                .string(&error.sqlstate)
                .u8(b'M')
                .string(&error.message)
                .u8(0);
            body
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncWriteExt, BufReader};
    use tokio::net::{TcpListener, TcpStream};

    /// `Reader` is a `BufReader<OwnedReadHalf>`, so a real socket is the only way to
    /// build one — a loopback pair is the cheapest source.
    async fn reader_over(bytes: &[u8]) -> Reader {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let bytes = bytes.to_vec();
        tokio::spawn(async move {
            let (mut server, _) = listener.accept().await.unwrap();
            server.write_all(&bytes).await.unwrap();
        });
        let (read_half, _write_half) = TcpStream::connect(addr).await.unwrap().into_split();
        BufReader::new(read_half)
    }

    /// Frame a startup packet: a self-counting length, then the body.
    fn startup(body: &[u8]) -> Vec<u8> {
        let mut frame = ((body.len() + 4) as i32).to_be_bytes().to_vec();
        frame.extend_from_slice(body);
        frame
    }

    fn message(tag: u8, body: &[u8]) -> Vec<u8> {
        let mut frame = vec![tag];
        frame.extend_from_slice(&((body.len() + 4) as i32).to_be_bytes());
        frame.extend_from_slice(body);
        frame
    }

    fn cstr(text: &str) -> Vec<u8> {
        let mut bytes = text.as_bytes().to_vec();
        bytes.push(0);
        bytes
    }

    #[tokio::test]
    async fn a_startup_packet_yields_its_connection_parameters() {
        let mut body = PROTOCOL_V3.to_be_bytes().to_vec();
        body.extend(cstr("user"));
        body.extend(cstr("student"));
        body.extend(cstr("database"));
        body.extend(cstr("app"));
        body.push(0);
        let mut reader = reader_over(&startup(&body)).await;
        let Some(Frontend::Startup(parameters)) = read_startup(&mut reader).await.unwrap() else {
            panic!("expected a startup packet");
        };
        assert_eq!(parameters["user"], "student");
        assert_eq!(parameters["database"], "app");
    }

    #[tokio::test]
    async fn encryption_and_cancel_requests_are_recognised_before_startup() {
        for code in [SSL_REQUEST_CODE, GSSENC_REQUEST_CODE] {
            let mut reader = reader_over(&startup(&code.to_be_bytes())).await;
            assert_eq!(
                read_startup(&mut reader).await.unwrap(),
                Some(Frontend::EncryptionRequest),
                "code {code}"
            );
        }
        let mut reader = reader_over(&startup(&{
            let mut body = CANCEL_REQUEST_CODE.to_be_bytes().to_vec();
            body.extend_from_slice(&1i32.to_be_bytes());
            body.extend_from_slice(&2i32.to_be_bytes());
            body
        }))
        .await;
        assert_eq!(
            read_startup(&mut reader).await.unwrap(),
            Some(Frontend::Cancel)
        );
    }

    #[tokio::test]
    async fn a_closed_socket_is_a_clean_eof_in_both_phases() {
        let mut reader = reader_over(b"").await;
        assert_eq!(read_startup(&mut reader).await.unwrap(), None);
        let mut reader = reader_over(b"").await;
        assert_eq!(read_message(&mut reader).await.unwrap(), None);
    }

    /// Guessing at an unknown protocol version would frame the rest of the stream for
    /// something neither side agreed on.
    #[tokio::test]
    async fn an_unsupported_protocol_version_is_named_not_guessed() {
        let mut reader = reader_over(&startup(&131_072i32.to_be_bytes())).await;
        let error = read_startup(&mut reader).await.unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("2.0"), "{error}");
    }

    #[tokio::test]
    async fn a_simple_query_decodes_to_its_sql() {
        let mut reader = reader_over(&message(b'Q', &cstr("SELECT 1"))).await;
        assert_eq!(
            read_message(&mut reader).await.unwrap(),
            Some(Frontend::Query("SELECT 1".into()))
        );
    }

    #[tokio::test]
    async fn the_extended_protocol_messages_decode() {
        let mut parse = cstr("s1");
        parse.extend(cstr("SELECT $1"));
        parse.extend_from_slice(&1i16.to_be_bytes());
        parse.extend_from_slice(&25i32.to_be_bytes());

        let mut bind = cstr("p1");
        bind.extend(cstr("s1"));
        bind.extend_from_slice(&1i16.to_be_bytes()); // one format code
        bind.extend_from_slice(&0i16.to_be_bytes()); // text
        bind.extend_from_slice(&2i16.to_be_bytes()); // two parameters
        bind.extend_from_slice(&2i32.to_be_bytes());
        bind.extend_from_slice(b"ok");
        bind.extend_from_slice(&(-1i32).to_be_bytes()); // NULL
        bind.extend_from_slice(&0i16.to_be_bytes()); // no result format codes

        let mut describe = vec![b'S'];
        describe.extend(cstr("s1"));

        let mut execute = cstr("p1");
        execute.extend_from_slice(&7i32.to_be_bytes());

        let mut close = vec![b'P'];
        close.extend(cstr("p1"));

        let mut frames = message(b'P', &parse);
        frames.extend(message(b'B', &bind));
        frames.extend(message(b'D', &describe));
        frames.extend(message(b'E', &execute));
        frames.extend(message(b'C', &close));
        frames.extend(message(b'S', b""));
        frames.extend(message(b'H', b""));
        frames.extend(message(b'X', b""));
        frames.extend(message(b'W', b"")); // an unimplemented tag

        let mut reader = reader_over(&frames).await;
        let mut decoded = Vec::new();
        while let Some(message) = read_message(&mut reader).await.unwrap() {
            decoded.push(message);
        }
        assert_eq!(
            decoded,
            vec![
                Frontend::Parse {
                    name: "s1".into(),
                    sql: "SELECT $1".into()
                },
                Frontend::Bind {
                    portal: "p1".into(),
                    statement: "s1".into(),
                    formats: vec![0],
                    params: vec![Some(b"ok".to_vec()), None],
                    result_formats: vec![],
                },
                Frontend::Describe {
                    kind: b'S',
                    name: "s1".into()
                },
                Frontend::Execute {
                    portal: "p1".into(),
                    max_rows: 7
                },
                Frontend::Close {
                    kind: b'P',
                    name: "p1".into()
                },
                Frontend::Sync,
                Frontend::Flush,
                Frontend::Terminate,
                Frontend::Unknown(b'W'),
            ]
        );
    }

    #[tokio::test]
    async fn malformed_frames_are_protocol_errors_not_panics() {
        let truncated_body = {
            let mut frame = vec![b'Q'];
            // Claims 12 bytes of body and sends four.
            frame.extend_from_slice(&16i32.to_be_bytes());
            frame.extend_from_slice(b"abcd");
            frame
        };
        let cases: Vec<Vec<u8>> = vec![
            // A length below its own four bytes would underflow the body size.
            message(b'Q', b"")[..1]
                .iter()
                .copied()
                .chain(0i32.to_be_bytes())
                .collect(),
            // Past the ceiling: refused on the header, before any allocation.
            [vec![b'Q'], i32::MAX.to_be_bytes().to_vec()].concat(),
            // A string with no NUL terminator.
            message(b'Q', b"SELECT 1"),
            // `Describe` with a kind byte and nothing else.
            message(b'D', b"S"),
            // A parameter length that is neither a size nor NULL.
            message(
                b'B',
                &[
                    cstr(""),
                    cstr(""),
                    0i16.to_be_bytes().to_vec(),
                    1i16.to_be_bytes().to_vec(),
                    (-7i32).to_be_bytes().to_vec(),
                ]
                .concat(),
            ),
            truncated_body,
        ];
        for bad in cases {
            let mut reader = reader_over(&bad).await;
            let error = read_message(&mut reader)
                .await
                .expect_err(&format!("{bad:?} must be refused"));
            assert!(
                matches!(
                    error.kind(),
                    io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof
                ),
                "{bad:?} gave {error}"
            );
        }
    }

    #[tokio::test]
    async fn a_non_utf8_string_is_refused_rather_than_mangled() {
        let mut reader = reader_over(&message(b'Q', &[b'S', 0xff, 0])).await;
        let error = read_message(&mut reader).await.unwrap_err();
        assert!(error.to_string().contains("UTF-8"), "{error}");
    }

    #[tokio::test]
    async fn a_startup_packet_past_its_ceiling_is_refused() {
        let mut reader = reader_over(
            &[
                vec![0u8],
                (MAX_STARTUP_BYTES as i32 + 1).to_be_bytes()[1..].to_vec(),
            ]
            .concat(),
        )
        .await;
        assert!(read_startup(&mut reader).await.is_err());
    }

    #[test]
    fn the_transaction_status_byte_is_the_one_clients_read() {
        assert_eq!(TxStatus::default(), TxStatus::Idle);
        assert_eq!(TxStatus::Idle.code(), b'I');
        assert_eq!(TxStatus::Open.code(), b'T');
        assert_eq!(TxStatus::Failed.code(), b'E');
    }

    #[test]
    fn every_backend_message_is_framed_with_a_self_counting_length() {
        let mut out = Out::new();
        out.authentication_ok();
        assert_eq!(out.finish(), b"R\0\0\0\x08\0\0\0\0");

        let mut out = Out::new();
        out.ready_for_query(TxStatus::Open);
        assert_eq!(out.finish(), b"Z\0\0\0\x05T");

        let mut out = Out::new();
        out.command_complete("UPDATE 1");
        assert_eq!(out.finish(), b"C\0\0\0\x0dUPDATE 1\0");

        let mut out = Out::new();
        out.parameter_status("client_encoding", "UTF8");
        assert_eq!(out.finish(), b"S\0\0\0\x19client_encoding\0UTF8\0");

        let mut out = Out::new();
        out.backend_key_data(42, 7);
        assert_eq!(out.finish(), b"K\0\0\0\x0c\0\0\0\x2a\0\0\0\x07");
    }

    /// The refusal is a bare byte with no length prefix — this reply predates framing,
    /// and a client that got a framed one would fail its handshake.
    #[test]
    fn the_encryption_refusal_is_a_single_unframed_byte() {
        let mut out = Out::new();
        out.encryption_refused();
        assert_eq!(out.finish(), b"N");
    }

    #[test]
    fn a_row_description_carries_a_name_and_a_type_oid_per_column() {
        let mut out = Out::new();
        out.row_description(&[Field {
            name: "id".into(),
            oid: 23,
        }]);
        let bytes = out.finish();
        assert_eq!(&bytes[..1], b"T");
        assert_eq!(
            i32::from_be_bytes(bytes[1..5].try_into().unwrap()) as usize,
            bytes.len() - 1
        );
        assert_eq!(i16::from_be_bytes(bytes[5..7].try_into().unwrap()), 1);
        assert_eq!(&bytes[7..10], b"id\0");
        // name(3) then table oid(4) and column number(2) before the type oid.
        assert_eq!(i32::from_be_bytes(bytes[10..14].try_into().unwrap()), 0);
        assert_eq!(i16::from_be_bytes(bytes[14..16].try_into().unwrap()), 0);
        assert_eq!(i32::from_be_bytes(bytes[16..20].try_into().unwrap()), 23);
    }

    /// A NULL is length `-1`, not an empty value — the distinction every "no such
    /// row" lesson turns on.
    #[test]
    fn a_null_column_is_distinguishable_from_an_empty_one() {
        let mut out = Out::new();
        out.data_row(&[None, Some(Vec::new()), Some(b"ada".to_vec())]);
        assert_eq!(
            out.finish(),
            b"D\0\0\0\x15\0\x03\xff\xff\xff\xff\0\0\0\0\0\0\0\x03ada".to_vec()
        );
    }

    #[test]
    fn the_empty_bodied_messages_are_just_a_tag_and_a_length() {
        let mut out = Out::new();
        out.parse_complete()
            .bind_complete()
            .close_complete()
            .no_data()
            .portal_suspended()
            .empty_query();
        assert_eq!(
            out.finish(),
            b"1\0\0\0\x042\0\0\0\x043\0\0\0\x04n\0\0\0\x04s\0\0\0\x04I\0\0\0\x04".to_vec()
        );
    }

    #[test]
    fn parameter_description_reports_every_parameter_as_text() {
        let mut out = Out::new();
        out.parameter_description(2);
        let bytes = out.finish();
        assert_eq!(i16::from_be_bytes(bytes[5..7].try_into().unwrap()), 2);
        assert_eq!(
            i32::from_be_bytes(bytes[7..11].try_into().unwrap()),
            crate::types::TEXT_OID
        );
        assert_eq!(
            i32::from_be_bytes(bytes[11..15].try_into().unwrap()),
            crate::types::TEXT_OID
        );
    }

    /// Both the localised (`S`) and machine-readable (`V`) severity fields are sent,
    /// because drivers differ on which one they read.
    #[test]
    fn an_error_carries_its_sqlstate_and_both_severity_fields() {
        let mut out = Out::new();
        out.error(&PgError::new("40001", "could not serialize access"));
        let bytes = out.finish();
        assert_eq!(&bytes[..1], b"E");
        let body = String::from_utf8_lossy(&bytes[5..]);
        assert!(body.starts_with("SERROR\0VERROR\0C40001\0M"), "{body}");
        assert!(body.ends_with("could not serialize access\0\0"), "{body}");
    }

    #[test]
    fn a_notice_is_a_warning_the_connection_survives() {
        let mut out = Out::new();
        out.notice(&PgError::new(
            "25P01",
            "there is no transaction in progress",
        ));
        let bytes = out.finish();
        assert_eq!(&bytes[..1], b"N");
        assert!(String::from_utf8_lossy(&bytes).contains("WARNING"));
    }
}
