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
//! The journal holds no key or source bytes. A guide draft may hold a native-only
//! authenticated prepared-file reference; public serialization redacts it. Otherwise:
//! only the job's identity (which material, which stored file, the SHA-256 of
//! the bytes that were sent), its stage and the validated answer. It is not part
//! of a backup (backups carry only the database, its log, the manifest and
//! `documents/`). A finished job is removed once the window has saved or
//! dismissed it. At most `MAX_JOBS` are kept.
//!
//! Format: `{"schema": "hfd-gemini-jobs/1", "jobs": [...]}`, written beside the
//! target and renamed over it. Each job is read on its own: a record this
//! build cannot read (a job kind from a newer build, say) is dropped, and the
//! others are kept. A journal that cannot be read, or that had any record
//! dropped, is first set aside as `gemini-jobs.unreadable-<unix-ms>.json`
//! (never overwriting an earlier one; only the 5 newest are kept) rather than
//! trusted or silently deleted, and a fresh journal holding the valid jobs is
//! written. The set-aside copy is diagnostic only: its presence never blocks a
//! later launch. Only a launch that cannot set the bad journal aside, or cannot
//! write the fresh one, refuses new work. A legacy `gemini-jobs.unreadable.json`
//! from older versions is left where it is and ignored.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const JOURNAL_FILE: &str = "gemini-jobs.json";
const JOURNAL_WRITING: &str = "gemini-jobs.json.writing";
/// Prefix of a set-aside unreadable journal: `<prefix><unix-ms>.json`.
const JOURNAL_UNREADABLE_PREFIX: &str = "gemini-jobs.unreadable-";
const SCHEMA: &str = "hfd-gemini-jobs/1";

/// Jobs kept at once. A new job never pushes out a running one.
pub(crate) const MAX_JOBS: usize = 8;
/// A journal larger than this is not read. Every job may hold a draft and a
/// result, each up to MAX_RESULT_BYTES, so this is MAX_JOBS of those with 50%
/// headroom (8 × 2 × 4 MiB × 1.5 = 96 MiB): a paid answer that fits its own
/// cap is never refused because other jobs are waiting.
const MAX_JOURNAL_BYTES: u64 = (MAX_JOBS * 2 * MAX_RESULT_BYTES * 3 / 2) as u64;
/// One validated answer (or draft) kept as a checkpoint. A guide of 40
/// sections at study_sets::MAX_BODY (20,000 characters) each, even at 4 UTF-8
/// bytes a character, is about 3.2 MB, so 4 MiB keeps it after it was paid.
const MAX_RESULT_BYTES: usize = 4 * 1024 * 1024;
/// Identity fields the window passes in.
const MAX_ID_BYTES: usize = 200;

pub(crate) const BUSY: &str =
    "Gemini is already working on another study aid. Wait for it to finish, then try again.";
pub(crate) const FULL: &str =
    "Several finished answers are waiting to be saved or discarded. Save or discard one of them first, so none is lost.";
pub(crate) const RESTORING: &str =
    "Her Flight Deck is still finishing restoring a backup, so Gemini cannot be asked for anything new yet. Quit and reopen the app to finish.";
/// This launch could not set an unreadable jobs list aside and start a fresh
/// one. Reopening retries that. Provider-neutral, so it needs no variant.
pub(crate) const UNREADABLE: &str =
    "Her Flight Deck couldn't read its list of AI jobs and couldn't start a fresh one, so nothing new can be asked yet. Quit and reopen the app, then try again.";
pub(crate) const WAITING: &str =
    "A finished answer for this document is waiting to be saved or discarded. Save or discard it first, so it is not lost.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum JobKind {
    StudyAid,
    PracticeTest,
    PdfKit,
    StudyKit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum JobStage {
    Running,
    Ready,
    Failed,
    Interrupted,
    /// She cancelled it while it ran (GEN-REL-04). Never resent.
    Cancelled,
}

/// What asking to cancel a job came to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelOutcome {
    /// True if the job was still running and is now recorded as cancelled.
    pub cancelled: bool,
    /// The job's stage now, if it is known.
    pub stage: Option<JobStage>,
    /// True if no job for this request had begun yet: the cancel is held, and
    /// the job will be refused before anything is sent.
    #[serde(default)]
    pub pending: bool,
}

/// Cancels held for requests whose job has not begun yet.
const MAX_PENDING_CANCELS: usize = 32;

