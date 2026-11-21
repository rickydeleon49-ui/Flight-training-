//! Writing, reading and checking complete backup archives.

use super::*;

pub(super) fn zip_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

pub(super) fn archive_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600)
}

pub(super) fn add_file_to_archive<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    source: &Path,
    archive_name: &str,
) -> Result<IntegrityEntry, String> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|e| format!("Could not read {}: {e}", source.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "Backup source is not a regular file: {}",
            source.display()
        ));
    }

    archive
        .start_file(archive_name, archive_options())
        .map_err(|e| zip_error("Could not add a file to the backup", e))?;
    let mut input =
        File::open(source).map_err(|e| format!("Could not open {}: {e}", source.display()))?;
    let mut hasher = Sha256::new();
    let mut copied = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|e| format!("Could not read {}: {e}", source.display()))?;
        if read == 0 {
            break;
        }
        archive
            .write_all(&buffer[..read])
            .map_err(|e| format!("Could not copy {} into the backup: {e}", source.display()))?;
        hasher.update(&buffer[..read]);
        copied = copied
            .checked_add(read as u64)
            .ok_or_else(|| "The backup is too large.".to_string())?;
    }
    if copied != metadata.len() {
        return Err(format!(
            "{} changed while the backup was being saved. Try again.",
            source.display()
        ));
    }
    Ok(IntegrityEntry {
        path: archive_name.to_string(),
        bytes: copied,
        sha256: hex::encode(hasher.finalize()),
    })
}

/// The device id kept in `app_metadata`, if the table and row exist.
pub(super) fn read_device_id(connection: &Connection) -> Option<String> {
    connection
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'device_id'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
}

/// Schema version and device id of a database file, for the backup manifest.
/// Never fails the export: anything unreadable becomes `None`.
pub(super) fn snapshot_schema_and_device(database: &Path) -> (Option<i64>, Option<String>) {
    match Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(connection) => {
            let schema = match newest_migration_version(&connection) {
                Ok(version) => Some(version),
                Err(e) => {
                    log::warn!("Backup manifest: could not read the schema version: {e}");
                    None
                }
            };
            (schema, read_device_id(&connection))
        }
        Err(e) => {
            log::warn!("Backup manifest: could not open the snapshot: {e}");
            (None, None)
        }
    }
}

/// Take a database snapshot, retrying a bounded number of times if the
/// reason it failed was another connection briefly holding a lock.
///
/// Each attempt is independent and cleans up its own partial file on
/// failure (see `database_snapshot`), so retrying is just trying again —
/// nothing from a failed attempt is reused or left behind.
pub(super) fn database_snapshot_with_retry(root: &Path) -> Result<PathBuf, String> {
    let mut last_error = String::new();
    for attempt in 0..=SNAPSHOT_LOCK_RETRIES {
        match database_snapshot(root) {
            Ok(snapshot) => return Ok(snapshot),
            Err(error) if attempt < SNAPSHOT_LOCK_RETRIES && is_transient_lock_error(&error) => {
                last_error = error;
                std::thread::sleep(Duration::from_millis(200 * u64::from(attempt + 1)));
            }
            Err(error) if is_transient_lock_error(&error) => {
                return Err(
                    "The database was busy, so the backup could not be started after several \
                     tries. Close any other window and try again."
                        .to_string(),
                );
            }
            Err(error) => return Err(error),
        }
    }
    // Unreachable in practice — the loop always returns on its last
    // iteration — but a bound that could fall through silently defeats the
    // point of having one.
    Err(last_error)
}

pub(super) fn database_snapshot(root: &Path) -> Result<PathBuf, String> {
    let source_path = root.join(DB_FILES[0]);
    // Restores picture links a phone-made version lost (exact matches only), so
    // the check below does not refuse a library this build can mend.
    // Only when the check itself refuses (not when the file is merely busy).
    if let Err(first) = verify_application_database(&source_path) {
        if is_transient_lock_error(&first)
            || !crate::sync::receipts::repair_picture_links_at(root).is_ok_and(|n| n > 0)
        {
            return Err(first);
        }
    }
    verify_application_database(&source_path)?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let snapshot = root.join(format!(
        ".backup-snapshot-{}-{}.db",
        std::process::id(),
        nonce
    ));

    let result = (|| {
        let source = Connection::open_with_flags(&source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Could not open the database for backup: {e}"))?;
        let _ = source.busy_timeout(BUSY_TIMEOUT);
        let mut destination = Connection::open(&snapshot)
            .map_err(|e| format!("Could not create the database snapshot: {e}"))?;
        let _ = destination.busy_timeout(BUSY_TIMEOUT);
        {
            let backup = Backup::new(&source, &mut destination)
                .map_err(|e| format!("Could not start the database snapshot: {e}"))?;
            backup
                .run_to_completion(100, Duration::from_millis(10), None)
                .map_err(|e| format!("Could not finish the database snapshot: {e}"))?;
        }
        drop(destination);
        drop(source);
        verify_application_database(&snapshot)?;
        Ok(snapshot.clone())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&snapshot);
    }
    result
}

pub(super) fn add_documents_to_archive<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    directory: &Path,
    relative: &Path,
    files: &mut usize,
    bytes: &mut u64,
    integrity: &mut Vec<IntegrityEntry>,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }

    let entries = std::fs::read_dir(directory)
        .map_err(|e| format!("Could not read {}: {e}", directory.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not read a document entry: {e}"))?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let metadata = std::fs::symlink_metadata(entry.path())
            .map_err(|e| format!("Could not inspect {}: {e}", entry.path().display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "A linked file cannot be included in a backup: {}",
                entry.path().display()
            ));
        }

        let next_relative = relative.join(entry.file_name());
        if metadata.is_dir() {
            add_documents_to_archive(
                archive,
                &entry.path(),
                &next_relative,
                files,
                bytes,
                integrity,
            )?;
        } else if metadata.is_file() {
            let name = Path::new(DOCUMENTS_DIR)
                .join(&next_relative)
                .to_string_lossy()
                .replace('\\', "/");
            let saved = add_file_to_archive(archive, &entry.path(), &name)?;
            *bytes = bytes
                .checked_add(saved.bytes)
                .ok_or_else(|| "The backup is too large.".to_string())?;
            *files += 1;
            integrity.push(saved);
            if *files > MAX_RESTORE_FILES || *bytes > MAX_RESTORE_BYTES {
                return Err("The documents are too large to put in one safe backup.".to_string());
            }
        }
    }
    Ok(())
}

