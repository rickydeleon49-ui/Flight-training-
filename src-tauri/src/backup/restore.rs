//! Staging, applying, journaling and rolling back a restore.

use super::*;

pub(super) const RESTORE_STAGING_DIR: &str = ".restore-staging";
pub(crate) const RESTORE_PENDING_DIR: &str = ".restore-pending";
pub(crate) const RESTORE_JOURNAL_FILE: &str = "restore-journal.json";

/// Written into the staged folder to say what kind of restore was asked for.
///
/// An archive can never contain this name — `allowed_archive_path` only lets
/// the manifest, the database, its write-ahead log and `documents/` through —
/// so a backup file cannot decide how it gets installed.
pub(super) const RESTORE_PLAN: &str = "restore.json";

/// What a staged restore should replace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum RestoreKind {
    /// A portable archive: the database and the uploaded documents together.
    Complete,
    /// A local safety copy: the database only. Uploaded documents stay put.
    Database,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RestorePlan {
    #[serde(default)]
    pub(super) operation_id: String,
    pub(super) kind: RestoreKind,
    /// Where it came from, for the log line if installing goes wrong.
    pub(super) source: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) enum RestorePhase {
    Protecting,
    Protected,
    Activating,
    Committed,
    RollingBack,
    RolledBack,
    UnresolvedRecovery,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArtifactIdentity {
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

pub(super) fn inventory_directory_artifacts(dir: &Path) -> Result<Vec<ArtifactIdentity>, String> {
    let mut artifacts = Vec::new();
    let meta = match std::fs::symlink_metadata(dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(artifacts),
        Err(e) => {
            return Err(format!(
                "Could not inspect directory {}: {e}",
                dir.display()
            ))
        }
    };
    if is_symlink_or_reparse(&meta) {
        return Err(format!(
            "Directory path is an unsafe symlink or reparse point: {}",
            dir.display()
        ));
    }
    if !meta.is_dir() {
        return Err(format!(
            "Directory path is not a directory: {}",
            dir.display()
        ));
    }

    fn collect_recursive(
        base: &Path,
        current: &Path,
        artifacts: &mut Vec<ArtifactIdentity>,
    ) -> Result<(), String> {
        #[cfg(test)]
        check_injected_fault(InjectedFault::InventoryReadDir)
            .map_err(|e| format!("Could not read directory {}: {e}", current.display()))?;

        let entries = std::fs::read_dir(current)
            .map_err(|e| format!("Could not read directory {}: {e}", current.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Could not read entry: {e}"))?;
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path)
                .map_err(|e| format!("Could not inspect {}: {e}", path.display()))?;
            if is_symlink_or_reparse(&meta) {
                return Err(format!(
                    "Linked path or reparse point detected at {}",
                    path.display()
                ));
            }
            if meta.is_dir() {
                collect_recursive(base, &path, artifacts)?;
            } else if meta.file_type().is_file() {
                let rel = path
                    .strip_prefix(base)
                    .map_err(|e| format!("Path prefix error: {e}"))?
                    .to_string_lossy()
                    .replace('\\', "/");
                let bytes = std::fs::read(&path)
                    .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
                let sha256 = hex::encode(Sha256::digest(&bytes));
                artifacts.push(ArtifactIdentity {
                    name: rel,
                    sha256,
                    size: bytes.len() as u64,
                });
            } else {
                return Err(format!(
                    "Unexpected non-regular file type at {}",
                    path.display()
                ));
            }
        }
        Ok(())
    }
    collect_recursive(dir, dir, &mut artifacts)?;
    Ok(artifacts)
}

pub(super) fn validate_artifact_identity(art: &ArtifactIdentity) -> Result<(), String> {
    if art.sha256.len() != 64 || !art.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "Invalid SHA-256 digest '{}' for artifact '{}'",
            art.sha256, art.name
        ));
    }
    Ok(())
}

