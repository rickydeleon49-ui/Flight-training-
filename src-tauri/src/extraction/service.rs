//! Readiness and preparation (OFFLINE-01 proposal §4.3–§4.5).
//!
//! A material's readiness is never stored. It is derived from the hash of
//! the file the material has *now*, and that hash counts as verified only
//! once the bytes were read in this app session. Preparation re-hashes the
//! file at the moment it acts, runs one worker at a time, and publishes
//! results only under the hash the worker read. Nothing here reads the
//! Gemini key or reaches a provider.

use super::cache::{Cache, Counts, Summary};
use super::supervisor::{self, Failure, Job};
use super::worker::Limits;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long one document may take before its worker is stopped.
pub const PREPARE_DEADLINE: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PartialReason {
    /// Every page that isn't searchable is an image.
    ImagePages,
    /// At least one page couldn't be read or fully checked.
    SomeUnreadable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Readiness {
    /// Not a PDF; other kinds come later.
    Unsupported,
    Missing,
    /// The file hasn't been verified in this session yet.
    Checking,
    NotPrepared,
    Preparing,
    Searchable {
        pages: u32,
    },
    #[serde(rename_all = "camelCase")]
    Partial {
        searchable: u32,
        pages: u32,
        image_pages: u32,
        reason: PartialReason,
    },
    CouldNotProcess {
        code: String,
    },
}

/// The §4.4 summary: exact counts, a specific reason only when it is known.
pub fn summarize(c: Counts) -> Readiness {
    let pages = c.pages();
    let searchable = c.text + c.blank;
    if searchable == pages {
        return Readiness::Searchable { pages };
    }
    let reason = if c.text_unreadable + c.unknown + c.failed > 0 {
        PartialReason::SomeUnreadable
    } else {
        PartialReason::ImagePages
    };
    Readiness::Partial {
        searchable,
        pages,
        image_pages: c.image_only,
        reason,
    }
}

/// What makes a file "the same" between checks. A hint only: different
/// bytes can keep it, so it is trusted for nothing beyond this session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    size: u64,
    modified_ns: u128,
    inode: u64,
}

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    #[cfg(unix)]
    let inode = std::os::unix::fs::MetadataExt::ino(&meta);
    #[cfg(not(unix))]
    let inode = 0;
    Some(Stamp {
        size: meta.len(),
        modified_ns: meta
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_nanos(),
        inode,
    })
}

/// Hash a file by streaming it, so a large original never sits in the
/// app's memory. The stamp must not change while it is read.
pub fn hash_file(path: &Path) -> Option<String> {
    let before = stamp(path)?;
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    if stamp(path)? != before {
        return None;
    }
    Some(hex::encode(hasher.finalize()))
}

/// Whole-file failures that depend only on a file's bytes, so they can be
/// stored against its hash. Identity mismatches, unreadable files,
/// timeouts, cancellations and crashes may be transient and are never
/// stored: a later try with the same bytes must still be possible.
pub fn cacheable(failure: &Failure) -> bool {
    match failure {
        Failure::MemoryLimit => true,
        Failure::Reported(code) => matches!(
            code.as_str(),
            "encrypted" | "malformed" | "input_too_large" | "total_text_limit"
        ),
        _ => false,
    }
}

/// Work for the single executor thread.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Task {
    Verify(PathBuf),
    Prepare(String),
}

/// At most this many tasks wait; more are dropped and simply re-requested
/// by the next readiness check.
pub const MAX_QUEUED: usize = 1024;

#[derive(Default)]
struct Queue {
    tasks: std::collections::VecDeque<Task>,
    queued: HashSet<Task>,
    running: bool,
}

// Test-only scheduling seam at the gap between hashing and remembering a
// stamp; never compiled into application commands or enabled by environment.
#[cfg(test)]
type AfterHashHook = Option<Box<dyn FnOnce(&Path)>>;
#[cfg(test)]
thread_local! { static AFTER_HASH: std::cell::RefCell<AfterHashHook> = const { std::cell::RefCell::new(None) }; }