pub(super) fn allowed_archive_path(path: &Path, is_dir: bool) -> bool {
    // The write-ahead log travels with the database: if a checkpoint could not
    // finish, her most recent entries are in it and nowhere else.
    if path == Path::new(ARCHIVE_MANIFEST)
        || path == Path::new(ARCHIVE_INTEGRITY)
        || path == Path::new(DB_FILES[0])
        || path == Path::new(DB_FILES[1])
    {
        return !is_dir;
    }
    if path.starts_with(DOCUMENTS_DIR) {
        return is_dir || path.components().count() > 1;
    }
    false
}

pub(crate) fn validate_archive_path(raw_name: &str, path: &Path) -> Result<(), String> {
    // zip 9 enclosed_name strips a leading root; reject it before accepting
    // the normalized path, preserving zip 2's absolute-path refusal.
    if raw_name.starts_with('/')
        || raw_name.len() > MAX_ARCHIVE_PATH_BYTES
        || raw_name.contains('\\')
        || raw_name.contains(':')
        || path.components().any(|component| {
            component.as_os_str().to_string_lossy().len() > MAX_ARCHIVE_COMPONENT_BYTES
        })
    {
        return Err("The backup contains an unsafe or excessively long file path.".to_string());
    }
    Ok(())
}

pub(crate) fn validate_compression_ratio(
    uncompressed: u64,
    compressed: u64,
    max_ratio: u64,
) -> Result<(), String> {
    if uncompressed <= COMPRESSION_RATIO_FLOOR {
        return Ok(());
    }
    if compressed == 0 || uncompressed.checked_div(compressed).unwrap_or(u64::MAX) > max_ratio {
        return Err("The backup contains an unsafe compression ratio.".to_string());
    }
    Ok(())
}

/// Copy a restored file's bytes from the archive to disk, hashing exactly the
/// bytes written. Returns the byte count and SHA-256 of what was written.
///
/// Hashing while writing replaces reopening each new file to hash it
/// afterwards. That reopen is what made staging slow on Windows (about 19 ms
/// per just-written file, most of a large restore). The check is the same: the bytes
/// that went to the file must match the archive's integrity record before the
/// restore is staged, and the file is still flushed with `sync_all` first.
pub(crate) fn copy_and_hash(
    reader: &mut impl Read,
    output: &mut File,
) -> Result<(u64, String), String> {
    let mut hasher = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Could not restore a file: {e}"))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|e| format!("Could not restore a file: {e}"))?;
        hasher.update(&buffer[..read]);
        bytes = bytes
            .checked_add(read as u64)
            .ok_or_else(|| "The restored file is too large.".to_string())?;
    }
    Ok((bytes, hex::encode(hasher.finalize())))
}

pub(super) fn sha256_file_from_reader(
    reader: &mut impl Read,
) -> Result<(u64, String, Vec<u8>), String> {
    let mut hasher = Sha256::new();
    let mut bytes = 0u64;
    let mut prefix = Vec::with_capacity(SQLITE_MAGIC.len());
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Could not verify a file in that backup: {e}"))?;
        if read == 0 {
            break;
        }
        if prefix.len() < SQLITE_MAGIC.len() {
            let wanted = (SQLITE_MAGIC.len() - prefix.len()).min(read);
            prefix.extend_from_slice(&buffer[..wanted]);
        }
        hasher.update(&buffer[..read]);
        bytes = bytes
            .checked_add(read as u64)
            .ok_or_else(|| "The backup is too large.".to_string())?;
    }
    Ok((bytes, hex::encode(hasher.finalize()), prefix))
}

pub(super) fn safe_relative_document_path(relative_path: &str) -> Result<&str, String> {
    if relative_path.is_empty()
        || Path::new(relative_path).is_absolute()
        || relative_path.contains('\\')
        || relative_path.contains(':')
        || relative_path.contains('\0')
    {
        return Err("Invalid document path in database.".to_string());
    }
    let climbs_out = Path::new(relative_path)
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)));
    if climbs_out {
        return Err("Document path escapes storage.".to_string());
    }
    Ok(relative_path)
}

