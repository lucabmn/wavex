//! One blocking listener, one thread per connection, three threads inside it:
//! a reader that parses client messages, a writer that owns the socket's
//! sending half, and a stream thread that pushes journal events as they are
//! published. The split is what lets a long `git push` answer late without
//! holding up the transcript behind it.

use std::collections::HashMap;
use std::io::BufReader;
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::connect::frame::{write_message, FrameError, Message, MessageReader};
use crate::connect::http;
use crate::connect::secret::{random_token, secret_eq};
use crate::connect::store::HostIdentity;
use crate::host_events::HostEventJournal;

/// Everything a connection needs from the machine behind it. The socket, the
/// framing, and the replay contract are the same whether the commands run
/// against a live Tauri app or against a stub, and this is the seam that lets
/// the protocol be tested without one.
pub trait HostServices: Send + Sync + 'static {
    fn journal(&self) -> &HostEventJournal;
    fn dispatch(&self, command: &str, args: Value) -> Result<Value, String>;

    /// The frontend embedded in this binary, if there is one. A host serves
    /// the same client it ships with, so a browser needs nothing installed —
    /// and the lookup is over embedded keys only, never a filesystem path, so
    /// the asset route cannot become a second way to read this machine.
    fn asset(&self, _path: &str) -> Option<HostAsset> {
        None
    }
}

/// One embedded frontend file, ready to write to a socket.
pub struct HostAsset {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub csp: Option<String>,
}

pub const PROTOCOL: &str = "wavex.remote.v1";
const TICKET_PROTOCOL_PREFIX: &str = "wavex-ticket.";
/// Long enough to survive a slow upgrade, short enough that a ticket found in
/// a proxy log is already spent.
const TICKET_TTL: Duration = Duration::from_secs(30);
const MAX_TICKETS: usize = 32;
const MAX_CONNECTIONS: usize = 8;
/// How long a stream thread parks on the journal before it re-reads its own
/// stop flag. It is woken by a publish, so this is a shutdown budget, not
/// latency.
const STREAM_TICK: Duration = Duration::from_millis(200);
/// The close code the client treats as a permanent refusal. Anything else and
/// it reconnects forever against a token that will never work again.
const CLOSE_REFUSED: u16 = 4001;
/// The queue in front of the socket is bounded so a slow link costs throughput
/// rather than the host's memory. When it fills, the stream thread stops
/// draining the journal, the journal moves on without it, and the client is
/// told to resynchronise — which is the same degradation as a disconnect.
const OUTBOX_DEPTH: usize = 1_024;
/// Events travel in batches, so a burst costs one queue slot per batch rather
/// than one per line. A harness that prints a hundred thousand lines in a
/// second would otherwise outrun the queue, and the client would be told to
/// resynchronise over output the host had in hand the whole time.
const EVENT_BATCH: usize = 256;
/// A client that stopped reading but never closed must not hold a thread and a
/// full queue forever.
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
/// A browser client holds its grant in an `HttpOnly` cookie the host set, not
/// in storage its own scripts can read. The session lives in this process and
/// nowhere else: it never reaches disk, it goes when the token is replaced,
/// and it goes when the host stops.
const SESSION_COOKIE: &str = "wavex_link";
/// Idle life of a browser session. Long enough that a client left open over a
/// weekend is still paired, short enough that a browser nobody uses lets go.
const SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const MAX_SESSIONS: usize = 16;
/// How long a restart waits for the previous listener to let go of the port.
const REBIND_ATTEMPTS: u32 = 20;
const REBIND_PAUSE: Duration = Duration::from_millis(50);

/// Cheap to clone: every connection thread holds one, and Tauri manages one.
#[derive(Clone)]
pub struct ConnectHost {
    inner: Arc<Inner>,
}

struct Inner {
    identity: Mutex<HostIdentity>,
    tickets: Mutex<Vec<Ticket>>,
    sessions: Mutex<Vec<Session>>,
    connections: Mutex<HashMap<u64, LiveConnection>>,
    next_connection: AtomicU64,
    running: Mutex<Option<Running>>,
}

struct Ticket {
    value: String,
    issued: Instant,
}

