//! End-to-end cover for the wire contract the client already froze.
//!
//! `RemoteHostTransport` only calls itself connected when `sync_complete`
//! arrives, and it treats any sequence that is not exactly the next one as a
//! gap. Both are invisible to a host that merely compiles, so they are checked
//! here against a socket rather than against a mock.

use std::io::{BufReader, ErrorKind, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use std::sync::Arc;

use serde_json::{json, Value};

use crate::connect::secret::{encode_pairing, PairingPayload};
use crate::connect::server::{ConnectHost, HostAsset, HostServices, PROTOCOL};
use crate::connect::store::HostIdentity;
use crate::host_events::HostEventJournal;

const TOKEN: &str = "a-test-host-token";

/// Stands in for the running app: a real journal, and a command surface small
/// enough to assert on. The protocol under test is the same either way.
struct TestServices {
    journal: HostEventJournal,
}

impl HostServices for TestServices {
    fn journal(&self) -> &HostEventJournal {
        &self.journal
    }

    fn dispatch(&self, command: &str, _args: Value) -> Result<Value, String> {
        match command {
            "home_dir" => Ok(json!("/home/tester")),
            other => Err(format!("{other} is not available over a connection")),
        }
    }

    /// Stands in for the embedded frontend: one page and one script, which is
    /// enough to tell a hit, a miss, and the SPA fallback apart.
    fn asset(&self, path: &str) -> Option<HostAsset> {
        match path {
            "/index.html" => Some(HostAsset {
                bytes: b"<!doctype html><title>wavex</title>".to_vec(),
                mime_type: "text/html".into(),
                csp: Some("default-src 'self'".into()),
            }),
            "/assets/app.js" => Some(HostAsset {
                bytes: b"export {};".to_vec(),
                mime_type: "text/javascript".into(),
                csp: None,
            }),
            _ => None,
        }
    }
}

struct Host {
    host: ConnectHost,
    services: Arc<TestServices>,
    port: u16,
}

impl Host {
    fn start() -> Self {
        let services = Arc::new(TestServices {
            journal: HostEventJournal::new(),
        });
        let host = ConnectHost::new(HostIdentity {
            host_id: "host-under-test".into(),
            name: "Test host".into(),
            token: TOKEN.into(),
            port: 0,
            enabled: false,
        });
        let port = host
            .start(Arc::clone(&services) as Arc<dyn HostServices>, 0)
            .unwrap();
        Self {
            host,
            services,
            port,
        }
    }

    fn publish(&self, event: &str, payload: Value) {
        self.services.journal.record(event, payload);
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.host.stop();
    }
}

/// A client masks every frame it sends, and a server masks none of them, so a
/// test client cannot reuse either half of the production codec.
struct Client {
    socket: TcpStream,
    reader: BufReader<TcpStream>,
}

impl Client {
    fn send(&mut self, value: Value) {
        let payload = value.to_string();
        let bytes = payload.as_bytes();
        let mask = [0x37u8, 0xfa, 0x21, 0x3d];
        let mut frame = vec![0x81];
        assert!(
            bytes.len() < 65_536,
            "test payloads stay in the short forms"
        );
        if bytes.len() < 126 {
            frame.push(0x80 | bytes.len() as u8);
        } else {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        }
        frame.extend_from_slice(&mask);
        for (index, byte) in bytes.iter().enumerate() {
            frame.push(byte ^ mask[index % 4]);
        }
        self.socket.write_all(&frame).unwrap();
        self.socket.flush().unwrap();
    }

    fn receive(&mut self) -> Value {
        let mut header = [0u8; 2];
        self.reader.read_exact(&mut header).unwrap();
        assert_eq!(header[0] & 0x0F, 0x1, "the host answers in text frames");
        assert_eq!(header[1] & 0x80, 0, "the host never masks");
        let length = match header[1] & 0x7F {
            126 => {
                let mut extended = [0u8; 2];
                self.reader.read_exact(&mut extended).unwrap();
                u16::from_be_bytes(extended) as usize
            }
            127 => {
                let mut extended = [0u8; 8];
                self.reader.read_exact(&mut extended).unwrap();
                u64::from_be_bytes(extended) as usize
            }
            short => short as usize,
        };
        let mut payload = vec![0u8; length];
        self.reader.read_exact(&mut payload).unwrap();
        serde_json::from_slice(&payload).unwrap()
    }
}

/// Read a response until the host closes the connection.
///
/// A host that has answered and hung up can reach the client as a reset rather
/// than an end of file — that is the ordinary shape of a closed socket on
/// Windows — so a reset ends this read the way an end of file does, and what
/// arrived before it is still the response.
fn read_to_close(socket: &TcpStream) -> String {
    let mut raw = Vec::new();
    let mut buffer = [0u8; 1024];
    let mut reader = socket;
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => raw.extend_from_slice(&buffer[..read]),
            Err(error) if error.kind() == ErrorKind::ConnectionReset => break,
            Err(error) => panic!("reading the response: {error}"),
        }
    }
    String::from_utf8_lossy(&raw).into_owned()
}

