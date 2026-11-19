//! Protecting her training record across updates.
//!
//! Structured data and the profile photo live in SQLite; uploaded study files
//! live beside it in private application storage. Automatic upgrade copies
//! protect the database from migration mistakes. User-requested portable
//! archives protect the database and every uploaded document together.
//!
//! The backup happens in Tauri's setup, before the frontend opens the
//! database and therefore before any migration runs.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{backup::Backup, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::logging::log;
use crate::storage::app_root;

/// Where copies are kept, inside application data.
/// How long a raw `rusqlite` connection waits for a lock before giving up.
/// Matches the five seconds the app's own connection pool already gets by
/// default from its driver — long enough to ride out an ordinary autosave
/// or transaction, short enough that a genuinely stuck lock still surfaces.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// How many extra attempts a database snapshot gets after a transient lock,
/// beyond the first — bounded, so a lock that never clears still fails
/// rather than retrying forever.
const SNAPSHOT_LOCK_RETRIES: u32 = 3;

const BACKUP_DIR: &str = "backups";
/// Records which version last ran, so an upgrade can be detected.
const VERSION_FILE: &str = "last-run-version.txt";
const DOCUMENTS_DIR: &str = "documents";
const ARCHIVE_MANIFEST: &str = "manifest.json";
const ARCHIVE_INTEGRITY: &str = "integrity.json";
const ARCHIVE_FORMAT: &str = "her-flight-deck-complete-backup";
const ARCHIVE_VERSION: u32 = 3;
const V2_ARCHIVE_VERSION: u32 = 2;
const LEGACY_ARCHIVE_VERSION: u32 = 1;
const RESTORE_STAGING_DIR: &str = ".restore-staging";
pub(crate) const RESTORE_PENDING_DIR: &str = ".restore-pending";
pub(crate) const RESTORE_JOURNAL_FILE: &str = "restore-journal.json";
/// Written into the staged folder to say what kind of restore was asked for.
///
/// An archive can never contain this name — `allowed_archive_path` only lets
/// the manifest, the database, its write-ahead log and `documents/` through —
/// so a backup file cannot decide how it gets installed.
const RESTORE_PLAN: &str = "restore.json";
const MAX_RESTORE_FILES: usize = 10_000;
const MAX_RESTORE_BYTES: u64 = 10 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_PATH_BYTES: usize = 1_024;
const MAX_ARCHIVE_COMPONENT_BYTES: usize = 255;
// SQLite files can contain large runs of empty pages, so leave ample room for
// legitimate databases while still refusing classic tiny-payload ZIP bombs.
const MAX_COMPRESSION_RATIO: u64 = 1_000;
const COMPRESSION_RATIO_FLOOR: u64 = 1024 * 1024;
/// How many automatic copies to keep before the oldest is removed.
const KEEP_BACKUPS: usize = 10;

/// The database, plus the write-ahead log files that belong with it.
pub(crate) const DB_FILES: [&str; 3] = [
    "her-flight-deck.db",
    "her-flight-deck.db-wal",
    "her-flight-deck.db-shm",
];

/// Every SQLite file begins with these sixteen bytes.
///
/// Checking them costs nothing and catches a truncated, empty or wrong file
/// *before* her current data is moved out of the way for a restore.
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    /// Seconds since the Unix epoch, for the interface to format.
    pub created_at: u64,
    /// Whether this copy holds a database this app could actually put back.
    pub restorable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteBackupManifest {
    format: String,
    format_version: u32,
    app_version: String,
    created_at: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    missing_at_export: Vec<String>,
    /// Files whose FAA reference copy or picture-card details no longer
    /// matched at export (the file was replaced in 0.6.1/0.6.2). They are
    /// backed up as they are; only these skip the saved-details byte check.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    detached_at_export: Vec<String>,
    /// Newest database migration the writing app had applied. Optional;
    /// absent in archives written before this field existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    schema_version: Option<i64>,
    /// Which device wrote the archive (optional, absent in older archives).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    /// Operating system that wrote the archive (optional, absent in older archives).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    platform: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityEntry {
    path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteBackupIntegrity {
    algorithm: String,
    files: Vec<IntegrityEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteBackupInfo {
    /// The version of the app that wrote the backup.
    pub app_version: String,
    /// The version running now, so the interface can warn about going backwards.
    pub current_app_version: String,
    pub created_at: u64,
    pub files: usize,
    pub bytes: u64,
    /// Size of the backup archive on disk, separate from its unpacked contents.
    pub file_bytes: u64,
    pub path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_documents: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unreferenced_documents: Vec<String>,
    /// Picture cards whose picture is gone or no longer matches.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub unavailable_pictures: usize,
    /// FAA reference copies whose PDF is gone or no longer matches.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub unavailable_references: usize,
    /// Database version the writing app had (absent in older backups).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// The database version this app understands.
    pub current_schema_version: i64,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

#[derive(Debug)]
pub(crate) enum BackupExportError {
    /// A configuration, validation, or permanent user error that should not be retried.
    Permanent(String),
    /// A concurrency or consistency error (document changed during export, etc.) that can be retried.
    Transient(String),
}

impl BackupExportError {
    pub(crate) fn message(&self) -> &str {
        match self {
            Self::Permanent(msg) | Self::Transient(msg) => msg,
        }
    }
}

impl std::fmt::Display for BackupExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

/// What a staged restore should replace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum RestoreKind {
    /// A portable archive: the database and the uploaded documents together.
    Complete,
    /// A local safety copy: the database only. Uploaded documents stay put.
    Database,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestorePlan {
    #[serde(default)]
    operation_id: String,
    kind: RestoreKind,
    /// Where it came from, for the log line if installing goes wrong.
    source: String,
}

fn backup_dir(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(BACKUP_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create the backup directory: {e}"))?;
    Ok(dir)
}

/// A filesystem-safe stamp, e.g. "2026-09-05-174233".
fn timestamp() -> String {
    let secs = unix_timestamp();

    // Civil date from a Unix timestamp, without pulling in a date crate.
    let days = (secs / 86_400) as i64;
    let time = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}-{:02}{:02}{:02}",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Howard Hinnant's days-from-civil, inverted. Public-domain algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// A backup folder that is not already taken.
///
/// Names carry the time only to the second, so two copies made inside the same
/// second would otherwise land on one folder and the first would be lost.
fn unique_backup_path(dir: &Path, suffix: &str) -> PathBuf {
    let stamp = timestamp();
    let first = dir.join(format!("{stamp}-{suffix}"));
    if !first.exists() {
        return first;
    }
    for attempt in 2..1_000 {
        let candidate = dir.join(format!("{stamp}-{attempt}-{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stamp}-{}-{suffix}", unix_timestamp()))
}

/// Copy the database and its sidecar files into a new backup folder.
///
/// `suffix` says why the copy exists — "manual", "before-0.3.0" — and the time
/// is put in front of it, so the folders sort oldest first.
///
/// Returns None when there is no database yet, which is the normal case on a
/// very first run.
fn copy_database(root: &Path, suffix: &str) -> Result<Option<PathBuf>, String> {
    let main = root.join(DB_FILES[0]);
    if !main.is_file() {
        return Ok(None);
    }

    let destination = unique_backup_path(&backup_dir(root)?, suffix);
    std::fs::create_dir_all(&destination)
        .map_err(|e| format!("Could not create the backup folder: {e}"))?;

    for name in DB_FILES {
        let from = root.join(name);
        if from.is_file() {
            std::fs::copy(&from, destination.join(name))
                .map_err(|e| format!("Could not copy {name}: {e}"))?;
        }
    }

    Ok(Some(destination))
}

/// Does this look like a real SQLite database file?
fn is_sqlite_header(header: &[u8]) -> bool {
    header.len() >= SQLITE_MAGIC.len() && &header[..SQLITE_MAGIC.len()] == SQLITE_MAGIC
}

/// Read the first bytes of a file and confirm SQLite wrote it.
fn verify_sqlite_file(path: &Path) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|e| format!("Could not open the database in that backup: {e}"))?;
    let mut header = [0u8; SQLITE_MAGIC.len()];
    file.read_exact(&mut header)
        .map_err(|_| "The database in that backup is damaged or incomplete.".to_string())?;
    if !is_sqlite_header(&header) {
        return Err("That file is not a Flight Deck database.".to_string());
    }
    Ok(())
}

/// True when a backup folder holds a database this app could put back.
fn folder_is_restorable(folder: &Path) -> bool {
    verify_sqlite_file(&folder.join(DB_FILES[0])).is_ok()
}

/// Turn a chosen backup name back into a folder inside `backups/`.
///
/// The name arrives from the interface, so it is treated as untrusted: a bare
/// folder name and nothing that could climb out of the backup directory.
fn safe_backup_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
    {
        return Err("That is not a safety copy this app made.".to_string());
    }
    Ok(trimmed)
}

fn zip_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

fn archive_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600)
}