#[derive(Clone, PartialEq, Serialize, Deserialize)]
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
    /// The window's own id for the request (GEN-REL-04), so it can cancel the
    /// job before it has learned the job's id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub stage: JobStage,
    pub created_at: i64,
    pub updated_at: i64,
    /// The validated answer, once `ready`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Partial batches are never a publishable result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(serialize_with = "serialize_public_draft")]
    pub draft: Option<Value>,
    /// What went wrong, once `failed`; already written for her.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn serialize_public_draft<S: serde::Serializer>(
    draft: &Option<Value>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut public = draft.clone();
    if let Some(Value::Object(d)) = public.as_mut() {
        d.remove("preparedFile");
    }
    public.serialize(serializer)
}
impl std::fmt::Debug for JobRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Use the same redaction boundary for diagnostic formatting and IPC.
        match serde_json::to_string(self) {
            Ok(public) => f.write_str(&public),
            Err(_) => f.write_str("[generation job]"),
        }
    }
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

/// Admission failures stay structured until the PDF-kit IPC boundary.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PdfKitBeginError {
    ExistsSame { job_id: String, material_id: String },
    InProgressOther { job_id: String, material_id: String },
    Full,
    Recovery,
    Invalid,
    Storage,
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
    /// What a refusal says while `quarantined`: `RESTORING`, or `UNREADABLE`
    /// when only the jobs list itself could not be replaced.
    refusal: &'static str,
    /// Requests cancelled before their job began (GEN-REL-04). Checked under
    /// the same lock as `begin`, so a cancel can never slip between them.
    pending_cancels: Vec<String>,
    /// Jobs whose command is still running, cancelled or not (GENREL04-R6).
    /// Until the command has settled, its record (and so its cancel decision)
    /// cannot be acknowledged, replaced or evicted, and nothing new begins.
    live: std::collections::HashSet<String>,
}