/// One app session's knowledge. A new session (for example after a restore,
/// which restarts the app) starts with nothing verified.
pub struct Service {
    root: PathBuf,
    search: std::sync::OnceLock<super::search::Host>,
    worker: PathBuf,
    verified: Mutex<HashMap<PathBuf, (Stamp, String)>>,
    preparing: Mutex<HashSet<String>>,
    /// Serializes all hashing and extraction.
    slot: Mutex<()>,
    queue: Mutex<Queue>,
    idle: std::sync::Condvar,
}

impl Service {
    pub fn new(root: PathBuf, worker: PathBuf) -> Self {
        Self {
            root,
            search: std::sync::OnceLock::new(),
            worker,
            verified: Mutex::new(HashMap::new()),
            preparing: Mutex::new(HashSet::new()),
            slot: Mutex::new(()),
            queue: Mutex::new(Queue::default()),
            idle: std::sync::Condvar::new(),
        }
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn search_host(&self) -> &super::search::Host {
        self.search
            .get_or_init(|| super::search::Host::start(self.root.join(super::cache::CACHE_FILE)))
    }

    pub(crate) fn preparing_hash(&self, sha: &str) -> bool {
        self.preparing
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(sha)
    }

    /// Resolve a material's stored relative path inside `documents/`.
    pub fn document_path(&self, relative: &str) -> Option<PathBuf> {
        let safe = crate::documents::safe_relative_path(relative).ok()?;
        Some(self.root.join(crate::documents::DOCUMENTS_DIR).join(safe))
    }

    fn remember(&self, path: &Path) -> Option<String> {
        let before = stamp(path)?;
        let sha = hash_file(path)?;
        #[cfg(test)]
        AFTER_HASH.with(|slot| {
            if let Some(hook) = slot.borrow_mut().take() {
                hook(path);
            }
        });
        let st = stamp(path)?;
        if st != before {
            self.verified
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(path);
            return None;
        }
        self.verified
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(path.to_path_buf(), (st, sha.clone()));
        Some(sha)
    }

    /// Hash `path` now and remember it, without waiting for the slot. The
    /// destination check uses this: opening a search result must not wait
    /// behind a preparation, which holds the slot for up to its deadline.
    pub(crate) fn rehash(&self, path: &Path) -> Option<String> {
        self.remember(path)
    }

    /// Hold the hashing and extraction slot, as a running preparation does.
    #[cfg(test)]
    pub(crate) fn hold_slot_for_test(&self) -> std::sync::MutexGuard<'_, ()> {
        self.slot.lock().unwrap()
    }

    /// Hash `path` now and remember it for this session.
    pub fn verify(&self, path: &Path) -> Option<String> {
        let _slot = self.slot.lock().unwrap_or_else(|e| e.into_inner());
        self.remember(path)
    }

    /// The verified hash for `path`, if it was hashed this session and its
    /// stamp hasn't changed since.
    pub(crate) fn current(&self, path: &Path) -> Option<String> {
        let now = stamp(path)?;
        let map = self.verified.lock().unwrap_or_else(|e| e.into_inner());
        map.get(path)
            .filter(|(st, _)| *st == now)
            .map(|(_, sha)| sha.clone())
    }

    pub(crate) fn is_queued_prepare(&self, relative: &str) -> bool {
        self.queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .queued
            .contains(&Task::Prepare(relative.to_string()))
    }

    pub(crate) fn is_pdf(path: &Path) -> bool {
        path.extension()
            .map(|e| e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false)
    }

