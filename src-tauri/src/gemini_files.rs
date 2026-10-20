//! Preparing a PDF once and reusing it (GEN-REL-01).
//!
//! A study guide and a practice test used to send the whole selected PDF
//! inline, base64-encoded, in each request. Now a PDF is uploaded once to
//! Google's Files API, and every generation request for that same selected
//! source refers to the uploaded copy by its `file_uri`. Nothing here sends a
//! PDF inline any more, so there is no silent fallback to repeated whole-file
//! transfers.
//!
//! What is kept, and where:
//!
//! - Native metadata: the provider file's name, URI, expiry and identity.
//!   Section guides persist an authenticated descriptor in the draft journal;
//!   other callers use a session cache. Never the key, SQLite or a backup.
//! - At most `Policy::ready_entries` prepared sources (16 by default). The
//!   least recently used one is retired when another is added.
//!
//! When a prepared copy may be reused: only for the exact same selected source
//! (the stored path the request names), the same content SHA-256 of the bytes
//! read now, the same MIME type, the same key (by hash) and the same endpoint.
//! A filename, size or modification time alone never matches. Before reuse,
//! Google is asked whether the copy is still `ACTIVE`; a cached URI alone is
//! not proof that it is ready.
//!
//! Concurrency: preparation of the same key is coalesced (one upload, every
//! caller waits for it). Choosing a ready copy and taking ownership of a new
//! upload happen in one critical section, so two callers cannot both upload.
//! No lock is held across a network wait. Disconnecting or changing the key
//! starts a new epoch. Every operation carries the epoch it began in and is
//! refused as soon as that epoch has ended: work begun before it can finish,
//! but its result is never published into the cache or handed to a caller,
//! and its upload is retired.
//!
//! Ownership: a caller holds a [`Lease`] on the copy it is using. Replacing
//! changed content or evicting the least recently used entry only defers the
//! deletion of a leased copy until its last lease is released. Ending the
//! context invalidates leases immediately. Durable draft owners retain their
//! copies until expiry or deliberate discard; other copies are retired.
//!
//! Cleanup: only files this cache created are deleted, by name, bounded and
//! best effort, and only with the key that created them. Anything not removed
//! (an app quit, a key that is no longer available, a failed delete) expires on
//! Google's side after its retention period (48 hours when this was written).
//! Nothing here lists or deletes other files in the project.

#[path = "gemini_file_descriptor.rs"]
mod descriptor;
pub(crate) use descriptor::{Descriptor, ReferenceError};

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use reqwest::Client;

use crate::gemini_budget::{Budget, Stage};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Where the Gemini API lives. Tests point the same code at a loopback server.
pub(crate) const GOOGLE_BASE: &str = "https://generativelanguage.googleapis.com";

/// Said when a preparation finishes after its context ended.
pub(crate) const STALE_CONTEXT: &str = "Gemini was disconnected or its key changed while this PDF was being prepared, so nothing was generated. Try again.";

/// The display name given to an upload. Deliberately neutral: the local file
/// name or path is not sent as metadata.
const DISPLAY_NAME: &str = "her-flight-deck-study-source";

/// Bounds for preparation and reuse.
#[derive(Clone, Debug)]
pub(crate) struct Policy {
    /// Ready prepared sources kept at once.
    pub ready_entries: usize,
    /// How many times a `PROCESSING` file is checked before giving up.
    pub max_polls: u32,
    /// The first pause between checks; it doubles up to `poll_cap`.
    pub poll_interval: Duration,
    pub poll_cap: Duration,
    /// A prepared copy this close to its expiry is not reused: a generation
    /// request can itself take minutes.
    pub reuse_margin_secs: i64,
    /// Assumed lifetime when Google does not report `expirationTime`. Shorter
    /// than the documented 48 hours, so an assumption never outlives the file.
    pub assumed_lifetime_secs: i64,
    /// Each best-effort delete is bounded by this.
    pub delete_timeout: Duration,
}

impl Default for Policy {
    fn default() -> Self {
        Policy {
            ready_entries: 16,
            max_polls: 30, // FIX-2: the 120 s processing deadline wins at the default poll cadence.
            poll_interval: Duration::from_millis(1_000),
            poll_cap: Duration::from_millis(5_000),
            reuse_margin_secs: 15 * 60,
            assumed_lifetime_secs: 46 * 60 * 60,
            delete_timeout: Duration::from_secs(10),
        }
    }
}

/// Seconds since the Unix epoch. Injected so tests can move time.
pub(crate) type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub(crate) fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
            .unwrap_or(0)
    })
}

/// A key's identity without the key: SHA-256, hex.
pub(crate) fn credential_of(api_key: &str) -> String {
    hex::encode(Sha256::digest(api_key.as_bytes()))
}

/// Exactly what a prepared copy was prepared for.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct PrepKey {
    credential: String,
    base: String,
    content_sha256: String,
    mime: String,
    /// The selected managed source (its stored path).
    scope: String,
}

/// The selected source as read now.
pub(crate) struct Source<'a> {
    pub bytes: &'a [u8],
    pub content_sha256: &'a str,
    pub mime: &'a str,
    pub scope: &'a str,
}

/// A prepared copy that a generation request may refer to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Prepared {
    pub name: String,
    pub uri: String,
    pub mime: String,
    pub expires_at: i64,
    /// True when no bytes were uploaded for this call (a cache hit, or an
    /// upload another caller was already making).
    pub reused: bool,
}

/// One file this cache created and may later retire.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct Retired {
    credential: String,
    base: String,
    name: String,
}

