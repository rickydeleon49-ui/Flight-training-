//! GEN-REL-02 job journal: checkpoints, restart reconstruction, the shared
//! lock and the bounds. Synthetic answers only; each test has its own folder.

use std::path::{Path, PathBuf};

use serde_json::json;

use super::*;

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "hfd-gemini-jobs-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn answer(title: &str) -> Value {
    json!({"title": title, "summary": "Synthetic.", "sections": [], "flashcards": [], "sourceNotes": "", "model": "gemini-3.5-flash"})
}

#[test]
fn a_validated_answer_survives_a_restart_as_a_checkpoint() {
    let dir = TempDir::new("checkpoint");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&id, answer("Guide A")).unwrap();

    let reopened = Journal::open(dir.path());
    let jobs = reopened.list();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].id, id);
    assert_eq!(jobs[0].stage, JobStage::Ready);
    assert_eq!(jobs[0].material_id, "mat-a");
    assert_eq!(jobs[0].relative_path, "documents/a.pdf");
    assert_eq!(jobs[0].content_sha256, SHA);
    assert_eq!(jobs[0].result, Some(answer("Guide A")));
}

#[test]
fn a_job_running_when_the_app_closed_is_interrupted_not_resent() {
    let dir = TempDir::new("interrupted");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::PracticeTest, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    drop(journal);

    let mut reopened = Journal::open(dir.path());
    let job = reopened.list().into_iter().find(|j| j.id == id).unwrap();
    assert_eq!(job.stage, JobStage::Interrupted);
    assert!(job.result.is_none());
    // A late outcome for it cannot revive it.
    reopened.ready(&id, answer("Late")).unwrap();
    assert_eq!(reopened.list()[0].stage, JobStage::Interrupted);
    // The lock is free: she can deliberately try again.
    assert!(reopened
        .begin(JobKind::StudyAid, "mat-b", "documents/b.pdf", SHA, None)
        .is_ok());
    // And the interruption is on disk, so a second restart agrees.
    let again = Journal::open(dir.path());
    assert!(again
        .list()
        .iter()
        .any(|j| j.id == id && j.stage == JobStage::Interrupted));
}

#[test]
fn only_one_job_runs_at_a_time_whatever_page_asked() {
    let dir = TempDir::new("lock");
    let mut journal = Journal::open(dir.path());
    let first = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    assert_eq!(
        journal.begin(JobKind::PracticeTest, "mat-b", "documents/b.pdf", SHA, None),
        Err(BUSY.to_string())
    );
    journal.failed(&first, "Synthetic failure.").unwrap();
    assert!(journal
        .begin(JobKind::PracticeTest, "mat-b", "documents/b.pdf", SHA, None)
        .is_ok());
}

#[test]
fn acknowledging_forgets_a_finished_job_but_never_a_running_one() {
    let dir = TempDir::new("ack");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    assert_eq!(journal.acknowledge(&id), Ok(false), "still running");
    journal.ready(&id, answer("Guide")).unwrap();
    assert_eq!(journal.acknowledge("job-not-a-real-id"), Ok(false));
    assert_eq!(journal.acknowledge(&id), Ok(true));
    assert!(Journal::open(dir.path()).list().is_empty());
}

#[test]
fn asking_again_replaces_that_materials_older_outcome_and_the_journal_is_bounded() {
    let dir = TempDir::new("bound");
    let mut journal = Journal::open(dir.path());
    let old = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.failed(&old, "Synthetic failure.").unwrap();
    let new = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&new, answer("Guide")).unwrap();
    let ids: Vec<String> = journal.list().into_iter().map(|j| j.id).collect();
    assert_eq!(ids, vec![new.clone()]);

    // Fill well past the bound with failed jobs: the ready answer is kept.
    for i in 0..(MAX_JOBS + 3) {
        let id = journal
            .begin(
                JobKind::PracticeTest,
                &format!("mat-{i}"),
                "documents/x.pdf",
                SHA,
                None,
            )
            .unwrap();
        journal.failed(&id, "Synthetic failure.").unwrap();
    }
    let jobs = journal.list();
    assert_eq!(jobs.len(), MAX_JOBS);
    assert!(
        jobs.iter().any(|j| j.id == new),
        "a ready answer is kept last"
    );
}

#[test]
fn an_answer_too_large_to_keep_fails_honestly() {
    let dir = TempDir::new("large");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    let huge = json!({"title": "x".repeat(MAX_RESULT_BYTES + 1)});
    journal.ready(&id, huge).unwrap();
    let job = &journal.list()[0];
    assert_eq!(job.stage, JobStage::Failed);
    assert!(job.result.is_none());
    assert!(job.error.as_deref().unwrap().contains("too large"));
}

