//! Finishing or undoing an import that did not finish (design section 1).
//! The receipt row decides. Roll-forward is never done: an import with no
//! receipt is rolled back and she presses Add again.
//!
//! The only documents/ files this code may remove are ones this operation
//! created, proven by rules D1-D6. Any doubt keeps the file.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};

use super::fault;
use super::guard::pack_sql;
use super::journal::{self, Journal, JournalFile, State, FAILED_DIR, FILES_DIR};
use crate::library_lock::LibraryGuard;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Normal: an op dir whose receipt cannot be looked up is left for later.
    Normal,
    /// Restore staging: such an op dir is moved to `.failed/` instead.
    Restore,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    /// Receipt found: staging removed, the import stands.
    pub completed: u32,
    /// No receipt, files this operation moved were removed.
    pub rolled_back: u32,
    /// No receipt, nothing had been moved: staging removed.
    pub discarded: u32,
    /// Receipt lookup failed: left alone for the next call.
    pub left: u32,
    /// Moved to `.failed/`.
    pub quarantined: u32,
}

/// Does a receipt exist for this operation? Any failure to look is an error.
pub fn receipt_exists(root: &Path, op_id: &str) -> Result<bool, String> {
    let conn =
        super::open_library(root, true, 2000).map_err(|e| format!("lookup failed: {e}"))?;
    receipt_in(&conn, op_id)
}

fn receipt_in(conn: &Connection, op_id: &str) -> Result<bool, String> {
    conn.query_row(
        pack_sql("SELECT 1 FROM study_pack_imports WHERE operation_id = ?1")?,
        [op_id],
        |_| Ok(()),
    )
    .optional()
    .map(|r| r.is_some())
    .map_err(|e| format!("lookup failed: {e}"))
}

/// Reconcile every op dir. The caller holds the lock (`guard`) and, when the
/// library is not owned by this process, must not call this at all.
pub fn reconcile_locked(guard: &LibraryGuard, root: &Path, mode: Mode) -> Result<Report, String> {
    debug_assert!(guard.covers(root));
    let mut report = Report::default();
    let imports = journal::imports_dir(root);
    match std::fs::symlink_metadata(&imports) {
        Ok(meta) if meta.is_dir() && !crate::backup::is_symlink_or_reparse(&meta) => {}
        _ => return Ok(report),
    }
    let mut ops: Vec<PathBuf> = std::fs::read_dir(&imports)
        .map_err(|e| format!("Could not look at the study pack folder: {e}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name().and_then(|n| n.to_str()) != Some(FAILED_DIR)
                && std::fs::symlink_metadata(path)
                    .is_ok_and(|m| m.is_dir() && !crate::backup::is_symlink_or_reparse(&m))
        })
        .collect();
    ops.sort();
    for op in ops {
        match reconcile_op(root, &op, mode, &mut report) {
            Ok(()) => {}
            // A folder that can't be cleaned up must not block backups or
            // later imports: nothing was deleted, try it again next time.
            Err(_) if mode == Mode::Normal => report.left += 1,
            Err(e) => return Err(e),
        }
    }
    Ok(report)
}

/// One op dir. Errors are only for things this code cannot decide about at all
/// (it never deletes on doubt).
pub fn reconcile_op(root: &Path, op: &Path, mode: Mode, report: &mut Report) -> Result<(), String> {
    let name = op
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let journal = match journal::read(op) {
        Ok(journal) => journal,
        Err(_) if !op.join(journal::JOURNAL_FILE).exists() => {
            // The folder was made but no journal was ever written: nothing
            // could have been moved.
            remove_dir(op)?;
            report.discarded += 1;
            return Ok(());
        }
        Err(_) => {
            fail_closed(root, op, &name)?;
            report.quarantined += 1;
            return Ok(());
        }
    };
    match receipt_exists(root, &journal.op_id) {
        Err(_) => match mode {
            Mode::Normal => report.left += 1,
            Mode::Restore => {
                quarantine(root, op, &name)?;
                report.quarantined += 1;
            }
        },
        Ok(true) => {
            remove_dir(op)?;
            report.completed += 1;
        }
        Ok(false) => match journal.state {
            State::Preparing | State::Staged => {
                remove_dir(op)?;
                report.discarded += 1;
            }
            State::Installing | State::Installed | State::Committed => {
                match rollback(root, op, &journal) {
                    Ok(()) => {
                        remove_dir(op)?;
                        report.rolled_back += 1;
                    }
                    Err(_) => {
                        fail_closed(root, op, &name)?;
                        report.quarantined += 1;
                    }
                }
            }
        },
    }
    Ok(())
}

fn remove_dir(op: &Path) -> Result<(), String> {
    std::fs::remove_dir_all(op)
        .map_err(|e| format!("Could not clean up the study pack folder: {e}"))
}

