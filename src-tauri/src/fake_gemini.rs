//! A loopback stand-in for the parts of the Gemini API this application uses
//! (GEN-REL-01 tests only): resumable upload, files.get, files.delete and
//! generateContent. It records every request byte for byte, so tests can
//! count uploads and prove what was (and was not) sent. It answers with
//! synthetic content only and never reaches the network.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// One request as it arrived.
#[derive(Clone, Debug)]
pub(crate) struct Recorded {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    pub fn is_upload_start(&self) -> bool {
        self.method == "POST" && self.path == "/upload/v1beta/files"
    }
    pub fn is_upload_finalize(&self) -> bool {
        self.method == "POST"
            && self.path.starts_with("/upload/v1beta/files?upload_id=")
            && self
                .header("x-goog-upload-command")
                .is_some_and(|c| c.contains("finalize"))
    }
    pub fn is_generate(&self) -> bool {
        self.method == "POST" && self.path.ends_with(":generateContent")
    }
    pub fn is_lookup(&self) -> bool {
        self.method == "GET" && self.path.starts_with("/v1beta/files/")
    }
    pub fn is_delete(&self) -> bool {
        self.method == "DELETE" && self.path.starts_with("/v1beta/files/")
    }
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

/// A gate a request waits at until the test opens it.
#[derive(Default)]
pub(crate) struct Gate {
    state: Mutex<(bool, u32)>,
    cv: Condvar,
}

impl Gate {
    pub fn open(&self) {
        self.state.lock().unwrap().0 = true;
        self.cv.notify_all();
    }
    /// How many requests are waiting here now.
    pub fn waiting(&self) -> u32 {
        self.state.lock().unwrap().1
    }
    fn pass(&self) {
        let mut s = self.state.lock().unwrap();
        s.1 += 1;
        while !s.0 {
            s = self.cv.wait(s).unwrap();
        }
        s.1 -= 1;
    }
}

#[derive(Clone)]
struct SimFile {
    state: &'static str,
    /// Lookups that still answer PROCESSING before ACTIVE (None: forever).
    polls_until_active: Option<u32>,
    deleted: bool,
}

/// What the stand-in does; tests change these between calls.
pub(crate) struct Behaviour {
    /// Pace reads of the upload+finalize body (not upload metadata).
    pub upload_bytes_per_sec: Option<u64>,
    /// Model thinking time, before even the response headers arrive.
    pub generate_first_byte_delay: Option<Duration>,
    /// Pace response body writes after sending headers immediately.
    pub generate_trickle_bytes_per_sec: Option<u64>,
    pub start_status: Option<u16>,
    pub omit_upload_url: bool,
    pub foreign_upload_url: bool,
    /// Close the connection instead of answering the finalize request.
    pub drop_finalize: bool,
    pub finalize_status: Option<u16>,
    /// Answer finalize with a URI on another host.
    pub foreign_file_uri: bool,
    pub initial_state: &'static str,
    pub polls_until_active: Option<u32>,
    pub expiration_time: Option<String>,
    pub lookup_status: Option<u16>,
    /// Interrupt files.get before response headers (loopback transport fault).
    pub drop_lookups: bool,
    /// Statuses for the next generateContent calls, then normal answers.
    pub generate_statuses: Vec<(u16, String)>,
    pub generate_retry_after: Option<String>,
    pub drop_generations: u32,
    pub partial_generations: u32,
    pub generate_body_gate: Option<Arc<Gate>>,
    pub generate_answer: Option<String>,
    pub generate_answers: Vec<String>,
    /// A 200 generateContent body that is not a usable answer.
    pub garbage_answer: bool,
    /// Refuse generation with 400 when the referred file is deleted.
    pub enforce_files: bool,
    pub finalize_gate: Option<Arc<Gate>>,
    /// Lookups wait here until the test opens it.
    pub lookup_gate: Option<Arc<Gate>>,
    /// Deletes wait here until the test opens it.
    pub delete_gate: Option<Arc<Gate>>,
    /// generateContent requests wait here until the test opens it.
    pub generate_gate: Option<Arc<Gate>>,
    /// For the next lookups, in order: `Some(status)` refuses with that
    /// status, `None` answers normally. Then normal answers.
    pub lookup_script: Vec<Option<u16>>,
    /// Answer finalize with a 307 to this absolute URL.
    pub finalize_redirect: Option<String>,
    /// Answer generateContent with a 307 to this absolute URL.
    pub generate_redirect: Option<String>,
}

impl Default for Behaviour {
    fn default() -> Self {
        Behaviour {
            upload_bytes_per_sec: None,
            generate_first_byte_delay: None,
            generate_trickle_bytes_per_sec: None,
            start_status: None,
            omit_upload_url: false,
            foreign_upload_url: false,
            drop_finalize: false,
            finalize_status: None,
            foreign_file_uri: false,
            initial_state: "ACTIVE",
            polls_until_active: None,
            expiration_time: Some("2099-01-01T00:00:00Z".to_string()),
            lookup_status: None,
            drop_lookups: false,
            generate_statuses: Vec::new(),
            generate_retry_after: None,
            drop_generations: 0,
            partial_generations: 0,
            generate_body_gate: None,
            generate_answer: None,
            generate_answers: vec![],
            garbage_answer: false,
            enforce_files: true,
            finalize_gate: None,
            lookup_gate: None,
            delete_gate: None,
            generate_gate: None,
            lookup_script: Vec::new(),
            finalize_redirect: None,
            generate_redirect: None,
        }
    }
}

struct Sim {
    log: Vec<Recorded>,
    files: HashMap<String, SimFile>,
    next_id: u32,
    behaviour: Behaviour,
}

pub(crate) struct FakeGemini {
    pub base: String,
    sim: Arc<Mutex<Sim>>,
}

const STUDY_AID: &str = r#"{"title":"Synthetic airspace","summary":"A synthetic summary.","sections":[{"heading":"Class B","body":"Synthetic body."}],"flashcards":[{"front":"Q","back":"A","sourcePage":1,"quote":"Synthetic body."}],"sourceNotes":"Synthetic notes."}"#;
const PRACTICE_TEST: &str = r#"{"title":"Synthetic quiz","questions":[{"question":"Q?","options":["A","B","C"],"correctIndex":1,"explanation":"Because.","sourcePage":2,"quote":"Synthetic body."}]}"#;

impl FakeGemini {
    pub fn start() -> FakeGemini {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let sim = Arc::new(Mutex::new(Sim {
            log: Vec::new(),
            files: HashMap::new(),
            next_id: 0,
            behaviour: Behaviour::default(),
        }));
        let shared = sim.clone();
        let base_for = base.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let sim = shared.clone();
                let base = base_for.clone();
                std::thread::spawn(move || serve(stream, &sim, &base));
            }
        });
        FakeGemini { base, sim }
    }

    pub fn behave(&self, f: impl FnOnce(&mut Behaviour)) {
        f(&mut self.sim.lock().unwrap().behaviour);
    }

    pub fn log(&self) -> Vec<Recorded> {
        self.sim.lock().unwrap().log.clone()
    }

    pub fn count(&self, f: impl Fn(&Recorded) -> bool) -> usize {
        self.log().iter().filter(|r| f(r)).count()
    }

    /// Delete a file on the provider side, as expiry or another tool would.
    pub fn vanish(&self, name: &str) {
        if let Some(f) = self.sim.lock().unwrap().files.get_mut(name) {
            f.deleted = true;
        }
    }

    /// Put an existing file back into `state` (for example `PROCESSING`).
    pub fn set_state(&self, name: &str, state: &'static str) {
        if let Some(f) = self.sim.lock().unwrap().files.get_mut(name) {
            f.state = state;
            f.polls_until_active = None;
        }
    }

    pub fn exists(&self, name: &str) -> bool {
        self.sim
            .lock()
            .unwrap()
            .files
            .get(name)
            .is_some_and(|f| !f.deleted)
    }
}