#[test]
fn an_unreadable_journal_is_set_aside_not_trusted_or_deleted() {
    for (label, bytes) in [
        ("garbage", b"{not json".to_vec()),
        (
            "schema",
            br#"{"schema":"something-else/9","jobs":[]}"#.to_vec(),
        ),
    ] {
        let dir = TempDir::new(label);
        std::fs::write(dir.path().join(JOURNAL_FILE), &bytes).unwrap();
        let journal = Journal::open(dir.path());
        assert!(journal.list().is_empty(), "{label}");
        let aside = set_aside_files(dir.path());
        assert_eq!(aside.len(), 1, "{label}");
        assert_eq!(
            std::fs::read(&aside[0]).unwrap(),
            bytes,
            "{label}: kept as it was"
        );
    }
}

/// Set-aside unreadable journals (timestamped form), sorted.
fn set_aside_files(root: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(JOURNAL_UNREADABLE_PREFIX) && n.ends_with(".json"))
        })
        .collect();
    found.sort();
    found
}

/// JOBS-QUARANTINE: a set-aside journal is diagnostic only. The launch that
/// set it aside, and every later one, accepts new work.
#[test]
fn an_unreadable_journal_set_aside_never_blocks_this_or_a_later_launch() {
    let dir = TempDir::new("unreadable-not-sticky");
    std::fs::write(dir.path().join(JOURNAL_FILE), b"{not json").unwrap();

    let mut first = Journal::open(dir.path());
    assert!(
        first.list().is_empty(),
        "nothing from the bad journal is offered"
    );
    assert_eq!(set_aside_files(dir.path()).len(), 1);
    let fresh = read(dir.path());
    assert!(
        fresh.0.is_empty() && fresh.1 == ReadOutcome::Read,
        "a fresh, empty journal replaces it"
    );
    let id = first
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .expect("the same launch accepts new work");
    first.failed(&id, "synthetic").unwrap();
    assert_eq!(first.acknowledge(&id), Ok(true));

    // Next launch: the set-aside file is still there and changes nothing.
    let mut second = Journal::open(dir.path());
    assert!(second
        .begin(JobKind::PracticeTest, "mat-b", "documents/b.pdf", SHA, None)
        .is_ok());

    // A second bad journal never overwrites the first set-aside copy.
    std::fs::write(dir.path().join(JOURNAL_FILE), b"also bad").unwrap();
    let mut third = Journal::open(dir.path());
    let aside = set_aside_files(dir.path());
    assert_eq!(aside.len(), 2, "both copies kept");
    assert_eq!(std::fs::read(&aside[0]).unwrap(), b"{not json");
    assert_eq!(std::fs::read(&aside[1]).unwrap(), b"also bad");
    assert!(third
        .begin(JobKind::StudyAid, "mat-c", "documents/c.pdf", SHA, None)
        .is_ok());
}

/// Older versions left `gemini-jobs.unreadable.json` behind, and its mere
/// presence blocked every launch. It is now left in place and ignored.
#[test]
fn a_legacy_unreadable_marker_does_not_block() {
    let dir = TempDir::new("legacy-unreadable");
    let legacy = dir.path().join("gemini-jobs.unreadable.json");
    std::fs::write(&legacy, b"{old}").unwrap();
    let mut journal = Journal::open(dir.path());
    assert!(journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .is_ok());
    assert_eq!(std::fs::read(&legacy).unwrap(), b"{old}", "never deleted");
}

/// If the bad journal cannot be set aside, this launch has no clean journal:
/// nothing is offered or started, and the refusal does not claim a restore.
#[cfg(unix)]
#[test]
fn an_unreadable_journal_that_cannot_be_set_aside_blocks_only_that_launch() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new("unreadable-stuck");
    std::fs::write(dir.path().join(JOURNAL_FILE), b"{not json").unwrap();
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    let mut stuck = Journal::open(dir.path());
    let refused = stuck.begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None);
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(stuck.list().is_empty());
    assert_eq!(refused, Err(UNREADABLE.to_string()));
    assert!(!UNREADABLE.contains("restor"));
    assert_eq!(
        std::fs::read(dir.path().join(JOURNAL_FILE)).unwrap(),
        b"{not json",
        "left untouched, never trusted"
    );

    // Once the folder is writable again, the next launch recovers.
    let mut next = Journal::open(dir.path());
    assert_eq!(set_aside_files(dir.path()).len(), 1);
    assert!(next
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .is_ok());
}

#[test]
fn recorded_identities_are_checked_on_the_way_in_and_out() {
    let dir = TempDir::new("identity");
    let mut journal = Journal::open(dir.path());
    assert!(journal
        .begin(JobKind::StudyAid, "", "documents/a.pdf", SHA, None)
        .is_err());
    assert!(journal
        .begin(JobKind::StudyAid, "mat\u{0}a", "documents/a.pdf", SHA, None)
        .is_err());
    assert!(journal
        .begin(
            JobKind::StudyAid,
            &"m".repeat(201),
            "documents/a.pdf",
            SHA,
            None
        )
        .is_err());
    // A hand-edited record with a bad id is dropped when read.
    let text = json!({"schema": SCHEMA, "jobs": [{
        "id": "../../etc", "kind": "study-aid", "materialId": "mat-a",
        "relativePath": "documents/a.pdf", "contentSha256": SHA, "stage": "ready",
        "createdAt": 0, "updatedAt": 0
    }]});
    std::fs::write(dir.path().join(JOURNAL_FILE), text.to_string()).unwrap();
    assert!(Journal::open(dir.path()).list().is_empty());
}

