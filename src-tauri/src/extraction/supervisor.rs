//! Runs one extraction worker and decides what its result means (OFFLINE-01
//! proposal §4.1–§4.2). A result is accepted only after the child has exited
//! successfully, both pipes have reached end of file and the frames formed a
//! complete, valid sequence. A memory breach is reported only when the
//! worker's static marker arrived; any other abnormal end is a plain failure.

use super::alloc::BREACH_MARKER;
use super::inspect::Outcome;
use super::worker::{Limits, WORKER_FLAG};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const MAX_FRAME_BYTES: usize = 512 * 1024;
pub const MAX_STREAM_BYTES: usize = 32 * 1024 * 1024;
const KEPT_STDERR_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageResult {
    pub index: u32,
    pub outcome: Outcome,
    pub text: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Extraction {
    pub sha256: String,
    pub pages: Vec<PageResult>,
}

/// Why a run produced no result. Codes are plain and carry no path or text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// The worker reported a handled problem (for example `encrypted`).
    Reported(String),
    /// The worker's memory-limit marker arrived.
    MemoryLimit,
    Timeout,
    Cancelled,
    /// Anything else: a crash, an unexpected exit or a broken protocol.
    WorkerFailed(&'static str),
}

impl Failure {
    pub fn code(&self) -> String {
        match self {
            Failure::Reported(code) => code.clone(),
            Failure::MemoryLimit => "memory_limit".into(),
            Failure::Timeout => "timeout".into(),
            Failure::Cancelled => "cancelled".into(),
            Failure::WorkerFailed(why) => format!("worker_failed:{why}"),
        }
    }
}

pub struct Job<'a> {
    pub worker: &'a Path,
    pub file: &'a Path,
    pub sha256: &'a str,
    pub limits: Limits,
    pub deadline: Duration,
    pub cancel: Arc<AtomicBool>,
    /// Extra request fields (fault injection) for tests.
    pub extra: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Wire {
    Start {
        sha256: String,
        pages: u32,
    },
    Page {
        index: u32,
        outcome: Outcome,
        text: String,
        #[serde(default)]
        error: Option<String>,
    },
    Error {
        code: String,
    },
    End,
}

/// Frames read from stdout, validated in order.
#[derive(Default)]
struct Protocol {
    sha256: Option<String>,
    expected: u32,
    pages: Vec<PageResult>,
    error: Option<String>,
    ended: bool,
    broken: Option<&'static str>,
}

impl Protocol {
    fn take(&mut self, frame: Wire, want_sha: &str) {
        if self.broken.is_some() || self.ended || self.error.is_some() {
            self.broken.get_or_insert("frame_after_terminal");
            return;
        }
        match frame {
            Wire::Start { sha256, pages } => {
                if self.sha256.is_some() || sha256 != want_sha || pages == 0 {
                    self.broken = Some("bad_start");
                } else {
                    self.sha256 = Some(sha256);
                    self.expected = pages;
                }
            }
            Wire::Page {
                index,
                outcome,
                text,
                error,
            } => {
                let next = self.pages.len() as u32 + 1;
                if self.sha256.is_none() || index != next || index > self.expected {
                    self.broken = Some("bad_page");
                } else if outcome != Outcome::Text && !text.is_empty() {
                    self.broken = Some("text_without_text_outcome");
                } else {
                    self.pages.push(PageResult {
                        index,
                        outcome,
                        text,
                        error,
                    });
                }
            }
            Wire::Error { code } => self.error = Some(code),
            Wire::End => {
                if self.sha256.is_none() || self.pages.len() as u32 != self.expected {
                    self.broken = Some("incomplete");
                } else {
                    self.ended = true;
                }
            }
        }
    }
}

/// Read NDJSON frames with a per-line and a whole-stream bound. Anything
/// malformed or oversized marks the protocol broken; reading continues to EOF
/// so the child is never blocked on a full pipe.
fn read_frames(stdout: impl Read, want_sha: String, tx: mpsc::Sender<Protocol>) {
    let mut reader = BufReader::new(stdout);
    let mut protocol = Protocol::default();
    let mut total = 0usize;
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = (&mut reader)
            .take(MAX_FRAME_BYTES as u64 + 1)
            .read_until(b'\n', &mut line);
        let n = match read {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => {
                protocol.broken.get_or_insert("read_error");
                break;
            }
        };
        total += n;
        if total > MAX_STREAM_BYTES {
            protocol.broken.get_or_insert("stream_too_large");
            drain(&mut reader);
            break;
        }
        if line.last() != Some(&b'\n') {
            let reason = if n > MAX_FRAME_BYTES {
                "frame_too_large"
            } else {
                "partial_frame"
            };
            protocol.broken.get_or_insert(reason);
            drain(&mut reader);
            break;
        }
        match serde_json::from_slice::<Wire>(&line[..line.len() - 1]) {
            Ok(frame) => protocol.take(frame, &want_sha),
            Err(_) => {
                protocol.broken.get_or_insert("malformed_frame");
            }
        }
    }
    let _ = tx.send(protocol);
}