/// A browser client that already spent its connection code.
struct Session {
    value: String,
    touched: Instant,
}

struct LiveConnection {
    socket: TcpStream,
    outbox: SyncSender<Message>,
}

struct Running {
    port: u16,
    stopping: Arc<AtomicBool>,
}

impl ConnectHost {
    pub fn new(identity: HostIdentity) -> Self {
        Self {
            inner: Arc::new(Inner {
                identity: Mutex::new(identity),
                tickets: Mutex::new(Vec::new()),
                sessions: Mutex::new(Vec::new()),
                connections: Mutex::new(HashMap::new()),
                next_connection: AtomicU64::new(1),
                running: Mutex::new(None),
            }),
        }
    }

    pub fn identity(&self) -> HostIdentity {
        self.inner
            .identity
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn set_identity(&self, identity: HostIdentity) {
        *self
            .inner
            .identity
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = identity;
    }

    pub fn port(&self) -> Option<u16> {
        self.inner
            .running
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .map(|running| running.port)
    }

    pub fn connection_count(&self) -> usize {
        self.inner
            .connections
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .len()
    }

    /// Binds loopback and nothing else. Reaching this host from another
    /// machine is a tunnel's job, which keeps the plaintext hop inside one
    /// kernel and the credential out of the network.
    pub fn start(&self, services: Arc<dyn HostServices>, port: u16) -> Result<u16, String> {
        self.stop();
        let listener = bind_loopback(port)?;
        let bound = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();

        let stopping = Arc::new(AtomicBool::new(false));
        *self
            .inner
            .running
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(Running {
            port: bound,
            stopping: Arc::clone(&stopping),
        });

        let host = self.clone();
        std::thread::spawn(move || accept_loop(host, services, listener, stopping));
        Ok(bound)
    }

    pub fn stop(&self) {
        let running = self
            .inner
            .running
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        let Some(running) = running else { return };
        running.stopping.store(true, Ordering::SeqCst);
        // `accept` cannot be interrupted, so it is woken by one last local
        // connection that finds the stop flag already set.
        let _ = TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, running.port)));
        self.refuse_live_connections();
    }

    /// A rotated or revoked token must not leave an already-open socket alive:
    /// the whole point of rotating is that the old grant is gone.
    pub fn refuse_live_connections(&self) {
        // A browser session is a grant derived from the token, so replacing
        // the token has to take it with the sockets. Leaving it would make
        // "rotate" mean "every client but the browsers".
        self.close_all_sessions();
        let connections = std::mem::take(
            &mut *self
                .inner
                .connections
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
        );
        for (_, connection) in connections {
            // Never block here: a client that has stopped reading must not
            // keep the revocation waiting on its queue.
            let _ = connection.outbox.try_send(Message::Close(Some((
                CLOSE_REFUSED,
                "The host token was replaced".into(),
            ))));
            // The reader thread is parked in `read`; only closing the socket
            // gets it back.
            std::thread::sleep(Duration::from_millis(20));
            let _ = connection.socket.shutdown(Shutdown::Both);
        }
    }

    fn issue_ticket(&self) -> String {
        let mut tickets = self
            .inner
            .tickets
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        tickets.retain(|ticket| ticket.issued.elapsed() < TICKET_TTL);
        if tickets.len() >= MAX_TICKETS {
            tickets.remove(0);
        }
        let value = random_token(43);
        tickets.push(Ticket {
            value: value.clone(),
            issued: Instant::now(),
        });
        value
    }

    /// A ticket is spent by the first upgrade that presents it, so replaying a
    /// captured one buys nothing.
    fn redeem_ticket(&self, candidate: &str) -> bool {
        let mut tickets = self
            .inner
            .tickets
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        tickets.retain(|ticket| ticket.issued.elapsed() < TICKET_TTL);
        let Some(index) = tickets
            .iter()
            .position(|ticket| secret_eq(&ticket.value, candidate))
        else {
            return false;
        };
        tickets.remove(index);
        true
    }

    /// Trades a valid connection code for a session this host remembers. The
    /// value returned is the cookie's, so it is a fresh secret rather than the
    /// token: a browser that is compromised later cannot hand on a grant that
    /// works from anywhere else.
    fn open_session(&self) -> String {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        sessions.retain(|session| session.touched.elapsed() < SESSION_TTL);
        while sessions.len() >= MAX_SESSIONS {
            sessions.remove(0);
        }
        let value = random_token(43);
        sessions.push(Session {
            value: value.clone(),
            touched: Instant::now(),
        });
        value
    }

    /// Unlike a ticket a session is not spent by use, so using it keeps it
    /// alive: a client someone works in all week never has to pair twice.
    fn touch_session(&self, candidate: &str) -> bool {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        sessions.retain(|session| session.touched.elapsed() < SESSION_TTL);
        let Some(session) = sessions
            .iter_mut()
            .find(|session| secret_eq(&session.value, candidate))
        else {
            return false;
        };
        session.touched = Instant::now();
        true
    }

    fn close_session(&self, candidate: &str) {
        self.inner
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .retain(|session| !secret_eq(&session.value, candidate));
    }

    fn close_all_sessions(&self) {
        self.inner
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }

    fn register(&self, socket: TcpStream, outbox: SyncSender<Message>) -> u64 {
        let id = self.inner.next_connection.fetch_add(1, Ordering::Relaxed);
        self.inner
            .connections
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(id, LiveConnection { socket, outbox });
        id
    }

    fn unregister(&self, id: u64) {
        self.inner
            .connections
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&id);
    }
}