pub(crate) fn query_referenced_documents(database_path: &Path) -> Result<HashSet<String>, String> {
    if !database_path.is_file() {
        return Ok(HashSet::new());
    }
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not inspect database: {e}"))?;

    let has_table: bool = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='study_materials'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .map_err(|e| format!("Could not inspect database: {e}"))?;

    if !has_table {
        return Err("The database is missing the study_materials table.".to_string());
    }

    let mut stmt = connection
        .prepare("PRAGMA table_info(study_materials)")
        .map_err(|e| format!("Could not inspect table schema: {e}"))?;
    let has_file_path = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Could not inspect table schema: {e}"))?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| format!("Could not inspect table schema: {e}"))?
        .into_iter()
        .any(|col| col == "file_path");

    if !has_file_path {
        return Err(
            "The database study_materials table is missing the file_path column.".to_string(),
        );
    }

    let mut stmt = connection
        .prepare(
            "SELECT DISTINCT file_path FROM study_materials WHERE file_path IS NOT NULL AND TRIM(file_path) != ''",
        )
        .map_err(|e| format!("Could not query document references: {e}"))?;

    let mut referenced = HashSet::new();
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Could not read document paths: {e}"))?;

    for row in rows {
        let raw = row.map_err(|e| format!("Could not read document path: {e}"))?;
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = trimmed.replace('\\', "/");
        safe_relative_document_path(&normalized)?;
        referenced.insert(normalized);
    }

    Ok(referenced)
}

pub(crate) fn scan_active_documents(documents_dir: &Path) -> Result<HashSet<String>, String> {
    let mut files = HashSet::new();
    if !documents_dir.exists() {
        return Ok(files);
    }
    scan_active_documents_recursive(documents_dir, Path::new(""), &mut files)?;
    Ok(files)
}

pub(super) fn scan_active_documents_recursive(
    current_dir: &Path,
    relative_prefix: &Path,
    collected: &mut HashSet<String>,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(current_dir) {
        Ok(e) => e,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(format!("Could not read documents folder: {err}")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not read document entry: {e}"))?;
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("Could not inspect {}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "A linked file cannot be included in documents: {}",
                path.display()
            ));
        }
        let rel_path = relative_prefix.join(&file_name);
        if metadata.is_dir() {
            scan_active_documents_recursive(&path, &rel_path, collected)?;
        } else if metadata.is_file() {
            let normalized = rel_path.to_string_lossy().replace('\\', "/");
            collected.insert(normalized);
        }
    }
    Ok(())
}

/// Documents to be archived whose FAA reference copy or picture-card details
/// no longer match their bytes on disk. A 0.6.1/0.6.2 file swap left these;
/// declaring them keeps every later backup possible while a restore still
/// refuses any other mismatch as damage.
pub(super) fn detached_documents(
    root: &Path,
    database: &Path,
    to_archive: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let conn = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Could not inspect database: {e}"))?;
    let has = |table: &str| -> Result<bool, String> {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |r| r.get(0),
        )
        .map_err(|e| format!("Could not inspect database: {e}"))
    };
    let open = |path: &str| -> Result<File, String> {
        let full = root
            .join(DOCUMENTS_DIR)
            .join(safe_relative_document_path(path)?);
        File::open(full).map_err(|e| format!("Could not inspect document {path}: {e}"))
    };
    let mut detached = std::collections::BTreeSet::new();
    if has("faa_reference_copies")? {
        let mut stmt = conn
            .prepare("SELECT m.file_path, f.content_sha256 FROM faa_reference_copies f JOIN study_materials m ON m.id=f.material_id WHERE m.file_path IS NOT NULL")
            .map_err(|e| format!("Could not inspect FAA reference PDFs: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Could not inspect FAA reference PDFs: {e}"))?;
        for row in rows {
            let (path, expected) =
                row.map_err(|e| format!("Could not inspect FAA reference PDFs: {e}"))?;
            if to_archive.contains(&path)
                && sha256_file_from_reader(&mut open(&path)?)?.1 != expected
            {
                detached.insert(path);
            }
        }
    }
    if has("visual_card_regions")? {
        let mut stmt = conn
            .prepare("SELECT r.id, m.file_path FROM visual_card_regions r JOIN study_materials m ON m.id=r.image_material_id WHERE m.file_path IS NOT NULL")
            .map_err(|e| format!("Could not inspect picture cards: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| format!("Could not inspect picture cards: {e}"))?;
        for row in rows {
            let (id, path) = row.map_err(|e| format!("Could not inspect picture cards: {e}"))?;
            if !to_archive.contains(&path) || detached.contains(&path) {
                continue;
            }
            let region = crate::visual_cards::read_region(&conn, &id)?;
            let mut bytes = Vec::new();
            open(&path)?
                .take((crate::visual_cards::MAX_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Could not inspect document {path}: {e}"))?;
            if crate::visual_cards::verify_bytes(&region, &bytes).is_err() {
                detached.insert(path);
            }
        }
    }
    Ok(detached.into_iter().collect())
}

struct TempFileGuard<'a>(&'a Path);
impl<'a> Drop for TempFileGuard<'a> {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.0);
    }
}