/* ------------------------------------------------------------------ */
/* The provider contract                                               */
/* ------------------------------------------------------------------ */

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FileState {
    Processing,
    Active,
    Failed,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RemoteFile {
    pub name: String,
    /// The expected MIME type, validated while parsing the file response.
    pub mime: String,
    pub uri: String,
    pub state: FileState,
    pub expires_at: Option<i64>,
}

/// Why a copy did not become ready. Only `Unusable` justifies preparing it
/// again; anything else (a lookup that failed, a copy still processing after
/// the bound) is reported without uploading.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NotReady {
    /// Google says it failed or no longer exists.
    Unusable(String),
    Other(String),
}

impl NotReady {
    fn message(self) -> String {
        match self {
            NotReady::Unusable(m) | NotReady::Other(m) => m,
        }
    }
}

/// Why asking about a file did not give an answer.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LookupFailure {
    /// The current key/project cannot access the reference; never missing.
    Auth(String),
    /// Google says it does not exist (deleted or expired) or is not ours.
    Missing,
    /// Anything else: a message she can read.
    Other(String),
}

/// `files/<id>` as Google documents it: at most 40 lowercase letters, digits
/// and dashes, not starting or ending with a dash.
fn valid_name(name: &str) -> bool {
    let Some(id) = name.strip_prefix("files/") else {
        return false;
    };
    !id.is_empty()
        && id.len() <= 40
        && !id.starts_with('-')
        && !id.ends_with('-')
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Read a File resource and hold it to the documented contract. The URI must
/// be exactly the endpoint's own resource URI for that name, so a response can
/// never point later requests at an arbitrary address.
pub(crate) fn parse_file(value: &Value, base: &str, mime: &str) -> Result<RemoteFile, String> {
    let file = value.get("file").unwrap_or(value);
    let invalid = || {
        "Google's answer about the uploaded file was not in the expected form, so it was not used."
            .to_string()
    };
    let name = file
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if !valid_name(name) {
        return Err(invalid());
    }
    let uri = file
        .get("uri")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if uri != format!("{base}/v1beta/{name}") {
        return Err(invalid());
    }
    if let Some(reported) = file.get("mimeType").and_then(Value::as_str) {
        if reported != mime {
            return Err(invalid());
        }
    }
    let state = match file.get("state").and_then(Value::as_str) {
        Some("ACTIVE") => FileState::Active,
        Some("PROCESSING") => FileState::Processing,
        Some("FAILED") => FileState::Failed,
        _ => FileState::Unknown,
    };
    let expires_at = match file.get("expirationTime").and_then(Value::as_str) {
        Some(text) => Some(parse_rfc3339(text).ok_or_else(invalid)?),
        None => None,
    };
    Ok(RemoteFile {
        name: name.to_string(),
        mime: mime.to_string(),
        uri: uri.to_string(),
        state,
        expires_at,
    })
}

/// `2026-10-20T12:00:00Z` or with fractional seconds / an offset, to Unix
/// seconds. Only what a Timestamp in the API looks like; anything else is None.
pub(crate) fn parse_rfc3339(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't') {
        return None;
    }
    if b[13] != b':' || b[16] != b':' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| -> Option<i64> {
        let s = text.get(range)?;
        if !s.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        s.parse().ok()
    };
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut rest = &text[19..];
    if let Some(frac) = rest.strip_prefix('.') {
        let digits = frac.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        rest = &frac[digits..];
    }
    let offset = match rest {
        "Z" | "z" => 0,
        _ => {
            let r = rest.as_bytes();
            if r.len() != 6 || !matches!(r[0], b'+' | b'-') || r[3] != b':' {
                return None;
            }
            let h: i64 = rest.get(1..3)?.parse().ok()?;
            let m: i64 = rest.get(4..6)?.parse().ok()?;
            let sign = if r[0] == b'+' { 1 } else { -1 };
            sign * (h * 3600 + m * 60)
        }
    };
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + hour * 3600 + minute * 60 + second - offset)
}

/// A transport failure in words, without the request URL (an upload URL
/// carries an upload session identifier). Only a failure to connect points at
/// the internet connection: a timeout after connecting may be Google's side.
fn transport(error: reqwest::Error, doing: &str, budget: &Budget) -> String {
    if error.is_connect() {
        budget.categorize("could not reach Google");
        format!("Could not reach Google while {doing}. Check the internet connection; no complete study aid was saved.")
    } else if error.is_timeout() {
        budget.categorize("timed out");
        format!(
            "Google did not finish {doing} within the {} Her Flight Deck allows for one study aid, so no complete study aid was saved. On a slow connection, choosing a chapter or fewer pages first sends less; otherwise try again later.",
            crate::gemini_budget::describe(budget.total())
        )
    } else {
        budget.categorize("connection interrupted");
        format!(
            "The connection to Google was interrupted while {doing}. No complete study aid was saved; try again."
        )
    }
}

/// Said when the budget is already spent before a request could be made.
pub(crate) fn out_of_time(budget: &Budget, doing: &str) -> String {
    budget.categorize("time limit reached");
    format!(
        "Her Flight Deck stopped before {doing}: the {} it allows for one study aid had run out. Nothing was saved. Choosing a chapter or fewer pages first usually helps.",
        crate::gemini_budget::describe(budget.total())
    )
}

/// Why Google would not accept an upload, in words she can act on.
fn upload_refusal(status: u16) -> String {
    match status {
        400 => "Google did not accept this PDF for upload. Try a different copy of the file.".to_string(),
        401 | 403 => "Google did not allow this key to upload files. Check the key and its project in Google AI Studio.".to_string(),
        413 => "This PDF is larger than Google accepts for upload. Choose a chapter or fewer pages first.".to_string(),
        429 => "Google is limiting uploads for this project right now. No complete study aid was saved; wait a few minutes and try again.".to_string(),
        500..=599 => "Google's file service is busy right now. No complete study aid was saved; try again in a few minutes.".to_string(),
        _ => format!("Google refused the upload ({status}). No complete study aid was saved."),
    }
}