    pub fn readiness(&self, relative: &str) -> Readiness {
        let Some(path) = self.document_path(relative) else {
            return Readiness::Missing;
        };
        if !Self::is_pdf(&path) {
            return Readiness::Unsupported;
        }
        if stamp(&path).is_none() {
            return Readiness::Missing;
        }
        if self.is_queued_prepare(relative) {
            return Readiness::Preparing;
        }
        let Some(sha) = self.current(&path) else {
            return Readiness::Checking;
        };
        if self
            .preparing
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&sha)
        {
            return Readiness::Preparing;
        }
        let cache = match Cache::open(&self.root) {
            Ok(c) => c,
            Err(_) => return Readiness::NotPrepared,
        };
        match cache.summary(&sha) {
            None => Readiness::NotPrepared,
            Some(Summary::Failed(code)) => Readiness::CouldNotProcess { code },
            Some(Summary::Complete(counts)) => summarize(counts),
        }
    }

    /// Prepare one material now, blocking. The commands go through the
    /// queue; tests may call this directly.
    pub fn prepare(&self, relative: &str, cancel: Arc<AtomicBool>) -> Readiness {
        self.prepare_with(relative, cancel, None)
    }

    /// `prepare` with extra worker request fields: fault injection, which
    /// the worker honours only in debug builds.
    pub fn prepare_with(
        &self,
        relative: &str,
        cancel: Arc<AtomicBool>,
        extra: Option<serde_json::Value>,
    ) -> Readiness {
        let Some(path) = self.document_path(relative) else {
            return Readiness::Missing;
        };
        if !Self::is_pdf(&path) {
            return Readiness::Unsupported;
        }
        {
            let _slot = self.slot.lock().unwrap_or_else(|e| e.into_inner());
            // Re-hash before deciding anything: a remembered hash may
            // describe bytes the file no longer has.
            let Some(sha) = self.remember(&path) else {
                return Readiness::Missing;
            };
            let cached = Cache::open(&self.root).ok().and_then(|c| c.summary(&sha));
            if cached.is_none() {
                self.preparing
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(sha.clone());
                let finished = supervisor::run_detailed(Job {
                    worker: &self.worker,
                    file: &path,
                    sha256: &sha,
                    limits: Limits::default(),
                    deadline: PREPARE_DEADLINE,
                    cancel,
                    extra,
                });
                let result = &finished.result;
                if let Ok(mut cache) = Cache::open(&self.root) {
                    match result {
                        // Content-addressed: correct for these bytes even if
                        // the file has changed since.
                        Ok(extraction) if extraction.sha256 == sha => {
                            let _ = cache.publish(extraction);
                        }
                        // Only a failure after the worker confirmed it read
                        // these exact bytes can be stored against them.
                        Err(failure) if finished.identity_verified && cacheable(failure) => {
                            let _ = cache.publish_failure(&sha, &failure.code());
                        }
                        _ => {}
                    }
                }
                self.preparing
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&sha);
            }
            // Hash again before reporting: the file may have been replaced,
            // even keeping its stamp, while the worker ran.
            if self.remember(&path).is_none() {
                return Readiness::Missing;
            }
        }
        self.readiness(relative)
    }

    /// Drop cache entries no current material references (bounded).
    pub fn prune(&self, referenced: &HashSet<String>, limit: usize) -> usize {
        Cache::open(&self.root)
            .and_then(|mut c| c.prune(referenced, limit))
            .unwrap_or(0)
    }

    /// Queue a task for the single executor thread, deduplicated and
    /// bounded. Returns false if it was dropped because the queue is full.
    fn enqueue(self: &Arc<Self>, task: Task) -> bool {
        let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        if q.queued.contains(&task) {
            return true;
        }
        if q.tasks.len() >= MAX_QUEUED {
            return false;
        }
        q.queued.insert(task.clone());
        q.tasks.push_back(task);
        if !q.running {
            q.running = true;
            let me = self.clone();
            std::thread::spawn(move || me.drain());
        }
        true
    }

    pub fn enqueue_verify(self: &Arc<Self>, path: PathBuf) -> bool {
        self.enqueue(Task::Verify(path))
    }

    pub fn enqueue_prepare(self: &Arc<Self>, relative: String) -> bool {
        self.enqueue(Task::Prepare(relative))
    }

    /// The executor: one task at a time until the queue is empty. A task
    /// stays in `queued` until it finishes, so a duplicate request made
    /// while it runs is not queued again.
    fn drain(&self) {
        loop {
            let task = {
                let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
                match q.tasks.front().cloned() {
                    Some(t) => t,
                    None => {
                        q.running = false;
                        self.idle.notify_all();
                        return;
                    }
                }
            };
            match &task {
                Task::Verify(path) => {
                    self.verify(path);
                }
                Task::Prepare(relative) => {
                    self.prepare(relative, Arc::new(AtomicBool::new(false)));
                }
            }
            let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
            q.tasks.pop_front();
            q.queued.remove(&task);
        }
    }

    /// Block until the executor has nothing queued or running.
    pub fn wait_idle(&self) {
        let mut q = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        while q.running {
            q = self.idle.wait(q).unwrap_or_else(|e| e.into_inner());
        }
    }
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialReadiness {
    material_id: String,
    readiness: Readiness,
}

