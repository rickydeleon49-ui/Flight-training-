//! Adding a study pack: stage, move the files in, commit, clean up
//! (design section 1). Every step is durable and ordered so that a stop at any
//! point leaves either nothing added or exactly one complete import, and the
//! only files ever removed are ones this operation created.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use super::commit::{self, CommitError, CommitInput};
use super::fault::{self, CRASH};
use super::format::{MAX_PDF_BYTES, MAX_PNG_BYTES};
use super::journal::{self, Journal, JournalFile, State, FILES_DIR};
use super::plan::{self, Decision, Plan};
use super::reconcile::{self, Mode};
use super::result::{read_result, PackResult};
use super::validate::{validate_pack, ValidatedPack};
use crate::library_lock::{try_acquire, Holder, LibraryGuard};

pub const UNSUPPORTED: &str = "Study packs can't be added to this library's storage yet.";
pub const RESTORE_FIRST: &str = "Finish the restore first.";
const NOT_ADDED: &str = "That study pack couldn't be added.";
const NO_SPACE: &str = "There isn't enough free space to add this study pack.";
const SPARE_BYTES: u64 = 256 * 1024 * 1024;

/// Why an import stopped.
enum Stop {
    /// The process "died": leave everything exactly as it is.
    Crash,
    /// Outcome unknown (COMMIT errored) or already committed: keep staging.
    Keep(String),
    /// Nothing was committed: undo what this operation did.
    Fail(String),
}

impl From<String> for Stop {
    fn from(message: String) -> Self {
        if message == CRASH {
            Stop::Crash
        } else {
            Stop::Fail(message)
        }
    }
}

/// Whether the storage can keep the promises this protocol makes (design D-c).
pub fn storage_ok(imports_dev: u64, documents_dev: u64, observed: [(u64, u64); 3]) -> bool {
    imports_dev == documents_dev
        && observed[0].1 != 0
        && observed.iter().all(|seen| *seen == observed[0])
}

#[cfg(unix)]
fn check_storage(root: &Path, op: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let docs = root.join(crate::documents::DOCUMENTS_DIR);
    std::fs::create_dir_all(&docs).map_err(|_| UNSUPPORTED.to_string())?;
    let imports = std::fs::metadata(journal::imports_dir(root)).map_err(|_| UNSUPPORTED)?;
    let documents = std::fs::metadata(&docs).map_err(|_| UNSUPPORTED)?;
    let probe = op.join("probe");
    std::fs::write(&probe, b"probe").map_err(|_| UNSUPPORTED)?;
    let look = || -> Result<(u64, u64), String> {
        let first = std::fs::symlink_metadata(&probe).map_err(|_| UNSUPPORTED)?;
        Ok((first.dev(), first.ino()))
    };
    let a = look()?;
    let b = look()?;
    let c = std::fs::File::open(&probe)
        .and_then(|f| f.metadata())
        .map(|m| (m.dev(), m.ino()))
        .map_err(|_| UNSUPPORTED)?;
    let _ = std::fs::remove_file(&probe);
    if storage_ok(imports.dev(), documents.dev(), [a, b, c]) {
        Ok(())
    } else {
        Err(UNSUPPORTED.to_string())
    }
}

#[cfg(not(unix))]
fn check_storage(_root: &Path, _op: &Path) -> Result<(), String> {
    Err(UNSUPPORTED.to_string())
}

fn fresh_id(conn: &Connection) -> String {
    crate::practice_sessions::generate_uuid_v4(conn).unwrap_or_else(|_| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        format!("{:08x}-0000-4000-8000-{:012x}", nanos as u32, (nanos >> 32) as u64 & 0xffff_ffff_ffff)
    })
}

fn read_only(root: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        root.join("her-flight-deck.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not open your library: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("Could not open your library: {e}"))?;
    Ok(conn)
}

fn sha256_of_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "That study pack can't be opened.".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|_| "That study pack can't be opened.".to_string())?;
        if n == 0 {
            return Ok(hex::encode(hasher.finalize()));
        }
        hasher.update(&buffer[..n]);
    }
}

/// Add a study pack. Takes the library lock once; busy gives one sentence.
pub fn add_study_pack_in(
    root: &Path,
    owned: bool,
    pack_path: &Path,
    op_id: &str,
) -> Result<PackResult, String> {
    let guard = try_acquire(root, Holder::Pack)?;
    add_locked(&guard, root, owned, pack_path, op_id)
}