#[test]
fn the_journal_is_replaced_whole_and_leaves_no_partial_file() {
    let dir = TempDir::new("atomic");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&id, answer("Guide")).unwrap();
    assert!(!dir.path().join(JOURNAL_WRITING).exists());
    let on_disk: Value =
        serde_json::from_slice(&std::fs::read(dir.path().join(JOURNAL_FILE)).unwrap()).unwrap();
    assert_eq!(on_disk["schema"], SCHEMA);
    assert_eq!(on_disk["jobs"][0]["stage"], "ready");
}

/* ------------------------------------------------------------------ */
/* Review round 1 regressions (GENREL02-R1, R2, R3, R6, R8)            */
/* ------------------------------------------------------------------ */

/// Make the journal unwritable by putting a directory where its temporary
/// file goes; removing it makes the journal writable again.
fn block_writes(dir: &TempDir) {
    std::fs::create_dir_all(dir.path().join(JOURNAL_WRITING)).unwrap();
}

fn unblock_writes(dir: &TempDir) {
    std::fs::remove_dir_all(dir.path().join(JOURNAL_WRITING)).unwrap();
}

#[test]
fn r1_a_job_that_cannot_be_written_down_never_holds_the_lock() {
    let dir = TempDir::new("r1-begin");
    let mut journal = Journal::open(dir.path());
    block_writes(&dir);
    assert!(journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .is_err());
    assert!(journal.list().is_empty(), "nothing exists only in memory");
    unblock_writes(&dir);
    assert!(
        journal
            .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
            .is_ok(),
        "no restart needed"
    );
}

#[test]
fn r2_a_checkpoint_that_cannot_be_written_is_reported_and_releases_the_lock() {
    let dir = TempDir::new("r2-ready");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    block_writes(&dir);
    assert!(journal.ready(&id, answer("Guide")).is_err());
    assert!(journal.list().is_empty(), "released, not claimed as kept");
    unblock_writes(&dir);
    assert!(journal
        .begin(JobKind::PracticeTest, "mat-b", "documents/b.pdf", SHA, None)
        .is_ok());
    // A restart never presents that job as a finished, saveable answer: the
    // window was told the answer is held only by itself.
    let restarted = Journal::open(dir.path());
    assert!(restarted
        .list()
        .iter()
        .all(|j| !(j.id == id && j.stage == JobStage::Ready)));
}

#[test]
fn r3_an_acknowledgement_that_cannot_be_written_can_be_retried() {
    let dir = TempDir::new("r3-ack");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(
            JobKind::StudyAid,
            "mat-a",
            "documents/a.pdf",
            SHA,
            Some("2026-10-18T10:00:00.000Z"),
        )
        .unwrap();
    journal.ready(&id, answer("Guide")).unwrap();
    block_writes(&dir);
    assert!(journal.acknowledge(&id).is_err());
    assert_eq!(journal.list().len(), 1, "kept, so it can be retried");
    unblock_writes(&dir);
    assert_eq!(journal.acknowledge(&id), Ok(true));
    assert!(Journal::open(dir.path()).list().is_empty());
}

#[test]
fn r3_the_revision_a_job_was_asked_to_replace_is_kept_with_it() {
    let dir = TempDir::new("r3-base");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(
            JobKind::StudyAid,
            "mat-a",
            "documents/a.pdf",
            SHA,
            Some("2026-10-18T10:00:00.000Z"),
        )
        .unwrap();
    journal.ready(&id, answer("Guide")).unwrap();
    let job = &Journal::open(dir.path()).list()[0];
    assert_eq!(
        job.base_revision.as_deref(),
        Some("2026-10-18T10:00:00.000Z")
    );
}

#[test]
fn r6_a_waiting_answer_is_never_replaced_by_asking_again() {
    let dir = TempDir::new("r6");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&id, answer("Guide")).unwrap();
    assert_eq!(
        journal.begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None),
        Err(WAITING.to_string())
    );
    assert_eq!(journal.list()[0].result, Some(answer("Guide")));
    // A different output for the same material is a different request.
    assert!(journal
        .begin(JobKind::PracticeTest, "mat-a", "documents/a.pdf", SHA, None)
        .is_ok());
}

#[test]
fn r8_restoring_a_backup_forgets_every_job_of_the_replaced_library() {
    let dir = TempDir::new("r8");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&id, answer("Guide")).unwrap();
    journal.clear().unwrap();
    assert!(journal.list().is_empty());
    assert!(Journal::open(dir.path()).list().is_empty(), "on disk too");
}