fn read_request(reader: &mut BufReader<TcpStream>, sim: &Mutex<Sim>) -> Option<Recorded> {
    let mut line = String::new();
    if reader.read_line(&mut line).ok()? == 0 {
        return None;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = Vec::new();
    let mut length = 0usize;
    loop {
        let mut h = String::new();
        reader.read_line(&mut h).ok()?;
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            let (k, v) = (k.trim().to_string(), v.trim().to_string());
            if k.eq_ignore_ascii_case("content-length") {
                length = v.parse().ok()?;
            }
            headers.push((k, v));
        }
    }
    let mut body = vec![0; length];
    let rate = if method == "POST" && path.starts_with("/upload/v1beta/files?upload_id=") {
        sim.lock().unwrap().behaviour.upload_bytes_per_sec
    } else {
        None
    };
    if let Some(rate) = rate.filter(|rate| *rate > 0) {
        let started = Instant::now();
        let mut received = 0;
        for chunk in body.chunks_mut(pacing_chunk(rate)) {
            reader.read_exact(chunk).ok()?;
            received += chunk.len();
            pace(started, received, rate);
        }
    } else {
        reader.read_exact(&mut body).ok()?;
    }
    Some(Recorded {
        method,
        path,
        headers,
        body,
    })
}

fn write_reply(stream: &mut TcpStream, status: u16, headers: &[(String, String)], body: &[u8]) {
    write_paced_reply(stream, status, headers, body, None);
}