pub(super) fn validate_relative_document_path(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains('\0')
        || trimmed.contains(':')
    {
        return Err(format!(
            "Unsafe or invalid relative document path in inventory: '{name}'"
        ));
    }
    let p = Path::new(trimmed);
    for comp in p.components() {
        match comp {
            std::path::Component::Normal(_) => {}
            _ => {
                return Err(format!(
                    "Invalid path component in document inventory: '{name}'"
                ))
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) enum OriginalDocumentsPresence {
    Absent,
    PresentEmpty,
    PresentWithContent,
    LegacyUnknown,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub(crate) struct RestoreJournal {
    #[serde(default)]
    pub operation_id: String,
    pub phase: RestorePhase,
    pub rollback_rel_path: String,
    pub replace_documents: bool,
    #[serde(default)]
    pub original_documents_presence: Option<OriginalDocumentsPresence>,
    #[serde(default)]
    pub protected_db_files: Vec<String>,
    #[serde(default)]
    pub protected_documents: bool,
    #[serde(default)]
    pub installed_db_files: Vec<String>,
    #[serde(default)]
    pub installed_documents: bool,
    #[serde(default)]
    pub original_db_artifacts: Vec<ArtifactIdentity>,
    #[serde(default)]
    pub staged_db_artifacts: Vec<ArtifactIdentity>,
    #[serde(default)]
    pub original_document_artifacts: Vec<ArtifactIdentity>,
    #[serde(default)]
    pub staged_document_artifacts: Vec<ArtifactIdentity>,
    pub failure_reason: Option<String>,
}

impl RestoreJournal {
    pub fn new(rollback_rel_path: String, replace_documents: bool) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        Self {
            operation_id: format!("restore-{}-{}", std::process::id(), nonce),
            phase: RestorePhase::Protecting,
            rollback_rel_path,
            replace_documents,
            original_documents_presence: None,
            protected_db_files: Vec::new(),
            protected_documents: false,
            installed_db_files: Vec::new(),
            installed_documents: false,
            original_db_artifacts: Vec::new(),
            staged_db_artifacts: Vec::new(),
            original_document_artifacts: Vec::new(),
            staged_document_artifacts: Vec::new(),
            failure_reason: None,
        }
    }

    pub fn validate(&self, root: &Path) -> Result<PathBuf, String> {
        let trimmed = self.rollback_rel_path.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('/')
            || trimmed.starts_with('\\')
            || trimmed.contains("..")
            || trimmed.contains('\0')
            || trimmed.contains(':')
        {
            return Err(format!("Invalid rollback path in journal: '{trimmed}'"));
        }

        let path_obj = Path::new(trimmed);
        let components: Vec<_> = path_obj.components().collect();
        if components.len() != 2 {
            return Err(format!(
                "Rollback path in journal must be a direct child under backups/: '{trimmed}'"
            ));
        }
        match components[0] {
            std::path::Component::Normal(first) if first == "backups" => {}
            _ => return Err("Rollback path in journal must reside within backups/".to_string()),
        }

        let child_name = match components[1] {
            std::path::Component::Normal(child) => child.to_string_lossy(),
            _ => return Err("Rollback path contains invalid child component".to_string()),
        };
        if child_name.is_empty()
            || child_name == "backups"
            || child_name == "."
            || child_name == ".."
        {
            return Err(
                "Rollback path cannot be the backups directory itself or an alias".to_string(),
            );
        }

        // Validate ancestors and target against symlinks and reparse points
        let backups_dir = root.join("backups");
        match std::fs::symlink_metadata(&backups_dir) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    return Err(
                        "Backups root directory is an unsafe symlink/reparse point".to_string()
                    );
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not inspect backups directory: {e}")),
        }

        let full_rollback = root.join(trimmed);
        match std::fs::symlink_metadata(&full_rollback) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    return Err(
                        "Rollback path in journal is an unsafe symlink/reparse point".to_string(),
                    );
                }
                if !meta.is_dir() {
                    return Err("Rollback path in journal is not a directory".to_string());
                }

                // Strictly validate all entries and subdirectories inside full_rollback
                let entries = std::fs::read_dir(&full_rollback)
                    .map_err(|e| format!("Could not read rollback directory: {e}"))?;
                for entry in entries {
                    let entry = entry.map_err(|e| format!("Could not read rollback entry: {e}"))?;
                    let entry_meta = std::fs::symlink_metadata(entry.path())
                        .map_err(|e| format!("Could not inspect rollback artifact: {e}"))?;
                    if is_symlink_or_reparse(&entry_meta) {
                        return Err(format!(
                            "Rollback artifact is an unsafe symlink or reparse point: {}",
                            entry.path().display()
                        ));
                    }
                    if entry_meta.is_dir() {
                        let sub_entries = std::fs::read_dir(entry.path()).map_err(|e| {
                            format!("Could not read directory {}: {e}", entry.path().display())
                        })?;
                        for sub in sub_entries {
                            let sub = sub.map_err(|e| format!("Could not read sub entry: {e}"))?;
                            let sub_meta = std::fs::symlink_metadata(sub.path())
                                .map_err(|e| format!("Could not inspect artifact: {e}"))?;
                            if is_symlink_or_reparse(&sub_meta) {
                                return Err(format!(
                                    "Rollback nested artifact is an unsafe symlink or reparse point: {}",
                                    sub.path().display()
                                ));
                            }
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not inspect rollback directory: {e}")),
        }

        let mut seen_protected = HashSet::new();
        for name in &self.protected_db_files {
            if !DB_FILES.contains(&name.as_str()) {
                return Err(format!(
                    "Unrecognized protected DB file in journal: '{name}'"
                ));
            }
            if !seen_protected.insert(name) {
                return Err(format!("Duplicate protected DB file in journal: '{name}'"));
            }
        }
        let mut seen_installed = HashSet::new();
        for name in &self.installed_db_files {
            if !DB_FILES.contains(&name.as_str()) {
                return Err(format!(
                    "Unrecognized installed DB file in journal: '{name}'"
                ));
            }
            if !seen_installed.insert(name) {
                return Err(format!("Duplicate installed DB file in journal: '{name}'"));
            }
        }

        let mut seen_orig_db = HashSet::new();
        for art in &self.original_db_artifacts {
            if !DB_FILES.contains(&art.name.as_str()) {
                return Err(format!(
                    "Unrecognized original DB file in journal inventory: '{}'",
                    art.name
                ));
            }
            if !seen_orig_db.insert(&art.name) {
                return Err(format!(
                    "Duplicate original DB artifact in journal inventory: '{}'",
                    art.name
                ));
            }
            validate_artifact_identity(art)?;
        }

        let mut seen_staged_db = HashSet::new();
        for art in &self.staged_db_artifacts {
            if !DB_FILES.contains(&art.name.as_str()) {
                return Err(format!(
                    "Unrecognized staged DB file in journal inventory: '{}'",
                    art.name
                ));
            }
            if !seen_staged_db.insert(&art.name) {
                return Err(format!(
                    "Duplicate staged DB artifact in journal inventory: '{}'",
                    art.name
                ));
            }
            validate_artifact_identity(art)?;
        }

        let mut seen_orig_doc = HashSet::new();
        for art in &self.original_document_artifacts {
            validate_relative_document_path(&art.name)?;
            if !seen_orig_doc.insert(&art.name) {
                return Err(format!(
                    "Duplicate original document artifact in journal inventory: '{}'",
                    art.name
                ));
            }
            validate_artifact_identity(art)?;
        }

        let mut seen_staged_doc = HashSet::new();
        for art in &self.staged_document_artifacts {
            validate_relative_document_path(&art.name)?;
            if !seen_staged_doc.insert(&art.name) {
                return Err(format!(
                    "Duplicate staged document artifact in journal inventory: '{}'",
                    art.name
                ));
            }
            validate_artifact_identity(art)?;
        }

        Ok(full_rollback)
    }
}

pub(super) fn write_journal(root: &Path, journal: &RestoreJournal) -> Result<(), String> {
    let target = root.join(RESTORE_JOURNAL_FILE);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = root.join(format!(
        "{RESTORE_JOURNAL_FILE}.tmp-{}-{}",
        std::process::id(),
        nonce
    ));
    let json = serde_json::to_string_pretty(journal)
        .map_err(|e| format!("Could not serialize restore journal: {e}"))?;

    #[cfg(test)]
    check_injected_fault(InjectedFault::JournalTempCreate)
        .map_err(|e| format!("Could not create restore journal temporary file: {e}"))?;

    struct TmpJournalGuard<'a>(&'a Path);
    impl<'a> Drop for TmpJournalGuard<'a> {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0);
        }
    }

    {
        let mut file = File::create(&tmp)
            .map_err(|e| format!("Could not create restore journal temporary file: {e}"))?;
        let guard = TmpJournalGuard(&tmp);

        #[cfg(test)]
        check_injected_fault(InjectedFault::JournalWrite)
            .map_err(|e| format!("Could not write restore journal: {e}"))?;

        file.write_all(json.as_bytes())
            .map_err(|e| format!("Could not write restore journal: {e}"))?;

        #[cfg(test)]
        check_injected_fault(InjectedFault::JournalSync)
            .map_err(|e| format!("Could not sync restore journal: {e}"))?;

        file.sync_all()
            .map_err(|e| format!("Could not sync restore journal: {e}"))?;

        #[cfg(test)]
        check_injected_fault(InjectedFault::JournalRename)
            .map_err(|e| format!("Could not commit restore journal: {e}"))?;

        std::fs::rename(&tmp, &target)
            .map_err(|e| format!("Could not commit restore journal: {e}"))?;

        std::mem::forget(guard);
    }

    #[cfg(unix)]
    {
        // Explicitly documented best-effort directory sync:
        // Canonical replacement (atomic rename) has already succeeded on disk. On Unix
        // systems supporting directory fsync, this ensures directory entry durability.
        // On systems or sandboxes where directory file descriptors cannot be opened or synced,
        // we do not fail the already-committed canonical journal replacement.
        if let Ok(dir) = File::open(root) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// Is a restore unfinished, so that new study packs must wait? Decided from
/// the journal phase like `fresh_staging`: a finished (Committed or
/// RolledBack) journal left behind does not block; anything unreadable or
/// unfinished does, as does a pending folder with no finished journal.
pub(crate) fn restore_blocks_study_pack_import(root: &Path) -> bool {
    match read_journal(root) {
        Ok(Some(journal)) => !matches!(
            journal.phase,
            RestorePhase::Committed | RestorePhase::RolledBack
        ),
        Ok(None) => std::fs::symlink_metadata(root.join(RESTORE_PENDING_DIR)).is_ok(),
        Err(_) => true,
    }
}

pub(super) fn read_journal(root: &Path) -> Result<Option<RestoreJournal>, String> {
    #[cfg(test)]
    check_injected_fault(InjectedFault::JournalRead)
        .map_err(|e| format!("Could not read restore journal: {e}"))?;

    let target = root.join(RESTORE_JOURNAL_FILE);
    let meta = match std::fs::symlink_metadata(&target) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not inspect restore journal: {e}")),
    };
    if is_symlink_or_reparse(&meta) {
        return Err("Restore journal is an unsafe symlink/reparse point".to_string());
    }
    if meta.is_dir() {
        return Err("Restore journal path is an unexpected directory".to_string());
    }
    if !meta.file_type().is_file() {
        return Err("Restore journal path is not a regular file".to_string());
    }
    let data = std::fs::read_to_string(&target)
        .map_err(|e| format!("Could not read restore journal: {e}"))?;
    let journal: RestoreJournal = serde_json::from_str(&data)
        .map_err(|e| format!("Restore journal is corrupted or invalid: {e}"))?;
    let _ = journal.validate(root)?;
    Ok(Some(journal))
}

pub(super) fn remove_journal(root: &Path) -> Result<(), String> {
    #[cfg(test)]
    check_injected_fault(InjectedFault::JournalDelete)
        .map_err(|e| format!("Could not remove restore journal: {e}"))?;

    let target = root.join(RESTORE_JOURNAL_FILE);
    match std::fs::symlink_metadata(&target) {
        Ok(meta) => if meta.is_dir() || is_symlink_or_reparse(&meta) {
            std::fs::remove_dir(&target).or_else(|_| std::fs::remove_file(&target))
        } else {
            std::fs::remove_file(&target)
        }
        .map_err(|e| format!("Could not remove restore journal: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!(
            "Could not inspect restore journal for removal: {e}"
        )),
    }
}

pub(super) fn find_unresolved_recovery_evidence(
    root: &Path,
) -> Result<Option<(String, Option<PathBuf>)>, String> {
    #[cfg(test)]
    check_injected_fault(InjectedFault::RootReadDir)
        .map_err(|e| format!("Could not inspect root directory: {e}"))?;

    let mut has_tmp_journal = false;
    let root_entries =
        std::fs::read_dir(root).map_err(|e| format!("Could not read root directory: {e}"))?;
    for entry in root_entries {
        let entry = entry.map_err(|e| format!("Could not read entry in root directory: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&format!("{RESTORE_JOURNAL_FILE}.tmp")) {
            has_tmp_journal = true;
            break;
        }
    }

    #[cfg(test)]
    check_injected_fault(InjectedFault::BackupsReadDir)
        .map_err(|e| format!("Could not inspect backups directory: {e}"))?;

    let backups = root.join(BACKUP_DIR);
    let backups_meta = match std::fs::symlink_metadata(&backups) {
        Ok(m) => Some(m),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Could not inspect backups directory: {e}")),
    };
    if let Some(meta) = backups_meta {
        if is_symlink_or_reparse(&meta) {
            return Err("Backups directory is an unsafe symlink or reparse point".into());
        }
        if meta.is_dir() {
            let entries = std::fs::read_dir(&backups)
                .map_err(|e| format!("Could not read backups directory: {e}"))?;
            for entry in entries {
                let entry = entry.map_err(|e| format!("Could not read backup entry: {e}"))?;
                let path = entry.path();
                let entry_meta = std::fs::symlink_metadata(&path).map_err(|e| {
                    format!("Could not inspect backup entry {}: {e}", path.display())
                })?;
                if is_symlink_or_reparse(&entry_meta) {
                    return Err(format!(
                        "Recovery folder is an unsafe symlink or reparse point: {}",
                        path.display()
                    ));
                }
                if entry_meta.is_dir() {
                    if path.join(".recovery-pending").exists() {
                        return Ok(Some((
                            "An unresolved recovery marker was found in backups".to_string(),
                            Some(path),
                        )));
                    }
                    let folder_name = entry.file_name().to_string_lossy().to_string();
                    if folder_name.contains("before-restore")
                        && path.join(DB_FILES[0]).is_file()
                        && !root.join(DB_FILES[0]).is_file()
                    {
                        return Ok(Some((
                            "Active database is missing but an unrecovered safety copy exists in backups"
                                .to_string(),
                            Some(path),
                        )));
                    }
                }
            }
        }
    }

    if has_tmp_journal {
        return Ok(Some((
            "An interrupted restore journal update was detected".to_string(),
            None,
        )));
    }

    Ok(None)
}

pub(super) fn is_protected_recovery_folder(root: &Path, folder: &Path) -> bool {
    if let Ok(Some(journal)) = read_journal(root) {
        if let Ok(journal_rollback) = journal.validate(root) {
            if folder == journal_rollback {
                return true;
            }
        }
    }
    if folder.join(".recovery-pending").exists() {
        return true;
    }
    if let Some(name) = folder.file_name().and_then(|n| n.to_str()) {
        if name.contains("before-restore") {
            for db_file in DB_FILES {
                if folder.join(db_file).exists() {
                    return true;
                }
            }
            if folder.join(DOCUMENTS_DIR).exists() {
                return true;
            }
        }
    }
    false
}

/// Clear anything left over and hand back an empty staging directory.
pub(super) fn fresh_staging(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let staging = root.join(RESTORE_STAGING_DIR);
    let pending = root.join(RESTORE_PENDING_DIR);
    let journal_target = root.join(RESTORE_JOURNAL_FILE);

    // Check existing journal state BEFORE touching staging or pending directories!
    let has_journal = match std::fs::symlink_metadata(&journal_target) {
        Ok(_) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(format!("Could not inspect restore journal: {e}")),
    };

    if !has_journal {
        // No journal does not mean nothing is wrong: an interrupted journal write or an
        // unrecovered safety copy leaves other evidence. Clearing the pending folder then
        // could destroy the only copy of what a half-finished restore was moving.
        match find_unresolved_recovery_evidence(root) {
            Ok(Some((reason, _))) => {
                return Err(format!(
                    "Cannot stage a restore while an unresolved recovery or restore is active: {reason}"
                ));
            }
            Ok(None) => {}
            Err(e) => {
                return Err(format!("Could not check for an unfinished restore: {e}"));
            }
        }
    }

    if has_journal {
        match read_journal(root) {
            Ok(Some(journal)) => {
                if matches!(
                    journal.phase,
                    RestorePhase::Protecting
                        | RestorePhase::Protected
                        | RestorePhase::Activating
                        | RestorePhase::RollingBack
                        | RestorePhase::UnresolvedRecovery
                ) {
                    return Err(
                        "Cannot stage a restore while an unresolved recovery or restore is active"
                            .to_string(),
                    );
                }
                // Terminal state (Committed or RolledBack): must fallibly remove old journal before accepting new staging
                remove_journal(root).map_err(|e| {
                    format!("Cannot stage a new restore because the previous restore journal could not be cleared: {e}")
                })?;
            }
            Ok(None) => {}
            Err(e) => {
                return Err(format!(
                    "Cannot stage a restore while an invalid or unreadable restore journal is present: {e}"
                ));
            }
        }
    }

    match inspect_storage_root(&staging, "Restore staging directory") {
        Ok(Some(_)) => {
            std::fs::remove_dir_all(&staging)
                .map_err(|e| format!("Could not clear an unfinished restore: {e}"))?;
        }
        Ok(None) => {}
        Err(e) => return Err(format!("Restore staging directory refused: {e}")),
    }
    match inspect_storage_root(&pending, "Restore pending directory") {
        Ok(Some(_)) => {
            std::fs::remove_dir_all(&pending)
                .map_err(|e| format!("Could not replace an unfinished restore: {e}"))?;
        }
        Ok(None) => {}
        Err(e) => return Err(format!("Restore pending directory refused: {e}")),
    }

    std::fs::create_dir_all(&staging).map_err(|e| format!("Could not prepare the restore: {e}"))?;
    Ok((staging, pending))
}

/// Record what the staged folder is meant to replace, next to the staged files.
pub(super) fn write_restore_plan(
    staging: &Path,
    kind: RestoreKind,
    source: &str,
) -> Result<(), String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let plan = RestorePlan {
        operation_id: format!("restore-{}-{}", std::process::id(), nonce),
        kind,
        source: source.to_string(),
    };
    std::fs::write(
        staging.join(RESTORE_PLAN),
        serde_json::to_string_pretty(&plan)
            .map_err(|e| format!("Could not prepare the restore: {e}"))?,
    )
    .map_err(|e| format!("Could not prepare the restore: {e}"))
}

/// Read back that record for application kind. An unreadable or absent plan means a complete
/// archive, which is what every earlier version staged.
#[cfg(test)]
pub(super) fn read_restore_plan(pending: &Path) -> RestorePlan {
    std::fs::read_to_string(pending.join(RESTORE_PLAN))
        .ok()
        .and_then(|json| serde_json::from_str::<RestorePlan>(&json).ok())
        .unwrap_or(RestorePlan {
            operation_id: String::new(),
            kind: RestoreKind::Complete,
            source: String::new(),
        })
}

/// Fallible, no-follow inspection for verifying operation ownership before deletion.
/// Unreadable or corrupted plans strictly do not grant deletion permission.
pub(super) fn read_restore_plan_for_ownership(
    pending: &Path,
) -> Result<Option<RestorePlan>, String> {
    #[cfg(test)]
    check_injected_fault(InjectedFault::PlanRead)
        .map_err(|e| format!("Could not inspect restore plan: {e}"))?;

    let target = pending.join(RESTORE_PLAN);
    let meta = match std::fs::symlink_metadata(&target) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not inspect restore plan: {e}")),
    };
    if is_symlink_or_reparse(&meta) {
        return Err("Restore plan is an unsafe symlink or reparse point".into());
    }
    if !meta.file_type().is_file() {
        return Err("Restore plan is not a regular file".into());
    }
    let data = std::fs::read_to_string(&target)
        .map_err(|e| format!("Could not read restore plan: {e}"))?;
    let plan: RestorePlan = serde_json::from_str(&data)
        .map_err(|e| format!("Restore plan is invalid or corrupted: {e}"))?;
    Ok(Some(plan))
}

