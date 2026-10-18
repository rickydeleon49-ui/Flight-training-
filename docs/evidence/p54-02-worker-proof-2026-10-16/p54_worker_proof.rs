//! P54-02 phase 2 disposable proof: a terminable PDF extraction worker, its
//! supervisor, and a native FTS5 derived-cache adapter. Built only as a
//! temporary Cargo example from the locked dependencies, then removed. No
//! application storage, profile, provider or production command is touched.
//!
//! Subcommands:
//!   worker PATH SHA INPUT_LIMIT PAGE_LIMIT TOTAL_LIMIT [MODE]
//!   suite SCRATCH            correctness/lifecycle/cache cases -> JSON receipt
//!   cache-crash DB MODE      helper child that aborts mid-write
//!   measure-extract SCRATCH  extraction/IPC measurements -> JSON
//!   measure-index CORPUS DB  one fresh-process FTS5 index measurement -> JSON
//!   make-corpus SIZE OUT     seeded varied corpus generator
use lopdf::{
    content::{Content, Operation},
    dictionary, Document, Object, Stream,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{self, Read, Write};
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};
use unicode_normalization::UnicodeNormalization;

const KIB: usize = 1024;
const MIB: usize = 1024 * 1024;

fn sha_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

// ---------------------------------------------------------------------------
// Limits (values pre-registered in P54_02_PHASE2_PREREGISTRATION_2026-10-16.md)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
struct Limits {
    input: u64,
    page: usize,
    total: usize,
    frame: usize,
    stream: usize,
    deadline: Duration,
    /// RSS watchdog in KiB; None disables it (deadline-only runs).
    rss_kib: Option<u64>,
    /// Also try `ulimit -v` before exec (enforcement is recorded, not assumed).
    ulimit_kib: Option<u64>,
}

impl Limits {
    fn proof() -> Self {
        Limits {
            input: 128 * MIB as u64,
            page: 64 * KIB,
            total: 16 * MIB,
            frame: 512 * KIB,
            stream: 32 * MIB,
            deadline: Duration::from_secs(30),
            rss_kib: Some(512 * 1024),
            ulimit_kib: None,
        }
    }
}

const MAX_WORKERS: usize = 2;
const MAX_RETAINED: usize = 8;

// ---------------------------------------------------------------------------
// Worker: runs in its own process; emits NDJSON frames on stdout.
// ---------------------------------------------------------------------------

fn emit(out: &mut impl Write, value: &Value) {
    // A closed pipe means the supervisor has gone; exit quietly.
    if serde_json::to_writer(&mut *out, value).is_err() || out.write_all(b"\n").is_err() || out.flush().is_err() {
        std::process::exit(0);
    }
}

fn done(out: &mut impl Write, status: &str) -> i32 {
    emit(out, &json!({"type": "done", "status": status}));
    0
}

fn worker(args: &[String]) -> i32 {
    std::panic::set_hook(Box::new(|_| {}));
    let path = Path::new(&args[0]);
    let expected = args[1].as_str();
    let input_limit: u64 = args[2].parse().expect("input limit");
    let page_limit: usize = args[3].parse().expect("page limit");
    let total_limit: usize = args[4].parse().expect("total limit");
    let mode = args.get(5).map(String::as_str).unwrap_or("normal");
    let stdout = io::stdout();
    let mut out = stdout.lock();

    // Deliberate protocol misbehaviour, used only by the supervisor's tests.
    match mode {
        "oversized-line" => {
            let _ = out.write_all(&vec![b'a'; 2 * MIB]);
            let _ = out.write_all(b"\n");
            return 0;
        }
        "invalid-utf8" => {
            let _ = out.write_all(b"{\"type\":\"page\",\"text\":\"\xff\xfe\"}\n");
            return 0;
        }
        "bad-json" => {
            let _ = out.write_all(b"{not json}\n");
            return 0;
        }
        "stall" => {
            emit(&mut out, &json!({"type": "started"}));
            loop {
                thread::sleep(Duration::from_secs(60));
            }
        }
        "exit-nonzero" => return 3,
        "no-result" => {
            emit(&mut out, &json!({"type": "started"}));
            return 0;
        }
        "flood" => {
            let noise = json!({"type": "noise", "pad": "x".repeat(1000)});
            loop {
                emit(&mut out, &noise);
            }
        }
        _ => {}
    }

    let mut bytes = Vec::new();
    match fs::File::open(path) {
        Ok(file) => {
            if file.take(input_limit + 1).read_to_end(&mut bytes).is_err() {
                return done(&mut out, "unreadable");
            }
        }
        Err(_) => return done(&mut out, "unreadable"),
    }
    if bytes.len() as u64 > input_limit {
        return done(&mut out, "refused_input_limit");
    }
    let actual = sha_hex(&bytes);
    if actual != expected {
        return done(&mut out, "identity_mismatch");
    }
    emit(&mut out, &json!({"type": "read", "contentSha256": actual, "bytes": bytes.len()}));

    if mode == "hold" {
        // Deterministic gate: the supervisor releases the worker with a line.
        let mut line = String::new();
        let _ = io::stdin().read_line(&mut line);
    }

    let doc = match std::panic::catch_unwind(|| Document::load_mem(&bytes)) {
        Ok(Ok(doc)) => doc,
        _ => return done(&mut out, "malformed"),
    };
    let mut total = 0usize;
    let pages = doc.get_pages();
    for physical in pages.keys().copied() {
        let text = std::panic::catch_unwind(AssertUnwindSafe(|| doc.extract_text(&[physical])));
        let mut frame = json!({"type": "page", "physicalPage": physical, "contentSha256": actual});
        match text {
            Ok(Ok(text)) => {
                // Post-allocation checks: these bound the RESULT, not memory.
                if text.trim().is_empty() {
                    frame["status"] = json!("no_extractable_text");
                } else if text.len() > page_limit {
                    frame["status"] = json!("refused_page_output_limit");
                    frame["bytes"] = json!(text.len());
                } else if total + text.len() > total_limit {
                    frame["status"] = json!("refused_total_output_limit");
                } else {
                    total += text.len();
                    frame["status"] = json!("text");
                    frame["text"] = json!(text);
                }
            }
            _ => frame["status"] = json!("unreadable_page"),
        }
        emit(&mut out, &frame);
    }
    emit(&mut out, &json!({"type": "done", "status": "checked", "pages": pages.len(), "contentSha256": actual}));
    0
}

// ---------------------------------------------------------------------------
// Bounded NDJSON reader (supervisor side)
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum Msg {
    Frame(Value),
    Protocol(&'static str),
    Eof,
}

/// Splits a byte stream into JSON frames, refusing oversized lines, an
/// oversized stream, invalid UTF-8 and malformed JSON before buffering more.
struct FrameReader {
    line: Vec<u8>,
    seen: usize,
    frame_limit: usize,
    stream_limit: usize,
}

impl FrameReader {
    fn new(frame_limit: usize, stream_limit: usize) -> Self {
        FrameReader { line: Vec::new(), seen: 0, frame_limit, stream_limit }
    }

    /// Feeds a chunk; returns the frames it completed or the first refusal.
    fn feed(&mut self, chunk: &[u8], frames: &mut Vec<Value>) -> Result<(), &'static str> {
        self.seen += chunk.len();
        if self.seen > self.stream_limit {
            return Err("stream_limit");
        }
        for &byte in chunk {
            if byte == b'\n' {
                let text = std::str::from_utf8(&self.line).map_err(|_| "invalid_utf8")?;
                let value: Value = serde_json::from_str(text).map_err(|_| "malformed_json")?;
                frames.push(value);
                self.line.clear();
            } else {
                if self.line.len() >= self.frame_limit {
                    return Err("frame_limit");
                }
                self.line.push(byte);
            }
        }
        Ok(())
    }
}

fn spawn_reader(mut stdout: impl Read + Send + 'static, frame_limit: usize, stream_limit: usize) -> Receiver<Msg> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = FrameReader::new(frame_limit, stream_limit);
        let mut chunk = vec![0u8; 64 * KIB];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => {
                    let _ = tx.send(Msg::Eof);
                    return;
                }
                Ok(n) => {
                    let mut frames = Vec::new();
                    let refused = reader.feed(&chunk[..n], &mut frames);
                    for frame in frames {
                        if tx.send(Msg::Frame(frame)).is_err() {
                            return;
                        }
                    }
                    if let Err(code) = refused {
                        let _ = tx.send(Msg::Protocol(code));
                        return; // stdout is dropped; the supervisor kills the child
                    }
                }
            }
        }
    });
    rx
}

// ---------------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Request {
    material: String,
    path: PathBuf,
    expected: String,
    limits: Limits,
    mode: String,
}