/// Counts bytes as reqwest polls frames under transport backpressure. This is
/// a send-side estimate, not proof of delivery; positive progress resets only
/// the upload inactivity timer. Frames do not create separate HTTP requests.
struct UploadBody {
    remaining: bytes::Bytes,
    polled: Arc<AtomicU64>,
    allowed: crate::gemini_budget::Admission,
}

impl http_body::Body for UploadBody {
    type Data = bytes::Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
        if !(self.allowed)() {
            return Poll::Ready(Some(Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "cancelled",
            ))));
        }
        if self.remaining.is_empty() {
            return Poll::Ready(None);
        }
        let len = self.remaining.len().min(256 * 1024);
        let frame = self.remaining.split_to(len);
        self.polled.fetch_add(len as u64, Ordering::Relaxed);
        Poll::Ready(Some(Ok(http_body::Frame::data(frame))))
    }

    fn is_end_stream(&self) -> bool {
        self.remaining.is_empty()
    }

    fn size_hint(&self) -> http_body::SizeHint {
        http_body::SizeHint::with_exact(self.remaining.len() as u64)
    }
}

/// Upload one PDF in the documented offset-0 `upload, finalize` request.
pub(crate) async fn upload(
    http: &Client,
    base: &str,
    api_key: &str,
    bytes: &[u8],
    mime: &str,
    budget: &Budget,
) -> Result<RemoteFile, String> {
    budget.reset_stage(Stage::Uploading);
    if !budget.checkpoint() {
        return Err(crate::gemini_budget::CHECKPOINT_FAILED.into());
    }
    if !budget.admit() {
        return Err(crate::gemini_cancel::CANCELLED.to_string());
    }
    let timeout = budget
        .control_timeout()
        .ok_or_else(|| out_of_time(budget, "uploading the PDF"))?;
    let start_request = http
        .post(format!("{base}/upload/v1beta/files"))
        .header("x-goog-api-key", api_key)
        .header("X-Goog-Upload-Protocol", "resumable")
        .header("X-Goog-Upload-Command", "start")
        .header(
            "X-Goog-Upload-Header-Content-Length",
            bytes.len().to_string(),
        )
        .header("X-Goog-Upload-Header-Content-Type", mime)
        .json(&json!({ "file": { "display_name": DISPLAY_NAME } }))
        .timeout(timeout)
        .send();
    let start = budget
        .guard_stage(start_request)
        .await
        .map_err(|_| out_of_time(budget, "starting the upload"))?
        .map_err(|e| transport(e, "starting the upload", budget))?;
    let status = start.status().as_u16();
    budget.saw_status(status);
    if !(200..300).contains(&status) {
        budget.categorize("upload refused");
        return Err(upload_refusal(status));
    }
    let session = start
        .headers()
        .get("x-goog-upload-url")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .filter(|url| url.starts_with(&format!("{base}/upload/v1beta/files")))
        .ok_or_else(|| {
            "Google did not return a usable upload address, so the PDF was not sent.".to_string()
        })?;

    if bytes.is_empty() {
        return Err("The selected PDF is empty.".to_string());
    }
    budget.reset_stage(Stage::Uploading); // upload starts after its separate start-control response
    let started = budget.elapsed();
    let polled = Arc::new(AtomicU64::new(0));
    let body = UploadBody {
        remaining: bytes::Bytes::copy_from_slice(bytes),
        polled: polled.clone(),
        allowed: budget.producer_probe(),
    };
    let timeout = budget
        .upload_timeout()
        .ok_or_else(|| out_of_time(budget, "uploading the PDF"))?;
    if !budget.admit() {
        return Err(crate::gemini_cancel::CANCELLED.to_string());
    }
    if !budget.checkpoint() {
        return Err(crate::gemini_budget::CHECKPOINT_FAILED.into());
    }
    let request = async {
        let finished = http
            .post(&session)
            .header("x-goog-api-key", api_key)
            .header("X-Goog-Upload-Offset", "0")
            .header("X-Goog-Upload-Command", "upload, finalize")
            .header(reqwest::header::CONTENT_LENGTH, bytes.len())
            .body(reqwest::Body::wrap(body))
            .timeout(timeout)
            .send()
            .await
            .map_err(|e| transport(e, "uploading the PDF", budget))?;
        let status = finished.status().as_u16();
        budget.saw_status(status);
        if !(200..300).contains(&status) {
            budget.categorize("upload refused");
            return Err(upload_refusal(status));
        }
        finished
            .text()
            .await
            .map_err(|e| transport(e, "confirming the upload", budget))
    };
    let raw = budget
        .during_upload(request, started, &polled, bytes.len() as u64)
        .await
        .map_err(|_| {
            if budget.cancelled() {
                crate::gemini_cancel::CANCELLED.to_string()
            } else {
                if budget.stage_policy() {
                    "The upload stopped moving. Your saved work is still here.".into()
                } else {
                    out_of_time(budget, "uploading the PDF")
                }
            }
        })??;
    let value: Value = serde_json::from_str(&raw).map_err(|_| {
        "Google's answer about the uploaded file was unreadable, so it was not used.".to_string()
    })?;
    parse_file(&value, base, mime)
}

