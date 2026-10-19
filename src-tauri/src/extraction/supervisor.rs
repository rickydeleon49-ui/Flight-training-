//! Runs one extraction worker and decides what its result means (OFFLINE-01
//! proposal §4.1–§4.2). A result is accepted only after the child exited
//! successfully, **both** pipes were read to a confirmed end of file, and the
//! frames formed a complete, valid sequence. A memory breach is reported only
//! when the worker's static marker arrived on a stderr that was read to its
//! end; any other abnormal end is a plain failure.

use super::alloc::BREACH_MARKER;
use super::inspect::Outcome;
use super::worker::{Limits, EXIT_REPORTED, WORKER_FLAG};
use serde::Deserialize;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// The worker's counted peak of requested allocation bytes.
    pub peak_bytes: u64,
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
    /// Anything else: a crash, an unexpected exit, a broken protocol or a
    /// pipe that could not be read to its end.
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
    Verified {
        sha256: String,
    },
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
    #[serde(rename_all = "camelCase")]
    End {
        peak_bytes: u64,
    },
}

/// Frames read from stdout, validated in order.
#[derive(Default, Debug)]
pub struct Protocol {
    /// The worker confirmed the bytes it read have the requested hash.
    verified: bool,
    sha256: Option<String>,
    expected: u32,
    pages: Vec<PageResult>,
    error: Option<String>,
    peak_bytes: Option<u64>,
    broken: Option<&'static str>,
}

impl Protocol {
    fn take(&mut self, frame: Wire, want_sha: &str) {
        if self.broken.is_some() {
            return;
        }
        if self.peak_bytes.is_some() || self.error.is_some() {
            self.broken = Some("frame_after_terminal");
            return;
        }
        match frame {
            Wire::Verified { sha256 } => {
                if self.verified || self.sha256.is_some() || sha256 != want_sha {
                    self.broken = Some("bad_verified");
                } else {
                    self.verified = true;
                }
            }
            Wire::Start { sha256, pages } => {
                if !self.verified || self.sha256.is_some() || sha256 != want_sha || pages == 0 {
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
            Wire::End { peak_bytes } => {
                if self.sha256.is_none() || self.pages.len() as u32 != self.expected {
                    self.broken = Some("incomplete");
                } else {
                    self.peak_bytes = Some(peak_bytes);
                }
            }
        }
    }
}

/// Read NDJSON frames to a confirmed end of file, with a per-line and a
/// whole-stream bound. Malformed or oversized input marks the protocol
/// broken but reading continues to EOF so the child never blocks. A read
/// error other than an interruption is an error, not an end.
pub fn read_frames(stdout: impl Read, want_sha: &str) -> Result<Protocol, &'static str> {
    let mut reader = BufReader::new(stdout);
    let mut protocol = Protocol::default();
    let mut total = 0usize;
    let mut line = Vec::new();
    loop {
        line.clear();
        // `read_until` already retries interrupted reads.
        let n = (&mut reader)
            .take(MAX_FRAME_BYTES as u64 + 1)
            .read_until(b'\n', &mut line)
            .map_err(|_| "stdout_read")?;
        if n == 0 {
            return Ok(protocol);
        }
        total += n;
        if total > MAX_STREAM_BYTES {
            protocol.broken.get_or_insert("stream_too_large");
            drain(&mut reader)?;
            return Ok(protocol);
        }
        if line.last() != Some(&b'\n') {
            let reason = if n > MAX_FRAME_BYTES {
                "frame_too_large"
            } else {
                "partial_frame"
            };
            protocol.broken.get_or_insert(reason);
            drain(&mut reader)?;
            return Ok(protocol);
        }
        match serde_json::from_slice::<Wire>(&line[..line.len() - 1]) {
            Ok(frame) => protocol.take(frame, want_sha),
            Err(_) => {
                protocol.broken.get_or_insert("malformed_frame");
            }
        }
    }
}

fn drain(reader: &mut impl Read) -> Result<(), &'static str> {
    let mut sink = [0u8; 8192];
    loop {
        match reader.read(&mut sink) {
            Ok(0) => return Ok(()),
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            Err(_) => return Err("stdout_read"),
        }
    }
}