/// What a settled request reports. Codes only: never a path or content.
#[derive(Clone, Debug, PartialEq)]
enum Outcome {
    Checked { sha: String, pages: Vec<Value> },
    Refused(&'static str),
    Malformed,
    Unreadable,
    Cancelled(&'static str),
    Failed(&'static str),
}

impl Outcome {
    fn code(&self) -> String {
        match self {
            Outcome::Checked { .. } => "checked".into(),
            Outcome::Refused(c) => format!("refused:{c}"),
            Outcome::Malformed => "malformed".into(),
            Outcome::Unreadable => "unreadable".into(),
            Outcome::Cancelled(c) => format!("cancelled:{c}"),
            Outcome::Failed(c) => format!("failed:{c}"),
        }
    }
}

#[derive(Clone, Debug)]
struct ProcessRecord {
    pid: u32,
    exit: String,
    reaped: bool,
}

struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
    rx: Receiver<Msg>,
    started: Instant,
    frames: Vec<Value>,
    peak_rss_kib: u64,
    rss_samples: u32,
}

enum Slot {
    Queued,
    Running(Box<Running>),
    Settled,
}

struct Ticket {
    material: String,
    generation: u64,
    request: Request,
}

/// A settled request awaiting publication.
struct Settled {
    material: String,
    generation: u64,
    path: PathBuf,
    expected: String,
    outcome: Outcome,
    process: Option<ProcessRecord>,
    peak_rss_kib: u64,
    rss_samples: u32,
    elapsed_ms: f64,
}

struct Supervisor {
    exe: PathBuf,
    scratch: PathBuf,
    next_id: u64,
    generations: HashMap<String, u64>,
    slots: HashMap<u64, (Ticket, Slot)>,
    queue: VecDeque<u64>,
    retained: VecDeque<(String, Outcome)>,
    indexed: Vec<(String, String)>,
    records: Vec<ProcessRecord>,
    /// Every outcome code produced, for the privacy check.
    outcomes: Vec<String>,
}

fn exit_text(status: ExitStatus) -> String {
    use std::os::unix::process::ExitStatusExt;
    match (status.code(), status.signal()) {
        (Some(code), _) => format!("exit:{code}"),
        (None, Some(signal)) => format!("signal:{signal}"),
        _ => "unknown".into(),
    }
}

fn rss_kib(pid: u32) -> Option<u64> {
    let out = Command::new("/bin/ps").args(["-o", "rss=", "-p", &pid.to_string()]).output().ok()?;
    String::from_utf8(out.stdout).ok()?.trim().parse().ok()
}

impl Supervisor {
    fn new(exe: PathBuf, scratch: PathBuf) -> Self {
        Supervisor {
            exe,
            scratch,
            next_id: 1,
            generations: HashMap::new(),
            slots: HashMap::new(),
            queue: VecDeque::new(),
            retained: VecDeque::new(),
            indexed: Vec::new(),
            records: Vec::new(),
            outcomes: Vec::new(),
        }
    }

    fn running(&self) -> usize {
        self.slots.values().filter(|(_, slot)| matches!(slot, Slot::Running(_))).count()
    }

    fn owned_dir(&self, id: u64) -> PathBuf {
        self.scratch.join(format!("request-{id}"))
    }

    /// Starts a request. A newer request for the same material supersedes
    /// (kills and reaps) the older one immediately.
    fn start(&mut self, request: Request) -> u64 {
        let generation = {
            let g = self.generations.entry(request.material.clone()).or_insert(0);
            *g += 1;
            *g
        };
        let older: Vec<u64> = self
            .slots
            .iter()
            .filter(|(_, (t, s))| t.material == request.material && !matches!(s, Slot::Settled))
            .map(|(id, _)| *id)
            .collect();
        for id in older {
            self.cancel(id, "superseded");
        }
        let id = self.next_id;
        self.next_id += 1;
        fs::create_dir_all(self.owned_dir(id)).expect("owned scratch");
        fs::write(self.owned_dir(id).join("OWNED"), b"p54 proof request scratch\n").expect("owned marker");
        let ticket = Ticket { material: request.material.clone(), generation, request };
        self.slots.insert(id, (ticket, Slot::Queued));
        self.queue.push_back(id);
        self.pump();
        id
    }

    /// Starts a request and drives it to settlement.
    fn run(&mut self, request: Request) -> Settled {
        let id = self.start(request);
        self.settle(id)
    }

    /// Admits queued requests while fewer than MAX_WORKERS are running.
    fn pump(&mut self) {
        while self.running() < MAX_WORKERS {
            let Some(id) = self.queue.pop_front() else { return };
            let Some((ticket, slot)) = self.slots.get_mut(&id) else { continue };
            if !matches!(slot, Slot::Queued) {
                continue;
            }
            let r = &ticket.request;
            let args = [
                "worker".to_string(),
                r.path.display().to_string(),
                r.expected.clone(),
                r.limits.input.to_string(),
                r.limits.page.to_string(),
                r.limits.total.to_string(),
                r.mode.clone(),
            ];
            let mut command = match r.limits.ulimit_kib {
                Some(kib) => {
                    let mut c = Command::new("/bin/sh");
                    // Exit 97 means the shell refused the limit; the worker never ran.
                    c.arg("-c").arg(format!("ulimit -v {kib} 2>/dev/null || exit 97; exec \"$0\" \"$@\"")).arg(&self.exe).args(&args);
                    c
                }
                None => {
                    let mut c = Command::new(&self.exe);
                    c.args(&args);
                    c
                }
            };
            let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().expect("spawn worker");
            let stdout = child.stdout.take().expect("worker stdout");
            let stdin = child.stdin.take();
            let rx = spawn_reader(stdout, r.limits.frame, r.limits.stream);
            *slot = Slot::Running(Box::new(Running {
                child,
                stdin,
                rx,
                started: Instant::now(),
                frames: Vec::new(),
                peak_rss_kib: 0,
                rss_samples: 0,
            }));
        }
    }

    fn pid(&self, id: u64) -> Option<u32> {
        match self.slots.get(&id) {
            Some((_, Slot::Running(r))) => Some(r.child.id()),
            _ => None,
        }
    }

    fn is_queued(&self, id: u64) -> bool {
        matches!(self.slots.get(&id), Some((_, Slot::Queued)))
    }

    /// Releases a worker held at its "read" gate.
    fn release(&mut self, id: u64) {
        if let Some((_, Slot::Running(r))) = self.slots.get_mut(&id) {
            if let Some(stdin) = r.stdin.as_mut() {
                let _ = stdin.write_all(b"go\n");
                let _ = stdin.flush();
            }
        }
    }

    /// Waits until the worker has emitted a frame of this type.
    fn wait_for(&mut self, id: u64, kind: &str) -> bool {
        let Some((_, Slot::Running(r))) = self.slots.get_mut(&id) else { return false };
        if r.frames.iter().any(|f| f["type"] == kind) {
            return true;
        }
        while let Ok(msg) = r.rx.recv_timeout(Duration::from_secs(10)) {
            match msg {
                Msg::Frame(frame) => {
                    let hit = frame["type"] == kind;
                    r.frames.push(frame);
                    if hit {
                        return true;
                    }
                }
                _ => return false,
            }
        }
        false
    }

    fn kill_and_reap(child: &mut Child) -> ProcessRecord {
        let pid = child.id();
        let _ = child.kill();
        match child.wait() {
            Ok(status) => ProcessRecord { pid, exit: exit_text(status), reaped: true },
            Err(_) => ProcessRecord { pid, exit: "wait_failed".into(), reaped: false },
        }
    }

    fn remove_owned(&self, id: u64) {
        let dir = self.owned_dir(id);
        if dir.join("OWNED").exists() {
            let _ = fs::remove_dir_all(dir);
        }
    }

    /// Cancels a queued or running request: kill, reap, discard frames.
    fn cancel(&mut self, id: u64, reason: &'static str) -> Option<Settled> {
        let (ticket, slot) = self.slots.remove(&id)?;
        let mut process = None;
        let mut elapsed = 0.0;
        if let Slot::Running(mut r) = slot {
            drop(r.stdin.take());
            let record = Self::kill_and_reap(&mut r.child);
            self.records.push(record.clone());
            elapsed = ms(r.started);
            process = Some(record);
        }
        self.queue.retain(|q| *q != id);
        self.remove_owned(id);
        let settled = Settled {
            material: ticket.material.clone(),
            generation: ticket.generation,
            path: ticket.request.path.clone(),
            expected: ticket.request.expected.clone(),
            outcome: Outcome::Cancelled(reason),
            process,
            peak_rss_kib: 0,
            rss_samples: 0,
            elapsed_ms: elapsed,
        };
        self.outcomes.push(settled.outcome.code());
        self.slots.insert(id, (ticket, Slot::Settled));
        self.pump();
        Some(settled)
    }

    /// Drives a running request to a bounded settlement.
    fn settle(&mut self, id: u64) -> Settled {
        let (ticket, slot) = self.slots.remove(&id).expect("known request");
        let Slot::Running(mut r) = slot else {
            self.slots.insert(id, (ticket, Slot::Settled));
            panic!("settle on a request that is not running");
        };
        let limits = ticket.request.limits;
        let mut last_sample = Instant::now() - Duration::from_secs(1);
        let outcome = loop {
            if r.started.elapsed() >= limits.deadline {
                break Outcome::Cancelled("deadline");
            }
            if let Some(cap) = limits.rss_kib {
                if last_sample.elapsed() >= Duration::from_millis(25) {
                    last_sample = Instant::now();
                    if let Some(rss) = rss_kib(r.child.id()) {
                        r.rss_samples += 1;
                        r.peak_rss_kib = r.peak_rss_kib.max(rss);
                        if rss > cap {
                            break Outcome::Cancelled("memory_watchdog");
                        }
                    }
                }
            }
            let wait = Duration::from_millis(25).min(limits.deadline.saturating_sub(r.started.elapsed()));
            match r.rx.recv_timeout(wait) {
                Ok(Msg::Frame(frame)) => {
                    let is_done = frame["type"] == "done";
                    r.frames.push(frame);
                    if is_done {
                        break Self::interpret(&r.frames);
                    }
                }
                Ok(Msg::Protocol(code)) => break Outcome::Failed(code),
                Ok(Msg::Eof) => {
                    // The stream ended without a result: a bounded failure.
                    let status = r.child.wait().ok();
                    break match status.and_then(|s| s.code()) {
                        Some(0) => Outcome::Failed("no_result"),
                        Some(97) => Outcome::Failed("memory_limit_unsupported"),
                        _ => Outcome::Failed("worker_exit"),
                    };
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break Outcome::Failed("reader_gone"),
            }
        };
        drop(r.stdin.take());
        // Every path reaps: a finished worker exits by itself; anything else is killed.
        let record = match r.child.try_wait() {
            Ok(Some(status)) => ProcessRecord { pid: r.child.id(), exit: exit_text(status), reaped: true },
            _ => {
                if matches!(outcome, Outcome::Checked { .. } | Outcome::Malformed | Outcome::Unreadable | Outcome::Refused(_)) {
                    match wait_with_timeout(&mut r.child, Duration::from_secs(5)) {
                        Some(status) => ProcessRecord { pid: r.child.id(), exit: exit_text(status), reaped: true },
                        None => Self::kill_and_reap(&mut r.child),
                    }
                } else {
                    Self::kill_and_reap(&mut r.child)
                }
            }
        };
        self.records.push(record.clone());
        self.remove_owned(id);
        let settled = Settled {
            material: ticket.material.clone(),
            generation: ticket.generation,
            path: ticket.request.path.clone(),
            expected: ticket.request.expected.clone(),
            outcome,
            process: Some(record),
            peak_rss_kib: r.peak_rss_kib,
            rss_samples: r.rss_samples,
            elapsed_ms: ms(r.started),
        };
        self.outcomes.push(settled.outcome.code());
        self.slots.insert(id, (ticket, Slot::Settled));
        self.pump();
        settled
    }

    fn interpret(frames: &[Value]) -> Outcome {
        let last = frames.last().expect("done frame");
        match last["status"].as_str().unwrap_or("") {
            "checked" => Outcome::Checked {
                sha: last["contentSha256"].as_str().unwrap_or("").to_string(),
                pages: frames.iter().filter(|f| f["type"] == "page").cloned().collect(),
            },
            "malformed" => Outcome::Malformed,
            "unreadable" => Outcome::Unreadable,
            "refused_input_limit" => Outcome::Refused("input_limit"),
            "identity_mismatch" => Outcome::Refused("identity_mismatch"),
            _ => Outcome::Failed("unknown_status"),
        }
    }

    /// Publishes a settled result only if it is still the material's current
    /// request and the file at its path still has the hash it was read as.
    /// Only a published success starts downstream indexing.
    fn publish(&mut self, settled: &Settled) -> Result<(), &'static str> {
        if self.generations.get(&settled.material).copied() != Some(settled.generation) {
            return Err("superseded");
        }
        if matches!(settled.outcome, Outcome::Cancelled(_)) {
            return Err("cancelled");
        }
        if let Outcome::Checked { sha, .. } = &settled.outcome {
            if *sha != settled.expected {
                return Err("identity_mismatch");
            }
            let now = fs::read(&settled.path).map(|b| sha_hex(&b)).unwrap_or_default();
            if now != settled.expected {
                return Err("replaced_before_publication");
            }
            self.indexed.push((settled.material.clone(), sha.clone()));
        }
        self.retain(settled.material.clone(), settled.outcome.clone());
        Ok(())
    }

    fn retain(&mut self, material: String, outcome: Outcome) {
        self.retained.retain(|(m, _)| *m != material);
        self.retained.push_back((material, outcome));
        while self.retained.len() > MAX_RETAINED {
            self.retained.pop_front();
        }
    }

    fn touch(&mut self, material: &str) -> bool {
        if let Some(pos) = self.retained.iter().position(|(m, _)| m == material) {
            let item = self.retained.remove(pos).unwrap();
            self.retained.push_back(item);
            true
        } else {
            false
        }
    }
}

fn wait_with_timeout(child: &mut Child, limit: Duration) -> Option<ExitStatus> {
    let start = Instant::now();
    while start.elapsed() < limit {
        if let Ok(Some(status)) = child.try_wait() {
            return Some(status);
        }
        thread::sleep(Duration::from_millis(5));
    }
    None
}

fn alive(pid: u32) -> bool {
    Command::new("/bin/kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Generated PDF fixtures
// ---------------------------------------------------------------------------

enum PageSpec {
    Text(String),
    WinAnsi(Vec<u8>),
    Image,
    Raw(Vec<u8>),
}

fn build_pdf(specs: &[PageSpec], reorder: bool) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages = doc.new_object_id();
    let font = doc.add_object(dictionary! {"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica"});
    let winansi = doc.add_object(dictionary! {"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica","Encoding"=>"WinAnsiEncoding"});
    let image = doc.add_object(Stream::new(
        dictionary! {"Type"=>"XObject","Subtype"=>"Image","Width"=>1,"Height"=>1,"ColorSpace"=>"DeviceRGB","BitsPerComponent"=>8},
        vec![0, 0, 0],
    ));
    let resources = doc.add_object(dictionary! {"Font"=>dictionary! {"F1"=>font,"F2"=>winansi},"XObject"=>dictionary! {"Im1"=>image}});
    let mut ids: Vec<_> = specs.iter().map(|_| doc.new_object_id()).collect();
    if reorder {
        // Logical page order deliberately differs from object-id order.
        ids.rotate_left(1);
    }
    for (spec, id) in specs.iter().zip(ids.iter()) {
        let encoded = match spec {
            PageSpec::Raw(bytes) => bytes.clone(),
            other => {
                let ops = match other {
                    PageSpec::Image => vec![Operation::new("Do", vec![Object::Name(b"Im1".to_vec())])],
                    PageSpec::Text(text) => vec![
                        Operation::new("BT", vec![]),
                        Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 12.into()]),
                        Operation::new("Tj", vec![Object::string_literal(text.as_str())]),
                        Operation::new("ET", vec![]),
                    ],
                    PageSpec::WinAnsi(bytes) => vec![
                        Operation::new("BT", vec![]),
                        Operation::new("Tf", vec![Object::Name(b"F2".to_vec()), 12.into()]),
                        Operation::new("Tj", vec![Object::String(bytes.clone(), lopdf::StringFormat::Literal)]),
                        Operation::new("ET", vec![]),
                    ],
                    PageSpec::Raw(_) => unreachable!(),
                };
                Content { operations: ops }.encode().expect("content")
            }
        };
        let content = doc.add_object(Stream::new(dictionary! {}, encoded));
        doc.objects.insert(*id, dictionary! {"Type"=>"Page","Parent"=>pages,"Contents"=>content}.into());
    }
    doc.objects.insert(
        pages,
        dictionary! {
            "Type"=>"Pages",
            "Kids"=>ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count"=>specs.len() as i64,
            "Resources"=>resources,
            "MediaBox"=>vec![0.into(),0.into(),612.into(),792.into()]
        }
        .into(),
    );
    let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages});
    doc.trailer.set("Root", catalog);
    doc.compress();
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).expect("save pdf");
    bytes
}