impl Journal {
    /// Read the journal as a freshly started app does: anything still
    /// `running` was cut off by the app closing, so it becomes `interrupted`.
    pub(crate) fn open(root: &Path) -> Journal {
        let (mut jobs, outcome) = read(root);
        let mut changed = false;
        for job in &mut jobs {
            if job.stage == JobStage::Running {
                job.stage = JobStage::Interrupted;
                job.updated_at = now();
                changed = true;
            }
            if let Some(draft) = job.draft.as_mut() {
                if draft.get("kind").and_then(Value::as_str) == Some("guide-sections-v1") {
                    if let Some(state) = draft.get("queueState").and_then(Value::as_str) {
                        if state == "running" || state == "paused" {
                            draft["queueState"] = serde_json::json!("waiting-for-her");
                            changed = true;
                        }
                    }
                }
            }
        }
        if changed {
            // If this cannot be written, the disk still says `running`, and the
            // next start reads that as interrupted too: the same answer.
            let _ = write(root, &jobs);
        }
        let unclean = match outcome {
            ReadOutcome::Read => false,
            // The original was set aside; write a fresh journal holding only
            // the jobs that were valid. Only if that fails is there no clean
            // journal this launch.
            ReadOutcome::SetAside => write(root, &jobs).is_err(),
            ReadOutcome::Stuck => true,
        };
        // A restore marker beside the journal means a restore committed
        // and has not finished tidying up: its old jobs are not trusted.
        let restoring = root.join(crate::backup::RESTORE_JOURNAL_FILE).exists();
        Journal {
            root: root.to_path_buf(),
            jobs,
            quarantined: restoring || unclean,
            refusal: if restoring { RESTORING } else { UNREADABLE },
            pending_cancels: Vec::new(),
            live: std::collections::HashSet::new(),
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
        self.live.remove(id);
        self.jobs.retain(|j| j.id != id);
        let _ = write(&self.root, &self.jobs);
    }

    pub(crate) fn list(&self) -> Vec<JobRecord> {
        if self.quarantined {
            return Vec::new();
        }
        self.jobs.clone()
    }

    /// Merge timing atomically with the latest card reservations, never a stale draft.
    pub(crate) fn checkpoint_timing(&mut self, id: &str, timing: Value) -> Result<(), String> {
        if !self.admits(id) {
            return Err("The generation is no longer running.".into());
        }
        let mut draft = self
            .jobs
            .iter()
            .find(|j| j.id == id)
            .and_then(|j| j.draft.clone())
            .unwrap_or_else(|| serde_json::json!({"admissions": 0}));
        if draft.get("target").is_some() {
            draft["remainingMillis"] = timing["remainingMillis"].clone();
            draft["deadline"] =
                serde_json::json!(timing["deadlineUtc"].as_u64().unwrap_or(0) / 1000);
        }
        draft["timing"] = timing;
        self.checkpoint_draft(id, draft)
    }

    /// Start a job. Only one runs at a time, whatever page asked.
    #[cfg(test)]
    pub(crate) fn begin(
        &mut self,
        kind: JobKind,
        material_id: &str,
        relative_path: &str,
        content_sha256: &str,
        base_revision: Option<&str>,
    ) -> Result<String, String> {
        self.begin_request(
            kind,
            material_id,
            relative_path,
            content_sha256,
            base_revision,
            None,
        )
    }

    /// `begin`, for a request the window can cancel by its own id. A request
    /// already cancelled is refused here, before anything is sent.
    pub(crate) fn begin_request(
        &mut self,
        kind: JobKind,
        material_id: &str,
        relative_path: &str,
        content_sha256: &str,
        base_revision: Option<&str>,
        request_id: Option<&str>,
    ) -> Result<String, String> {
        if self.quarantined {
            return Err(self.refusal.to_string());
        }
        if let Some(request) = request_id {
            if !valid_identity(request) {
                return Err(
                    "That study material could not be identified, so nothing was sent.".to_string(),
                );
            }
            if let Some(at) = self.pending_cancels.iter().position(|r| r == request) {
                self.pending_cancels.remove(at);
                return Err(crate::gemini_cancel::CANCELLED.to_string());
            }
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
        // One at a time, until the previous command has fully settled: a
        // cancelled job's command may still be finishing.
        if !self.live.is_empty() || self.jobs.iter().any(|j| j.stage == JobStage::Running) {
            return Err(BUSY.to_string());
        }
        // A finished answer is never thrown away by asking again: she saves or
        // discards it first.
        if self.jobs.iter().any(|j| {
            j.material_id == material_id
                && j.stage == JobStage::Ready
                && (j.kind == kind
                    || kind == JobKind::StudyKit
                    || (j.kind == JobKind::StudyKit && {
                        let part = if kind == JobKind::PracticeTest {
                            "questions"
                        } else if request_id.is_some_and(|id| id.starts_with("flashcards:")) {
                            "cards"
                        } else {
                            "guide"
                        };
                        j.result
                            .as_ref()
                            .is_some_and(|r| r["parts"][part].get("answer").is_some())
                    }))
        }) {
            return Err(WAITING.to_string());
        }
        // An older failed or interrupted outcome of the same request is
        // replaced: she asked again.
        let carried = self
            .jobs
            .iter()
            .find(|j| j.material_id == material_id && j.kind == kind && j.draft.is_some())
            .cloned();
        if self.jobs.iter().any(|j| {
            j.material_id == material_id
                && j.kind == kind
                && j.draft.as_ref().is_some_and(|d| d.get("kind").is_some())
        }) {
            return Err("Resume or explicitly discard the earlier versioned draft first.".into());
        }
        if let Some(old) = &carried {
            if old.relative_path != relative_path
                || old.content_sha256 != content_sha256
                || old.base_revision.as_deref() != base_revision
            {
                return Err("The source or saved content changed. Discard the earlier draft before starting again.".to_string());
            }
        }
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
                .filter(|(_, j)| {
                    matches!(
                        j.stage,
                        JobStage::Failed | JobStage::Interrupted | JobStage::Cancelled
                    ) && j.draft.is_none()
                })
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
            request_id: request_id.map(str::to_string),
            stage: JobStage::Running,
            created_at: at,
            updated_at: at,
            result: None,
            draft: carried.and_then(|j| j.draft),
            error: None,
        });
        self.commit(next)?;
        self.live.insert(id.clone());
        Ok(id)
    }