static SERVICE: std::sync::OnceLock<Arc<Service>> = std::sync::OnceLock::new();

pub(crate) fn service(app: &tauri::AppHandle) -> Result<Arc<Service>, String> {
    if let Some(s) = SERVICE.get() {
        return Ok(s.clone());
    }
    let root = crate::storage::app_root(app)?;
    let worker = std::env::current_exe().map_err(|_| "worker_unavailable".to_string())?;
    Ok(SERVICE
        .get_or_init(|| Arc::new(Service::new(root, worker)))
        .clone())
}

/// Each material's stored file path, read without changing anything.
fn material_paths(root: &Path, ids: &[String]) -> Result<Vec<(String, Option<String>)>, String> {
    if !crate::practice_sessions::is_root_ready(root) {
        return Err("storage_not_ready".into());
    }
    let conn = rusqlite::Connection::open_with_flags(
        root.join("her-flight-deck.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "storage_unavailable".to_string())?;
    let mut stmt = conn
        .prepare("SELECT file_path FROM study_materials WHERE id = ?1")
        .map_err(|_| "storage_unavailable".to_string())?;
    Ok(ids
        .iter()
        .map(|id| {
            let path = stmt
                .query_row([id], |r| r.get::<_, Option<String>>(0))
                .ok()
                .flatten();
            (id.clone(), path)
        })
        .collect())
}

/// Readiness for each material. Files not yet verified this session are
/// hashed in the background and report `checking` until then.
#[tauri::command]
pub async fn offline_content_readiness(
    app: tauri::AppHandle,
    material_ids: Vec<String>,
) -> Result<Vec<MaterialReadiness>, String> {
    let svc = service(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let rows = material_paths(&svc.root, &material_ids)?;
        let mut out = Vec::with_capacity(rows.len());
        let mut to_verify = Vec::new();
        for (material_id, relative) in rows {
            let readiness = match &relative {
                Some(rel) => svc.readiness(rel),
                None => Readiness::Missing,
            };
            if readiness == Readiness::Checking {
                if let Some(path) = relative.as_deref().and_then(|r| svc.document_path(r)) {
                    to_verify.push(path);
                }
            }
            out.push(MaterialReadiness {
                material_id,
                readiness,
            });
        }
        for path in to_verify {
            svc.enqueue_verify(path);
        }
        Ok(out)
    })
    .await
    .map_err(|_| "task_failed".to_string())?
}

pub use super::worker::extraction_enabled;

/// Start preparing one material for offline study. Returns at once with
/// `preparing` (or the current state if nothing needs doing).
#[tauri::command]
pub async fn prepare_offline_content(
    app: tauri::AppHandle,
    material_id: String,
) -> Result<MaterialReadiness, String> {
    if !extraction_enabled() {
        return Err("offline_extraction_disabled".into());
    }
    let svc = service(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let rows = material_paths(&svc.root, std::slice::from_ref(&material_id))?;
        let relative = rows.into_iter().next().and_then(|(_, p)| p);
        let Some(relative) = relative else {
            return Ok(MaterialReadiness {
                material_id,
                readiness: Readiness::Missing,
            });
        };
        svc.enqueue_prepare(relative.clone());
        Ok(MaterialReadiness {
            material_id,
            readiness: svc.readiness(&relative),
        })
    })
    .await
    .map_err(|_| "task_failed".to_string())?
}