fn add_file_to_archive<W: Write + Seek>(
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

fn normalize_sql(sql: &str) -> String {
    let mut clean = String::new();
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '-' && i + 1 < chars.len() && chars[i + 1] == '-' {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else {
            clean.push(chars[i]);
            i += 1;
        }
    }
    clean
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn is_valid_uuid_v4(uuid_str: &str) -> bool {
    let bytes = uuid_str.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, &b) in bytes.iter().enumerate() {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            if b != b'-' {
                return false;
            }
        } else if i == 14 {
            if b != b'4' {
                return false;
            }
        } else if i == 19 {
            if !matches!(b, b'8' | b'9' | b'a' | b'b' | b'A' | b'B') {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

/// One foreign key: parent table, ordered (child, parent) column pairs, and
/// its ON UPDATE / ON DELETE / MATCH actions.
type ForeignKeyShape = (
    String,
    Vec<(String, Option<String>)>,
    String,
    String,
    String,
);

/// A table's foreign keys in a comparable form, independent of declaration
/// order and identifier case.
fn foreign_key_shapes(
    connection: &Connection,
    table: &str,
) -> Result<Vec<ForeignKeyShape>, String> {
    let mut stmt = connection
        .prepare(&format!(
            "SELECT id, \"table\", \"from\", \"to\", on_update, on_delete, \"match\"
             FROM pragma_foreign_key_list('{table}') ORDER BY id, seq"
        ))
        .map_err(|e| format!("Could not read foreign keys for {table}: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| format!("Could not query foreign keys for {table}: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not collect foreign keys for {table}: {e}"))?;
    let mut grouped: std::collections::BTreeMap<i64, ForeignKeyShape> =
        std::collections::BTreeMap::new();
    for (id, parent, from, to, on_update, on_delete, matching) in rows {
        let entry = grouped.entry(id).or_insert_with(|| {
            (
                parent.to_ascii_lowercase(),
                Vec::new(),
                on_update.to_ascii_uppercase(),
                on_delete.to_ascii_uppercase(),
                matching.to_ascii_uppercase(),
            )
        });
        entry.1.push((
            from.to_ascii_lowercase(),
            to.map(|column| column.to_ascii_lowercase()),
        ));
    }
    let mut shapes: Vec<ForeignKeyShape> = grouped.into_values().collect();
    shapes.sort();
    Ok(shapes)
}

/// The stored CREATE statement of a table.
fn table_sql(connection: &Connection, table: &str) -> Result<String, String> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |r| r.get(0),
        )
        .map_err(|e| format!("Could not read the definition of {table}: {e}"))
}

/// The CHECK constraints of a CREATE TABLE statement, bounded to their
/// expressions with whitespace and identifier quoting removed and sorted, so
/// equivalent formatting compares equal while a missing or altered check does
/// not.
fn check_constraints(sql: &str) -> Vec<String> {
    let chars: Vec<char> = normalize_sql(sql).chars().collect();
    let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut checks = Vec::new();
    let mut in_quote = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' {
            in_quote = !in_quote;
            i += 1;
            continue;
        }
        let at_check = !in_quote
            && chars[i..].starts_with(&['c', 'h', 'e', 'c', 'k'])
            && (i == 0 || !is_word(chars[i - 1]))
            && !chars.get(i + 5).is_some_and(|next| is_word(*next));
        if !at_check {
            i += 1;
            continue;
        }
        let mut j = i + 5;
        while chars.get(j) == Some(&' ') {
            j += 1;
        }
        if chars.get(j) != Some(&'(') {
            i += 5;
            continue;
        }
        let (mut depth, mut quoted, mut expression) = (0usize, false, String::new());
        while j < chars.len() {
            let d = chars[j];
            if d == '\'' {
                quoted = !quoted;
            } else if !quoted && d == '(' {
                depth += 1;
            } else if !quoted && d == ')' {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            if depth > 0 && !(depth == 1 && d == '(' && expression.is_empty()) {
                expression.push(d);
            }
            j += 1;
        }
        checks.push(
            expression
                .chars()
                .filter(|c| !c.is_whitespace() && *c != '"' && *c != '`')
                .collect(),
        );
        i = j + 1;
    }
    checks.sort();
    checks
}

fn get_reference_schema_connection() -> Result<Connection, String> {
    get_reference_schema_connection_through(crate::CURRENT_SCHEMA_VERSION)
}

/// The reference schema as of one migration, for a contract a later
/// migration extended (0016 added `material_bookmarks.quote`), so a
/// database restored from an older backup is checked against its own version.
fn get_reference_schema_connection_through(version: i64) -> Result<Connection, String> {
    let ref_conn = Connection::open_in_memory()
        .map_err(|e| format!("Could not open in-memory reference DB: {e}"))?;
    ref_conn
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Could not enable foreign keys on reference DB: {e}"))?;
    for m in crate::migrations()
        .into_iter()
        .filter(|m| m.version <= version)
    {
        ref_conn
            .execute_batch(m.sql)
            .map_err(|e| format!("Could not apply migrations to reference DB: {e}"))?;
    }
    Ok(ref_conn)
}

pub(crate) fn verify_application_database(path: &Path) -> Result<(), String> {
    verify_sqlite_file(path)?;
    // RUSTSEC-2026-0459: a mismatched -wal must be refused before SQLite opens it.
    crate::sqlite_guard::check_wal_pair(path)?;
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Could not open the database in that backup: {e}"))?;
    // `rusqlite` opens with no busy timeout of its own — unlike the app's
    // main connection pool, which gets one from its own driver by default —
    // so without this, a lock briefly held by an ordinary write elsewhere
    // (an autosave, a split saving its parts) fails this check immediately
    // instead of just waiting the moment out. Checking a live database, not
    // only a staged one, is exactly the case this matters for.
    let _ = connection.busy_timeout(BUSY_TIMEOUT);
    verify_application_connection(&connection)
}

/// The checks of `verify_application_database` on an already-open
/// connection. Initialization runs them on its own open transaction, so they
/// see the pending conversion before it commits.
pub(crate) fn verify_application_connection(connection: &Connection) -> Result<(), String> {
    verify_application_connection_with_ceiling(connection, crate::CURRENT_SCHEMA_VERSION)
}
fn verify_application_connection_with_ceiling(
    connection: &Connection,
    supported: i64,
) -> Result<(), String> {
    let quick_check: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| format!("Could not check the database in that backup: {e}"))?;
    if quick_check != "ok" {
        return Err("The database in that backup is damaged or incomplete.".to_string());
    }

    for table in ["settings", "study_materials"] {
        let present: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .map_err(|e| format!("Could not inspect the database schema: {e}"))?;
        if present != 1 {
            return Err(format!(
                "That backup does not contain a Flight Deck database (missing {table})."
            ));
        }
    }

    let newest_migration = newest_migration_version(connection)?;
    if newest_migration > supported {
        return Err(
            "That backup was created by a newer database format. Update the app first.".to_string(),
        );
    }
    verify_practice_acs_tasks(connection, newest_migration >= 28)?;
    if newest_migration >= 11 {
        verify_schema_11_semantics(connection)?;
    }
    if newest_migration >= 12 {
        verify_schema_12_card_semantics(connection)?;
    }
    if newest_migration >= 13 {
        verify_schema_13_lineage_semantics(connection)?;
    }
    if newest_migration >= 14 {
        verify_schema_14_skill_evidence_semantics(connection)?;
    }
    if newest_migration >= 15 {
        verify_schema_15_navigation_semantics(connection)?;
    }
    if newest_migration >= 16 {
        verify_schema_16_manual_study_semantics(connection)?;
    }
    if newest_migration >= 17 {
        verify_schema_17_practice_authoring_semantics(connection)?;
    }
    if newest_migration >= 18 {
        verify_schema_18_pdf_kit_semantics(connection)?;
    }
    if newest_migration >= 19 {
        verify_schema_19_study_receipts(connection)?;
    }
    if newest_migration >= 24 {
        verify_schema_24_page_sources(connection)?;
    }
    if newest_migration >= 25 {
        verify_schema_25_oral_scenarios(connection)?;
    }
    if newest_migration >= 29 {
        verify_schema_29_video_links(connection)?;
    }
    if newest_migration >= 30 {
        verify_schema_30_student_pilot_steps(connection)?;
    }
    if newest_migration >= 31 {
        verify_schema_31_faa_downloads(connection)?;
    }
    if newest_migration >= 32 {
        verify_schema_32_oral_answers(connection)?;
    }
    if newest_migration >= 35 {
        verify_schema_35_fold_semantics(connection)?;
    }
    if newest_migration >= 36 {
        verify_schema_36_kit_queue(connection)?;
    }
    if newest_migration >= 37 {
        verify_schema_37_study_packs(connection)?;
    }
    if newest_migration >= 38 {
        verify_schema_38_library_folders(connection)?;
    }
    if newest_migration >= 39 {
        verify_schema_39_practice_unchecked(connection)?;
    }
    if newest_migration >= 27 {
        verify_schema_27_faa_references(connection)?;
    }
    if newest_migration >= 26 {
        verify_schema_26_visual_cards(connection)?;
    }
    if newest_migration >= 20 {
        verify_schema_20_homework_semantics(connection)?;
    }
    Ok(())
}

/// The newest migration a database records, from either migration table.
fn newest_migration_version(connection: &Connection) -> Result<i64, String> {
    let migration_table = ["_sqlx_migrations", "schema_migrations"]
        .into_iter()
        .find(|table| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                == 1
        })
        .ok_or_else(|| "That backup does not contain Flight Deck migration history.".to_string())?;
    connection
        .query_row(
            &format!("SELECT COALESCE(MAX(version), 0) FROM {migration_table}"),
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Could not inspect the database version: {e}"))
}

/// The device id kept in `app_metadata`, if the table and row exist.
fn read_device_id(connection: &Connection) -> Option<String> {
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
fn snapshot_schema_and_device(database: &Path) -> (Option<i64>, Option<String>) {
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

/// Schema 20 homework contract; TS twin: `validateHomeworkState`.
/// All three engines exercise the shared homework fixtures after reopening.
pub(crate) fn verify_schema_20_homework_semantics(connection: &Connection) -> Result<(), String> {
    let version = newest_migration_version(connection)?.min(crate::CURRENT_SCHEMA_VERSION);
    let reference = get_reference_schema_connection_through(version)?;
    for table in [
        "homework_assignments",
        "homework_activities",
        "homework_runs",
        "homework_operations",
        "homework_history",
    ] {
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Homework tables do not match the migration contract.".into());
        }
    }
    for object in crate::homework::rows(&reference, "SELECT type,name,sql FROM sqlite_master WHERE tbl_name LIKE 'homework_%' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name", &[])? {
        let actual = crate::homework::rows(connection, "SELECT sql FROM sqlite_master WHERE type=? AND name=?", &[&object["type"].as_str().unwrap(), &object["name"].as_str().unwrap()])?;
        if actual.first().and_then(|v|v["sql"].as_str()).map(normalize_sql) != object["sql"].as_str().map(normalize_sql) {
            return Err("Homework indexes or history guards are missing.".into());
        }
    }
    crate::homework::validate_database(connection)
}

/// Older backups have no side table and remain untagged after upgrade.
fn verify_practice_acs_tasks(connection: &Connection, required: bool) -> Result<(), String> {
    let present = crate::acs_tasks::table_exists(connection).map_err(|e| e.to_string())?;
    if !present {
        return if required {
            Err("Missing practice ACS task table.".into())
        } else {
            Ok(())
        };
    }
    let reference = get_reference_schema_connection()?;
    let table = "practice_item_acs_tasks";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || m3_count(
            connection,
            "SELECT COUNT(*) FROM pragma_foreign_key_check('practice_item_acs_tasks')",
            &[],
        )? != 0
    {
        return Err("Damaged practice ACS task table.".into());
    }
    // Tag values are NOT checked against today's catalog: a future ACS
    // edition must never make an older backup unrestorable. Unknown tags
    // simply read as untagged.
    Ok(())
}

pub(crate) fn verify_schema_29_video_links(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "material_video_links";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || m3_index_shape(connection, table, "idx_material_video_links_material")?
            != m3_index_shape(&reference, table, "idx_material_video_links_material")?
        || m3_count(
            connection,
            "SELECT COUNT(*) FROM pragma_foreign_key_check('material_video_links')",
            &[],
        )? != 0
    {
        return Err("Damaged video link schema.".into());
    }
    Ok(())
}

pub(crate) fn verify_schema_30_student_pilot_steps(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "student_pilot_steps";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
    {
        return Err("Damaged student pilot steps schema.".into());
    }
    Ok(())
}

pub(crate) fn verify_schema_31_faa_downloads(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "faa_downloads";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
    {
        return Err("Damaged FAA downloads schema.".into());
    }
    Ok(())
}

/// ORAL-01d: her finished oral answers, exactly as migrated, then the
/// version, ticks and timestamps checks in `oral_scenarios::validate_answers`.
pub(crate) fn verify_schema_32_oral_answers(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "oral_answers";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        || m3_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
    {
        return Err("Damaged oral answers schema.".into());
    }
    crate::oral_scenarios::validate_answers(connection)
}

/// SOURCE-01b: the local study-kit queue, exactly as migrated. It holds ids,
/// checksums and status only, and is not part of the sync ledger.
pub(crate) fn verify_schema_36_kit_queue(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["kit_queue", "kit_queue_item"] {
        let present = card_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )?;
        if present != 1 {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Damaged study kit queue schema.".into());
        }
    }
    // At most one open queue: the partial unique index, exactly as migrated.
    let index =
        |c: &Connection| card_index_sql(c, "kit_queue_one_open").map(|sql| normalize_sql(&sql));
    if index(connection).is_none() || index(connection) != index(&reference) {
        return Err("Damaged study kit queue schema.".into());
    }
    Ok(())
}

/// PACK-01: the study-pack provenance tables, exactly as migrated, then their
/// row rules (the TS twin is `validateStudyPackState`).
pub(crate) fn verify_schema_37_study_packs(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let damaged = || "Damaged study pack provenance.".to_string();
    for table in ["study_pack_imports", "study_pack_items", "study_pack_acks"] {
        let present = card_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )?;
        if present != 1 {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err(damaged());
        }
    }
    for index in [
        "idx_study_pack_items_identity",
        "idx_study_pack_items_revision",
        "idx_study_pack_items_file",
        "idx_study_pack_items_added",
    ] {
        let sql = |c: &Connection| card_index_sql(c, index).map(|sql| normalize_sql(&sql));
        if sql(connection).is_none() || sql(connection) != sql(&reference) {
            return Err(damaged());
        }
    }
    let bad = |sql: &str| -> Result<bool, String> { Ok(m3_count(connection, sql, &[])? != 0) };
    if bad("SELECT COUNT(*) FROM study_pack_imports
            WHERE added < 0 OR skipped < 0 OR new_versions < 0 OR readded < 0
               OR cards_left_out < 0 OR cards_left_out_removed < 0
               OR cards_left_out_removed > cards_left_out
               OR added_guides < 0 OR added_documents < 0 OR added_pictures < 0
               OR added_practice < 0
               OR added_guides > added OR added_documents > added
               OR added_pictures > added OR added_practice > added
               OR added < new_versions + readded + added_pictures
               OR length(committed_at) != 24
               OR typeof(added) != 'integer' OR typeof(skipped) != 'integer'")?
        || bad("SELECT COUNT(*) FROM study_pack_items i
                WHERE i.link NOT IN ('added', 'alias')
                   OR i.kind NOT IN ('document', 'picture', 'guide')
                   OR (i.kind = 'guide' AND i.file_sha256 IS NOT NULL)
                   OR (i.kind != 'guide' AND i.file_sha256 IS NULL)
                   OR length(i.revision) != 64 OR i.revision GLOB '*[^0-9a-f]*'
                   OR length(i.imported_at) != 24
                   OR NOT EXISTS (SELECT 1 FROM study_pack_imports r WHERE r.operation_id = i.operation_id)
                   OR (i.material_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM study_materials m WHERE m.id = i.material_id))")?
        || bad("SELECT COUNT(*) FROM (SELECT material_id FROM study_pack_items
                WHERE link = 'added' AND material_id IS NOT NULL
                GROUP BY material_id HAVING COUNT(*) > 1)")?
        || bad("SELECT COUNT(*) FROM study_pack_acks a
                WHERE NOT EXISTS (SELECT 1 FROM study_pack_imports r WHERE r.operation_id = a.operation_id)")?
    {
        return Err(damaged());
    }
    Ok(())
}

/// LIBRARY-ORG-01: her own library folders and placements, exactly as migrated.
pub(crate) fn verify_schema_38_library_folders(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["library_folders", "library_placements"] {
        let present = card_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )?;
        if present != 1 {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Damaged library folders schema.".into());
        }
    }
    if check_constraints(&table_sql(connection, "library_folders")?)
        != check_constraints(&table_sql(&reference, "library_folders")?)
        || m3_index_shape(
            connection,
            "library_placements",
            "idx_library_placements_folder",
        )? != m3_index_shape(
            &reference,
            "library_placements",
            "idx_library_placements_folder",
        )?
    {
        return Err("Damaged library folders schema.".into());
    }
    Ok(())
}

/// BL-21: `practice_test_items.unchecked` exactly as migrated (INTEGER NOT NULL DEFAULT 0,
/// only 0 or 1). A hand-edited or damaged value fails the backup instead of loading.
pub(crate) fn verify_schema_39_practice_unchecked(connection: &Connection) -> Result<(), String> {
    let damaged = || "Damaged practice question check flag.".to_string();
    let found: Option<(String, i64, Option<String>)> = connection
        .query_row(
            "SELECT type, [notnull], dflt_value FROM pragma_table_info('practice_test_items') WHERE name = 'unchecked'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to read practice_test_items columns: {e}"))?;
    let Some((kind, notnull, default)) = found else {
        return Err("Table practice_test_items missing required column: unchecked".to_string());
    };
    if !kind.eq_ignore_ascii_case("INTEGER") || notnull != 1 || default.as_deref() != Some("0") {
        return Err(damaged());
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM practice_test_items WHERE unchecked NOT IN (0, 1)",
        &[],
    )? != 0
    {
        return Err(damaged());
    }
    Ok(())
}

/// CARRY-3DEV: the local fold ledger `card_review_event_folds`, exactly as
/// migrated, then its row rules. A fold is never counted, so it has no receipt
/// rule. It is gated on schema 35 (not part of `CARD_TABLES`, which a
/// schema-34 backup must still pass).
pub(crate) fn verify_schema_35_fold_semantics(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "card_review_event_folds";
    let present = card_count(
        connection,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        &[&table],
    )?;
    if present != 1 {
        return Err(format!("The database is missing required table: {table}"));
    }
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
    {
        return Err("Damaged card fold ledger schema.".into());
    }
    let mut statement = connection
        .prepare(
            "SELECT f.id, f.reviewed_at, f.rating, f.generation,
                    (SELECT COUNT(*) FROM card_items i WHERE i.id = f.item_id),
                    COALESCE((SELECT g.generation FROM card_review_generations g
                              WHERE g.source_material_id = v.source_material_id), 0),
                    0
             FROM card_review_event_folds f
             LEFT JOIN card_items it ON it.id = f.item_id
             LEFT JOIN card_versions v ON v.id = it.version_id",
        )
        .map_err(|e| format!("Could not read the card fold ledger: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| format!("Could not read the card fold ledger: {e}"))?;
    for row in rows {
        // A fold id that is also a live event is not refused: the runtime
        // (`load_links`) ignores such a row, the live event always wins, and
        // nothing is counted from a fold, so it can hide no data. The startup
        // sweep deletes it.
        let (id, reviewed_at, rating, generation, item_rows, current, _) =
            row.map_err(|e| format!("Could not read the card fold ledger: {e}"))?;
        let owner = format!("Card fold {id}");
        if !is_valid_uuid_v4(&id) || id.bytes().any(|b| b.is_ascii_uppercase()) {
            return Err(format!("{owner} has an invalid id."));
        }
        card_timestamp(&reviewed_at, &owner)?;
        if !["again", "hard", "good", "easy"].contains(&rating.as_str()) {
            return Err(format!("{owner} has an unknown rating."));
        }
        if item_rows != 1 {
            return Err(format!("{owner} names a card that does not exist."));
        }
        if generation > current {
            return Err(format!("{owner} is from a future generation."));
        }
    }
    verify_pending_claims(connection, &reference)
}

/// CARRY-3DEV: `card_version_pending_claims` (device-local sync state, carried
/// with the backup like `sync_applied`/`sync_row_meta`): shape, then row rules.
fn verify_pending_claims(connection: &Connection, reference: &Connection) -> Result<(), String> {
    let table = "card_version_pending_claims";
    let present = card_count(
        connection,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        &[&table],
    )?;
    if present != 1 {
        return Err(format!("The database is missing required table: {table}"));
    }
    if m3_columns(connection, table)? != m3_columns(reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(reference, table)?
        || check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(reference, table)?)
    {
        return Err("Damaged pending card version claims schema.".into());
    }
    let mut statement = connection
        .prepare(
            "SELECT id, changed_at, device_id, first_reviewed_at FROM card_version_pending_claims",
        )
        .map_err(|e| format!("Could not read the pending claims: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("Could not read the pending claims: {e}"))?;
    for row in rows {
        let (id, changed_at, device, first) =
            row.map_err(|e| format!("Could not read the pending claims: {e}"))?;
        let owner = format!("Pending claim {id}");
        if id.is_empty() || device.is_empty() {
            return Err(format!("{owner} is incomplete."));
        }
        card_timestamp(&changed_at, &owner)?;
        if let Some(first) = first {
            card_timestamp(&first, &owner)?;
        }
    }
    Ok(())
}

pub(crate) fn verify_schema_27_faa_references(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "faa_reference_copies";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || check_constraints(&table_sql(connection, table)?) != check_constraints(&table_sql(&reference, table)?)
        || m3_count(connection, "SELECT COUNT(*) FROM pragma_foreign_key_check('faa_reference_copies')", &[])? != 0
        || m3_count(connection, "SELECT COUNT(*) FROM faa_reference_copies WHERE typeof(material_id) != 'text' OR typeof(created_at) != 'text' OR reference_id NOT IN ('private-acs','phak','phak-addendum') OR typeof(edition) != 'text' OR length(edition)>200 OR typeof(content_sha256) != 'text' OR length(content_sha256)!=64 OR content_sha256 GLOB '*[^0-9a-f]*' OR typeof(total_pages) != 'integer' OR total_pages<1", &[])? != 0
    {
        return Err("Damaged FAA reference details.".into());
    }
    Ok(())
}

pub(crate) fn verify_schema_26_visual_cards(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["visual_card_regions", "card_item_visual_regions"] {
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Damaged picture card schema.".into());
        }
    }
    let actual: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='visual_regions_owner'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "Damaged picture index.")?;
    let expected: String = reference
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='visual_regions_owner'",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "Damaged picture index.")?;
    if actual.as_deref().map(normalize_sql) != Some(normalize_sql(&expected)) {
        return Err("Damaged picture index.".into());
    }
    crate::visual_cards::validate_references(connection)?;
    Ok(())
}

pub(crate) fn verify_schema_24_page_sources(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["study_page_sources", "study_page_source_bindings"] {
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Page sources do not match the migration contract.".into());
        }
    }
    for name in [
        "collect_study_page_sources",
        "erase_frozen_card_page_sources",
        "erase_material_card_page_sources",
    ] {
        let sql = "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?1";
        let actual: Option<String> = connection
            .query_row(sql, [name], |r| r.get(0))
            .optional()
            .map_err(|_| "Damaged page source guards.")?;
        let expected: String = reference
            .query_row(sql, [name], |r| r.get(0))
            .map_err(|_| "Damaged page source guards.")?;
        if actual.as_deref().map(normalize_sql) != Some(normalize_sql(&expected)) {
            return Err("Damaged page source guards.".into());
        }
    }
    let mut stmt=connection.prepare("SELECT b.owner_key,b.binding_kind,b.item_key,b.content_fingerprint,s.physical_page FROM study_page_source_bindings b JOIN study_page_sources s ON s.id=b.source_id").map_err(|_|"Page sources unavailable.")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .map_err(|_| "Page sources unavailable.")?;
    for row in rows {
        let (owner, kind, key, hash, page) = row.map_err(|_| "Damaged page source.")?;
        if kind == "frozen_card" {
            let card:Option<serde_json::Value>=connection.query_row("SELECT i.front,i.back,i.source_page,o.origin FROM card_items i JOIN card_versions v ON v.id=i.version_id LEFT JOIN card_item_origins o ON o.item_id=i.id WHERE i.id=?1 AND v.source_material_id=?2",rusqlite::params![key,owner],|r|Ok(serde_json::json!({"front":r.get::<_,String>(0)?,"back":r.get::<_,String>(1)?,"sourcePage":r.get::<_,Option<i64>>(2)?,"origin":r.get::<_,Option<String>>(3)?}))).optional().map_err(|_|"Damaged page source.")?;
            let card = card.map(|mut c| {
                if let Ok(Some(id)) = crate::visual_cards::frozen_id(connection, &key) {
                    c["visualRegionId"] = serde_json::json!(id);
                }
                c
            });
            if card.as_ref().map_or(true, |c| {
                crate::study_page_sources::fingerprint(c) != hash || c["sourcePage"] != page
            }) {
                return Err("Damaged frozen page source.".into());
            }
        } else if kind == "authored_card" {
            let mut candidates=connection.prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?1 UNION ALL SELECT json_extract(previous_json,'$.flashcards_json') FROM study_set_history WHERE material_id=?1 AND kind='study_set'").map_err(|_|"Damaged authored page source.")?;
            let rows = candidates
                .query_map([&owner], |r| r.get::<_, String>(0))
                .map_err(|_| "Damaged authored page source.")?;
            let mut found = false;
            for row in rows {
                let cards: serde_json::Value =
                    serde_json::from_str(&row.map_err(|_| "Damaged authored page source.")?)
                        .map_err(|_| "Damaged authored page source.")?;
                if cards.as_array().is_some_and(|a| {
                    a.iter().any(|c| {
                        c["itemId"] == key
                            && crate::study_page_sources::fingerprint(c) == hash
                            && c["sourcePage"] == page
                    })
                }) {
                    found = true;
                }
            }
            if !found {
                return Err("Damaged authored page source.".into());
            }
        } else if kind == "frozen_question" {
            verify_frozen_question_source(connection, &owner, &key, &hash, page)?;
        } else if kind == "authored_question" {
            verify_authored_question_source(connection, &owner, &key, &hash, page)?;
        } else {
            return Err("Unsupported page source binding.".into());
        }
    }
    Ok(())
}

/// A frozen question source must match its saved item exactly. An item that
/// is gone leaves an unreachable row that the next practice save collects.
fn verify_frozen_question_source(
    connection: &Connection,
    owner: &str,
    key: &str,
    hash: &str,
    page: i64,
) -> Result<(), String> {
    let item: Option<(serde_json::Value, String)> = connection
        .query_row(
            "SELECT i.question_text,i.options_json,i.correct_index,i.explanation,i.source_page,o.origin,v.history_key FROM practice_test_items i JOIN practice_test_versions v ON v.id=i.version_id LEFT JOIN practice_item_origins o ON o.item_id=i.id WHERE i.id=?1",
            [key],
            |r| {
                let options: String = r.get(1)?;
                let mut q = serde_json::json!({
                    "question": r.get::<_, String>(0)?,
                    "options": serde_json::from_str::<serde_json::Value>(&options).unwrap_or(serde_json::Value::Null),
                    "correctIndex": r.get::<_, i64>(2)?,
                    "explanation": r.get::<_, String>(3)?,
                    "sourcePage": r.get::<_, Option<i64>>(4)?,
                });
                if let Some(origin) = r
                    .get::<_, Option<String>>(5)?
                    .filter(|o| o == "user" || o == "instructor")
                {
                    q["origin"] = serde_json::json!(origin);
                }
                Ok((q, r.get::<_, String>(6)?))
            },
        )
        .optional()
        .map_err(|_| "Damaged frozen page source.")?;
    let Some((question, history_key)) = item else {
        return Ok(());
    };
    if history_key != owner
        || question["sourcePage"] != page
        || crate::study_page_sources::question_fingerprint(&question) != hash
    {
        return Err("Damaged frozen page source.".into());
    }
    Ok(())
}

/// A question draft's source must match that question in the current test or
/// a preserved earlier version. A deleted material's drafts are collectable.
fn verify_authored_question_source(
    connection: &Connection,
    owner: &str,
    key: &str,
    hash: &str,
    page: i64,
) -> Result<(), String> {
    let live: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM study_materials WHERE id=?1)",
            [owner],
            |r| r.get(0),
        )
        .map_err(|_| "Damaged authored page source.")?;
    if !live {
        return Ok(());
    }
    let mut snapshots = vec![
        crate::practice_authoring::read_current_snapshot(connection, owner)
            .map_err(|_| "Damaged authored page source.")?,
    ];
    let mut stmt = connection
        .prepare(
            "SELECT previous_json FROM study_set_history WHERE material_id=?1 AND kind='practice'",
        )
        .map_err(|_| "Damaged authored page source.")?;
    let rows = stmt
        .query_map([owner], |r| r.get::<_, String>(0))
        .map_err(|_| "Damaged authored page source.")?;
    for row in rows {
        let previous = row.map_err(|_| "Damaged authored page source.")?;
        snapshots.push(crate::practice_authoring::snapshot_from_history_row(
            &previous,
        ));
    }
    for snapshot in snapshots.iter().flatten() {
        for question in &snapshot.questions {
            let q = crate::practice_authoring::question_value(question);
            if question.identity == key
                && q["sourcePage"] == page
                && crate::study_page_sources::question_fingerprint(&q) == hash
            {
                return Ok(());
            }
        }
    }
    Err("Damaged authored page source.".into())
}
/// ORAL-01c: the three scenario tables exactly as migrated, then the codec,
/// hash, version-order and receipt checks in `oral_scenarios`.
pub(crate) fn verify_schema_25_oral_scenarios(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let newest = newest_migration_version(connection).unwrap_or(crate::CURRENT_SCHEMA_VERSION);
    for table in [
        "oral_scenarios",
        "oral_scenario_versions",
        "oral_save_operations",
    ] {
        // 0040 added follow_ups_json; an older backup is checked against its own version.
        let expected_columns: Vec<String> = m3_columns(&reference, table)?
            .into_iter()
            .filter(|c| {
                !(table == "oral_scenario_versions"
                    && newest < 40
                    && c.starts_with("follow_ups_json|"))
            })
            .collect();
        if m3_columns(connection, table)? != expected_columns
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Damaged oral scenario schema.".into());
        }
    }
    let index = "idx_oral_scenario_order";
    let actual = m3_master_sql(connection, "index", index)?;
    let expected = m3_master_sql(&reference, "index", index)?;
    if actual.is_none() || actual.map(|s| normalize_sql(&s)) != expected.map(|s| normalize_sql(&s))
    {
        return Err("Damaged oral scenario order.".into());
    }
    crate::oral_scenarios::validate_database(connection)
}

pub(crate) fn verify_schema_19_study_receipts(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "study_set_save_operations";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        || m3_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
    {
        return Err("Study set save receipts do not match the migration contract.".into());
    }
    let mut stmt=connection.prepare("SELECT operation_id,material_id,payload_json,payload_hash FROM study_set_save_operations").map_err(|_|"Study set save receipts unavailable.")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| "Study set save receipts unavailable.")?;
    for row in rows {
        let (id, material, payload, hash) =
            row.map_err(|_| "A study set save receipt is damaged.")?;
        let v: serde_json::Value =
            serde_json::from_str(&payload).map_err(|_| "A study set save receipt is damaged.")?;
        let operation = crate::study_sets::decode_operation(&v)
            .map_err(|_| "A study set save receipt is damaged.")?;
        if (operation.pdf_kit_sources.is_none()
            && operation.page_source.is_none()
            && operation.visual_regions.is_none())
            || operation.operation_id != id
            || operation.material_id != material
            || crate::practice_sessions::canonical_json(&operation.payload) != payload
            || crate::practice_sessions::compute_canonical_hash(&operation.payload) != hash
        {
            return Err("A study set save receipt is damaged.".into());
        }
    }
    Ok(())
}