pub(super) fn verify_archive_database_and_documents<R: Read + Seek>(
    root: &Path,
    archive: &mut ZipArchive<R>,
    manifest: &CompleteBackupManifest,
    archive_documents: &HashSet<String>,
) -> Result<(Vec<String>, Vec<String>, usize, usize), String> {
    let mut db_entry = archive
        .by_name(DB_FILES[0])
        .map_err(|_| "That backup does not contain a Flight Deck database.".to_string())?;

    static INSPECT_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let count = INSPECT_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let unique = format!(
        "hfd-inspect-{}-{}-{count}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    let staging_dir = root.join(".verify-staging");
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Could not prepare verification folder: {e}"))?;
    let temp_db_path = staging_dir.join(unique);
    let _guard = TempFileGuard(&temp_db_path);

    let mut temp_file = File::create(&temp_db_path)
        .map_err(|e| format!("Could not inspect backup database: {e}"))?;
    std::io::copy(&mut db_entry, &mut temp_file)
        .map_err(|e| format!("Could not inspect backup database: {e}"))?;
    drop(temp_file);
    drop(db_entry);

    verify_application_database(&temp_db_path)?;
    let conn = Connection::open(&temp_db_path).map_err(|_| "Could not inspect picture cards.")?;
    let detached: HashSet<&str> = manifest
        .detached_at_export
        .iter()
        .map(|s| s.as_str())
        .collect();
    // Picture regions whose picture is gone (image deleted, file removed or
    // missing) or was declared changed at export. Their card text survives.
    let mut unavailable_regions: HashSet<String> = HashSet::new();
    let mut unavailable_pictures = 0usize;
    // FAA reference copies whose PDF was removed or declared changed.
    let mut unavailable_references = 0usize;
    if crate::visual_cards::exists(&conn) {
        let mut stmt=conn.prepare("SELECT r.id,m.file_path FROM visual_card_regions r LEFT JOIN study_materials m ON m.id=r.image_material_id").map_err(|_|"Could not inspect picture cards.")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(|_| "Could not inspect picture cards.")?;
        for pair in rows {
            let (id, path) = pair.map_err(|_| "Damaged picture lookup.")?;
            let Some(path) = path else {
                unavailable_regions.insert(id);
                continue;
            };
            if !archive_documents.contains(&path) {
                unavailable_regions.insert(id);
                continue;
            } // completeness and missingAtExport checked below
            let r = crate::visual_cards::read_region(&conn, &id)?;
            let entry = archive
                .by_name(&format!("documents/{path}"))
                .map_err(|_| "Missing picture bytes.")?;
            let mut bytes = Vec::new();
            entry
                .take((crate::visual_cards::MAX_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read picture bytes.")?;
            if let Err(error) = crate::visual_cards::verify_bytes(&r, &bytes) {
                // Only a picture declared changed when the backup was made may
                // differ; anything else is a damaged archive.
                if !detached.contains(path.as_str()) {
                    return Err(error);
                }
                unavailable_regions.insert(id);
            }
        }
        unavailable_pictures = crate::visual_cards::cards_on_regions(&conn, &unavailable_regions)?;
    }

    // Schema verification above checks the stored identity's shape. Here the
    // archive supplies the actual PDF bytes, which a database-only check cannot.
    if newest_migration_version(&conn)? >= 27 {
        let mut stmt = conn.prepare(
            "SELECT m.file_path, f.content_sha256 FROM faa_reference_copies f JOIN study_materials m ON m.id=f.material_id",
        ).map_err(|_| "Could not inspect FAA reference PDFs.")?;
        let copies = stmt
            .query_map([], |r| {
                Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|_| "Could not inspect FAA reference PDFs.")?;
        for copy in copies {
            let (path, expected) = copy.map_err(|_| "Damaged FAA reference PDF details.")?;
            // A copy whose file was removed has no bytes to check.
            let Some(path) = path else {
                unavailable_references += 1;
                continue;
            };
            safe_relative_document_path(&path)?;
            // Preserve complete backups' explicit missing-at-export handling.
            if !archive_documents.contains(&path) {
                continue;
            }
            let mut entry = archive
                .by_name(&format!("documents/{path}"))
                .map_err(|_| "Missing FAA reference PDF bytes.")?;
            let (_, actual, _) = sha256_file_from_reader(&mut entry)?;
            if actual != expected {
                if !detached.contains(path.as_str()) {
                    return Err(
                        "The FAA reference PDF does not match its saved copy details.".into(),
                    );
                }
                unavailable_references += 1;
            }
        }
    }

    let referenced_documents = query_referenced_documents(&temp_db_path)?;
    let referenced_set: HashSet<&str> = referenced_documents.iter().map(|s| s.as_str()).collect();
    let missing_declared: HashSet<&str> = manifest
        .missing_at_export
        .iter()
        .map(|s| s.as_str())
        .collect();

    let mut missing_documents = manifest.missing_at_export.clone();

    for referenced in &referenced_documents {
        if !archive_documents.contains(referenced) {
            if manifest.format_version >= ARCHIVE_VERSION {
                // In format version 3 (newly created complete backups), strict two-way completeness
                // is enforced: every referenced document missing from storage must have been
                // identified and declared in manifest.missing_at_export. An unexpected omission
                // fails archive verification.
                if !missing_declared.contains(referenced.as_str()) {
                    return Err(format!(
                        "The backup database references a document that is missing from the archive: {referenced}"
                    ));
                }
            } else {
                // In format version 2 (older backups created before missing_at_export was tracked),
                // pre-existing missing files are tolerated so she can restore her library.
                // We collect any referenced document missing from the archive so restore
                // previews and warnings disclose it.
                if !missing_declared.contains(referenced.as_str()) {
                    missing_documents.push(referenced.clone());
                }
            }
        }
    }

    let mut unreferenced_documents = Vec::new();
    if manifest.format_version >= ARCHIVE_VERSION {
        let mut unreferenced: Vec<_> = archive_documents
            .iter()
            .filter(|doc| !referenced_set.contains(doc.as_str()))
            .collect();
        unreferenced.sort();
        if let Some(first_unreferenced) = unreferenced.first() {
            return Err(format!(
                "The backup archive contains an unreferenced document: {first_unreferenced}"
            ));
        }
    } else {
        for archived in archive_documents {
            if !referenced_set.contains(archived.as_str()) {
                unreferenced_documents.push(archived.clone());
            }
        }
    }

    missing_documents.sort();
    missing_documents.dedup();
    unreferenced_documents.sort();
    unreferenced_documents.dedup();

    Ok((
        missing_documents,
        unreferenced_documents,
        unavailable_pictures,
        unavailable_references,
    ))
}

/// Reads the small manifest entry of an open archive.
pub(super) fn read_manifest_from(
    archive: &mut ZipArchive<File>,
) -> Result<CompleteBackupManifest, String> {
    let mut entry = archive
        .by_name(ARCHIVE_MANIFEST)
        .map_err(|_| "That backup does not contain a manifest.".to_string())?;
    if entry.size() > 64 * 1024 {
        return Err("That backup manifest is unexpectedly large.".to_string());
    }
    let mut json = String::new();
    entry
        .read_to_string(&mut json)
        .map_err(|e| format!("Could not read the backup manifest: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("The backup manifest is invalid: {e}"))
}

/// The Mac (device id) a full copy was made by; only the manifest is read.
pub(super) fn archive_device_id(source: &Path) -> Result<Option<String>, String> {
    let file = File::open(source).map_err(|e| format!("Could not open that backup: {e}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| zip_error("That is not a readable Flight Deck backup", e))?;
    Ok(read_manifest_from(&mut archive)?.device_id)
}

pub(crate) fn inspect_archive(
    root: &Path,
    source: &Path,
    current_app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let file = File::open(source).map_err(|e| format!("Could not open that backup: {e}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| zip_error("That is not a readable Flight Deck backup", e))?;

    let manifest = read_manifest_from(&mut archive)?;

    crate::phone_work::refuse_phone_copy(manifest.platform.as_deref(), cfg!(target_os = "ios"))?;
    if manifest.format != ARCHIVE_FORMAT
        || !matches!(
            manifest.format_version,
            LEGACY_ARCHIVE_VERSION | V2_ARCHIVE_VERSION | ARCHIVE_VERSION
        )
    {
        return Err("That backup format is not supported by this version of the app.".to_string());
    }
    if let Some(n) = manifest.schema_version {
        let supported = crate::CURRENT_SCHEMA_VERSION;
        if n > supported {
            return Err(format!(
                "That backup was made by a newer version of Flight Deck (database version {n}; this app understands {supported}). Update the app on this device first."
            ));
        }
    }

    let mut expected_integrity = if manifest.format_version >= V2_ARCHIVE_VERSION {
        let mut entry = archive
            .by_name(ARCHIVE_INTEGRITY)
            .map_err(|_| "That backup does not contain integrity information.".to_string())?;
        if entry.size() > 2 * 1024 * 1024 {
            return Err("That backup's integrity information is unexpectedly large.".to_string());
        }
        let mut json = String::new();
        entry
            .read_to_string(&mut json)
            .map_err(|e| format!("Could not read backup integrity information: {e}"))?;
        let integrity: CompleteBackupIntegrity = serde_json::from_str(&json)
            .map_err(|e| format!("The backup integrity information is invalid: {e}"))?;
        if integrity.algorithm != "sha256" {
            return Err("That backup uses an unsupported integrity algorithm.".to_string());
        }
        let mut files = HashMap::new();
        for item in integrity.files {
            if item.sha256.len() != 64
                || !item.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                || files.insert(item.path.clone(), item).is_some()
            {
                return Err("That backup contains invalid integrity information.".to_string());
            }
        }
        Some(files)
    } else {
        None
    };

    let mut names = HashSet::new();
    let mut archive_documents = HashSet::new();
    let mut files = 0usize;
    let mut bytes = 0u64;
    let mut has_database = false;

    if archive.len() > MAX_RESTORE_FILES + 2 {
        return Err("That backup contains too many files.".to_string());
    }

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| zip_error("Could not inspect the backup", e))?;
        let raw_name = entry
            .name()
            .map_err(|e| zip_error("Could not read a backup file name", e))?
            .into_owned();
        let path = entry
            .enclosed_name()
            .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
        validate_archive_path(&raw_name, &path)?;
        validate_compression_ratio(entry.size(), entry.compressed_size(), MAX_COMPRESSION_RATIO)?;
        if !allowed_archive_path(&path, entry.is_dir()) {
            return Err(format!(
                "The backup contains an unexpected file: {raw_name}"
            ));
        }
        if !names.insert(path.clone()) {
            return Err(format!("The backup contains a duplicate file: {raw_name}"));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Linked files are not allowed in a backup.".to_string());
        }

        if manifest.format_version == LEGACY_ARCHIVE_VERSION && path == Path::new(ARCHIVE_INTEGRITY)
        {
            return Err(format!(
                "The backup contains an unexpected file: {raw_name}"
            ));
        }
        if path == Path::new(DB_FILES[0]) {
            has_database = true;
        }
        if path == Path::new(DB_FILES[0]) && manifest.format_version == LEGACY_ARCHIVE_VERSION {
            // Read the first bytes now. A truncated or wrong file is far
            // better discovered here than after her data has been moved aside.
            let mut header = [0u8; SQLITE_MAGIC.len()];
            if entry.read_exact(&mut header).is_err() || !is_sqlite_header(&header) {
                return Err(
                    "The database in that backup is damaged, or that file is not a Flight Deck backup."
                        .to_string(),
                );
            }
        }
        if path != Path::new(ARCHIVE_MANIFEST)
            && path != Path::new(ARCHIVE_INTEGRITY)
            && !entry.is_dir()
        {
            if path.starts_with(DOCUMENTS_DIR) {
                if let Ok(rel) = path.strip_prefix(DOCUMENTS_DIR) {
                    let normalized = rel.to_string_lossy().replace('\\', "/");
                    archive_documents.insert(normalized);
                }
            }
            files += 1;
            bytes = bytes
                .checked_add(entry.size())
                .ok_or_else(|| "The backup is too large.".to_string())?;
            if bytes > MAX_RESTORE_BYTES {
                return Err("That backup is larger than this app can safely restore.".to_string());
            }

            if let Some(expected) = expected_integrity.as_mut() {
                let normalized = path.to_string_lossy().replace('\\', "/");
                let expected = expected
                    .remove(&normalized)
                    .ok_or_else(|| format!("The backup has no integrity record for {raw_name}"))?;
                let (actual_bytes, actual_sha256, prefix) = sha256_file_from_reader(&mut entry)?;
                if actual_bytes != expected.bytes
                    || entry.size() != expected.bytes
                    || !actual_sha256.eq_ignore_ascii_case(&expected.sha256)
                {
                    return Err(format!(
                        "The backup failed its integrity check for {raw_name}"
                    ));
                }
                if path == Path::new(DB_FILES[0]) && !is_sqlite_header(&prefix) {
                    return Err(
                        "The database in that backup is damaged, or that file is not a Flight Deck backup."
                            .to_string(),
                    );
                }
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

    if !has_database {
        return Err("That backup does not contain a Flight Deck database.".to_string());
    }

    let (missing_documents, unreferenced_documents, unavailable_pictures, unavailable_references) =
        if manifest.format_version >= V2_ARCHIVE_VERSION {
            verify_archive_database_and_documents(
                root,
                &mut archive,
                &manifest,
                &archive_documents,
            )?
        } else {
            (Vec::new(), Vec::new(), 0, 0)
        };

    Ok(CompleteBackupInfo {
        schema_version: manifest.schema_version,
        device_id: manifest.device_id,
        platform: manifest.platform,
        current_schema_version: crate::CURRENT_SCHEMA_VERSION,
        app_version: manifest.app_version,
        current_app_version: current_app_version.to_string(),
        created_at: manifest.created_at,
        files,
        bytes,
        file_bytes: std::fs::metadata(source)
            .map_err(|e| format!("Could not read that backup’s size: {e}"))?
            .len(),
        path: source.to_string_lossy().to_string(),
        missing_documents,
        unreferenced_documents,
        unavailable_pictures,
        unavailable_references,
    })
}

pub(super) const COMPLETE_BACKUP_RETRIES: u32 = 3;

pub fn create_consistent_complete_backup_with_retry(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let mut last_error = String::new();
    for attempt in 0..=COMPLETE_BACKUP_RETRIES {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(200));
        }

        let pre_snapshot_documents = match scan_active_documents(&root.join(DOCUMENTS_DIR)) {
            Ok(docs) => docs,
            Err(e) => {
                last_error = e;
                continue;
            }
        };

        let snapshot = match database_snapshot_with_retry(root) {
            Ok(s) => s,
            Err(e) => {
                last_error = e;
                continue;
            }
        };

        let result = write_complete_backup_from_database(
            root,
            destination_path,
            app_version,
            &snapshot,
            false,
            true,
            Some(&pre_snapshot_documents),
        );

        let _ = std::fs::remove_file(snapshot);

        match result {
            Ok(info) => return Ok(info),
            Err(BackupExportError::Permanent(err)) => return Err(err),
            Err(BackupExportError::Transient(err)) => {
                last_error = err;
            }
        }
    }

    Err(format!(
        "Could not create a consistent backup: {last_error}"
    ))
}

/// Write the archive itself, against plain directories so it can be tested.
///
/// Skips the finished-archive verification `create_complete_backup` uses in
/// production: several tests deliberately build a damaged or hostile archive
/// through this exact path to prove the *import* side refuses it, and that
/// stops being possible if writing one already refuses to produce it.
#[cfg(test)]
pub(crate) fn write_complete_backup(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    write_complete_backup_from_database(
        root,
        destination_path,
        app_version,
        &root.join(DB_FILES[0]),
        true,
        false,
        None,
    )
    .map_err(|e| e.to_string())
}

pub(super) fn write_complete_backup_from_database(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
    database: &Path,
    include_wal: bool,
    verify_before_finish: bool,
    pre_snapshot_documents: Option<&HashSet<String>>,
) -> Result<CompleteBackupInfo, BackupExportError> {
    write_complete_backup_from_database_with_hook(
        root,
        destination_path,
        app_version,
        database,
        include_wal,
        verify_before_finish,
        pre_snapshot_documents,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn write_complete_backup_from_database_with_hook(
    root: &Path,
    destination_path: &Path,
    app_version: &str,
    database: &Path,
    include_wal: bool,
    verify_before_finish: bool,
    pre_snapshot_documents: Option<&HashSet<String>>,
    mut on_before_collect_doc: Option<&mut dyn FnMut(&str)>,
) -> Result<CompleteBackupInfo, BackupExportError> {
    if !database.is_file() {
        return Err(BackupExportError::Permanent(
            "There is no database to back up yet.".to_string(),
        ));
    }

    let requested_destination = destination_path.to_path_buf();
    let file_name = requested_destination.file_name().ok_or_else(|| {
        BackupExportError::Permanent("Choose a valid backup file name.".to_string())
    })?;
    let parent = requested_destination.parent().ok_or_else(|| {
        BackupExportError::Permanent("Choose a valid backup location.".to_string())
    })?;
    std::fs::create_dir_all(parent).map_err(|e| {
        BackupExportError::Permanent(format!("Could not create the backup location: {e}"))
    })?;
    let parent = parent.canonicalize().map_err(|e| {
        BackupExportError::Permanent(format!("Could not verify the backup location: {e}"))
    })?;
    let private_root = root.canonicalize().map_err(|e| {
        BackupExportError::Permanent(format!("Could not verify the application data folder: {e}"))
    })?;
    if parent.starts_with(&private_root) {
        return Err(BackupExportError::Permanent(
            "Choose a backup location outside the application's data folder.".to_string(),
        ));
    }
    let destination = parent.join(file_name);

    let temporary = PathBuf::from(format!("{}.part", destination.to_string_lossy()));
    if temporary.exists() {
        std::fs::remove_file(&temporary).map_err(|e| {
            BackupExportError::Permanent(format!("Could not replace an unfinished backup: {e}"))
        })?;
    }

    let result = (|| {
        let initial_disk_documents = scan_active_documents(&root.join(DOCUMENTS_DIR))
            .map_err(BackupExportError::Transient)?;

        let (docs_to_archive, missing_at_export, orphans_at_export, detached_at_export) =
            if verify_before_finish {
                let referenced =
                    query_referenced_documents(database).map_err(BackupExportError::Transient)?;

                let staged_deletions = scan_staged_deletion_paths(
                    &root.join(DOCUMENTS_DIR).join(crate::documents::TRASH_DIR),
                )
                .map_err(BackupExportError::Transient)?;

                let mut missing: Vec<String> = Vec::new();
                for doc in &referenced {
                    if !initial_disk_documents.contains(doc) {
                        if pre_snapshot_documents.is_some_and(|pre| pre.contains(doc)) {
                            return Err(BackupExportError::Transient(format!(
                                "Referenced document disappeared after database snapshot: {doc}"
                            )));
                        }
                        if staged_deletions.contains(doc) {
                            return Err(BackupExportError::Transient(format!(
                                "A document deletion was in progress: {doc}"
                            )));
                        }
                        missing.push(doc.clone());
                    }
                }
                missing.sort();

                let mut orphans: Vec<String> = initial_disk_documents
                    .iter()
                    .filter(|doc| !referenced.contains(*doc))
                    .cloned()
                    .collect();
                orphans.sort();

                let to_archive: HashSet<String> = referenced
                    .into_iter()
                    .filter(|doc| initial_disk_documents.contains(doc))
                    .collect();

                let detached = detached_documents(root, database, &to_archive)
                    .map_err(BackupExportError::Transient)?;

                (Some(to_archive), missing, orphans, detached)
            } else {
                (None, Vec::new(), Vec::new(), Vec::new())
            };

        let output = File::create(&temporary).map_err(|e| {
            BackupExportError::Permanent(format!("Could not create the backup file: {e}"))
        })?;
        let mut archive = ZipWriter::new(output);
        let (schema_version, device_id) = snapshot_schema_and_device(database);
        let manifest = CompleteBackupManifest {
            schema_version,
            device_id,
            platform: Some(std::env::consts::OS.to_string()),
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION,
            app_version: app_version.to_string(),
            created_at: unix_timestamp(),
            missing_at_export: missing_at_export.clone(),
            detached_at_export,
        };

        archive
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .map_err(|e| {
                BackupExportError::Permanent(zip_error("Could not write the backup manifest", e))
            })?;
        archive
            .write_all(
                serde_json::to_string_pretty(&manifest)
                    .map_err(|e| {
                        BackupExportError::Permanent(format!(
                            "Could not prepare the backup manifest: {e}"
                        ))
                    })?
                    .as_bytes(),
            )
            .map_err(|e| {
                BackupExportError::Permanent(format!("Could not write the backup manifest: {e}"))
            })?;

        let mut integrity = Vec::new();
        let saved_database = add_file_to_archive(&mut archive, database, DB_FILES[0])
            .map_err(BackupExportError::Transient)?;
        let mut files = 1usize;
        let mut bytes = saved_database.bytes;
        integrity.push(saved_database);
        if bytes > MAX_RESTORE_BYTES {
            return Err(BackupExportError::Permanent(
                "The database is too large to put in one safe backup.".to_string(),
            ));
        }

        // The production path archives an online SQLite snapshot and therefore
        // never needs a WAL. Tests retain this option to prove that legacy v1
        // archives carrying a real WAL still restore correctly.
        let wal = root.join(DB_FILES[1]);
        if include_wal && std::fs::metadata(&wal).map(|m| m.len()).unwrap_or(0) > 0 {
            let saved_wal = add_file_to_archive(&mut archive, &wal, DB_FILES[1])
                .map_err(BackupExportError::Transient)?;
            bytes = bytes.checked_add(saved_wal.bytes).ok_or_else(|| {
                BackupExportError::Permanent("The backup is too large.".to_string())
            })?;
            files += 1;
            integrity.push(saved_wal);
        }

        if let Some(to_archive) = docs_to_archive {
            let mut pre_meta = HashMap::new();
            for doc in &to_archive {
                let doc_path = root
                    .join(DOCUMENTS_DIR)
                    .join(safe_relative_document_path(doc).map_err(BackupExportError::Permanent)?);
                let meta = std::fs::metadata(&doc_path).map_err(|e| {
                    BackupExportError::Transient(format!("Could not inspect document {doc}: {e}"))
                })?;
                let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                pre_meta.insert(doc.clone(), (meta.len(), mtime));
            }

            let mut sorted_docs: Vec<_> = to_archive.into_iter().collect();
            sorted_docs.sort();

            for doc in sorted_docs {
                if let Some(hook) = on_before_collect_doc.as_mut() {
                    hook(&doc);
                }

                let doc_path = root
                    .join(DOCUMENTS_DIR)
                    .join(safe_relative_document_path(&doc).map_err(BackupExportError::Permanent)?);
                let name = format!("{DOCUMENTS_DIR}/{doc}");
                let saved = add_file_to_archive(&mut archive, &doc_path, &name)
                    .map_err(BackupExportError::Transient)?;

                let meta_after = std::fs::metadata(&doc_path).map_err(|e| {
                    BackupExportError::Transient(format!(
                        "Could not inspect document {doc} after read: {e}"
                    ))
                })?;
                let (pre_len, pre_mtime) = pre_meta[&doc];
                let post_mtime = meta_after
                    .modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                if meta_after.len() != pre_len || post_mtime != pre_mtime {
                    return Err(BackupExportError::Transient(format!(
                        "Document changed during export: {doc}"
                    )));
                }

                bytes = bytes.checked_add(saved.bytes).ok_or_else(|| {
                    BackupExportError::Permanent("The backup is too large.".to_string())
                })?;
                files += 1;
                integrity.push(saved);
                if files > MAX_RESTORE_FILES || bytes > MAX_RESTORE_BYTES {
                    return Err(BackupExportError::Permanent(
                        "The documents are too large to put in one safe backup.".to_string(),
                    ));
                }
            }

            let post_disk = scan_active_documents(&root.join(DOCUMENTS_DIR))
                .map_err(BackupExportError::Transient)?;
            if post_disk != initial_disk_documents {
                return Err(BackupExportError::Transient(
                    "Documents changed on disk during export.".to_string(),
                ));
            }
        } else {
            add_documents_to_archive(
                &mut archive,
                &root.join(DOCUMENTS_DIR),
                Path::new(""),
                &mut files,
                &mut bytes,
                &mut integrity,
            )
            .map_err(BackupExportError::Transient)?;
        }

        integrity.sort_by(|left, right| left.path.cmp(&right.path));
        archive
            .start_file(ARCHIVE_INTEGRITY, archive_options())
            .map_err(|e| {
                BackupExportError::Permanent(zip_error("Could not write backup integrity data", e))
            })?;
        archive
            .write_all(
                serde_json::to_string_pretty(&CompleteBackupIntegrity {
                    algorithm: "sha256".to_string(),
                    files: integrity,
                })
                .map_err(|e| {
                    BackupExportError::Permanent(format!(
                        "Could not prepare backup integrity data: {e}"
                    ))
                })?
                .as_bytes(),
            )
            .map_err(|e| {
                BackupExportError::Permanent(format!("Could not write backup integrity data: {e}"))
            })?;

        let output = archive.finish().map_err(|e| {
            BackupExportError::Permanent(zip_error("Could not finish the backup", e))
        })?;
        output.sync_all().map_err(|e| {
            BackupExportError::Permanent(format!("Could not finish writing the backup: {e}"))
        })?;

        // Read the file back and run it through the same validation a
        // restore would — readable ZIP, manifest, integrity inventory,
        // structural limits — before it is ever renamed into place or
        // reported as saved. Writing bytes successfully is not the same
        // guarantee as the result actually being a usable backup.
        let (mut unavailable_pictures, mut unavailable_references) = (0, 0);
        if verify_before_finish {
            let inspected = inspect_archive(root, &temporary, app_version).map_err(|e| {
                BackupExportError::Permanent(format!(
                    "The backup was written but did not pass its own integrity check: {e}"
                ))
            })?;
            unavailable_pictures = inspected.unavailable_pictures;
            unavailable_references = inspected.unavailable_references;
        }

        if destination.exists() {
            if destination.is_dir() {
                return Err(BackupExportError::Permanent(
                    "The selected backup location is a folder.".to_string(),
                ));
            }
            let replaced = PathBuf::from(format!("{}.replaced", destination.to_string_lossy()));
            if replaced.exists() {
                std::fs::remove_file(&replaced).map_err(|e| {
                    BackupExportError::Permanent(format!(
                        "Could not clear an unfinished replacement: {e}"
                    ))
                })?;
            }
            std::fs::rename(&destination, &replaced).map_err(|e| {
                BackupExportError::Permanent(format!("Could not protect the existing backup: {e}"))
            })?;
            if let Err(error) = std::fs::rename(&temporary, &destination) {
                let _ = std::fs::rename(&replaced, &destination);
                return Err(BackupExportError::Permanent(format!(
                    "Could not save the completed backup: {error}"
                )));
            }
            let _ = std::fs::remove_file(replaced);
        } else {
            std::fs::rename(&temporary, &destination).map_err(|e| {
                BackupExportError::Permanent(format!("Could not save the completed backup: {e}"))
            })?;
        }

        Ok(CompleteBackupInfo {
            schema_version: manifest.schema_version,
            device_id: manifest.device_id.clone(),
            platform: manifest.platform.clone(),
            current_schema_version: crate::CURRENT_SCHEMA_VERSION,
            current_app_version: manifest.app_version.clone(),
            app_version: manifest.app_version,
            created_at: manifest.created_at,
            files,
            bytes,
            file_bytes: std::fs::metadata(&destination)
                .map_err(|e| {
                    BackupExportError::Permanent(format!(
                        "Could not read the saved backup’s size: {e}"
                    ))
                })?
                .len(),
            path: destination.to_string_lossy().to_string(),
            missing_documents: missing_at_export,
            unreferenced_documents: orphans_at_export,
            unavailable_pictures,
            unavailable_references,
        })
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}