fn text_pages(n: usize, seed: u64) -> Vec<u8> {
    let mut rng = Rng(seed);
    let specs: Vec<PageSpec> = (1..=n).map(|p| PageSpec::Text(format!("PAGE_{p} {}", sentence(&mut rng, 120)))).collect();
    build_pdf(&specs, true)
}

/// A content stream that decompresses to `size` bytes of one text string.
fn bomb_pdf(size: usize) -> Vec<u8> {
    let mut stream = Vec::with_capacity(size + 32);
    stream.extend_from_slice(b"BT /F1 12 Tf (");
    stream.resize(size, b'x');
    stream.extend_from_slice(b") Tj ET");
    build_pdf(&[PageSpec::Raw(stream)], false)
}

// ---------------------------------------------------------------------------
// Seeded vocabulary and corpus
// ---------------------------------------------------------------------------

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

const AVIATION: &[&str] = &[
    "crosswind", "headwind", "tailwind", "density", "altitude", "pressure", "temperature", "dewpoint", "metar", "taf", "pirep", "sigmet", "airmet",
    "convective", "icing", "turbulence", "visibility", "ceiling", "cloud", "fog", "mist", "haze", "front", "trough", "ridge", "inversion",
    "stability", "lapse", "rate", "thunderstorm", "microburst", "windshear", "runway", "taxiway", "threshold", "displaced", "hold", "short",
    "line", "approach", "departure", "pattern", "downwind", "base", "final", "upwind", "crosswind", "go", "around", "flare", "touchdown", "rollout",
    "stall", "spin", "slip", "skid", "coordinated", "rudder", "aileron", "elevator", "trim", "flaps", "slats", "spoilers", "throttle", "mixture",
    "propeller", "carburetor", "heat", "magneto", "ignition", "fuel", "pump", "selector", "vent", "oil", "cylinder", "head", "exhaust", "gas",
    "manifold", "tachometer", "airspeed", "indicator", "altimeter", "vertical", "speed", "attitude", "heading", "turn", "coordinator", "compass",
    "deviation", "variation", "magnetic", "true", "course", "track", "groundspeed", "wind", "correction", "angle", "drift", "pilotage",
    "dead", "reckoning", "navigation", "sectional", "chart", "legend", "airspace", "class", "bravo", "charlie", "delta", "echo", "golf",
    "restricted", "prohibited", "warning", "alert", "military", "operations", "area", "tfr", "notam", "atis", "clearance", "ground", "tower",
    "center", "approach", "frequency", "squawk", "transponder", "mode", "ads-b", "vor", "dme", "ndb", "gps", "waas", "rnav", "localizer",
    "glideslope", "minimums", "decision", "height", "missed", "procedure", "holding", "entry", "teardrop", "parallel", "direct", "weight",
    "balance", "moment", "arm", "datum", "center", "gravity", "envelope", "limits", "takeoff", "landing", "distance", "performance", "chart",
    "climb", "cruise", "descent", "glide", "best", "rate", "angle", "vx", "vy", "va", "vno", "vne", "vfe", "vso", "vs1", "load", "factor",
    "bank", "steep", "turns", "chandelle", "lazy", "eights", "eights-on-pylons", "s-turns", "rectangular", "course", "emergency", "engine",
    "failure", "forced", "landing", "ditching", "fire", "smoke", "electrical", "alternator", "battery", "bus", "circuit", "breaker", "vacuum",
    "pitot", "static", "blockage", "hypoxia", "hyperventilation", "spatial", "disorientation", "fatigue", "stress", "aeronautical", "decision",
    "making", "risk", "management", "checklist", "preflight", "inspection", "logbook", "endorsement", "medical", "certificate", "student",
    "private", "instrument", "commercial", "instructor", "solo", "cross-country", "night", "currency", "regulations", "part", "far", "aim",
    "handbook", "phak", "afh", "section", "chapter", "figure", "table", "example", "review", "question", "answer", "flashcard", "guide",
];
const GENERAL: &[&str] = &[
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "from", "by", "is", "are", "was", "be", "when", "if", "then",
    "before", "after", "during", "while", "always", "never", "check", "verify", "maintain", "reduce", "increase", "set", "select", "monitor",
    "note", "remember", "caution", "important", "typical", "normal", "abnormal", "higher", "lower", "more", "less", "safe", "unsafe",
];
const UNICODE: &[&str] = &["café", "Zürich", "naïve", "résumé", "São", "Ålesund", "ΑΛΦΑ", "αλφα", "straße", "飛行機", "Ωmega", "Ñandú"];