pub(crate) fn verify_schema_18_pdf_kit_semantics(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["pdf_kit_runs", "pdf_kit_item_sources"] {
        if m3_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[m3_value(table)],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
        if m3_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
        {
            return Err(format!("Table {table} has rows that point at nothing."));
        }
    }
    if m3_index_shape(connection, "pdf_kit_runs", "idx_pdf_kit_runs_material")?
        != m3_index_shape(&reference, "pdf_kit_runs", "idx_pdf_kit_runs_material")?
    {
        return Err(
            "The database is missing required index: idx_pdf_kit_runs_material".to_string(),
        );
    }

    let is_hash = |value: &str| {
        value.len() == 64
            && value
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    };
    let mut runs = connection.prepare("SELECT run_id, content_sha256, selected_pages_json, extractor_version, algorithm_version, created_at FROM pdf_kit_runs").map_err(|e| e.to_string())?;
    let rows = runs
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (run_id, hash, encoded, _, _, _) = row.map_err(|e| e.to_string())?;
        if !is_valid_uuid_v4(&run_id) || run_id.bytes().any(|c| c.is_ascii_uppercase()) {
            return Err("A PDF kit has an invalid run identity.".to_string());
        }
        if !is_hash(&hash) {
            return Err("A PDF kit has an invalid source hash.".to_string());
        }
        let pages: Vec<u16> = serde_json::from_str(&encoded)
            .map_err(|_| "A PDF kit has invalid selected pages.".to_string())?;
        if serde_json::to_string(&pages).map_err(|e| e.to_string())? != encoded
            || pages.iter().any(|p| !(1..=1000).contains(p))
            || pages.windows(2).any(|p| p[0] >= p[1])
        {
            return Err("A PDF kit has invalid selected pages.".to_string());
        }
    }
    if m3_count(connection, "SELECT COUNT(*) FROM pdf_kit_item_sources s LEFT JOIN pdf_kit_runs r ON r.run_id = s.run_id LEFT JOIN study_materials m ON m.id = r.material_id WHERE r.run_id IS NULL OR m.id IS NULL", &[])? != 0 {
        return Err("A PDF kit source has no material.".to_string());
    }
    let mut sources = connection.prepare("SELECT item_kind, logical_id, content_hash, page, start_offset, end_offset, quote FROM pdf_kit_item_sources").map_err(|e| e.to_string())?;
    let rows = sources
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (kind, _, hash, page, start, end, quote) = row.map_err(|e| e.to_string())?;
        if !is_hash(&hash) {
            return Err("A PDF kit item has an invalid content hash.".to_string());
        }
        if !["summary", "section", "card", "question"].contains(&kind.as_str()) {
            return Err("A PDF kit item has an invalid kind.".to_string());
        }
        if !(1..=1000).contains(&page) || start < 0 || end <= start {
            return Err("A PDF kit source has invalid page offsets.".to_string());
        }
        if !(1..=2000).contains(&quote.chars().count()) {
            return Err("A PDF kit source has an invalid quote.".to_string());
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 17: authoring practice questions she writes herself          */
/* (TS twin: `validatePracticeAuthoringState`)                         */
/* ------------------------------------------------------------------ */

pub(crate) const PRACTICE_AUTHORING_TABLES: [&str; 1] = ["practice_save_operations"];

/// `AUTHORING_ACTIONS` in the TypeScript twin. Migration 0017 also declares a
/// CHECK over exactly these values, so no row can reach the receipts loop with
/// any other action.
const PRACTICE_AUTHORING_ACTIONS: [&str; 6] = [
    "create",
    "edit",
    "correct",
    "regenerate",
    "restore",
    "remove",
];

/// The OFFLINE-03b contract: the receipts table exactly as migration 0017
/// defines it; the new columns on the two extended tables; receipts binding
/// material, action and the exact canonical payload bytes with a digest that
/// recomputes, decoded by the writer's own strict decoder; identities that are
/// unique per version and owned by one living material; retirement lists,
/// historical envelopes and the current mirror that decode and agree. Column
/// registration alone proves nothing. This is the native twin of
/// `validatePracticeAuthoringState` in `src/data/practiceStateValidation.ts`,
/// in the same order with the same checks; the shared accept/refuse fixture is
/// `src-tauri/fixtures/practice-authoring-validation/cases.json`.
pub(crate) fn verify_schema_17_practice_authoring_semantics(
    connection: &Connection,
) -> Result<(), String> {
    use crate::card_reviews::sha256_hex;
    use crate::practice_authoring::{
        decode_practice_operation, decode_practice_retirements, decode_practice_snapshot,
        read_current_snapshot,
    };
    use crate::practice_sessions::canonical_json;
    use rusqlite::types::Value as SqlValue;
    use serde_json::Value;

    // The authoring contract's UUID pattern is lowercase, so `is_valid_uuid_v4`
    // alone is not enough (TS `AUTHORING_UUID_V4` has no `i` flag).
    let is_authoring_uuid = |value: &str| {
        is_valid_uuid_v4(value) && !value.bytes().any(|byte| byte.is_ascii_uppercase())
    };
    let field = |row: &M3Row, key: &str| m3_field(row, key).unwrap_or_default();

    // 1. The receipt table, exactly as the registered migration defines it.
    let reference = get_reference_schema_connection()?;
    for table in PRACTICE_AUTHORING_TABLES {
        if m3_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[m3_value(table)],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
        if m3_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
        {
            return Err(format!("Table {table} has rows that point at nothing."));
        }
    }
    if m3_index_shape(
        connection,
        "practice_save_operations",
        "idx_practice_save_ops_material",
    )? != m3_index_shape(
        &reference,
        "practice_save_operations",
        "idx_practice_save_ops_material",
    )? {
        return Err(
            "The database is missing required index: idx_practice_save_ops_material".to_string(),
        );
    }

    // 2. The 0017 columns on the tables earlier migrations made.
    for (table, col_name, col_type, notnull) in [
        ("practice_tests", "retired_json", "TEXT", 1),
        ("practice_test_items", "logical_id", "TEXT", 0),
        ("practice_test_items", "replaces_id", "TEXT", 0),
    ] {
        let found: Option<(String, i64)> = connection
            .query_row(
                &format!(
                    "SELECT type, [notnull] FROM pragma_table_info('{table}') WHERE name = ?1"
                ),
                [col_name],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to read actual columns for {table}: {e}"))?;
        let Some((actual_type, actual_notnull)) = found else {
            return Err(format!("Table {table} missing required column: {col_name}"));
        };
        if !actual_type.eq_ignore_ascii_case(col_type) {
            return Err(format!(
                "Table {table} column {col_name} type mismatch: expected {col_type}, found {actual_type}"
            ));
        }
        if actual_notnull != notnull {
            return Err(format!(
                "Table {table} column {col_name} notnull mismatch: expected {notnull}, found {actual_notnull}"
            ));
        }
    }

    // 3. Receipts: exact canonical payload bytes, a digest that recomputes, a
    // typed result, and the whole operation decoded by the writer's own strict
    // decoder, bound row-for-row to the operation id, material and action it is
    // keyed by. A reused operation id is only ever the same committed
    // operation.
    for row in m3_rows(
        connection,
        "SELECT operation_id, material_id, action, payload_json, payload_hash, result_json \
         FROM practice_save_operations",
        &[],
    )? {
        let action = field(&row, "action");
        if !PRACTICE_AUTHORING_ACTIONS.contains(&action.as_str()) {
            return Err("A practice save receipt names an unknown action.".to_string());
        }
        let payload = field(&row, "payload_json");
        let Ok(operation) = serde_json::from_str::<Value>(&payload) else {
            return Err("A practice save receipt does not hold JSON.".to_string());
        };
        if canonical_json(&operation) != payload {
            return Err(
                "A practice save receipt does not hold its exact canonical payload bytes."
                    .to_string(),
            );
        }
        // Strict decode through the authoring writer's own decoder — one
        // decoder, not a second one that could drift.
        let Ok(decoded) = decode_practice_operation(&operation) else {
            return Err(
                "A practice save receipt does not hold a complete authoring operation.".to_string(),
            );
        };
        if decoded.operation_id != field(&row, "operation_id") {
            return Err(
                "A practice save receipt does not bind its operation id to its row key."
                    .to_string(),
            );
        }
        if decoded.material_id != field(&row, "material_id") || decoded.reason.as_str() != action {
            return Err(
                "A practice save receipt does not bind its material and action.".to_string(),
            );
        }
        if field(&row, "payload_hash") != sha256_hex(&payload) {
            return Err("A practice save receipt digest does not match its payload.".to_string());
        }
        let result = match serde_json::from_str::<Value>(&field(&row, "result_json")) {
            Ok(Value::Object(map)) => map,
            _ => return Err("A practice save receipt does not hold a typed result.".to_string()),
        };
        let mut keys: Vec<&str> = result.keys().map(String::as_str).collect();
        keys.sort_unstable();
        let expected_keys = if action == "remove" {
            "status"
        } else {
            "status,versionId"
        };
        if result.get("status").and_then(Value::as_str) != Some("saved")
            || keys.join(",") != expected_keys
        {
            return Err("A practice save receipt does not hold a typed result.".to_string());
        }
        if action != "remove"
            && !result
                .get("versionId")
                .and_then(Value::as_str)
                .is_some_and(is_authoring_uuid)
        {
            return Err("A practice save receipt does not name the version it saved.".to_string());
        }
    }

    // 4. Editor metadata: identities and replacements are UUID v4, unique per
    // version, never shared by two living materials, and a recorded
    // replacement always sits beside an origin.
    for row in m3_rows(
        connection,
        "SELECT logical_id, replaces_id FROM practice_test_items \
         WHERE logical_id IS NOT NULL OR replaces_id IS NOT NULL",
        &[],
    )? {
        for column in ["logical_id", "replaces_id"] {
            if let SqlValue::Null = m3_get(&row, column) {
                continue;
            }
            if !is_authoring_uuid(&field(&row, column)) {
                return Err(format!("A practice item carries a malformed {column}."));
            }
        }
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM (
            SELECT version_id, logical_id FROM practice_test_items
             WHERE logical_id IS NOT NULL GROUP BY version_id, logical_id HAVING COUNT(*) > 1)",
        &[],
    )? != 0
    {
        return Err("A practice version repeats one logical identity.".to_string());
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM (
            SELECT i.logical_id FROM practice_test_items i
              JOIN practice_test_versions v ON v.id = i.version_id
             WHERE i.logical_id IS NOT NULL AND v.source_material_id IS NOT NULL
             GROUP BY i.logical_id HAVING COUNT(DISTINCT v.source_material_id) > 1)",
        &[],
    )? != 0
    {
        return Err("Two study materials share one practice question identity.".to_string());
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM practice_test_items i
          WHERE i.replaces_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM practice_item_origins o WHERE o.item_id = i.id)",
        &[],
    )? != 0
    {
        return Err("A practice item records a replacement without an origin.".to_string());
    }

    // 5. Stored retirement lists and historical envelopes decode strictly.
    for row in m3_rows(connection, "SELECT retired_json FROM practice_tests", &[])? {
        let damaged = match serde_json::from_str::<Value>(&field(&row, "retired_json")) {
            Ok(value) => decode_practice_retirements(&value).is_err(),
            Err(_) => true,
        };
        if damaged {
            return Err("A practice test carries a damaged retirement list.".to_string());
        }
    }
    for row in m3_rows(
        connection,
        "SELECT previous_json FROM study_set_history WHERE kind = 'practice'",
        &[],
    )? {
        let damaged = match serde_json::from_str::<Value>(&field(&row, "previous_json")) {
            Ok(value) => decode_practice_snapshot(&value).is_err(),
            Err(_) => true,
        };
        if damaged {
            return Err("A saved practice history entry is not a valid snapshot.".to_string());
        }
    }

    // 6. The current mirror agrees with the active version, and every active
    // version of a living material has its mirror row.
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM practice_test_versions v
          WHERE v.is_active = 1 AND v.source_material_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM practice_tests t WHERE t.source_material_id = v.source_material_id)",
        &[],
    )? != 0
    {
        return Err("An active practice version has no current test row.".to_string());
    }
    for row in m3_rows(
        connection,
        "SELECT source_material_id, title, questions_json, provider, model, legacy_migrated_at \
         FROM practice_tests",
        &[],
    )? {
        let material_id = field(&row, "source_material_id");
        let current = read_current_snapshot(connection, &material_id)
            .map_err(|_| "The current practice test does not decode as a saved snapshot.")?;
        let Some(snapshot) = current else {
            // A mirror with no active version is legitimate only while the
            // legacy row is unconverted or quarantined (established
            // schema-11 states). Once marked migrated — the state the
            // authoring contract always writes together with its version —
            // the version must exist.
            if let SqlValue::Null = m3_get(&row, "legacy_migrated_at") {
                continue;
            }
            return Err("A migrated current practice test has no active version.".to_string());
        };
        if snapshot.title != field(&row, "title")
            || snapshot.provider != field(&row, "provider")
            || snapshot.model != field(&row, "model")
        {
            return Err("The current practice test disagrees with its active version.".to_string());
        }
        let Ok(mirrored) = serde_json::from_str::<Value>(&field(&row, "questions_json")) else {
            return Err("The current practice test does not hold JSON questions.".to_string());
        };
        let projected: Vec<Value> = snapshot
            .questions
            .iter()
            .map(|question| {
                serde_json::json!({
                    "question": question.question,
                    "options": question.options,
                    "correctIndex": question.correct_index,
                    "explanation": question.explanation,
                    "sourcePage": question.source_page,
                })
            })
            .collect();
        if canonical_json(&mirrored) != canonical_json(&Value::Array(projected)) {
            return Err(
                "The current practice test questions disagree with the active version.".to_string(),
            );
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 16: study material she makes herself                         */
/* (TS twin: `validateManualStudyState`)                               */
/* ------------------------------------------------------------------ */

pub(crate) const MANUAL_STUDY_TABLES: [&str; 5] = [
    "study_set_history",
    "card_version_origins",
    "card_item_origins",
    "practice_item_origins",
    "ai_study_sets",
];

/// The OFFLINE-03 contract: the history and origin tables, and the two new
/// study-set columns, exactly as migration 0016 defines them; rows that point
/// at real materials, cards and questions; and well-formed stored provenance.
/// Card origins are checked against their snapshot hashes in schema 12.
pub(crate) fn verify_schema_16_manual_study_semantics(
    connection: &Connection,
) -> Result<(), String> {
    let count = |sql: &str, params: &[&dyn rusqlite::ToSql]| -> Result<i64, String> {
        connection
            .query_row(sql, params, |r| r.get(0))
            .map_err(|e| format!("Could not check study set history: {e}"))
    };
    let reference = get_reference_schema_connection_through(16)?;
    for table in MANUAL_STUDY_TABLES {
        if count(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
        if count(
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
        {
            return Err(format!("Table {table} has rows that point at nothing."));
        }
    }
    if m3_index_shape(connection, "study_set_history", "idx_study_set_history")?
        != m3_index_shape(&reference, "study_set_history", "idx_study_set_history")?
    {
        return Err("The database is missing required index: idx_study_set_history".to_string());
    }
    crate::study_sets::verify_stored_sets(connection)
}

/* ------------------------------------------------------------------ */
/* Schema 15: document navigation                                      */
/* (TS twin: `validateNavigationState`)                                */
/* ------------------------------------------------------------------ */

pub(crate) const NAVIGATION_TABLES: [&str; 4] = [
    "material_content_identities",
    "material_reading_state",
    "material_bookmarks",
    "material_operation_claims",
];

pub(crate) const NAVIGATION_INDEXES: [(&str, &str); 5] = [
    ("material_content_identities", "idx_material_content_sha"),
    ("material_reading_state", "idx_material_reading_state_owner"),
    ("material_bookmarks", "idx_material_bookmarks_material"),
    ("material_bookmarks", "idx_material_bookmarks_page"),
    ("material_bookmarks", "idx_material_bookmarks_hash"),
];

/// The navigation contract a restored or opened database must meet: the four
/// tables exactly as migration 0015 defines them, their indexes, rows that
/// point at real materials, and ownership that is internally consistent — a
/// cancelled token was issued, and a saved tuple belongs to an issued token.
pub(crate) fn verify_schema_15_navigation_semantics(connection: &Connection) -> Result<(), String> {
    let count = |sql: &str, params: &[&dyn rusqlite::ToSql]| -> Result<i64, String> {
        connection
            .query_row(sql, params, |r| r.get(0))
            .map_err(|e| format!("Could not check document navigation: {e}"))
    };
    let version = newest_migration_version(connection)
        .unwrap_or(crate::CURRENT_SCHEMA_VERSION)
        .max(15);
    let reference = get_reference_schema_connection_through(version)?;
    for table in NAVIGATION_TABLES {
        if count(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
        let orphans = count(
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )?;
        if orphans != 0 {
            return Err(format!(
                "Table {table} has rows for study materials that no longer exist."
            ));
        }
    }
    for (table, index) in NAVIGATION_INDEXES {
        if m3_index_shape(connection, table, index)? != m3_index_shape(&reference, table, index)? {
            return Err(format!("The database is missing required index: {index}"));
        }
    }
    if count(
        "SELECT COUNT(*) FROM material_operation_claims WHERE cancelled_generation > reserved_generation",
        &[],
    )? != 0
    {
        return Err("A navigation claim cancels a request that was never issued.".to_string());
    }
    if count(
        "SELECT COUNT(*) FROM material_reading_state s
           LEFT JOIN material_operation_claims c ON c.material_id = s.material_id
          WHERE s.owner_generation > COALESCE(c.reserved_generation, 0)",
        &[],
    )? != 0
    {
        return Err(
            "A saved reading position belongs to a request that was never issued.".to_string(),
        );
    }
    if count(
        &format!(
            "SELECT COUNT(*) FROM (SELECT material_id FROM material_bookmarks GROUP BY material_id HAVING COUNT(*) > {})",
            crate::navigation::MAX_BOOKMARKS_PER_MATERIAL
        ),
        &[],
    )? != 0
    {
        return Err("A study material has more bookmarks than the app supports.".to_string());
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 14: skills and feedback evidence                             */
/* (TS twin: `validateSkillEvidenceState`)                             */
/* ------------------------------------------------------------------ */

const SKILL_EVIDENCE_TABLES: [&str; 6] = [
    "skill_catalog_entries",
    "skill_catalog_revisions",
    "skill_observations",
    "skill_observation_revisions",
    "skill_self_assessments",
    "skill_evidence_operations",
];

const SKILL_EVIDENCE_INDEXES: [(&str, &str); 6] = [
    ("skill_observations", "idx_skill_observations_page"),
    ("skill_observations", "idx_skill_observations_skill_page"),
    ("skill_observations", "idx_skill_observations_journal"),
    (
        "skill_observations",
        "idx_skill_observations_source_journal",
    ),
    ("skill_observations", "idx_skill_observations_action"),
    (
        "skill_evidence_operations",
        "idx_skill_evidence_operations_subject",
    ),
];

const SKILL_EVIDENCE_TRIGGERS: [&str; 6] = [
    "trg_skill_catalog_revisions_no_update",
    "trg_skill_catalog_revisions_no_delete",
    "trg_skill_observation_revisions_no_update",
    "trg_skill_observation_revisions_no_partial_delete",
    "trg_skill_self_assessments_no_update",
    "trg_skill_self_assessments_no_delete",
];

type M3Row = Vec<(String, rusqlite::types::Value)>;

fn m3_rows(
    connection: &Connection,
    sql: &str,
    values: &[rusqlite::types::Value],
) -> Result<Vec<M3Row>, String> {
    let fail = |e: rusqlite::Error| format!("Could not check skill evidence: {e}");
    let mut statement = connection.prepare(sql).map_err(fail)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mapped = statement
        .query_map(rusqlite::params_from_iter(values.iter()), |r| {
            let mut out = Vec::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                out.push((name.clone(), r.get::<_, rusqlite::types::Value>(i)?));
            }
            Ok(out)
        })
        .map_err(fail)?;
    mapped.collect::<Result<Vec<_>, _>>().map_err(fail)
}

fn m3_get<'a>(row: &'a M3Row, key: &str) -> &'a rusqlite::types::Value {
    row.iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v)
        .unwrap_or(&rusqlite::types::Value::Null)
}

/// Text form used for comparisons (TS `m3Str`): NULL stays None.
fn m3_text(value: &rusqlite::types::Value) -> Option<String> {
    use rusqlite::types::Value as V;
    match value {
        V::Null => None,
        V::Integer(i) => Some(i.to_string()),
        V::Real(f) => Some(f.to_string()),
        V::Text(s) => Some(s.clone()),
        V::Blob(b) => Some(format!("{b:?}")),
    }
}

fn m3_int(value: &rusqlite::types::Value) -> i64 {
    use rusqlite::types::Value as V;
    match value {
        V::Integer(i) => *i,
        V::Text(s) => s.parse().unwrap_or(-1),
        _ => -1,
    }
}

fn m3_field(row: &M3Row, key: &str) -> Option<String> {
    m3_text(m3_get(row, key))
}

fn m3_count(
    connection: &Connection,
    sql: &str,
    values: &[rusqlite::types::Value],
) -> Result<i64, String> {
    Ok(m3_rows(connection, sql, values)?
        .first()
        .map(|r| m3_int(&r[0].1))
        .unwrap_or(0))
}

fn m3_value(text: &str) -> rusqlite::types::Value {
    rusqlite::types::Value::Text(text.to_string())
}

fn m3_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    Ok(m3_rows(
        connection,
        &format!("SELECT name, type, \"notnull\" AS required, pk, dflt_value FROM pragma_table_info('{table}') ORDER BY name"),
        &[],
    )?
    .iter()
    .map(|r| {
        format!(
            "{}|{}|{}|{}|{}",
            m3_field(r, "name").unwrap_or_default(),
            m3_field(r, "type").unwrap_or_default().to_lowercase(),
            m3_int(m3_get(r, "required")),
            m3_int(m3_get(r, "pk")),
            m3_field(r, "dflt_value").unwrap_or_default()
        )
    })
    .collect())
}

fn m3_key_indexes(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for r in m3_rows(
        connection,
        &format!(
            "SELECT name, origin FROM pragma_index_list('{table}') WHERE origin IN ('pk', 'u')"
        ),
        &[],
    )? {
        let name = m3_field(&r, "name").unwrap_or_default();
        let cols: Vec<String> = m3_rows(
            connection,
            &format!("SELECT name FROM pragma_index_info('{name}') ORDER BY seqno"),
            &[],
        )?
        .iter()
        .map(|c| m3_field(c, "name").unwrap_or_default())
        .collect();
        out.push(format!(
            "{}|{}",
            m3_field(&r, "origin").unwrap_or_default(),
            cols.join(",")
        ));
    }
    out.sort();
    Ok(out)
}

fn m3_master_sql(
    connection: &Connection,
    kind: &str,
    name: &str,
) -> Result<Option<String>, String> {
    Ok(m3_rows(
        connection,
        "SELECT sql FROM sqlite_master WHERE type = ?1 AND name = ?2",
        &[m3_value(kind), m3_value(name)],
    )?
    .first()
    .and_then(|r| m3_field(r, "sql")))
}

fn m3_index_shape(
    connection: &Connection,
    table: &str,
    index: &str,
) -> Result<Option<String>, String> {
    let listed = m3_rows(
        connection,
        &format!("SELECT \"unique\" AS uniq FROM pragma_index_list('{table}') WHERE name = ?1"),
        &[m3_value(index)],
    )?;
    let Some(first) = listed.first() else {
        return Ok(None);
    };
    let cols: Vec<String> = m3_rows(
        connection,
        &format!("SELECT name FROM pragma_index_info('{index}') ORDER BY seqno"),
        &[],
    )?
    .iter()
    .map(|c| m3_field(c, "name").unwrap_or_default())
    .collect();
    Ok(Some(format!(
        "{}|{}",
        m3_int(m3_get(first, "uniq")),
        cols.join(",")
    )))
}

/// The schema-14 contract a restored or opened database must meet: exact
/// shape (columns, defaults, foreign keys, CHECKs, keys, indexes, triggers),
/// the shipped built-in catalog, contiguous histories whose latest entry is
/// the head, legal catalog steps with unique active names (M3-R6), receipts
/// that own exactly the history they name (M3-R5), and history owned by its
/// receipt (M3-R9). Shared contract:
/// `fixtures/skill-evidence/validation-cases.json`.
pub(crate) fn verify_schema_14_skill_evidence_semantics(
    connection: &Connection,
) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    verify_skill_evidence_against(connection, &reference)
}

pub(crate) fn verify_skill_evidence_against(
    connection: &Connection,
    reference: &Connection,
) -> Result<(), String> {
    use crate::skill_evidence::{
        decode_result, label_key, ResultValue, ASSESSMENT_ACTIONS, OBSERVATION_HISTORY_ACTIONS,
        SKILL_ACTIONS,
    };
    use rusqlite::types::Value as V;

    // 1. Exact shape.
    for table in SKILL_EVIDENCE_TABLES {
        let Some(sql) = m3_master_sql(connection, "table", table)? else {
            return Err(format!("The database is missing required table: {table}"));
        };
        let reference_sql = m3_master_sql(reference, "table", table)?.unwrap_or_default();
        if m3_columns(connection, table)? != m3_columns(reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&sql) != check_constraints(&reference_sql) {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
    }
    for (table, index) in SKILL_EVIDENCE_INDEXES {
        let Some(actual) = m3_index_shape(connection, table, index)? else {
            return Err(format!("The database is missing required index: {index}"));
        };
        if Some(actual) != m3_index_shape(reference, table, index)? {
            return Err(format!(
                "Index {index} does not match the registered migration contract."
            ));
        }
    }
    for trigger in SKILL_EVIDENCE_TRIGGERS {
        let Some(sql) = m3_master_sql(connection, "trigger", trigger)? else {
            return Err(format!(
                "The database is missing required trigger: {trigger}"
            ));
        };
        if normalize_sql(&sql)
            != normalize_sql(&m3_master_sql(reference, "trigger", trigger)?.unwrap_or_default())
        {
            return Err(format!(
                "Trigger {trigger} does not match the registered migration contract."
            ));
        }
    }

    // 2. Relationships hold (foreign keys are not re-checked by SQLite on restore).
    for table in SKILL_EVIDENCE_TABLES {
        if !m3_rows(
            connection,
            &format!("SELECT 1 FROM pragma_foreign_key_check('{table}') LIMIT 1"),
            &[],
        )?
        .is_empty()
        {
            return Err(format!(
                "Table {table} has a record pointing at something that does not exist."
            ));
        }
    }

    // 3. The built-in catalog is exactly the shipped one.
    let shipped = m3_rows(
        reference,
        "SELECT * FROM skill_catalog_revisions WHERE revision = 1 AND changed_by = 'catalog'",
        &[],
    )?;
    let builtins = m3_rows(
        connection,
        "SELECT id FROM skill_catalog_entries WHERE origin = 'builtin'",
        &[],
    )?;
    let shipped_ids: Vec<Option<String>> =
        shipped.iter().map(|r| m3_field(r, "skill_id")).collect();
    if builtins.len() != shipped.len()
        || builtins
            .iter()
            .any(|r| !shipped_ids.contains(&m3_field(r, "id")))
    {
        return Err("The built-in skill catalog does not match this version of the app.".into());
    }
    for r in &shipped {
        let id = m3_field(r, "skill_id").unwrap_or_default();
        let first = m3_rows(
            connection,
            "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = 1",
            &[m3_value(&id)],
        )?;
        let matches = first.first().map(|f| {
            [
                "label",
                "description",
                "topic",
                "status",
                "catalog_version",
                "changed_by",
                "changed_at",
            ]
            .iter()
            .all(|k| m3_field(f, k) == m3_field(r, k))
        });
        if matches != Some(true) {
            return Err(format!(
                "Built-in skill {id} does not match the shipped catalog."
            ));
        }
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM skill_catalog_entries WHERE origin = 'custom'",
        &[],
    )? > crate::skill_evidence::MAX_CUSTOM_SKILLS
    {
        return Err("There are more custom skills than this app supports.".into());
    }

    // 4. Skill history: contiguous, head equals latest, pinned built-in wording
    //    and catalog version, legal steps, unique active names.
    let mut active_names: Vec<(String, String)> = Vec::new();
    for skill in m3_rows(
        connection,
        "SELECT * FROM skill_catalog_entries ORDER BY id",
        &[],
    )? {
        let id = m3_field(&skill, "id").unwrap_or_default();
        let history = m3_rows(
            connection,
            "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 ORDER BY revision",
            &[m3_value(&id)],
        )?;
        if history.len() as i64 != m3_int(m3_get(&skill, "revision"))
            || history
                .iter()
                .enumerate()
                .any(|(i, h)| m3_int(m3_get(h, "revision")) != i as i64 + 1)
        {
            return Err(format!("Skill {id} has gaps in its history."));
        }
        let Some(latest) = history.last() else {
            return Err(format!("Skill {id} has gaps in its history."));
        };
        if ["label", "description", "topic", "status", "catalog_version"]
            .iter()
            .any(|k| m3_field(latest, k) != m3_field(&skill, k))
        {
            return Err(format!(
                "Skill {id} does not match its latest history entry."
            ));
        }
        let builtin = m3_field(&skill, "origin").as_deref() == Some("builtin");
        let reference_row = shipped
            .iter()
            .find(|r| m3_field(r, "skill_id").as_deref() == Some(id.as_str()));
        for (i, h) in history.iter().enumerate() {
            if let Some(r) = reference_row.filter(|_| builtin) {
                if ["label", "description", "topic", "catalog_version"]
                    .iter()
                    .any(|k| m3_field(h, k) != m3_field(r, k))
                {
                    return Err(format!("Built-in skill {id} changed its catalog wording."));
                }
            }
            if !builtin && !matches!(m3_get(h, "catalog_version"), V::Null) {
                return Err(format!("Custom skill {id} has a catalog version."));
            }
            if i == 0 {
                if !builtin
                    && (m3_field(h, "changed_by").as_deref() != Some("user")
                        || m3_field(h, "status").as_deref() != Some("active"))
                {
                    return Err(format!(
                        "Custom skill {id} did not start as an active skill of yours."
                    ));
                }
                continue;
            }
            let prev = &history[i - 1];
            if m3_field(h, "changed_by").as_deref() != Some("user") {
                return Err(format!(
                    "Skill {id} has a later revision that is not a recorded change."
                ));
            }
            let same_wording = ["label", "description", "topic"]
                .iter()
                .all(|k| m3_field(h, k) == m3_field(prev, k));
            let from = m3_field(prev, "status").unwrap_or_default();
            let to = m3_field(h, "status").unwrap_or_default();
            let legal = match (from.as_str(), to.as_str()) {
                ("active", "active") => !same_wording,
                ("active", "retired") | ("retired", "active") => same_wording,
                _ => false,
            };
            if !legal {
                return Err(format!(
                    "Skill {id} has a history step the app cannot make."
                ));
            }
        }
        if m3_field(&skill, "status").as_deref() == Some("active") {
            let key = label_key(&m3_field(&skill, "label").unwrap_or_default());
            if let Some((_, other)) = active_names.iter().find(|(k, _)| *k == key) {
                return Err(format!(
                    "Active skills {other} and {id} have the same name."
                ));
            }
            active_names.push((key, id));
        }
    }

    // 5. Observation history: contiguous, head equals latest, no relinking.
    for obs in m3_rows(connection, "SELECT * FROM skill_observations", &[])? {
        let id = m3_field(&obs, "id").unwrap_or_default();
        let history = m3_rows(
            connection,
            "SELECT * FROM skill_observation_revisions WHERE observation_id = ?1 ORDER BY revision",
            &[m3_value(&id)],
        )?;
        if history.len() as i64 != m3_int(m3_get(&obs, "revision"))
            || history
                .iter()
                .enumerate()
                .any(|(i, h)| m3_int(m3_get(h, "revision")) != i as i64 + 1)
        {
            return Err(format!("Observation {id} has gaps in its history."));
        }
        let Some(latest) = history.last() else {
            return Err(format!("Observation {id} has gaps in its history."));
        };
        if [
            "wording",
            "observed_on",
            "attribution",
            "instructor_name",
            "linked_action_id",
            "linked_action_title",
            "addressed_at",
        ]
        .iter()
        .any(|k| m3_field(&obs, k) != m3_field(latest, k))
        {
            return Err(format!(
                "Observation {id} does not match its latest history entry."
            ));
        }
        let journal = m3_field(&obs, "journal_id");
        if journal.is_some() && journal != m3_field(&obs, "source_journal_id") {
            return Err(format!(
                "Observation {id} points at a different debrief than it was recorded from."
            ));
        }
    }

    // 6. Self-assessment sequences are contiguous per skill and kind.
    for g in m3_rows(
        connection,
        "SELECT skill_id, kind, COUNT(*) AS n, MIN(sequence) AS lo, MAX(sequence) AS hi FROM skill_self_assessments GROUP BY skill_id, kind",
        &[],
    )? {
        if m3_int(m3_get(&g, "lo")) != 1 || m3_int(m3_get(&g, "hi")) != m3_int(m3_get(&g, "n")) {
            return Err(format!(
                "Skill {} has gaps in its {} history.",
                m3_field(&g, "skill_id").unwrap_or_default(),
                m3_field(&g, "kind").unwrap_or_default()
            ));
        }
    }

    // 7. Receipts: exact results naming their own subject, owning the history
    //    row of the kind their action writes; tombstones are non-content
    //    observation receipts whose subject is gone.
    let mut live: Vec<(String, String, String, i64)> = Vec::new();
    for op in m3_rows(
        connection,
        "SELECT * FROM skill_evidence_operations ORDER BY rowid",
        &[],
    )? {
        let id = m3_field(&op, "operation_id").unwrap_or_default();
        let action = m3_field(&op, "action").unwrap_or_default();
        let subject = m3_field(&op, "subject_id").unwrap_or_default();
        let present = m3_count(
            connection,
            "SELECT COUNT(*) FROM skill_observations WHERE id = ?1",
            &[m3_value(&subject)],
        )? > 0;
        if m3_int(m3_get(&op, "is_erased")) != 0 {
            if !OBSERVATION_HISTORY_ACTIONS.contains(&action.as_str()) {
                return Err(format!(
                    "Operation {id} is erased, but only observation changes can be erased."
                ));
            }
            if present {
                return Err(format!(
                    "Operation {id} says its observation was erased, but it is still here."
                ));
            }
            continue;
        }
        let value = decode_result(m3_field(&op, "result_json").as_deref(), &action, &subject)
            .map_err(|e| format!("Operation {id} has an invalid result: {e}"))?;
        let number = match value {
            ResultValue::Number(n) => n,
            ResultValue::Erased => 0,
        };
        live.push((id.clone(), action.clone(), subject.clone(), number));
        if SKILL_ACTIONS.contains(&action.as_str()) {
            let found = m3_rows(
                connection,
                "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = ?2",
                &[m3_value(&subject), V::Integer(number)],
            )?;
            let Some(row) = found.first().filter(|r| {
                m3_field(r, "operation_id").as_deref() == Some(id.as_str())
                    && m3_field(r, "changed_by").as_deref() == Some("user")
            }) else {
                return Err(format!(
                    "Operation {id} does not own the skill history it names."
                ));
            };
            let prev = if number > 1 {
                m3_rows(
                    connection,
                    "SELECT status FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = ?2",
                    &[m3_value(&subject), V::Integer(number - 1)],
                )?
                .first()
                .and_then(|r| m3_field(r, "status"))
            } else {
                None
            };
            let status = m3_field(row, "status").unwrap_or_default();
            let fits = match action.as_str() {
                "create_custom_skill" => subject.starts_with("custom.") && status == "active",
                "edit_custom_skill" => status == "active" && prev.as_deref() == Some("active"),
                "retire_skill" => status == "retired",
                _ => status == "active" && prev.as_deref() == Some("retired"),
            };
            if !fits {
                return Err(format!(
                    "Operation {id} names a skill change of a different kind."
                ));
            }
        } else if OBSERVATION_HISTORY_ACTIONS.contains(&action.as_str()) {
            if !present {
                return Err(format!(
                    "Operation {id} is a live record of an observation that is not here."
                ));
            }
            let found = m3_rows(
                connection,
                "SELECT change_kind, operation_id FROM skill_observation_revisions WHERE observation_id = ?1 AND revision = ?2",
                &[m3_value(&subject), V::Integer(number)],
            )?;
            let Some(row) = found
                .first()
                .filter(|r| m3_field(r, "operation_id").as_deref() == Some(id.as_str()))
            else {
                return Err(format!(
                    "Operation {id} does not own the observation history it names."
                ));
            };
            let kind = m3_field(row, "change_kind").unwrap_or_default();
            let fits = match action.as_str() {
                "create_observation" => kind == "created",
                "edit_observation" => kind == "edited",
                "link_action" => kind == "linked_action",
                "unlink_action" => kind == "unlinked_action",
                _ => kind == "marked_addressed" || kind == "cleared_addressed",
            };
            if !fits {
                return Err(format!(
                    "Operation {id} names an observation change of a different kind."
                ));
            }
        } else if ASSESSMENT_ACTIONS.contains(&action.as_str()) {
            let kind = if action == "set_status" {
                "status"
            } else {
                "confidence"
            };
            let found = m3_rows(
                connection,
                "SELECT id, operation_id FROM skill_self_assessments WHERE skill_id = ?1 AND kind = ?2 AND sequence = ?3",
                &[m3_value(&subject), m3_value(kind), V::Integer(number)],
            )?;
            let owned = found.first().map(|r| {
                m3_field(r, "operation_id").as_deref() == Some(id.as_str())
                    && m3_field(r, "id").as_deref() == Some(id.as_str())
            });
            if owned != Some(true) {
                return Err(format!(
                    "Operation {id} does not own the self-assessment it names."
                ));
            }
        } else {
            if present {
                return Err(format!(
                    "Operation {id} says it erased an observation that is still here."
                ));
            }
            if m3_count(
                connection,
                "SELECT COUNT(*) FROM skill_evidence_operations WHERE subject_id = ?1 AND is_erased = 0 AND action <> 'erase_observation'",
                &[m3_value(&subject)],
            )? > 0
            {
                return Err(format!(
                    "Operation {id} erased an observation whose earlier records were not cleared."
                ));
            }
        }
    }

    // 8. History -> receipt (M3-R9): every operation-owned history row has the
    //    live receipt that wrote it (same operation, action family, subject and
    //    revision or sequence). Catalog seeds need none.
    let owned = |operation: &V, families: &[&str], subject: &V, number: &V| -> bool {
        let Some(operation) = m3_text(operation) else {
            return false;
        };
        live.iter().any(|(id, action, s, n)| {
            *id == operation
                && families.contains(&action.as_str())
                && Some(s.clone()) == m3_text(subject)
                && *n == m3_int(number)
        })
    };
    for r in m3_rows(
        connection,
        "SELECT skill_id, revision, operation_id FROM skill_catalog_revisions WHERE changed_by = 'user' ORDER BY skill_id, revision",
        &[],
    )? {
        if !owned(
            m3_get(&r, "operation_id"),
            &SKILL_ACTIONS,
            m3_get(&r, "skill_id"),
            m3_get(&r, "revision"),
        ) {
            return Err(format!(
                "Skill {} revision {} has no matching operation record.",
                m3_field(&r, "skill_id").unwrap_or_default(),
                m3_int(m3_get(&r, "revision"))
            ));
        }
    }
    for r in m3_rows(
        connection,
        "SELECT observation_id, revision, operation_id FROM skill_observation_revisions ORDER BY observation_id, revision",
        &[],
    )? {
        if !owned(
            m3_get(&r, "operation_id"),
            &OBSERVATION_HISTORY_ACTIONS,
            m3_get(&r, "observation_id"),
            m3_get(&r, "revision"),
        ) {
            return Err(format!(
                "Observation {} revision {} has no matching operation record.",
                m3_field(&r, "observation_id").unwrap_or_default(),
                m3_int(m3_get(&r, "revision"))
            ));
        }
    }
    for r in m3_rows(
        connection,
        "SELECT skill_id, kind, sequence, operation_id FROM skill_self_assessments ORDER BY skill_id, kind, sequence",
        &[],
    )? {
        let action = if m3_field(&r, "kind").as_deref() == Some("status") {
            "set_status"
        } else {
            "set_confidence"
        };
        if !owned(
            m3_get(&r, "operation_id"),
            &[action],
            m3_get(&r, "skill_id"),
            m3_get(&r, "sequence"),
        ) {
            return Err(format!(
                "Skill {} {} entry {} has no matching operation record.",
                m3_field(&r, "skill_id").unwrap_or_default(),
                m3_field(&r, "kind").unwrap_or_default(),
                m3_int(m3_get(&r, "sequence"))
            ));
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 13: split lineage (TS twin: `validateSplitLineageState`)     */
/* ------------------------------------------------------------------ */

const LINEAGE_TABLES: [&str; 2] = ["material_split_lineage", "split_operation_log"];
const LINEAGE_INDEXES: [(&str, &str); 4] = [
    ("material_split_lineage", "idx_split_lineage_parent"),
    ("material_split_lineage", "idx_split_lineage_root"),
    ("split_operation_log", "idx_split_operation_source"),
    ("split_operation_log", "idx_split_operation_status"),
];

/// The split-lineage contract a restored or opened database must meet: the
/// tables exactly as migration 0013 defines them, its indexes, well-formed
/// fingerprints, and split records whose hash is the hash of their receipt.
pub(crate) fn verify_schema_13_lineage_semantics(connection: &Connection) -> Result<(), String> {
    use crate::card_reviews::{is_lower_hex_64, sha256_hex};
    let count = |sql: &str, params: &[&dyn rusqlite::ToSql]| -> Result<i64, String> {
        connection
            .query_row(sql, params, |r| r.get(0))
            .map_err(|e| format!("Could not check split lineage: {e}"))
    };
    let reference = get_reference_schema_connection()?;
    for table in LINEAGE_TABLES {
        if count(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        let columns = |c: &Connection| -> Result<Vec<(String, String, i64, i64)>, String> {
            let mut statement = c
                .prepare(&format!(
                    "SELECT name, type, [notnull], pk FROM pragma_table_info('{table}') ORDER BY name"
                ))
                .map_err(|e| format!("Could not inspect {table}: {e}"))?;
            let rows = statement
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?.to_ascii_lowercase(),
                        r.get(2)?,
                        r.get(3)?,
                    ))
                })
                .map_err(|e| format!("Could not inspect {table}: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Could not inspect {table}: {e}"));
            rows
        };
        if columns(connection)? != columns(&reference)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
    }
    for (table, index) in LINEAGE_INDEXES {
        if count(
            &format!("SELECT COUNT(*) FROM pragma_index_list('{table}') WHERE name = ?1"),
            &[&index],
        )? == 0
        {
            return Err(format!("The database is missing required index: {index}"));
        }
    }

    let mut statement = connection
        .prepare(
            "SELECT material_id, source_content_sha256, parent_content_sha256
               FROM material_split_lineage",
        )
        .map_err(|e| format!("Could not check split lineage: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| format!("Could not check split lineage: {e}"))?;
    for row in rows {
        let (material, root, parent) =
            row.map_err(|e| format!("Could not check split lineage: {e}"))?;
        for hash in [root, parent].into_iter().flatten() {
            if !is_lower_hex_64(&hash) {
                return Err(format!(
                    "Split part {material} has a malformed source fingerprint."
                ));
            }
        }
    }

    let mut statement = connection
        .prepare(
            "SELECT operation_id, receipt_hash, receipt_canonical_json FROM split_operation_log",
        )
        .map_err(|e| format!("Could not check split records: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Could not check split records: {e}"))?;
    for row in rows {
        let (operation, hash, canonical) =
            row.map_err(|e| format!("Could not check split records: {e}"))?;
        if !is_lower_hex_64(&hash) || operation != hash || sha256_hex(&canonical) != hash {
            return Err(format!(
                "Split record {operation} does not match its receipt."
            ));
        }
    }
    Ok(())
}

pub(crate) fn verify_schema_11_semantics(connection: &Connection) -> Result<(), String> {
    // 1. Foreign key check
    let mut fk_stmt = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|e| format!("Could not check foreign keys in that backup: {e}"))?;
    let mut fk_rows = fk_stmt
        .query([])
        .map_err(|e| format!("Could not run foreign key check: {e}"))?;
    if let Some(row) = fk_rows
        .next()
        .map_err(|e| format!("Could not read foreign key check: {e}"))?
    {
        let table: String = row.get(0).unwrap_or_default();
        let parent: String = row.get(2).unwrap_or_default();
        return Err(format!(
            "The database violates foreign key constraints between {table} and {parent}."
        ));
    }

    let ref_conn = get_reference_schema_connection()?;

    // 2. Validate tables, column types, nullability, and PKs against reference schema
    let practice_tables = [
        "practice_test_versions",
        "practice_test_items",
        "practice_attempts",
        "practice_responses",
        "practice_session_operations",
        "practice_tests",
    ];

    for table in practice_tables {
        let present: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            )
            .map_err(|e| format!("Could not inspect schema for {table}: {e}"))?;
        if present != 1 {
            return Err(format!("The backup is missing required table: {table}"));
        }

        let mut ref_stmt = ref_conn
            .prepare(&format!(
                "SELECT name, type, [notnull], pk FROM pragma_table_info('{table}')"
            ))
            .map_err(|e| format!("Failed to read ref columns for {table}: {e}"))?;
        let ref_cols: Vec<(String, String, i64, i64)> = ref_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| format!("Failed to query ref columns for {table}: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect ref columns error: {e}"))?;

        let mut conn_stmt = connection
            .prepare(&format!(
                "SELECT name, type, [notnull], pk FROM pragma_table_info('{table}')"
            ))
            .map_err(|e| format!("Failed to read actual columns for {table}: {e}"))?;
        let conn_cols: std::collections::HashMap<String, (String, i64, i64)> = conn_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                    ),
                ))
            })
            .map_err(|e| format!("Failed to query actual columns for {table}: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect actual columns error: {e}"))?;

        for (col_name, col_type, notnull, pk) in ref_cols {
            if table == "practice_tests"
                && !["legacy_migrated_at", "legacy_error"].contains(&col_name.as_str())
            {
                continue;
            }
            if table == "practice_test_items"
                && ["logical_id", "replaces_id"].contains(&col_name.as_str())
            {
                continue; // added by 0017; required by verify_schema_17_practice_authoring_semantics
            }
            if table == "practice_test_items" && col_name == "unchecked" {
                continue; // added by 0039; required by verify_schema_39_practice_unchecked
            }
            let Some((actual_type, actual_notnull, actual_pk)) = conn_cols.get(&col_name) else {
                return Err(format!("Table {table} missing required column: {col_name}"));
            };
            if !actual_type.eq_ignore_ascii_case(&col_type) {
                return Err(format!(
                    "Table {table} column {col_name} type mismatch: expected {col_type}, found {actual_type}"
                ));
            }
            if *actual_notnull != notnull {
                return Err(format!(
                    "Table {table} column {col_name} notnull mismatch: expected {notnull}, found {actual_notnull}"
                ));
            }
            if *actual_pk != pk {
                return Err(format!(
                    "Table {table} column {col_name} pk mismatch: expected {pk}, found {actual_pk}"
                ));
            }
        }

        // Foreign-key definitions: `PRAGMA foreign_key_check` only checks rows
        // against definitions that exist, so a missing or altered definition
        // must be caught here, against the registered reference.
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&ref_conn, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&ref_conn, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
    }

    // 3. Required compound uniqueness constraints
    // practice_test_items: compound UNIQUE(version_id, ordinal)
    {
        let mut idx_stmt = connection
            .prepare("SELECT name, [unique] FROM pragma_index_list('practice_test_items')")
            .map_err(|e| format!("Inspect index list items: {e}"))?;
        let indexes: Vec<(String, i64)> = idx_stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("Query index list items: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect index list items: {e}"))?;

        let has_compound_unique = indexes.iter().any(|(idx_name, is_unique)| {
            if *is_unique != 1 {
                return false;
            }
            let mut info_stmt = match connection.prepare(&format!(
                "SELECT name FROM pragma_index_info('{idx_name}') ORDER BY seqno ASC"
            )) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let cols: Vec<String> = info_stmt
                .query_map([], |r| r.get(0))
                .ok()
                .map(|m| m.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
            cols == ["version_id", "ordinal"]
        });

        if !has_compound_unique {
            return Err("The backup table practice_test_items is missing compound UNIQUE constraint on (version_id, ordinal).".to_string());
        }
    }

    // practice_responses: compound UNIQUE(attempt_id, item_id)
    {
        let mut idx_stmt = connection
            .prepare("SELECT name, [unique] FROM pragma_index_list('practice_responses')")
            .map_err(|e| format!("Inspect index list responses: {e}"))?;
        let indexes: Vec<(String, i64)> = idx_stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("Query index list responses: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect index list responses: {e}"))?;

        let has_compound_unique = indexes.iter().any(|(idx_name, is_unique)| {
            if *is_unique != 1 {
                return false;
            }
            let mut info_stmt = match connection.prepare(&format!(
                "SELECT name FROM pragma_index_info('{idx_name}') ORDER BY seqno ASC"
            )) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let cols: Vec<String> = info_stmt
                .query_map([], |r| r.get(0))
                .ok()
                .map(|m| m.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
            cols == ["attempt_id", "item_id"]
        });

        if !has_compound_unique {
            return Err("The backup table practice_responses is missing compound UNIQUE constraint on (attempt_id, item_id).".to_string());
        }
    }

    // 4. Required partial unique indexes with key and predicate inspection
    let required_unique_indexes: &[(&str, &str, &[&str], &str)] = &[
        (
            "practice_test_versions",
            "uq_active_practice_version",
            &["source_material_id"],
            "is_active = 1",
        ),
        (
            "practice_attempts",
            "uq_single_in_progress_attempt",
            &["source_material_id"],
            "status = 'in_progress'",
        ),
    ];

    for &(table, index_name, expected_cols, where_clause) in required_unique_indexes {
        let unique_val: Option<i64> = connection
            .query_row(
                &format!("SELECT [unique] FROM pragma_index_list('{table}') WHERE name = ?1"),
                [index_name],
                |r| r.get(0),
            )
            .ok();

        match unique_val {
            Some(1) => {
                let mut info_stmt = connection
                    .prepare(&format!(
                        "SELECT name FROM pragma_index_info('{index_name}') ORDER BY seqno ASC"
                    ))
                    .map_err(|e| format!("Inspect index info {index_name}: {e}"))?;
                let cols: Vec<String> = info_stmt
                    .query_map([], |r| r.get(0))
                    .map_err(|e| format!("Query index info {index_name}: {e}"))?
                    .collect::<Result<_, _>>()
                    .map_err(|e| format!("Collect index info {index_name}: {e}"))?;

                if cols.as_slice() != expected_cols {
                    return Err(format!(
                        "The backup unique index {index_name} has invalid key columns: expected {expected_cols:?}, found {cols:?}"
                    ));
                }

                let sql: Option<String> = connection
                    .query_row(
                        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
                        [index_name],
                        |r| r.get(0),
                    )
                    .ok();
                if let Some(s) = sql {
                    let s_norm = s.to_ascii_lowercase();
                    if !s_norm.contains("unique")
                        || !s_norm.contains(&where_clause.to_ascii_lowercase())
                        || !s_norm.contains("source_material_id is not null")
                    {
                        return Err(format!(
                            "The backup unique index {index_name} does not match expected predicate."
                        ));
                    }
                }
            }
            Some(_) => {
                return Err(format!(
                    "The backup index {index_name} must be a UNIQUE index."
                ));
            }
            None => {
                return Err(format!(
                    "The backup is missing required unique index: {index_name}"
                ));
            }
        }
    }

    // Required secondary indexes with key column verification against reference schema
    let required_indexes = [
        ("practice_test_versions", "idx_practice_versions_history"),
        ("practice_test_items", "idx_practice_items_version"),
        ("practice_attempts", "idx_practice_attempts_material"),
        ("practice_attempts", "idx_practice_attempts_version"),
        ("practice_responses", "idx_practice_responses_attempt"),
        ("practice_session_operations", "idx_practice_ops_history"),
        ("practice_session_operations", "idx_practice_ops_attempt"),
    ];

    for (table, index_name) in required_indexes {
        let exists: bool = connection
            .query_row(
                &format!("SELECT 1 FROM pragma_index_list('{table}') WHERE name = ?1"),
                [index_name],
                |_| Ok(true),
            )
            .ok()
            .unwrap_or(false);
        if !exists {
            return Err(format!(
                "The backup is missing required index: {index_name}"
            ));
        }

        let mut ref_info = ref_conn
            .prepare(&format!(
                "SELECT name FROM pragma_index_info('{index_name}') ORDER BY seqno ASC"
            ))
            .map_err(|e| format!("Inspect ref index info {index_name}: {e}"))?;
        let ref_cols: Vec<String> = ref_info
            .query_map([], |r| r.get(0))
            .map_err(|e| format!("Query ref index info {index_name}: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect ref index info {index_name}: {e}"))?;

        let mut info_stmt = connection
            .prepare(&format!(
                "SELECT name FROM pragma_index_info('{index_name}') ORDER BY seqno ASC"
            ))
            .map_err(|e| format!("Inspect index info {index_name}: {e}"))?;
        let cols: Vec<String> = info_stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| format!("Query index info {index_name}: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect index info {index_name}: {e}"))?;

        if cols != ref_cols {
            return Err(format!(
                "Index {index_name} key columns mismatch: expected {ref_cols:?}, found {cols:?}"
            ));
        }
    }

    // 5. Relational orphaned records and cross-version validation
    let orphan_items: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_test_items i LEFT JOIN practice_test_versions v ON i.version_id = v.id WHERE v.id IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check orphan items: {e}"))?;
    if orphan_items > 0 {
        return Err(
            "The backup contains practice test items without a parent version.".to_string(),
        );
    }

    let orphan_attempts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_attempts a LEFT JOIN practice_test_versions v ON a.version_id = v.id WHERE v.id IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check orphan attempts: {e}"))?;
    if orphan_attempts > 0 {
        return Err("The backup contains practice attempts without a parent version.".to_string());
    }

    let orphan_responses: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_responses r
             LEFT JOIN practice_attempts a ON r.attempt_id = a.id
             LEFT JOIN practice_test_items i ON r.item_id = i.id
             WHERE a.id IS NULL OR i.id IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check orphan responses: {e}"))?;
    if orphan_responses > 0 {
        return Err(
            "The backup contains practice responses without a parent attempt or item.".to_string(),
        );
    }

    let cross_version: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_responses r
             JOIN practice_attempts a ON r.attempt_id = a.id
             JOIN practice_test_items i ON r.item_id = i.id
             WHERE a.version_id != i.version_id",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check cross-version responses: {e}"))?;
    if cross_version > 0 {
        return Err(
            "The backup contains practice responses referencing items from a different version."
                .to_string(),
        );
    }

    // Cross-material consistency:
    // Every attempt's source_material_id must match its version's source_material_id (if not detached)
    let cross_material: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_attempts a
             JOIN practice_test_versions v ON a.version_id = v.id
             WHERE (a.source_material_id IS NOT NULL AND (v.source_material_id IS NULL OR a.source_material_id != v.source_material_id))
                OR (a.source_material_id IS NULL AND v.source_material_id IS NOT NULL AND v.is_active = 1)",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check cross-material attempts: {e}"))?;
    if cross_material > 0 {
        return Err("The backup contains practice attempts whose material ownership does not match their version.".to_string());
    }

    let invalid_op_history: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_session_operations o
             JOIN practice_attempts a ON o.attempt_id = a.id
             JOIN practice_test_versions v ON a.version_id = v.id
             WHERE o.history_key != v.history_key",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check operation history keys: {e}"))?;
    if invalid_op_history > 0 {
        return Err("The backup contains operation receipts whose history_key does not match attempt version.".to_string());
    }

    let duplicate_active_versions: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM (
                 SELECT source_material_id FROM practice_test_versions
                 WHERE is_active = 1 AND source_material_id IS NOT NULL
                 GROUP BY source_material_id HAVING COUNT(*) > 1
             )",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check duplicate active versions: {e}"))?;
    if duplicate_active_versions > 0 {
        return Err(
            "The backup contains multiple active versions for the same study material.".to_string(),
        );
    }

    let duplicate_in_progress: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM (
                 SELECT source_material_id FROM practice_attempts
                 WHERE status = 'in_progress' AND source_material_id IS NOT NULL
                 GROUP BY source_material_id HAVING COUNT(*) > 1
             )",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check duplicate in-progress attempts: {e}"))?;
    if duplicate_in_progress > 0 {
        return Err(
            "The backup contains multiple in-progress attempts for the same study material."
                .to_string(),
        );
    }

    let detached_active: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_test_versions WHERE source_material_id IS NULL AND is_active = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check detached version status: {e}"))?;
    if detached_active > 0 {
        return Err(
            "The backup contains detached practice test versions that are marked active."
                .to_string(),
        );
    }

    // 6. Validate every frozen version has 1..=200 complete items with contiguous zero-based ordinals
    let mut ver_stmt = connection
        .prepare("SELECT id FROM practice_test_versions")
        .map_err(|e| format!("Failed to query versions: {e}"))?;
    let ver_ids: Vec<String> = ver_stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| format!("Failed to read versions: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Collect versions error: {e}"))?;

    for ver_id in &ver_ids {
        let mut item_stmt = connection
            .prepare(
                "SELECT id, ordinal, question_text, options_json, correct_index, explanation, source_page
                 FROM practice_test_items WHERE version_id = ?1 ORDER BY ordinal ASC",
            )
            .map_err(|e| format!("Failed to prepare version items query: {e}"))?;
        type VersionItemRow = (String, i64, String, String, i64, String, Option<i64>);
        let items: Vec<VersionItemRow> = item_stmt
            .query_map([ver_id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            })
            .map_err(|e| format!("Query items error: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect items error: {e}"))?;

        if items.is_empty() || items.len() > 200 {
            return Err(format!(
                "Practice test version {ver_id} has invalid question count: {}",
                items.len()
            ));
        }

        for (expected_ordinal, item) in items.iter().enumerate() {
            let (
                item_id,
                ordinal,
                question_text,
                options_json,
                correct_index,
                explanation,
                source_page,
            ) = item;
            if *ordinal != expected_ordinal as i64 {
                return Err(format!(
                    "Item {item_id} in version {ver_id} has non-contiguous ordinal: expected {expected_ordinal}, found {ordinal}"
                ));
            }
            if question_text.trim().is_empty() || question_text.chars().count() > 10_000 {
                return Err(format!("Item {item_id} has invalid question text length"));
            }
            if explanation.chars().count() > 5_000 {
                return Err(format!(
                    "Item {item_id} has explanation exceeding 5000 characters"
                ));
            }
            if let Some(sp) = source_page {
                if !(1..=1_000).contains(sp) {
                    return Err(format!(
                        "Item {item_id} has out-of-bounds source page: {sp}"
                    ));
                }
            }

            let options: Vec<serde_json::Value> = serde_json::from_str(options_json)
                .map_err(|_| format!("Item {item_id} has invalid options JSON"))?;
            if options.len() < 2 || options.len() > 8 {
                return Err(format!(
                    "Item {item_id} has out-of-bounds option count: {}",
                    options.len()
                ));
            }
            for opt in &options {
                let opt_str = opt
                    .as_str()
                    .ok_or_else(|| format!("Item {item_id} options must be string values"))?;
                if opt_str.trim().is_empty() || opt_str.chars().count() > 1_000 {
                    return Err(format!("Item {item_id} has invalid option length"));
                }
            }
            if *correct_index < 0 || *correct_index as usize >= options.len() {
                return Err(format!(
                    "Item {item_id} has out-of-bounds correct index: {correct_index}"
                ));
            }
        }
    }

    // 7. Validate responses choice flags, selected_index upper bounds, and is_correct
    let mut resp_stmt = connection
        .prepare(
            "SELECT r.id, r.selected_index, r.is_dont_know, r.is_correct, i.options_json, i.correct_index, r.answered_at
             FROM practice_responses r
             JOIN practice_test_items i ON r.item_id = i.id",
        )
        .map_err(|e| format!("Failed to prepare responses check: {e}"))?;
    let resp_rows = resp_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| format!("Failed to query responses: {e}"))?;

    for r_res in resp_rows {
        let (resp_id, sel_idx, is_dk, is_cor, options_json, item_correct_index, answered_at) =
            r_res.map_err(|e| format!("Failed to read response row: {e}"))?;

        if answered_at.trim().is_empty() {
            return Err(format!(
                "Response {resp_id} has empty answered_at timestamp"
            ));
        }

        if is_dk == 1 {
            if sel_idx.is_some() || is_cor != 0 {
                return Err(format!(
                    "Response {resp_id} with is_dont_know=1 must have NULL selected_index and is_correct=0"
                ));
            }
        } else {
            let idx = sel_idx.ok_or_else(|| {
                format!(
                    "Response {resp_id} with is_dont_know=0 must have a non-null selected_index"
                )
            })?;
            if idx < 0 {
                return Err(format!(
                    "Response {resp_id} has negative selected_index: {idx}"
                ));
            }
            let options: Vec<serde_json::Value> =
                serde_json::from_str(&options_json).map_err(|_| {
                    format!("Response {resp_id} references item with invalid options JSON")
                })?;
            if idx as usize >= options.len() {
                return Err(format!(
                    "Response {resp_id} has selected_index {idx} out of bounds for {} options",
                    options.len()
                ));
            }
            let expected_cor = if idx == item_correct_index { 1 } else { 0 };
            if is_cor != expected_cor {
                return Err(format!(
                    "Response {resp_id} has incorrect is_correct value (stored: {is_cor}, expected: {expected_cor})"
                ));
            }
        }
    }

    // 8. Completed and in-progress attempt derivations, status, timestamps, and scores
    let mut stmt = connection
        .prepare(
            "SELECT id, version_id, status, started_at, completed_at, revision, total_questions,
                    answered_count, correct_count, incorrect_count, dont_know_count, score_percent
             FROM practice_attempts",
        )
        .map_err(|e| format!("Failed to prepare attempts query: {e}"))?;

    let attempt_rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
                r.get::<_, i64>(10)?,
                r.get::<_, Option<f64>>(11)?,
            ))
        })
        .map_err(|e| format!("Failed to query attempts: {e}"))?;

    for row_res in attempt_rows {
        let (
            att_id,
            ver_id,
            status,
            started_at,
            completed_at,
            revision,
            stored_total,
            stored_ans,
            stored_cor,
            stored_inc,
            stored_dk,
            stored_pct,
        ) = row_res.map_err(|e| format!("Failed to read attempt row: {e}"))?;

        if started_at.trim().is_empty() {
            return Err(format!("Attempt {att_id} has empty started_at timestamp"));
        }
        if revision < 0 {
            return Err(format!(
                "Attempt {att_id} has negative revision: {revision}"
            ));
        }
        if stored_ans < 0 || stored_cor < 0 || stored_inc < 0 || stored_dk < 0 {
            return Err(format!("Attempt {att_id} has negative counts"));
        }

        let actual_total: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM practice_test_items WHERE version_id = ?1",
                [&ver_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to count items: {e}"))?;

        let actual_ans: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?1",
                [&att_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to count responses: {e}"))?;

        if stored_ans > stored_total {
            return Err(format!(
                "Attempt {att_id} answered_count exceeds total_questions"
            ));
        }

        match status.as_str() {
            "in_progress" => {
                if completed_at.is_some() {
                    return Err(format!(
                        "In-progress attempt {att_id} must have NULL completed_at"
                    ));
                }
                if stored_total != actual_total {
                    return Err(format!(
                        "In-progress attempt {att_id} total_questions ({stored_total}) does not match frozen version ({actual_total})"
                    ));
                }
                if stored_ans != actual_ans {
                    return Err(format!(
                        "In-progress attempt {att_id} answered_count ({stored_ans}) does not match response count ({actual_ans})"
                    ));
                }
            }
            "completed" => {
                let comp_at = completed_at.ok_or_else(|| {
                    format!("The backup contains completed practice attempt {att_id} with no completion timestamp.")
                })?;
                if comp_at.trim().is_empty() {
                    return Err(format!("Attempt {att_id} has empty completed_at timestamp"));
                }

                let stored_score = stored_pct.ok_or_else(|| {
                    format!("Completed practice attempt {att_id} has null score_percent")
                })?;

                if stored_total != actual_total {
                    return Err("The backup contains a completed attempt whose total questions does not match its frozen version.".to_string());
                }

                if stored_ans != actual_ans {
                    return Err("The backup contains a completed practice attempt whose answered count does not match stored responses.".to_string());
                }

                let derived_cor: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM practice_responses r
                         JOIN practice_test_items i ON r.item_id = i.id
                         WHERE r.attempt_id = ?1 AND r.is_dont_know = 0 AND r.selected_index = i.correct_index",
                        [&att_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| format!("Failed to derive correct count: {e}"))?;

                let actual_dk: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?1 AND is_dont_know = 1",
                        [&att_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| format!("Failed to count dont_know: {e}"))?;

                let derived_inc: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM practice_responses r
                         JOIN practice_test_items i ON r.item_id = i.id
                         WHERE r.attempt_id = ?1 AND r.is_dont_know = 0 AND r.selected_index != i.correct_index",
                        [&att_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| format!("Failed to derive incorrect count: {e}"))?;

                if stored_cor != derived_cor || stored_dk != actual_dk || stored_inc != derived_inc
                {
                    return Err("The backup contains completed practice attempt tallies that do not match stored responses.".to_string());
                }

                let expected_score = if actual_total > 0 {
                    ((derived_cor as f64 / actual_total as f64) * 1000.0).round() / 10.0
                } else {
                    0.0
                };

                // Exact match on the one-decimal grid (no 0.05 tolerance)
                if (stored_score - expected_score).abs() > 1e-6 {
                    return Err("The backup contains a completed practice attempt with inconsistent score percentage.".to_string());
                }
            }
            "abandoned" => {
                if completed_at.is_none() {
                    return Err(format!(
                        "Abandoned attempt {att_id} must have a completion timestamp"
                    ));
                }
                if stored_total != actual_total {
                    return Err(format!(
                        "Abandoned attempt {att_id} total_questions ({stored_total}) does not match frozen version ({actual_total})"
                    ));
                }
            }
            other => {
                return Err(format!("Attempt {att_id} has invalid status: {other}"));
            }
        }
    }

    // 9. Operations and receipts validation
    let mut op_stmt = connection
        .prepare(
            "SELECT operation_id, action, request_hash, applied_at, result_json, history_key, attempt_id, is_erased
             FROM practice_session_operations",
        )
        .map_err(|e| format!("Failed to prepare receipts query: {e}"))?;

    let op_rows = op_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })
        .map_err(|e| format!("Failed to query receipts: {e}"))?;

    for row_res in op_rows {
        let (op_id, action, req_hash, applied_at, result_json, hist_key, att_id, is_erased) =
            row_res.map_err(|e| format!("Failed to read receipt: {e}"))?;

        if !is_valid_uuid_v4(&op_id) {
            return Err(format!("Operation receipt {op_id} is not a valid UUIDv4"));
        }

        if req_hash.len() != 64 || !req_hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "Operation receipt {op_id} has invalid request hash format"
            ));
        }

        if applied_at.trim().is_empty() || !applied_at.contains('T') || applied_at.len() < 19 {
            return Err(format!(
                "Operation receipt {op_id} has invalid ISO applied_at timestamp: {applied_at}"
            ));
        }

        if hist_key.trim().is_empty() || att_id.trim().is_empty() {
            return Err(
                "The backup contains operation receipts with missing required fields.".to_string(),
            );
        }

        if ![
            "start_or_resume",
            "record_response",
            "complete_attempt",
            "abandon_attempt",
            "retake_attempt",
            "erase_history",
        ]
        .contains(&action.as_str())
        {
            return Err(format!(
                "The backup contains operation receipt with unknown action: {action}"
            ));
        }

        let parsed_result: serde_json::Value =
            serde_json::from_str(&result_json).map_err(|_| {
                format!("The backup contains malformed receipt JSON in operation {op_id}")
            })?;

        if is_erased == 1 {
            if result_json != "null" || !parsed_result.is_null() {
                return Err("The backup contains erased operation receipts that still retain result content.".to_string());
            }
        } else {
            if parsed_result.is_null() {
                return Err(format!(
                    "The backup contains non-erased operation receipt {op_id} with null result."
                ));
            }

            let obj = parsed_result
                .as_object()
                .ok_or_else(|| format!("Operation receipt {op_id} result must be a JSON object"))?;

            if obj.is_empty() {
                return Err(format!(
                    "The backup contains empty-object result in operation receipt {op_id}"
                ));
            }

            if action == "erase_history" {
                let h_key = obj
                    .get("historyKey")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        format!("Operation receipt {op_id} erase_history missing historyKey")
                    })?;
                if h_key != hist_key {
                    return Err(format!(
                        "Operation receipt {op_id} erase_history historyKey ({h_key}) does not match receipt history_key ({hist_key})"
                    ));
                }
                let erased_field = obj.get("erased").and_then(|v| v.as_bool());
                if erased_field != Some(true) {
                    return Err(format!(
                        "Operation receipt {op_id} erase_history missing erased boolean flag"
                    ));
                }
                for forbidden in [
                    "selectedIndex",
                    "responses",
                    "questions",
                    "scorePercent",
                    "correctIndex",
                    "isCorrect",
                ] {
                    if obj.contains_key(forbidden) {
                        return Err("The backup contains erased operation receipts that still retain result content.".to_string());
                    }
                }
            } else {
                let res_attempt_id =
                    obj.get("attemptId")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            format!("Operation receipt {op_id} result is missing attemptId")
                        })?;
                if res_attempt_id != att_id {
                    return Err(format!(
                        "Operation receipt {op_id} result attemptId ({res_attempt_id}) does not match receipt attempt_id ({att_id})"
                    ));
                }

                let res_rev = obj
                    .get("revision")
                    .or_else(|| obj.get("currentRevision"))
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| {
                        format!("Operation receipt {op_id} result is missing revision")
                    })?;
                if res_rev < 0 {
                    return Err(format!(
                        "Operation receipt {op_id} result has negative revision"
                    ));
                }

                match action.as_str() {
                    "start_or_resume" | "retake_attempt" => {
                        let v_id =
                            obj.get("versionId")
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    format!(
                                        "Operation receipt {op_id} start result missing versionId"
                                    )
                                })?;
                        if v_id.trim().is_empty() {
                            return Err(format!(
                                "Operation receipt {op_id} start result has empty versionId"
                            ));
                        }
                        let attempt_version_id: Option<String> = connection
                            .query_row(
                                "SELECT version_id FROM practice_attempts WHERE id = ?1",
                                [&att_id],
                                |r| r.get(0),
                            )
                            .ok();
                        if let Some(expected_ver) = attempt_version_id {
                            if v_id != expected_ver {
                                return Err(format!(
                                "Operation receipt {op_id} start result versionId ({v_id}) does not match attempt frozen version ({expected_ver})"
                            ));
                            }
                        }
                        let status =
                            obj.get("status").and_then(|v| v.as_str()).ok_or_else(|| {
                                format!("Operation receipt {op_id} start result missing status")
                            })?;
                        if status != "in_progress" {
                            return Err(format!(
                                "Operation receipt {op_id} start result status must be in_progress"
                            ));
                        }
                    }
                    "record_response" => {
                        let ans_at =
                            obj.get("answeredAt")
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    format!(
                                    "Operation receipt {op_id} response result missing answeredAt"
                                )
                                })?;
                        if ans_at.trim().is_empty() {
                            return Err(format!(
                                "Operation receipt {op_id} response result has empty answeredAt"
                            ));
                        }
                    }
                    "complete_attempt" => {
                        let status =
                            obj.get("status").and_then(|v| v.as_str()).ok_or_else(|| {
                                format!("Operation receipt {op_id} complete result missing status")
                            })?;
                        if status != "completed" {
                            return Err(format!(
                            "Operation receipt {op_id} complete result status must be completed"
                        ));
                        }
                        let comp_at =
                            obj.get("completedAt")
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    format!(
                                    "Operation receipt {op_id} complete result missing completedAt"
                                )
                                })?;
                        if comp_at.trim().is_empty() {
                            return Err(format!(
                                "Operation receipt {op_id} complete result has empty completedAt"
                            ));
                        }
                        if obj.get("scorePercent").and_then(|v| v.as_f64()).is_none() {
                            return Err(format!(
                                "Operation receipt {op_id} complete result missing scorePercent"
                            ));
                        }
                        if obj.get("correctCount").and_then(|v| v.as_i64()).is_none()
                            || obj.get("incorrectCount").and_then(|v| v.as_i64()).is_none()
                            || obj.get("dontKnowCount").and_then(|v| v.as_i64()).is_none()
                            || obj
                                .get("unansweredCount")
                                .and_then(|v| v.as_i64())
                                .is_none()
                        {
                            return Err(format!(
                                "Operation receipt {op_id} complete result missing tallies"
                            ));
                        }
                    }
                    "abandon_attempt" => {
                        let status =
                            obj.get("status").and_then(|v| v.as_str()).ok_or_else(|| {
                                format!("Operation receipt {op_id} abandon result missing status")
                            })?;
                        if status != "abandoned" {
                            return Err(format!(
                                "Operation receipt {op_id} abandon result status must be abandoned"
                            ));
                        }
                        let comp_at =
                            obj.get("completedAt")
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    format!(
                                    "Operation receipt {op_id} abandon result missing completedAt"
                                )
                                })?;
                        if comp_at.trim().is_empty() {
                            return Err(format!(
                                "Operation receipt {op_id} abandon result has empty completedAt"
                            ));
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // 10. Required triggers with exact registered migration contract comparison
    for trigger_name in [
        "trg_enforce_response_item_version_insert",
        "trg_enforce_response_item_version_update",
        "trg_cleanup_material_delete",
    ] {
        let actual_sql: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
                [trigger_name],
                |r| r.get(0),
            )
            .ok();
        let Some(sql) = actual_sql else {
            return Err(format!(
                "The backup is missing required trigger: {trigger_name}"
            ));
        };

        let ref_sql: String = ref_conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
                [trigger_name],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to read ref trigger {trigger_name}: {e}"))?;

        let norm_actual = normalize_sql(&sql);
        let norm_ref = normalize_sql(&ref_sql);
        if norm_actual != norm_ref {
            return Err(format!(
                "The backup trigger {trigger_name} does not match the registered migration contract."
            ));
        }

        if trigger_name.contains("enforce_response_item_version") {
            if !norm_actual.contains("raise(abort")
                || !norm_actual.contains("practice_attempts")
                || !norm_actual.contains("practice_test_items")
            {
                return Err(format!(
                    "Trigger {trigger_name} is missing required version enforcement logic."
                ));
            }
        } else if trigger_name == "trg_cleanup_material_delete"
            && (!norm_actual.contains("is_erased = 1")
                || !norm_actual.contains("delete from practice_attempts")
                || !norm_actual.contains("is_active = 0"))
        {
            return Err(format!(
                "Trigger {trigger_name} is missing required material deletion cleanup logic."
            ));
        }
    }

    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 12: card reviews (TS twin: `validateCardReviewState`)        */