/* ------------------------------------------------------------------ */
/* Review round 2 regressions (GENREL02-R10, R11)                      */
/* ------------------------------------------------------------------ */

#[test]
fn r10_a_full_journal_of_waiting_answers_refuses_a_new_request_and_loses_none() {
    let dir = TempDir::new("r10");
    let mut journal = Journal::open(dir.path());
    for i in 0..MAX_JOBS {
        let id = journal
            .begin(
                JobKind::StudyAid,
                &format!("mat-{i}"),
                "documents/x.pdf",
                SHA,
                None,
            )
            .unwrap();
        journal.ready(&id, answer(&format!("Guide {i}"))).unwrap();
    }
    assert_eq!(
        journal.begin(JobKind::StudyAid, "mat-new", "documents/n.pdf", SHA, None),
        Err(FULL.to_string())
    );
    let kept = Journal::open(dir.path()).list();
    assert_eq!(kept.len(), MAX_JOBS);
    assert!(kept.iter().all(|j| j.stage == JobStage::Ready));
}

#[test]
fn r11_clearing_succeeds_only_when_no_old_job_can_be_read_back() {
    let dir = TempDir::new("r11-clear");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&id, answer("Guide")).unwrap();
    // The rewrite fails, but the file can still be removed: cleared.
    block_writes(&dir);
    assert!(journal.clear().is_ok());
    assert!(!dir.path().join(JOURNAL_FILE).exists());
    unblock_writes(&dir);
}

/* ------------------------------------------------------------------ */
/* Review round 3 regressions (GENREL02-R14)                           */
/* ------------------------------------------------------------------ */

#[test]
fn r14_a_journal_beside_an_unfinished_restore_offers_nothing_until_cleared() {
    let dir = TempDir::new("r14-marker");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&id, answer("Before the restore")).unwrap();
    std::fs::write(dir.path().join(crate::backup::RESTORE_JOURNAL_FILE), b"{}").unwrap();

    let mut reopened = Journal::open(dir.path());
    assert!(reopened.list().is_empty(), "the old answer is not offered");
    assert_eq!(reopened.acknowledge(&id), Ok(false));
    assert_eq!(
        reopened.begin(JobKind::PracticeTest, "mat-b", "documents/b.pdf", SHA, None),
        Err(RESTORING.to_string())
    );
    reopened.clear().unwrap();
    assert!(reopened
        .begin(JobKind::PracticeTest, "mat-b", "documents/b.pdf", SHA, None)
        .is_ok());
    assert!(reopened.list().iter().all(|j| j.id != id));
}

#[cfg(unix)]
#[test]
fn r14_a_clear_that_really_fails_keeps_the_launch_quarantined() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new("r14-fail");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&id, answer("Before the restore")).unwrap();
    // Neither a rewrite nor a removal is possible in a read-only folder.
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    let cleared = journal.clear();
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(cleared.is_err());
    assert!(
        std::fs::read_to_string(dir.path().join(JOURNAL_FILE))
            .unwrap()
            .contains("Before the restore"),
        "still on disk"
    );
    assert!(journal.list().is_empty(), "but never offered");
    assert_eq!(
        journal.begin(JobKind::StudyAid, "mat-b", "documents/b.pdf", SHA, None),
        Err(RESTORING.to_string()),
        "and nothing new starts this launch, so a later retry cannot clear new work"
    );
}

/* ------------------------------------------------------------------ */
/* Review round 4 regression (GENREL02-R16)                            */
/* ------------------------------------------------------------------ */

#[test]
fn r16_eight_maximum_size_jobs_fit_the_journal_and_read_back() {
    // Each job may hold a draft and a result at the per-answer cap; eight of
    // them fit the journal with headroom, so a paid answer is never refused
    // because others are waiting.
    assert!(MAX_JOURNAL_BYTES >= (MAX_JOBS * 2 * MAX_RESULT_BYTES) as u64 * 3 / 2);
    let dir = TempDir::new("r16");
    let mut journal = Journal::open(dir.path());
    let near = MAX_RESULT_BYTES - 64;
    let mut kept = Vec::new();
    for i in 0..MAX_JOBS {
        let id = journal
            .begin(
                JobKind::StudyAid,
                &format!("mat-{i}"),
                "documents/x.pdf",
                SHA,
                None,
            )
            .unwrap();
        journal
            .ready(&id, json!({"title": "x".repeat(near)}))
            .unwrap();
        kept.push(id);
    }
    // Everything kept reads back intact after a restart.
    let reopened = Journal::open(dir.path());
    let ready: Vec<String> = reopened
        .list()
        .into_iter()
        .filter(|j| j.stage == JobStage::Ready)
        .map(|j| j.id)
        .collect();
    assert_eq!(ready, kept);
    assert!(set_aside_files(dir.path()).is_empty());
}