/// `stop` wakes the accept loop instead of closing its listener, so the old
/// socket can still hold the port for a moment. A rebind inside that window is
/// this host replacing itself, not the port belonging to someone else — and a
/// restarted headless host would otherwise refuse to come back.
fn bind_loopback(port: u16) -> Result<TcpListener, String> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut last = String::new();
    for _ in 0..REBIND_ATTEMPTS {
        match TcpListener::bind(address) {
            Ok(listener) => return Ok(listener),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
                last = error.to_string();
                std::thread::sleep(REBIND_PAUSE);
            }
            Err(error) => return Err(format!("Could not listen on port {port}: {error}")),
        }
    }
    Err(format!("Could not listen on port {port}: {last}"))
}

fn accept_loop(
    host: ConnectHost,
    services: Arc<dyn HostServices>,
    listener: TcpListener,
    stopping: Arc<AtomicBool>,
) {
    for incoming in listener.incoming() {
        if stopping.load(Ordering::SeqCst) {
            return;
        }
        let Ok(stream) = incoming else { continue };
        let host = host.clone();
        let services = Arc::clone(&services);
        let stopping = Arc::clone(&stopping);
        std::thread::spawn(move || {
            if let Err(error) = serve(&host, services, stream, &stopping) {
                // A client that hangs up mid-request is ordinary, not an
                // incident. The host stays quiet about it.
                let _ = error;
            }
        });
    }
}

fn serve(
    host: &ConnectHost,
    services: Arc<dyn HostServices>,
    stream: TcpStream,
    stopping: &AtomicBool,
) -> Result<(), String> {
    stream
        .set_nodelay(true)
        .map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);
    let request = http::read_head(&mut reader)?;
    let mut response_stream = stream.try_clone().map_err(|error| error.to_string())?;

    if request.method.eq_ignore_ascii_case("OPTIONS") {
        http::write_json(&mut response_stream, 204, "No Content", "");
        return Ok(());
    }

    // Everything below is reachable from a page the user did not write, so the
    // name this request was addressed to is checked before anything acts on it.
    if !request.addressed_to_loopback() {
        http::write_error(
            &mut response_stream,
            400,
            "Bad Request",
            "This host answers to 127.0.0.1 only",
        );
        return Ok(());
    }

    let path = request
        .path
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .to_string();

    match (request.method.as_str(), path.as_str()) {
        ("POST", "/api/v1/tickets") => {
            let _ = http::read_body(&mut reader, &request);
            if !authorized(host, &request) {
                http::write_error(
                    &mut response_stream,
                    401,
                    "Unauthorized",
                    "That host token is not valid",
                );
                return Ok(());
            }
            let ticket = host.issue_ticket();
            http::write_json(
                &mut response_stream,
                200,
                "OK",
                &json!({ "ticket": ticket }).to_string(),
            );
            Ok(())
        }
        ("POST", "/api/v1/session") => {
            let body = http::read_body(&mut reader, &request)?;
            open_browser_session(host, &request, &body, &mut response_stream);
            Ok(())
        }
        ("GET", "/api/v1/session") => {
            if session_of(host, &request, read_is_ours(&request)).is_none() {
                http::write_error(
                    &mut response_stream,
                    401,
                    "Unauthorized",
                    "This browser is not paired with this host",
                );
                return Ok(());
            }
            http::write_json(&mut response_stream, 200, "OK", &host_summary(host));
            Ok(())
        }
        ("DELETE", "/api/v1/session") => {
            if let Some(session) = session_of(host, &request, page_is_ours(&request)) {
                host.close_session(&session);
            }
            http::write_json_with_cookie(
                &mut response_stream,
                200,
                "OK",
                &json!({ "ok": true }).to_string(),
                &format!("{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"),
            );
            Ok(())
        }
        ("GET", "/api/v1/connect") => {
            serve_connect(host, services, request, stream, reader, stopping)
        }
        ("GET", _) | ("HEAD", _) => {
            serve_asset(services.as_ref(), &path, &mut response_stream);
            Ok(())
        }
        _ => {
            http::write_error(&mut response_stream, 404, "Not Found", "No such endpoint");
            Ok(())
        }
    }
}