    /// Local PDF work has its own slot and never enters provider admission.
    pub(crate) fn begin_pdf_kit(
        &mut self,
        material: &str,
        path: &str,
        hash: &str,
        draft: Value,
    ) -> Result<String, PdfKitBeginError> {
        if self.quarantined {
            return Err(PdfKitBeginError::Recovery);
        }
        // Cancellation is durable until its worker settles. Only then may the
        // normal acknowledgement path remove it; never erase a live cancel.
        let cancelled: Vec<String> = self
            .jobs
            .iter()
            .filter(|j| {
                j.kind == JobKind::PdfKit
                    && j.material_id == material
                    && j.stage == JobStage::Cancelled
            })
            .map(|j| j.id.clone())
            .collect();
        for id in cancelled {
            self.acknowledge(&id)
                .map_err(|_| PdfKitBeginError::Storage)?;
        }
        if let Some(j) = self
            .jobs
            .iter()
            .find(|j| j.kind == JobKind::PdfKit && j.material_id == material)
        {
            return Err(PdfKitBeginError::ExistsSame {
                job_id: j.id.clone(),
                material_id: j.material_id.clone(),
            });
        }
        if let Some(j) = self.jobs.iter().find(|j| {
            j.kind == JobKind::PdfKit && (j.stage == JobStage::Running || self.live.contains(&j.id))
        }) {
            return Err(PdfKitBeginError::InProgressOther {
                job_id: j.id.clone(),
                material_id: j.material_id.clone(),
            });
        }
        if self.jobs.len() >= MAX_JOBS {
            return Err(PdfKitBeginError::Full);
        }
        if !valid_identity(material)
            || !valid_identity(path)
            || serde_json::to_vec(&draft)
                .map_err(|_| PdfKitBeginError::Invalid)?
                .len()
                > MAX_RESULT_BYTES
        {
            return Err(PdfKitBeginError::Invalid);
        }
        let id = new_id();
        let mut next = self.jobs.clone();
        next.push(JobRecord {
            id: id.clone(),
            kind: JobKind::PdfKit,
            material_id: material.into(),
            relative_path: path.into(),
            content_sha256: hash.into(),
            base_revision: None,
            request_id: None,
            stage: JobStage::Running,
            created_at: now(),
            updated_at: now(),
            result: None,
            draft: Some(draft),
            error: None,
        });
        self.commit(next).map_err(|_| PdfKitBeginError::Storage)?;
        self.live.insert(id.clone());
        Ok(id)
    }
    pub(crate) fn pdf_kit_running(&self, id: &str) -> bool {
        !self.quarantined
            && self
                .jobs
                .iter()
                .any(|j| j.id == id && j.kind == JobKind::PdfKit && j.stage == JobStage::Running)
    }
    pub(crate) fn finish_pdf_kit(&mut self, id: &str, draft: Value) -> Result<(), String> {
        if !self.pdf_kit_running(id) {
            return Err("PDF kit cancelled.".into());
        }
        if serde_json::to_vec(&draft)
            .map_err(|_| "Invalid PDF kit")?
            .len()
            > MAX_RESULT_BYTES
        {
            return Err("The PDF kit is too large to keep. Choose fewer pages.".into());
        }
        self.settle(id, |j| {
            j.draft = Some(draft);
            j.stage = JobStage::Ready;
        })
    }

    #[cfg(test)]
    pub(crate) fn test_replace_pdf_draft(&mut self, id: &str, draft: Value) -> Result<(), String> {
        let mut next = self.jobs.clone();
        next.iter_mut().find(|j| j.id == id).ok_or("missing")?.draft = Some(draft);
        self.commit(next)
    }

    /// Queue study guide sections without starting or requiring an idle engine.
    pub(crate) fn queue_sections(
        &mut self,
        material: &str,
        path: &str,
        hash: &str,
        revision: Option<&str>,
        request: Option<&str>,
        draft: Value,
    ) -> Result<String, String> {
        if self.quarantined {
            return Err(self.refusal.to_string());
        }
        let supersedes = draft.get("supersedes").and_then(Value::as_str);
        let prior = self.jobs.iter().any(|j| {
            j.material_id == material
                && j.kind == JobKind::StudyAid
                && j.draft.as_ref().and_then(|d| d.get("kind")).is_some()
        });
        let consented_restart = supersedes.is_some_and(|id| {
            self.jobs.iter().any(|j| {
                j.id == id
                    && j.material_id == material
                    && j.kind == JobKind::StudyAid
                    && j.draft.is_some()
            })
        });
        if prior && !consented_restart {
            return Err(
                "Resume the earlier guide or explicitly consent to start a new one.".into(),
            );
        }
        if self.jobs.iter().any(|j| {
            j.material_id == material
                && j.stage == JobStage::Ready
                && ((j.kind == JobKind::StudyAid && j.draft.is_none())
                    || (j.kind == JobKind::StudyKit
                        && j.result
                            .as_ref()
                            .is_some_and(|r| r["parts"]["guide"].get("answer").is_some())))
        }) {
            return Err(WAITING.into());
        }
        if self.jobs.len() >= MAX_JOBS {
            return Err(FULL.into());
        }
        if !valid_identity(material)
            || !valid_identity(path)
            || revision.is_some_and(|v| !valid_identity(v))
            || request.is_some_and(|v| !valid_identity(v))
        {
            return Err("Invalid study-guide identity.".into());
        }
        if request.is_some_and(|r| self.pending_cancels.iter().any(|v| v == r)) {
            return Err(crate::gemini_cancel::CANCELLED.into());
        }
        if serde_json::to_vec(&draft).map_err(|e| e.to_string())?.len() > MAX_RESULT_BYTES {
            return Err("The draft is too large to keep.".into());
        }
        let id = new_id();
        let mut next = self.jobs.clone();
        next.push(JobRecord {
            id: id.clone(),
            kind: JobKind::StudyAid,
            material_id: material.into(),
            relative_path: path.into(),
            content_sha256: hash.into(),
            base_revision: revision.map(str::to_string),
            request_id: request.map(str::to_string),
            stage: JobStage::Interrupted,
            created_at: now(),
            updated_at: now(),
            result: None,
            draft: Some(draft),
            error: None,
        });
        self.commit(next)?;
        Ok(id)
    }