/// Ask Google about one file by its validated name.
pub(crate) async fn lookup(
    http: &Client,
    base: &str,
    api_key: &str,
    name: &str,
    mime: &str,
    budget: &Budget,
) -> Result<RemoteFile, LookupFailure> {
    if !valid_name(name) {
        return Err(LookupFailure::Missing);
    }
    // GENREL03-R1: a file check is its own stage in the failure details.
    budget.reset_stage(Stage::CheckingFile);
    if !budget.checkpoint() {
        return Err(LookupFailure::Other(
            crate::gemini_budget::CHECKPOINT_FAILED.into(),
        ));
    }
    if !budget.admit() {
        return Err(LookupFailure::Other(
            crate::gemini_cancel::CANCELLED.to_string(),
        ));
    }
    let timeout = budget
        .control_timeout()
        .ok_or_else(|| LookupFailure::Other(out_of_time(budget, "checking the uploaded PDF")))?;
    let response = http
        .get(format!("{base}/v1beta/{name}"))
        .header("x-goog-api-key", api_key)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| LookupFailure::Other(transport(e, "checking the uploaded PDF", budget)))?;
    let status = response.status().as_u16();
    budget.saw_status(status);
    // Only 404 shows the copy is gone. A 403 is an access refusal for this key
    // or project, not proof of a missing file, so it never leads to an upload.
    if status == 404 {
        return Err(LookupFailure::Missing);
    }
    if matches!(status, 401 | 403) {
        return Err(LookupFailure::Auth(
            "Google did not allow this key to check the uploaded PDF, so nothing was sent again. Check the key and its project in Google AI Studio.".to_string(),
        ));
    }
    let raw = response
        .text()
        .await
        .map_err(|e| LookupFailure::Other(transport(e, "checking the uploaded PDF", budget)))?;
    if !(200..300).contains(&status) {
        return Err(LookupFailure::Other(upload_refusal(status)));
    }
    let value: Value = serde_json::from_str(&raw).map_err(|_| {
        LookupFailure::Other("Google's answer about the uploaded file was unreadable.".to_string())
    })?;
    let file = parse_file(&value, base, mime).map_err(LookupFailure::Other)?;
    if file.name != name {
        return Err(LookupFailure::Other(
            "Google answered about a different file, so it was not used.".to_string(),
        ));
    }
    Ok(file)
}

/// Delete one file this cache created. Bounded; the outcome is only reported.
pub(crate) async fn delete(
    http: &Client,
    base: &str,
    api_key: &str,
    name: &str,
    timeout: Duration,
) -> bool {
    if !valid_name(name) {
        return false;
    }
    let request = http
        .delete(format!("{base}/v1beta/{name}"))
        .header("x-goog-api-key", api_key)
        .timeout(timeout)
        .send();
    matches!(request.await, Ok(r) if r.status().is_success())
}

/* ------------------------------------------------------------------ */
/* Coalescing                                                          */
/* ------------------------------------------------------------------ */

type Outcome = Result<Prepared, String>;

/// One preparation's eventual outcome, shared by everyone waiting for it.
#[derive(Default)]
struct Cell {
    state: Mutex<(Option<Outcome>, Vec<Waker>)>,
}

impl Cell {
    fn resolve(&self, outcome: Outcome) {
        let wakers = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if state.0.is_some() {
                return;
            }
            state.0 = Some(outcome);
            std::mem::take(&mut state.1)
        };
        for waker in wakers {
            waker.wake();
        }
    }
}

struct Wait(Arc<Cell>);

impl Future for Wait {
    type Output = Outcome;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Outcome> {
        let mut state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        match &state.0 {
            Some(outcome) => Poll::Ready(outcome.clone()),
            None => {
                state.1.push(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

struct Flight {
    token: u64,
    epoch: u64,
    cell: Arc<Cell>,
}

struct Ready {
    prepared: Prepared,
    last_used: u64,
}

#[derive(Default)]
struct Inner {
    epoch: u64,
    // Durable draft owners survive context invalidation; no API keys.
    retained: HashMap<Retired, HashMap<String, i64>>,
    tick: u64,
    ready: HashMap<PrepKey, Ready>,
    flights: HashMap<PrepKey, Flight>,
    /// Leases held on each copy.
    in_use: HashMap<Retired, usize>,
    /// Copies already taken out of `ready` whose deletion waits for their
    /// last lease.
    deferred: HashSet<Retired>,
    /// Deferred copies whose last lease has gone: delete at the next chance.
    orphaned: Vec<Retired>,
}

impl Inner {
    /// Retire `r` now, or once its last lease is released.
    fn retire_later(&mut self, r: Retired, now: &mut Vec<Retired>) {
        if self.in_use.get(&r).is_some_and(|n| *n > 0) {
            self.deferred.insert(r);
        } else {
            now.push(r);
        }
    }

    fn acquire(&mut self, r: &Retired) {
        *self.in_use.entry(r.clone()).or_insert(0) += 1;
    }

    /// Whether the copy has not been retired: still the ready entry, or
    /// still leased by someone.
    fn alive(&self, key: &PrepKey, r: &Retired) -> bool {
        self.ready
            .get(key)
            .is_some_and(|x| x.prepared.name == r.name)
            || self.in_use.get(r).is_some_and(|n| *n > 0)
    }
}

/// What one atomic look at the cache decided.
enum Claim<'a> {
    /// The epoch the operation began in has ended.
    Stale,
    /// A ready copy, now leased; still to be confirmed with Google.
    Cached(Lease<'a>),
    /// Someone else is preparing exactly this: wait for theirs.
    Join(Arc<Cell>),
    /// This caller now owns the preparation. The guard exists from the moment
    /// the flight is registered, so dropping this claim at any await releases
    /// the flight and its waiters.
    Own(FlightGuard<'a>),
}

/// A caller's hold on one prepared copy. While it is held, replacing or
/// evicting that copy does not delete it. Dropping it releases the hold.
pub(crate) struct Lease<'a> {
    cache: &'a PreparedSources,
    id: Retired,
    epoch: u64,
    prepared: Prepared,
}

impl Lease<'_> {
    pub(crate) fn prepared(&self) -> &Prepared {
        &self.prepared
    }

    /// False once the context this copy was obtained in has ended.
    pub(crate) fn is_current(&self) -> bool {
        self.cache.lock().epoch == self.epoch
    }
}

impl Drop for Lease<'_> {
    fn drop(&mut self) {
        let mut inner = self.cache.lock();
        let last = match inner.in_use.get_mut(&self.id) {
            Some(n) => {
                *n = n.saturating_sub(1);
                *n == 0
            }
            None => false,
        };
        if last {
            inner.in_use.remove(&self.id);
            if inner.deferred.remove(&self.id) {
                inner.orphaned.push(self.id.clone());
            }
        }
    }
}

/// Owns only cleanup entries whose DELETE has not yet been sent. If the
/// cleanup future is dropped (for example by `Cancellable`), keep those entries
/// for the next cleanup opportunity. The outstanding request has an uncertain
/// outcome and is deliberately not queued a second time.
struct PendingRetirements<'a> {
    cache: &'a PreparedSources,
    unsent: std::collections::VecDeque<Retired>,
}

impl Drop for PendingRetirements<'_> {
    fn drop(&mut self) {
        self.cache.lock().orphaned.extend(self.unsent.drain(..));
    }
}

/// Counters for tests and evidence: what actually happened, not what was asked.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Stats {
    pub uploads: u64,
    pub reuses: u64,
    pub coalesced: u64,
    pub stale_discarded: u64,
}