pub(super) fn verify_pending_contents_against_staged_manifest(
    pending: &Path,
    journal: &RestoreJournal,
) -> Result<bool, String> {
    if journal.staged_db_artifacts.is_empty() && journal.staged_document_artifacts.is_empty() {
        return Ok(false);
    }
    let entries = match std::fs::read_dir(pending) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(true),
        Err(e) => return Err(format!("Could not read pending directory entries: {e}")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not inspect pending entry: {e}"))?;
        let meta = entry
            .metadata()
            .map_err(|e| format!("Could not read metadata for pending entry: {e}"))?;
        if is_symlink_or_reparse(&meta) {
            return Err("Pending directory contains unsafe symlink or reparse point".into());
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if meta.is_file() {
            let found = journal.staged_db_artifacts.iter().find(|a| a.name == name);
            if let Some(art) = found {
                let bytes = std::fs::read(entry.path())
                    .map_err(|e| format!("Could not read pending file {name}: {e}"))?;
                let hash = hex::encode(Sha256::digest(&bytes));
                if hash != art.sha256 || bytes.len() as u64 != art.size {
                    return Ok(false);
                }
            } else {
                return Ok(false);
            }
        } else if meta.is_dir() {
            if name == DOCUMENTS_DIR {
                let docs = inventory_directory_artifacts(&entry.path())?;
                for doc in docs {
                    if !journal
                        .staged_document_artifacts
                        .iter()
                        .any(|a| a.name == doc.name && a.sha256 == doc.sha256 && a.size == doc.size)
                    {
                        return Ok(false);
                    }
                }
            } else {
                return Ok(false);
            }
        } else {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn remove_pending_directory_safely(pending: &Path) -> Result<(), std::io::Error> {
    // Fallible no-follow inspection of the pending directory itself.
    let root_meta = match std::fs::symlink_metadata(pending) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if is_symlink_or_reparse(&root_meta) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Pending directory is an unsafe symlink or reparse point",
        ));
    }
    if !root_meta.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Pending path is not a directory",
        ));
    }

    // Safe deletion ordering: delete non-plan payload files and subdirectories first.
    // Retain RESTORE_PLAN on disk until all payload files are removed.
    // If an error or OS listing/entry denial occurs, RESTORE_PLAN survives
    // to provide durable proof of ownership for future cleanup attempts.
    let entries = std::fs::read_dir(pending)?;
    for entry in entries {
        #[cfg(test)]
        check_injected_fault(InjectedFault::PendingEntryRead)?;

        let entry = entry?;
        let file_name = entry.file_name();
        if file_name == RESTORE_PLAN {
            continue;
        }
        let path = entry.path();
        let entry_meta = std::fs::symlink_metadata(&path)?;
        if is_symlink_or_reparse(&entry_meta) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "Pending payload entry {:?} is an unsafe symlink or reparse point",
                    file_name
                ),
            ));
        }
        if entry_meta.is_dir() {
            std::fs::remove_dir_all(&path)?;
        } else {
            std::fs::remove_file(&path)?;
        }
    }

    // Remove RESTORE_PLAN only after every non-plan payload file has been successfully deleted.
    let plan_path = pending.join(RESTORE_PLAN);
    match std::fs::symlink_metadata(&plan_path) {
        Ok(plan_meta) => {
            if is_symlink_or_reparse(&plan_meta) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "Restore plan is an unsafe symlink or reparse point",
                ));
            }
            std::fs::remove_file(&plan_path)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }

    std::fs::remove_dir(pending)
}

pub(super) fn verify_pending_cleanup_permission(
    pending: &Path,
    journal: &RestoreJournal,
) -> Result<bool, String> {
    if inspect_storage_root(pending, "Pending directory")?.is_none() {
        return Ok(true);
    }

    match read_restore_plan_for_ownership(pending)? {
        Some(plan) => {
            if !journal.operation_id.is_empty() && !plan.operation_id.is_empty() {
                if journal.operation_id == plan.operation_id {
                    Ok(true)
                } else {
                    Ok(false)
                }
            } else if journal.operation_id.is_empty() && plan.operation_id.is_empty() {
                // Genuine legacy state: neither modern journal nor plan has an operation ID.
                Ok(true)
            } else {
                // One has an ID, the other is empty or unverified.
                Ok(false)
            }
        }
        None => {
            if journal.operation_id.is_empty() {
                // Genuine legacy state: legacy journal without operation ID.
                // An absent plan means complete/legacy restore.
                Ok(true)
            } else {
                // Modern terminal journal with nonempty operation_id:
                // Check if remaining files in pending are proven leftovers of this operation
                // by verifying against the recorded staged content manifest.
                if verify_pending_contents_against_staged_manifest(pending, journal)? {
                    Ok(true)
                } else {
                    // Modern terminal journal cannot establish deletion ownership over a pending
                    // directory lacking an ownership plan and containing unknown or mismatched files.
                    Ok(false)
                }
            }
        }
    }
}

/// Refuse on a phone that holds unsaved phone-made work, before anything is extracted.
pub(crate) fn stage_complete_restore_guarded_in(
    root: &Path,
    source: &Path,
    current_app_version: &str,
    phone: bool,
) -> Result<CompleteBackupInfo, String> {
    if phone {
        // A full copy from a Mac other than the copy's own restarts the
        // phone's stream first, so the check below counts its work. A copy
        // whose manifest can't be read is refused by the staging step.
        if let Ok(incoming) = archive_device_id(source) {
            // No library yet means no work to lose; one that can't be
            // opened is refused (fail closed).
            if root.join(DB_FILES[0]).is_file() {
                let restart = crate::sync::progress::open_app_db(root).and_then(|conn| {
                    crate::sync::send::restart_if_other_mac(root, &conn, incoming.as_deref())
                });
                if restart.is_err() {
                    // Fail closed: never stage after a failed restart.
                    return Err(crate::phone_work::UNSAVED_REFUSAL.to_string());
                }
            }
        }
    }
    crate::phone_work::refuse_unsaved(root, phone)?;
    stage_complete_restore_in(root, source, current_app_version)
}

