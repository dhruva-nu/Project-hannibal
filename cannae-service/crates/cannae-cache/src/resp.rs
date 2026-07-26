//! RESP2 framing — the only wire format the cache speaks.
//!
//! Requests are always arrays of bulk strings, which is what every blessed client
//! sends. Inline commands (`GET foo\r\n` from telnet) are deliberately unsupported
//! (`plans/infra-emulators.md` §3): a lesson prop serves client libraries, not humans.

use cannae_core::Reader;
use std::io;
use tokio::io::{AsyncBufReadExt, AsyncReadExt};

/// Ceilings on what one frame may claim, so a malformed or hostile header cannot
/// make the emulator allocate unbounded memory on behalf of a student's typo.
const MAX_ARGS: i64 = 1024;
const MAX_BULK_BYTES: i64 = 8 * 1024 * 1024;

/// One RESP2 reply. `Nil` is the null bulk string (`$-1`), the miss every cache
/// lesson turns on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reply {
    Simple(String),
    Error(String),
    Int(i64),
    Bulk(Vec<u8>),
    Nil,
    Array(Vec<Reply>),
}

impl Reply {
    pub fn ok() -> Self {
        Reply::Simple("OK".into())
    }

    pub fn bulk(text: impl Into<String>) -> Self {
        Reply::Bulk(text.into().into_bytes())
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.write_to(&mut out);
        out
    }

    fn write_to(&self, out: &mut Vec<u8>) {
        match self {
            Reply::Simple(text) => push_line(out, b'+', text.as_bytes()),
            Reply::Error(text) => push_line(out, b'-', text.as_bytes()),
            Reply::Int(value) => push_line(out, b':', value.to_string().as_bytes()),
            Reply::Nil => out.extend_from_slice(b"$-1\r\n"),
            Reply::Bulk(bytes) => {
                push_line(out, b'$', bytes.len().to_string().as_bytes());
                out.extend_from_slice(bytes);
                out.extend_from_slice(b"\r\n");
            }
            Reply::Array(items) => {
                push_line(out, b'*', items.len().to_string().as_bytes());
                for item in items {
                    item.write_to(out);
                }
            }
        }
    }
}

fn push_line(out: &mut Vec<u8>, prefix: u8, body: &[u8]) {
    out.push(prefix);
    out.extend_from_slice(body);
    out.extend_from_slice(b"\r\n");
}

/// Read one command — a RESP2 array of bulk strings. `Ok(None)` on clean EOF.
///
/// An empty array is what a client sends when it flushes nothing; real Redis ignores
/// it, so we read the next frame instead of surfacing a zero-argument command.
pub async fn read_command(reader: &mut Reader) -> io::Result<Option<Vec<Vec<u8>>>> {
    loop {
        let Some(header) = read_header(reader).await? else {
            return Ok(None);
        };
        let count = parse_count(&header, b'*', MAX_ARGS)?;
        let mut args = Vec::with_capacity(count as usize);
        for _ in 0..count {
            args.push(read_bulk(reader).await?);
        }
        if !args.is_empty() {
            return Ok(Some(args));
        }
    }
}

/// Read one CRLF-terminated header line. Only ever used for `*`/`$` headers, which
/// are ASCII — bulk payloads are read as raw bytes by [`read_bulk`].
async fn read_header(reader: &mut Reader) -> io::Result<Option<String>> {
    let mut line = String::new();
    if reader.read_line(&mut line).await? == 0 {
        return Ok(None);
    }
    Ok(Some(line.trim_end_matches(['\r', '\n']).to_string()))
}

async fn read_bulk(reader: &mut Reader) -> io::Result<Vec<u8>> {
    let header = read_header(reader)
        .await?
        .ok_or_else(|| protocol_error("unexpected EOF inside a command"))?;
    let len = parse_count(&header, b'$', MAX_BULK_BYTES)? as usize;
    // +2 for the trailing CRLF, consumed here so the next header starts clean.
    let mut buf = vec![0u8; len + 2];
    reader.read_exact(&mut buf).await?;
    buf.truncate(len);
    Ok(buf)
}