fn ticket(port: u16, token: &str) -> Result<String, u16> {
    let mut socket = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let request = format!(
        "POST /api/v1/tickets HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    socket.write_all(request.as_bytes()).unwrap();
    let raw = read_to_close(&socket);
    let status: u16 = raw
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or_else(|| panic!("a status line, got {raw:?}"));
    if status != 200 {
        return Err(status);
    }
    let body = raw.split("\r\n\r\n").nth(1).unwrap();
    Ok(serde_json::from_str::<Value>(body).unwrap()["ticket"]
        .as_str()
        .unwrap()
        .to_string())
}

fn connect(port: u16, ticket: &str) -> Client {
    let socket = TcpStream::connect(("127.0.0.1", port)).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut writer = socket.try_clone().unwrap();
    let request = format!(
        "GET /api/v1/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: {PROTOCOL}, wavex-ticket.{ticket}\r\n\r\n"
    );
    writer.write_all(request.as_bytes()).unwrap();

    let mut reader = BufReader::new(socket.try_clone().unwrap());
    let mut head = Vec::new();
    loop {
        let mut byte = [0u8; 1];
        reader.read_exact(&mut byte).unwrap();
        head.push(byte[0]);
        if head.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8(head).unwrap();
    assert!(head.starts_with("HTTP/1.1 101"), "{head}");
    assert!(head.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
    Client { socket, reader }
}

#[test]
fn serves_the_handshake_the_client_waits_on() {
    let host = Host::start();
    let ticket = ticket(host.port, TOKEN).unwrap();
    let mut client = connect(host.port, &ticket);

    let ready = client.receive();
    assert_eq!(ready["type"], "ready");
    // A client that registered one host id closes the socket for good when a
    // different one answers, so this is the field that has to match.
    assert_eq!(ready["host"]["id"], "host-under-test");
    let stream_id = ready["stream"]["id"].as_str().unwrap().to_string();
    let latest = ready["stream"]["latestSequence"].as_u64().unwrap();

    client.send(json!({
        "type": "subscribe",
        "streamId": stream_id,
        "afterSequence": latest,
    }));
    // Without this the client stays at "connecting" forever while commands
    // quietly work, which is the failure this test exists to catch.
    let sync = client.receive();
    assert_eq!(sync["type"], "sync_complete");
    assert_eq!(sync["throughSequence"], latest);
}

#[test]
fn answers_a_command_and_refuses_one_outside_the_allowlist() {
    let host = Host::start();
    let ticket = ticket(host.port, TOKEN).unwrap();
    let mut client = connect(host.port, &ticket);
    client.receive();

    client.send(json!({ "type": "invoke", "id": 1, "command": "home_dir", "args": {} }));
    let result = client.receive();
    assert_eq!(result["type"], "result");
    assert_eq!(result["id"], 1);
    assert_eq!(result["ok"], true);
    assert!(result["value"].is_string());

    client.send(json!({ "type": "invoke", "id": 2, "command": "open_new_window", "args": {} }));
    let refused = client.receive();
    assert_eq!(refused["ok"], false);
    assert!(refused["error"]
        .as_str()
        .unwrap()
        .contains("not available over a connection"));
}

#[test]
fn streams_published_events_in_an_unbroken_sequence() {
    let host = Host::start();
    let ticket = ticket(host.port, TOKEN).unwrap();
    let mut client = connect(host.port, &ticket);

    let ready = client.receive();
    let stream_id = ready["stream"]["id"].as_str().unwrap().to_string();
    let mut cursor = ready["stream"]["latestSequence"].as_u64().unwrap();
    client.send(json!({
        "type": "subscribe",
        "streamId": stream_id,
        "afterSequence": cursor,
    }));
    assert_eq!(client.receive()["type"], "sync_complete");

    for index in 0..5 {
        host.publish("harness-stdout", json!({ "line": index }));
    }
    // Events arrive in batches, and a batch may hold anything from one line to
    // the whole burst depending on how fast the publisher was.
    let mut received = Vec::new();
    while received.len() < 5 {
        let message = client.receive();
        assert_eq!(message["type"], "events");
        assert_eq!(message["streamId"], stream_id);
        for event in message["events"].as_array().expect("a batch of events") {
            assert_eq!(
                event["sequence"].as_u64().unwrap(),
                cursor + 1,
                "a gap of any size makes the client throw the transcript away"
            );
            cursor += 1;
            received.push(event["payload"]["line"].as_u64().unwrap());
        }
    }
    assert_eq!(received, vec![0, 1, 2, 3, 4]);
}

#[test]
fn refuses_a_bad_bearer_and_a_replayed_ticket() {
    let host = Host::start();

    assert_eq!(ticket(host.port, "not-the-token").unwrap_err(), 401);

    let ticket = ticket(host.port, TOKEN).unwrap();
    let mut client = connect(host.port, &ticket);
    assert_eq!(client.receive()["type"], "ready");

    // The same ticket a second time must not open a second socket.
    let socket = TcpStream::connect(("127.0.0.1", host.port)).unwrap();
    let mut writer = socket.try_clone().unwrap();
    let request = format!(
        "GET /api/v1/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: {PROTOCOL}, wavex-ticket.{ticket}\r\n\r\n"
    );
    writer.write_all(request.as_bytes()).unwrap();
    let raw = read_to_close(&socket);
    assert!(raw.starts_with("HTTP/1.1 401"), "{raw}");
}

/// One request, one answer, head and body as text. The host closes every
/// non-upgrade connection, so reading to the end is the whole response.
fn http_request(port: u16, request: &str) -> (u16, String, String) {
    let mut socket = TcpStream::connect(("127.0.0.1", port)).unwrap();
    socket.write_all(request.as_bytes()).unwrap();
    let raw = read_to_close(&socket);
    let status: u16 = raw
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or_else(|| panic!("a status line, got {raw:?}"));
    let (head, body) = raw.split_once("\r\n\r\n").unwrap_or((raw.as_str(), ""));
    (status, head.to_string(), body.to_string())
}

fn pairing_code(port: u16) -> String {
    encode_pairing(&PairingPayload {
        version: 1,
        host_id: "host-under-test".into(),
        name: "Test host".into(),
        endpoint: format!("ws://127.0.0.1:{port}/api/v1/connect"),
        token: TOKEN.into(),
    })
    .unwrap()
}

fn open_session(port: u16, code: &str) -> (u16, String) {
    let body = json!({ "code": code }).to_string();
    let (status, head, _) = http_request(
        port,
        &format!(
            "POST /api/v1/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ),
    );
    let cookie = head
        .lines()
        .find_map(|line| line.strip_prefix("Set-Cookie: "))
        .unwrap_or_default()
        .to_string();
    (status, cookie)
}

#[test]
fn serves_the_embedded_frontend_and_falls_back_only_for_routes() {
    let host = Host::start();
    let port = host.port;

    let (status, head, body) = http_request(
        port,
        &format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"),
    );
    assert_eq!(status, 200);
    assert!(body.contains("<!doctype html>"), "{body}");
    assert!(
        head.contains("Content-Security-Policy: default-src 'self'"),
        "{head}"
    );
    // A page a random site could read tells it this host is here and what it
    // runs, and nothing legitimate fetches the bundle cross-origin.
    assert!(!head.contains("Access-Control-Allow-Origin"), "{head}");

    // A typed route the SPA owns is the page, so a reload does not 404.
    let (status, _, body) = http_request(
        port,
        &format!("GET /settings HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"),
    );
    assert_eq!(status, 200);
    assert!(body.contains("<!doctype html>"));

    // A missing chunk must not answer as HTML: the module loader would fail
    // in a way that reads like a bundler fault rather than a 404.
    let (status, _, _) = http_request(
        port,
        &format!(
            "GET /assets/missing.js HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(status, 404);
}

#[test]
fn refuses_a_request_addressed_to_a_name_that_is_not_loopback() {
    let host = Host::start();
    let (status, _, _) = http_request(
        host.port,
        "GET / HTTP/1.1\r\nHost: wavex.attacker.example\r\nConnection: close\r\n\r\n",
    );
    assert_eq!(status, 400);
}

#[test]
fn trades_a_connection_code_for_a_session_the_page_cannot_read() {
    let host = Host::start();
    let (status, cookie) = open_session(host.port, &pairing_code(host.port));
    assert_eq!(status, 200);
    assert!(cookie.starts_with("wavex_link="), "{cookie}");
    assert!(cookie.contains("HttpOnly"), "{cookie}");
    assert!(cookie.contains("SameSite=Strict"), "{cookie}");
}

#[test]
fn refuses_a_connection_code_that_is_not_this_hosts() {
    let host = Host::start();
    let wrong = encode_pairing(&PairingPayload {
        version: 1,
        host_id: "host-under-test".into(),
        name: "Test host".into(),
        endpoint: format!("ws://127.0.0.1:{}/api/v1/connect", host.port),
        token: "a-token-this-host-never-minted".into(),
    })
    .unwrap();
    let (status, cookie) = open_session(host.port, &wrong);
    assert_eq!(status, 401);
    assert!(cookie.is_empty());
}

#[test]
fn refuses_to_pair_a_page_this_host_did_not_serve() {
    let host = Host::start();
    let port = host.port;
    let code = pairing_code(port);
    let body = json!({ "code": code }).to_string();
    let (status, _, _) = http_request(
        port,
        &format!(
            "POST /api/v1/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://attacker.example\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ),
    );
    assert_eq!(status, 403);
}

#[test]
fn a_browser_session_buys_a_ticket_only_from_this_hosts_own_page() {
    let host = Host::start();
    let port = host.port;
    let (_, cookie) = open_session(port, &pairing_code(port));
    let pair = cookie.split(';').next().unwrap().to_string();

    let (status, _, body) = http_request(
        port,
        &format!(
            "POST /api/v1/tickets HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nCookie: {pair}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(status, 200);
    assert!(serde_json::from_str::<Value>(&body).unwrap()["ticket"].is_string());

    // A cross-origin POST with credentials is a simple request: it is not
    // preflighted and the cookie rides along, so refusing it here is the whole
    // defence rather than a formality.
    let (status, _, _) = http_request(
        port,
        &format!(
            "POST /api/v1/tickets HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://attacker.example\r\nCookie: {pair}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(status, 401);
}

#[test]
fn rotating_the_token_ends_every_browser_session_with_the_sockets() {
    let host = Host::start();
    let port = host.port;
    let (_, cookie) = open_session(port, &pairing_code(port));
    let pair = cookie.split(';').next().unwrap().to_string();

    host.host.refuse_live_connections();

    let (status, _, _) = http_request(
        port,
        &format!(
            "POST /api/v1/tickets HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nCookie: {pair}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(status, 401);
}

#[test]
fn lets_this_hosts_own_page_ask_whether_it_is_still_paired() {
    let host = Host::start();
    let port = host.port;
    let (_, cookie) = open_session(port, &pairing_code(port));
    let pair = cookie.split(';').next().unwrap().to_string();

    // A same-origin GET carries neither `Origin` nor a cross-site fetch tag,
    // so refusing an untagged read would mean a reloaded tab could never find
    // out it is already paired.
    let (status, _, body) = http_request(
        port,
        &format!(
            "GET /api/v1/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nCookie: {pair}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(status, 200);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["hostId"],
        "host-under-test"
    );

    // A cross-origin `<img>` or `<script>` reaches the same route, and a
    // current browser tags it. That one is refused.
    let (status, _, _) = http_request(
        port,
        &format!(
            "GET /api/v1/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nSec-Fetch-Site: cross-site\r\nCookie: {pair}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(status, 401);
}

#[test]
fn refuses_a_cross_site_request_even_when_it_names_no_origin() {
    let host = Host::start();
    let port = host.port;
    let (_, cookie) = open_session(port, &pairing_code(port));
    let pair = cookie.split(';').next().unwrap().to_string();

    let (status, _, _) = http_request(
        port,
        &format!(
            "POST /api/v1/tickets HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nSec-Fetch-Site: cross-site\r\nCookie: {pair}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(status, 401);
}