#[cfg(test)]
mod tests {

    #[test]
    fn debug_builds_may_extract_and_release_builds_need_the_opt_in() {
        if cfg!(debug_assertions) {
            assert!(extraction_enabled());
        } else {
            assert_eq!(
                extraction_enabled(),
                option_env!("HFD_OFFLINE_EXTRACTION") == Some("1")
            );
        }
    }

    use super::*;

    #[test]
    fn summary_uses_exact_counts_and_never_guesses() {
        let all = Counts {
            text: 9,
            blank: 1,
            ..Counts::default()
        };
        assert_eq!(summarize(all), Readiness::Searchable { pages: 10 });
        let images = Counts {
            text: 8,
            image_only: 2,
            ..Counts::default()
        };
        assert_eq!(
            summarize(images),
            Readiness::Partial {
                searchable: 8,
                pages: 10,
                image_pages: 2,
                reason: PartialReason::ImagePages
            }
        );
        for c in [
            Counts {
                text: 8,
                image_only: 1,
                unknown: 1,
                ..Counts::default()
            },
            Counts {
                text: 8,
                image_only: 1,
                text_unreadable: 1,
                ..Counts::default()
            },
            Counts {
                text: 8,
                image_only: 1,
                failed: 1,
                ..Counts::default()
            },
        ] {
            let Readiness::Partial { reason, .. } = summarize(c) else {
                panic!()
            };
            assert_eq!(
                reason,
                PartialReason::SomeUnreadable,
                "{c:?}: neutral wording when the cause is unknown"
            );
        }
        let empty_text = Counts {
            image_only: 3,
            ..Counts::default()
        };
        assert!(matches!(
            summarize(empty_text),
            Readiness::Partial { searchable: 0, .. }
        ));
    }

    #[test]
    fn only_byte_determined_failures_are_cacheable() {
        for code in [
            "encrypted",
            "malformed",
            "input_too_large",
            "total_text_limit",
        ] {
            assert!(cacheable(&Failure::Reported(code.into())), "{code}");
        }
        assert!(cacheable(&Failure::MemoryLimit));
        for code in ["identity_mismatch", "unreadable", "anything_else"] {
            assert!(!cacheable(&Failure::Reported(code.into())), "{code}");
        }
        assert!(!cacheable(&Failure::Timeout));
        assert!(!cacheable(&Failure::Cancelled));
        assert!(!cacheable(&Failure::WorkerFailed("exit")));
    }

    #[test]
    fn the_queue_admits_exactly_its_bound_while_the_executor_is_busy() {
        let root = std::env::temp_dir().join(format!("hfd-queue-{}", std::process::id()));
        let svc = Arc::new(Service::new(root, PathBuf::from("unused")));
        // Hold the work lock so the executor blocks on its first task.
        let guard = svc.slot.lock().unwrap();
        let accepted = (0..MAX_QUEUED + 500)
            .filter(|i| svc.enqueue_verify(PathBuf::from(format!("/nonexistent/{i}"))))
            .count();
        assert_eq!(
            accepted, MAX_QUEUED,
            "the running task counts toward the bound"
        );
        assert!(
            svc.enqueue_verify(PathBuf::from("/nonexistent/0")),
            "a duplicate of queued work is accepted"
        );
        assert!(!svc.is_queued_prepare("x"));
        drop(guard);
        svc.wait_idle();
        assert!(svc.queue.lock().unwrap().queued.is_empty());
    }

