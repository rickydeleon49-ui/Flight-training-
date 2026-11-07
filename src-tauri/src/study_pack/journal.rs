//! The on-disk journal of one import and the staging folder it lives in
//! (design section 1). A journal is a hint: the receipt row in the database
//! decides whether an import happened. Every durable write here returns its
//! error; nothing is best effort.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::fault;

pub const IMPORTS_DIR: &str = ".pack-imports";
pub const FAILED_DIR: &str = ".failed";
pub const JOURNAL_FILE: &str = "journal.json";
pub const FILES_DIR: &str = "files";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum State {
    Preparing,
    Staged,
    Installing,
    Installed,
    Committed,
}

impl State {
    pub fn name(self) -> &'static str {
        match self {
            State::Preparing => "PREPARING",
            State::Staged => "STAGED",
            State::Installing => "INSTALLING",
            State::Installed => "INSTALLED",
            State::Committed => "COMMITTED",
        }
    }
}

/// One file this import moves into documents/.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalFile {
    /// Staged as `files/<n>`.
    pub n: u32,
    pub item_ref: String,
    /// `<material id>-<sanitized original name>`, relative to documents/.
    pub dest: String,
    pub sha256: String,
    pub bytes: u64,
    /// Device and inode of the staged file (a rename keeps the inode).
    pub dev: u64,
    pub ino: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Journal {
    pub version: u32,
    pub op_id: String,
    pub state: State,
    pub pack_path: String,
    pub pack_sha256: String,
    /// Pack ref -> the new material id this import made for it.
    pub id_map: BTreeMap<String, String>,
    pub files: Vec<JournalFile>,
}

pub fn imports_dir(root: &Path) -> PathBuf {
    root.join(IMPORTS_DIR)
}

pub fn op_dir(root: &Path, op_id: &str) -> PathBuf {
    imports_dir(root).join(op_id)
}

pub fn is_symlink_or_missing_dir(path: &Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => crate::backup::is_symlink_or_reparse(&meta) || !meta.is_dir(),
        Err(_) => true,
    }
}

/// Flush a directory's entries; an injected or real error is returned.
pub fn sync(path: &Path, point: &str) -> Result<(), String> {
    fault::hit(point)?;
    crate::documents::sync_dir(path)
        .map_err(|e| format!("Could not make a study pack folder durable: {e}"))
}

/// Create `.pack-imports/<op>/files/` so that each new directory entry is
/// durable before anything depends on it.
pub fn create_staging(root: &Path, op_id: &str) -> Result<PathBuf, String> {
    let imports = imports_dir(root);
    match std::fs::symlink_metadata(&imports) {
        Ok(meta) if crate::backup::is_symlink_or_reparse(&meta) || !meta.is_dir() => {
            return Err("Study packs can't be added to this library's storage yet.".into())
        }
        Ok(_) => {}
        Err(_) => {
            std::fs::create_dir(&imports)
                .map_err(|e| format!("Could not prepare the study pack folder: {e}"))?;
            sync(root, "fsync:root")?;
        }
    }
    let op = op_dir(root, op_id);
    std::fs::create_dir(&op)
        .map_err(|e| format!("Could not prepare the study pack folder: {e}"))?;
    sync(&imports, "fsync:pack-imports")?;
    let files = op.join(FILES_DIR);
    std::fs::create_dir(&files)
        .map_err(|e| format!("Could not prepare the study pack folder: {e}"))?;
    sync(&op, "fsync:op")?;
    for dir in [&imports, &op, &files] {
        if is_symlink_or_missing_dir(dir) {
            return Err("Study packs can't be added to this library's storage yet.".into());
        }
    }
    Ok(op)
}

/// tmp -> `sync_all` -> rename -> mandatory fsync of the op dir.
pub fn write(op: &Path, journal: &Journal) -> Result<(), String> {
    fault::hit(&format!("journal:{}", journal.state.name()))?;
    let json = serde_json::to_vec_pretty(journal)
        .map_err(|e| format!("Could not record the study pack: {e}"))?;
    let tmp = op.join(format!("{JOURNAL_FILE}.tmp"));
    let target = op.join(JOURNAL_FILE);
    let io = |e: std::io::Error| format!("Could not record the study pack: {e}");
    {
        let mut file = std::fs::File::create(&tmp).map_err(io)?;
        file.write_all(&json).map_err(io)?;
        file.sync_all().map_err(io)?;
    }
    std::fs::rename(&tmp, &target).map_err(io)?;
    sync(op, "fsync:op-journal")?;
    fault::hit(&format!("journal-done:{}", journal.state.name()))
}

/// Strict read: any parse problem, or an op id that is not the folder's name,
/// is an error (design D1).
pub fn read(op: &Path) -> Result<Journal, String> {
    let bytes =
        std::fs::read(op.join(JOURNAL_FILE)).map_err(|e| format!("journal unreadable: {e}"))?;
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|e| format!("journal invalid: {e}"))?;
    let name = op.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if journal.version != 1 || journal.op_id != name {
        return Err("journal does not belong to this folder".into());
    }
    Ok(journal)
}

#[cfg(unix)]
pub fn file_id(meta: &std::fs::Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    Some((meta.dev(), meta.ino()))
}

#[cfg(not(unix))]
pub fn file_id(_meta: &std::fs::Metadata) -> Option<(u64, u64)> {
    None
}