/// Unpack and check an archive into staging, against a plain directory.
pub(crate) fn stage_complete_restore_in(
    root: &Path,
    source: &Path,
    current_app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let info = inspect_archive(root, source, current_app_version)?;
    let (staging, pending) = fresh_staging(root)?;

    let result = (|| {
        let file = File::open(source).map_err(|e| format!("Could not open that backup: {e}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|e| zip_error("Could not read that backup", e))?;
        let mut expected_integrity = if archive.by_name(ARCHIVE_INTEGRITY).is_ok() {
            let mut entry = archive
                .by_name(ARCHIVE_INTEGRITY)
                .map_err(|e| zip_error("Could not read backup integrity information", e))?;
            let mut json = String::new();
            entry
                .read_to_string(&mut json)
                .map_err(|e| format!("Could not read backup integrity information: {e}"))?;
            let integrity: CompleteBackupIntegrity = serde_json::from_str(&json)
                .map_err(|e| format!("The backup integrity information is invalid: {e}"))?;
            Some(
                integrity
                    .files
                    .into_iter()
                    .map(|item| (item.path.clone(), item))
                    .collect::<HashMap<_, _>>(),
            )
        } else {
            None
        };
        let mut extracted_files = 0usize;
        let mut extracted_bytes = 0u64;
        let mut extracted_names = HashSet::new();

        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|e| zip_error("Could not read a file from the backup", e))?;
            let raw_name = entry
                .name()
                .map_err(|e| zip_error("Could not read a backup file name", e))?
                .into_owned();
            let path = entry
                .enclosed_name()
                .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
            validate_archive_path(&raw_name, &path)?;
            validate_compression_ratio(
                entry.size(),
                entry.compressed_size(),
                MAX_COMPRESSION_RATIO,
            )?;
            if !allowed_archive_path(&path, entry.is_dir()) {
                return Err(format!(
                    "The backup contains an unexpected file: {raw_name}"
                ));
            }
            if !extracted_names.insert(path.clone()) {
                return Err(format!("The backup contains a duplicate file: {raw_name}"));
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Linked files are not allowed in a backup.".to_string());
            }
            if path == Path::new(ARCHIVE_MANIFEST) || path == Path::new(ARCHIVE_INTEGRITY) {
                continue;
            }
            let destination = staging.join(&path);
            if entry.is_dir() {
                std::fs::create_dir_all(&destination)
                    .map_err(|e| format!("Could not create a restored folder: {e}"))?;
                continue;
            }
            extracted_files += 1;
            if extracted_files > MAX_RESTORE_FILES {
                return Err("That backup contains too many files.".to_string());
            }
            let expected_size = entry.size();
            extracted_bytes = extracted_bytes
                .checked_add(expected_size)
                .ok_or_else(|| "The backup is too large.".to_string())?;
            if extracted_bytes > MAX_RESTORE_BYTES {
                return Err("That backup is larger than this app can safely restore.".to_string());
            }
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create a restored folder: {e}"))?;
            }
            let mut output = File::create(&destination)
                .map_err(|e| format!("Could not create a restored file: {e}"))?;
            let (restored_bytes, restored_sha256) = copy_and_hash(
                &mut entry.take(expected_size.saturating_add(1)),
                &mut output,
            )?;
            if restored_bytes != expected_size {
                return Err("A file in that backup has an invalid size.".to_string());
            }
            output
                .sync_all()
                .map_err(|e| format!("Could not finish a restored file: {e}"))?;

            if let Some(expected) = expected_integrity.as_mut() {
                let normalized = path.to_string_lossy().replace('\\', "/");
                let expected = expected
                    .remove(&normalized)
                    .ok_or_else(|| format!("The backup has no integrity record for {raw_name}"))?;
                if restored_bytes != expected.bytes
                    || !restored_sha256.eq_ignore_ascii_case(&expected.sha256)
                {
                    return Err(format!(
                        "The backup failed its integrity check for {raw_name}"
                    ));
                }
            }
        }

        if expected_integrity
            .as_ref()
            .is_some_and(|expected| !expected.is_empty())
        {
            return Err(
                "The backup integrity list contains files that are not in the archive.".to_string(),
            );
        }

        if !staging.join(DB_FILES[0]).is_file() {
            return Err("That backup does not contain a usable database.".to_string());
        }
        // Check the extracted file itself, not just what the archive claimed.
        verify_application_database(&staging.join(DB_FILES[0]))?;
        write_restore_plan(&staging, RestoreKind::Complete, &source.to_string_lossy())?;
        std::fs::rename(&staging, &pending)
            .map_err(|e| format!("Could not stage the restore: {e}"))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result.map(|()| info)
}

/// Stage a named safety copy, against a plain directory.
pub(super) fn stage_local_restore_in(root: &Path, name: &str) -> Result<BackupInfo, String> {
    let name = safe_backup_name(name)?;
    let folder = backup_dir(root)?.join(name);
    // A safety copy is a real folder this app made; a link planted in its
    // place could point anywhere on disk.
    if std::fs::symlink_metadata(&folder).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err("That is not a safety copy this app made.".to_string());
    }
    if !folder.is_dir() {
        return Err("That safety copy is no longer there.".to_string());
    }
    let database = folder.join(DB_FILES[0]);
    verify_sqlite_file(&database)?;
    crate::sqlite_guard::check_wal_pair(&database)?;

    let (staging, pending) = fresh_staging(root)?;

    let result = (|| {
        std::fs::copy(&database, staging.join(DB_FILES[0]))
            .map_err(|e| format!("Could not prepare that safety copy: {e}"))?;
        // Its write-ahead log belongs with it; anything it still holds is hers.
        let wal = folder.join(DB_FILES[1]);
        if wal.is_file() {
            std::fs::copy(&wal, staging.join(DB_FILES[1]))
                .map_err(|e| format!("Could not prepare that safety copy: {e}"))?;
        }
        verify_sqlite_file(&staging.join(DB_FILES[0]))?;
        write_restore_plan(&staging, RestoreKind::Database, name)?;
        std::fs::rename(&staging, &pending)
            .map_err(|e| format!("Could not stage the restore: {e}"))?;
        Ok::<(), String>(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result?;

    Ok(describe_backup_folder(&folder))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StartupRestoreDecision {
    /// No restore was pending. Normal startup continues.
    ProceedNormally,
    /// A restore was committed (either just now or prior cleanup finished). Normal startup continues.
    RestoreCompleted,
    /// A staged restore was rejected before any active data was moved. Active data is verified unchanged.
    #[allow(dead_code)]
    StagingRefusedUnchanged { reason: String },
    /// A restore failed during install, but active data was verified fully recovered. Normal startup continues.
    RolledBackRecovered { reason: String },
    /// Active data is in an unresolved/ambiguous state or rollback is obstructed.
    /// Normal startup MUST be blocked to prevent creating an empty database or mutating data.
    BlockedUnresolved {
        reason: String,
        recovery_folder: Option<PathBuf>,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RestoreApplicationResult {
    NoPending,
    Installed,
    RefusedUnchanged(String),
    Recovered(String),
    Unresolved {
        reason: String,
        recovery_folder: PathBuf,
    },
}

pub(super) fn execute_rollback(root: &Path, journal: &mut RestoreJournal) -> Result<(), String> {
    let rollback = root.join(&journal.rollback_rel_path);
    if rollback.exists() {
        let rollback_meta = std::fs::symlink_metadata(&rollback)
            .map_err(|e| format!("Could not inspect recovery directory: {e}"))?;
        if is_symlink_or_reparse(&rollback_meta) {
            return Err("Recovery directory is an unsafe symlink or reparse point".into());
        }
        if !rollback_meta.is_dir() {
            return Err("Recovery directory is not a directory".into());
        }
    } else if !journal.protected_db_files.is_empty() || journal.protected_documents {
        return Err(format!(
            "Recovery directory {} is missing but journal records protected files",
            rollback.display()
        ));
    }

    if matches!(
        journal.phase,
        RestorePhase::Protecting | RestorePhase::Protected | RestorePhase::Activating
    ) {
        journal.phase = RestorePhase::RollingBack;
        write_journal(root, journal)?;
    }

    let mut errors = Vec::new();

    // Step 1: Uninstall staged files from active root
    let mut uninstalled_db_files = Vec::new();
    for name in &journal.installed_db_files.clone() {
        let active_path = root.join(name);
        match std::fs::symlink_metadata(&active_path) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(format!(
                        "Active DB path {name} is an unsafe symlink or reparse point"
                    ));
                    continue;
                }
                if !meta.is_file() {
                    errors.push(format!("Active DB path {name} is not a regular file"));
                    continue;
                }
                match std::fs::read(&active_path) {
                    Ok(bytes) => {
                        let hash = hex::encode(Sha256::digest(&bytes));
                        let is_staged = journal
                            .staged_db_artifacts
                            .iter()
                            .any(|s| s.name == *name && s.sha256 == hash);
                        let is_orig = journal
                            .original_db_artifacts
                            .iter()
                            .any(|o| o.name == *name && o.sha256 == hash);
                        if is_staged {
                            if rollback.join(name).exists() || !is_orig {
                                if let Err(e) = std::fs::remove_file(&active_path) {
                                    errors.push(format!("Could not remove installed {name}: {e}"));
                                } else {
                                    uninstalled_db_files.push(name.clone());
                                }
                            }
                        } else if is_orig && !rollback.join(name).exists() {
                            // Already returned original DB file; leave it in place
                        } else {
                            errors.push(format!(
                                "Active destination {name} contains an unidentified file that cannot be deleted or overwritten"
                            ));
                        }
                    }
                    Err(e) => {
                        errors.push(format!(
                            "Could not read active DB file {name} for classification: {e}"
                        ));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                uninstalled_db_files.push(name.clone());
            }
            Err(e) => {
                errors.push(format!("Could not inspect active DB file {name}: {e}"));
            }
        }
    }
    journal
        .installed_db_files
        .retain(|n| !uninstalled_db_files.contains(n));

    // Safe SHM cache cleanup: Active .db-shm is ephemeral and must be cleared
    let shm_path = root.join(DB_FILES[2]);
    if let Ok(meta) = std::fs::symlink_metadata(&shm_path) {
        if is_symlink_or_reparse(&meta) {
            errors.push(
                "Active shared memory cache (.db-shm) is an unsafe symlink or reparse point".into(),
            );
        } else if let Err(e) = std::fs::remove_file(&shm_path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                errors.push(format!(
                    "Could not clear active shared memory cache (.db-shm): {e}"
                ));
            }
        }
    }

    // Clean up staged documents if installed or present
    if journal.installed_documents {
        let docs = root.join(DOCUMENTS_DIR);
        match std::fs::symlink_metadata(&docs) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(
                        "Active documents directory is an unsafe symlink or reparse point".into(),
                    );
                } else if !meta.is_dir() {
                    errors.push("Active documents path is not a directory".into());
                } else {
                    match inventory_directory_artifacts(&docs) {
                        Ok(active_doc_artifacts) => {
                            let rollback_docs_exist = rollback.join(DOCUMENTS_DIR).exists();
                            if rollback_docs_exist {
                                // Original documents are safely in rollback
                                let mut all_staged = true;
                                for art in &active_doc_artifacts {
                                    let is_staged = journal
                                        .staged_document_artifacts
                                        .iter()
                                        .any(|s| s.name == art.name && s.sha256 == art.sha256);
                                    if !is_staged {
                                        all_staged = false;
                                        break;
                                    }
                                }
                                if all_staged {
                                    if let Err(e) = std::fs::remove_dir_all(&docs) {
                                        errors.push(format!(
                                            "Could not remove installed documents: {e}"
                                        ));
                                    } else {
                                        journal.installed_documents = false;
                                    }
                                } else {
                                    errors.push("Active destination documents contains an unidentified document that cannot be deleted or overwritten".into());
                                }
                            } else if journal.original_document_artifacts.is_empty()
                                && !journal.protected_documents
                            {
                                // Original profile had NO documents
                                let mut all_staged = true;
                                for art in &active_doc_artifacts {
                                    let is_staged = journal
                                        .staged_document_artifacts
                                        .iter()
                                        .any(|s| s.name == art.name && s.sha256 == art.sha256);
                                    if !is_staged {
                                        all_staged = false;
                                        break;
                                    }
                                }
                                if all_staged {
                                    if let Err(e) = std::fs::remove_dir_all(&docs) {
                                        errors.push(format!(
                                            "Could not remove installed documents: {e}"
                                        ));
                                    } else {
                                        journal.installed_documents = false;
                                    }
                                } else {
                                    errors.push("Active destination documents contains an unidentified document that cannot be deleted or overwritten".into());
                                }
                            } else {
                                // Rollback documents do NOT exist, but original DID have documents.
                                // Check if active documents are ALREADY the returned originals!
                                let mut matches_originals = active_doc_artifacts.len()
                                    == journal.original_document_artifacts.len();
                                if matches_originals {
                                    for orig in &journal.original_document_artifacts {
                                        if !active_doc_artifacts.iter().any(|a| {
                                            a.name == orig.name
                                                && a.sha256 == orig.sha256
                                                && a.size == orig.size
                                        }) {
                                            matches_originals = false;
                                            break;
                                        }
                                    }
                                }
                                if matches_originals {
                                    // Already returned and verified original documents!
                                    journal.installed_documents = false;
                                    journal.protected_documents = false;
                                } else {
                                    errors.push("Active documents directory does not match expected original documents and rollback copy is missing".into());
                                }
                            }
                        }
                        Err(e) => {
                            errors.push(format!("Could not inspect active documents: {e}"));
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                journal.installed_documents = false;
            }
            Err(e) => {
                errors.push(format!("Could not inspect active documents directory: {e}"));
            }
        }
    }
    write_journal(root, journal)?;

    if !errors.is_empty() {
        journal.phase = RestorePhase::UnresolvedRecovery;
        let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
        let _ = write_journal(root, journal);
        return Err(errors.join("; "));
    }

    // Step 2: Pre-flight check before returning protected files
    for name in DB_FILES {
        let src = rollback.join(name);
        let dest = root.join(name);
        if src.exists() && dest.exists() {
            errors.push(format!(
                "Cannot return protected {name}: destination in active directory is obstructed"
            ));
        }
    }
    let src_docs = rollback.join(DOCUMENTS_DIR);
    let dest_docs = root.join(DOCUMENTS_DIR);
    if src_docs.exists() && dest_docs.exists() {
        errors.push(format!(
            "Cannot return protected documents: destination {DOCUMENTS_DIR} in active directory is obstructed"
        ));
    }

    if !errors.is_empty() {
        journal.phase = RestorePhase::UnresolvedRecovery;
        let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
        let _ = write_journal(root, journal);
        return Err(errors.join("; "));
    }

    // Step 3: Return protected files from rollback to root
    let originally_had_db = journal
        .protected_db_files
        .contains(&DB_FILES[0].to_string())
        || journal
            .original_db_artifacts
            .iter()
            .any(|a| a.name == DB_FILES[0])
        || rollback.join(DB_FILES[0]).exists();
    let originally_had_docs = journal.protected_documents
        || !journal.original_document_artifacts.is_empty()
        || rollback.join(DOCUMENTS_DIR).exists();

    let mut returned_db_files = Vec::new();
    #[allow(clippy::unused_enumerate_index)]
    for (_idx, name) in DB_FILES.iter().enumerate() {
        #[cfg(test)]
        let idx = _idx;
        let src = rollback.join(name);
        let dest = root.join(name);
        if !src.exists() {
            if dest.exists() {
                returned_db_files.push(name.to_string());
            } else if *name == DB_FILES[2] {
                // SHM is ephemeral SQLite cache: if not in rollback and not in active directory,
                // it will be regenerated by SQLite once durable DB and WAL are restored.
                returned_db_files.push(name.to_string());
            }
            continue;
        }

        if dest.exists() {
            errors.push(format!(
                "Cannot return protected {name}: destination in active directory is obstructed"
            ));
            continue;
        }

        #[cfg(test)]
        if let Err(e) = check_injected_fault(InjectedFault::ReturnDbRename(idx)) {
            errors.push(format!("Could not return protected {name}: {e}"));
            continue;
        }

        match std::fs::rename(&src, &dest) {
            Ok(()) => {
                returned_db_files.push(name.to_string());
            }
            Err(e) => {
                errors.push(format!(
                    "Could not return protected {name} to active directory: {e}"
                ));
            }
        }
    }
    journal
        .protected_db_files
        .retain(|name| !returned_db_files.contains(name));

    if src_docs.exists() {
        if dest_docs.exists() {
            errors.push(format!(
                "Cannot return protected documents: destination {DOCUMENTS_DIR} in active directory is obstructed"
            ));
        } else {
            #[cfg(test)]
            let inspection = check_injected_fault(InjectedFault::ReturnDocsMetadata)
                .and_then(|()| std::fs::symlink_metadata(&src_docs));
            #[cfg(not(test))]
            let inspection = std::fs::symlink_metadata(&src_docs);
            let src_meta = match inspection {
                Ok(m) => Some(m),
                Err(e) => {
                    errors.push(format!(
                        "Could not inspect recovery documents directory: {e}"
                    ));
                    None
                }
            };
            if let Some(src_meta) = src_meta {
                if is_symlink_or_reparse(&src_meta) {
                    errors.push(
                        "Recovery documents directory is an unsafe symlink or reparse point".into(),
                    );
                } else {
                    #[cfg(test)]
                    let fault_res = check_injected_fault(InjectedFault::ReturnDocsRename);
                    #[cfg(not(test))]
                    let fault_res = Ok::<(), std::io::Error>(());

                    if let Err(e) = fault_res {
                        errors.push(format!("Could not return protected documents: {e}"));
                    } else {
                        match std::fs::rename(&src_docs, &dest_docs) {
                            Ok(()) => {
                                journal.protected_documents = false;
                            }
                            Err(e) => {
                                errors.push(format!(
                                    "Could not return protected documents to active directory: {e}"
                                ));
                            }
                        }
                    }
                }
            }
        }
    } else {
        // Recovery documents directory does not exist in rollback folder.
        // Reconcile whether original documents are already present and verified in active storage!
        if dest_docs.exists() {
            match std::fs::symlink_metadata(&dest_docs) {
                Ok(meta) => {
                    if is_symlink_or_reparse(&meta) {
                        errors.push(
                            "Active documents directory is an unsafe symlink or reparse point"
                                .into(),
                        );
                    } else if !meta.is_dir() {
                        errors.push("Active documents path is not a directory".into());
                    } else {
                        match inventory_directory_artifacts(&dest_docs) {
                            Ok(active_artifacts) => {
                                let matches_all_originals = active_artifacts.len()
                                    == journal.original_document_artifacts.len()
                                    && journal.original_document_artifacts.iter().all(|orig| {
                                        active_artifacts.iter().any(|act| {
                                            act.name == orig.name
                                                && act.sha256 == orig.sha256
                                                && act.size == orig.size
                                        })
                                    });
                                if matches_all_originals {
                                    // Original documents never left active storage and match recorded identity 100%!
                                    journal.protected_documents = false;
                                } else {
                                    errors.push(
                                        "Active documents do not match recorded original document identities".into(),
                                    );
                                }
                            }
                            Err(e) => {
                                errors.push(format!(
                                    "Could not inventory active documents to reconcile original state: {e}"
                                ));
                            }
                        }
                    }
                }
                Err(e) => {
                    errors.push(format!("Could not inspect active documents: {e}"));
                }
            }
        } else if journal.original_document_artifacts.is_empty()
            && matches!(
                journal.original_documents_presence,
                None | Some(OriginalDocumentsPresence::Absent)
            )
            && !originally_had_docs
        {
            journal.protected_documents = false;
        } else if journal.original_document_artifacts.is_empty()
            && matches!(
                journal.original_documents_presence,
                Some(OriginalDocumentsPresence::PresentEmpty)
            )
        {
            if let Err(e) = std::fs::create_dir_all(&dest_docs) {
                errors.push(format!("Could not recreate empty documents directory: {e}"));
            } else {
                journal.protected_documents = false;
            }
        } else {
            errors.push(
                "Original documents are missing from both recovery and active directories".into(),
            );
        }
    }
    write_journal(root, journal)?;

    if !errors.is_empty() || !journal.protected_db_files.is_empty() {
        journal.phase = RestorePhase::UnresolvedRecovery;
        let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
        let _ = write_journal(root, journal);
        if errors.is_empty() {
            return Err(format!(
                "Recovery could not return protected files: {}",
                journal.protected_db_files.join(", ")
            ));
        }
        return Err(errors.join("; "));
    }

    // Step 4: Assess results and verify recovery completeness
    // Verify DB artifacts:
    for orig in &journal.original_db_artifacts {
        if orig.name == DB_FILES[2] {
            // SHM is ephemeral SQLite cache. If it does not exist, SQLite will regenerate it from WAL.
            // If it exists, verify it is a regular file (rejecting symlinks/reparse points).
            let p = root.join(&orig.name);
            match std::fs::symlink_metadata(&p) {
                Ok(meta) => {
                    if is_symlink_or_reparse(&meta) {
                        errors.push("Recovered file her-flight-deck.db-shm is an unsafe symlink or reparse point".into());
                    } else if !meta.is_file() {
                        errors.push(
                            "Recovered file her-flight-deck.db-shm is not a regular file".into(),
                        );
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Ephemeral cache absent: safe; regenerated by SQLite on next open
                }
                Err(e) => {
                    errors.push(format!(
                        "Could not inspect recovered file her-flight-deck.db-shm: {e}"
                    ));
                }
            }
            continue;
        }
        let p = root.join(&orig.name);
        match std::fs::symlink_metadata(&p) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(format!(
                        "Recovered file {} is an unsafe symlink or reparse point",
                        orig.name
                    ));
                } else if !meta.is_file() {
                    errors.push(format!(
                        "Recovered file {} is not a regular file",
                        orig.name
                    ));
                } else {
                    match std::fs::read(&p) {
                        Ok(bytes) => {
                            let hash = hex::encode(Sha256::digest(&bytes));
                            if hash != orig.sha256 || bytes.len() as u64 != orig.size {
                                errors.push(format!(
                                    "Recovered file {} has modified content (hash {hash} != expected {})",
                                    orig.name, orig.sha256
                                ));
                            }
                        }
                        Err(e) => {
                            errors
                                .push(format!("Could not read recovered file {}: {e}", orig.name));
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                errors.push(format!(
                    "Original file {} is missing from active directory after recovery",
                    orig.name
                ));
            }
            Err(e) => {
                errors.push(format!(
                    "Could not inspect recovered file {}: {e}",
                    orig.name
                ));
            }
        }
    }

    if originally_had_db && !root.join(DB_FILES[0]).is_file() {
        errors.push(
            "Rollback completed moves, but primary database is missing from active directory"
                .into(),
        );
    }

    // Verify document artifacts:
    let active_docs = root.join(DOCUMENTS_DIR);
    if originally_had_docs {
        // Original profile HAD documents. Verify they are all present and unmodified!
        match std::fs::symlink_metadata(&active_docs) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(
                        "Active documents directory is an unsafe symlink or reparse point".into(),
                    );
                } else if !meta.is_dir() {
                    errors.push("Active documents path is not a directory".into());
                } else {
                    match inventory_directory_artifacts(&active_docs) {
                        Ok(active_items) => {
                            for orig in &journal.original_document_artifacts {
                                match active_items.iter().find(|a| a.name == orig.name) {
                                    Some(active) => {
                                        if active.sha256 != orig.sha256 || active.size != orig.size
                                        {
                                            errors.push(format!(
                                            "Original document {} has modified content after recovery (hash {} != expected {})",
                                            orig.name, active.sha256, orig.sha256
                                        ));
                                        }
                                    }
                                    None => {
                                        errors.push(format!(
                                        "Original document {} is missing from active directory after recovery",
                                        orig.name
                                    ));
                                    }
                                }
                            }
                            for active in &active_items {
                                if !journal
                                    .original_document_artifacts
                                    .iter()
                                    .any(|o| o.name == active.name)
                                {
                                    errors.push(format!(
                                    "Active documents directory contains unexpected file {} after recovery",
                                    active.name
                                ));
                                }
                            }
                        }
                        Err(e) => {
                            errors.push(format!("Could not inventory recovered documents: {e}"));
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                errors.push(
                    "Original documents directory is missing from active directory after recovery"
                        .into(),
                );
            }
            Err(e) => {
                errors.push(format!("Could not inspect active documents: {e}"));
            }
        }
    } else if journal.installed_documents {
        // Original profile had NO documents, but staged documents were installed.
        // Recovery must verify that documents are absent or empty!
        match std::fs::symlink_metadata(&active_docs) {
            Ok(meta) => {
                if is_symlink_or_reparse(&meta) {
                    errors.push(
                        "Active documents directory is an unsafe symlink or reparse point".into(),
                    );
                } else if meta.is_dir() {
                    match inventory_directory_artifacts(&active_docs) {
                        Ok(items) => {
                            if !items.is_empty() {
                                errors.push("Active documents directory contains unexpected files after recovery".into());
                            }
                        }
                        Err(e) => {
                            errors.push(format!("Could not inspect active documents: {e}"));
                        }
                    }
                } else {
                    errors.push("Active documents path is not a directory".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Correct: original had no documents, active directory is absent
            }
            Err(e) => {
                errors.push(format!("Could not inspect active documents: {e}"));
            }
        }
    } else if let Ok(meta) = std::fs::symlink_metadata(&active_docs) {
        if is_symlink_or_reparse(&meta) {
            errors.push("Active documents directory is an unsafe symlink or reparse point".into());
        }
    }

    if originally_had_docs && journal.protected_documents {
        errors.push("Protected documents were not fully verified and recovered".into());
    }

    if !errors.is_empty() {
        journal.phase = RestorePhase::UnresolvedRecovery;
        let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
        let _ = write_journal(root, journal);
        return Err(errors.join("; "));
    }

    // Step 5: Verify no leftovers in rollback
    if rollback.exists() {
        let entries = std::fs::read_dir(&rollback)
            .map_err(|e| format!("Could not inspect recovery directory for leftovers: {e}"))?;
        let mut leftover = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| format!("Could not read recovery entry: {e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name != ".recovery-pending" {
                leftover.push(name);
            }
        }
        if !leftover.is_empty() {
            journal.phase = RestorePhase::UnresolvedRecovery;
            let _ = std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery");
            let _ = write_journal(root, journal);
            return Err(format!(
                "Rollback left unaccounted files in recovery directory: {}",
                leftover.join(", ")
            ));
        }
    }

    // Step 6: Safe to clean up rollback folder and record RolledBack
    let _ = std::fs::remove_file(rollback.join(".recovery-pending"));
    if rollback.exists() {
        std::fs::remove_dir_all(&rollback)
            .map_err(|e| format!("Could not clean up recovery folder: {e}"))?;
    }

    journal.phase = RestorePhase::RolledBack;
    write_journal(root, journal)?;

    Ok(())
}

pub(super) fn apply_pending_restore_in_internal<F>(
    root: &Path,
    before_install: F,
) -> Result<RestoreApplicationResult, String>
where
    F: FnOnce() -> Result<(), String>,
{
    if root.join(RESTORE_JOURNAL_FILE).exists() {
        let resume_decision = handle_startup_restore_in(root)?;
        match resume_decision {
            StartupRestoreDecision::ProceedNormally => {}
            StartupRestoreDecision::RestoreCompleted => {
                crate::practice_sessions::bump_readiness_generation_at(root);
                return Ok(RestoreApplicationResult::Installed);
            }
            StartupRestoreDecision::StagingRefusedUnchanged { reason } => {
                return Ok(RestoreApplicationResult::RefusedUnchanged(reason));
            }
            StartupRestoreDecision::RolledBackRecovered { reason } => {
                return Ok(RestoreApplicationResult::Recovered(format!(
                    "Restore failed and the previous data was recovered: {reason}"
                )));
            }
            StartupRestoreDecision::BlockedUnresolved {
                reason,
                recovery_folder,
            } => {
                let folder = recovery_folder.unwrap_or_else(|| root.join(BACKUP_DIR));
                return Ok(RestoreApplicationResult::Unresolved {
                    reason,
                    recovery_folder: folder,
                });
            }
        }
    }

    inspect_storage_root(root, "Application root directory")?
        .ok_or_else(|| "Application root directory does not exist".to_string())?;

    let pending = root.join(RESTORE_PENDING_DIR);
    if inspect_storage_root(&pending, "Pending restore directory")?.is_none() {
        return Ok(RestoreApplicationResult::NoPending);
    }
    if !pending.join(DB_FILES[0]).is_file() {
        let _ = std::fs::remove_dir_all(&pending);
        return Ok(RestoreApplicationResult::RefusedUnchanged(
            "A staged restore was incomplete; current data was left unchanged.".to_string(),
        ));
    }
    if let Err(error) = verify_sqlite_file(&pending.join(DB_FILES[0]))
        .and_then(|()| crate::sqlite_guard::check_wal_pair(&pending.join(DB_FILES[0])))
    {
        let _ = std::fs::remove_dir_all(&pending);
        return Ok(RestoreApplicationResult::RefusedUnchanged(format!(
            "The staged restore was not usable, so nothing was changed: {error}"
        )));
    }

    let (plan, replace_documents) = match read_restore_plan_for_ownership(&pending)? {
        Some(plan) => {
            let replace_docs = plan.kind == RestoreKind::Complete;
            (plan, replace_docs)
        }
        None => (
            RestorePlan {
                operation_id: String::new(),
                kind: RestoreKind::Complete,
                source: "legacy".to_string(),
            },
            true,
        ),
    };
    let is_start_fresh = plan.source == "start-fresh";

    let rollback = unique_backup_path(&backup_dir(root)?, "before-restore");
    std::fs::create_dir_all(&rollback)
        .map_err(|e| format!("Could not prepare a recovery copy before restoring: {e}"))?;

    let rollback_rel = rollback
        .strip_prefix(root)
        .map_err(|e| format!("Could not compute relative rollback path: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");

    let current_documents = root.join(DOCUMENTS_DIR);
    let mut journal = RestoreJournal::new(rollback_rel, replace_documents);
    journal.operation_id = plan.operation_id;

    // Pre-record intent: record durable DB files and hashes that exist in root BEFORE moving them!
    const DURABLE_DB_FILES: [&str; 2] = [DB_FILES[0], DB_FILES[1]];
    for name in DURABLE_DB_FILES {
        let p = root.join(name);
        if p.is_file() {
            journal.protected_db_files.push(name.to_string());
            let bytes = std::fs::read(&p).map_err(|e| {
                format!("Could not read current DB file {name} before protection: {e}")
            })?;
            journal.original_db_artifacts.push(ArtifactIdentity {
                name: name.to_string(),
                sha256: hex::encode(Sha256::digest(&bytes)),
                size: bytes.len() as u64,
            });
        }
    }
    if current_documents.exists() {
        let arts = inventory_directory_artifacts(&current_documents)
            .map_err(|e| format!("Could not inventory current documents before protection: {e}"))?;
        if arts.is_empty() {
            journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentEmpty);
        } else {
            journal.original_documents_presence =
                Some(OriginalDocumentsPresence::PresentWithContent);
        }
        journal.original_document_artifacts = arts;
        if replace_documents {
            journal.protected_documents = true;
        }
    } else {
        journal.original_documents_presence = Some(OriginalDocumentsPresence::Absent);
    }
    if replace_documents && pending.join(DOCUMENTS_DIR).exists() {
        let arts = inventory_directory_artifacts(&pending.join(DOCUMENTS_DIR)).map_err(|e| {
            format!("Could not inventory staged documents before installation: {e}")
        })?;
        journal.staged_document_artifacts = arts;
    }

    // Pre-record staged artifacts from pending directory before installing them
    for name in DB_FILES {
        let p = pending.join(name);
        if p.is_file() {
            let bytes = std::fs::read(&p)
                .map_err(|e| format!("Could not read staged DB file {name}: {e}"))?;
            journal.staged_db_artifacts.push(ArtifactIdentity {
                name: name.to_string(),
                sha256: hex::encode(Sha256::digest(&bytes)),
                size: bytes.len() as u64,
            });
        }
    }
    write_journal(root, &journal)?;

    let protect_result = (|| {
        #[allow(clippy::unused_enumerate_index)]
        for (_idx, name) in journal.protected_db_files.clone().iter().enumerate() {
            #[cfg(test)]
            let idx = _idx;
            let current = root.join(name);
            if current.exists() {
                #[cfg(test)]
                check_injected_fault(InjectedFault::ProtectDbRename(idx))
                    .map_err(|e| format!("Could not protect the current {name}: {e}"))?;

                std::fs::rename(&current, rollback.join(name))
                    .map_err(|e| format!("Could not protect the current {name}: {e}"))?;
            }
        }
        if journal.protected_documents && current_documents.exists() {
            #[cfg(test)]
            check_injected_fault(InjectedFault::ProtectDocsRename)
                .map_err(|e| format!("Could not protect the current documents: {e}"))?;

            std::fs::rename(&current_documents, rollback.join(DOCUMENTS_DIR))
                .map_err(|e| format!("Could not protect the current documents: {e}"))?;
        }
        journal.phase = RestorePhase::Protected;
        write_journal(root, &journal)?;
        Ok::<(), String>(())
    })();

    if let Err(error) = protect_result {
        journal.failure_reason = Some(error.clone());
        let rollback_res = execute_rollback(root, &mut journal);
        match rollback_res {
            Ok(()) => {
                let mut cleanup_succeeded = true;
                match inspect_storage_root(&pending, "Pending restore directory") {
                    Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                        Ok(true) => {
                            if let Err(e) = remove_pending_directory_safely(&pending) {
                                log::warn!(
                                    "Could not remove the staged restore folder: {:?}",
                                    e.kind()
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        _ => {
                            cleanup_succeeded = false;
                        }
                    },
                    Ok(None) => {}
                    Err(_) => {
                        log::warn!("Could not inspect the pending restore folder.");
                        cleanup_succeeded = false;
                    }
                }
                if cleanup_succeeded {
                    let _ = remove_journal(root);
                }
                return Ok(RestoreApplicationResult::RefusedUnchanged(format!(
                    "Restore was stopped before changing current data: {error}"
                )));
            }
            Err(rollback_err) => {
                let full_rollback = root.join(&journal.rollback_rel_path);
                return Ok(RestoreApplicationResult::Unresolved {
                    reason: format!(
                        "Restore failed ({error}) and recovery rollback could not return original data: {rollback_err}. Original data is safely preserved at {}.",
                        full_rollback.display()
                    ),
                    recovery_folder: full_rollback,
                });
            }
        }
    }

    journal.phase = RestorePhase::Activating;
    write_journal(root, &journal)?;

    let install_result = (|| {
        before_install()?;

        journal.installed_db_files.push(DB_FILES[0].to_string());
        write_journal(root, &journal)?;

        #[cfg(test)]
        check_injected_fault(InjectedFault::InstallDbRename(0))
            .map_err(|e| format!("Could not install the restored database: {e}"))?;

        std::fs::rename(pending.join(DB_FILES[0]), root.join(DB_FILES[0]))
            .map_err(|e| format!("Could not install the restored database: {e}"))?;

        let restored_wal = pending.join(DB_FILES[1]);
        if restored_wal.is_file() {
            journal.installed_db_files.push(DB_FILES[1].to_string());
            write_journal(root, &journal)?;

            #[cfg(test)]
            check_injected_fault(InjectedFault::InstallDbRename(1))
                .map_err(|e| format!("Could not install the restored database log: {e}"))?;

            std::fs::rename(&restored_wal, root.join(DB_FILES[1]))
                .map_err(|e| format!("Could not install the restored database log: {e}"))?;
        }

        if replace_documents {
            journal.installed_documents = true;
            write_journal(root, &journal)?;
            let restored_documents = pending.join(DOCUMENTS_DIR);

            #[cfg(test)]
            check_injected_fault(InjectedFault::InstallDocsRename)
                .map_err(|e| format!("Could not install the restored documents: {e}"))?;

            if restored_documents.exists() {
                std::fs::rename(&restored_documents, &current_documents)
                    .map_err(|e| format!("Could not install the restored documents: {e}"))?;
            } else {
                std::fs::create_dir_all(&current_documents)
                    .map_err(|e| format!("Could not create the restored documents folder: {e}"))?;
            }
        }
        Ok::<(), String>(())
    })();

    if let Err(error) = install_result {
        journal.failure_reason = Some(error.clone());
        let rollback_res = execute_rollback(root, &mut journal);
        match rollback_res {
            Ok(()) => {
                let mut cleanup_succeeded = true;
                match inspect_storage_root(&pending, "Pending restore directory") {
                    Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                        Ok(true) => {
                            if let Err(e) = remove_pending_directory_safely(&pending) {
                                log::warn!(
                                    "Could not remove the staged restore folder: {:?}",
                                    e.kind()
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        _ => {
                            cleanup_succeeded = false;
                        }
                    },
                    Ok(None) => {}
                    Err(_) => {
                        log::warn!("Could not inspect the pending restore folder.");
                        cleanup_succeeded = false;
                    }
                }
                if cleanup_succeeded {
                    let _ = remove_journal(root);
                }
                return Ok(RestoreApplicationResult::Recovered(format!(
                    "Restore failed and the previous data was recovered: {error}"
                )));
            }
            Err(rollback_err) => {
                let full_rollback = root.join(&journal.rollback_rel_path);
                return Ok(RestoreApplicationResult::Unresolved {
                    reason: format!(
                        "Restore failed ({error}) and recovery rollback could not return original data: {rollback_err}. Original data is safely preserved at {}.",
                        full_rollback.display()
                    ),
                    recovery_folder: full_rollback,
                });
            }
        }
    }

    journal.phase = RestorePhase::Committed;
    write_journal(root, &journal)?;

    if is_start_fresh {
        delete_start_fresh_leftovers(root);
    }

    let mut cleanup_succeeded = true;
    match inspect_storage_root(&pending, "Pending restore directory") {
        Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
            Ok(true) => {
                if let Err(e) = remove_pending_directory_safely(&pending) {
                    log::warn!("Could not remove the staged restore folder: {:?}", e.kind());
                    cleanup_succeeded = false;
                }
            }
            Ok(false) => {
                log::warn!("The pending restore folder does not match the restore journal.");
                cleanup_succeeded = false;
            }
            Err(_) => {
                log::warn!("Could not verify who owns the pending restore folder.");
                cleanup_succeeded = false;
            }
        },
        Ok(None) => {}
        Err(_) => {
            log::warn!("The pending restore folder is unsafe; it was left in place.");
            cleanup_succeeded = false;
        }
    }
    if !is_start_fresh {
        let _ = prune(root);
        record_phone_baseline_best_effort(root);
    }

    // GEN-REL-02: nothing Gemini produced for the replaced library may be saved
    // into the restored one. This is part of the committed restore: until it
    // succeeds the restore journal is kept, so the next launch tries again.
    let jobs_cleared = forget_gemini_jobs(root);
    if cleanup_succeeded && jobs_cleared {
        let _ = remove_journal(root);
    }

    crate::practice_sessions::bump_readiness_generation_at(root);
    Ok(RestoreApplicationResult::Installed)
}

/// Forget every Gemini job recorded against the library a restore replaced
/// (GEN-REL-02). False if an old job could still be read back.
pub(super) fn forget_gemini_jobs(root: &Path) -> bool {
    match crate::gemini_jobs::clear_after_restore(root) {
        Ok(()) => true,
        Err(_) => {
            log::warn!(
                "Could not forget Gemini jobs after restoring; will try again at the next launch."
            );
            false
        }
    }
}

/// Install a restore that was fully validated and staged during the previous run.
///
/// This runs during setup, before the SQL connection opens. Existing data is
/// moved into a recoverable internal backup first and put back if installation
/// fails at any point.
#[allow(dead_code)]
pub fn apply_pending_restore(app: &AppHandle) -> Result<(), String> {
    let root = app_root(app)?;
    apply_pending_restore_in(&root)
}

/// Install whatever was staged, against a plain directory.
#[allow(dead_code)]
pub(crate) fn apply_pending_restore_in(root: &Path) -> Result<(), String> {
    apply_pending_restore_in_with(root, || Ok(()))
}

#[allow(dead_code)]
pub(super) fn apply_pending_restore_in_with<F>(root: &Path, before_install: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    match apply_pending_restore_in_internal(root, before_install) {
        Ok(RestoreApplicationResult::NoPending) => Ok(()),
        Ok(RestoreApplicationResult::Installed) => Ok(()),
        Ok(RestoreApplicationResult::RefusedUnchanged(msg)) => Err(msg),
        Ok(RestoreApplicationResult::Recovered(msg)) => Err(msg),
        Ok(RestoreApplicationResult::Unresolved { reason, .. }) => Err(reason),
        Err(e) => Err(e),
    }
}

/// Inspect disk and journal state at startup to determine whether startup is safe to continue.
pub(crate) fn handle_startup_restore_in(root: &Path) -> Result<StartupRestoreDecision, String> {
    let journal = match read_journal(root) {
        Ok(Some(j)) => Some(j),
        Ok(None) => None,
        Err(e) => {
            return Ok(StartupRestoreDecision::BlockedUnresolved {
                reason: format!("Restore journal validation failed: {e}"),
                recovery_folder: None,
            });
        }
    };

    if journal.is_none() {
        match find_unresolved_recovery_evidence(root) {
            Ok(Some((reason, recovery_folder))) => {
                return Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason,
                    recovery_folder,
                });
            }
            Ok(None) => {}
            Err(e) => {
                return Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: format!("Failed to inspect recovery evidence: {e}"),
                    recovery_folder: None,
                });
            }
        }
        match apply_pending_restore_in_internal(root, || Ok(())) {
            Ok(RestoreApplicationResult::NoPending) => {
                return Ok(StartupRestoreDecision::ProceedNormally)
            }
            Ok(RestoreApplicationResult::Installed) => {
                reset_sync_identity_best_effort(root);
                return Ok(StartupRestoreDecision::RestoreCompleted);
            }
            Ok(RestoreApplicationResult::RefusedUnchanged(reason)) => {
                return Ok(StartupRestoreDecision::StagingRefusedUnchanged { reason });
            }
            Ok(RestoreApplicationResult::Recovered(reason)) => {
                return Ok(StartupRestoreDecision::RolledBackRecovered { reason });
            }
            Ok(RestoreApplicationResult::Unresolved {
                reason,
                recovery_folder,
            }) => {
                return Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason,
                    recovery_folder: Some(recovery_folder),
                });
            }
            Err(e) => {
                return Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: e,
                    recovery_folder: None,
                });
            }
        }
    }

    let mut journal = journal.unwrap();

    let _rollback_dir = match journal.validate(root) {
        Ok(p) => p,
        Err(e) => {
            return Ok(StartupRestoreDecision::BlockedUnresolved {
                reason: format!("Restore journal validation failed: {e}"),
                recovery_folder: None,
            });
        }
    };

    match journal.phase {
        RestorePhase::Committed => {
            let pending = root.join(RESTORE_PENDING_DIR);
            let is_start_fresh = read_restore_plan_for_ownership(&pending)
                .ok()
                .flatten()
                .is_some_and(|p| p.source == "start-fresh");
            let mut cleanup_succeeded = true;
            match inspect_storage_root(&pending, "Pending restore directory") {
                Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                    Ok(true) => {
                        if let Err(e) = remove_pending_directory_safely(&pending) {
                            log::warn!(
                                "Could not remove the staged restore folder: {:?}",
                                e.kind()
                            );
                            cleanup_succeeded = false;
                        }
                    }
                    Ok(false) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!(
                                "Committed restore journal ({}) cannot remove pending directory belonging to a different or unverified operation",
                                journal.operation_id
                            ),
                            recovery_folder: None,
                        });
                    }
                    Err(e) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!(
                                "Cannot verify ownership of pending restore directory: {e}"
                            ),
                            recovery_folder: None,
                        });
                    }
                },
                Ok(None) => {}
                Err(e) => {
                    return Ok(StartupRestoreDecision::BlockedUnresolved {
                        reason: format!("Cannot inspect pending restore directory: {e}"),
                        recovery_folder: None,
                    });
                }
            }
            if cleanup_succeeded {
                if is_start_fresh {
                    delete_start_fresh_leftovers(root);
                } else {
                    record_phone_baseline_best_effort(root);
                    let _ = prune(root);
                }
                reset_sync_identity_best_effort(root);
                // A restore interrupted after it committed: finish forgetting
                // the replaced library's Gemini jobs before the journal goes.
                if forget_gemini_jobs(root) {
                    let _ = remove_journal(root);
                }
                Ok(StartupRestoreDecision::RestoreCompleted)
            } else {
                Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: "Pending cleanup failed; restore journal retained".into(),
                    recovery_folder: None,
                })
            }
        }
        RestorePhase::RolledBack => {
            let pending = root.join(RESTORE_PENDING_DIR);
            let mut cleanup_succeeded = true;
            match inspect_storage_root(&pending, "Pending restore directory") {
                Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                    Ok(true) => {
                        if let Err(e) = remove_pending_directory_safely(&pending) {
                            log::warn!(
                                "Could not remove the staged restore folder: {:?}",
                                e.kind()
                            );
                            cleanup_succeeded = false;
                        }
                    }
                    Ok(false) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!(
                                "RolledBack restore journal ({}) cannot remove pending directory belonging to a different or unverified operation",
                                journal.operation_id
                            ),
                            recovery_folder: None,
                        });
                    }
                    Err(e) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!(
                                "Cannot verify ownership of pending restore directory: {e}"
                            ),
                            recovery_folder: None,
                        });
                    }
                },
                Ok(None) => {}
                Err(e) => {
                    return Ok(StartupRestoreDecision::BlockedUnresolved {
                        reason: format!("Cannot inspect pending restore directory: {e}"),
                        recovery_folder: None,
                    });
                }
            }
            if cleanup_succeeded {
                let _ = remove_journal(root);
                Ok(StartupRestoreDecision::RolledBackRecovered {
                    reason: journal.failure_reason.unwrap_or_else(|| {
                        "interrupted restore was rolled back to original data".to_string()
                    }),
                })
            } else {
                Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: "Pending cleanup failed after rollback; restore journal retained"
                        .into(),
                    recovery_folder: None,
                })
            }
        }
        RestorePhase::UnresolvedRecovery
        | RestorePhase::RollingBack
        | RestorePhase::Protecting
        | RestorePhase::Protected
        | RestorePhase::Activating => match execute_rollback(root, &mut journal) {
            Ok(()) => {
                let pending = root.join(RESTORE_PENDING_DIR);
                let mut cleanup_succeeded = true;
                match inspect_storage_root(&pending, "Pending restore directory") {
                    Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                        Ok(true) => {
                            if let Err(e) = remove_pending_directory_safely(&pending) {
                                log::warn!(
                                    "Could not remove the staged restore folder: {:?}",
                                    e.kind()
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        Ok(false) => {
                            return Ok(StartupRestoreDecision::BlockedUnresolved {
                                reason: format!(
                                    "Rolled back restore journal ({}) cannot remove pending directory belonging to a different or unverified operation",
                                    journal.operation_id
                                ),
                                recovery_folder: None,
                            });
                        }
                        Err(e) => {
                            return Ok(StartupRestoreDecision::BlockedUnresolved {
                                reason: format!(
                                    "Cannot verify ownership of pending restore directory: {e}"
                                ),
                                recovery_folder: None,
                            });
                        }
                    },
                    Ok(None) => {}
                    Err(e) => {
                        return Ok(StartupRestoreDecision::BlockedUnresolved {
                            reason: format!("Cannot inspect pending restore directory: {e}"),
                            recovery_folder: None,
                        });
                    }
                }
                if cleanup_succeeded {
                    let _ = remove_journal(root);
                    Ok(StartupRestoreDecision::RolledBackRecovered {
                        reason: journal.failure_reason.unwrap_or_else(|| {
                            "interrupted restore was rolled back to original data".to_string()
                        }),
                    })
                } else {
                    Ok(StartupRestoreDecision::BlockedUnresolved {
                        reason: "Pending cleanup failed after rollback; restore journal retained"
                            .into(),
                        recovery_folder: None,
                    })
                }
            }
            Err(rollback_err) => {
                journal.phase = RestorePhase::UnresolvedRecovery;
                let _ = write_journal(root, &journal);
                let orig_err = journal
                    .failure_reason
                    .as_deref()
                    .unwrap_or("prior restore failed");
                let full_rollback = root.join(&journal.rollback_rel_path);
                Ok(StartupRestoreDecision::BlockedUnresolved {
                    reason: format!(
                        "Restore failed ({orig_err}) and recovery rollback could not return original data: {rollback_err}. Original data is safely preserved at {}.",
                        full_rollback.display()
                    ),
                    recovery_folder: Some(full_rollback),
                })
            }
        },
    }
}