/// Prepared PDFs, with retention pins for native durable draft owners.
pub(crate) struct PreparedSources {
    inner: Mutex<Inner>,
    stats: Mutex<Stats>,
    policy: Policy,
    clock: Clock,
}

/// If a preparing future is dropped part-way, waiters must not hang and the
/// flight must not block the key forever.
struct FlightGuard<'a> {
    cache: &'a PreparedSources,
    key: PrepKey,
    token: u64,
    cell: Arc<Cell>,
    done: bool,
}

impl FlightGuard<'_> {
    /// End the flight with `outcome` without publishing anything.
    fn abandon(mut self, outcome: Outcome) {
        self.done = true;
        let mut inner = self.cache.lock();
        if inner
            .flights
            .get(&self.key)
            .is_some_and(|f| f.token == self.token)
        {
            inner.flights.remove(&self.key);
        }
        drop(inner);
        self.cell.resolve(outcome);
    }
}

impl Drop for FlightGuard<'_> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        let mut inner = self.cache.lock();
        if inner
            .flights
            .get(&self.key)
            .is_some_and(|f| f.token == self.token)
        {
            inner.flights.remove(&self.key);
        }
        drop(inner);
        self.cell.resolve(Err(
            "Preparing the PDF was interrupted. Nothing was saved; try again.".to_string(),
        ));
    }
}