/* ------------------------------------------------------------------ */
/* GEN-REL-04: cancellation                                            */
/* ------------------------------------------------------------------ */

#[test]
fn a_cancelled_job_stays_cancelled_after_a_restart_and_is_never_resent() {
    let dir = TempDir::new("cancelled");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    assert!(journal.cancel(&id).unwrap().cancelled);
    // Its late answer cannot revive it.
    journal.ready(&id, answer("Late")).unwrap();
    let reopened = Journal::open(dir.path());
    let job = reopened.list().into_iter().find(|j| j.id == id).unwrap();
    assert_eq!(job.stage, JobStage::Cancelled);
    assert!(job.result.is_none());
    // Cancelling again, or a job that does not exist, changes nothing.
    let mut reopened = reopened;
    assert_eq!(
        reopened.cancel(&id).unwrap(),
        CancelOutcome {
            cancelled: false,
            stage: Some(JobStage::Cancelled),
            pending: false
        }
    );
    assert_eq!(
        reopened.cancel("job-000000000000000000000000").unwrap(),
        CancelOutcome {
            cancelled: false,
            stage: None,
            pending: false
        }
    );
    // She can dismiss it.
    assert_eq!(reopened.acknowledge(&id), Ok(true));
}

#[test]
fn a_cancel_that_cannot_be_written_changes_nothing() {
    let dir = TempDir::new("cancel-unwritable");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    block_writes(&dir);
    assert!(journal.cancel(&id).is_err());
    assert_eq!(
        journal.list()[0].stage,
        JobStage::Running,
        "not cancelled in memory only"
    );
    unblock_writes(&dir);
}

#[test]
fn cancelled_jobs_make_room_like_failed_ones() {
    let dir = TempDir::new("cancel-evict");
    let mut journal = Journal::open(dir.path());
    for i in 0..MAX_JOBS {
        let id = journal
            .begin(
                JobKind::StudyAid,
                &format!("mat-{i}"),
                "documents/x.pdf",
                SHA,
                None,
            )
            .unwrap();
        journal.cancel(&id).unwrap();
        // Its command then settles, as every command does.
        journal.failed(&id, "settled after the cancel").unwrap();
    }
    assert!(journal
        .begin(JobKind::StudyAid, "mat-new", "documents/n.pdf", SHA, None)
        .is_ok());
    assert_eq!(journal.list().len(), MAX_JOBS);
}

/* ------------------------------------------------------------------ */
/* Review round 2 regressions (GENREL04-R6)                            */
/* ------------------------------------------------------------------ */

#[test]
fn r6_a_cancelled_job_keeps_its_record_until_its_command_settles() {
    let dir = TempDir::new("r6-live");
    let mut journal = Journal::open(dir.path());
    let id = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    assert!(journal.cancel(&id).unwrap().cancelled);
    assert!(journal.is_live(&id));
    // Not dismissed, replaced or pushed out while its command is finishing.
    assert_eq!(journal.acknowledge(&id), Ok(false));
    assert_eq!(
        journal.begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None),
        Err(BUSY.to_string())
    );
    assert!(journal
        .list()
        .iter()
        .any(|j| j.id == id && j.stage == JobStage::Cancelled));
    // The command settles (its late answer is refused); now it may go.
    journal.ready(&id, answer("Late")).unwrap();
    assert!(!journal.is_live(&id));
    assert_eq!(journal.list()[0].stage, JobStage::Cancelled);
    assert_eq!(journal.acknowledge(&id), Ok(true));
}

#[test]
fn cancellation_versus_final_checkpoint_is_atomic_and_survives_reopen() {
    for turn in 0..20 {
        let dir = TempDir::new("fix2-checkpoint-race");
        let id = with(dir.path(), |j| {
            j.begin(JobKind::StudyAid, "mat-race", "documents/a.pdf", SHA, None)
        })
        .unwrap();
        with(dir.path(), |j| {
            j.checkpoint_draft(&id, json!({"earlier":"validated draft"}))
        })
        .unwrap();
        let gate = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            let id = &id;
            let dir = &dir;
            let gate = &gate;
            scope.spawn(move || {
                gate.wait();
                if turn % 2 == 0 {
                    std::thread::yield_now();
                }
                with(dir.path(), |j| j.cancel(id)).unwrap();
            });
            gate.wait();
            if turn % 2 == 1 {
                std::thread::yield_now();
            }
            with(dir.path(), |j| j.ready(id, answer("Completed"))).unwrap();
        });
        let reopened = Journal::open(dir.path());
        let record = &reopened.list()[0];
        match record.stage {
            JobStage::Cancelled => {
                assert!(record.result.is_none());
                assert_eq!(record.draft.as_ref().unwrap()["earlier"], "validated draft");
            }
            JobStage::Ready => assert_eq!(record.result, Some(answer("Completed"))),
            _ => panic!("race left an unsettled job"),
        }
        assert!(!reopened.admits(&id));
    }
}