    #[test]
    fn extraction_never_reaches_gemini_or_the_key() {
        for (name, source) in [
            ("alloc", include_str!("alloc.rs")),
            ("inspect", include_str!("inspect.rs")),
            ("worker", include_str!("worker.rs")),
            ("supervisor", include_str!("supervisor.rs")),
            ("cache", include_str!("cache.rs")),
            ("search", include_str!("search.rs")),
            ("search_api", include_str!("search_api.rs")),
        ] {
            for banned in ["crate::gemini", "crate::secrets", "reqwest", "gemini_files"] {
                assert!(!source.contains(banned), "{name}.rs must not use {banned}");
            }
        }
        let this = include_str!("service.rs");
        let code = &this[..this.find("#[cfg(test)]").unwrap()];
        for banned in ["crate::gemini", "crate::secrets", "reqwest", "gemini_files"] {
            assert!(!code.contains(banned), "service.rs must not use {banned}");
        }
    }
    #[test]
    fn search_does_not_wait_for_the_hashing_and_extraction_slot() {
        let root = std::env::temp_dir().join(format!("hfd-search-slot-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let db = rusqlite::Connection::open(root.join("her-flight-deck.db")).unwrap();
        db.execute_batch("CREATE TABLE study_materials(id TEXT PRIMARY KEY,title TEXT,material_type TEXT,original_file_name TEXT,created_at TEXT,file_path TEXT);").unwrap();
        crate::practice_sessions::mark_root_ready(&root);
        let svc = Arc::new(Service::new(root.clone(), PathBuf::new()));
        // A real preparation holds this lock while the worker runs. Search
        // must complete while it is held, not merely after it is released.
        let held = svc.slot.lock().unwrap();
        let until = std::time::Instant::now() + Duration::from_secs(5);
        while super::super::search_api::search_initialization(&svc).unwrap()
            != super::super::search::Initialization::Ready
        {
            assert!(std::time::Instant::now() < until);
            std::thread::yield_now();
        }
        let ticket = super::super::search_api::submit_search(
            svc.clone(),
            "wind".into(),
            vec![],
            vec!["documentPages".into()],
            0,
            std::time::Instant::now(),
        )
        .unwrap();
        assert!(ticket.wait().unwrap().groups.is_empty());
        drop(held);
        crate::practice_sessions::unmark_root_ready(&root);
        drop(svc);
        drop(db);
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn a_change_after_hashing_cannot_bind_old_bytes_to_the_new_stamp() {
        let root = std::env::temp_dir().join(format!("hfd-remember-gap-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("test.pdf");
        std::fs::write(&path, b"original").unwrap();
        let svc = Service::new(root.clone(), PathBuf::new());
        AFTER_HASH.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(|path| {
                std::fs::write(path, b"longer replacement").unwrap()
            }))
        });
        assert_eq!(
            svc.verify(&path),
            None,
            "a hash must belong to the stamp remembered with it"
        );
        assert_eq!(svc.current(&path), None);
        assert_eq!(
            svc.verify(&path),
            hash_file(&path),
            "a fresh retry verifies the replacement"
        );
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn commands_report_initializing_without_admitting_a_search() {
        use super::super::{
            search::{Host, Initialization},
            search_api,
        };
        let root = std::env::temp_dir().join(format!("hfd-boot-held-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let svc = Arc::new(Service::new(root.clone(), PathBuf::new()));
        let (release, held) = std::sync::mpsc::channel();
        let host = Host::start_held_for_test(
            root.join(super::super::cache::CACHE_FILE),
            Box::new(move || held.recv().unwrap()),
        );
        assert!(svc.search.set(host).is_ok());
        assert_eq!(
            search_api::search_initialization(&svc).unwrap(),
            Initialization::Preparing
        );
        let entered = std::time::Instant::now();
        let result = search_api::submit_search(
            svc.clone(),
            "wind".into(),
            vec![],
            vec!["documentPages".into()],
            0,
            entered,
        );
        assert_eq!(result.err().as_deref(), Some("index_preparing"));
        assert!(
            !root.join(super::super::cache::CACHE_FILE).exists(),
            "no SQL can run before setup completes"
        );
        release.send(()).unwrap();
        let until = std::time::Instant::now() + Duration::from_secs(5);
        while search_api::search_initialization(&svc).unwrap() != Initialization::Ready {
            assert!(std::time::Instant::now() < until);
            std::thread::yield_now();
        }
        drop(svc);
        let _ = std::fs::remove_dir_all(root);
    }
}