/// The startup restore under the library lock. Nothing else holds it this
/// early, and a lock that cannot be taken must never stop the app from
/// opening: it carries on without the lock, exactly as before the lock existed.
pub(crate) fn handle_startup_restore_locked(root: &Path) -> Result<StartupRestoreDecision, String> {
    let _guard = match crate::library_lock::try_acquire(root, crate::library_lock::Holder::Library)
    {
        Ok(guard) => Some(guard),
        Err(_) => {
            log::warn!("Could not lock the study library at startup; continuing without the lock.");
            None
        }
    };
    handle_startup_restore_in(root)
}

/// Installs or resolves any pending restore before SQLite opens. Returns
/// whether this startup finished a restore, so the caller can bring the
/// restarted window forward: the restart execs the binary directly rather than
/// through LaunchServices, and macOS would otherwise leave it behind whatever
/// was in front.
pub fn handle_startup_restore(app: &AppHandle) -> Result<bool, String> {
    let root = app_root(app)?;
    let decision = handle_startup_restore_locked(&root)?;
    crate::safety_notices::record_restore_outcome(&root, &decision);
    startup_restore_outcome(decision)
}

pub(super) fn startup_restore_outcome(decision: StartupRestoreDecision) -> Result<bool, String> {
    match decision {
        StartupRestoreDecision::ProceedNormally => Ok(false),
        StartupRestoreDecision::RestoreCompleted => Ok(true),
        StartupRestoreDecision::StagingRefusedUnchanged { .. } => {
            log::warn!("A pending restore was refused; current data unchanged.");
            Ok(false)
        }
        StartupRestoreDecision::RolledBackRecovered { .. } => {
            log::error!("A pending restore failed; the previous data was recovered.");
            Ok(false)
        }
        StartupRestoreDecision::BlockedUnresolved {
            reason,
            recovery_folder,
        } => {
            let loc = recovery_folder
                .map(|p| format!(" (recovery copy preserved at: {})", p.display()))
                .unwrap_or_default();
            Err(format!(
                "Startup blocked to prevent data loss: {reason}{loc}. Resolve data obstruction or restore from backup before relaunching."
            ))
        }
    }
}