impl PreparedSources {
    pub(crate) fn new(policy: Policy, clock: Clock) -> Self {
        PreparedSources {
            inner: Mutex::new(Inner::default()),
            stats: Mutex::new(Stats::default()),
            policy,
            clock,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn count(&self, f: impl FnOnce(&mut Stats)) {
        f(&mut self.stats.lock().unwrap_or_else(|e| e.into_inner()));
    }

    #[cfg(test)]
    pub(crate) fn stats(&self) -> Stats {
        *self.stats.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[cfg(test)]
    pub(crate) fn ready_len(&self) -> usize {
        self.lock().ready.len()
    }

    pub(crate) fn key_for(&self, base: &str, api_key: &str, source: &Source<'_>) -> PrepKey {
        PrepKey {
            credential: credential_of(api_key),
            base: base.to_string(),
            content_sha256: source.content_sha256.to_string(),
            mime: source.mime.to_string(),
            scope: source.scope.to_string(),
        }
    }

    /// The current context. An operation records it before it reads the key,
    /// and is refused once it has ended.
    pub(crate) fn epoch(&self) -> u64 {
        self.lock().epoch
    }

    /// Disconnect, a new key, or anything else that ends the current context:
    /// nothing prepared before now is reused, published or handed out. Returns
    /// what this cache created, for retirement with the key that created it.
    /// Leased copies are included: their leases are no longer current.
    /// Retirement skips unexpired durable draft owners.
    pub(crate) fn invalidate_all(&self) -> Vec<Retired> {
        let mut inner = self.lock();
        inner.epoch += 1;
        inner.flights.clear();
        let mut retired: Vec<Retired> = inner
            .ready
            .drain()
            .map(|(key, ready)| Retired {
                credential: key.credential,
                base: key.base,
                name: ready.prepared.name,
            })
            .collect();
        retired.extend(inner.deferred.drain());
        retired.append(&mut inner.orphaned);
        retired.extend(inner.retained.keys().cloned());
        let now = (self.clock)();
        inner.retained.retain(|_, owners| {
            owners.retain(|_, expiry| now < *expiry);
            !owners.is_empty()
        });
        retired.sort_by(|a, b| {
            (&a.credential, &a.base, &a.name).cmp(&(&b.credential, &b.base, &b.name))
        });
        retired.dedup();
        retired
    }

    /// Delete, best effort, the retired files that `api_key` created. Files
    /// made with another key are left to expire: that key is not available.
    pub(crate) async fn retire(
        &self,
        http: &Client,
        api_key: &str,
        retired: Vec<Retired>,
    ) -> usize {
        let credential = credential_of(api_key);
        let mut removed = 0;
        for r in retired.into_iter().filter(|r| r.credential == credential) {
            if self.retained(&r) {
                continue;
            }
            if delete(http, &r.base, api_key, &r.name, self.policy.delete_timeout).await {
                removed += 1;
            }
        }
        removed
    }

    /// Release a lease and delete, best effort, any copy of this key's that
    /// was only waiting for its last lease.
    #[cfg(test)]
    pub(crate) async fn finish(&self, lease: Lease<'_>, http: &Client, api_key: &str) {
        drop(lease);
        let credential = credential_of(api_key);
        let mine = {
            let mut inner = self.lock();
            let (mine, others) = std::mem::take(&mut inner.orphaned)
                .into_iter()
                .partition(|r: &Retired| r.credential == credential);
            inner.orphaned = others;
            mine
        };
        self.retire(http, api_key, mine).await;
    }

    /// `retire`, for cleanup a generation causes (GENREL04-R10, R11). Each
    /// DELETE is admitted on its own, immediately before it is sent: once the
    /// generation is cancelled, nothing more is sent, and that copy and every
    /// one after it wait for a later cleanup instead (they expire at Google in
    /// any case). Copies made with another key are left to expire, as in
    /// `retire`.
    pub(crate) async fn retire_admitted(
        &self,
        http: &Client,
        api_key: &str,
        retired: Vec<Retired>,
        budget: &Budget,
    ) -> usize {
        let credential = credential_of(api_key);
        let mut removed = 0;
        let mut pending = PendingRetirements {
            cache: self,
            unsent: retired
                .into_iter()
                .filter(|r| r.credential == credential)
                .collect(),
        };
        while !pending.unsent.is_empty() {
            if budget.remaining().is_zero() || !budget.checkpoint() || !budget.admit() {
                break;
            }
            // No await between taking this entry and polling its DELETE.
            // Every later entry remains guarded throughout that wait.
            let r = pending.unsent.pop_front().expect("nonempty cleanup queue");
            if self.retained(&r) {
                continue;
            }
            let timeout = self.policy.delete_timeout.min(budget.remaining());
            if matches!(
                budget
                    .run(delete(http, &r.base, api_key, &r.name, timeout))
                    .await,
                Ok(true)
            ) {
                removed += 1;
            }
        }
        removed
    }

    /// `finish`, for a generation: the lease is released at once, and each
    /// waiting copy's DELETE is admitted on its own.
    pub(crate) async fn finish_admitted(
        &self,
        lease: Lease<'_>,
        http: &Client,
        api_key: &str,
        budget: &Budget,
    ) {
        drop(lease);
        let credential = credential_of(api_key);
        let mine = {
            let mut inner = self.lock();
            let (mine, others) = std::mem::take(&mut inner.orphaned)
                .into_iter()
                .partition(|r: &Retired| r.credential == credential);
            inner.orphaned = others;
            mine
        };
        self.retire_admitted(http, api_key, mine, budget).await;
    }

    /// A leased prepared reference for exactly this source, reusing a valid
    /// one. `epoch` is the context the operation began in; `avoid` names a
    /// copy already found unusable.
    ///
    /// At most two looks at the cache: a cached or shared copy that turns out
    /// to be unusable is followed by exactly one more attempt. No loop.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn prepare<'a>(
        &'a self,
        http: &Client,
        base: &str,
        api_key: &str,
        source: &Source<'_>,
        epoch: u64,
        avoid: Option<&str>,
        budget: &Budget,
        say: &(dyn Fn(String) + Sync),
    ) -> Result<Lease<'a>, String> {
        let key = self.key_for(base, api_key, source);
        let mut avoid = avoid.map(str::to_string);
        for _ in 0..2 {
            let (claim, retired) = self.claim(&key, epoch, avoid.as_deref());
            self.retire_admitted(http, api_key, retired, budget).await;
            match claim {
                Claim::Stale => return Err(STALE_CONTEXT.to_string()),
                Claim::Cached(lease) => {
                    match self.confirm(http, base, api_key, &lease, budget, say).await {
                        // GENREL01-R12: the check itself takes time, so the
                        // copy must still be in date once it has answered.
                        Ok(expires_at)
                            if lease.is_current() && !self.too_close_to_expiry(expires_at) =>
                        {
                            self.count(|s| s.reuses += 1);
                            say("Using the copy of this PDF already prepared with Google; it is not uploaded again.".to_string());
                            let mut lease = lease;
                            lease.prepared.reused = true;
                            lease.prepared.expires_at = expires_at;
                            return Ok(lease);
                        }
                        Ok(_) if !lease.is_current() => return Err(STALE_CONTEXT.to_string()),
                        Ok(_) | Err(NotReady::Unusable(_)) => {
                            avoid = Some(lease.prepared.name.clone());
                        }
                        Err(NotReady::Other(message)) => return Err(message),
                    }
                }
                Claim::Join(cell) => {
                    self.count(|s| s.coalesced += 1);
                    let shared = Wait(cell).await?;
                    match self.adopt(&key, epoch, shared) {
                        Ok(Some(lease)) => return Ok(lease),
                        // Retired between being shared and being taken up:
                        // look once more.
                        Ok(None) => {}
                        Err(stale) => return Err(stale),
                    }
                }
                Claim::Own(guard) => {
                    return self
                        .prepare_fresh(http, base, api_key, source, guard, epoch, budget, say)
                        .await
                }
            }
        }
        Err("The prepared copy of this PDF stopped being available while it was being checked, so nothing was generated. Try again.".to_string())
    }

    /// One critical section: refuse an ended epoch, retire other content for
    /// the same selected source, drop an expired or unusable entry, then lease
    /// a ready copy, join a preparation already running, or take ownership of
    /// a new one.
    fn claim(&self, key: &PrepKey, epoch: u64, avoid: Option<&str>) -> (Claim<'_>, Vec<Retired>) {
        let now = (self.clock)();
        let mut inner = self.lock();
        let mut retired = Vec::new();
        if inner.epoch != epoch {
            return (Claim::Stale, retired);
        }
        let replaced: Vec<PrepKey> = inner
            .ready
            .keys()
            .filter(|k| {
                *k != key
                    && k.credential == key.credential
                    && k.base == key.base
                    && k.scope == key.scope
            })
            .cloned()
            .collect();
        for k in replaced {
            if let Some(r) = inner.ready.remove(&k) {
                let r = Retired {
                    credential: k.credential,
                    base: k.base,
                    name: r.prepared.name,
                };
                inner.retire_later(r, &mut retired);
            }
        }
        let margin = self.policy.reuse_margin_secs;
        let unusable = inner.ready.get(key).map(|ready| {
            (
                avoid == Some(ready.prepared.name.as_str()),
                now >= ready.prepared.expires_at - margin,
            )
        });
        match unusable {
            // Found unusable at Google: forget it; nothing to delete there.
            Some((true, _)) => {
                inner.ready.remove(key);
            }
            Some((false, true)) => {
                let r = inner.ready.remove(key).expect("present");
                let r = Retired {
                    credential: key.credential.clone(),
                    base: key.base.clone(),
                    name: r.prepared.name,
                };
                inner.retire_later(r, &mut retired);
            }
            Some((false, false)) => {
                inner.tick += 1;
                let tick = inner.tick;
                let ready = inner.ready.get_mut(key).expect("present");
                ready.last_used = tick;
                let prepared = ready.prepared.clone();
                let id = Retired {
                    credential: key.credential.clone(),
                    base: key.base.clone(),
                    name: prepared.name.clone(),
                };
                inner.acquire(&id);
                let lease = Lease {
                    cache: self,
                    id,
                    epoch,
                    prepared,
                };
                return (Claim::Cached(lease), retired);
            }
            None => {}
        }
        if let Some(flight) = inner.flights.get(key) {
            return (Claim::Join(flight.cell.clone()), retired);
        }
        inner.tick += 1;
        let token = inner.tick;
        let cell = Arc::new(Cell::default());
        inner.flights.insert(
            key.clone(),
            Flight {
                token,
                epoch,
                cell: cell.clone(),
            },
        );
        let guard = FlightGuard {
            cache: self,
            key: key.clone(),
            token,
            cell,
            done: false,
        };
        (Claim::Own(guard), retired)
    }

    /// Ask Google whether a cached copy is still `ACTIVE`, waiting boundedly
    /// if it is processing. Returns its expiry.
    async fn confirm(
        &self,
        http: &Client,
        base: &str,
        api_key: &str,
        lease: &Lease<'_>,
        budget: &Budget,
        say: &(dyn Fn(String) + Sync),
    ) -> Result<i64, NotReady> {
        let cached = &lease.prepared;
        match lookup(http, base, api_key, &cached.name, &cached.mime, budget).await {
            Ok(file) if file.state == FileState::Active => {
                Ok(file.expires_at.unwrap_or(cached.expires_at))
            }
            Ok(file) if file.state == FileState::Processing => {
                let file = self
                    .wait_until_active(http, base, api_key, file, budget, say)
                    .await?;
                Ok(file.expires_at.unwrap_or(cached.expires_at))
            }
            Ok(_) | Err(LookupFailure::Missing) => Err(NotReady::Unusable(
                "The prepared copy of this PDF is no longer usable at Google.".to_string(),
            )),
            Err(LookupFailure::Other(message) | LookupFailure::Auth(message)) => {
                Err(NotReady::Other(message))
            }
        }
    }

    /// Whether a copy expiring at `expires_at` is too close to expiry to be
    /// used for a request that can itself take minutes.
    fn too_close_to_expiry(&self, expires_at: i64) -> bool {
        (self.clock)() >= expires_at - self.policy.reuse_margin_secs
    }

    /// Take up a copy another caller prepared, if its epoch is still current
    /// and the copy has not been retired since. `Ok(None)`: retired, look
    /// again.
    fn adopt(
        &self,
        key: &PrepKey,
        epoch: u64,
        shared: Prepared,
    ) -> Result<Option<Lease<'_>>, String> {
        let mut inner = self.lock();
        if inner.epoch != epoch {
            return Err(STALE_CONTEXT.to_string());
        }
        let id = Retired {
            credential: key.credential.clone(),
            base: key.base.clone(),
            name: shared.name.clone(),
        };
        // GENREL01-R12: a copy shared after a long wait must still be in date.
        if !inner.alive(key, &id) || self.too_close_to_expiry(shared.expires_at) {
            return Ok(None);
        }
        inner.acquire(&id);
        Ok(Some(Lease {
            cache: self,
            id,
            epoch,
            prepared: Prepared {
                reused: true,
                ..shared
            },
        }))
    }