#[test]
fn kits_on_eight_pdfs_then_saved_do_not_block_gemini() {
    let dir = TempDir::new("kits-gemini");
    let mut journal = Journal::open(dir.path());
    let mut ids = Vec::new();
    for i in 0..MAX_JOBS {
        let id = journal
            .begin_pdf_kit(
                &format!("mat-{i}"),
                &format!("documents/{i}.pdf"),
                SHA,
                json!({"runId": format!("run-{i}")}),
            )
            .unwrap();
        journal
            .finish_pdf_kit(&id, json!({"runId": format!("run-{i}"), "candidates": {}}))
            .unwrap();
        ids.push(id);
    }
    // 8 unacknowledged kit drafts fill the journal and block Gemini generations with FULL.
    assert_eq!(
        journal.begin(JobKind::StudyAid, "mat-new", "documents/n.pdf", SHA, None),
        Err(FULL.to_string())
    );
    // Once saved, the kits are acknowledged and removed from the journal.
    for id in &ids {
        assert_eq!(journal.acknowledge(id), Ok(true));
    }
    // With slots freed, Gemini generations proceed.
    assert!(journal
        .begin(JobKind::StudyAid, "mat-new", "documents/n.pdf", SHA, None)
        .is_ok());
}

#[test]
fn pdf_kit_admission_distinguishes_same_other_full_and_recovery() {
    let dir = TempDir::new("kit-admission");
    let mut j = Journal::open(dir.path());
    let draft = json!({"candidates": null});
    let id = j.begin_pdf_kit("a", "a.pdf", SHA, draft.clone()).unwrap();
    assert_eq!(
        j.begin_pdf_kit("a", "a.pdf", SHA, draft.clone()),
        Err(PdfKitBeginError::ExistsSame {
            job_id: id.clone(),
            material_id: "a".into()
        })
    );
    assert_eq!(
        j.begin_pdf_kit("b", "b.pdf", SHA, draft.clone()),
        Err(PdfKitBeginError::InProgressOther {
            job_id: id.clone(),
            material_id: "a".into()
        })
    );
    j.finish_pdf_kit(&id, draft.clone()).unwrap();
    // A ready kit on another PDF is offered by the UI, but does not prevent
    // local work on another PDF; preserve the existing concurrency policy.
    for stage in [JobStage::Ready, JobStage::Failed, JobStage::Interrupted] {
        j.jobs[0].stage = stage;
        assert_eq!(
            j.begin_pdf_kit("a", "a.pdf", SHA, draft.clone()),
            Err(PdfKitBeginError::ExistsSame {
                job_id: id.clone(),
                material_id: "a".into()
            })
        );
    }
    j.jobs[0].stage = JobStage::Ready;
    for i in 1..MAX_JOBS {
        let next = j
            .begin_pdf_kit(&format!("m-{i}"), "b.pdf", SHA, draft.clone())
            .unwrap();
        j.finish_pdf_kit(&next, draft.clone()).unwrap();
    }
    assert_eq!(
        j.begin_pdf_kit("new", "n.pdf", SHA, draft.clone()),
        Err(PdfKitBeginError::Full)
    );
    // Existing work takes precedence over capacity so she gets its actions.
    assert!(matches!(
        j.begin_pdf_kit("a", "a.pdf", SHA, draft.clone()),
        Err(PdfKitBeginError::ExistsSame { .. })
    ));
    j.quarantined = true;
    assert_eq!(
        j.begin_pdf_kit("new", "n.pdf", SHA, draft),
        Err(PdfKitBeginError::Recovery)
    );
}

#[test]
fn pdf_kit_cancelled_record_is_kept_while_live_then_acknowledged_for_replacement() {
    let dir = TempDir::new("kit-cancel-cleanup");
    let mut j = Journal::open(dir.path());
    let draft = json!({"candidates": null});
    let id = j.begin_pdf_kit("a", "a.pdf", SHA, draft.clone()).unwrap();
    assert!(j.cancel(&id).unwrap().cancelled);
    assert_eq!(j.acknowledge(&id), Ok(false));
    assert!(matches!(
        j.begin_pdf_kit("a", "a.pdf", SHA, draft.clone()),
        Err(PdfKitBeginError::ExistsSame { .. })
    ));
    assert!(matches!(
        j.begin_pdf_kit("b", "b.pdf", SHA, draft.clone()),
        Err(PdfKitBeginError::InProgressOther { .. })
    ));
    assert_eq!(j.list()[0].stage, JobStage::Cancelled);
    j.failed(&id, "Stopped").unwrap(); // Worker settled, without overwriting cancel.
    let replacement = j.begin_pdf_kit("a", "a.pdf", SHA, draft).unwrap();
    assert_ne!(replacement, id);
    let reopened = Journal::open(dir.path());
    assert_eq!(reopened.list().len(), 1);
    assert_eq!(reopened.list()[0].id, replacement);
}