pub fn add_locked(
    guard: &LibraryGuard,
    root: &Path,
    owned: bool,
    pack_path: &Path,
    op_id: &str,
) -> Result<PackResult, String> {
    debug_assert!(guard.covers(root));
    if !owned {
        return Err(UNSUPPORTED.to_string());
    }
    if root.join(crate::backup::RESTORE_PENDING_DIR).exists()
        || root.join(crate::backup::RESTORE_JOURNAL_FILE).exists()
    {
        return Err(RESTORE_FIRST.to_string());
    }
    if !crate::study_sets::is_lower_uuid_v4(op_id) {
        return Err(NOT_ADDED.to_string());
    }
    reconcile::reconcile_locked(guard, root, Mode::Normal)?;
    // A retry of an import that already committed answers from its receipt.
    if reconcile::receipt_exists(root, op_id)? {
        return read_result(&read_only(root)?, op_id)?.ok_or_else(|| NOT_ADDED.to_string());
    }
    let pack = validate_pack(pack_path)?;
    let pack_sha = sha256_of_file(pack_path)?;
    let op = journal::op_dir(root, op_id);
    let outcome = run(root, pack_path, op_id, &pack, &pack_sha, &op);
    match outcome {
        Ok(result) => Ok(result),
        Err(Stop::Crash) => Err(CRASH.to_string()),
        Err(Stop::Keep(message)) => Err(message),
        Err(Stop::Fail(message)) => {
            if op.exists() {
                // No receipt: whatever this operation did is undone, by the
                // same rules that undo it after a crash.
                let mut report = reconcile::Report::default();
                let _ = reconcile::reconcile_op(root, &op, Mode::Normal, &mut report);
            }
            Err(message)
        }
    }
}

fn run(
    root: &Path,
    pack_path: &Path,
    op_id: &str,
    pack: &ValidatedPack,
    pack_sha: &str,
    op: &Path,
) -> Result<PackResult, Stop> {
    journal::create_staging(root, op_id)?;
    check_storage(root, op)?;
    let mut journal = Journal {
        version: 1,
        op_id: op_id.to_string(),
        state: State::Preparing,
        pack_path: pack_path.to_string_lossy().into_owned(),
        pack_sha256: pack_sha.to_string(),
        id_map: BTreeMap::new(),
        files: Vec::new(),
    };
    journal::write(op, &journal)?;

    // Plan against the library as it is now.
    let plan = {
        let conn = read_only(root)?;
        let mut map: BTreeMap<String, String> = BTreeMap::new();
        let mut ids = |reference: &str| {
            map.entry(reference.to_string())
                .or_insert_with(|| fresh_id(&conn))
                .clone()
        };
        let plan = plan::compute(&conn, root, pack, &mut ids)?;
        drop(ids);
        journal.id_map = map;
        plan
    };
    journal.id_map.retain(|_, material| {
        plan.items
            .iter()
            .any(|p| p.decision == Decision::Add && p.material.as_deref() == Some(material))
    });

    stage_files(root, pack_path, pack, &plan, op, &mut journal)?;
    journal.state = State::Staged;
    journal::write(op, &journal)?;
    fault::hit("staged")?;

    journal.state = State::Installing;
    journal::write(op, &journal)?;
    fault::hit("installing")?;
    install_files(root, op, &journal)?;
    journal::sync(&root.join(crate::documents::DOCUMENTS_DIR), "fsync:documents")?;
    journal::sync(&op.join(FILES_DIR), "fsync:files-moved")?;
    journal.state = State::Installed;
    journal::write(op, &journal)?;
    fault::hit("installed")?;
    fault::hit("verify")?;
    verify_installed(root, &journal)?;

    let input = CommitInput {
        root,
        pack,
        op_id,
        pack_sha256: pack_sha,
        id_map: &journal.id_map,
        files: &journal.files,
        staged_plan: &plan,
    };
    match commit::commit(&input) {
        Ok(()) => {}
        Err(CommitError::Changed) => return Err(Stop::Fail(commit::CHANGED.to_string())),
        Err(CommitError::Failed(message)) => return Err(message.into()),
        Err(CommitError::Unknown(message)) => {
            return Err(if message == CRASH {
                Stop::Crash
            } else {
                Stop::Keep(message)
            })
        }
    }

    // The receipt must be found again on a fresh connection before any
    // recovery evidence is removed.
    let result = match read_result(&read_only(root).map_err(Stop::Keep)?, op_id) {
        Ok(Some(result)) => result,
        _ => {
            return Err(Stop::Keep(
                "The study pack may have been added. Open Study Library to check.".to_string(),
            ))
        }
    };
    fault::hit("receipt-confirmed").map_err(|e| {
        if e == CRASH {
            Stop::Crash
        } else {
            Stop::Keep(e)
        }
    })?;
    journal.state = State::Committed;
    if let Err(message) = journal::write(op, &journal) {
        if message == CRASH {
            return Err(Stop::Crash);
        }
        // The receipt is durable: the import stands. Reconcile finishes the
        // cleanup later; it never rolls this back.
        return Ok(result);
    }
    fault::hit("after-committed").map_err(|_| Stop::Crash)?;
    let _ = std::fs::remove_dir_all(op);
    fault::hit("staging-deleted").map_err(|_| Stop::Crash)?;
    Ok(result)
}