fn word(rng: &mut Rng) -> &'static str {
    match rng.below(100) {
        0..=54 => AVIATION[rng.below(AVIATION.len())],
        55..=97 => GENERAL[rng.below(GENERAL.len())],
        _ => UNICODE[rng.below(UNICODE.len())],
    }
}

fn sentence(rng: &mut Rng, words: usize) -> String {
    let n = words / 2 + rng.below(words);
    (0..n).map(|_| word(rng)).collect::<Vec<_>>().join(" ")
}

#[derive(Clone)]
struct Record {
    id: String,
    material: String,
    kind: &'static str,
    page: Option<u32>,
    sha: String,
    title: String,
    body: String,
}

fn corpus(materials: usize, seed: u64) -> Vec<Record> {
    let mut rng = Rng(seed);
    let mut records = Vec::new();
    for m in 0..materials {
        let material = format!("mat-{m:05}");
        let sha = sha_hex(material.as_bytes());
        // Every 50th title repeats an earlier one: duplicate titles exist.
        let title = if m % 50 == 7 && m > 50 { format!("Material {:05}", m - 50) } else { format!("Material {m:05}") };
        for page in 1..=4u32 {
            records.push(Record {
                id: format!("{material}:p{page}"),
                material: material.clone(),
                kind: "page",
                page: Some(page),
                sha: sha.clone(),
                title: title.clone(),
                body: sentence(&mut rng, 160),
            });
        }
        records.push(Record { id: format!("{material}:guide"), material: material.clone(), kind: "guide", page: None, sha: sha.clone(), title: title.clone(), body: sentence(&mut rng, 220) });
        records.push(Record { id: format!("{material}:note"), material: material.clone(), kind: "note", page: None, sha: sha.clone(), title: title.clone(), body: sentence(&mut rng, 40) });
    }
    records
}

// ---------------------------------------------------------------------------
// Native FTS5 derived cache (Deliverable B). A separate disposable database:
// never the shared migration schema, never part of an authoritative backup.
// ---------------------------------------------------------------------------

const CACHE_VERSION: &str = "p54-proof-1";
const MAX_QUERY_CHARS: usize = 256;
const MAX_TERMS: usize = 8;
const MAX_RESULTS: usize = 50;
const MAX_EXCERPT_CHARS: usize = 320;

struct Cache {
    db: Connection,
    path: PathBuf,
}

#[derive(Debug, PartialEq)]
enum OpenState {
    Ready,
    NeedsRebuild(&'static str),
}

#[derive(Debug, Clone)]
struct Hit {
    record_id: String,
    material: String,
    kind: String,
    /// A page destination only while its hash is the material's current one.
    destination: Option<(String, u32)>,
    excerpt: String,
}

#[derive(Debug, PartialEq)]
enum Query {
    /// Nothing searchable: the caller keeps the existing metadata filter only.
    Empty,
    Match(String),
}

/// Compiles user text into a safe FTS5 expression: every word or quoted
/// phrase becomes a quoted literal string (operators, columns, `*`, `^`,
/// NEAR and parentheses lose meaning), joined with AND. No prefix or fuzzy.
fn compile_query(input: &str) -> Result<Query, &'static str> {
    let text: String = input.nfkc().collect();
    if text.chars().count() > MAX_QUERY_CHARS {
        return Err("query_too_long");
    }
    let mut pieces: Vec<String> = Vec::new();
    let mut rest = text.as_str();
    while !rest.trim_start().is_empty() {
        rest = rest.trim_start();
        let (piece, tail) = if let Some(after) = rest.strip_prefix('"') {
            match after.find('"') {
                Some(end) => (&after[..end], &after[end + 1..]),
                None => (after, ""),
            }
        } else {
            match rest.find(char::is_whitespace) {
                Some(end) => (&rest[..end], &rest[end..]),
                None => (rest, ""),
            }
        };
        rest = tail;
        if piece.chars().any(char::is_alphanumeric) {
            pieces.push(format!("\"{}\"", piece.replace('"', "\"\"")));
        }
    }
    if pieces.is_empty() {
        return Ok(Query::Empty);
    }
    if pieces.len() > MAX_TERMS {
        return Err("too_many_terms");
    }
    Ok(Query::Match(pieces.join(" AND ")))
}

fn truncate_chars(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_string(),
    }
}