    /// Section drafts never evict another outcome, including an earlier partial
    /// draft explicitly retained by Start a new guide.
    pub(crate) fn begin_sections(
        &mut self,
        material: &str,
        path: &str,
        hash: &str,
        revision: Option<&str>,
        request: Option<&str>,
        draft: Value,
    ) -> Result<String, String> {
        if !self.live.is_empty() || self.jobs.iter().any(|j| j.stage == JobStage::Running) {
            return Err(BUSY.into());
        }
        self.queue_sections(material, path, hash, revision, request, draft)
    }

    /// One worker owns an activation until its guard settles, even after Cancel.
    pub(crate) fn activate_sections(&mut self, id: &str) -> Result<(), String> {
        if self.quarantined {
            return Err(self.refusal.to_string());
        }
        if !self.live.is_empty() || self.jobs.iter().any(|j| j.stage == JobStage::Running) {
            return Err(BUSY.into());
        }
        let mut next = self.jobs.clone();
        let job = next
            .iter_mut()
            .find(|j| j.id == id)
            .ok_or("Draft record missing")?;
        if job
            .draft
            .as_ref()
            .and_then(|v| v.get("kind"))
            .and_then(Value::as_str)
            != Some("guide-sections-v1")
        {
            return Err("Unknown study-guide draft; kept for recovery.".into());
        }
        job.stage = JobStage::Running;
        job.error = None;
        job.updated_at = now();
        self.commit(next)?;
        self.live.insert(id.into());
        Ok(())
    }

    pub(crate) fn sections_ready(&mut self, id: &str, result: Value) -> Result<(), String> {
        if serde_json::to_vec(&result)
            .map_err(|e| e.to_string())?
            .len()
            > MAX_RESULT_BYTES
        {
            return Err("The guide is too large to keep.".into());
        }
        if !self.admits(id) {
            return Err(crate::gemini_cancel::CANCELLED.into());
        }
        self.settle(id, |job| {
            job.stage = JobStage::Ready;
            job.result = Some(result);
        })
    }

    #[cfg(test)]
    pub(crate) fn test_expire_sections(&mut self, id: &str) {
        let mut next = self.jobs.clone();
        let draft = next
            .iter_mut()
            .find(|j| j.id == id)
            .unwrap()
            .draft
            .as_mut()
            .unwrap();
        draft["timing"]["deadlineUtc"] = serde_json::json!(1);
        draft["timing"]["remainingMillis"] = serde_json::json!(0);
        self.commit(next).unwrap();
    }

    /// May this job send its next request (GENREL04-R8/R9)? Only while it is
    /// still running. Asked under the journal lock, the same lock under which
    /// a cancel is recorded, so a cancel that is recorded first always wins:
    /// no request is admitted after it, whether or not its work has been
    /// woken yet.
    pub(crate) fn admits(&self, id: &str) -> bool {
        !self.quarantined
            && self
                .jobs
                .iter()
                .any(|j| j.id == id && j.stage == JobStage::Running)
    }

