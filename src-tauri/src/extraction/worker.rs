//! The extraction worker: the shipped binary in worker mode (OFFLINE-01
//! proposal §4.1). It reads one request, extracts per-page text from one
//! file, writes NDJSON frames to stdout and exits. It opens no database,
//! network, window or WebView.

use super::alloc::COUNTER;
use super::inspect::{inspect_page, outcome, Outcome};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

/// The only argument that selects worker mode, and only on its own.
pub const WORKER_FLAG: &str = "--hfd-extract-worker";

/// Compiled-in maximums. A request may lower these, never raise them.
pub const MAX_INPUT_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_PAGE_TEXT_BYTES: usize = 64 * 1024;
pub const MAX_TOTAL_TEXT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_MEMORY_BYTES: usize = 384 * 1024 * 1024;
pub const MAX_REQUEST_BYTES: u64 = 4 * 1024;
/// The extraction thread's fixed stack; overflow aborts the worker.
pub const WORKER_STACK_BYTES: usize = 8 * 1024 * 1024;

pub const EXIT_DONE: i32 = 0;
pub const EXIT_REPORTED: i32 = 3;
pub const EXIT_BAD_ARGS: i32 = 64;
pub const EXIT_BAD_REQUEST: i32 = 65;
pub const EXIT_MEMORY: i32 = 70;

/// Decide, before Tauri starts, whether this process is a worker.
/// `None` means start the app. Any use of the flag other than exactly
/// `[exe, flag]` exits without starting anything.
pub fn dispatch<I: IntoIterator<Item = std::ffi::OsString>>(args: I) -> Option<i32> {
    let args: Vec<std::ffi::OsString> = args.into_iter().collect();
    let flagged = args.iter().skip(1).any(|a| a == WORKER_FLAG);
    if !flagged {
        // The app: no cap, and no counter shared by its many threads.
        COUNTER.stop_counting();
        return None;
    }
    if args.len() != 2 || args[1] != WORKER_FLAG {
        return Some(EXIT_BAD_ARGS);
    }
    Some(run())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub path: String,
    pub sha256: String,
    #[serde(default)]
    pub limits: Limits,
    /// Fault injection for the supervisor's tests; ignored in release builds.
    #[serde(default)]
    pub test: Option<TestHook>,
}

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub input_bytes: Option<u64>,
    pub page_text_bytes: Option<usize>,
    pub total_text_bytes: Option<usize>,
    pub memory_bytes: Option<usize>,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum TestHook {
    /// Allocate this many bytes infallibly (aborts on a breach).
    Allocate(usize),
    /// Try to reserve this many bytes, as `lopdf`'s fallible paths do.
    TryReserve(usize),
    Sleep(u64),
    /// Sleep after the file has been read and verified, so a test can
    /// replace it while extraction is under way.
    SleepAfterRead(u64),
    OverflowStack,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Frame {
    /// The bytes read match the requested hash. Sent before anything else,
    /// and flushed at once, so a failure after it can be attributed to
    /// those bytes.
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
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<&'static str>,
    },
    Error {
        code: &'static str,
    },
    /// Success. `peakBytes` is the counted peak of requested allocation
    /// bytes in this worker: evidence for measurements, not a bound.
    #[serde(rename_all = "camelCase")]
    End {
        peak_bytes: u64,
    },
}

fn run() -> i32 {
    if !COUNTER.set_cap(MAX_MEMORY_BYTES) {
        return EXIT_MEMORY;
    }
    let worker = std::thread::Builder::new()
        .name("extract".into())
        .stack_size(WORKER_STACK_BYTES)
        .spawn(work);
    match worker.map(|w| w.join()) {
        Ok(Ok(code)) => code,
        _ => EXIT_BAD_REQUEST,
    }
}

/// Write one frame unless a cap breach has happened; a breach never
/// produces anything that could read as success.
fn emit(out: &mut impl Write, frame: &Frame) -> Result<(), i32> {
    if COUNTER.breached() {
        return Err(EXIT_MEMORY);
    }
    let line = serde_json::to_vec(frame).map_err(|_| EXIT_MEMORY)?;
    if COUNTER.breached() {
        return Err(EXIT_MEMORY);
    }
    out.write_all(&line)
        .and_then(|_| out.write_all(b"\n"))
        .map_err(|_| EXIT_REPORTED)
}

fn work() -> i32 {
    let mut raw = Vec::new();
    if std::io::stdin()
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_end(&mut raw)
        .is_err()
        || raw.is_empty()
        || raw.len() as u64 > MAX_REQUEST_BYTES
    {
        return EXIT_BAD_REQUEST;
    }
    let Ok(request) = serde_json::from_slice::<Request>(&raw) else {
        return EXIT_BAD_REQUEST;
    };
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let code = match extract(&request, &mut out) {
        Ok(()) => match emit(
            &mut out,
            &Frame::End {
                peak_bytes: COUNTER.peak() as u64,
            },
        ) {
            Ok(()) => EXIT_DONE,
            Err(code) => code,
        },
        Err(Stop::Reported(code)) => match emit(&mut out, &Frame::Error { code }) {
            Ok(()) => EXIT_REPORTED,
            Err(code) => code,
        },
        Err(Stop::Exit(code)) => code,
    };
    if out.flush().is_err() && code == EXIT_DONE {
        return EXIT_REPORTED;
    }
    code
}

