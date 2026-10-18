//! Generation jobs that outlive the page that started them (GEN-REL-02).
//!
//! A study aid or practice test used to belong to the material page: leaving
//! the page, or reloading the window, threw a finished answer away, and saving
//! again meant asking Gemini again. Now each generation is a job recorded in a
//! small journal in the app data folder, beside the key file:
//!
//! - `running` while Gemini is working;
//! - `ready` once a complete, validated answer has arrived. This is the
//!   checkpoint: saving it (or saving it again after a storage failure) never
//!   calls Gemini again;
//! - `failed` with a message she can read;
//! - `interrupted` when the app closed while the job was running. Nobody knows
//!   whether Google finished or charged for that request, so nothing is resent
//!   by itself: she decides whether to try again.
//!
//! The journal holds no key, no provider file reference and no source bytes:
//! only the job's identity (which material, which stored file, the SHA-256 of
//! the bytes that were sent), its stage and the validated answer. It is not part
//! of a backup (backups carry only the database, its log, the manifest and
//! `documents/`). A finished job is removed once the window has saved or
//! dismissed it. At most `MAX_JOBS` are kept.
//!
//! Format: `{"schema": "hfd-gemini-jobs/1", "jobs": [...]}`, written beside the
//! target and renamed over it. A journal that cannot be read is set aside as
//! `gemini-jobs.unreadable.json` rather than trusted or silently deleted.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const JOURNAL_FILE: &str = "gemini-jobs.json";
const JOURNAL_WRITING: &str = "gemini-jobs.json.writing";
const JOURNAL_UNREADABLE: &str = "gemini-jobs.unreadable.json";
const SCHEMA: &str = "hfd-gemini-jobs/1";

/// Jobs kept at once. A new job never pushes out a running one.
pub(crate) const MAX_JOBS: usize = 8;
/// A journal larger than this is not read: a validated answer is far smaller.
const MAX_JOURNAL_BYTES: u64 = 16 * 1024 * 1024;
/// One validated answer kept as a checkpoint.
const MAX_RESULT_BYTES: usize = 2 * 1024 * 1024;
/// Identity fields the window passes in.
const MAX_ID_BYTES: usize = 200;

pub(crate) const BUSY: &str =
    "Gemini is already working on another study aid. Wait for it to finish, then try again.";
pub(crate) const FULL: &str =
    "Several finished answers are waiting to be saved or discarded. Save or discard one of them first, so none is lost.";
pub(crate) const RESTORING: &str =
    "Her Flight Deck is still finishing restoring a backup, so Gemini cannot be asked for anything new yet. Quit and reopen the app to finish.";