// About twenty chunks per second, bounded for both tiny and large fixtures.
fn pacing_chunk(rate: u64) -> usize {
    (rate / 20).clamp(1, 16 * 1024) as usize
}

fn pace(started: Instant, bytes: usize, rate: u64) {
    let due = Duration::from_secs_f64(bytes as f64 / rate as f64);
    std::thread::sleep(due.saturating_sub(started.elapsed()));
}

fn write_paced_reply(
    stream: &mut TcpStream,
    status: u16,
    headers: &[(String, String)],
    body: &[u8],
    rate: Option<u64>,
) {
    let mut head = format!(
        "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nContent-Type: application/json\r\n",
        body.len()
    );
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    if let Some(rate) = rate.filter(|rate| *rate > 0) {
        let _ = stream.flush();
        let started = Instant::now();
        let mut sent = 0;
        for chunk in body.chunks(pacing_chunk(rate)) {
            // Headers arrive immediately; body bytes follow at the chosen rate.
            sent += chunk.len();
            pace(started, sent, rate);
            if stream.write_all(chunk).is_err() || stream.flush().is_err() {
                return;
            }
        }
    } else {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}

enum Reply {
    Send(u16, Vec<(String, String)>, Vec<u8>),
    Drop,
    Partial,
    HeldBody(Arc<Gate>, Vec<u8>),
}

fn serve(stream: TcpStream, sim: &Arc<Mutex<Sim>>, base: &str) {
    let mut writer = stream.try_clone().unwrap();
    let mut reader = BufReader::new(stream);
    while let Some(request) = read_request(&mut reader, sim) {
        let gate = {
            let mut s = sim.lock().unwrap();
            s.log.push(request.clone());
            if request.is_upload_finalize() {
                s.behaviour.finalize_gate.clone()
            } else if request.is_lookup() {
                s.behaviour.lookup_gate.clone()
            } else if request.is_delete() {
                s.behaviour.delete_gate.clone()
            } else if request.is_generate() {
                s.behaviour.generate_gate.clone()
            } else {
                None
            }
        };
        if let Some(gate) = gate {
            gate.pass();
        }
        match respond(&request, sim, base) {
            Reply::Send(status, headers, body) => {
                if request.is_generate() {
                    let (delay, rate) = {
                        let s = sim.lock().unwrap();
                        (
                            s.behaviour.generate_first_byte_delay,
                            s.behaviour.generate_trickle_bytes_per_sec,
                        )
                    };
                    // Never hold Sim's lock during a delay: logs and other
                    // requests must remain observable while this link is slow.
                    if let Some(delay) = delay {
                        std::thread::sleep(delay);
                    }
                    write_paced_reply(&mut writer, status, &headers, &body, rate);
                } else {
                    write_reply(&mut writer, status, &headers, &body);
                }
            }
            Reply::Partial => {
                let _ = writer.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n{\"candidates\":",
                );
                let _ = writer.shutdown(std::net::Shutdown::Both);
                return;
            }
            Reply::HeldBody(gate, body) => {
                let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len());
                let _ = writer.write_all(head.as_bytes());
                let _ = writer.flush();
                gate.pass();
                let _ = writer.write_all(&body);
            }
            Reply::Drop => {
                let _ = writer.shutdown(std::net::Shutdown::Both);
                return;
            }
        }
    }
}

fn file_json(base: &str, name: &str, state: &str, expiration: &Option<String>) -> Value {
    let mut file = json!({
        "name": name,
        "uri": format!("{base}/v1beta/{name}"),
        "mimeType": "application/pdf",
        "state": state,
    });
    if let Some(e) = expiration {
        file["expirationTime"] = json!(e);
    }
    file
}