/* ------------------------------------------------------------------ */

const CARD_TABLES: [&str; 6] = [
    "card_review_generations",
    "card_versions",
    "card_items",
    "card_review_state",
    "card_review_events",
    "card_review_operations",
];

fn card_count(
    connection: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<i64, String> {
    connection
        .query_row(sql, params, |r| r.get(0))
        .map_err(|e| format!("Could not check card reviews: {e}"))
}

fn card_timestamp(value: &str, owner: &str) -> Result<i64, String> {
    crate::card_reviews::parse_iso_ms(value)
        .ok_or_else(|| format!("{owner} has a malformed timestamp."))
}

fn card_json_object(
    text: &str,
    owner: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(map)) => Ok(map),
        Ok(_) => Err(format!("{owner} must be a JSON object.")),
        Err(_) => Err(format!("{owner} has malformed JSON.")),
    }
}

fn card_exact_keys(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
    owner: &str,
) -> Result<(), String> {
    if map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key)) {
        Ok(())
    } else {
        Err(format!("{owner} has unexpected fields."))
    }
}

/// A JSON value that JavaScript's `Number.isInteger` accepts, as an i64.
fn card_json_int(value: Option<&serde_json::Value>) -> Option<i64> {
    match value {
        Some(serde_json::Value::Number(n)) => n.as_i64().or_else(|| {
            n.as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15)
                .map(|f| f as i64)
        }),
        _ => None,
    }
}