    #[allow(clippy::too_many_arguments)]
    async fn prepare_fresh<'a>(
        &'a self,
        http: &Client,
        base: &str,
        api_key: &str,
        source: &Source<'_>,
        mut guard: FlightGuard<'a>,
        epoch: u64,
        budget: &Budget,
        say: &(dyn Fn(String) + Sync),
    ) -> Result<Lease<'a>, String> {
        // Retiring older copies may have awaited: never start an upload for a
        // context that has since ended.
        if self.epoch() != epoch {
            guard.abandon(Err(STALE_CONTEXT.to_string()));
            return Err(STALE_CONTEXT.to_string());
        }
        let (key, token, cell) = (guard.key.clone(), guard.token, guard.cell.clone());

        say("Uploading the selected PDF to Google's temporary file storage…".to_string());
        self.count(|s| s.uploads += 1);
        let outcome = self
            .upload_and_wait(http, base, api_key, source, budget, say)
            .await;

        // Publish only into the context this preparation began in, and lease
        // the copy for this caller in the same critical section: the lease
        // exists before any later await, so cancellation always releases it.
        let mut retired = Vec::new();
        let outcome = {
            let mut inner = self.lock();
            let owns = inner
                .flights
                .get(&key)
                .is_some_and(|f| f.token == token && f.epoch == epoch);
            let current = inner.epoch == epoch;
            if owns {
                inner.flights.remove(&key);
            }
            match outcome {
                Ok(prepared) if owns && current => {
                    inner.tick += 1;
                    let tick = inner.tick;
                    inner.ready.insert(
                        key.clone(),
                        Ready {
                            prepared: prepared.clone(),
                            last_used: tick,
                        },
                    );
                    let id = Retired {
                        credential: key.credential.clone(),
                        base: key.base.clone(),
                        name: prepared.name.clone(),
                    };
                    inner.acquire(&id);
                    let lease = Lease {
                        cache: self,
                        id,
                        epoch,
                        prepared,
                    };
                    while inner.ready.len() > self.policy.ready_entries {
                        let oldest = inner
                            .ready
                            .iter()
                            .min_by_key(|(_, r)| r.last_used)
                            .map(|(k, _)| k.clone())
                            .expect("non-empty");
                        let r = inner.ready.remove(&oldest).expect("present");
                        let r = Retired {
                            credential: oldest.credential,
                            base: oldest.base,
                            name: r.prepared.name,
                        };
                        inner.retire_later(r, &mut retired);
                    }
                    Ok(lease)
                }
                Ok(prepared) => {
                    // Late work from an older context: never published or
                    // used, and its upload is retired with the key that made it.
                    retired.push(Retired {
                        credential: key.credential.clone(),
                        base: key.base.clone(),
                        name: prepared.name,
                    });
                    self.count(|s| s.stale_discarded += 1);
                    Err(STALE_CONTEXT.to_string())
                }
                Err(message) => Err(message),
            }
        };
        guard.done = true;
        cell.resolve(match &outcome {
            Ok(lease) => Ok(lease.prepared.clone()),
            Err(message) => Err(message.clone()),
        });
        drop(guard);
        self.retire_admitted(http, api_key, retired, budget).await;
        // The context may have ended during that cleanup.
        match outcome {
            Ok(lease) if lease.is_current() => Ok(lease),
            Ok(_) => Err(STALE_CONTEXT.to_string()),
            Err(message) => Err(message),
        }
    }

    async fn upload_and_wait(
        &self,
        http: &Client,
        base: &str,
        api_key: &str,
        source: &Source<'_>,
        budget: &Budget,
        say: &(dyn Fn(String) + Sync),
    ) -> Result<Prepared, String> {
        let file = upload(http, base, api_key, source.bytes, source.mime, budget).await?;
        let file = match self
            .wait_until_active(http, base, api_key, file.clone(), budget, say)
            .await
        {
            Ok(file) => file,
            Err(failure) => {
                // Our own upload, never usable: retire it now, unless this
                // generation was cancelled, when nothing more is sent (it is
                // queued for later cleanup, and expires at Google anyway).
                let ours = Retired {
                    credential: credential_of(api_key),
                    base: base.to_string(),
                    name: file.name.clone(),
                };
                self.retire_admitted(http, api_key, vec![ours], budget)
                    .await;
                return Err(failure.message());
            }
        };
        let now = (self.clock)();
        Ok(Prepared {
            name: file.name,
            uri: file.uri,
            mime: source.mime.to_string(),
            expires_at: file
                .expires_at
                .unwrap_or(now + self.policy.assumed_lifetime_secs),
            reused: false,
        })
    }

    /// Wait, boundedly, for a `PROCESSING` file to become `ACTIVE`.
    async fn wait_until_active(
        &self,
        http: &Client,
        base: &str,
        api_key: &str,
        mut file: RemoteFile,
        budget: &Budget,
        say: &(dyn Fn(String) + Sync),
    ) -> Result<RemoteFile, NotReady> {
        let mut pause = self.policy.poll_interval;
        let mut polls = 0;
        if file.state != FileState::Active {
            budget.at(Stage::WaitingForFile);
        }
        loop {
            match file.state {
                FileState::Active => return Ok(file),
                FileState::Failed => {
                    return Err(NotReady::Unusable("Google could not process this PDF, so no study aid was made. Try a different copy, or choose a chapter or fewer pages first.".to_string()))
                }
                FileState::Processing | FileState::Unknown => {}
            }
            if polls >= self.policy.max_polls {
                return Err(NotReady::Other("Google was still preparing this PDF after waiting, so no study aid was made. Try again in a few minutes.".to_string()));
            }
            if polls == 0 {
                say("Google is preparing the uploaded PDF…".to_string());
            }
            budget.at(Stage::WaitingForFile);
            // The wait is paid for out of the same budget as everything else.
            if !budget.pause(pause).await {
                if budget.cancelled() {
                    return Err(NotReady::Other(crate::gemini_cancel::CANCELLED.to_string()));
                }
                budget.categorize("time limit reached");
                if budget.stage_policy() && !budget.remaining().is_zero() {
                    return Err(NotReady::Other("Google was still preparing this PDF after waiting, so no study aid was made. Try again in a few minutes.".into()));
                }
                return Err(NotReady::Other(format!(
                    "Google was still preparing this PDF when the {} Her Flight Deck allows for one study aid ran out, so no study aid was made. Choosing a chapter or fewer pages first usually helps.",
                    crate::gemini_budget::describe(budget.total())
                )));
            }
            budget.at(Stage::WaitingForFile);
            pause = (pause * 2).min(self.policy.poll_cap);
            polls += 1;
            file = match lookup(http, base, api_key, &file.name, &file.mime, budget).await {
                Ok(next) => next,
                Err(LookupFailure::Missing) => {
                    return Err(NotReady::Unusable("The uploaded copy of this PDF disappeared from Google before it was ready. Try again.".to_string()))
                }
                Err(LookupFailure::Other(message) | LookupFailure::Auth(message)) => return Err(NotReady::Other(message)),
            };
        }
    }
}

#[cfg(test)]
#[path = "gemini_files_tests.rs"]
mod tests;