    /// Conservative whole-job transport bound: admission checks include every
    /// HTTP dispatch, plus pauses and cancellation probes. Counting all checks
    /// can stop early but can never permit more than 512 dispatched requests.
    pub(crate) fn admit_bounded(&mut self, id: &str) -> bool {
        if !self.admits(id) {
            return false;
        }
        let Some(mut draft) = self
            .jobs
            .iter()
            .find(|j| j.id == id)
            .and_then(|j| j.draft.clone())
        else {
            return true;
        };
        let n = draft
            .get("admissions")
            .and_then(Value::as_u64)
            .unwrap_or(512);
        if n >= 512 {
            return false;
        }
        draft["admissions"] = Value::from(n + 1);
        self.checkpoint_draft(id, draft).is_ok()
    }

    #[cfg(test)]
    pub(crate) fn is_live(&self, id: &str) -> bool {
        self.live.contains(id)
    }

    /// Persist partial work without changing admission or making it saveable.
    pub(crate) fn checkpoint_draft(&mut self, id: &str, draft: Value) -> Result<(), String> {
        if !self.admits(id) {
            return Err(crate::gemini_cancel::CANCELLED.to_string());
        }
        if serde_json::to_vec(&draft).map_err(|e| e.to_string())?.len() > MAX_RESULT_BYTES {
            return Err("The draft is too large to keep.".to_string());
        }
        let mut next = self.jobs.clone();
        let job = next
            .iter_mut()
            .find(|j| j.id == id)
            .ok_or("Draft record missing")?;
        job.draft = Some(draft);
        job.updated_at = now();
        self.commit(next)
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
            job.draft = None;
        })
    }

    pub(crate) fn failed(&mut self, id: &str, message: &str) -> Result<(), String> {
        self.settle(id, |job| {
            job.stage = JobStage::Failed;
            job.error = Some(message.to_string());
        })
    }

    /// Move a running job to its outcome, on disk first.
    /// The owning command is done with this job: whatever its outcome, it is
    /// no longer live.
    fn settle(&mut self, id: &str, change: impl FnOnce(&mut JobRecord)) -> Result<(), String> {
        self.live.remove(id);
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
                if let Some(job) = self
                    .jobs
                    .iter_mut()
                    .find(|j| j.id == id && j.draft.is_some())
                {
                    // The prior on-disk running record still holds the draft.
                    // Do not erase it while reporting a failed final write.
                    job.stage = JobStage::Interrupted;
                    job.error = Some(error.clone());
                } else {
                    self.abandon(id);
                }
                Err(error)
            }
        }
    }

    /// She asked to cancel this job. It is cancelled only if it is still
    /// running: a job that already finished keeps its outcome. Recorded on
    /// disk first; only then may its work be stopped.
    pub(crate) fn cancel(&mut self, id: &str) -> Result<CancelOutcome, String> {
        if !valid_job_id(id) || self.quarantined {
            return Ok(CancelOutcome {
                cancelled: false,
                stage: None,
                pending: false,
            });
        }
        let is_waiting = self.jobs.iter().any(|j| {
            j.id == id
                && j.draft
                    .as_ref()
                    .and_then(|d| d.get("queueState"))
                    .and_then(Value::as_str)
                    == Some("waiting-for-her")
        });
        if is_waiting {
            let mut next = self.jobs.clone();
            next.retain(|j| j.id != id);
            self.commit(next)?;
            return Ok(CancelOutcome {
                cancelled: true,
                stage: None,
                pending: false,
            });
        }
        let stage = self.jobs.iter().find(|j| j.id == id).map(|j| j.stage);
        if stage != Some(JobStage::Running) {
            return Ok(CancelOutcome {
                cancelled: false,
                stage,
                pending: false,
            });
        }
        let mut next = self.jobs.clone();
        if let Some(job) = next.iter_mut().find(|j| j.id == id) {
            job.stage = JobStage::Cancelled;
            job.error = Some(crate::gemini_cancel::CANCELLED.to_string());
            job.updated_at = now();
            if let Some(draft) = job.draft.as_mut() {
                if draft.get("queueState").is_some() {
                    draft["queueState"] = serde_json::json!("cancelled");
                }
            }
        }
        self.commit(next)?;
        Ok(CancelOutcome {
            cancelled: true,
            stage: Some(JobStage::Cancelled),
            pending: false,
        })
    }

    /// Cancel by the window's request id. If that request's job has not begun
    /// yet, the cancel is held, and `begin_request` will refuse it. Returns the
    /// outcome and, when known, the job's id.
    pub(crate) fn cancel_request(
        &mut self,
        request_id: &str,
    ) -> Result<(CancelOutcome, Option<String>), String> {
        if !valid_identity(request_id) || self.quarantined {
            return Ok((
                CancelOutcome {
                    cancelled: false,
                    stage: None,
                    pending: false,
                },
                None,
            ));
        }
        let job = self
            .jobs
            .iter()
            .find(|j| j.request_id.as_deref() == Some(request_id))
            .map(|j| j.id.clone());
        match job {
            Some(id) => {
                let outcome = self.cancel(&id)?;
                Ok((outcome, Some(id)))
            }
            None => {
                if !self.pending_cancels.iter().any(|r| r == request_id) {
                    if self.pending_cancels.len() >= MAX_PENDING_CANCELS {
                        self.pending_cancels.remove(0);
                    }
                    self.pending_cancels.push(request_id.to_string());
                }
                Ok((
                    CancelOutcome {
                        cancelled: false,
                        stage: None,
                        pending: true,
                    },
                    None,
                ))
            }
        }
    }

    /// The window saved or dismissed this job: forget it. A failed write keeps
    /// it, so the window can try again.
    pub(crate) fn acknowledge(&mut self, id: &str) -> Result<bool, String> {
        // A job whose command is still finishing keeps its record, so its
        // cancel decision cannot be erased.
        if !valid_job_id(id) || self.quarantined || self.live.contains(id) {
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

    /// A kit stays one bounded job until every part was saved or dismissed.
    /// Commit removal of just this part before acknowledging it to the window.
    pub(crate) fn acknowledge_kit_part(&mut self, id: &str) -> Result<bool, String> {
        let Some((parent, part)) = id.split_once('#') else {
            return Ok(false);
        };
        if !["guide", "cards", "questions"].contains(&part)
            || self.quarantined
            || self.live.contains(parent)
        {
            return Ok(false);
        }
        let mut next = self.jobs.clone();
        let Some(job) = next
            .iter_mut()
            .find(|j| j.id == parent && j.kind == JobKind::StudyKit && j.stage == JobStage::Ready)
        else {
            return Ok(false);
        };
        let Some(parts) = job
            .result
            .as_mut()
            .and_then(|r| r.get_mut("parts"))
            .and_then(Value::as_object_mut)
        else {
            return Ok(false);
        };
        if parts.remove(part).is_none() {
            return Ok(false);
        }
        if parts.is_empty() {
            next.retain(|j| j.id != parent);
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
                    self.refusal = RESTORING;
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
    // The only private serializer: IPC/Debug always use JobRecord's redacted
    // draft. Durability must retain the native descriptor across every write.
    let mut private = serde_json::to_value(&file)
        .map_err(|_| "Could not keep track of this study aid.".to_string())?;
    for (index, job) in jobs.iter().enumerate() {
        if let Some(draft) = &job.draft {
            private["jobs"][index]["draft"] = draft.clone();
        }
    }
    let bytes = serde_json::to_vec(&private)
        .map_err(|_| "Could not keep track of this study aid.".to_string())?;
    // Never write a journal the reader would refuse: the earlier one, and
    // every checkpoint in it, stays as it was.
    if bytes.len() as u64 > MAX_JOURNAL_BYTES {
        return Err(
            "Too many large answers are waiting to be saved. Save or discard some of them first."
                .to_string(),
        );
    }
    use std::io::Write;
    let writing = root.join(JOURNAL_WRITING);
    let mut file = std::fs::File::create(&writing)
        .map_err(|e| format!("Could not keep track of this study aid: {e}"))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("Could not sync this study aid: {e}"))?;
    drop(file);
    std::fs::rename(&writing, root.join(JOURNAL_FILE)).map_err(|e| {
        let _ = std::fs::remove_file(&writing);
        format!("Could not keep track of this study aid: {e}")
    })?;
    // A successful checkpoint includes the directory entry, not just file bytes.
    #[cfg(unix)]
    std::fs::File::open(root)
        .and_then(|dir| dir.sync_all())
        .map_err(|e| format!("Could not sync the study-aid directory: {e}"))?;
    Ok(())
}

/// How `read` found the journal.
#[derive(Debug, PartialEq, Eq)]
enum ReadOutcome {
    /// Read, or absent: nothing to distrust.
    Read,
    /// Unreadable in whole or in part, and moved aside under a unique
    /// diagnostic name; the valid jobs (if any) are still to be rewritten.
    SetAside,
    /// Unreadable, and still in place: nothing clean this launch.
    Stuck,
}

/// Move an unreadable journal to `gemini-jobs.unreadable-<unix-ms>.json`,
/// never over an earlier one. The caller holds the journal lock.
fn set_aside(root: &Path, path: &Path) -> std::io::Result<PathBuf> {
    let base = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    for step in 0..1000 {
        let target = root.join(format!("{JOURNAL_UNREADABLE_PREFIX}{}.json", base + step));
        if std::fs::symlink_metadata(&target).is_ok() {
            continue;
        }
        std::fs::rename(path, &target)?;
        prune_set_aside(root);
        return Ok(target);
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "no free name for the unreadable jobs list",
    ))
}

/// Set-aside copies kept at most; older ones are removed.
const MAX_SET_ASIDE: usize = 5;

/// Keep only the `MAX_SET_ASIDE` newest `gemini-jobs.unreadable-<digits>.json`.
/// Nothing else is touched, never the legacy `gemini-jobs.unreadable.json`.
fn prune_set_aside(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut found: Vec<(u128, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let stamp = name
                .strip_prefix(JOURNAL_UNREADABLE_PREFIX)?
                .strip_suffix(".json")?;
            if stamp.is_empty() || !stamp.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            if !entry.file_type().ok()?.is_file() {
                return None;
            }
            Some((stamp.parse().ok()?, entry.path()))
        })
        .collect();
    if found.len() <= MAX_SET_ASIDE {
        return;
    }
    found.sort();
    let excess = found.len() - MAX_SET_ASIDE;
    for (_, path) in found.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

/// The jobs on disk; an unreadable journal is set aside, never trusted.
fn read(root: &Path) -> (Vec<JobRecord>, ReadOutcome) {
    let path = root.join(JOURNAL_FILE);
    let too_large = std::fs::metadata(&path)
        .map(|m| m.len() > MAX_JOURNAL_BYTES)
        .unwrap_or(false);
    let parsed = if too_large {
        None
    } else {
        match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Envelope>(&bytes)
                .ok()
                .filter(|f| f.schema == SCHEMA && f.jobs.len() <= MAX_JOBS)
                .map(|f| keep_valid_jobs(f.jobs)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return (Vec::new(), ReadOutcome::Read)
            }
            Err(_) => None,
        }
    };
    match parsed {
        Some((jobs, false)) => (jobs, ReadOutcome::Read),
        // Something was dropped, or nothing could be read: the original is
        // kept aside first, so no record is ever lost by the rewrite.
        Some((jobs, true)) => match set_aside(root, &path) {
            Ok(_) => (jobs, ReadOutcome::SetAside),
            Err(_) => (Vec::new(), ReadOutcome::Stuck),
        },
        None => match set_aside(root, &path) {
            Ok(_) => (Vec::new(), ReadOutcome::SetAside),
            Err(_) => (Vec::new(), ReadOutcome::Stuck),
        },
    }
}