fn failed_dir(root: &Path) -> Result<PathBuf, String> {
    let dir = journal::imports_dir(root).join(FAILED_DIR);
    if let Ok(meta) = std::fs::symlink_metadata(&dir) {
        if crate::backup::is_symlink_or_reparse(&meta) || !meta.is_dir() {
            return Err("Could not keep the study pack record.".into());
        }
    } else {
        std::fs::create_dir(&dir)
            .map_err(|e| format!("Could not keep the study pack record: {e}"))?;
    }
    Ok(dir)
}

/// Keep the journal for diagnosis, delete only the staged files, touch no
/// document.
fn fail_closed(root: &Path, op: &Path, name: &str) -> Result<(), String> {
    let kept = failed_dir(root)?.join(format!("{name}.json"));
    let journal = op.join(journal::JOURNAL_FILE);
    if journal.exists() {
        std::fs::rename(&journal, &kept)
            .map_err(|e| format!("Could not keep the study pack record: {e}"))?;
    }
    let _ = std::fs::remove_dir_all(op.join(FILES_DIR));
    remove_dir(op)
}

fn quarantine(root: &Path, op: &Path, name: &str) -> Result<(), String> {
    let dir = failed_dir(root)?;
    let mut target = dir.join(name);
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{name}-{n}"));
        n += 1;
    }
    std::fs::rename(op, &target).map_err(|e| format!("Could not set aside a study pack: {e}"))
}

/* ------------------------------------------------------------------ */
/* Rollback with the deletion rules D1-D6                              */
/* ------------------------------------------------------------------ */

/// Remove the files this operation put in documents/. `Err` means a rule
/// could not be decided: the caller keeps everything.
fn rollback(root: &Path, op: &Path, journal: &Journal) -> Result<(), String> {
    // D1: strict schema, op id equals the folder name, state in the set.
    if !matches!(
        journal.state,
        State::Installing | State::Installed | State::Committed
    ) {
        return Err("state".into());
    }
    let docs = root.join(crate::documents::DOCUMENTS_DIR);
    // D6: a half-finished hard-link move leaves the staged name beside the
    // destination. Remove the staged link first; D3 then applies.
    for f in &journal.files {
        let staged = op.join(FILES_DIR).join(f.n.to_string());
        if let Ok(meta) = std::fs::symlink_metadata(&staged) {
            if meta.is_file() && journal::file_id(&meta) == Some((f.dev, f.ino)) {
                std::fs::remove_file(&staged)
                    .map_err(|e| format!("Could not remove a staged study pack file: {e}"))?;
            }
        }
    }
    for f in &journal.files {
        remove_owned_file(root, &docs, journal, f)?;
    }
    Ok(())
}

fn owns_name(journal: &Journal, dest: &str) -> bool {
    // D2: `<material id>-<name>` where the id is one this journal generated.
    dest.len() > 37
        && dest.is_char_boundary(36)
        && dest.as_bytes()[36] == b'-'
        && journal.id_map.values().any(|m| m == &dest[..36])
        && !dest.contains('/')
}

fn remove_owned_file(
    root: &Path,
    docs: &Path,
    journal: &Journal,
    f: &JournalFile,
) -> Result<(), String> {
    if !owns_name(journal, &f.dest) {
        return Ok(()); // D2 fails: keep.
    }
    let Ok(path) = crate::documents::contained_document_path(docs, &f.dest) else {
        return Ok(());
    };
    let same_file = |path: &Path| -> Option<bool> {
        match std::fs::symlink_metadata(path) {
            Ok(meta) => Some(meta.is_file() && journal::file_id(&meta) == Some((f.dev, f.ino))),
            Err(_) => None,
        }
    };
    match same_file(&path) {
        None => return Ok(()),        // not there (never moved)
        Some(false) => return Ok(()), // D2/D3 fail: not the very file this op wrote
        Some(true) => {}
    }
    // D5: the reference check and the delete are one IMMEDIATE transaction on
    // a connection that holds the write lock, so no writer can link the file
    // in between.
    let mut conn =
        super::open_library(root, false, 2000).map_err(|e| format!("lookup failed: {e}"))?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("lookup failed: {e}"))?;
    if receipt_in(&tx, &journal.op_id)? {
        return Ok(()); // D4: it committed after all.
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Could not verify a study pack file: {e}"))?;
    if crate::documents::document_is_referenced(&tx, docs, &f.dest, &canonical)? {
        return Ok(());
    }
    if same_file(&path) != Some(true) {
        return Ok(());
    }
    fault::hit("rollback:between-check-and-remove")?;
    std::fs::remove_file(&path).map_err(|e| format!("Could not remove a study pack file: {e}"))?;
    tx.commit()
        .map_err(|e| format!("Could not finish cleaning up a study pack: {e}"))
}