impl Cache {
    /// Opens the cache for a source fingerprint (e.g. profile/restore id).
    /// A different fingerprint, version or an unfinished build disposes the
    /// file: derived data is never trusted across a restore or a crash.
    fn open(path: &Path, fingerprint: &str) -> (Cache, OpenState) {
        let mut state = OpenState::Ready;
        if path.exists() {
            let verdict = (|| -> Option<&'static str> {
                let db = Connection::open(path).ok()?;
                let get = |k: &str| db.query_row("SELECT value FROM cache_meta WHERE key=?1", [k], |r| r.get::<_, String>(0)).ok();
                if get("version").as_deref() != Some(CACHE_VERSION) {
                    return Some("version");
                }
                if get("fingerprint").as_deref() != Some(fingerprint) {
                    return Some("fingerprint");
                }
                if get("build_state").as_deref() != Some("complete") {
                    return Some("incomplete_build");
                }
                None
            })()
            .or(Some("unreadable"));
            // `or` above only applies when the closure itself could not read.
            let verdict = match verdict {
                Some("unreadable") if Connection::open(path).is_ok() && Self::meta_ok(path, fingerprint) => None,
                v => v,
            };
            if let Some(reason) = verdict {
                for suffix in ["", "-wal", "-shm", "-journal"] {
                    let _ = fs::remove_file(format!("{}{suffix}", path.display()));
                }
                state = OpenState::NeedsRebuild(reason);
            }
        } else {
            state = OpenState::NeedsRebuild("absent");
        }
        let db = Connection::open(path).expect("open cache");
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS cache_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
               title, body, material_id UNINDEXED, record_id UNINDEXED, kind UNINDEXED,
               physical_page UNINDEXED, content_sha256 UNINDEXED,
               tokenize='unicode61 remove_diacritics 2');",
        )
        .expect("cache schema");
        db.execute("INSERT OR REPLACE INTO cache_meta VALUES ('version', ?1)", [CACHE_VERSION]).unwrap();
        db.execute("INSERT OR REPLACE INTO cache_meta VALUES ('fingerprint', ?1)", [fingerprint]).unwrap();
        if state != OpenState::Ready {
            db.execute("INSERT OR REPLACE INTO cache_meta VALUES ('build_state', 'empty')", []).unwrap();
        }
        (Cache { db, path: path.to_path_buf() }, state)
    }

    fn meta_ok(path: &Path, fingerprint: &str) -> bool {
        let Ok(db) = Connection::open(path) else { return false };
        let get = |k: &str| db.query_row("SELECT value FROM cache_meta WHERE key=?1", [k], |r| r.get::<_, String>(0)).ok();
        get("version").as_deref() == Some(CACHE_VERSION) && get("fingerprint").as_deref() == Some(fingerprint) && get("build_state").as_deref() == Some("complete")
    }

    fn rebuild(&mut self, records: &[Record]) {
        self.db.execute("INSERT OR REPLACE INTO cache_meta VALUES ('build_state', 'building')", []).unwrap();
        self.db.execute("DELETE FROM search_index", []).unwrap();
        for batch in records.chunks(500) {
            let tx = self.db.transaction().unwrap();
            {
                let mut insert = tx
                    .prepare("INSERT INTO search_index(title, body, material_id, record_id, kind, physical_page, content_sha256) VALUES (?1,?2,?3,?4,?5,?6,?7)")
                    .unwrap();
                for r in batch {
                    insert.execute(params![r.title, r.body, r.material, r.id, r.kind, r.page, r.sha]).unwrap();
                }
            }
            tx.commit().unwrap();
        }
        self.db.execute("INSERT OR REPLACE INTO cache_meta VALUES ('build_state', 'complete')", []).unwrap();
    }

    /// Replaces one material's records atomically, but only if, just before
    /// commit, the update is still current for that material and hash.
    fn replace_material(&mut self, material: &str, records: &[Record], still_current: impl FnOnce() -> bool) -> Result<(), &'static str> {
        let tx = self.db.transaction().unwrap();
        tx.execute("DELETE FROM search_index WHERE material_id=?1", [material]).unwrap();
        {
            let mut insert = tx
                .prepare("INSERT INTO search_index(title, body, material_id, record_id, kind, physical_page, content_sha256) VALUES (?1,?2,?3,?4,?5,?6,?7)")
                .unwrap();
            for r in records {
                insert.execute(params![r.title, r.body, r.material, r.id, r.kind, r.page, r.sha]).unwrap();
            }
        }
        if !still_current() {
            tx.rollback().unwrap();
            return Err("superseded");
        }
        tx.commit().unwrap();
        Ok(())
    }

    fn delete_material(&mut self, material: &str) {
        self.db.execute("DELETE FROM search_index WHERE material_id=?1", [material]).unwrap();
    }

    /// Bounded search. `current` maps each existing material to its current
    /// content hash; deleted materials are dropped and stale page hashes lose
    /// their destination. Returns (hits, truncated).
    fn search(&self, query: &Query, current: &HashMap<String, String>) -> (Vec<Hit>, bool) {
        let Query::Match(expr) = query else { return (Vec::new(), false) };
        let mut stmt = self
            .db
            .prepare(
                "SELECT record_id, material_id, kind, physical_page, content_sha256, snippet(search_index, 1, '', '', '…', 24)
                 FROM search_index WHERE search_index MATCH ?1 ORDER BY bm25(search_index, 4.0, 1.0), record_id LIMIT ?2",
            )
            .unwrap();
        let rows: Vec<(String, String, String, Option<u32>, String, String)> = stmt
            .query_map(params![expr, (MAX_RESULTS * 4) as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        let mut hits = Vec::new();
        let mut truncated = false;
        for (record_id, material, kind, page, sha, snippet) in rows {
            let Some(now) = current.get(&material) else { continue };
            if hits.len() == MAX_RESULTS {
                truncated = true;
                break;
            }
            let destination = match (kind.as_str(), page) {
                ("page", Some(p)) if sha == *now => Some((sha.clone(), p)),
                _ => None,
            };
            hits.push(Hit { record_id, material, kind, destination, excerpt: truncate_chars(&snippet, MAX_EXCERPT_CHARS) });
        }
        (hits, truncated)
    }

    fn ids(&self, query: &str, current: &HashMap<String, String>) -> Vec<String> {
        let compiled = compile_query(query).expect("query compiles");
        let mut ids: Vec<String> = self.search(&compiled, current).0.into_iter().map(|h| h.record_id).collect();
        ids.sort();
        ids
    }
}

fn current_of(records: &[Record]) -> HashMap<String, String> {
    records.iter().map(|r| (r.material.clone(), r.sha.clone())).collect()
}

fn rec(id: &str, material: &str, kind: &'static str, page: Option<u32>, sha: &str, title: &str, body: &str) -> Record {
    Record { id: id.into(), material: material.into(), kind, page, sha: sha.into(), title: title.into(), body: body.into() }
}

/// Helper child for interrupted-write recovery: really aborts mid-write.
fn cache_crash(db: &Path, mode: &str) -> ! {
    let (mut cache, _) = Cache::open(db, "fp-crash");
    match mode {
        "mid-rebuild" => {
            let records = corpus(40, 9);
            cache.db.execute("INSERT OR REPLACE INTO cache_meta VALUES ('build_state', 'building')", []).unwrap();
            cache.db.execute("DELETE FROM search_index", []).unwrap();
            let tx = cache.db.transaction().unwrap();
            for r in &records[..records.len() / 2] {
                tx.execute(
                    "INSERT INTO search_index(title, body, material_id, record_id, kind, physical_page, content_sha256) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![r.title, r.body, r.material, r.id, r.kind, r.page, r.sha],
                )
                .unwrap();
            }
            tx.commit().unwrap(); // first batch landed; build_state still 'building'
            std::process::abort();
        }
        _ => {
            // mid-update: delete + partial insert inside one uncommitted transaction
            let tx = cache.db.transaction().unwrap();
            tx.execute("DELETE FROM search_index WHERE material_id='mat-00001'", []).unwrap();
            tx.execute(
                "INSERT INTO search_index(title, body, material_id, record_id, kind, physical_page, content_sha256) VALUES ('t','uniquehalfwritten','mat-00001','x','page',1,'z')",
                [],
            )
            .unwrap();
            std::process::abort();
        }
    }
}

// ---------------------------------------------------------------------------
// Suite: every pre-registered correctness case, recorded pass/fail.
// ---------------------------------------------------------------------------

struct Cases {
    results: Vec<Value>,
}

impl Cases {
    fn check(&mut self, group: &str, name: &str, pass: bool, detail: Value) {
        self.results.push(json!({"group": group, "case": name, "pass": pass, "detail": detail}));
    }
}

fn request(material: &str, path: &Path, limits: Limits, mode: &str) -> Request {
    let expected = sha_hex(&fs::read(path).expect("fixture"));
    Request { material: material.into(), path: path.into(), expected, limits, mode: mode.into() }
}

fn settled_json(s: &Settled) -> Value {
    json!({
        "outcome": s.outcome.code(),
        "pid": s.process.as_ref().map(|p| p.pid),
        "exit": s.process.as_ref().map(|p| p.exit.clone()),
        "reaped": s.process.as_ref().map(|p| p.reaped),
        "elapsedMs": s.elapsed_ms,
        "peakRssKiB": s.peak_rss_kib,
        "rssSamples": s.rss_samples,
    })
}

fn page_statuses(outcome: &Outcome) -> Vec<(u64, String)> {
    match outcome {
        Outcome::Checked { pages, .. } => pages.iter().map(|p| (p["physicalPage"].as_u64().unwrap_or(0), p["status"].as_str().unwrap_or("").to_string())).collect(),
        _ => Vec::new(),
    }
}

fn suite(scratch: &Path) -> Value {
    assert!(!scratch.exists(), "suite scratch must be new");
    fs::create_dir_all(scratch).unwrap();
    let fixtures = scratch.join("fixtures");
    fs::create_dir_all(&fixtures).unwrap();
    // A file the supervisor does not own; it must survive cleanup.
    fs::write(scratch.join("NOT_OWNED"), b"left alone\n").unwrap();
    let exe = std::env::current_exe().unwrap();
    let mut sup = Supervisor::new(exe, scratch.join("workers"));
    let mut cases = Cases { results: Vec::new() };
    let proof = Limits::proof();
    let fast = Limits { deadline: Duration::from_secs(10), ..proof };

    // --- Extraction -------------------------------------------------------
    let main_pdf = fixtures.join("mixed.pdf");
    let large = "crosswind ".repeat(100_000);
    fs::write(
        &main_pdf,
        build_pdf(
            &[
                PageSpec::Text("SOURCE_ALPHA_SYNTHETIC first".into()),
                PageSpec::Image,
                PageSpec::Text(format!("SOURCE_BETA_SYNTHETIC {large}")),
                PageSpec::WinAnsi(b"accent caf\xe9 check".to_vec()),
            ],
            true,
        ),
    )
    .unwrap();
    let id = sup.start(request("m-mixed", &main_pdf, fast, "normal"));
    let s = sup.settle(id);
    let statuses = page_statuses(&s.outcome);
    let texts: Vec<String> = match &s.outcome {
        Outcome::Checked { pages, .. } => pages.iter().map(|p| p["text"].as_str().unwrap_or("").to_string()).collect(),
        _ => Vec::new(),
    };
    cases.check(
        "extraction",
        "physical order despite reordered object ids",
        statuses.len() == 4 && texts[0].contains("SOURCE_ALPHA_SYNTHETIC") && !texts[0].contains("SOURCE_BETA"),
        json!({"statuses": statuses, "settled": settled_json(&s)}),
    );
    cases.check("extraction", "image-only page is no_extractable_text (not proof of a scan)", statuses.get(1).map(|x| x.1.as_str()) == Some("no_extractable_text"), json!(statuses.get(1)));
    cases.check(
        "extraction",
        "compressed oversized page refused at page limit (post-allocation)",
        statuses.get(2).map(|x| x.1.as_str()) == Some("refused_page_output_limit"),
        json!({"compressedFileBytes": fs::metadata(&main_pdf).unwrap().len(), "page3": statuses.get(2)}),
    );
    let winansi = texts.get(3).cloned().unwrap_or_default();
    cases.check("extraction", "WinAnsi accented text (café) extracted as Unicode", winansi.contains("café"), json!({"extracted": winansi.trim()}));
    let published = sup.publish(&s);
    cases.check("extraction", "current success publishes and starts indexing once", published.is_ok() && sup.indexed.len() == 1, json!({"indexed": sup.indexed.len()}));

    let malformed = fixtures.join("malformed.pdf");
    fs::write(&malformed, b"not a PDF at all").unwrap();
    let s = sup.run(request("m-malformed", &malformed, fast, "normal"));
    cases.check("extraction", "malformed input reported as malformed", s.outcome == Outcome::Malformed, settled_json(&s));
    let truncated = fixtures.join("truncated.pdf");
    let full = fs::read(&main_pdf).unwrap();
    fs::write(&truncated, &full[..full.len() * 2 / 5]).unwrap();
    let s = sup.run(request("m-truncated", &truncated, fast, "normal"));
    cases.check("extraction", "truncated input reported as malformed", s.outcome == Outcome::Malformed, settled_json(&s));

    let too_big = Limits { input: 1024, ..fast };
    let s = sup.run(request("m-big", &main_pdf, too_big, "normal"));
    cases.check("extraction", "input over the byte ceiling refused before parsing", s.outcome == Outcome::Refused("input_limit"), settled_json(&s));

    // Decompression bomb: watchdog, then deadline-only, then ulimit attempt.
    let bomb = fixtures.join("bomb.pdf");
    fs::write(&bomb, bomb_pdf(384 * MIB)).unwrap();
    let bomb_bytes = fs::metadata(&bomb).unwrap().len();
    let s = sup.run(request("m-bomb", &bomb, proof, "normal"));
    let watchdog_alive = s.process.as_ref().map(|p| alive(p.pid)).unwrap_or(true);
    cases.check(
        "extraction",
        "decompression bomb stopped by RSS watchdog (sampled; overshoot recorded)",
        s.outcome == Outcome::Cancelled("memory_watchdog") && !watchdog_alive,
        json!({"bombFileBytes": bomb_bytes, "decompressedBytes": 384 * MIB, "settled": settled_json(&s), "watchdogKiB": proof.rss_kib, "overshootKiB": s.peak_rss_kib.saturating_sub(proof.rss_kib.unwrap())}),
    );
    let deadline_only = Limits { deadline: Duration::from_secs(1), rss_kib: None, ..proof };
    let s = sup.run(request("m-bomb", &bomb, deadline_only, "normal"));
    cases.check(
        "lifecycle",
        "real deadline: bomb killed and reaped within deadline + 500 ms",
        s.outcome == Outcome::Cancelled("deadline") && s.elapsed_ms <= 1500.0 && s.process.as_ref().map(|p| p.reaped && !alive(p.pid)).unwrap_or(false),
        settled_json(&s),
    );
    let ulimited = Limits { deadline: Duration::from_secs(20), rss_kib: Some(2 * 1024 * 1024), ulimit_kib: Some(512 * 1024), ..proof };
    let s = sup.run(request("m-bomb", &bomb, ulimited, "normal"));
    // Recorded, not asserted: whether macOS enforces `ulimit -v` here.
    cases.check(
        "memory",
        "ulimit -v 512 MiB attempt recorded (enforcement observed, not assumed)",
        true,
        json!({"observedOutcome": s.outcome.code(), "settled": settled_json(&s), "interpretation": "failed:memory_limit_unsupported => the shell refused ulimit -v and the worker never ran; failed:worker_exit with signal:6 => allocation refused under the limit; cancelled:memory_watchdog (2 GiB) or deadline => limit accepted but not enforced"}),
    );

    // --- Identity ----------------------------------------------------------
    let swap = fixtures.join("swap.pdf");
    let original = text_pages(2, 1);
    let replacement = text_pages(2, 2);
    fs::write(&swap, &original).unwrap();
    let req = request("m-swap", &swap, fast, "normal");
    fs::write(&swap, &replacement).unwrap(); // replaced before the worker reads
    let s = sup.run(req);
    cases.check("identity", "file replaced before read is refused", s.outcome == Outcome::Refused("identity_mismatch") && sup.publish(&s).is_ok(), settled_json(&s));

    fs::write(&swap, &original).unwrap();
    let id = sup.start(request("m-swap", &swap, fast, "hold"));
    let read = sup.wait_for(id, "read");
    fs::write(&swap, &replacement).unwrap(); // replaced after read, before publication
    sup.release(id);
    let s = sup.settle(id);
    let before = sup.indexed.len();
    let verdict = sup.publish(&s);
    cases.check(
        "identity",
        "file replaced after read is refused at the publication re-check",
        read && matches!(s.outcome, Outcome::Checked { .. }) && verdict == Err("replaced_before_publication") && sup.indexed.len() == before,
        json!({"publish": format!("{verdict:?}"), "settled": settled_json(&s)}),
    );

    fs::write(&swap, &original).unwrap();
    let old = sup.start(request("m-req", &swap, fast, "hold"));
    sup.wait_for(old, "read");
    let old_pid = sup.pid(old);
    let newer = sup.start(request("m-req", &swap, fast, "normal")); // supersedes and reaps the held one
    let s = sup.settle(newer);
    let old_reaped = old_pid.map(|p| !alive(p)).unwrap_or(false);
    let old_record = sup.records.iter().find(|r| Some(r.pid) == old_pid).cloned();
    cases.check(
        "identity",
        "request change while held: old worker killed and reaped; newer publishes",
        old_reaped && old_record.as_ref().map(|r| r.reaped).unwrap_or(false) && sup.publish(&s).is_ok(),
        json!({"oldPid": old_pid, "oldExit": old_record.map(|r| r.exit), "newer": settled_json(&s)}),
    );

    let a = sup.start(request("m-race", &swap, fast, "normal"));
    let settled_a = sup.settle(a);
    let _b = sup.start(request("m-race", &swap, fast, "hold")); // newer request for the material
    let before = sup.indexed.len();
    let verdict = sup.publish(&settled_a);
    cases.check("identity", "old success settled before supersession cannot publish or index", verdict == Err("superseded") && sup.indexed.len() == before, json!({"publish": format!("{verdict:?}")}));
    let held = sup.slots.iter().find(|(_, (t, s))| t.material == "m-race" && matches!(s, Slot::Running(_))).map(|(id, _)| *id).unwrap();
    sup.cancel(held, "cancelled");

    let e = sup.start(request("m-err", &malformed, fast, "normal"));
    let settled_e = sup.settle(e);
    let _f = sup.start(request("m-err", &main_pdf, fast, "hold"));
    let verdict = sup.publish(&settled_e);
    let retained_err = sup.retained.iter().any(|(m, o)| m == "m-err" && *o == Outcome::Malformed);
    cases.check("identity", "old error settled before supersession publishes nothing", verdict == Err("superseded") && !retained_err, json!({"publish": format!("{verdict:?}")}));
    let held = sup.slots.iter().find(|(_, (t, s))| t.material == "m-err" && matches!(s, Slot::Running(_))).map(|(id, _)| *id).unwrap();
    let cancelled = sup.cancel(held, "cancelled").unwrap();
    cases.check(
        "lifecycle",
        "explicit cancel kills and reaps a held worker",
        cancelled.process.as_ref().map(|p| p.reaped && !alive(p.pid) && p.exit.starts_with("signal:")).unwrap_or(false),
        settled_json(&cancelled),
    );
    let before = sup.indexed.len();
    let verdict = sup.publish(&cancelled);
    let retained_cancel = sup.retained.iter().any(|(m, _)| m == "m-err");
    cases.check("lifecycle", "a cancelled request publishes nothing and starts no indexing", verdict == Err("cancelled") && sup.indexed.len() == before && !retained_cancel, json!({"publish": format!("{verdict:?}")}));

    // --- Protocol ----------------------------------------------------------
    for (mode, expected) in [
        ("oversized-line", Outcome::Failed("frame_limit")),
        ("invalid-utf8", Outcome::Failed("invalid_utf8")),
        ("bad-json", Outcome::Failed("malformed_json")),
        ("exit-nonzero", Outcome::Failed("worker_exit")),
        ("no-result", Outcome::Failed("no_result")),
        ("flood", Outcome::Failed("stream_limit")),
    ] {
        let s = sup.run(request(&format!("m-{mode}"), &main_pdf, fast, mode));
        let reaped = s.process.as_ref().map(|p| p.reaped && !alive(p.pid)).unwrap_or(false);
        cases.check("protocol", &format!("{mode} settles as a bounded failure"), s.outcome == expected && reaped, settled_json(&s));
    }
    let stall = Limits { deadline: Duration::from_millis(800), ..fast };
    let s = sup.run(request("m-stall", &main_pdf, stall, "stall"));
    cases.check(
        "protocol",
        "stalled worker settles at the deadline and is reaped",
        s.outcome == Outcome::Cancelled("deadline") && s.elapsed_ms <= 1300.0 && s.process.as_ref().map(|p| p.reaped && !alive(p.pid)).unwrap_or(false),
        settled_json(&s),
    );

    // --- Admission and retention -----------------------------------------
    let h1 = sup.start(request("q1", &swap, fast, "hold"));
    let h2 = sup.start(request("q2", &swap, fast, "hold"));
    let h3 = sup.start(request("q3", &swap, fast, "hold"));
    let queued = sup.is_queued(h3) && sup.pid(h1).is_some() && sup.pid(h2).is_some();
    sup.cancel(h1, "cancelled");
    let admitted = sup.pid(h3).is_some();
    cases.check("admission", "third request waits while two workers run, then is admitted", queued && admitted, json!({"queuedWhileTwoRan": queued, "admittedAfterCancel": admitted}));
    sup.cancel(h2, "cancelled");
    sup.cancel(h3, "cancelled");

    sup.retained.clear();
    for i in 0..9 {
        sup.retain(format!("r{i}"), Outcome::Malformed);
        if i == 7 {
            sup.touch("r0"); // r0 becomes most recent; r1 is now least recent
        }
    }
    let kept: Vec<String> = sup.retained.iter().map(|(m, _)| m.clone()).collect();
    cases.check("admission", "ninth retained result evicts the least recently used", kept.len() == 8 && kept.contains(&"r0".to_string()) && !kept.contains(&"r1".to_string()), json!(kept));

    // --- Error privacy, cleanup, orphans ----------------------------------
    let secrets = [scratch.display().to_string(), "fixtures".into(), ".pdf".into(), "SOURCE_".into(), "crosswind".into(), "café".into()];
    let mut distinct = sup.outcomes.clone();
    distinct.sort();
    distinct.dedup();
    let leaked: Vec<&String> = distinct.iter().filter(|c| c.contains('/') || secrets.iter().any(|s| c.contains(s.as_str()))).collect();
    cases.check("protocol", "every produced outcome code carries no path, content or credential", leaked.is_empty() && !sup.outcomes.is_empty(), json!({"distinctCodes": distinct, "produced": sup.outcomes.len()}));

    let live: Vec<u32> = sup.records.iter().map(|r| r.pid).filter(|p| alive(*p)).collect();
    let unreaped = sup.records.iter().filter(|r| !r.reaped).count();
    cases.check("lifecycle", "no live or unreaped worker remains", live.is_empty() && unreaped == 0, json!({"workersSpawned": sup.records.len(), "live": live, "unreaped": unreaped}));
    let leftovers: Vec<String> = fs::read_dir(scratch.join("workers")).map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
    cases.check("lifecycle", "owned scratch removed; non-owned file untouched", leftovers.is_empty() && scratch.join("NOT_OWNED").exists(), json!({"leftovers": leftovers}));

    // --- Cache and semantics ----------------------------------------------
    cache_cases(scratch, &mut cases);

    let records: Vec<Value> = sup.records.iter().map(|r| json!({"pid": r.pid, "exit": r.exit, "reaped": r.reaped})).collect();
    let passed = cases.results.iter().filter(|c| c["pass"] == true).count();
    json!({"cases": cases.results, "passed": passed, "total": cases.results.len(), "workerProcesses": records})
}

fn cache_cases(scratch: &Path, cases: &mut Cases) {
    let dir = scratch.join("cache");
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("search-cache.sqlite");
    let (mut cache, state) = Cache::open(&path, "fp-1");
    cases.check("cache", "fresh cache needs a rebuild", state == OpenState::NeedsRebuild("absent"), json!(format!("{state:?}")));
    let a = "a".repeat(64);
    let b = "b".repeat(64);
    let c = "c".repeat(64);
    let mut records = vec![
        rec("m1:p1", "m1", "page", Some(1), &a, "Weather Services", "Read the METAR before departure; the TAF covers five statute miles."),
        rec("m1:p2", "m1", "page", Some(2), &a, "Weather Services", "A café near the field sells fuel. Zürich naïve résumé."),
        rec("m2:p1", "m2", "page", Some(1), &b, "Weather Services", "Crosswind landing: crab then slip. density altitude matters."),
        rec("m2:guide", "m2", "guide", None, &b, "Weather Services", "Density altitude rises with temperature. <b>bold</b> crosswind <script>x()</script>"),
        rec("m3:p1", "m3", "page", Some(1), &c, "Airspace", "VOR/DME approach; class bravo; straße ΑΛΦΑ 飛行機 crosswind or metar"),
        rec("m3:note", "m3", "note", None, &c, "Airspace", "title:metar NEAR(crosswind density) -fuel ^approach crossw* strasse"),
    ];
    for i in 0..60 {
        records.push(rec(&format!("m4:p{i:02}"), "m4", "page", Some(i + 1), &"d".repeat(64), "Bulk", &format!("bulkterm sample {i}")));
    }
    cache.rebuild(&records);
    let current = current_of(&records);

    let q = |text: &str| cache.ids(text, &current);
    cases.check("semantics", "literal word", q("metar") == ["m1:p1", "m3:note", "m3:p1"], json!(q("metar")));
    cases.check("semantics", "case folding (METAR = metar)", q("METAR") == q("metar"), json!(q("METAR")));
    cases.check("semantics", "quoted phrase requires adjacency", q("\"density altitude\"") == ["m2:guide", "m2:p1"] && q("\"altitude density\"").is_empty(), json!({"phrase": q("\"density altitude\""), "reversed": q("\"altitude density\"")}));
    cases.check("semantics", "words are ANDed", q("crosswind density") == ["m2:guide", "m2:p1", "m3:note"] && q("crosswind slip") == ["m2:p1"], json!({"crosswind density": q("crosswind density"), "crosswind slip": q("crosswind slip")}));
    cases.check("semantics", "OR is a literal word, not an operator", q("crosswind OR metar") == ["m3:p1"], json!(q("crosswind OR metar")));
    let operator_inputs = ["title:metar", "NEAR(crosswind density)", "-fuel", "^approach", "crossw*", "(", ")", "\"", "a\"b", "AND", "NOT x", "*", "{m1}", "x:y:z"];
    let mut operator_ok = true;
    let mut operator_detail = Vec::new();
    for input in operator_inputs {
        let compiled = compile_query(input);
        let ran = match &compiled {
            Ok(query) => {
                let hits = cache.search(query, &current).0.len();
                operator_detail.push(json!({"input": input, "compiled": format!("{query:?}"), "hits": hits}));
                true
            }
            Err(e) => {
                operator_detail.push(json!({"input": input, "error": e}));
                false
            }
        };
        operator_ok &= ran;
    }
    cases.check("semantics", "FTS operator text is compiled as literal strings and never errors", operator_ok && q("crossw*") == ["m3:note"] && q("title:metar") == ["m3:note"], json!(operator_detail));
    cases.check("semantics", "no implicit prefix: crossw does not match crosswind", q("crossw").len() == 1 && q("crossw") == ["m3:note"], json!(q("crossw")));
    cases.check("semantics", "punctuation splits tokens: VOR/DME = phrase vor dme", q("VOR/DME") == ["m3:p1"] && q("vor dme") == ["m3:p1"], json!(q("VOR/DME")));
    cases.check("semantics", "accent folding both ways (cafe/café/CAFÉ)", q("cafe") == ["m1:p2"] && q("café") == ["m1:p2"] && q("CAFÉ") == ["m1:p2"], json!({"cafe": q("cafe"), "CAFÉ": q("CAFÉ")}));
    cases.check("semantics", "Unicode diacritics and case: zurich, naive, resume, αλφα", q("zurich") == ["m1:p2"] && q("naive") == ["m1:p2"] && q("resume") == ["m1:p2"] && q("αλφα") == ["m3:p1"], json!({"zurich": q("zurich"), "αλφα": q("αλφα")}));
    let sz = q("strasse");
    cases.check("semantics", "documented gap: ß is not folded to ss (straße and strasse find different records)", q("straße") == ["m3:p1"] && sz == ["m3:note"], json!({"straße": q("straße"), "strasse": sz}));
    let cjk_part = q("飛行");
    cases.check("semantics", "documented gap: unspaced CJK run is one token (no substring match)", q("飛行機") == ["m3:p1"] && cjk_part.is_empty(), json!({"full": q("飛行機"), "partial": cjk_part}));

    cases.check("bounds", "query over 256 characters refused", compile_query(&"a".repeat(257)) == Err("query_too_long"), json!(null));
    cases.check("bounds", "more than 8 terms refused", compile_query("a b c d e f g h i") == Err("too_many_terms"), json!(null));
    cases.check("bounds", "punctuation-only or empty query keeps the metadata filter only", compile_query("  ?? -- ") == Ok(Query::Empty) && compile_query("") == Ok(Query::Empty), json!(null));
    let (bulk, truncated) = cache.search(&compile_query("bulkterm").unwrap(), &current);
    cases.check("bounds", "results capped at 50 with a truncation flag", bulk.len() == MAX_RESULTS && truncated, json!({"returned": bulk.len(), "truncated": truncated}));
    let (html, _) = cache.search(&compile_query("bold").unwrap(), &current);
    let excerpt = html.first().map(|h| h.excerpt.clone()).unwrap_or_default();
    cases.check(
        "bounds",
        "excerpt is plain text: no highlight markup added, source text kept verbatim for text rendering",
        excerpt.contains("<b>bold</b>") && excerpt.chars().count() <= MAX_EXCERPT_CHARS + 1,
        json!({"excerpt": excerpt}),
    );
    let long_body = "longword ".repeat(5000);
    let mut long_cache_records = records.clone();
    long_cache_records.push(rec("m5:p1", "m5", "page", Some(1), &"e".repeat(64), "Long", &long_body));
    cache.rebuild(&long_cache_records);
    let current_long = current_of(&long_cache_records);
    let (long_hits, _) = cache.search(&compile_query("longword").unwrap(), &current_long);
    let long_excerpt = long_hits.first().map(|h| h.excerpt.chars().count()).unwrap_or(usize::MAX);
    cases.check("bounds", "excerpt length bounded on a 45 KB record", long_excerpt <= MAX_EXCERPT_CHARS + 1, json!({"excerptChars": long_excerpt}));
    cache.rebuild(&records);

    // Destinations and invalidation.
    let (hits, _) = cache.search(&compile_query("metar").unwrap(), &current);
    let dest = hits.iter().find(|h| h.record_id == "m1:p1").and_then(|h| h.destination.clone());
    cases.check("destinations", "a current page hit carries its content hash and physical page", dest == Some((a.clone(), 1)), json!(dest));
    let guide_dest = cache.search(&compile_query("bold").unwrap(), &current).0.first().map(|h| h.destination.is_none() && h.kind == "guide");
    cases.check("destinations", "guide/note hits never carry a page destination", guide_dest == Some(true), json!(null));
    let mut changed = current.clone();
    changed.insert("m1".into(), "f".repeat(64));
    let (stale, _) = cache.search(&compile_query("metar").unwrap(), &changed);
    let stale_m1 = stale.iter().find(|h| h.record_id == "m1:p1");
    cases.check("destinations", "an obsolete hash is never offered as a destination", stale_m1.map(|h| h.destination.is_none()).unwrap_or(false), json!(stale_m1.map(|h| format!("{:?}", h.destination))));
    let mut deleted = current.clone();
    deleted.remove("m1");
    cases.check("destinations", "a material missing from the library is dropped from results", cache.ids("metar", &deleted) == ["m3:note", "m3:p1"], json!(cache.ids("metar", &deleted)));

    // Index lifecycle.
    let dup: Vec<String> = cache.search(&compile_query("\"weather services\"").unwrap(), &current).0.iter().map(|h| h.material.clone()).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
    cases.check("index", "duplicate titles stay distinct by material id", dup == ["m1", "m2"], json!(dup));
    let replacement = vec![rec("m1:p1", "m1", "page", Some(1), &"9".repeat(64), "Weather Services", "uniquereplacement text")];
    let ok = cache.replace_material("m1", &replacement, || true);
    let mut after = current.clone();
    after.insert("m1".into(), "9".repeat(64));
    cases.check("index", "replacement swaps one material's records atomically", ok.is_ok() && cache.ids("uniquereplacement", &after) == ["m1:p1"] && !cache.ids("metar", &after).contains(&"m1:p1".to_string()), json!(null));
    let superseded = cache.replace_material("m1", &[rec("m1:p1", "m1", "page", Some(1), &"8".repeat(64), "W", "uniquesuperseded")], || false);
    cases.check("index", "update cancelled while pending leaves the index unchanged", superseded == Err("superseded") && cache.ids("uniquesuperseded", &after).is_empty() && cache.ids("uniquereplacement", &after) == ["m1:p1"], json!(format!("{superseded:?}")));
    // Replacement after extraction, before publication: the hash re-check inside the transaction fails.
    let library_hash = std::cell::RefCell::new("9".repeat(64));
    let extracted_for = "7".repeat(64);
    *library_hash.borrow_mut() = "6".repeat(64); // file replaced after extraction
    let refused = cache.replace_material("m1", &[rec("m1:p1", "m1", "page", Some(1), &extracted_for, "W", "uniquelateextract")], || *library_hash.borrow() == extracted_for);
    cases.check("index", "replacement after extraction but before publication is refused", refused == Err("superseded") && cache.ids("uniquelateextract", &after).is_empty(), json!(format!("{refused:?}")));
    cache.delete_material("m2");
    cases.check("index", "deletion removes a material's records", cache.ids("crosswind", &current) == ["m3:note", "m3:p1"], json!(cache.ids("crosswind", &current)));
    cache.rebuild(&records);

    // Reopen, rebuild, restore disposal.
    let before = cache.ids("metar", &current);
    drop(cache);
    let (cache, state) = Cache::open(&path, "fp-1");
    cases.check("persistence", "reopen keeps a complete cache", state == OpenState::Ready && cache.ids("metar", &current) == before, json!(format!("{state:?}")));
    drop(cache);
    fs::remove_file(&path).unwrap();
    let (mut cache, state) = Cache::open(&path, "fp-1");
    cache.rebuild(&records);
    cases.check("persistence", "deleted cache rebuilds to identical result ids", state == OpenState::NeedsRebuild("absent") && cache.ids("metar", &current) == before, json!(null));
    drop(cache);
    let (cache, state) = Cache::open(&path, "fp-restored");
    cases.check("persistence", "synthetic restore (new fingerprint) disposes the cache", state == OpenState::NeedsRebuild("fingerprint") && cache.ids("metar", &current).is_empty(), json!(format!("{state:?}")));
    drop(cache);

    // Interrupted writes, in a real child process that aborts.
    let exe = std::env::current_exe().unwrap();
    let crash_db = dir.join("crash.sqlite");
    let status = Command::new(&exe).args(["cache-crash", &crash_db.display().to_string(), "mid-rebuild"]).stderr(Stdio::null()).status().unwrap();
    let (mut cache, state) = Cache::open(&crash_db, "fp-crash");
    let crash_records = corpus(40, 9);
    cache.rebuild(&crash_records);
    let crash_current = current_of(&crash_records);
    let full_count = cache.search(&compile_query("crosswind").unwrap(), &crash_current).0.len();
    cases.check(
        "persistence",
        "process killed mid-rebuild: the unfinished cache is detected and disposed",
        !status.success() && state == OpenState::NeedsRebuild("incomplete_build") && full_count > 0,
        json!({"childExit": exit_text(status), "state": format!("{state:?}")}),
    );
    let before_ids = cache.ids("crosswind", &crash_current);
    drop(cache);
    let status = Command::new(&exe).args(["cache-crash", &crash_db.display().to_string(), "mid-update"]).stderr(Stdio::null()).status().unwrap();
    let (cache, state) = Cache::open(&crash_db, "fp-crash");
    cases.check(
        "persistence",
        "process killed mid-update: the uncommitted transaction rolls back",
        !status.success() && state == OpenState::Ready && cache.ids("crosswind", &crash_current) == before_ids && cache.ids("uniquehalfwritten", &crash_current).is_empty(),
        json!({"childExit": exit_text(status)}),
    );
    let _ = cache.path.clone();
}

// ---------------------------------------------------------------------------
// Measurements (Deliverable C); run only after the suite passes.
// ---------------------------------------------------------------------------

fn percentile(samples: &mut [f64], p: f64) -> f64 {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let rank = ((p / 100.0) * (samples.len() as f64 - 1.0)).round() as usize;
    samples[rank]
}

fn measure_extract(scratch: &Path) -> Value {
    assert!(!scratch.exists(), "measurement scratch must be new");
    fs::create_dir_all(scratch).unwrap();
    let exe = std::env::current_exe().unwrap();
    let mut sizes = Vec::new();
    for pages in [10usize, 100, 300] {
        let path = scratch.join(format!("text-{pages}.pdf"));
        fs::write(&path, text_pages(pages, pages as u64)).unwrap();
        let sha = sha_hex(&fs::read(&path).unwrap());
        let limits = Limits::proof();
        let mut runs = Vec::new();
        for _ in 0..3 {
            let start = Instant::now();
            let out = Command::new("/usr/bin/time")
                .arg("-l")
                .arg(&exe)
                .args(["worker", &path.display().to_string(), &sha, &limits.input.to_string(), &limits.page.to_string(), &limits.total.to_string(), "normal"])
                .output()
                .unwrap();
            let wall = ms(start);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let rss = stderr.lines().find(|l| l.contains("maximum resident set size")).and_then(|l| l.split_whitespace().next()).and_then(|n| n.parse::<u64>().ok());
            let checked = out.stdout.split(|b| *b == b'\n').filter(|l| !l.is_empty()).filter_map(|l| serde_json::from_slice::<Value>(l).ok()).filter(|f| f["status"] == "text").count();
            runs.push(json!({"wallMs": wall, "peakRssBytes": rss, "textPages": checked, "fileBytes": fs::metadata(&path).unwrap().len()}));
        }
        sizes.push(json!({"pages": pages, "runs": runs}));
    }

    // Spawn -> first frame on a one-page document, 15 samples.
    let tiny = scratch.join("tiny.pdf");
    fs::write(&tiny, text_pages(1, 99)).unwrap();
    let tiny_sha = sha_hex(&fs::read(&tiny).unwrap());
    let limits = Limits::proof();
    let mut first_frame = Vec::new();
    for _ in 0..15 {
        let start = Instant::now();
        let mut child = Command::new(&exe)
            .args(["worker", &tiny.display().to_string(), &tiny_sha, &limits.input.to_string(), &limits.page.to_string(), &limits.total.to_string(), "normal"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let mut byte = [0u8; 1];
        let _ = stdout.read(&mut byte);
        first_frame.push(ms(start));
        let _ = io::copy(&mut stdout, &mut io::sink());
        let _ = child.wait();
    }
    let median_first = percentile(&mut first_frame.clone(), 50.0);

    // IPC parse throughput through the same bounded reader.
    let frame = serde_json::to_string(&json!({"type": "page", "physicalPage": 1, "contentSha256": "a".repeat(64), "status": "text", "text": sentence(&mut Rng(5), 400)})).unwrap();
    let mut stream = Vec::new();
    while stream.len() < 50 * MIB {
        stream.extend_from_slice(frame.as_bytes());
        stream.push(b'\n');
    }
    let mut reader = FrameReader::new(512 * KIB, 64 * MIB);
    let mut frames = Vec::new();
    let start = Instant::now();
    for chunk in stream.chunks(64 * KIB) {
        reader.feed(chunk, &mut frames).unwrap();
    }
    let parse_ms = ms(start);
    let mb_per_s = (stream.len() as f64 / 1e6) / (parse_ms / 1000.0);

    json!({"extraction": sizes, "spawnToFirstFrameMs": first_frame, "spawnToFirstFrameMedianMs": median_first, "ipc": {"bytes": stream.len(), "frames": frames.len(), "parseMs": parse_ms, "mbPerSecond": mb_per_s}})
}

fn make_corpus(size: usize, out: &Path) {
    let records = corpus(size, 0x5eed + size as u64);
    let json: Vec<Value> = records
        .iter()
        .map(|r| json!({"id": r.id, "materialId": r.material, "kind": r.kind, "physicalPage": r.page, "contentSha256": r.sha, "title": r.title, "body": r.body}))
        .collect();
    fs::write(out, serde_json::to_vec(&json).unwrap()).unwrap();
}

fn measure_index(corpus_path: &Path, db_path: &Path) -> Value {
    assert!(!db_path.exists(), "measurement database must be new");
    let start = Instant::now();
    let raw: Vec<Value> = serde_json::from_slice(&fs::read(corpus_path).unwrap()).unwrap();
    let records: Vec<Record> = raw
        .iter()
        .map(|v| Record {
            id: v["id"].as_str().unwrap().into(),
            material: v["materialId"].as_str().unwrap().into(),
            kind: match v["kind"].as_str().unwrap() {
                "page" => "page",
                "guide" => "guide",
                _ => "note",
            },
            page: v["physicalPage"].as_u64().map(|p| p as u32),
            sha: v["contentSha256"].as_str().unwrap().into(),
            title: v["title"].as_str().unwrap().into(),
            body: v["body"].as_str().unwrap().into(),
        })
        .collect();
    let load_ms = ms(start);
    let current = current_of(&records);
    let (mut cache, _) = Cache::open(db_path, "fp-measure");
    let start = Instant::now();
    cache.rebuild(&records);
    let cold_ms = ms(start);
    let mut queries = Vec::new();
    for text in ["crosswind", "density altitude", "\"density altitude\"", "metar", "cafe", "zurich"] {
        let compiled = compile_query(text).unwrap();
        let mut samples = Vec::new();
        let mut count = 0;
        for _ in 0..15 {
            let start = Instant::now();
            let (hits, _) = cache.search(&compiled, &current);
            samples.push(ms(start));
            count = hits.len();
        }
        let p50 = percentile(&mut samples.clone(), 50.0);
        let p95 = percentile(&mut samples.clone(), 95.0);
        queries.push(json!({"query": text, "hits": count, "samplesMs": samples, "p50Ms": p50, "p95Ms": p95}));
    }
    drop(cache);
    let bytes = fs::metadata(db_path).unwrap().len();
    let start = Instant::now();
    let (cache, state) = Cache::open(db_path, "fp-measure");
    let first = cache.search(&compile_query("crosswind").unwrap(), &current).0.len();
    let reopen_ms = ms(start);
    drop(cache);
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = fs::remove_file(format!("{}{suffix}", db_path.display()));
    }
    json!({"records": records.len(), "corpusLoadMs": load_ms, "coldIndexMs": cold_ms, "queries": queries, "databaseBytes": bytes, "reopenFirstQueryMs": reopen_ms, "reopenState": format!("{state:?}"), "reopenFirstQueryHits": first})
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("worker") => std::process::exit(worker(&args[2..])),
        Some("suite") => println!("{}", serde_json::to_string_pretty(&suite(Path::new(&args[2]))).unwrap()),
        Some("cache-crash") => cache_crash(Path::new(&args[2]), &args[3]),
        Some("measure-extract") => println!("{}", serde_json::to_string_pretty(&measure_extract(Path::new(&args[2]))).unwrap()),
        Some("measure-index") => println!("{}", serde_json::to_string_pretty(&measure_index(Path::new(&args[2]), Path::new(&args[3]))).unwrap()),
        Some("make-corpus") => make_corpus(args[2].parse().unwrap(), Path::new(&args[3])),
        _ => {
            eprintln!("usage: worker | suite SCRATCH | cache-crash DB MODE | measure-extract SCRATCH | measure-index CORPUS DB | make-corpus SIZE OUT");
            std::process::exit(2);
        }
    }
}