/// Keep the first few KiB of stderr and read the rest to a confirmed end.
pub fn read_stderr(mut stderr: impl Read) -> Result<Vec<u8>, &'static str> {
    let mut kept = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match stderr.read(&mut buf) {
            Ok(0) => return Ok(kept),
            Ok(n) => {
                let room = KEPT_STDERR_BYTES.saturating_sub(kept.len());
                kept.extend_from_slice(&buf[..n.min(room)]);
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            Err(_) => return Err("stderr_read"),
        }
    }
}

/// How the child ended, as far as classification needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ending {
    Exited {
        success: bool,
        code: Option<i32>,
    },
    /// Stopped by us (deadline or cancellation) and reaped.
    Stopped,
    /// We could not learn how it ended.
    Unknown,
}

/// Decide a run's result. Order matters: **both** pipes must have been read
/// to a confirmed end first (otherwise nothing else is trustworthy); then
/// the breach marker; then our own stop reason; then the protocol; then the
/// exit status.
pub fn classify(
    ending: Ending,
    stopped: Option<Failure>,
    frames: Result<Protocol, &'static str>,
    stderr: Result<Vec<u8>, &'static str>,
) -> Result<Extraction, Failure> {
    let protocol = frames.map_err(Failure::WorkerFailed)?;
    let stderr = stderr.map_err(Failure::WorkerFailed)?;
    if stderr.starts_with(BREACH_MARKER) {
        return Err(Failure::MemoryLimit);
    }
    if let Some(stop) = stopped {
        return Err(stop);
    }
    let Ending::Exited { success, code } = ending else {
        return Err(Failure::WorkerFailed("wait"));
    };
    if let Some(why) = protocol.broken {
        return Err(Failure::WorkerFailed(why));
    }
    if let Some(error) = protocol.error {
        return if code == Some(EXIT_REPORTED) {
            Err(Failure::Reported(error))
        } else {
            Err(Failure::WorkerFailed("exit"))
        };
    }
    match (success, protocol.peak_bytes, protocol.sha256) {
        (true, Some(peak_bytes), Some(sha256)) => Ok(Extraction {
            sha256,
            pages: protocol.pages,
            peak_bytes,
        }),
        _ => Err(Failure::WorkerFailed("exit")),
    }
}

/// A finished run: its result, and whether the worker confirmed that the
/// bytes it read had the requested hash. Only a failure after that
/// confirmation can be attributed to those bytes.
pub struct Finished {
    pub result: Result<Extraction, Failure>,
    pub identity_verified: bool,
}

pub fn run(job: Job<'_>) -> Result<Extraction, Failure> {
    run_detailed(job).result
}

pub fn run_detailed(job: Job<'_>) -> Finished {
    match run_inner(job) {
        Ok(finished) => finished,
        Err(failure) => Finished {
            result: Err(failure),
            identity_verified: false,
        },
    }
}