/// A bearer proves itself; a cookie only counts when the page holding it is
/// this host's own. See `http::origin_is_this_host` for why that asymmetry is
/// the whole defence rather than a formality.
fn authorized(host: &ConnectHost, request: &http::Request) -> bool {
    if let Some(token) = request
        .header("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
    {
        return secret_eq(&host.identity().token, token.trim());
    }
    session_of(host, request, page_is_ours(request)).is_some()
}

/// Whether this request was made by a page this host served.
///
/// A cross-origin page always tags what it sends: `Sec-Fetch-Site` on every
/// request a current browser makes, and `Origin` on anything that is not a
/// plain GET. Both are checked because the first is the precise answer and the
/// second is the one that survives an older browser.
fn page_is_ours(request: &http::Request) -> bool {
    match request.header("sec-fetch-site") {
        Some(site) => site.eq_ignore_ascii_case("same-origin"),
        None => http::origin_is_this_host(request.origin()),
    }
}

/// The same question for a read that has no side effect.
///
/// A same-origin `GET` carries neither header, so "nothing said" cannot be a
/// refusal here or a browser could never ask whether it is still paired. It
/// stays a refusal for anything that spends the session: a cross-origin page
/// cannot make an untagged `POST`, and a cross-origin `GET` it could make —
/// an `<img>`, a `<script>` — arrives tagged `cross-site` and is refused.
fn read_is_ours(request: &http::Request) -> bool {
    match request.header("sec-fetch-site") {
        Some(site) => site.eq_ignore_ascii_case("same-origin") || site.eq_ignore_ascii_case("none"),
        None => request.origin().is_none() || http::origin_is_this_host(request.origin()),
    }
}

fn session_of(host: &ConnectHost, request: &http::Request, from_page: bool) -> Option<String> {
    if !from_page {
        return None;
    }
    let cookie = request.cookie(SESSION_COOKIE)?;
    host.touch_session(cookie).then(|| cookie.to_string())
}

fn host_summary(host: &ConnectHost) -> String {
    let identity = host.identity();
    json!({
        "hostId": identity.host_id,
        "name": identity.name,
        "platform": host_platform(),
    })
    .to_string()
}

/// Spends a connection code once, for a cookie this page cannot read back.
///
/// The code carries the host token, so this is the only route that accepts one
/// over the network — and it accepts it only from a page this host served.
fn open_browser_session(
    host: &ConnectHost,
    request: &http::Request,
    body: &[u8],
    response: &mut TcpStream,
) {
    if !page_is_ours(request) {
        http::write_error(
            response,
            403,
            "Forbidden",
            "Only a page this host served can pair with it",
        );
        return;
    }
    let code = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("code")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    let payload = match crate::connect::secret::decode_pairing(&code) {
        Ok(payload) => payload,
        Err(error) => {
            http::write_error(response, 400, "Bad Request", &error);
            return;
        }
    };
    let identity = host.identity();
    // Both halves matter: the token is the grant, and the id says the code was
    // minted for this machine rather than for another host on this laptop.
    if payload.host_id != identity.host_id || !secret_eq(&identity.token, &payload.token) {
        http::write_error(
            response,
            401,
            "Unauthorized",
            "That connection code is not this host's",
        );
        return;
    }
    let session = host.open_session();
    http::write_json_with_cookie(
        response,
        200,
        "OK",
        &host_summary(host),
        &format!(
            "{SESSION_COOKIE}={session}; HttpOnly; SameSite=Strict; Path=/; Max-Age={}",
            SESSION_TTL.as_secs()
        ),
    );
}

/// The embedded frontend, and nothing else.
///
/// A path that names a file the bundle does not have is a 404 even when the
/// SPA would happily render it, because a missing chunk answered with
/// `index.html` fails inside the module loader and reads like a bundler bug.
/// Only an extensionless path — a route the user typed — falls back.
fn serve_asset(services: &dyn HostServices, path: &str, response: &mut TcpStream) {
    if path.contains("..") || path.starts_with("/api/") {
        http::write_error(response, 404, "Not Found", "No such endpoint");
        return;
    }
    let wanted = if path == "/" { "/index.html" } else { path };
    let asset = services.asset(wanted).or_else(|| {
        let extensionless = !wanted.rsplit('/').next().unwrap_or_default().contains('.');
        extensionless
            .then(|| services.asset("/index.html"))
            .flatten()
    });
    let Some(asset) = asset else {
        http::write_error(response, 404, "Not Found", "No such endpoint");
        return;
    };
    let _ = http::write_asset(
        response,
        &asset.mime_type,
        asset.csp.as_deref(),
        &asset.bytes,
    );
}

fn serve_connect(
    host: &ConnectHost,
    services: Arc<dyn HostServices>,
    request: http::Request,
    stream: TcpStream,
    reader: BufReader<TcpStream>,
    stopping: &AtomicBool,
) -> Result<(), String> {
    let mut response_stream = stream.try_clone().map_err(|error| error.to_string())?;
    if stopping.load(Ordering::SeqCst) {
        http::write_error(
            &mut response_stream,
            503,
            "Service Unavailable",
            "This host is shutting down",
        );
        return Ok(());
    }
    upgrade(host, services, request, stream, reader)
}

fn upgrade(
    host: &ConnectHost,
    services: Arc<dyn HostServices>,
    request: http::Request,
    stream: TcpStream,
    reader: BufReader<TcpStream>,
) -> Result<(), String> {
    let mut response_stream = stream.try_clone().map_err(|error| error.to_string())?;
    let protocols = request.subprotocols();
    let key = request
        .header("sec-websocket-key")
        .unwrap_or_default()
        .to_string();

    if !request.is_websocket_upgrade() || key.is_empty() {
        http::write_error(
            &mut response_stream,
            400,
            "Bad Request",
            "That is not a websocket upgrade",
        );
        return Ok(());
    }
    if !protocols.iter().any(|item| item == PROTOCOL) {
        http::write_error(
            &mut response_stream,
            400,
            "Bad Request",
            "This host speaks a different protocol version",
        );
        return Ok(());
    }
    let ticket = protocols
        .iter()
        .find_map(|item| item.strip_prefix(TICKET_PROTOCOL_PREFIX));
    // The upgrade is refused before it happens, so an unauthenticated peer
    // never reaches the command surface, not even to be told no.
    if !ticket.is_some_and(|ticket| host.redeem_ticket(ticket)) {
        http::write_error(
            &mut response_stream,
            401,
            "Unauthorized",
            "That connection ticket is spent, expired, or invalid",
        );
        return Ok(());
    }
    if host.connection_count() >= MAX_CONNECTIONS {
        http::write_error(
            &mut response_stream,
            503,
            "Service Unavailable",
            "This host already has as many clients as it serves",
        );
        return Ok(());
    }

    http::write_upgrade(&mut response_stream, &key, PROTOCOL).map_err(|error| error.to_string())?;
    Connection::run(host, services, stream, reader)
}

/// Guards both the cursor and the act of queueing stream frames, so a
/// resubscribe cannot interleave its backlog with a live event.
struct StreamState {
    cursor: Option<u64>,
}

struct Connection {
    services: Arc<dyn HostServices>,
    outbox: SyncSender<Message>,
    stream_id: String,
    state: Mutex<StreamState>,
    resumed: Condvar,
    stop: AtomicBool,
}

impl Connection {
    fn run(
        host: &ConnectHost,
        services: Arc<dyn HostServices>,
        socket: TcpStream,
        reader: BufReader<TcpStream>,
    ) -> Result<(), String> {
        let (outbox, outgoing) = sync_channel::<Message>(OUTBOX_DEPTH);
        let mut writer = socket.try_clone().map_err(|error| error.to_string())?;
        writer
            .set_write_timeout(Some(WRITE_TIMEOUT))
            .map_err(|error| error.to_string())?;
        let write_socket = socket.try_clone().map_err(|error| error.to_string())?;
        let writer_thread = std::thread::spawn(move || {
            for message in outgoing {
                let closing = matches!(message, Message::Close(_));
                if write_message(&mut writer, &message).is_err() || closing {
                    break;
                }
            }
            let _ = write_socket.shutdown(Shutdown::Both);
        });

        let identity = host.identity();
        let connection = Arc::new(Connection {
            stream_id: services.journal().stream_id().to_string(),
            services: Arc::clone(&services),
            outbox: outbox.clone(),
            state: Mutex::new(StreamState { cursor: None }),
            resumed: Condvar::new(),
            stop: AtomicBool::new(false),
        });

        // Asking for everything after the end reads the cursor without
        // copying a backlog the client has not asked for yet.
        let opening = services.journal().replay(u64::MAX);
        connection.send(json!({
            "type": "ready",
            "host": {
                "id": identity.host_id,
                "name": identity.name,
                "platform": host_platform(),
            },
            "stream": {
                "id": connection.stream_id,
                "oldestSequence": opening.oldest_sequence,
                "latestSequence": opening.latest_sequence,
            },
        }));

        let id = host.register(
            socket.try_clone().map_err(|error| error.to_string())?,
            outbox,
        );
        let streamer = Arc::clone(&connection);
        let stream_thread = std::thread::spawn(move || streamer.stream_loop());

        connection.read_loop(reader);
        connection.stop.store(true, Ordering::SeqCst);
        connection.resumed.notify_all();
        host.unregister(id);
        let _ = socket.shutdown(Shutdown::Both);
        let _ = stream_thread.join();
        let _ = writer_thread.join();
        Ok(())
    }

    /// Blocking on a full queue is the backpressure: it stalls this stream
    /// rather than buffering a transcript the client is not reading.
    fn send(&self, value: Value) {
        let _ = self.outbox.send(Message::Text(value.to_string()));
    }

    /// One message per batch, in sequence order. The client reads a batch the
    /// same way it reads single events, so a gap inside one is still a gap.
    fn send_events(&self, events: &[crate::host_events::HostEvent]) {
        for chunk in events.chunks(EVENT_BATCH) {
            self.send(json!({
                "type": "events",
                "streamId": self.stream_id,
                "events": chunk,
            }));
        }
    }

    fn send_control(&self, message: Message) {
        if let Err(TrySendError::Full(_)) = self.outbox.try_send(message) {
            // A pong is worth nothing if the queue behind it is already full.
        }
    }

    fn read_loop(self: &Arc<Self>, reader: BufReader<TcpStream>) {
        let mut messages = MessageReader::new(reader);
        loop {
            match messages.read() {
                Ok(Message::Text(text)) => self.on_text(&text),
                Ok(Message::Ping(payload)) => self.send_control(Message::Pong(payload)),
                Ok(Message::Pong(_)) | Ok(Message::Binary(_)) => {}
                Ok(Message::Close(_)) => return,
                Err(FrameError::Protocol(reason)) => {
                    self.send_control(Message::Close(Some((1002, reason.to_string()))));
                    return;
                }
                Err(FrameError::Io(_)) => return,
            }
        }
    }

    fn on_text(self: &Arc<Self>, text: &str) {
        let Ok(message) = serde_json::from_str::<Value>(text) else {
            return;
        };
        match message.get("type").and_then(Value::as_str) {
            Some("invoke") => self.on_invoke(&message),
            Some("subscribe") | Some("resync") => {
                let after = message
                    .get("afterSequence")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                self.resubscribe(after);
            }
            _ => {}
        }
    }

    /// Each call runs on its own thread: a client is allowed to have a slow
    /// `git push` in flight without stalling the terminal it is watching.
    fn on_invoke(self: &Arc<Self>, message: &Value) {
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            return;
        };
        let command = message
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let args = message.get("args").cloned().unwrap_or(Value::Null);
        let args = if args.is_object() { args } else { json!({}) };

        let connection = Arc::clone(self);
        std::thread::spawn(move || {
            let answer = connection.services.dispatch(&command, args);
            connection.send(match answer {
                Ok(value) => json!({ "type": "result", "id": id, "ok": true, "value": value }),
                Err(error) => json!({ "type": "result", "id": id, "ok": false, "error": error }),
            });
        });
    }

    /// Serves the backlog the client asked for and closes with the cursor it
    /// may now trust. `sync_complete` is the only message that lets the client
    /// call itself connected, so it is sent on every subscribe, including one
    /// that had nothing to replay.
    fn resubscribe(self: &Arc<Self>, after_sequence: u64) {
        let replay = self.services.journal().replay(after_sequence);
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());

        if replay.resync_required {
            state.cursor = None;
            self.send(json!({
                "type": "resync_required",
                "streamId": self.stream_id,
                "latestSequence": replay.latest_sequence,
                "reason": "The host kept less backlog than this client was missing",
            }));
            return;
        }

        self.send_events(&replay.events);
        state.cursor = Some(replay.latest_sequence);
        self.send(json!({
            "type": "sync_complete",
            "streamId": self.stream_id,
            "throughSequence": replay.latest_sequence,
        }));
        drop(state);
        self.resumed.notify_all();
    }

    fn stream_loop(self: Arc<Self>) {
        while !self.stop.load(Ordering::SeqCst) {
            let cursor = {
                let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
                while state.cursor.is_none() && !self.stop.load(Ordering::SeqCst) {
                    state = self
                        .resumed
                        .wait_timeout(state, STREAM_TICK)
                        .unwrap_or_else(|error| error.into_inner())
                        .0;
                }
                state.cursor
            };
            let Some(cursor) = cursor else { continue };

            let replay = self.services.journal().wait_for(cursor, STREAM_TICK);
            if replay.events.is_empty() && !replay.resync_required {
                continue;
            }

            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            // A subscribe that landed while this pass was reading owns the
            // cursor now, and its backlog is already on the wire.
            if state.cursor != Some(cursor) {
                continue;
            }
            if replay.resync_required {
                state.cursor = None;
                self.send(json!({
                    "type": "resync_required",
                    "streamId": self.stream_id,
                    "latestSequence": replay.latest_sequence,
                    "reason": "The host kept less backlog than this client was missing",
                }));
                continue;
            }
            self.send_events(&replay.events);
            state.cursor = Some(replay.latest_sequence);
        }
    }
}

pub fn host_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connect::store::HostIdentity;

    fn host() -> ConnectHost {
        ConnectHost::new(HostIdentity {
            host_id: "host-test".into(),
            name: "Test".into(),
            token: "token".into(),
            port: 0,
            enabled: false,
        })
    }

    #[test]
    fn a_ticket_is_spent_by_the_first_upgrade_that_presents_it() {
        let host = host();
        let ticket = host.issue_ticket();
        assert!(host.redeem_ticket(&ticket));
        assert!(!host.redeem_ticket(&ticket));
    }

    #[test]
    fn an_unissued_ticket_is_refused() {
        let host = host();
        host.issue_ticket();
        assert!(!host.redeem_ticket("a_ticket_the_host_never_issued"));
    }

    #[test]
    fn tickets_stay_bounded_under_a_flood() {
        let host = host();
        for _ in 0..(MAX_TICKETS * 2) {
            host.issue_ticket();
        }
        assert_eq!(
            host.inner
                .tickets
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .len(),
            MAX_TICKETS
        );
    }
}