#[test]
fn pdf_kit_cancel_cleanup_failure_preserves_record() {
    let dir = TempDir::new("kit-cancel-write");
    let mut j = Journal::open(dir.path());
    let draft = json!({"candidates": null});
    let id = j.begin_pdf_kit("a", "a.pdf", SHA, draft.clone()).unwrap();
    j.cancel(&id).unwrap();
    j.failed(&id, "Stopped").unwrap();
    // The atomic journal temporary path cannot be opened as a file.
    std::fs::create_dir(dir.path().join(JOURNAL_WRITING)).unwrap();
    assert_eq!(
        j.begin_pdf_kit("a", "a.pdf", SHA, draft),
        Err(PdfKitBeginError::Storage)
    );
    assert_eq!(j.list()[0].id, id);
    assert_eq!(
        Journal::open(dir.path()).list()[0].stage,
        JobStage::Cancelled
    );
}

/// Set aside, but the fresh journal cannot be written: no clean journal this
/// launch, so nothing new starts. The original is only copied aside, so it is
/// still the journal: the next launch, once writable, recovers every valid
/// Ready answer she has not saved yet.
#[test]
fn an_unreadable_journal_whose_fresh_replacement_cannot_be_written_keeps_its_ready_jobs() {
    let dir = TempDir::new("unreadable-no-fresh");
    let (mut disk, a, b) = two_good_jobs(&dir);
    disk["jobs"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id": "job-from-a-newer-build", "kind": "kind-from-the-future"}));
    let original = serde_json::to_vec(&disk).unwrap();
    std::fs::write(dir.path().join(JOURNAL_FILE), &original).unwrap();
    // A directory where the writer's temporary file goes makes every write fail.
    std::fs::create_dir(dir.path().join(JOURNAL_WRITING)).unwrap();
    let mut blocked = Journal::open(dir.path());
    assert_eq!(
        set_aside_files(dir.path()).len(),
        1,
        "set aside all the same"
    );
    assert_eq!(
        blocked.begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None),
        Err(UNREADABLE.to_string())
    );
    assert_eq!(
        std::fs::read(dir.path().join(JOURNAL_FILE)).unwrap(),
        original,
        "the failed rewrite leaves the original journal in place"
    );
    std::fs::remove_dir(dir.path().join(JOURNAL_WRITING)).unwrap();
    let mut next = Journal::open(dir.path());
    assert_eq!(ids(&next), vec![a, b], "the Ready answers survive");
    assert!(next.list().iter().all(|j| j.stage == JobStage::Ready));
    assert_eq!(read(dir.path()).1, ReadOutcome::Read, "now rewritten clean");
    assert!(next
        .begin(JobKind::StudyAid, "mat-c", "documents/c.pdf", SHA, None)
        .is_ok());
}

/// The copy just made is never the one pruned, even when earlier set-aside
/// files carry later stamps (the Mac's clock went backwards).
#[test]
fn pruning_never_removes_the_copy_just_set_aside() {
    let dir = TempDir::new("set-aside-clock");
    let future = u128::from(u64::MAX) - 10;
    for step in 0..6u128 {
        std::fs::write(
            dir.path()
                .join(format!("{JOURNAL_UNREADABLE_PREFIX}{}.json", future + step)),
            b"old",
        )
        .unwrap();
    }
    std::fs::write(dir.path().join(JOURNAL_FILE), b"{not json").unwrap();
    Journal::open(dir.path());
    let aside = set_aside_files(dir.path());
    assert_eq!(aside.len(), 5);
    assert!(aside
        .iter()
        .any(|p| std::fs::read(p).unwrap() == b"{not json"));
}

/* ------------------------------------------------------------------ */
/* JOBS-QUARANTINE follow-up: tolerant per-record read, set-aside cap   */
/* ------------------------------------------------------------------ */

/// A valid journal with two good jobs; returns its JSON and the two ids.
fn two_good_jobs(dir: &TempDir) -> (Value, String, String) {
    let mut journal = Journal::open(dir.path());
    let a = journal
        .begin(JobKind::StudyAid, "mat-a", "documents/a.pdf", SHA, None)
        .unwrap();
    journal.ready(&a, answer("Kept A")).unwrap();
    let b = journal
        .begin(JobKind::PracticeTest, "mat-b", "documents/b.pdf", SHA, None)
        .unwrap();
    journal.ready(&b, answer("Kept B")).unwrap();
    let disk: Value =
        serde_json::from_slice(&std::fs::read(dir.path().join(JOURNAL_FILE)).unwrap()).unwrap();
    (disk, a, b)
}

fn ids(journal: &Journal) -> Vec<String> {
    journal.list().into_iter().map(|j| j.id).collect()
}