enum Stop {
    /// Tell the supervisor with an error frame.
    Reported(&'static str),
    /// Exit without another frame.
    Exit(i32),
}

impl From<i32> for Stop {
    fn from(code: i32) -> Self {
        Stop::Exit(code)
    }
}

fn extract(request: &Request, out: &mut impl Write) -> Result<(), Stop> {
    let limits = request.limits;
    let input_max = limits
        .input_bytes
        .unwrap_or(MAX_INPUT_BYTES)
        .min(MAX_INPUT_BYTES);
    let page_max = limits
        .page_text_bytes
        .unwrap_or(MAX_PAGE_TEXT_BYTES)
        .min(MAX_PAGE_TEXT_BYTES);
    let total_max = limits
        .total_text_bytes
        .unwrap_or(MAX_TOTAL_TEXT_BYTES)
        .min(MAX_TOTAL_TEXT_BYTES);
    if let Some(memory) = limits.memory_bytes {
        if !COUNTER.set_cap(memory.min(MAX_MEMORY_BYTES)) {
            return Err(Stop::Exit(EXIT_MEMORY));
        }
    }
    if cfg!(debug_assertions) {
        if let Some(hook) = request.test {
            run_hook(hook)?;
        }
    }
    let sha = request.sha256.to_ascii_lowercase();
    if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Stop::Exit(EXIT_BAD_REQUEST));
    }
    let file = std::fs::File::open(&request.path).map_err(|_| Stop::Reported("unreadable"))?;
    let mut bytes = Vec::new();
    file.take(input_max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Stop::Reported("unreadable"))?;
    if bytes.len() as u64 > input_max {
        return Err(Stop::Reported("input_too_large"));
    }
    if hex::encode(Sha256::digest(&bytes)) != sha {
        return Err(Stop::Reported("identity_mismatch"));
    }
    emit(
        out,
        &Frame::Verified {
            sha256: sha.clone(),
        },
    )?;
    out.flush().map_err(|_| Stop::Exit(EXIT_REPORTED))?;
    if cfg!(debug_assertions) {
        if let Some(TestHook::SleepAfterRead(ms)) = request.test {
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
    }
    let doc = lopdf::Document::load_mem(&bytes).map_err(|_| Stop::Reported("malformed"))?;
    drop(bytes);
    if doc.is_encrypted() {
        return Err(Stop::Reported("encrypted"));
    }
    let pages = doc.get_pages();
    let count = u32::try_from(pages.len()).map_err(|_| Stop::Reported("malformed"))?;
    if count == 0 {
        return Err(Stop::Reported("malformed"));
    }
    emit(
        out,
        &Frame::Start {
            sha256: sha,
            pages: count,
        },
    )?;
    let mut total = 0usize;
    for (number, page_id) in pages {
        let inspection = inspect_page(&doc, page_id);
        let chunks = doc.extract_text_chunks(&[number]);
        let text: String = chunks.into_iter().filter_map(Result::ok).collect();
        let mut result = outcome(&inspection, &text);
        let mut error = None;
        let mut text = if result == Outcome::Text {
            text
        } else {
            String::new()
        };
        if text.len() > page_max {
            result = Outcome::Failed;
            error = Some("page_text_limit");
            text = String::new();
        }
        if result == Outcome::Failed && error.is_none() {
            error = Some("page_content");
        }
        total += text.len();
        if total > total_max {
            return Err(Stop::Reported("total_text_limit"));
        }
        emit(
            out,
            &Frame::Page {
                index: number,
                outcome: result,
                text,
                error,
            },
        )?;
    }
    Ok(())
}

fn run_hook(hook: TestHook) -> Result<(), Stop> {
    match hook {
        TestHook::Allocate(n) => {
            let v = vec![1u8; n];
            std::hint::black_box(&v);
        }
        TestHook::TryReserve(n) => {
            let mut v: Vec<u8> = Vec::new();
            if v.try_reserve(n).is_err() {
                // Like a library that handles the failure and carries on:
                // the breach flag must still stop any success.
            }
            std::hint::black_box(&v);
        }
        TestHook::Sleep(ms) => std::thread::sleep(std::time::Duration::from_millis(ms)),
        TestHook::SleepAfterRead(_) => {}
        TestHook::OverflowStack => {
            // Deliberately unbounded: proves a stack overflow is not a success.
            #[allow(unconditional_recursion)]
            fn deep(n: u64) -> u64 {
                let pad = [n; 512];
                std::hint::black_box(&pad);
                deep(n + 1) + pad[0]
            }
            std::hint::black_box(deep(0));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn no_flag_starts_the_app() {
        assert_eq!(dispatch(args(&["app"])), None);
        assert_eq!(dispatch(args(&["app", "--other"])), None);
    }

    #[test]
    fn any_other_use_of_the_flag_exits_without_starting_anything() {
        for list in [
            &["app", WORKER_FLAG, WORKER_FLAG][..],
            &["app", WORKER_FLAG, "extra"],
            &["app", "extra", WORKER_FLAG],
            &["app", "--x", WORKER_FLAG, "--y"],
        ] {
            assert_eq!(dispatch(args(list)), Some(EXIT_BAD_ARGS), "{list:?}");
        }
    }

    #[test]
    fn requests_refuse_unknown_fields() {
        let bad = br#"{"path":"/x","sha256":"00","skipChecks":true}"#;
        assert!(serde_json::from_slice::<Request>(bad).is_err());
        let ok = br#"{"path":"/x","sha256":"00","limits":{"memoryBytes":1}}"#;
        assert!(serde_json::from_slice::<Request>(ok).is_ok());
    }
}