fn card_json_str(value: Option<&serde_json::Value>) -> Option<&str> {
    match value {
        Some(serde_json::Value::String(s)) => Some(s),
        _ => None,
    }
}

/// A stored `simple-v1` schedule: exact fields, the step's delay from the review time.
fn card_check_schedule(
    map: &serde_json::Map<String, serde_json::Value>,
    owner: &str,
) -> Result<(), String> {
    card_exact_keys(
        map,
        &[
            "dueAt",
            "lapses",
            "lastReviewedAt",
            "reps",
            "schedulerVersion",
            "step",
        ],
        owner,
    )?;
    if card_json_str(map.get("schedulerVersion")) != Some(crate::card_reviews::SCHEDULER_VERSION) {
        return Err(format!("{owner} has an unknown scheduler version."));
    }
    let step = card_json_int(map.get("step"))
        .filter(|s| (-1..=7).contains(s))
        .ok_or_else(|| format!("{owner} has an invalid step."))?;
    let reps = card_json_int(map.get("reps"));
    let lapses = card_json_int(map.get("lapses"));
    if !matches!((reps, lapses), (Some(r), Some(l)) if r >= 1 && l >= 0) {
        return Err(format!("{owner} has invalid counts."));
    }
    let last = card_timestamp(
        card_json_str(map.get("lastReviewedAt")).unwrap_or(""),
        owner,
    )?;
    let due = card_timestamp(card_json_str(map.get("dueAt")).unwrap_or(""), owner)?;
    if Some(due - last) != crate::card_reviews::step_delay_ms(step) {
        return Err(format!(
            "{owner} has a due time inconsistent with its step."
        ));
    }
    Ok(())
}