#[test]
fn one_bad_job_among_good_ones_keeps_the_good_ones_and_sets_the_file_aside() {
    let dir = TempDir::new("tolerant-bad");
    let (mut disk, a, b) = two_good_jobs(&dir);
    disk["jobs"]
        .as_array_mut()
        .unwrap()
        .insert(1, json!({"id": "", "kind": "study-aid"}));
    let original = serde_json::to_vec(&disk).unwrap();
    std::fs::write(dir.path().join(JOURNAL_FILE), &original).unwrap();

    let mut journal = Journal::open(dir.path());
    assert_eq!(ids(&journal), vec![a.clone(), b.clone()]);
    let aside = set_aside_files(dir.path());
    assert_eq!(aside.len(), 1);
    assert_eq!(std::fs::read(&aside[0]).unwrap(), original, "nothing lost");
    let fresh = read(dir.path());
    assert_eq!(fresh.1, ReadOutcome::Read, "the rewritten journal is clean");
    assert_eq!(fresh.0.len(), 2);
    assert!(journal
        .begin(JobKind::StudyAid, "mat-c", "documents/c.pdf", SHA, None)
        .is_ok());
}

#[test]
fn an_unknown_job_kind_or_field_from_a_newer_build_never_drops_the_others() {
    let dir = TempDir::new("tolerant-unknown");
    let (mut disk, a, b) = two_good_jobs(&dir);
    // A future field on a known job is ignored, not fatal.
    disk["jobs"][0]["someFutureField"] = json!({"x": 1});
    let mut future = disk["jobs"][1].clone();
    future["id"] = json!("job-from-a-newer-build");
    future["kind"] = json!("kind-from-the-future");
    disk["jobs"].as_array_mut().unwrap().push(future);
    std::fs::write(
        dir.path().join(JOURNAL_FILE),
        serde_json::to_vec(&disk).unwrap(),
    )
    .unwrap();

    let journal = Journal::open(dir.path());
    assert_eq!(ids(&journal), vec![a, b]);
    assert_eq!(
        set_aside_files(dir.path()).len(),
        1,
        "the unknown job is kept aside"
    );
}

#[test]
fn duplicate_ids_are_dropped_together_and_whole_file_failures_still_set_aside() {
    let dir = TempDir::new("tolerant-dup");
    let (mut disk, _a, b) = two_good_jobs(&dir);
    let copy = disk["jobs"][0].clone();
    disk["jobs"].as_array_mut().unwrap().push(copy);
    std::fs::write(
        dir.path().join(JOURNAL_FILE),
        serde_json::to_vec(&disk).unwrap(),
    )
    .unwrap();
    assert_eq!(ids(&Journal::open(dir.path())), vec![b]);

    // Whole-file failures (wrong schema; too many jobs) keep nothing.
    let dir = TempDir::new("tolerant-envelope");
    let (mut disk, _, _) = two_good_jobs(&dir);
    let job = disk["jobs"][0].clone();
    disk["jobs"] = json!(vec![job; MAX_JOBS + 1]);
    std::fs::write(
        dir.path().join(JOURNAL_FILE),
        serde_json::to_vec(&disk).unwrap(),
    )
    .unwrap();
    assert!(Journal::open(dir.path()).list().is_empty());
    assert_eq!(set_aside_files(dir.path()).len(), 1);
}

#[test]
fn only_the_five_newest_set_aside_files_are_kept_and_nothing_else_is_touched() {
    let dir = TempDir::new("set-aside-cap");
    for stamp in 1..=6u32 {
        std::fs::write(
            dir.path()
                .join(format!("{JOURNAL_UNREADABLE_PREFIX}{stamp}.json")),
            stamp.to_string(),
        )
        .unwrap();
    }
    let others = [
        "gemini-jobs.unreadable.json",
        "gemini-jobs.unreadable-notes.json",
        "gemini-jobs.unreadable-12.json.bak",
        "unrelated.json",
    ];
    for name in others {
        std::fs::write(dir.path().join(name), name).unwrap();
    }
    // The seventh set-aside (current time, so the newest).
    std::fs::write(dir.path().join(JOURNAL_FILE), b"{not json").unwrap();
    Journal::open(dir.path());

    let aside = set_aside_files(dir.path());
    let kept: Vec<String> = aside
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .filter(|n| {
            n[JOURNAL_UNREADABLE_PREFIX.len()..n.len() - 5]
                .bytes()
                .all(|b| b.is_ascii_digit())
        })
        .collect();
    assert_eq!(kept.len(), 5, "{kept:?}");
    for gone in [1, 2] {
        assert!(!dir
            .path()
            .join(format!("{JOURNAL_UNREADABLE_PREFIX}{gone}.json"))
            .exists());
    }
    assert!(kept
        .iter()
        .any(|n| std::fs::read(dir.path().join(n)).unwrap() == b"{not json"));
    for name in others {
        assert_eq!(
            std::fs::read(dir.path().join(name)).unwrap(),
            name.as_bytes(),
            "{name} untouched"
        );
    }
}