fn run_inner(job: Job<'_>) -> Result<Finished, Failure> {
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

    let stdout = child.stdout.take().ok_or(Failure::WorkerFailed("spawn"))?;
    let stderr = child.stderr.take().ok_or(Failure::WorkerFailed("spawn"))?;
    let sha_for_reader = want_sha.clone();
    let out_reader = std::thread::spawn(move || read_frames(stdout, &sha_for_reader));
    let err_reader = std::thread::spawn(move || read_stderr(stderr));
    if let Some(mut stdin) = child.stdin.take() {
        // A worker that exits early closes its stdin; that is not our failure.
        let _ = stdin.write_all(request.to_string().as_bytes());
    }

    let started = Instant::now();
    let mut stopped = None;
    let ending = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                break Ending::Exited {
                    success: status.success(),
                    code: status.code(),
                }
            }
            Ok(None) => {}
            Err(_) => break Ending::Unknown,
        }
        if job.cancel.load(Ordering::Acquire) {
            stopped = Some(Failure::Cancelled);
        } else if started.elapsed() >= job.deadline {
            stopped = Some(Failure::Timeout);
        }
        if stopped.is_some() {
            let _ = child.kill();
            let _ = child.wait();
            break Ending::Stopped;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    // A panicking reader is a failure, never an empty result.
    let frames = out_reader.join().unwrap_or(Err("reader_panic"));
    let stderr = err_reader.join().unwrap_or(Err("reader_panic"));
    let identity_verified = matches!(&frames, Ok(p) if p.verified);
    Ok(Finished {
        result: classify(ending, stopped, frames, stderr),
        identity_verified,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn frames(lines: &[&str]) -> Result<Protocol, &'static str> {
        let mut text = lines.join("\n");
        text.push('\n');
        read_frames(Cursor::new(text.into_bytes()), SHA)
    }

    fn verified() -> String {
        format!(r#"{{"type":"verified","sha256":"{SHA}"}}"#)
    }
    fn start() -> String {
        format!(
            r#"{{"type":"verified","sha256":"{SHA}"}}
{{"type":"start","sha256":"{SHA}","pages":2}}"#
        )
    }
    const P1: &str = r#"{"type":"page","index":1,"outcome":"text","text":"metar"}"#;
    const P2: &str = r#"{"type":"page","index":2,"outcome":"blank","text":""}"#;
    const END: &str = r#"{"type":"end","peakBytes":4096}"#;
    const OK: Ending = Ending::Exited {
        success: true,
        code: Some(0),
    };

    fn result(lines: &[&str]) -> Result<Extraction, Failure> {
        classify(OK, None, frames(lines), Ok(Vec::new()))
    }

    #[test]
    fn a_complete_sequence_with_clean_exit_succeeds() {
        let out = result(&[&start(), P1, P2, END]).unwrap();
        assert_eq!(out.pages.len(), 2);
        assert_eq!(out.peak_bytes, 4096);
    }

    #[test]
    fn adversarial_frame_sequences_never_succeed() {
        let s = start();
        let wrong_sha = r#"{"type":"start","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","pages":2}"#;
        let skipped = r#"{"type":"page","index":3,"outcome":"blank","text":""}"#;
        let hidden_text = r#"{"type":"page","index":2,"outcome":"image_only","text":"sneaky"}"#;
        let unknown = r#"{"type":"page","index":2,"outcome":"blank","text":"","bonus":1}"#;
        for (name, lines) in [
            ("page before start", vec![P1, &s, P2, END]),
            ("duplicate start", vec![&s, &s, P1, P2, END]),
            ("wrong hash", vec![wrong_sha, P1, P2, END]),
            ("out of order", vec![&s, P2, P1, END]),
            ("skipped page", vec![&s, P1, skipped, END]),
            ("duplicate page", vec![&s, P1, P1, END]),
            ("end too early", vec![&s, P1, END]),
            ("frame after end", vec![&s, P1, P2, END, P2]),
            ("text on a non-text page", vec![&s, P1, hidden_text, END]),
            ("unknown field", vec![&s, P1, unknown, END]),
            ("no end", vec![&s, P1, P2]),
            ("not json", vec![&s, P1, "{oops", END]),
        ] {
            assert!(result(&lines).is_err(), "{name} must not succeed");
        }
        let bare_start = format!(r#"{{"type":"start","sha256":"{SHA}","pages":2}}"#);
        let v = verified();
        let wrong_verified = r#"{"type":"verified","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#;
        for (name, lines) in [
            (
                "start without verified",
                vec![bare_start.as_str(), P1, P2, END],
            ),
            ("verified twice", vec![&v, &s, P1, P2, END]),
            (
                "verified with the wrong hash",
                vec![wrong_verified, &bare_start, P1, P2, END],
            ),
        ] {
            assert!(result(&lines).is_err(), "{name} must not succeed");
        }
    }

    #[test]
    fn partial_and_oversized_frames_are_broken() {
        let partial = read_frames(
            Cursor::new(format!("{}\n{{\"type\":\"pa", start()).into_bytes()),
            SHA,
        )
        .unwrap();
        assert_eq!(partial.broken, Some("partial_frame"));
        let big = vec![b'x'; MAX_FRAME_BYTES + 10];
        let oversized = read_frames(Cursor::new(big), SHA).unwrap();
        assert_eq!(oversized.broken, Some("frame_too_large"));
    }

    #[test]
    fn breach_marker_wins_and_its_absence_is_a_plain_failure() {
        let aborted = Ending::Exited {
            success: false,
            code: None,
        };
        let mut marker = BREACH_MARKER.to_vec();
        marker.extend_from_slice(b"memory allocation failed");
        assert_eq!(
            classify(aborted, None, frames(&[]), Ok(marker.clone())),
            Err(Failure::MemoryLimit)
        );
        // Undelivered marker: an abort without it is only a worker failure.
        assert!(matches!(
            classify(aborted, None, frames(&[]), Ok(Vec::new())),
            Err(Failure::WorkerFailed(_))
        ));
        // Even a complete-looking run is not success if the marker arrived.
        assert_eq!(
            classify(OK, None, frames(&[&start(), P1, P2, END]), Ok(marker)),
            Err(Failure::MemoryLimit)
        );
    }

    #[test]
    fn an_unconfirmed_stdout_outranks_the_marker_and_stop_reasons() {
        let marker = BREACH_MARKER.to_vec();
        let aborted = Ending::Exited {
            success: false,
            code: None,
        };
        for (stopped, stderr) in [
            (None, Ok(marker.clone())),
            (Some(Failure::Cancelled), Ok(Vec::new())),
            (Some(Failure::Timeout), Ok(marker.clone())),
        ] {
            assert_eq!(
                classify(aborted, stopped.clone(), Err("stdout_read"), stderr.clone()),
                Err(Failure::WorkerFailed("stdout_read"))
            );
            assert_eq!(
                classify(aborted, stopped, Err("reader_panic"), stderr),
                Err(Failure::WorkerFailed("reader_panic"))
            );
        }
    }

    #[test]
    fn unconfirmed_pipes_are_failures_not_empty_results() {
        let good = || frames(&[&start(), P1, P2, END]);
        assert_eq!(
            classify(OK, None, good(), Err("stderr_read")),
            Err(Failure::WorkerFailed("stderr_read"))
        );
        assert_eq!(
            classify(OK, None, Err("stdout_read"), Ok(Vec::new())),
            Err(Failure::WorkerFailed("stdout_read"))
        );
        assert_eq!(
            classify(OK, None, good(), Err("reader_panic")),
            Err(Failure::WorkerFailed("reader_panic"))
        );
    }

    #[test]
    fn stop_reasons_and_exit_status_are_respected() {
        let good = || frames(&[&start(), P1, P2, END]);
        assert_eq!(
            classify(
                Ending::Stopped,
                Some(Failure::Timeout),
                good(),
                Ok(Vec::new())
            ),
            Err(Failure::Timeout)
        );
        assert_eq!(
            classify(
                Ending::Stopped,
                Some(Failure::Cancelled),
                good(),
                Ok(Vec::new())
            ),
            Err(Failure::Cancelled)
        );
        let failed_exit = Ending::Exited {
            success: false,
            code: Some(1),
        };
        assert!(classify(failed_exit, None, good(), Ok(Vec::new())).is_err());
        assert!(classify(Ending::Unknown, None, good(), Ok(Vec::new())).is_err());
        let reported = frames(&[&start(), r#"{"type":"error","code":"encrypted"}"#]);
        let code3 = Ending::Exited {
            success: false,
            code: Some(EXIT_REPORTED),
        };
        assert_eq!(
            classify(code3, None, reported, Ok(Vec::new())),
            Err(Failure::Reported("encrypted".into()))
        );
    }

    /// A reader that fails partway, to prove errors are not taken for EOF.
    struct Failing(usize);
    impl Read for Failing {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.0 == 0 {
                return Err(std::io::Error::other("broken pipe"));
            }
            self.0 -= 1;
            buf[0] = b' ';
            Ok(1)
        }
    }

    /// Interrupted reads are retried, then a clean EOF is reached.
    struct Interrupting(u8);
    impl Read for Interrupting {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.0 += 1;
            match self.0 {
                1 | 3 => Err(std::io::Error::from(ErrorKind::Interrupted)),
                2 => {
                    buf[..3].copy_from_slice(b"err");
                    Ok(3)
                }
                _ => Ok(0),
            }
        }
    }

    #[test]
    fn injected_reader_errors_and_interruptions() {
        assert_eq!(read_stderr(Failing(3)), Err("stderr_read"));
        assert_eq!(read_stderr(Interrupting(0)), Ok(b"err".to_vec()));
        assert_eq!(read_frames(Failing(3), SHA).err(), Some("stdout_read"));
    }
}