fn respond(request: &Recorded, sim: &Arc<Mutex<Sim>>, base: &str) -> Reply {
    let mut s = sim.lock().unwrap();
    let ok = |v: Value| Reply::Send(200, vec![], v.to_string().into_bytes());
    let err = |status: u16| {
        Reply::Send(
            status,
            vec![],
            json!({"error": {"code": status, "message": "synthetic"}})
                .to_string()
                .into_bytes(),
        )
    };
    if request.is_upload_start() {
        if let Some(status) = s.behaviour.start_status {
            return err(status);
        }
        s.next_id += 1;
        let id = s.next_id;
        if s.behaviour.omit_upload_url {
            return ok(json!({}));
        }
        let url = if s.behaviour.foreign_upload_url {
            format!("http://elsewhere.invalid/upload/v1beta/files?upload_id=u{id}")
        } else {
            format!("{base}/upload/v1beta/files?upload_id=u{id}")
        };
        return Reply::Send(
            200,
            vec![("X-Goog-Upload-URL".to_string(), url)],
            b"{}".to_vec(),
        );
    }
    let redirect = |to: &String| {
        Reply::Send(
            307,
            vec![("Location".to_string(), to.clone())],
            b"{}".to_vec(),
        )
    };
    if request.is_upload_finalize() {
        if let Some(to) = &s.behaviour.finalize_redirect {
            return redirect(to);
        }
        if s.behaviour.drop_finalize {
            return Reply::Drop;
        }
        if let Some(status) = s.behaviour.finalize_status {
            return err(status);
        }
        let id = request
            .path
            .rsplit('=')
            .next()
            .unwrap_or("u0")
            .trim_start_matches('u')
            .to_string();
        let name = format!("files/synthetic-{id}");
        let state = s.behaviour.initial_state;
        let polls = s.behaviour.polls_until_active;
        s.files.insert(
            name.clone(),
            SimFile {
                state,
                polls_until_active: polls,
                deleted: false,
            },
        );
        let mut file = file_json(base, &name, state, &s.behaviour.expiration_time);
        if s.behaviour.foreign_file_uri {
            file["uri"] = json!(format!("https://elsewhere.invalid/v1beta/{name}"));
        }
        return ok(json!({ "file": file }));
    }
    if request.is_lookup() {
        if s.behaviour.drop_lookups {
            return Reply::Drop;
        }
        if let Some(status) = s.behaviour.lookup_status {
            return err(status);
        }
        if !s.behaviour.lookup_script.is_empty() {
            if let Some(status) = s.behaviour.lookup_script.remove(0) {
                return err(status);
            }
        }
        let name = request.path.trim_start_matches("/v1beta/").to_string();
        let expiration = s.behaviour.expiration_time.clone();
        let Some(file) = s.files.get_mut(&name) else {
            return err(404);
        };
        if file.deleted {
            return err(404);
        }
        if file.state == "PROCESSING" {
            match file.polls_until_active.as_mut() {
                Some(0) => file.state = "ACTIVE",
                Some(n) => *n -= 1,
                None => {}
            }
        }
        let state = file.state;
        return ok(file_json(base, &name, state, &expiration));
    }
    if request.is_delete() {
        let name = request.path.trim_start_matches("/v1beta/").to_string();
        return match s.files.get_mut(&name) {
            Some(f) if !f.deleted => {
                f.deleted = true;
                ok(json!({}))
            }
            _ => err(404),
        };
    }
    if request.is_generate() {
        if s.behaviour.drop_generations > 0 {
            s.behaviour.drop_generations -= 1;
            return Reply::Drop;
        }
        if s.behaviour.partial_generations > 0 {
            s.behaviour.partial_generations -= 1;
            return Reply::Partial;
        }
        if let Some(gate) = &s.behaviour.generate_body_gate {
            return Reply::HeldBody(gate.clone(), b"{}".to_vec());
        }
        if let Some(answer) = &s.behaviour.generate_answer {
            return Reply::Send(200, vec![], answer.as_bytes().to_vec());
        }
        if let Some(to) = &s.behaviour.generate_redirect {
            return redirect(to);
        }
        if !s.behaviour.generate_statuses.is_empty() {
            let (status, body) = s.behaviour.generate_statuses.remove(0);
            let headers = s
                .behaviour
                .generate_retry_after
                .clone()
                .map(|v| vec![("Retry-After".to_string(), v)])
                .unwrap_or_default();
            return Reply::Send(status, headers, body.into_bytes());
        }
        if !s.behaviour.generate_answers.is_empty() {
            let answer = s.behaviour.generate_answers.remove(0);
            return Reply::Send(200, vec![], answer.into_bytes());
        }
        let body = request.json();
        if s.behaviour.enforce_files {
            if let Some(uri) = body
                .pointer("/contents/0/parts/1/file_data/file_uri")
                .and_then(Value::as_str)
            {
                let name = uri.rsplit("/v1beta/").next().unwrap_or("").to_string();
                let usable = s
                    .files
                    .get(&name)
                    .is_some_and(|f| !f.deleted && f.state == "ACTIVE");
                if !usable {
                    return Reply::Send(400, vec![], json!({"error": {"code": 400, "message": "synthetic: file not found or not active"}}).to_string().into_bytes());
                }
            }
        }
        if s.behaviour.garbage_answer {
            return ok(json!({"candidates": []}));
        }
        let prompt = body
            .pointer("/contents/0/parts/0/text")
            .and_then(Value::as_str)
            .unwrap_or("");
        let text = if prompt.contains("practice test") {
            PRACTICE_TEST
        } else {
            STUDY_AID
        };
        return ok(json!({"candidates": [{"content": {"parts": [{"text": text}]}}]}));
    }
    err(404)
}