/// Parse a `<prefix><n>` header, rejecting a wrong prefix, a negative count, and any
/// count past `max` — each of which is a broken client, not a lesson scenario.
fn parse_count(header: &str, prefix: u8, max: i64) -> io::Result<i64> {
    let expected = prefix as char;
    let digits = header
        .strip_prefix(expected)
        .ok_or_else(|| protocol_error(format!("expected '{expected}', got {header:?}")))?;
    let count: i64 = digits
        .parse()
        .map_err(|_| protocol_error(format!("invalid {expected} length {digits:?}")))?;
    if !(0..=max).contains(&count) {
        return Err(protocol_error(format!(
            "{expected} length {count} out of range"
        )));
    }
    Ok(count)
}

fn protocol_error(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;
    use tokio::net::{TcpListener, TcpStream};

    /// `Reader` is a `BufReader<OwnedReadHalf>`, so a real socket is the only way to
    /// build one — a loopback pair is the cheapest source.
    async fn reader_over(bytes: &[u8]) -> Reader {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let bytes = bytes.to_vec();
        tokio::spawn(async move {
            let (mut server, _) = listener.accept().await.unwrap();
            tokio::io::AsyncWriteExt::write_all(&mut server, &bytes)
                .await
                .unwrap();
        });
        let (read_half, _write_half) = TcpStream::connect(addr).await.unwrap().into_split();
        // The write half is dropped, which is fine: these tests only ever read.
        BufReader::new(read_half)
    }

    #[test]
    fn encodes_every_resp2_type() {
        assert_eq!(Reply::ok().encode(), b"+OK\r\n");
        assert_eq!(Reply::Error("ERR nope".into()).encode(), b"-ERR nope\r\n");
        assert_eq!(Reply::Int(-2).encode(), b":-2\r\n");
        assert_eq!(Reply::Nil.encode(), b"$-1\r\n");
        assert_eq!(Reply::bulk("hi").encode(), b"$2\r\nhi\r\n");
        assert_eq!(Reply::Bulk(Vec::new()).encode(), b"$0\r\n\r\n");
        assert_eq!(
            Reply::Array(vec![Reply::bulk("a"), Reply::Nil]).encode(),
            b"*2\r\n$1\r\na\r\n$-1\r\n"
        );
        assert_eq!(Reply::Array(Vec::new()).encode(), b"*0\r\n");
    }

    #[tokio::test]
    async fn reads_a_command_and_then_eof() {
        let mut reader = reader_over(b"*2\r\n$3\r\nGET\r\n$6\r\nuser:1\r\n").await;
        let args = read_command(&mut reader).await.unwrap().unwrap();
        assert_eq!(args, vec![b"GET".to_vec(), b"user:1".to_vec()]);
        assert!(read_command(&mut reader).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn binary_payloads_survive_framing() {
        // A payload containing CRLF must be read by length, not by line.
        let mut reader = reader_over(b"*2\r\n$3\r\nSET\r\n$4\r\na\r\nb\r\n").await;
        let args = read_command(&mut reader).await.unwrap().unwrap();
        assert_eq!(args[1], b"a\r\nb".to_vec());
    }

    #[tokio::test]
    async fn an_empty_array_is_skipped_not_surfaced() {
        let mut reader = reader_over(b"*0\r\n*1\r\n$4\r\nPING\r\n").await;
        let args = read_command(&mut reader).await.unwrap().unwrap();
        assert_eq!(args, vec![b"PING".to_vec()]);
    }

    #[tokio::test]
    async fn malformed_frames_are_protocol_errors() {
        for bad in [
            &b"GET foo\r\n"[..],   // inline commands are unsupported
            &b"*-1\r\n"[..],       // negative array count
            &b"*abc\r\n"[..],      // non-numeric count
            &b"*99999\r\n"[..],    // past MAX_ARGS
            &b"*1\r\n+OK\r\n"[..], // an argument that is not a bulk string
        ] {
            let mut reader = reader_over(bad).await;
            let error = read_command(&mut reader).await.unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidData, "{bad:?}");
        }
    }

    #[tokio::test]
    async fn a_truncated_command_is_an_error_not_a_clean_eof() {
        let mut reader = reader_over(b"*2\r\n$3\r\nGET\r\n").await;
        assert!(read_command(&mut reader).await.is_err());
    }
}