pub(crate) const WAITING: &str =
    "A finished answer for this document is waiting to be saved or discarded. Save or discard it first, so it is not lost.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum JobKind {
    StudyAid,
    PracticeTest,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum JobStage {
    Running,
    Ready,
    Failed,
    Interrupted,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobRecord {
    pub id: String,
    pub kind: JobKind,
    /// The material the window asked for; opaque here.
    pub material_id: String,
    /// The stored file that was read and sent.
    pub relative_path: String,
    /// SHA-256 of exactly the bytes that were sent.
    pub content_sha256: String,
    /// The saved content this job was asked to replace (its `updatedAt`), or
    /// none. A save is refused if something else has been saved since.
    #[serde(default)]
    pub base_revision: Option<String>,
    pub stage: JobStage,
    pub created_at: i64,
    pub updated_at: i64,
    /// The validated answer, once `ready`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// What went wrong, once `failed`; already written for her.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct File {
    schema: String,
    jobs: Vec<JobRecord>,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// A job identifier: unique within this data folder, not a secret.
fn new_id() -> String {
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seed = format!(
        "{nanos}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    );
    format!(
        "job-{}",
        &hex::encode(Sha256::digest(seed.as_bytes()))[..24]
    )
}

fn valid_job_id(id: &str) -> bool {
    id.len() == 28 && id.starts_with("job-") && id[4..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID_BYTES && !value.chars().any(char::is_control)
}

/// The journal of one data folder.
pub(crate) struct Journal {
    root: PathBuf,
    jobs: Vec<JobRecord>,
    /// Set while jobs recorded against a library a restore replaced may still
    /// be on disk: nothing is offered, saved or started until they have been
    /// cleared. It lasts the whole launch if clearing fails, so the next
    /// launch's retry can never clear answers made in the meantime.
    quarantined: bool,
}

impl Journal {
    /// Read the journal as a freshly started app does: anything still
    /// `running` was cut off by the app closing, so it becomes `interrupted`.
    pub(crate) fn open(root: &Path) -> Journal {
        let mut jobs = read(root);
        let mut changed = false;
        for job in &mut jobs {
            if job.stage == JobStage::Running {
                job.stage = JobStage::Interrupted;
                job.updated_at = now();
                changed = true;
            }
        }
        if changed {
            // If this cannot be written, the disk still says `running`, and the
            // next start reads that as interrupted too: the same answer.
            let _ = write(root, &jobs);
        }
        Journal {
            root: root.to_path_buf(),
            jobs,
            // A restore marker beside the journal means a restore committed
            // and has not finished tidying up: its old jobs are not trusted.
            quarantined: root.join(crate::backup::RESTORE_JOURNAL_FILE).exists(),
        }
    }

    /// Make `next` the journal: on disk first, then in memory. A failed write
    /// changes nothing, so no record exists only in memory.
    fn commit(&mut self, next: Vec<JobRecord>) -> Result<(), String> {
        write(&self.root, &next)?;
        self.jobs = next;
        Ok(())
    }

    /// Drop a running job from memory even if the disk cannot be updated, so
    /// the lock is released. The disk then still says `running`, which the
    /// next start reports, honestly, as interrupted.
    fn abandon(&mut self, id: &str) {
        self.jobs.retain(|j| j.id != id);
        let _ = write(&self.root, &self.jobs);
    }

    pub(crate) fn list(&self) -> Vec<JobRecord> {
        if self.quarantined {
            return Vec::new();
        }
        self.jobs.clone()
    }

    /// Start a job. Only one runs at a time, whatever page asked.
    pub(crate) fn begin(
        &mut self,
        kind: JobKind,
        material_id: &str,
        relative_path: &str,
        content_sha256: &str,
        base_revision: Option<&str>,
    ) -> Result<String, String> {
        if self.quarantined {
            return Err(RESTORING.to_string());
        }
        if !valid_identity(material_id) || !valid_identity(relative_path) {
            return Err(
                "That study material could not be identified, so nothing was sent.".to_string(),
            );
        }
        if base_revision.is_some_and(|r| !valid_identity(r)) {
            return Err(
                "That study material could not be identified, so nothing was sent.".to_string(),
            );
        }
        if self.jobs.iter().any(|j| j.stage == JobStage::Running) {
            return Err(BUSY.to_string());
        }
        // A finished answer is never thrown away by asking again: she saves or
        // discards it first.
        if self
            .jobs
            .iter()
            .any(|j| j.material_id == material_id && j.kind == kind && j.stage == JobStage::Ready)
        {
            return Err(WAITING.to_string());
        }
        // An older failed or interrupted outcome of the same request is
        // replaced: she asked again.
        let mut next: Vec<JobRecord> = self
            .jobs
            .iter()
            .filter(|j| !(j.material_id == material_id && j.kind == kind))
            .cloned()
            .collect();
        // Only failed or interrupted outcomes may make room. A waiting answer
        // is never given up without her deciding; if every slot holds one,
        // nothing is sent.
        while next.len() >= MAX_JOBS {
            let Some(victim) = next
                .iter()
                .enumerate()
                .filter(|(_, j)| matches!(j.stage, JobStage::Failed | JobStage::Interrupted))
                .min_by_key(|(_, j)| j.updated_at)
                .map(|(i, _)| i)
            else {
                return Err(FULL.to_string());
            };
            next.remove(victim);
        }
        let at = now();
        let id = new_id();
        next.push(JobRecord {
            id: id.clone(),
            kind,
            material_id: material_id.to_string(),
            relative_path: relative_path.to_string(),
            content_sha256: content_sha256.to_string(),
            base_revision: base_revision.map(str::to_string),
            stage: JobStage::Running,
            created_at: at,
            updated_at: at,
            result: None,
            error: None,
        });
        self.commit(next)?;
        Ok(id)
    }

    /// Record the validated answer: the checkpoint a save is made from. An
    /// error means it is not on disk; the job is then released, not left
    /// running, and the caller must not claim it is kept.
    pub(crate) fn ready(&mut self, id: &str, result: Value) -> Result<(), String> {
        let size = serde_json::to_vec(&result)
            .map(|b| b.len())
            .unwrap_or(usize::MAX);
        if size > MAX_RESULT_BYTES {
            return self.failed(
                id,
                "Gemini's answer was too large to keep, so it was not saved. Try a smaller chapter.",
            );
        }
        self.settle(id, |job| {
            job.stage = JobStage::Ready;
            job.result = Some(result);
        })
    }

    pub(crate) fn failed(&mut self, id: &str, message: &str) -> Result<(), String> {
        self.settle(id, |job| {
            job.stage = JobStage::Failed;
            job.error = Some(message.to_string());
        })
    }

    /// Move a running job to its outcome, on disk first.
    fn settle(&mut self, id: &str, change: impl FnOnce(&mut JobRecord)) -> Result<(), String> {
        let mut next = self.jobs.clone();
        let Some(job) = next
            .iter_mut()
            .find(|j| j.id == id && j.stage == JobStage::Running)
        else {
            return Ok(());
        };
        change(job);
        job.updated_at = now();
        match self.commit(next) {
            Ok(()) => Ok(()),
            Err(error) => {
                self.abandon(id);
                Err(error)
            }
        }
    }

    /// The window saved or dismissed this job: forget it. A failed write keeps
    /// it, so the window can try again.
    pub(crate) fn acknowledge(&mut self, id: &str) -> Result<bool, String> {
        if !valid_job_id(id) || self.quarantined {
            return Ok(false);
        }
        let next: Vec<JobRecord> = self
            .jobs
            .iter()
            .filter(|j| !(j.id == id && j.stage != JobStage::Running))
            .cloned()
            .collect();
        if next.len() == self.jobs.len() {
            return Ok(false);
        }
        self.commit(next)?;
        Ok(true)
    }

    /// A backup was restored: nothing recorded against the previous library
    /// may be saved into the restored one.
    ///
    /// `Ok` only if no old job can be read back afterwards: either the journal
    /// was rewritten empty, or it was removed.
    pub(crate) fn clear(&mut self) -> Result<(), String> {
        if let Err(error) = self.commit(Vec::new()) {
            match std::fs::remove_file(self.root.join(JOURNAL_FILE)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => {
                    self.quarantined = true;
                    return Err(error);
                }
            }
        }
        self.jobs.clear();
        self.quarantined = false;
        Ok(())
    }
}

/// Write `jobs` beside the journal and rename over it.
fn write(root: &Path, jobs: &[JobRecord]) -> Result<(), String> {
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not keep track of this study aid: {e}"))?;
    let file = File {
        schema: SCHEMA.to_string(),
        jobs: jobs.to_vec(),
    };
    let bytes = serde_json::to_vec(&file)
        .map_err(|_| "Could not keep track of this study aid.".to_string())?;
    // Never write a journal the reader would refuse: the earlier one, and
    // every checkpoint in it, stays as it was.
    if bytes.len() as u64 > MAX_JOURNAL_BYTES {
        return Err(
            "Too many large answers are waiting to be saved. Save or discard some of them first."
                .to_string(),
        );
    }
    let writing = root.join(JOURNAL_WRITING);
    std::fs::write(&writing, &bytes)
        .map_err(|e| format!("Could not keep track of this study aid: {e}"))?;
    std::fs::rename(&writing, root.join(JOURNAL_FILE)).map_err(|e| {
        let _ = std::fs::remove_file(&writing);
        format!("Could not keep track of this study aid: {e}")
    })
}

/// The jobs on disk; an unreadable journal is set aside, never trusted.
fn read(root: &Path) -> Vec<JobRecord> {
    let path = root.join(JOURNAL_FILE);
    let too_large = std::fs::metadata(&path)
        .map(|m| m.len() > MAX_JOURNAL_BYTES)
        .unwrap_or(false);
    let parsed = if too_large {
        None
    } else {
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<File>(&bytes)
                .ok()
                .filter(|f| f.schema == SCHEMA),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
            Err(_) => None,
        }
    };
    match parsed {
        Some(file) => file
            .jobs
            .into_iter()
            .filter(|j| {
                valid_job_id(&j.id)
                    && valid_identity(&j.material_id)
                    && valid_identity(&j.relative_path)
            })
            .take(MAX_JOBS)
            .collect(),
        None => {
            let _ = std::fs::rename(&path, root.join(JOURNAL_UNREADABLE));
            Vec::new()
        }
    }
}

/* ------------------------------------------------------------------ */
/* The app's journal                                                   */
/* ------------------------------------------------------------------ */

/// One journal per data folder for the life of the process. Each is opened
/// (and its interrupted jobs marked) once, the first time anything asks; it is
/// never reopened while the process runs, so a running job is never mistaken
/// for one cut off by a restart.
static OPEN: Mutex<Option<HashMap<PathBuf, Journal>>> = Mutex::new(None);

pub(crate) fn with<T>(root: &Path, f: impl FnOnce(&mut Journal) -> T) -> T {
    let mut guard = OPEN.lock().unwrap_or_else(|e| e.into_inner());
    let journal = guard
        .get_or_insert_with(HashMap::new)
        .entry(root.to_path_buf())
        .or_insert_with(|| Journal::open(root));
    f(journal)
}

/// After a backup is restored: forget every job recorded against the library
/// that was replaced.
pub(crate) fn clear_after_restore(root: &Path) -> Result<(), String> {
    #[cfg(test)]
    if FAIL_CLEAR_FOR_TESTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(root)
    {
        return with(root, |journal| {
            journal.quarantined = true;
            Err("synthetic failure to clear the Gemini jobs".to_string())
        });
    }
    with(root, |journal| journal.clear())
}

/// Folders whose clearing fails, for tests of the restore lifecycle.
#[cfg(test)]
pub(crate) static FAIL_CLEAR_FOR_TESTS: Mutex<std::collections::BTreeSet<PathBuf>> =
    Mutex::new(std::collections::BTreeSet::new());

/// Tests that simulate a new process start with an empty map for one folder.
#[cfg(test)]
pub(crate) fn forget_open_for_tests(root: &Path) {
    let mut guard = OPEN.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(map) = guard.as_mut() {
        map.remove(root);
    }
}

#[cfg(test)]
#[path = "gemini_jobs_tests.rs"]
mod tests;