fn card_index_sql(connection: &Connection, index: &str) -> Option<String> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
            [index],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
}

fn card_index_columns(connection: &Connection, index: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT name FROM pragma_index_info('{index}') ORDER BY seqno ASC"
        ))
        .map_err(|e| format!("Could not inspect index {index}: {e}"))?;
    let columns = statement
        .query_map([], |r| r.get(0))
        .map_err(|e| format!("Could not inspect index {index}: {e}"))?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| format!("Could not inspect index {index}: {e}"));
    columns
}

/// The schema-12 card-review contract, run by startup initialization and
/// archive inspection. Every rule matches `validateCardReviewState` in
/// `src/data/practiceStateValidation.ts`; the shared accept/refuse fixture is
/// `src-tauri/fixtures/card-validation/cases.json`.
pub(crate) fn verify_schema_12_card_semantics(connection: &Connection) -> Result<(), String> {
    use crate::card_reviews::{
        canonical_cards_json, is_lower_hex_64, is_valid_card_text, sha256_hex, step_delay_ms,
        CanonicalCard, FLAG_REASONS, ITEM_ACTIONS, MAX_BACK_CHARS, MAX_FRONT_CHARS,
        MAX_SOURCE_PAGE, SCHEDULER_VERSION,
    };
    let uuid_v4 =
        |value: &str| is_valid_uuid_v4(value) && !value.bytes().any(|b| b.is_ascii_uppercase());

    {
        let mut fk = connection
            .prepare("PRAGMA foreign_key_check")
            .map_err(|e| format!("Could not check foreign keys: {e}"))?;
        let mut rows = fk
            .query([])
            .map_err(|e| format!("Could not check foreign keys: {e}"))?;
        if rows
            .next()
            .map_err(|e| format!("Could not check foreign keys: {e}"))?
            .is_some()
        {
            return Err("The database violates foreign key constraints.".to_string());
        }
    }
    let reference = get_reference_schema_connection()?;

    // 1. Tables, columns, foreign keys and CHECK constraints against the reference.
    for table in CARD_TABLES {
        if card_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        let columns = |c: &Connection| -> Result<Vec<(String, String, i64, i64)>, String> {
            let mut statement = c
                .prepare(&format!(
                    "SELECT name, type, [notnull], pk FROM pragma_table_info('{table}') ORDER BY name"
                ))
                .map_err(|e| format!("Could not inspect {table}: {e}"))?;
            let rows = statement
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?.to_ascii_lowercase(),
                        r.get(2)?,
                        r.get(3)?,
                    ))
                })
                .map_err(|e| format!("Could not inspect {table}: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Could not inspect {table}: {e}"));
            rows
        };
        if columns(connection)? != columns(&reference)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
    }

    // 2. Uniqueness and indexes.
    for (table, expected) in [
        ("card_versions", ["source_material_id", "content_hash"]),
        ("card_items", ["version_id", "ordinal"]),
    ] {
        let mut statement = connection
            .prepare(&format!(
                "SELECT name, [unique], partial FROM pragma_index_list('{table}')"
            ))
            .map_err(|e| format!("Could not inspect indexes of {table}: {e}"))?;
        let indexes = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| format!("Could not inspect indexes of {table}: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not inspect indexes of {table}: {e}"))?;
        let mut found = false;
        for (name, unique, partial) in indexes {
            if unique == 1 && partial == 0 && card_index_columns(connection, &name)? == expected {
                found = true;
            }
        }
        if !found {
            return Err(format!(
                "Table {table} is missing compound UNIQUE constraint on ({}).",
                expected.join(", ")
            ));
        }
    }
    let active_unique: Option<i64> = connection
        .query_row(
            "SELECT [unique] FROM pragma_index_list('card_versions') WHERE name = 'uq_active_card_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    if active_unique != Some(1) {
        return Err(
            "The database is missing required unique index: uq_active_card_version".to_string(),
        );
    }
    for (table, index) in [
        ("card_versions", "uq_active_card_version"),
        ("card_review_state", "idx_card_state_due"),
        ("card_review_events", "idx_card_events_item"),
        ("card_review_operations", "idx_card_ops_material"),
    ] {
        if card_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_index_list('{table}') WHERE name = ?1"),
            &[&index],
        )? == 0
        {
            return Err(format!("The database is missing required index: {index}"));
        }
        match (
            card_index_sql(connection, index),
            card_index_sql(&reference, index),
        ) {
            (Some(mine), Some(theirs)) if normalize_sql(&mine) == normalize_sql(&theirs) => {}
            _ => {
                return Err(format!(
                    "Index {index} does not match the registered migration contract."
                ))
            }
        }
    }

    // 3. The deletion trigger.
    {
        let trigger = |c: &Connection| -> Option<String> {
            c.query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_card_ops_material_delete'",
                [],
                |r| r.get(0),
            )
            .ok()
        };
        let Some(mine) = trigger(connection) else {
            return Err(
                "The database is missing required trigger: trg_card_ops_material_delete"
                    .to_string(),
            );
        };
        if trigger(&reference).map(|s| normalize_sql(&s)) != Some(normalize_sql(&mine)) {
            return Err(
                "The trigger trg_card_ops_material_delete does not match the registered migration contract."
                    .to_string(),
            );
        }
    }

    // 4. Ownership.
    for (sql, problem) in [
        (
            "SELECT COUNT(*) FROM card_review_state s
             JOIN card_items i ON i.id = s.item_id JOIN card_versions v ON v.id = i.version_id
             WHERE s.source_material_id != v.source_material_id",
            "card review state owned by a material other than its card's",
        ),
        (
            "SELECT COUNT(*) FROM (SELECT source_material_id FROM card_versions WHERE is_active = 1
             GROUP BY source_material_id HAVING COUNT(*) > 1)",
            "more than one active card version for a material",
        ),
    ] {
        if card_count(connection, sql, &[])? > 0 {
            return Err(format!("The database contains {problem}."));
        }
    }

    // 5. Identity: every snapshot is recomputable from its stored text.
    type VersionRow = (String, String, String, i64, String, Option<String>);
    let versions: Vec<VersionRow> = {
        let mut statement = connection
            .prepare("SELECT id, source_material_id, content_hash, card_count, created_at, first_reviewed_at FROM card_versions")
            .map_err(|e| format!("Could not read card versions: {e}"))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })
            .map_err(|e| format!("Could not read card versions: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read card versions: {e}"))?;
        rows
    };
    // Schema 16 keeps who wrote each card beside its snapshot; a card's
    // origin is part of its hash, so it is read back for the recomputation.
    let has_origins = card_count(
        connection,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'card_item_origins'",
        &[],
    )? == 1;
    let item_sql = if has_origins {
        "SELECT i.id, i.ordinal, i.front, i.back, i.source_page, o.origin FROM card_items i
         LEFT JOIN card_item_origins o ON o.item_id = i.id
         WHERE i.version_id = ?1 ORDER BY i.ordinal ASC"
    } else {
        "SELECT id, ordinal, front, back, source_page, NULL FROM card_items WHERE version_id = ?1 ORDER BY ordinal ASC"
    };
    for (version_id, material_id, content_hash, card_count_value, created_at, first_reviewed_at) in
        versions
    {
        let owner = format!("Card version {version_id}");
        card_timestamp(&created_at, &owner)?;
        if let Some(first) = &first_reviewed_at {
            card_timestamp(first, &owner)?;
        }
        if sha256_hex(&format!("{material_id}\u{0}{content_hash}")) != version_id {
            return Err(format!(
                "{owner} cannot be recomputed from its material and content."
            ));
        }
        let mut statement = connection
            .prepare(item_sql)
            .map_err(|e| format!("Could not read cards: {e}"))?;
        let items = statement
            .query_map([&version_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(|e| format!("Could not read cards: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read cards: {e}"))?;
        if items.len() as i64 != card_count_value {
            return Err(format!("{owner} card_count does not match its cards."));
        }
        let mut cards = Vec::with_capacity(items.len());
        for (expected, (item_id, ordinal, front, back, source_page, origin)) in
            items.into_iter().enumerate()
        {
            if ordinal != expected as i64 {
                return Err(format!("Card {item_id} has a non-contiguous ordinal."));
            }
            if sha256_hex(&format!("{version_id}\u{0}{expected}")) != item_id {
                return Err(format!("Card {item_id} cannot be recomputed."));
            }
            if !is_valid_card_text(&front, MAX_FRONT_CHARS)
                || !is_valid_card_text(&back, MAX_BACK_CHARS)
            {
                return Err(format!("Card {item_id} has invalid text."));
            }
            if source_page.is_some_and(|p| !(1..=MAX_SOURCE_PAGE).contains(&p)) {
                return Err(format!("Card {item_id} has an out-of-bounds source page."));
            }
            cards.push(CanonicalCard {
                visual_region_id: crate::visual_cards::frozen_id(connection, &item_id)
                    .map_err(|_| "Damaged visual sidecar.")?,
                front,
                back,
                source_page,
                origin,
            });
        }
        if sha256_hex(&canonical_cards_json(&cards)) != content_hash {
            return Err(format!("{owner} content hash does not match its cards."));
        }
        if has_origins {
            let expected = crate::card_reviews::version_origin(
                &crate::card_reviews::card_version(&material_id, &cards).items,
            );
            let stored: Option<String> = connection
                .query_row(
                    "SELECT origin FROM card_version_origins WHERE version_id = ?1",
                    [&version_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| format!("Could not read card origins: {e}"))?;
            if stored.as_deref() != expected {
                return Err(format!("{owner} origin does not match its cards."));
            }
        }
    }

    // 6. Generations of existing materials (a missing row is generation 0).
    let generations: HashMap<String, i64> = {
        let mut statement = connection
            .prepare("SELECT source_material_id, generation FROM card_review_generations")
            .map_err(|e| format!("Could not read review generations: {e}"))?;
        let rows = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("Could not read review generations: {e}"))?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| format!("Could not read review generations: {e}"))?;
        rows
    };
    let generation_of = |material: &str| generations.get(material).copied().unwrap_or(0);

    // 7. Receipts: typed by action; tombstones keep routing metadata only.
    let mut live_rates: HashMap<String, String> = HashMap::new();
    type ReceiptRow = (
        String,
        String,
        String,
        i64,
        String,
        String,
        i64,
        Option<String>,
    );
    let receipts: Vec<ReceiptRow> = {
        let mut statement = connection
            .prepare("SELECT operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json FROM card_review_operations")
            .map_err(|e| format!("Could not read card receipts: {e}"))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })
            .map_err(|e| format!("Could not read card receipts: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read card receipts: {e}"))?;
        rows
    };
    for (
        operation_id,
        action,
        material_id,
        generation,
        request_hash,
        applied_at,
        is_erased,
        result_json,
    ) in receipts
    {
        let owner = format!("Card review receipt {operation_id}");
        if !uuid_v4(&operation_id) {
            return Err(format!("{owner} is not a valid UUIDv4."));
        }
        if !is_lower_hex_64(&request_hash) {
            return Err(format!("{owner} has an invalid request hash."));
        }
        card_timestamp(&applied_at, &owner)?;
        if crate::card_reviews::js_trim(&material_id).is_empty() {
            return Err(format!("{owner} has no material."));
        }
        if is_erased == 1 {
            if result_json.is_some() {
                return Err(format!("{owner} is erased but still holds a result."));
            }
            continue;
        }
        let Some(result_json) = result_json else {
            return Err(format!("{owner} is live but has no result."));
        };
        let result = card_json_object(&result_json, &owner)?;
        let current = generation_of(&material_id);
        if action == "reset" {
            card_exact_keys(&result, &["action", "generation", "materialId"], &owner)?;
            if card_json_str(result.get("action")) != Some("reset")
                || card_json_str(result.get("materialId")) != Some(material_id.as_str())
            {
                return Err(format!("{owner} result does not match its receipt."));
            }
            if card_json_int(result.get("generation")) != Some(generation + 1) {
                return Err(format!(
                    "{owner} result generation is not the captured generation plus one."
                ));
            }
            if generation + 1 != current {
                return Err(format!(
                    "{owner} is a live reset older than the current generation."
                ));
            }
            continue;
        }
        if !ITEM_ACTIONS.contains(&action.as_str()) {
            return Err(format!("{owner} has an unknown action."));
        }
        card_exact_keys(
            &result,
            &[
                "action",
                "dueAt",
                "flag",
                "generation",
                "itemId",
                "reviewedAt",
                "revision",
                "suspended",
            ],
            &owner,
        )?;
        if card_json_str(result.get("action")) != Some(action.as_str())
            || card_json_int(result.get("generation")) != Some(generation)
        {
            return Err(format!("{owner} result does not match its receipt."));
        }
        if generation > current {
            return Err(format!(
                "{owner} has a generation above its material's current generation."
            ));
        }
        if generation < current {
            return Err(format!(
                "{owner} is a live item receipt from before the latest reset."
            ));
        }
        let Some(item_id) = card_json_str(result.get("itemId")).filter(|id| is_lower_hex_64(id))
        else {
            return Err(format!("{owner} result names no card."));
        };
        if card_count(
            connection,
            "SELECT COUNT(*) FROM card_items i JOIN card_versions v ON v.id = i.version_id
             WHERE i.id = ?1 AND v.source_material_id = ?2",
            &[&item_id, &material_id],
        )? != 1
        {
            return Err(format!(
                "{owner} result names a card that is not this material's."
            ));
        }
        if !card_json_int(result.get("revision")).is_some_and(|r| r >= 1)
            || matches!(result.get("revision"), Some(serde_json::Value::Bool(_)))
        {
            return Err(format!("{owner} result has an invalid revision."));
        }
        let nullable_instant = |key: &str| -> Result<bool, String> {
            match result.get(key) {
                Some(serde_json::Value::Null) => Ok(false),
                Some(serde_json::Value::String(s)) => card_timestamp(s, &owner).map(|_| true),
                _ => Err(format!("{owner} has a malformed timestamp.")),
            }
        };
        let has_due = nullable_instant("dueAt")?;
        let has_review = nullable_instant("reviewedAt")?;
        if !matches!(result.get("suspended"), Some(serde_json::Value::Bool(_))) {
            return Err(format!("{owner} result has an invalid paused flag."));
        }
        match result.get("flag") {
            Some(serde_json::Value::Null) => {}
            Some(serde_json::Value::String(flag)) if FLAG_REASONS.contains(&flag.as_str()) => {}
            _ => return Err(format!("{owner} result has an invalid flag.")),
        }
        if action == "rate" {
            if !has_review || !has_due {
                return Err(format!("{owner} rating result has no review time."));
            }
            live_rates.insert(operation_id.clone(), item_id.to_string());
        } else if has_review {
            return Err(format!("{owner} non-rating result has a review time."));
        }
    }

    // 8. Events: immutable ratings of the current generation, each with its receipt.
    let mut events_by_item: HashMap<String, Vec<serde_json::Map<String, serde_json::Value>>> =
        HashMap::new();
    type EventRow = (String, String, i64, String, String, String, String, String);
    let events: Vec<EventRow> = {
        let mut statement = connection
            .prepare(
                "SELECT e.id, e.item_id, e.generation, e.reviewed_at, e.scheduler_version, e.prior_state_json, e.next_state_json, v.source_material_id
                 FROM card_review_events e JOIN card_items i ON i.id = e.item_id JOIN card_versions v ON v.id = i.version_id",
            )
            .map_err(|e| format!("Could not read rating events: {e}"))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })
            .map_err(|e| format!("Could not read rating events: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read rating events: {e}"))?;
        rows
    };
    for (
        id,
        item_id,
        generation,
        reviewed_at,
        scheduler_version,
        prior_json,
        next_json,
        material_id,
    ) in events
    {
        let owner = format!("Card review event {id}");
        if !uuid_v4(&id) {
            return Err(format!("{owner} is not a valid UUIDv4."));
        }
        let current = generation_of(&material_id);
        if generation > current {
            return Err(format!(
                "{owner} has a generation above its material's current generation."
            ));
        }
        if generation < current {
            return Err(format!("{owner} is from before the latest reset."));
        }
        if live_rates.get(&id) != Some(&item_id) {
            return Err(format!("{owner} has no matching live rating receipt."));
        }
        if scheduler_version != SCHEDULER_VERSION {
            return Err(format!("{owner} has an unknown scheduler version."));
        }
        card_timestamp(&reviewed_at, &owner)?;
        let next = card_json_object(&next_json, &owner)?;
        card_check_schedule(&next, &owner)?;
        if card_json_str(next.get("lastReviewedAt")) != Some(reviewed_at.as_str()) {
            return Err(format!(
                "{owner} next state does not match its review time."
            ));
        }
        if prior_json != "null" {
            card_check_schedule(&card_json_object(&prior_json, &owner)?, &owner)?;
        }
        events_by_item.entry(item_id).or_default().push(next);
    }

    // 9. Projection against its events.
    type StateRow = (
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
        i64,
        i64,
        i64,
    );
    let states: Vec<StateRow> = {
        let mut statement = connection
            .prepare("SELECT item_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, revision FROM card_review_state")
            .map_err(|e| format!("Could not read review state: {e}"))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })
            .map_err(|e| format!("Could not read review state: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read review state: {e}"))?;
        rows
    };
    let mut with_state: HashSet<String> = HashSet::new();
    for (item_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, revision) in
        states
    {
        let owner = format!("Card review state {item_id}");
        if scheduler_version != SCHEDULER_VERSION {
            return Err(format!("{owner} has an unknown scheduler version."));
        }
        let events = events_by_item
            .get(&item_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        with_state.insert(item_id.clone());
        let (Some(due_at), Some(last_reviewed_at)) = (due_at.as_ref(), last_reviewed_at.as_ref())
        else {
            if !events.is_empty() {
                return Err(format!("{owner} is never rated but has rating events."));
            }
            if due_at.is_some() != last_reviewed_at.is_some() {
                return Err(format!("{owner} has a due time without a review time."));
            }
            continue;
        };
        let due_ms = card_timestamp(due_at, &owner)?;
        let last_ms = card_timestamp(last_reviewed_at, &owner)?;
        if Some(due_ms - last_ms) != step_delay_ms(step) {
            return Err(format!(
                "{owner} has a due time inconsistent with its step."
            ));
        }
        if events.len() as i64 != reps {
            return Err(format!("{owner} reps does not match its rating events."));
        }
        if revision < events.len() as i64 {
            return Err(format!("{owner} revision is below its rating count."));
        }
        let mut reps_seen: Vec<i64> = events
            .iter()
            .filter_map(|n| card_json_int(n.get("reps")))
            .collect();
        reps_seen.sort_unstable();
        if reps_seen.len() != events.len()
            || reps_seen
                .iter()
                .enumerate()
                .any(|(i, r)| *r != i as i64 + 1)
        {
            return Err(format!("{owner} rating events do not form one history."));
        }
        let Some(latest) = events
            .iter()
            .find(|n| card_json_int(n.get("reps")) == Some(reps))
        else {
            return Err(format!("{owner} does not match its latest rating event."));
        };
        if card_json_int(latest.get("step")) != Some(step)
            || card_json_str(latest.get("dueAt")) != Some(due_at.as_str())
            || card_json_str(latest.get("lastReviewedAt")) != Some(last_reviewed_at.as_str())
            || card_json_int(latest.get("lapses")) != Some(lapses)
        {
            return Err(format!("{owner} does not match its latest rating event."));
        }
    }
    for item_id in events_by_item.keys() {
        if !with_state.contains(item_id) {
            return Err(format!(
                "Card {item_id} has rating events but no review state."
            ));
        }
    }
    Ok(())
}