/// The journal's envelope, with each job still unparsed, so that one record
/// this build cannot read (a job kind from a newer build, say) never costs
/// the others.
#[derive(Deserialize)]
struct Envelope {
    schema: String,
    jobs: Vec<Value>,
}

/// Every job that parses and passes the per-job checks, and whether any was
/// dropped. Jobs sharing an id are all dropped: which one is real is unknown.
fn keep_valid_jobs(raw: Vec<Value>) -> (Vec<JobRecord>, bool) {
    let total = raw.len();
    let parsed: Vec<JobRecord> = raw
        .into_iter()
        .filter_map(|v| serde_json::from_value::<JobRecord>(v).ok())
        .filter(|j| {
            valid_job_id(&j.id)
                && valid_identity(&j.material_id)
                && valid_identity(&j.relative_path)
                && j.draft.as_ref().map_or(true, |d| {
                    serde_json::to_vec(d).is_ok_and(|b| b.len() <= MAX_RESULT_BYTES)
                })
                && j.result.as_ref().map_or(true, |d| {
                    serde_json::to_vec(d).is_ok_and(|b| b.len() <= MAX_RESULT_BYTES)
                })
        })
        .collect();
    let mut seen: HashMap<String, usize> = HashMap::new();
    for job in &parsed {
        *seen.entry(job.id.clone()).or_default() += 1;
    }
    let kept: Vec<JobRecord> = parsed.into_iter().filter(|j| seen[&j.id] == 1).collect();
    let dropped = kept.len() != total;
    (kept, dropped)
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
            journal.refusal = RESTORING;
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

#[cfg(test)]
pub(crate) fn forget(root: &Path) {
    OPEN.lock().unwrap().as_mut().unwrap().remove(root);
}