fn drain(reader: &mut impl Read) {
    let mut sink = [0u8; 8192];
    while matches!(reader.read(&mut sink), Ok(n) if n > 0) {}
}

/// Keep the first few KiB of stderr and discard the rest until EOF.
fn read_stderr(mut stderr: impl Read, tx: mpsc::Sender<Vec<u8>>) {
    let mut kept = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match stderr.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let room = KEPT_STDERR_BYTES.saturating_sub(kept.len());
                kept.extend_from_slice(&buf[..n.min(room)]);
            }
        }
    }
    let _ = tx.send(kept);
}

pub fn run(job: Job<'_>) -> Result<Extraction, Failure> {
    let want_sha = job.sha256.to_ascii_lowercase();
    let mut request = serde_json::json!({
        "path": job.file.to_string_lossy(),
        "sha256": want_sha,
        "limits": {
            "inputBytes": job.limits.input_bytes,
            "pageTextBytes": job.limits.page_text_bytes,
            "totalTextBytes": job.limits.total_text_bytes,
            "memoryBytes": job.limits.memory_bytes,
        },
    });
    if let (Some(extra), Some(map)) = (job.extra, request.as_object_mut()) {
        if let Some(extra) = extra.as_object() {
            map.extend(extra.clone());
        }
    }
    let mut child = Command::new(job.worker)
        .arg(WORKER_FLAG)
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| Failure::WorkerFailed("spawn"))?;

    let (out_tx, out_rx) = mpsc::channel();
    let (err_tx, err_rx) = mpsc::channel();
    let stdout = child.stdout.take().ok_or(Failure::WorkerFailed("spawn"))?;
    let stderr = child.stderr.take().ok_or(Failure::WorkerFailed("spawn"))?;
    let readers = [
        std::thread::spawn(move || read_frames(stdout, want_sha, out_tx)),
        std::thread::spawn(move || read_stderr(stderr, err_tx)),
    ];
    if let Some(mut stdin) = child.stdin.take() {
        // A worker that exits early closes its stdin; that is not our failure.
        let _ = stdin.write_all(request.to_string().as_bytes());
    }

    let started = Instant::now();
    let mut stopped = None;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {}
            Err(_) => break None,
        }
        if job.cancel.load(Ordering::Acquire) {
            stopped = Some(Failure::Cancelled);
        } else if started.elapsed() >= job.deadline {
            stopped = Some(Failure::Timeout);
        }
        if stopped.is_some() {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    for reader in readers {
        let _ = reader.join();
    }
    let protocol = out_rx.recv().unwrap_or_default();
    let stderr = err_rx.recv().unwrap_or_default();

    if stderr.starts_with(BREACH_MARKER) {
        return Err(Failure::MemoryLimit);
    }
    if let Some(stop) = stopped {
        return Err(stop);
    }
    let Some(status) = status else {
        return Err(Failure::WorkerFailed("wait"));
    };
    if let Some(why) = protocol.broken {
        return Err(Failure::WorkerFailed(why));
    }
    if let Some(code) = protocol.error {
        return if status.code() == Some(super::worker::EXIT_REPORTED) {
            Err(Failure::Reported(code))
        } else {
            Err(Failure::WorkerFailed("exit"))
        };
    }
    if !status.success() || !protocol.ended {
        return Err(Failure::WorkerFailed("exit"));
    }
    Ok(Extraction {
        sha256: protocol.sha256.unwrap_or_default(),
        pages: protocol.pages,
    })
}