fn stage_files(
    root: &Path,
    pack_path: &Path,
    pack: &ValidatedPack,
    plan: &Plan,
    op: &Path,
    journal: &mut Journal,
) -> Result<(), String> {
    let wanted: Vec<_> = pack
        .items
        .iter()
        .zip(&plan.items)
        .filter(|(item, p)| p.decision == Decision::Add && item.manifest.file.is_some())
        .collect();
    let total: u64 = wanted
        .iter()
        .filter_map(|(item, _)| item.manifest.file.as_ref().map(|f| f.bytes))
        .sum();
    if let Ok(Some(free)) = crate::backup::free_space_bytes(root) {
        if free < total.saturating_add(SPARE_BYTES) {
            return Err(NO_SPACE.to_string());
        }
    }
    if wanted.is_empty() {
        journal::sync(&op.join(FILES_DIR), "fsync:files")?;
        return Ok(());
    }
    let file = File::open(pack_path).map_err(|_| "That study pack can't be opened.".to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| super::format::NOT_A_PACK.to_string())?;
    for (index, (item, p)) in wanted.iter().enumerate() {
        let manifest_file = item.manifest.file.as_ref().ok_or(NOT_ADDED)?;
        let n = index as u32 + 1;
        let limit = if item.manifest.kind == "document" {
            MAX_PDF_BYTES
        } else {
            MAX_PNG_BYTES
        };
        let staged = op.join(FILES_DIR).join(n.to_string());
        let mut entry = archive
            .by_name(&manifest_file.entry)
            .map_err(|_| super::validate::damaged("a file inside it can't be read"))?;
        let mut out = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .map_err(|e| format!("Could not prepare the study pack files: {e}"))?;
        let (bytes, sha) = crate::backup::copy_and_hash(&mut (&mut entry).take(limit + 1), &mut out)?;
        out.sync_all()
            .map_err(|e| format!("Could not prepare the study pack files: {e}"))?;
        if bytes != manifest_file.bytes || sha != manifest_file.sha256 {
            return Err(super::validate::damaged("a file doesn't match its checksum"));
        }
        let meta = std::fs::symlink_metadata(&staged)
            .map_err(|e| format!("Could not prepare the study pack files: {e}"))?;
        let (dev, ino) = journal::file_id(&meta).ok_or_else(|| UNSUPPORTED.to_string())?;
        let material = p.material.as_deref().ok_or(NOT_ADDED)?;
        journal.files.push(JournalFile {
            n,
            item_ref: item.manifest.item_ref.clone(),
            dest: format!(
                "{material}-{}",
                crate::documents::sanitize_file_name(&manifest_file.original_file_name)
            ),
            sha256: sha,
            bytes,
            dev,
            ino,
        });
    }
    journal::sync(&op.join(FILES_DIR), "fsync:files")
}

fn install_files(root: &Path, op: &Path, journal: &Journal) -> Result<(), String> {
    let docs = root.join(crate::documents::DOCUMENTS_DIR);
    for (index, f) in journal.files.iter().enumerate() {
        let to = crate::documents::contained_document_path(&docs, &f.dest)?;
        let from = op.join(FILES_DIR).join(f.n.to_string());
        crate::documents::rename_no_replace(&from, &to).map_err(|e| {
            if crate::documents::is_already_exists_error(&e) {
                NOT_ADDED.to_string()
            } else {
                format!("Could not add the study pack files: {e}")
            }
        })?;
        fault::hit(&format!("moved:{}", index + 1))?;
    }
    Ok(())
}

/// Re-read every installed file in full: same hash, same size, and the very
/// inode that was staged.
fn verify_installed(root: &Path, journal: &Journal) -> Result<(), String> {
    let docs = root.join(crate::documents::DOCUMENTS_DIR);
    for f in &journal.files {
        let path: PathBuf = crate::documents::contained_document_path(&docs, &f.dest)?;
        let meta = std::fs::symlink_metadata(&path).map_err(|_| NOT_ADDED.to_string())?;
        let ok = meta.is_file()
            && meta.len() == f.bytes
            && journal::file_id(&meta) == Some((f.dev, f.ino))
            && sha256_of_file(&path)? == f.sha256;
        if !ok {
            return Err("A study pack file didn't copy correctly.".to_string());
        }
    }
    Ok(())
}