/// Whether a failure looks like transient SQLite lock contention rather than
/// a real problem with the database.
pub(crate) fn is_transient_lock_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("database is locked") || lower.contains("sqlite_busy")
}

/// Take a database snapshot, retrying a bounded number of times if the
/// reason it failed was another connection briefly holding a lock.
///
/// Each attempt is independent and cleans up its own partial file on
/// failure (see `database_snapshot`), so retrying is just trying again —
/// nothing from a failed attempt is reused or left behind.
fn database_snapshot_with_retry(root: &Path) -> Result<PathBuf, String> {
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

fn database_snapshot(root: &Path) -> Result<PathBuf, String> {
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

fn add_documents_to_archive<W: Write + Seek>(
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

fn allowed_archive_path(path: &Path, is_dir: bool) -> bool {
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

fn sha256_file_from_reader(reader: &mut impl Read) -> Result<(u64, String, Vec<u8>), String> {
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

fn safe_relative_document_path(relative_path: &str) -> Result<&str, String> {
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

fn scan_active_documents_recursive(
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

pub(crate) fn scan_staged_deletion_paths(trash_dir: &Path) -> Result<HashSet<String>, String> {
    let mut staged = HashSet::new();
    let entries = match std::fs::read_dir(trash_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(staged),
        Err(e) => return Err(format!("Could not read trash directory: {e}")),
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not read trash directory entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("meta") {
            let meta_json = std::fs::read_to_string(&path)
                .map_err(|e| format!("Could not read staged deletion metadata in trash: {e}"))?;
            let meta: crate::documents::StagedDeletion = serde_json::from_str(&meta_json)
                .map_err(|e| format!("Could not parse staged deletion metadata in trash: {e}"))?;
            crate::documents::validate_staged_id(&meta.staged_id)
                .map_err(|e| format!("Invalid staged deletion id in trash: {e}"))?;
            let normalized = meta.original_relative_path.replace('\\', "/");
            let safe_rel = crate::documents::safe_relative_path(&normalized).map_err(|e| {
                format!("Invalid original relative path in staged deletion metadata: {e}")
            })?;
            staged.insert(safe_rel.to_string());
        }
    }

    Ok(staged)
}

/// Documents to be archived whose FAA reference copy or picture-card details
/// no longer match their bytes on disk. A 0.6.1/0.6.2 file swap left these;
/// declaring them keeps every later backup possible while a restore still
/// refuses any other mismatch as damage.
fn detached_documents(
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

fn verify_archive_database_and_documents<R: Read + Seek>(
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
fn read_manifest_from(archive: &mut ZipArchive<File>) -> Result<CompleteBackupManifest, String> {
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
fn archive_device_id(source: &Path) -> Result<Option<String>, String> {
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

#[cfg(windows)]
pub(crate) fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
}

#[cfg(not(windows))]
pub(crate) fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

fn inspect_storage_root(dir: &Path, name: &str) -> Result<Option<std::fs::Metadata>, String> {
    match std::fs::symlink_metadata(dir) {
        Ok(meta) => {
            if is_symlink_or_reparse(&meta) {
                return Err(format!("{name} is an unsafe symlink or reparse point"));
            }
            if !meta.is_dir() {
                return Err(format!("{name} is not a directory"));
            }
            Ok(Some(meta))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not inspect {name}: {e}")),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArtifactIdentity {
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FaultOccurrence {
    Always,
    OnOccurrence(usize),
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FaultConfig {
    pub fault: InjectedFault,
    pub occurrence: FaultOccurrence,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InjectedFault {
    JournalTempCreate,
    JournalWrite,
    JournalSync,
    JournalRename,
    JournalDelete,
    JournalRead,
    PlanRead,
    InventoryReadDir,
    ProtectDbRename(usize),
    ProtectDocsRename,
    InstallDbRename(usize),
    InstallDocsRename,
    ReturnDbRename(usize),
    ReturnDocsRename,
    ReturnDocsMetadata,
    RootReadDir,
    BackupsReadDir,
    PendingEntryRead,
}

#[cfg(test)]
std::thread_local! {
    static ACTIVE_FAULT: std::cell::RefCell<Option<FaultConfig>> = const { std::cell::RefCell::new(None) };
    static FAULT_HITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static FAULT_FIRED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static OBSERVED_FAULT_CALLS: std::cell::RefCell<Vec<InjectedFault>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(crate) struct ScopedFault {
    prev_config: Option<FaultConfig>,
}

#[cfg(test)]
impl ScopedFault {
    pub fn set(fault: InjectedFault) -> Self {
        Self::set_config(FaultConfig {
            fault,
            occurrence: FaultOccurrence::Always,
        })
    }

    pub fn set_occurrence(fault: InjectedFault, occurrence: usize) -> Self {
        Self::set_config(FaultConfig {
            fault,
            occurrence: FaultOccurrence::OnOccurrence(occurrence),
        })
    }

    pub fn set_config(config: FaultConfig) -> Self {
        FAULT_HITS.with(|h| h.set(0));
        FAULT_FIRED.with(|f| f.set(0));
        OBSERVED_FAULT_CALLS.with(|c| c.borrow_mut().clear());
        let prev = ACTIVE_FAULT.with(|f| f.replace(Some(config)));
        ScopedFault { prev_config: prev }
    }

    pub fn hits() -> usize {
        FAULT_HITS.with(|h| h.get())
    }

    pub fn fired_count() -> usize {
        FAULT_FIRED.with(|f| f.get())
    }

    #[allow(dead_code)]
    pub fn observed_calls() -> Vec<InjectedFault> {
        OBSERVED_FAULT_CALLS.with(|c| c.borrow().clone())
    }
}

#[cfg(test)]
impl Drop for ScopedFault {
    fn drop(&mut self) {
        ACTIVE_FAULT.with(|f| *f.borrow_mut() = self.prev_config);
    }
}

#[cfg(test)]
fn check_injected_fault(fault: InjectedFault) -> Result<(), std::io::Error> {
    OBSERVED_FAULT_CALLS.with(|c| c.borrow_mut().push(fault));
    let mut should_trigger = false;
    ACTIVE_FAULT.with(|cfg_cell| {
        if let Some(cfg) = *cfg_cell.borrow() {
            if cfg.fault == fault {
                let current_hit = FAULT_HITS.with(|h| {
                    let v = h.get() + 1;
                    h.set(v);
                    v
                });
                match cfg.occurrence {
                    FaultOccurrence::Always => should_trigger = true,
                    FaultOccurrence::OnOccurrence(target) => {
                        if current_hit == target {
                            should_trigger = true;
                        }
                    }
                }
            }
        }
    });

    if should_trigger {
        FAULT_FIRED.with(|f| f.set(f.get() + 1));
        Err(std::io::Error::other(format!(
            "Injected test fault: {fault:?}"
        )))
    } else {
        Ok(())
    }
}

fn inventory_directory_artifacts(dir: &Path) -> Result<Vec<ArtifactIdentity>, String> {
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

fn validate_artifact_identity(art: &ArtifactIdentity) -> Result<(), String> {
    if art.sha256.len() != 64 || !art.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "Invalid SHA-256 digest '{}' for artifact '{}'",
            art.sha256, art.name
        ));
    }
    Ok(())
}

fn validate_relative_document_path(name: &str) -> Result<(), String> {
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

fn write_journal(root: &Path, journal: &RestoreJournal) -> Result<(), String> {
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

fn read_journal(root: &Path) -> Result<Option<RestoreJournal>, String> {
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

fn remove_journal(root: &Path) -> Result<(), String> {
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

fn find_unresolved_recovery_evidence(
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

fn is_protected_recovery_folder(root: &Path, folder: &Path) -> bool {
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

/// Remove the oldest automatic backups, keeping the most recent ones.
fn prune(root: &Path) -> Result<(), String> {
    let dir = backup_dir(root)?;
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read the backup directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter(|path| !is_protected_recovery_folder(root, path))
        .collect();

    // Names are timestamp-prefixed, so sorting by name sorts by age.
    entries.sort();
    if entries.len() <= KEEP_BACKUPS {
        return Ok(());
    }

    for old in &entries[..entries.len() - KEEP_BACKUPS] {
        let _ = std::fs::remove_dir_all(old);
    }
    Ok(())
}

/// Back up the database if this is the first run of a new version.
///
/// Called from setup, before the frontend opens the database, so the copy is
/// of the data exactly as the previous version left it — before any migration
/// has had a chance to touch it.
pub fn backup_if_upgraded(app: &AppHandle) -> Result<(), String> {
    backup_if_upgraded_in(&app_root(app)?, &app.package_info().version.to_string())
}

/// The version-change check itself, against a plain directory so it can be tested.
pub(crate) fn backup_if_upgraded_in(root: &Path, current: &str) -> Result<(), String> {
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not create the application data directory: {e}"))?;

    let marker = root.join(VERSION_FILE);
    let previous = std::fs::read_to_string(&marker).unwrap_or_default();
    let previous = previous.trim();

    if previous == current {
        return Ok(());
    }

    // Take a copy whenever a database written by some other version is about
    // to be opened — including when the marker file is missing, which is
    // exactly the case where we know least about what wrote it. `copy_database`
    // does nothing on a genuine first run, when there is no database yet.
    if let Err(error) = copy_database(root, &format!("before-{current}")) {
        crate::safety_notices::record_upgrade_failure(root);
        return Err(error);
    }
    crate::safety_notices::clear_upgrade_failure(root);
    prune(root)?;

    std::fs::write(&marker, current)
        .map_err(|e| format!("Could not record the application version: {e}"))?;
    Ok(())
}

/* ------------------------------ commands ------------------------------- */

/// Make a copy right now, on request.
#[tauri::command]
pub async fn create_backup(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || create_consistent_local_backup(&app_root(&app)?))
        .await
        .map_err(|error| format!("Could not finish saving the safety copy: {error}"))?
}

/// Manual safety copies run while the app is open. Use SQLite's online backup
/// API so a concurrent WAL write cannot leave an inconsistent raw file pair.
fn create_consistent_local_backup(root: &Path) -> Result<String, String> {
    let snapshot = database_snapshot_with_retry(root)?;
    let destination = unique_backup_path(&backup_dir(root)?, "manual");
    if let Err(error) = std::fs::create_dir(&destination) {
        let _ = std::fs::remove_file(&snapshot);
        return Err(format!("Could not create the backup folder: {error}"));
    }
    let final_path = destination.join(DB_FILES[0]);
    if let Err(error) = std::fs::rename(&snapshot, &final_path) {
        let _ = std::fs::remove_file(&snapshot);
        let _ = std::fs::remove_dir(&destination);
        return Err(format!("Could not save the database backup: {error}"));
    }
    crate::safety_notices::clear_upgrade_failure(root);
    Ok(destination.to_string_lossy().to_string())
}

/// Export one portable file containing the database and every imported document.
#[tauri::command]
pub async fn create_complete_backup(
    app: AppHandle,
    destination_path: String,
) -> Result<CompleteBackupInfo, String> {
    crate::picked_paths::require_picked(&app, &destination_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::library_lock::with_library_lock(
            &root,
            crate::library_lock::owned(&app),
            crate::study_pack::reconcile::Mode::Normal,
            |_| {
                create_consistent_complete_backup_with_retry(
                    &root,
                    Path::new(&destination_path),
                    &app.package_info().version.to_string(),
                )
            },
        )
    })
    .await
    .map_err(|error| format!("Could not finish saving the backup: {error}"))?
}

const COMPLETE_BACKUP_RETRIES: u32 = 3;

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

fn write_complete_backup_from_database(
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
fn write_complete_backup_from_database_with_hook(
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

#[tauri::command]
pub async fn inspect_complete_backup(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::picked_paths::require_picked_or_inside(&app, &root, &source_path)?;
        inspect_archive(
            &root,
            Path::new(&source_path),
            &app.package_info().version.to_string(),
        )
    })
    .await
    .map_err(|error| format!("Could not finish reading that backup: {error}"))?
}

/// The version running right now, for the interface to reason about backups.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Clear anything left over and hand back an empty staging directory.
fn fresh_staging(root: &Path) -> Result<(PathBuf, PathBuf), String> {
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
fn write_restore_plan(staging: &Path, kind: RestoreKind, source: &str) -> Result<(), String> {
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
fn read_restore_plan(pending: &Path) -> RestorePlan {
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
fn read_restore_plan_for_ownership(pending: &Path) -> Result<Option<RestorePlan>, String> {
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

fn verify_pending_contents_against_staged_manifest(
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

const INCOMING_DIR: &str = ".incoming";

pub(crate) fn picked_backup_path(source: &str) -> Result<PathBuf, String> {
    let Some(source) = source.strip_prefix("file://") else {
        return Ok(PathBuf::from(source));
    };
    let mut decoded = Vec::new();
    let mut bytes = source.as_bytes().iter().copied();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let hi = bytes.next().and_then(|b| (b as char).to_digit(16));
            let lo = bytes.next().and_then(|b| (b as char).to_digit(16));
            match (hi, lo) {
                (Some(hi), Some(lo)) => decoded.push((hi * 16 + lo) as u8),
                _ => return Err("That backup path could not be read.".into()),
            }
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded)
        .map(PathBuf::from)
        .map_err(|_| "That backup path could not be read.".into())
}

pub(crate) fn copy_incoming_backup(root: &Path, source: &str) -> Result<PathBuf, String> {
    let source = picked_backup_path(source)?;
    let metadata = std::fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if !metadata.is_file() || is_symlink_or_reparse(&metadata) {
        return Err("Choose a regular backup file.".into());
    }
    if metadata.len() > MAX_RESTORE_BYTES {
        return Err("That backup is too large to restore.".into());
    }
    let dir = root.join(INCOMING_DIR);
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if !meta.is_dir() || is_symlink_or_reparse(&meta) => {
            return Err("The incoming backup folder is unavailable.".into());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
        }
        Err(e) => return Err(e.to_string()),
    }
    let temporary = dir.join("latest.hfdbackup.tmp");
    let destination = dir.join("latest.hfdbackup");
    match std::fs::remove_file(&temporary) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let input = File::open(source).map_err(|e| e.to_string())?;
        if std::io::copy(&mut input.take(MAX_RESTORE_BYTES + 1), &mut output)
            .map_err(|e| e.to_string())?
            > MAX_RESTORE_BYTES
        {
            return Err("That backup is too large to restore.".into());
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        #[cfg(windows)]
        if destination.exists() {
            std::fs::remove_file(&destination).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
        Ok(destination)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

pub(crate) fn required_restore_bytes(bytes: u64) -> u64 {
    bytes.saturating_mul(3)
}

#[cfg(unix)]
pub(crate) fn free_space_bytes(path: &Path) -> Result<Option<u64>, String> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: path is NUL-terminated and stats points to writable storage.
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return Err(format!(
            "Could not check free space: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: statvfs returned success and initialized stats.
    let stats = unsafe { stats.assume_init() };
    // libc field widths differ between Unix targets.
    #[allow(clippy::unnecessary_cast)]
    let available = (stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64);
    Ok(Some(available))
}

#[cfg(not(unix))]
pub(crate) fn free_space_bytes(_path: &Path) -> Result<Option<u64>, String> {
    Ok(None)
}

fn restore_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn import_picked_backup_in(
    root: &Path,
    source: &str,
    version: &str,
    available: fn(&Path) -> Result<Option<u64>, String>,
) -> Result<CompleteBackupInfo, String> {
    let copy = copy_incoming_backup(root, source)?;
    let result = (|| {
        let need =
            required_restore_bytes(std::fs::metadata(&copy).map_err(|e| e.to_string())?.len());
        if let Some(have) = available(root)? {
            if have < need {
                return Err(format!("This phone needs about {} free to restore this backup, but only {} is free. Free up some space and try again.", restore_size(need), restore_size(have)));
            }
        }
        inspect_archive(root, &copy, version)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(copy);
    }
    result
}

#[tauri::command]
pub async fn import_picked_backup(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    let root = app_root(&app)?;
    crate::picked_paths::require_picked(&app, &source_path)?;
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        import_picked_backup_in(&root, &source_path, &version, free_space_bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn discard_incoming_backup(app: AppHandle) -> Result<(), String> {
    let dir = app_root(&app)?.join(INCOMING_DIR);
    if inspect_storage_root(&dir, "Incoming backup folder")?.is_some() {
        for name in ["latest.hfdbackup", "latest.hfdbackup.tmp"] {
            match std::fs::remove_file(dir.join(name)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn exit_for_restore(app: AppHandle) -> Result<(), String> {
    // iOS cannot exit tao's event loop; the user closes the app after staging.
    #[cfg(not(target_os = "ios"))]
    app.exit(0);
    #[cfg(target_os = "ios")]
    let _ = app;
    Ok(())
}

fn reset_sync_identity_best_effort(root: &Path) {
    // Non-critical: the restore already succeeded; a failure only keeps the old id.
    if let Err(e) = reset_sync_identity(root) {
        log::warn!("Restore: could not reset the sync identity: {e}");
    }
}

/// Everything now on the phone came from the Mac, so note that moment. A failure
/// here must never make a restore that succeeded report failure.
fn record_phone_baseline_best_effort(root: &Path) {
    let now = crate::phone_work::now_utc();
    if let Err(e) = now.and_then(|now| crate::phone_work::record_baseline_in(root, &now)) {
        log::warn!("Restore: could not record the phone baseline: {e}");
    }
}

pub(crate) fn reset_sync_identity(root: &Path) -> Result<(), String> {
    let mut connection =
        Connection::open_with_flags(root.join(DB_FILES[0]), OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| e.to_string())?;
    connection
        .busy_timeout(BUSY_TIMEOUT)
        .map_err(|e| e.to_string())?;
    // One transaction: a failed save can never leave the restored phone with
    // the Mac's id, and the copy's source is stored before the id is dropped.
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    // The restored copy's own id is the Mac it came from: later changes files
    // are accepted only from that Mac.
    match tx.query_row(
        "SELECT CAST(value AS TEXT) FROM app_metadata WHERE key = 'device_id'",
        [],
        |r| r.get::<_, Option<String>>(0),
    ) {
        Ok(Some(id)) if crate::sync::changeset::valid_device_id(&id) => {
            tx.execute(
                "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sync_copy_from_device', ?1)",
                [id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => {
            tx.execute(
                "DELETE FROM app_metadata WHERE key = 'sync_copy_from_device'",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        Err(e) if e.to_string().contains("no such table: app_metadata") => return Ok(()),
        Err(e) => return Err(e.to_string()),
    }
    tx.execute("DELETE FROM app_metadata WHERE key = 'device_id'", [])
        .map_err(|e| e.to_string())?;
    // Whatever the change log holds now came with the restored copy, not from
    // this device: later exports start after it.
    let floor: i64 =
        match tx.query_row("SELECT COALESCE(MAX(seq), 0) FROM local_changes", [], |r| {
            r.get(0)
        }) {
            Ok(n) => n,
            Err(e) if e.to_string().contains("no such table: local_changes") => 0,
            Err(e) => return Err(e.to_string()),
        };
    tx.execute(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('sync_floor_seq', ?1)",
        [floor.to_string()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM app_metadata WHERE key = 'exported_through_seq'",
        [],
    )
    .map_err(|e| e.to_string())?;
    // The restore sets a new copy source and baseline: the restart keys are stale.
    tx.execute(
        "DELETE FROM app_metadata WHERE key IN ('sync_stream_restarted', 'sync_copy_superseded')",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn remove_pending_directory_safely(pending: &Path) -> Result<(), std::io::Error> {
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

fn verify_pending_cleanup_permission(
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

/// Validate and extract into a private staging directory. Current data is untouched.
#[tauri::command]
pub async fn stage_complete_restore(
    app: AppHandle,
    source_path: String,
) -> Result<CompleteBackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::picked_paths::require_picked_or_inside(&app, &root, &source_path)?;
        // An interrupted study pack is quarantined first, so a restore can
        // never stage next to a half-installed one (design section 1).
        crate::library_lock::with_library_lock(
            &root,
            crate::library_lock::owned(&app),
            crate::study_pack::reconcile::Mode::Restore,
            |_| {
                stage_complete_restore_guarded_in(
                    &root,
                    Path::new(&source_path),
                    &app.package_info().version.to_string(),
                    cfg!(target_os = "ios"),
                )
            },
        )
    })
    .await
    .map_err(|error| format!("Could not finish restoring that backup: {error}"))?
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

/// Stage a complete restore of an empty app so the next startup starts fresh.
#[tauri::command]
pub async fn stage_start_fresh(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::library_lock::with_library_lock(
            &root,
            crate::library_lock::owned(&app),
            crate::study_pack::reconcile::Mode::Restore,
            |_| stage_start_fresh_in(&root),
        )
    })
    .await
    .map_err(|error| format!("Could not finish preparing to start fresh: {error}"))?
}

/// Stage an empty SQLite database with a Complete restore plan, against a plain directory.
pub(crate) fn stage_start_fresh_in(root: &Path) -> Result<(), String> {
    let (staging, pending) = fresh_staging(root)?;

    let result = (|| {
        let db_path = staging.join(DB_FILES[0]);
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Could not create empty database: {e}"))?;
        conn.execute_batch("VACUUM;")
            .map_err(|e| format!("Could not initialize empty database: {e}"))?;
        drop(conn);
        verify_sqlite_file(&db_path)?;
        write_restore_plan(&staging, RestoreKind::Complete, "start-fresh")?;
        std::fs::rename(&staging, &pending)
            .map_err(|e| format!("Could not stage the restore: {e}"))?;
        Ok::<(), String>(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

/// Remove everything stored inside `backups/` after a committed start-fresh install.
///
/// Safety copies are kept inside application data, so their removal stays strictly
/// inside `backups/` without following symlinks.
fn delete_backups_contents(root: &Path) -> Result<(), String> {
    let backups_dir = root.join(BACKUP_DIR);
    match inspect_storage_root(&backups_dir, "Backups directory")? {
        Some(_) => {}
        None => return Ok(()),
    }

    let entries = std::fs::read_dir(&backups_dir)
        .map_err(|e| format!("Could not read backups directory for start-fresh cleanup: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not inspect backup entry: {e}"))?;
        let path = entry.path();
        if !path.starts_with(&backups_dir) {
            return Err("Backup path climbs outside backups directory".into());
        }
        let meta = std::fs::symlink_metadata(&path).map_err(|e| {
            format!(
                "Could not read metadata for backup entry {:?}: {e}",
                entry.file_name()
            )
        })?;
        if is_symlink_or_reparse(&meta) {
            return Err(format!(
                "Backup entry {:?} is an unsafe symlink or reparse point",
                entry.file_name()
            ));
        }
        if meta.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| {
                format!(
                    "Could not remove backup folder {:?}: {e}",
                    entry.file_name()
                )
            })?;
        } else {
            std::fs::remove_file(&path).map_err(|e| {
                format!("Could not remove backup file {:?}: {e}", entry.file_name())
            })?;
        }
    }
    Ok(())
}

/// Remove everything stored inside `.incoming/` after a committed start-fresh install.
fn delete_incoming_contents(root: &Path) -> Result<(), String> {
    let incoming_dir = root.join(INCOMING_DIR);
    match inspect_storage_root(&incoming_dir, "Incoming directory")? {
        Some(_) => {}
        None => return Ok(()),
    }

    let entries = std::fs::read_dir(&incoming_dir)
        .map_err(|e| format!("Could not read incoming directory for start-fresh cleanup: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not inspect incoming entry: {e}"))?;
        let path = entry.path();
        if !path.starts_with(&incoming_dir) {
            return Err("Incoming path climbs outside incoming directory".into());
        }
        let meta = std::fs::symlink_metadata(&path).map_err(|e| {
            format!(
                "Could not read metadata for incoming entry {:?}: {e}",
                entry.file_name()
            )
        })?;
        if is_symlink_or_reparse(&meta) {
            return Err(format!(
                "Incoming entry {:?} is an unsafe symlink or reparse point",
                entry.file_name()
            ));
        }
        if meta.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| {
                format!(
                    "Could not remove incoming folder {:?}: {e}",
                    entry.file_name()
                )
            })?;
        } else {
            std::fs::remove_file(&path).map_err(|e| {
                format!(
                    "Could not remove incoming file {:?}: {e}",
                    entry.file_name()
                )
            })?;
        }
    }
    Ok(())
}

/// Remove the phone outbox folder and all its contents after a committed start-fresh install.
fn delete_phone_outbox(root: &Path) -> Result<(), String> {
    let outbox_dir = root.join(crate::sync::send::OUTBOX_DIR);
    match inspect_storage_root(&outbox_dir, "Phone outbox directory")? {
        Some(_) => {}
        None => return Ok(()),
    }

    let entries = std::fs::read_dir(&outbox_dir)
        .map_err(|e| format!("Could not read outbox directory for start-fresh cleanup: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Could not inspect outbox entry: {e}"))?;
        let path = entry.path();
        if !path.starts_with(&outbox_dir) {
            return Err("Outbox path climbs outside outbox directory".into());
        }
        let meta = std::fs::symlink_metadata(&path).map_err(|e| {
            format!(
                "Could not read metadata for outbox entry {:?}: {e}",
                entry.file_name()
            )
        })?;
        if is_symlink_or_reparse(&meta) {
            return Err(format!(
                "Outbox entry {:?} is an unsafe symlink or reparse point",
                entry.file_name()
            ));
        }
        if meta.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| {
                format!(
                    "Could not remove outbox folder {:?}: {e}",
                    entry.file_name()
                )
            })?;
        } else {
            std::fs::remove_file(&path).map_err(|e| {
                format!("Could not remove outbox file {:?}: {e}", entry.file_name())
            })?;
        }
    }
    std::fs::remove_dir(&outbox_dir)
        .map_err(|e| format!("Could not remove phone outbox directory: {e}"))?;
    Ok(())
}

/// Remove the phone baseline file (`phone-work.json`) after a committed start-fresh install.
fn delete_phone_work_file(root: &Path) -> Result<(), String> {
    let path = root.join(crate::phone_work::PHONE_WORK_FILE);
    if !path.starts_with(root) {
        return Err("Phone work file path climbs outside root".into());
    }
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("Could not inspect phone work file: {e}")),
    };
    if is_symlink_or_reparse(&meta) {
        return Err("Phone work file is an unsafe symlink or reparse point".into());
    }
    if meta.is_dir() {
        return Err("Phone work file path is unexpectedly a directory".into());
    }
    std::fs::remove_file(&path).map_err(|e| format!("Could not remove phone work file: {e}"))
}

/// Remove leftover state from a previous library after a committed start-fresh install:
/// safety copies in `backups/`, `.incoming/` contents, the phone `outbox/` folder,
/// and `phone-work.json`.
///
/// Refuses symlinks/reparse points, stays within application root, and logs warnings
/// without failing the restore.
fn delete_start_fresh_leftovers(root: &Path) {
    if let Err(e) = delete_backups_contents(root) {
        log::warn!("Could not clean up backups after start fresh: {e}");
    }
    if let Err(e) = delete_incoming_contents(root) {
        log::warn!("Could not clean up incoming directory after start fresh: {e}");
    }
    if let Err(e) = delete_phone_outbox(root) {
        log::warn!("Could not clean up phone outbox after start fresh: {e}");
    }
    if let Err(e) = delete_phone_work_file(root) {
        log::warn!("Could not clean up phone work file after start fresh: {e}");
    }
}

/// Stage one of the automatic safety copies for installation on next launch.
///
/// These copies hold the database only, so uploaded documents are deliberately
/// left exactly where they are: the copy is the database as it stood before an
/// update, and her files never went anywhere.
#[tauri::command]
pub async fn stage_local_restore(app: AppHandle, name: String) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        crate::library_lock::with_library_lock(
            &root,
            crate::library_lock::owned(&app),
            crate::study_pack::reconcile::Mode::Restore,
            |_| stage_local_restore_in(&root, &name),
        )
    })
    .await
    .map_err(|error| format!("Could not finish restoring that safety copy: {error}"))?
}

/// Stage a named safety copy, against a plain directory.
fn stage_local_restore_in(root: &Path, name: &str) -> Result<BackupInfo, String> {
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

/// Restart so the staged database can be installed before SQLite opens again.
#[tauri::command]
pub fn restart_for_restore(app: AppHandle) -> Result<(), String> {
    // Tauri's own restart starts the new copy while this one still holds the
    // single-instance lock, so the new copy hands over to us and quits, and we
    // then exit: the app never reopens. Instead a helper waits for this process
    // to be gone, then opens the app again.
    #[cfg(target_os = "macos")]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bundle) = mac_bundle_of(&exe) {
            let script = mac_relaunch_script(std::process::id(), &bundle);
            if std::process::Command::new("/bin/sh")
                .arg("-c")
                .arg(script)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .is_ok()
            {
                app.exit(0);
                return Ok(());
            }
        }
    }
    app.request_restart();
    Ok(())
}

/// The `.app` folder that holds this executable, or None when it isn't run from one.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn mac_bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    if macos.file_name()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    let bundle = contents.parent()?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

/// Wait until `pid` has exited, then open the app bundle again.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn mac_relaunch_script(pid: u32, bundle: &Path) -> String {
    let quoted = bundle.to_string_lossy().replace('\'', "'\\''");
    format!(
        "while kill -0 {pid} 2>/dev/null; do sleep 0.2; done; sleep 0.3; /usr/bin/open -n '{quoted}'"
    )
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

fn execute_rollback(root: &Path, journal: &mut RestoreJournal) -> Result<(), String> {
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

fn apply_pending_restore_in_internal<F>(
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
fn forget_gemini_jobs(root: &Path) -> bool {
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
fn apply_pending_restore_in_with<F>(root: &Path, before_install: F) -> Result<(), String>
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

fn startup_restore_outcome(decision: StartupRestoreDecision) -> Result<bool, String> {
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

/// One safety copy, as the interface sees it.
fn describe_backup_folder(path: &Path) -> BackupInfo {
    BackupInfo {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        bytes: directory_size(path),
        created_at: std::fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        restorable: folder_is_restorable(path),
        path: path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    list_backups_in(&app_root(&app)?)
}

pub(crate) fn list_backups_in(root: &Path) -> Result<Vec<BackupInfo>, String> {
    let dir = backup_dir(root)?;
    let mut backups: Vec<BackupInfo> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read the backup directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .map(|entry| describe_backup_folder(&entry.path()))
        .collect();

    // Newest first.
    backups.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(backups)
}

fn directory_size(path: &Path) -> u64 {
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|entry| {
                    entry
                        .metadata()
                        .map(|metadata| {
                            if metadata.is_dir() {
                                directory_size(&entry.path())
                            } else {
                                metadata.len()
                            }
                        })
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0)
}

/// The folder holding her database, documents and backups.
#[tauri::command]
pub fn data_directory(app: AppHandle) -> Result<String, String> {
    Ok(app_root(&app)?.to_string_lossy().to_string())
}

/// Open her data folder in Finder or File Explorer.
///
/// The folder is resolved here from `app_root`, never taken from the webview,
/// so this needs no path scope and opens exactly the folder `data_directory`
/// shows.
///
/// On macOS that folder is named after the bundle identifier,
/// `com.herflightdeck.app`, and anything ending in `.app` is treated as an
/// application: `/usr/bin/open` on it fails with "The application cannot be
/// opened because its executable is missing", which is exactly what an
/// installed Mac reported. Revealing an item *inside* the folder makes Finder
/// open the folder itself with that item selected, and needs no extra
/// permission, so that is what macOS does here. For a truly empty folder,
/// revealing the folder itself in its parent displays the folder in Finder
/// without Launch Services executing it as an application.
#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let root = app_root(&app)?;
    open_data_folder_in(&root)
}

/// System opener operations used to show the data folder.
trait FolderOpener {
    fn reveal_item_in_dir(&self, path: &Path) -> Result<(), String>;
    fn open_path(&self, path: &Path) -> Result<(), String>;
}

struct SystemFolderOpener;

impl FolderOpener for SystemFolderOpener {
    fn reveal_item_in_dir(&self, path: &Path) -> Result<(), String> {
        tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
    }

    fn open_path(&self, path: &Path) -> Result<(), String> {
        tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
    }
}

fn open_data_folder_in(root: &Path) -> Result<(), String> {
    open_data_folder_with(root, cfg!(target_os = "macos"), &SystemFolderOpener)
}

fn open_data_folder_with<O: FolderOpener>(
    root: &Path,
    is_macos: bool,
    opener: &O,
) -> Result<(), String> {
    let opened = if is_macos {
        match item_to_reveal_in(root) {
            Ok(item) => opener.reveal_item_in_dir(&item),
            Err(e) => Err(e.to_string()),
        }
    } else {
        opener.open_path(root)
    };
    opened.map_err(|e| format!("Could not open {}: {e}", root.display()))
}

/// What to select so Finder shows the inside of `root`:
/// - the database when it is there,
/// - otherwise the first item in the folder in name order,
/// - otherwise `root` itself when the directory is truly empty,
/// - or an I/O error if the directory cannot be inspected.
fn item_to_reveal_in(root: &Path) -> std::io::Result<PathBuf> {
    let database = root.join(DB_FILES[0]);
    if database.is_file() {
        return Ok(database);
    }
    let entries = std::fs::read_dir(root)?;
    let mut items: Vec<PathBuf> = Vec::new();
    for entry in entries {
        items.push(entry?.path());
    }
    items.sort();
    if let Some(first) = items.into_iter().next() {
        Ok(first)
    } else {
        Ok(root.to_path_buf())
    }
}

const IPHONE_FOLDER: &str = "Her Flight Deck";
const IPHONE_BACKUPS_KEPT: usize = 3;

/// The iCloud Drive folder her iPhone reads from, created on first use.
/// `None` when iCloud Drive is off, missing or not writable here.
pub(crate) fn iphone_backup_dir(home: &Path) -> Option<PathBuf> {
    let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    if !icloud.is_dir() {
        return None;
    }
    let dir = icloud.join(IPHONE_FOLDER);
    std::fs::create_dir_all(&dir).ok()?;
    dir.is_dir().then_some(dir)
}

fn iphone_stamp_is_valid(stamp: &str) -> bool {
    // "YYYY-MM-DD HHmm"
    let b = stamp.as_bytes();
    b.len() == 15
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b' ',
            _ => c.is_ascii_digit(),
        })
}

/// `Her Flight Deck <YYYY-MM-DD HHmm>.hfdbackup`, from a UTC clock reading.
pub(crate) fn iphone_backup_file_name(now: std::time::SystemTime) -> String {
    let secs = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{IPHONE_FOLDER} {year:04}-{month:02}-{day:02} {:02}{:02}.hfdbackup",
        rem / 3_600,
        (rem % 3_600) / 60
    )
}

fn is_iphone_backup_name(name: &str) -> bool {
    name.strip_prefix(IPHONE_FOLDER)
        .and_then(|rest| rest.strip_prefix(' '))
        .and_then(|rest| rest.strip_suffix(".hfdbackup"))
        .is_some_and(iphone_stamp_is_valid)
}

/// Keep the newest `keep` files that match the dated name; touch nothing else.
pub(crate) fn prune_iphone_backups(dir: &Path, keep: usize) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Could not look in the iPhone folder: {e}"))?;
    let mut matching: Vec<(std::time::SystemTime, String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_iphone_backup_name(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
        matching.push((modified, name, entry.path()));
    }
    matching.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, _, path) in matching.into_iter().skip(keep) {
        if let Err(e) = std::fs::remove_file(&path) {
            log::warn!("Could not remove an older iPhone copy: {e}");
        }
    }
    Ok(())
}

/// Save a complete backup where her iPhone can open it from Files.
/// `Ok(None)` means iCloud Drive is not available and the caller should ask
/// where to save instead. `local_stamp` is her local "YYYY-MM-DD HHmm".
#[tauri::command]
pub async fn create_iphone_backup(
    app: AppHandle,
    local_stamp: Option<String>,
) -> Result<Option<CompleteBackupInfo>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return Ok(None);
        };
        let Some(dir) = iphone_backup_dir(&home) else {
            return Ok(None);
        };
        let name = match local_stamp.as_deref().filter(|s| iphone_stamp_is_valid(s)) {
            Some(stamp) => format!("{IPHONE_FOLDER} {stamp}.hfdbackup"),
            None => iphone_backup_file_name(std::time::SystemTime::now()),
        };
        let root = app_root(&app)?;
        // Read before the copy starts: a change made during it may be in
        // neither the copy nor a file otherwise (overlap is harmless).
        let mark = crate::sync::send::change_stream_mark(&root).ok();
        let info = create_consistent_complete_backup_with_retry(
            &root,
            &dir.join(name),
            &app.package_info().version.to_string(),
        )?;
        if let Err(e) = prune_iphone_backups(&dir, IPHONE_BACKUPS_KEPT) {
            log::warn!("{e}");
        }
        // The Mac's changes now start after this copy. Never fails the copy.
        if let Some(mark) = mark {
            if let Err(e) = crate::sync::send::restart_change_stream(&root, mark) {
                log::warn!("Could not restart the change stream after the copy: {e}");
            }
        }
        Ok(Some(info))
    })
    .await
    .map_err(|error| format!("Could not finish saving the backup: {error}"))?
}

fn reveal_iphone_backup_with<O: FolderOpener>(
    dir: &Path,
    path: &str,
    opener: &O,
) -> Result<(), String> {
    let refuse = || "That file is not in your iPhone folder.".to_string();
    let dir = dir.canonicalize().map_err(|_| refuse())?;
    let target = Path::new(path).canonicalize().map_err(|_| refuse())?;
    if !target.starts_with(&dir) {
        return Err(refuse());
    }
    opener.reveal_item_in_dir(&target)
}

/// Show one saved iPhone copy in Finder (for AirDrop). Refuses other paths.
#[tauri::command]
pub fn reveal_iphone_backup(_app: AppHandle, path: String) -> Result<(), String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "That file is not in your iPhone folder.".to_string())?;
    let dir = iphone_backup_dir(&home)
        .ok_or_else(|| "That file is not in your iPhone folder.".to_string())?;
    reveal_iphone_backup_with(&dir, &path, &SystemFolderOpener)
}

#[cfg(test)]
mod tests;
