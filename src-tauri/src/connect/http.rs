//! The little HTTP surface in front of the socket: one endpoint that trades a
//! long-lived bearer for a one-time ticket, and one that upgrades.
//!
//! A WebSocket client cannot set an `Authorization` header, which is why the
//! bearer never travels on the socket. It is spent over HTTP for a ticket the
//! upgrade carries in `Sec-WebSocket-Protocol`, where it is single-use and
//! short-lived even if a proxy writes the URL and its headers to a log.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::Duration;

use base64::Engine as _;
use sha1::{Digest, Sha1};

/// Guards against a peer that opens a socket and streams headers forever.
const MAX_HEAD_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024;
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/// How long a finished response waits for the client's own close.
const CLOSE_DRAIN: Duration = Duration::from_millis(250);

pub struct Request {
    pub method: String,
    pub path: String,
    headers: Vec<(String, String)>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// `Sec-WebSocket-Protocol` is a comma-separated list, and the client sends
    /// the protocol name and its ticket as two entries of one header.
    pub fn subprotocols(&self) -> Vec<String> {
        self.header("sec-websocket-protocol")
            .map(|value| {
                value
                    .split(',')
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The value of one cookie, without touching the others. A browser client
    /// carries its session this way because an `HttpOnly` cookie is the one
    /// credential store a page's own scripts cannot read, and a host token
    /// read back by script is a host token one cross-site injection away from
    /// being someone else's.
    pub fn cookie(&self, name: &str) -> Option<&str> {
        self.header("cookie")?.split(';').find_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            (key.trim() == name).then(|| value.trim())
        })
    }

    /// Where the page making this request came from. Absent on a plain
    /// navigation, present on every request a script makes.
    pub fn origin(&self) -> Option<&str> {
        self.header("origin")
    }

    /// Whether the name this request was addressed to is this machine.
    ///
    /// A hostile page cannot read a loopback response, but it can make the
    /// request — and a name it controls, pointed at 127.0.0.1, would let it
    /// address this host as its own origin. Refusing any `Host` but a
    /// loopback literal is what closes that, and it costs a legitimate client
    /// nothing: this host binds loopback and nothing else.
    pub fn addressed_to_loopback(&self) -> bool {
        let Some(value) = self.header("host") else {
            // HTTP/1.1 requires the header; a request without one is not a
            // browser and is not served.
            return false;
        };
        is_loopback_authority(value)
    }

    pub fn is_websocket_upgrade(&self) -> bool {
        self.header("upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
            && self
                .header("connection")
                .is_some_and(|value| value.to_ascii_lowercase().contains("upgrade"))
    }
}

/// Reads the request head, leaving the body unread in the reader.
pub fn read_head(reader: &mut BufReader<TcpStream>) -> Result<Request, String> {
    let mut raw = Vec::new();
    {
        // The cap covers the whole head, so a peer cannot stall the thread by
        // sending one header line that never ends.
        let mut limited = reader.take(MAX_HEAD_BYTES as u64);
        loop {
            let mut line = Vec::new();
            let read = limited
                .read_until(b'\n', &mut line)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                return Err("The request headers are missing or too large".into());
            }
            raw.extend_from_slice(&line);
            if line == b"\r\n" || line == b"\n" {
                break;
            }
        }
    }

    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut request = httparse::Request::new(&mut headers);
    if request
        .parse(&raw)
        .map_err(|error| error.to_string())?
        .is_partial()
    {
        return Err("The request headers are incomplete".into());
    }

    Ok(Request {
        method: request.method.unwrap_or_default().to_string(),
        path: request.path.unwrap_or_default().to_string(),
        headers: request
            .headers
            .iter()
            .map(|header| {
                (
                    header.name.to_string(),
                    String::from_utf8_lossy(header.value).trim().to_string(),
                )
            })
            .collect(),
    })
}

pub fn read_body(reader: &mut BufReader<TcpStream>, request: &Request) -> Result<Vec<u8>, String> {
    let length: usize = request
        .header("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if length > MAX_BODY_BYTES {
        return Err("The request body is too large".into());
    }
    let mut body = vec![0u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| error.to_string())?;
    Ok(body)
}

/// `127.0.0.1:47821`, `localhost`, `[::1]:47821` — the host part of an
/// authority, with any port, as long as the name is a loopback literal.
pub fn is_loopback_authority(value: &str) -> bool {
    let value = value.trim();
    let host = if let Some(rest) = value.strip_prefix('[') {
        // An IPv6 authority brackets its address: `[::1]:47821`.
        match rest.split_once(']') {
            Some((address, tail)) if tail.is_empty() || tail.starts_with(':') => address,
            _ => return false,
        }
    } else {
        value.split(':').next().unwrap_or_default()
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// Whether an `Origin` names this same host over plain HTTP on loopback.
///
/// This is the whole defence for cookie-derived authorization. A cross-origin
/// `POST` with credentials is a simple request: no preflight runs, the cookie
/// is attached, and the handler executes — CORS only stops the attacker
/// reading the answer. Comparing the origin here is what stops it happening at
/// all, and it is why a bearer, which no browser attaches on its own, stays
/// origin-agnostic.
pub fn origin_is_this_host(origin: Option<&str>) -> bool {
    let Some(origin) = origin else { return false };
    let Some(authority) = origin.strip_prefix("http://") else {
        return false;
    };
    is_loopback_authority(authority)
}

/// The WebView calls the ticket endpoint from `tauri://localhost`, so the
/// answer is cross-origin even when the host is this very machine. The bearer
/// travels in a header rather than a cookie, so a permissive origin grants a
/// caller nothing it did not already have the token for.
fn cors_headers() -> String {
    "Access-Control-Allow-Origin: *\r\n\
     Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n\
     Access-Control-Allow-Headers: authorization, content-type, x-wavex-protocol\r\n\
     Access-Control-Max-Age: 600\r\n"
        .into()
}

/// End a plain HTTP connection: our close first, then the client's.
///
/// Windows resets a socket that is closed while bytes are still queued on its
/// receiving side, and a reset throws away the answer the client has not read
/// yet — so the client sees `ConnectionReset` instead of the 401 it was told.
/// A FIN and a drain is the close both ends survive. Never call this on an
/// upgraded socket: that one is a live WebSocket, not a finished response.
pub fn close_after_response(stream: &TcpStream) {
    let _ = stream.shutdown(Shutdown::Write);
    let _ = stream.set_read_timeout(Some(CLOSE_DRAIN));
    let mut sink = [0u8; 512];
    let mut reader = stream;
    while matches!(reader.read(&mut sink), Ok(read) if read > 0) {}
}

pub fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    write_headed(stream, status, reason, content_type, &cors_headers(), body)
}

fn write_headed(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    extra: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\
         {extra}\r\n",
        body.len(),
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

pub fn write_json(stream: &mut TcpStream, status: u16, reason: &str, body: &str) {
    let _ = write_response(stream, status, reason, "application/json", body.as_bytes());
}

/// A JSON answer that also hands the browser its session cookie, or takes it
/// back. `Secure` is deliberately absent: loopback already counts as a
/// trustworthy origin, and asking for `Secure` over plain HTTP is a cookie
/// that is silently never stored.
pub fn write_json_with_cookie(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    body: &str,
    cookie: &str,
) {
    let headers = format!("{}Set-Cookie: {cookie}\r\n", cors_headers());
    let _ = write_headed(
        stream,
        status,
        reason,
        "application/json",
        &headers,
        body.as_bytes(),
    );
}

/// The frontend this host has embedded.
///
/// No CORS headers: the bundle is not secret, but a page that can read it
/// learns this host is here and what version it runs, and nothing legitimate
/// needs to fetch it cross-origin. Assets are served to a browser that
/// navigated here, which is same-origin by definition.
pub fn write_asset(
    stream: &mut TcpStream,
    content_type: &str,
    csp: Option<&str>,
    body: &[u8],
) -> std::io::Result<()> {
    let extra = match csp {
        Some(policy) => {
            format!("Content-Security-Policy: {policy}\r\nX-Content-Type-Options: nosniff\r\n")
        }
        None => "X-Content-Type-Options: nosniff\r\n".to_string(),
    };
    write_headed(stream, 200, "OK", content_type, &extra, body)
}

pub fn write_error(stream: &mut TcpStream, status: u16, reason: &str, message: &str) {
    let body = serde_json::json!({ "error": message }).to_string();
    write_json(stream, status, reason, &body);
}

/// Completes the upgrade and hands the raw socket back for framing.
pub fn write_upgrade(stream: &mut TcpStream, key: &str, subprotocol: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {}\r\n\
         Sec-WebSocket-Protocol: {subprotocol}\r\n\r\n",
        accept_key(key),
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

pub fn accept_key(key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(WS_GUID.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_loopback_authorities_and_refuses_every_other_name() {
        assert!(is_loopback_authority("127.0.0.1"));
        assert!(is_loopback_authority("127.0.0.1:47821"));
        assert!(is_loopback_authority("localhost:47821"));
        assert!(is_loopback_authority("[::1]:47821"));
        assert!(!is_loopback_authority("wavex.example.com:47821"));
        assert!(!is_loopback_authority("127.0.0.1.example.com"));
        assert!(!is_loopback_authority(""));
    }

    #[test]
    fn only_this_host_over_plain_http_counts_as_its_own_origin() {
        assert!(origin_is_this_host(Some("http://127.0.0.1:47821")));
        assert!(origin_is_this_host(Some("http://localhost:47821")));
        assert!(!origin_is_this_host(None));
        assert!(!origin_is_this_host(Some("null")));
        assert!(!origin_is_this_host(Some("tauri://localhost")));
        assert!(!origin_is_this_host(Some("https://evil.example.com")));
        assert!(!origin_is_this_host(Some("http://evil.example.com")));
    }

    #[test]
    fn derives_the_accept_key_from_rfc_6455() {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }
}
