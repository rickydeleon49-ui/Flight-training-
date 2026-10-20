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
const RESTORE_PENDING_DIR: &str = ".restore-pending";
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
const DB_FILES: [&str; 3] = [
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
    pub path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_documents: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unreferenced_documents: Vec<String>,
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
        return Err("That file is not a Her Flight Deck database.".to_string());
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
                "That backup does not contain a Her Flight Deck database (missing {table})."
            ));
        }
    }

    let newest_migration = newest_migration_version(connection)?;
    if newest_migration > crate::CURRENT_SCHEMA_VERSION {
        return Err(
            "That backup was created by a newer database format. Update the app first.".to_string(),
        );
    }
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
        .ok_or_else(|| {
            "That backup does not contain Her Flight Deck migration history.".to_string()
        })?;
    connection
        .query_row(
            &format!("SELECT COALESCE(MAX(version), 0) FROM {migration_table}"),
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Could not inspect the database version: {e}"))
}

/// Schema 18's additive provenance contract; TS twin: `validatePdfKitState`.
/// All three engines exercise `fixtures/pdf-kit-validation/cases.json` after reopening.
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
fn is_transient_lock_error(message: &str) -> bool {
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

fn validate_archive_path(raw_name: &str, path: &Path) -> Result<(), String> {
    if raw_name.len() > MAX_ARCHIVE_PATH_BYTES
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

fn validate_compression_ratio(uncompressed: u64, compressed: u64) -> Result<(), String> {
    if uncompressed <= COMPRESSION_RATIO_FLOOR {
        return Ok(());
    }
    if compressed == 0
        || uncompressed.checked_div(compressed).unwrap_or(u64::MAX) > MAX_COMPRESSION_RATIO
    {
        return Err("The backup contains an unsafe compression ratio.".to_string());
    }
    Ok(())
}

/// Copy a restored file's bytes from the archive to disk, hashing exactly the
/// bytes written. Returns the byte count and SHA-256 of what was written.
///
/// Hashing while writing replaces reopening each new file to hash it
/// afterwards. That reopen is what made staging slow on Windows (about 19 ms
/// per just-written file, most of a large restore; see
/// docs/PERFORMANCE_POLISH_2026-09-27.md). The check is the same: the bytes
/// that went to the file must match the archive's integrity record before the
/// restore is staged, and the file is still flushed with `sync_all` first.
fn copy_and_hash(reader: &mut impl Read, output: &mut File) -> Result<(u64, String), String> {
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
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut db_entry = archive
        .by_name(DB_FILES[0])
        .map_err(|_| "That backup does not contain a Her Flight Deck database.".to_string())?;

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

    verify_application_database(&temp_db_path)?;

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

    Ok((missing_documents, unreferenced_documents))
}

pub(crate) fn inspect_archive(
    root: &Path,
    source: &Path,
    current_app_version: &str,
) -> Result<CompleteBackupInfo, String> {
    let file = File::open(source).map_err(|e| format!("Could not open that backup: {e}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| zip_error("That is not a readable Her Flight Deck backup", e))?;

    let manifest: CompleteBackupManifest = {
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
        serde_json::from_str(&json).map_err(|e| format!("The backup manifest is invalid: {e}"))?
    };

    if manifest.format != ARCHIVE_FORMAT
        || !matches!(
            manifest.format_version,
            LEGACY_ARCHIVE_VERSION | V2_ARCHIVE_VERSION | ARCHIVE_VERSION
        )
    {
        return Err("That backup format is not supported by this version of the app.".to_string());
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
        let raw_name = entry.name().to_string();
        let path = entry
            .enclosed_name()
            .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
        validate_archive_path(&raw_name, &path)?;
        validate_compression_ratio(entry.size(), entry.compressed_size())?;
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
                    "The database in that backup is damaged, or that file is not a Her Flight Deck backup."
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
                        "The database in that backup is damaged, or that file is not a Her Flight Deck backup."
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
        return Err("That backup does not contain a Her Flight Deck database.".to_string());
    }

    let (missing_documents, unreferenced_documents) = if manifest.format_version
        >= V2_ARCHIVE_VERSION
    {
        verify_archive_database_and_documents(root, &mut archive, &manifest, &archive_documents)?
    } else {
        (Vec::new(), Vec::new())
    };

    Ok(CompleteBackupInfo {
        app_version: manifest.app_version,
        current_app_version: current_app_version.to_string(),
        created_at: manifest.created_at,
        files,
        bytes,
        path: source.to_string_lossy().to_string(),
        missing_documents,
        unreferenced_documents,
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
fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
}

#[cfg(not(windows))]
fn is_symlink_or_reparse(meta: &std::fs::Metadata) -> bool {
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
    copy_database(root, &format!("before-{current}"))?;
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
    Ok(destination.to_string_lossy().to_string())
}

/// Export one portable file containing the database and every imported document.
#[tauri::command]
pub async fn create_complete_backup(
    app: AppHandle,
    destination_path: String,
) -> Result<CompleteBackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app_root(&app)?;
        create_consistent_complete_backup_with_retry(
            &root,
            Path::new(&destination_path),
            &app.package_info().version.to_string(),
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
fn write_complete_backup(
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

        let (docs_to_archive, missing_at_export, orphans_at_export) = if verify_before_finish {
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

            (Some(to_archive), missing, orphans)
        } else {
            (None, Vec::new(), Vec::new())
        };

        let output = File::create(&temporary).map_err(|e| {
            BackupExportError::Permanent(format!("Could not create the backup file: {e}"))
        })?;
        let mut archive = ZipWriter::new(output);
        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION,
            app_version: app_version.to_string(),
            created_at: unix_timestamp(),
            missing_at_export: missing_at_export.clone(),
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
        if verify_before_finish {
            inspect_archive(root, &temporary, app_version).map_err(|e| {
                BackupExportError::Permanent(format!(
                    "The backup was written but did not pass its own integrity check: {e}"
                ))
            })?;
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
            current_app_version: manifest.app_version.clone(),
            app_version: manifest.app_version,
            created_at: manifest.created_at,
            files,
            bytes,
            path: destination.to_string_lossy().to_string(),
            missing_documents: missing_at_export,
            unreferenced_documents: orphans_at_export,
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
        stage_complete_restore_in(
            &app_root(&app)?,
            Path::new(&source_path),
            &app.package_info().version.to_string(),
        )
    })
    .await
    .map_err(|error| format!("Could not finish restoring that backup: {error}"))?
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
            let raw_name = entry.name().to_string();
            let path = entry
                .enclosed_name()
                .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?;
            validate_archive_path(&raw_name, &path)?;
            validate_compression_ratio(entry.size(), entry.compressed_size())?;
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

/// Stage one of the automatic safety copies for installation on next launch.
///
/// These copies hold the database only, so uploaded documents are deliberately
/// left exactly where they are: the copy is the database as it stood before an
/// update, and her files never went anywhere.
#[tauri::command]
pub async fn stage_local_restore(app: AppHandle, name: String) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || stage_local_restore_in(&app_root(&app)?, &name))
        .await
        .map_err(|error| format!("Could not finish restoring that safety copy: {error}"))?
}

/// Stage a named safety copy, against a plain directory.
fn stage_local_restore_in(root: &Path, name: &str) -> Result<BackupInfo, String> {
    let name = safe_backup_name(name)?;
    let folder = backup_dir(root)?.join(name);
    if !folder.is_dir() {
        return Err("That safety copy is no longer there.".to_string());
    }
    let database = folder.join(DB_FILES[0]);
    verify_sqlite_file(&database)?;

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
    app.request_restart();
    Ok(())
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
            let src_meta = match std::fs::symlink_metadata(&src_docs) {
                Ok(m) => m,
                Err(e) => {
                    errors.push(format!(
                        "Could not inspect recovery documents directory: {e}"
                    ));
                    std::fs::metadata(&rollback).unwrap()
                }
            };
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
    if let Err(error) = verify_sqlite_file(&pending.join(DB_FILES[0])) {
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
                                eprintln!(
                                    "Warning: Could not remove staged restore directory: {e}"
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        _ => {
                            cleanup_succeeded = false;
                        }
                    },
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("Warning: Cannot inspect pending restore directory: {e}");
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
                                eprintln!(
                                    "Warning: Could not remove staged restore directory: {e}"
                                );
                                cleanup_succeeded = false;
                            }
                        }
                        _ => {
                            cleanup_succeeded = false;
                        }
                    },
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("Warning: Cannot inspect pending restore directory: {e}");
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

    let mut cleanup_succeeded = true;
    match inspect_storage_root(&pending, "Pending restore directory") {
        Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
            Ok(true) => {
                if let Err(e) = remove_pending_directory_safely(&pending) {
                    eprintln!("Warning: Could not remove staged restore directory: {e}");
                    cleanup_succeeded = false;
                }
            }
            Ok(false) => {
                eprintln!("Warning: Pending restore directory ownership does not match journal");
                cleanup_succeeded = false;
            }
            Err(e) => {
                eprintln!("Warning: Cannot verify ownership of pending restore directory: {e}");
                cleanup_succeeded = false;
            }
        },
        Ok(None) => {}
        Err(e) => {
            eprintln!("Warning: Pending restore directory is unsafe: {e}");
            cleanup_succeeded = false;
        }
    }
    let _ = prune(root);

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
        Err(error) => {
            eprintln!("Could not forget Gemini jobs after restoring: {error}; will try again at the next launch.");
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
    apply_pending_restore_in(&app_root(app)?)
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
                return Ok(StartupRestoreDecision::RestoreCompleted)
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
            let mut cleanup_succeeded = true;
            match inspect_storage_root(&pending, "Pending restore directory") {
                Ok(Some(_)) => match verify_pending_cleanup_permission(&pending, &journal) {
                    Ok(true) => {
                        if let Err(e) = remove_pending_directory_safely(&pending) {
                            eprintln!("Warning: Could not remove staged restore directory: {e}");
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
                let _ = prune(root);
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
                            eprintln!("Warning: Could not remove staged restore directory: {e}");
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
                                eprintln!(
                                    "Warning: Could not remove staged restore directory: {e}"
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

/// Installs or resolves any pending restore before SQLite opens. Returns
/// whether this startup finished a restore, so the caller can bring the
/// restarted window forward: the restart execs the binary directly rather than
/// through LaunchServices, and macOS would otherwise leave it behind whatever
/// was in front.
pub fn handle_startup_restore(app: &AppHandle) -> Result<bool, String> {
    let root = app_root(app)?;
    startup_restore_outcome(handle_startup_restore_in(&root)?)
}

fn startup_restore_outcome(decision: StartupRestoreDecision) -> Result<bool, String> {
    match decision {
        StartupRestoreDecision::ProceedNormally => Ok(false),
        StartupRestoreDecision::RestoreCompleted => Ok(true),
        StartupRestoreDecision::StagingRefusedUnchanged { reason } => {
            eprintln!("Pending restore refused: {reason}; current data unchanged.");
            Ok(false)
        }
        StartupRestoreDecision::RolledBackRecovered { reason } => {
            eprintln!("Pending restore failed: {reason}; previous data was recovered.");
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn sha256_digest(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    /// A private directory to play the part of her application data folder.
    fn scratch(label: &str) -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "hfd-{label}-{}-{}-{unique}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A minimal real application database with recognizable test contents.
    fn write_database(path: &Path, contents: &str) {
        for candidate in [
            path.to_path_buf(),
            PathBuf::from(format!("{}-wal", path.to_string_lossy())),
            PathBuf::from(format!("{}-shm", path.to_string_lossy())),
        ] {
            let _ = std::fs::remove_file(candidate);
        }
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE settings (id TEXT PRIMARY KEY);
                 CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT);
                 CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
                 CREATE TABLE audit_payload (value TEXT NOT NULL);
                 INSERT INTO _sqlx_migrations(version) VALUES (9);",
            )
            .unwrap();
        connection
            .execute("INSERT INTO audit_payload(value) VALUES (?1)", [contents])
            .unwrap();
    }

    #[test]
    fn current_database_version_matches_the_registered_migrations() {
        let latest = crate::migrations().last().unwrap().version;
        assert_eq!(latest, crate::CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn current_practice_test_schema_can_be_backed_up_but_future_schema_cannot() {
        let root = scratch("practice-schema-backup");
        let database = root.join(DB_FILES[0]);
        write_database(&database, "version nine");
        let snapshot = database_snapshot_with_retry(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "version nine");
        std::fs::remove_file(snapshot).unwrap();

        Connection::open(&database)
            .unwrap()
            .execute(
                "UPDATE _sqlx_migrations SET version = ?1",
                [crate::CURRENT_SCHEMA_VERSION + 1],
            )
            .unwrap();
        assert!(verify_application_database(&database)
            .unwrap_err()
            .contains("newer"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn req_15_schema_10_backup_validates_without_new_tables() {
        let root = scratch("schema-10-backup");
        let database = root.join(DB_FILES[0]);
        let conn = Connection::open(&database).unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (id TEXT PRIMARY KEY);
             CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT);
             CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO _sqlx_migrations (version) VALUES (10);",
        )
        .unwrap();

        // Schema 10 must pass without requiring practice_test_versions or other migration 11 tables
        assert!(verify_application_database(&database).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn req_16_schema_11_backup_validation_catches_semantic_violations() {
        let root = scratch("schema-11-backup");
        let database = root.join(DB_FILES[0]);

        // Start with a full schema 11 db
        let conn = Connection::open(&database).unwrap();
        conn.busy_timeout(BUSY_TIMEOUT).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for m in crate::migrations() {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute_batch("CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY); INSERT INTO _sqlx_migrations (version) VALUES (11);").unwrap();

        // 1. Valid empty schema 11 db passes
        assert!(verify_application_database(&database).is_ok());

        // 2. Add material, version, items, and completed attempt with score
        conn.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-1', 'Test', '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z')", []).unwrap();
        conn.execute("INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, version_number, content_hash, created_at, is_active) VALUES ('ver-1', 'mat-1', 'mat-1', 'Test', 1, 'h', '2026-10-04T12:00:00Z', 1)", []).unwrap();
        conn.execute("INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index) VALUES ('item-1', 'ver-1', 0, 'Q1', '[\"A\",\"B\"]', 0)", []).unwrap();
        conn.execute("INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index) VALUES ('item-2', 'ver-1', 1, 'Q2', '[\"A\",\"B\"]', 1)", []).unwrap();

        conn.execute("INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, started_at, completed_at, status, total_questions, answered_count, correct_count, incorrect_count, dont_know_count, score_percent) VALUES ('att-1', 'ver-1', 'mat-1', 'Test', '2026-10-04T12:00:00Z', '2026-10-04T12:05:00Z', 'completed', 2, 2, 2, 0, 0, 100.0)", []).unwrap();
        conn.execute("INSERT INTO practice_responses (id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at) VALUES ('r-1', 'att-1', 'item-1', 0, 0, 1, '2026-10-04T12:01:00Z')", []).unwrap();
        conn.execute("INSERT INTO practice_responses (id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at) VALUES ('r-2', 'att-1', 'item-2', 1, 0, 1, '2026-10-04T12:02:00Z')", []).unwrap();

        // Consistent state passes
        assert!(verify_application_database(&database).is_ok());

        // 3. Corrupt completed score (e.g. 50.0 instead of 100.0)
        conn.execute(
            "UPDATE practice_attempts SET score_percent = 50.0 WHERE id = 'att-1'",
            [],
        )
        .unwrap();
        let err_score = verify_application_database(&database).unwrap_err();
        assert!(err_score.contains("inconsistent score percentage"));

        // Restore correct score
        conn.execute(
            "UPDATE practice_attempts SET score_percent = 100.0 WHERE id = 'att-1'",
            [],
        )
        .unwrap();
        assert!(verify_application_database(&database).is_ok());

        // 4. Cross-version violation: second version with item belonging to it, but response points to att-1
        conn.execute("INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, version_number, content_hash, created_at, is_active) VALUES ('ver-2', NULL, 'mat-1', 'Test', 2, 'h2', '2026-10-04T12:00:00Z', 0)", []).unwrap();
        conn.execute("INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index) VALUES ('item-3', 'ver-2', 0, 'Q3', '[\"A\",\"B\"]', 0)", []).unwrap();
        conn.execute_batch("DROP TRIGGER trg_enforce_response_item_version_update; UPDATE practice_responses SET item_id = 'item-3' WHERE id = 'r-2';").unwrap();

        let err_cross = verify_application_database(&database).unwrap_err();
        assert!(err_cross.contains("different version"));

        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manual_safety_copy_is_a_consistent_online_snapshot() {
        let root = scratch("manual-online-snapshot");
        write_database(&root.join(DB_FILES[0]), "before");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute("UPDATE audit_payload SET value = 'after'", [])
            .unwrap();

        let backup = create_consistent_local_backup(&root).unwrap();
        let saved = PathBuf::from(backup).join(DB_FILES[0]);
        assert_eq!(database_contents(&saved), "after");
        verify_application_database(&saved).unwrap();
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn database_contents(path: &Path) -> String {
        Connection::open(path)
            .unwrap()
            .query_row("SELECT value FROM audit_payload LIMIT 1", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    fn write_document(root: &Path, relative: &str, contents: &str) {
        let path = root.join(DOCUMENTS_DIR).join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, contents).unwrap();
        let db_path = root.join(DB_FILES[0]);
        if db_path.is_file() {
            if let Ok(conn) = Connection::open(&db_path) {
                let normalized = relative.replace('\\', "/");
                let _ = conn.execute(
                    "INSERT INTO study_materials (id, file_path) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
                    params![normalized, normalized],
                );
            }
        }
    }

    fn document_contents(root: &Path, relative: &str) -> Option<String> {
        std::fs::read_to_string(root.join(DOCUMENTS_DIR).join(relative)).ok()
    }

    fn rewrite_entry(archive_path: &Path, target: &str, replacement: &[u8]) {
        let input = File::open(archive_path).unwrap();
        let mut input = ZipArchive::new(input).unwrap();
        let rewritten = archive_path.with_extension("rewritten");
        let output = File::create(&rewritten).unwrap();
        let mut output = ZipWriter::new(output);
        for index in 0..input.len() {
            let mut entry = input.by_index(index).unwrap();
            let name = entry.name().to_string();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            output.start_file(&name, archive_options()).unwrap();
            output
                .write_all(if name == target { replacement } else { &bytes })
                .unwrap();
        }
        output.finish().unwrap();
        std::fs::rename(rewritten, archive_path).unwrap();
    }

    fn write_legacy_backup(root: &Path, archive_path: &Path, app_version: &str) {
        let output = File::create(archive_path).unwrap();
        let mut archive = ZipWriter::new(output);
        archive
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .unwrap();
        archive
            .write_all(
                serde_json::to_string(&CompleteBackupManifest {
                    format: ARCHIVE_FORMAT.to_string(),
                    format_version: LEGACY_ARCHIVE_VERSION,
                    app_version: app_version.to_string(),
                    created_at: 0,
                    missing_at_export: Vec::new(),
                })
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        add_file_to_archive(&mut archive, &root.join(DB_FILES[0]), DB_FILES[0]).unwrap();
        archive.finish().unwrap();
    }

    #[test]
    fn an_archive_may_only_contain_her_database_and_documents() {
        assert!(allowed_archive_path(Path::new(ARCHIVE_MANIFEST), false));
        assert!(allowed_archive_path(Path::new(DB_FILES[0]), false));
        assert!(allowed_archive_path(Path::new(DB_FILES[1]), false));
        assert!(allowed_archive_path(
            &Path::new(DOCUMENTS_DIR).join("chart.pdf"),
            false
        ));
        assert!(allowed_archive_path(Path::new(DOCUMENTS_DIR), true));

        // A backup file must never be able to say how it gets installed.
        assert!(!allowed_archive_path(Path::new(RESTORE_PLAN), false));
        // Nor drop anything else beside her data.
        assert!(!allowed_archive_path(
            Path::new("last-run-version.txt"),
            false
        ));
        // Nor hand her a Gemini key chosen by whoever wrote the archive.
        assert!(!allowed_archive_path(
            Path::new(crate::secrets::KEY_FILE),
            false
        ));
        assert!(!allowed_archive_path(Path::new("documents"), false));
        assert!(!allowed_archive_path(Path::new(DB_FILES[0]), true));
    }

    #[test]
    fn a_database_is_recognized_by_its_header() {
        assert!(is_sqlite_header(SQLITE_MAGIC));
        assert!(is_sqlite_header(b"SQLite format 3\0and then some pages"));
        assert!(!is_sqlite_header(b"SQLite format 3"));
        assert!(!is_sqlite_header(b""));
        assert!(!is_sqlite_header(b"PK\x03\x04 a zip file, not a database"));
    }

    #[test]
    fn a_chosen_safety_copy_cannot_climb_out_of_the_backup_folder() {
        assert_eq!(
            safe_backup_name("2026-09-05-174233-manual").unwrap(),
            "2026-09-05-174233-manual"
        );
        assert_eq!(
            safe_backup_name(" 2026-09-05-174233-manual ").unwrap(),
            "2026-09-05-174233-manual"
        );

        for bad in ["", "  ", ".", "..", "../documents", "a/b", "a\\b", "a\0b"] {
            assert!(safe_backup_name(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn a_restore_plan_survives_being_written_and_read_back() {
        let json = serde_json::to_string(&RestorePlan {
            operation_id: "test-op".to_string(),
            kind: RestoreKind::Database,
            source: "2026-09-05-174233-before-0.3.0".to_string(),
        })
        .unwrap();
        let read: RestorePlan = serde_json::from_str(&json).unwrap();
        assert_eq!(read.kind, RestoreKind::Database);
        assert_eq!(read.operation_id, "test-op");
    }

    #[test]
    fn a_missing_or_damaged_plan_is_treated_as_a_complete_archive() {
        // Every version before restore plans existed staged complete archives,
        // and a half-written plan must not silently keep the wrong documents.
        let dir = std::env::temp_dir().join(format!("hfd-plan-{}", unix_timestamp()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Complete);

        std::fs::write(dir.join(RESTORE_PLAN), "{ not json").unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Complete);

        write_restore_plan(&dir, RestoreKind::Database, "a safety copy").unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Database);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_a_folder_holding_a_real_database_offers_to_be_restored() {
        let dir = std::env::temp_dir().join(format!("hfd-copy-{}", unix_timestamp()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!folder_is_restorable(&dir));

        std::fs::write(dir.join(DB_FILES[0]), b"not a database at all").unwrap();
        assert!(!folder_is_restorable(&dir));

        let mut database = SQLITE_MAGIC.to_vec();
        database.extend_from_slice(&[0u8; 128]);
        std::fs::write(dir.join(DB_FILES[0]), database).unwrap();
        assert!(folder_is_restorable(&dir));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_timestamp_reads_as_a_sortable_date() {
        // Copies are pruned oldest-first by name, so the shape matters.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_702), (2026, 9, 6));
    }

    /* --------------------- backup and restore, end to end ---------------- */

    #[test]
    fn a_complete_backup_puts_back_the_database_and_every_document() {
        let root = scratch("complete");
        let elsewhere = scratch("elsewhere");
        write_database(&root.join(DB_FILES[0]), "her real training record");
        write_document(&root, "airplane-flying-handbook.pdf", "chapter nine");
        write_document(&root, "lessons/debrief.png", "crosswind notes");

        let archive = elsewhere.join("her-flight-deck.hfdbackup");
        let saved = write_complete_backup(&root, &archive, "0.2.0").unwrap();
        assert_eq!(saved.app_version, "0.2.0");
        // The database and both documents.
        assert_eq!(saved.files, 3);
        assert!(archive.is_file());

        // Something goes wrong afterwards: the record is replaced and a file lost.
        write_database(&root.join(DB_FILES[0]), "damaged after an update");
        std::fs::remove_file(root.join(DOCUMENTS_DIR).join("lessons/debrief.png")).unwrap();

        let staged = stage_complete_restore_in(&root, &archive, "0.2.0").unwrap();
        assert_eq!(staged.files, 3);
        // Staging alone must not have touched anything of hers.
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "damaged after an update"
        );

        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "her real training record"
        );
        assert_eq!(
            document_contents(&root, "airplane-flying-handbook.pdf").as_deref(),
            Some("chapter nine")
        );
        assert_eq!(
            document_contents(&root, "lessons/debrief.png").as_deref(),
            Some("crosswind notes")
        );

        // And what was there before the restore is still recoverable.
        let rollbacks: Vec<BackupInfo> = list_backups_in(&root)
            .unwrap()
            .into_iter()
            .filter(|backup| backup.name.ends_with("-before-restore"))
            .collect();
        assert_eq!(rollbacks.len(), 1);
        assert!(rollbacks[0].restorable);

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_safety_copy_puts_the_database_back_and_leaves_her_uploads_alone() {
        let root = scratch("safety-copy");
        write_database(&root.join(DB_FILES[0]), "before the update");
        write_document(&root, "handbook.pdf", "still hers");

        // First launch of a new version: a copy is taken before anything opens.
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        let copies = list_backups_in(&root).unwrap();
        assert_eq!(copies.len(), 1);
        let copy = copies[0].name.clone();
        assert!(copy.ends_with("-before-0.3.0"));

        // The update goes badly, and she uploads something else in the meantime.
        write_database(&root.join(DB_FILES[0]), "lost her lessons");
        write_document(&root, "new-checklist.pdf", "added since");

        stage_local_restore_in(&root, &copy).unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "before the update"
        );
        // Her uploads were never in that copy and must not be swept away by it.
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("still hers")
        );
        assert_eq!(
            document_contents(&root, "new-checklist.pdf").as_deref(),
            Some("added since")
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_write_ahead_log_travels_with_the_database() {
        // If a checkpoint could not finish, her newest entries live only in the
        // log. A backup that left it behind would quietly lose them.
        let root = scratch("wal");
        let elsewhere = scratch("wal-out");
        write_database(&root.join(DB_FILES[0]), "checkpointed pages");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute(
                "UPDATE audit_payload SET value = 'pages written since the last checkpoint'",
                [],
            )
            .unwrap();
        assert!(root.join(DB_FILES[1]).is_file());

        let archive = elsewhere.join("with-log.hfdbackup");
        let saved = write_complete_backup(&root, &archive, "0.2.0").unwrap();
        assert_eq!(saved.files, 2);
        drop(connection);

        let _ = std::fs::remove_file(root.join(DB_FILES[1]));
        write_database(&root.join(DB_FILES[0]), "something else entirely");

        stage_complete_restore_in(&root, &archive, "0.2.0").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "pages written since the last checkpoint"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_damaged_backup_is_refused_before_anything_of_hers_moves() {
        let root = scratch("damaged");
        let elsewhere = scratch("damaged-out");
        // An archive written around a file that is not a database at all.
        std::fs::write(root.join(DB_FILES[0]), b"this is not a database").unwrap();
        let archive = elsewhere.join("damaged.hfdbackup");
        write_complete_backup(&root, &archive, "0.2.0").unwrap();

        write_database(&root.join(DB_FILES[0]), "her real record");
        write_document(&root, "handbook.pdf", "hers");

        assert!(inspect_archive(&root, &archive, "0.2.0").is_err());
        assert!(stage_complete_restore_in(&root, &archive, "0.2.0").is_err());

        // Refused means refused: her current data is exactly as it was.
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "her real record"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("hers")
        );
        assert!(!root.join(RESTORE_PENDING_DIR).exists());
        assert!(!root.join(RESTORE_STAGING_DIR).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn an_archive_carrying_anything_unexpected_is_refused() {
        let elsewhere = scratch("hostile");
        let archive = elsewhere.join("hostile.hfdbackup");

        let file = File::create(&archive).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .unwrap();
        writer
            .write_all(
                serde_json::to_string(&CompleteBackupManifest {
                    format: ARCHIVE_FORMAT.to_string(),
                    format_version: LEGACY_ARCHIVE_VERSION,
                    app_version: "0.2.0".to_string(),
                    created_at: 0,
                    missing_at_export: Vec::new(),
                })
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        writer.start_file(DB_FILES[0], archive_options()).unwrap();
        writer.write_all(SQLITE_MAGIC).unwrap();
        // A restore plan would decide whether her documents get replaced.
        writer.start_file(RESTORE_PLAN, archive_options()).unwrap();
        writer
            .write_all(b"{\"kind\":\"database\",\"source\":\"\"}")
            .unwrap();
        writer.finish().unwrap();

        let refusal = inspect_archive(&elsewhere, &archive, "0.2.0").unwrap_err();
        assert!(refusal.contains("unexpected file"), "{refusal}");

        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_copy_is_taken_whenever_another_version_wrote_the_database() {
        let root = scratch("upgrade");

        // A genuine first run: nothing to copy, but the version is recorded.
        backup_if_upgraded_in(&root, "0.2.0").unwrap();
        assert!(list_backups_in(&root).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(root.join(VERSION_FILE)).unwrap(),
            "0.2.0"
        );

        // Reopening the same version does not pile up copies.
        write_database(&root.join(DB_FILES[0]), "her record");
        backup_if_upgraded_in(&root, "0.2.0").unwrap();
        assert!(list_backups_in(&root).unwrap().is_empty());

        // A new version does.
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        assert_eq!(list_backups_in(&root).unwrap().len(), 1);

        // And so does a database whose version we have no record of, which is
        // the case where we know least about what wrote it.
        std::fs::remove_file(root.join(VERSION_FILE)).unwrap();
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        assert_eq!(list_backups_in(&root).unwrap().len(), 2);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_backup_cannot_be_saved_inside_the_folder_it_is_protecting() {
        // A backup that lives inside the data folder is lost with it.
        let root = scratch("inside");
        write_database(&root.join(DB_FILES[0]), "her record");

        let refusal =
            write_complete_backup(&root, &root.join("copy.hfdbackup"), "0.2.0").unwrap_err();
        assert!(refusal.contains("outside"), "{refusal}");

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn restored_files_are_hashed_from_exactly_the_bytes_written() {
        let root = scratch("copy-and-hash");
        let content: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let destination = root.join("restored.pdf");
        let mut output = File::create(&destination).unwrap();
        let (bytes, sha) = copy_and_hash(&mut content.as_slice(), &mut output).unwrap();
        output.sync_all().unwrap();
        drop(output);

        assert_eq!(bytes, content.len() as u64);
        assert_eq!(std::fs::read(&destination).unwrap(), content);
        assert_eq!(sha, hex::encode(Sha256::digest(&content)));

        let mut changed = content.clone();
        changed[100_000] ^= 1;
        let mut other = File::create(root.join("changed.pdf")).unwrap();
        let (_, changed_sha) = copy_and_hash(&mut changed.as_slice(), &mut other).unwrap();
        assert_ne!(changed_sha, sha);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_same_size_content_change_fails_the_integrity_check() {
        let root = scratch("checksum");
        let elsewhere = scratch("checksum-out");
        write_database(&root.join(DB_FILES[0]), "training record");
        write_document(&root, "handbook.pdf", "original bytes");
        let archive = elsewhere.join("checked.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        rewrite_entry(&archive, "documents/handbook.pdf", b"tampered bytes");
        let error = inspect_archive(&root, &archive, "0.5.1").unwrap_err();
        assert!(error.contains("integrity check"), "{error}");
        assert!(stage_complete_restore_in(&root, &archive, "0.5.1").is_err());

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_format_version_one_backup_still_restores() {
        let root = scratch("legacy-v1");
        let elsewhere = scratch("legacy-v1-out");
        write_database(&root.join(DB_FILES[0]), "from version one");
        let archive = elsewhere.join("legacy.hfdbackup");
        write_legacy_backup(&root, &archive, "0.5.1");
        write_database(&root.join(DB_FILES[0]), "current");

        stage_complete_restore_in(&root, &archive, "0.5.1").unwrap();
        apply_pending_restore_in(&root).unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "from version one"
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_valid_sqlite_file_with_the_wrong_schema_is_refused() {
        let root = scratch("wrong-schema");
        let elsewhere = scratch("wrong-schema-out");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .execute("CREATE TABLE somebody_elses_data (value TEXT)", [])
            .unwrap();
        drop(connection);
        let archive = elsewhere.join("wrong-schema.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        let error = stage_complete_restore_in(&root, &archive, "0.5.1").unwrap_err();
        assert!(error.contains("missing settings"), "{error}");
        assert!(!root.join(RESTORE_PENDING_DIR).exists());

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn an_online_snapshot_includes_committed_wal_changes() {
        let root = scratch("online-snapshot");
        write_database(&root.join(DB_FILES[0]), "before");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute("UPDATE audit_payload SET value = 'after'", [])
            .unwrap();

        let snapshot = database_snapshot(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "after");
        verify_application_database(&snapshot).unwrap();

        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_transient_lock_during_snapshot_clears_and_the_backup_still_completes() {
        let root = scratch("snapshot-transient-lock");
        write_database(&root.join(DB_FILES[0]), "before the lock");

        let locker = Connection::open(root.join(DB_FILES[0])).unwrap();
        locker.execute("BEGIN EXCLUSIVE", []).unwrap();
        // Held briefly on another thread — long enough that the snapshot's
        // own read has to wait for it, short enough that the busy timeout
        // (and, if that were not enough, the bounded retry around the whole
        // snapshot) comfortably outlasts it. This is the same shape of
        // collision as an ordinary autosave or a split saving its parts
        // landing at the same moment as a backup.
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            locker.execute("COMMIT", []).unwrap();
        });

        let snapshot = database_snapshot_with_retry(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "before the lock");

        handle.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_lock_that_never_clears_fails_the_snapshot_boundedly_with_a_plain_message() {
        let root = scratch("snapshot-permanent-lock");
        write_database(&root.join(DB_FILES[0]), "locked forever");

        let locker = Connection::open(root.join(DB_FILES[0])).unwrap();
        locker.execute("BEGIN EXCLUSIVE", []).unwrap();

        let started = std::time::Instant::now();
        let error = database_snapshot_with_retry(&root).unwrap_err();
        let elapsed = started.elapsed();

        assert!(error.contains("busy"), "{error}");
        // Bounded by (SNAPSHOT_LOCK_RETRIES + 1) attempts, each capped at
        // BUSY_TIMEOUT — not an unlimited or open-ended wait, however long a
        // real lock happens to be held.
        assert!(
            elapsed < Duration::from_secs(40),
            "gave up after {elapsed:?}, longer than the configured bound allows"
        );

        locker.execute("ROLLBACK", []).unwrap();
        drop(locker);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_valid_backup_still_passes_its_own_finished_archive_check() {
        let root = scratch("verified-finish");
        let elsewhere = scratch("verified-finish-out");
        write_database(&root.join(DB_FILES[0]), "her real record");
        let archive = elsewhere.join("verified.hfdbackup");

        let info = write_complete_backup_from_database(
            &root,
            &archive,
            "0.2.0",
            &root.join(DB_FILES[0]),
            false,
            true,
            None,
        )
        .unwrap();
        assert!(archive.is_file());
        assert_eq!(info.app_version, "0.2.0");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_failed_rewrite_leaves_an_existing_backup_exactly_as_it_was() {
        let root = scratch("preserve-existing");
        let elsewhere = scratch("preserve-existing-out");
        write_database(&root.join(DB_FILES[0]), "the real record");
        let archive = elsewhere.join("her-flight-deck.hfdbackup");

        // A first, successful backup already exists at the destination.
        write_complete_backup(&root, &archive, "0.2.0").unwrap();
        let original_bytes = std::fs::read(&archive).unwrap();

        // A second attempt whose database is damaged must fail its
        // pre-rename integrity check — and never touch the file already
        // sitting at the destination.
        std::fs::write(root.join(DB_FILES[0]), b"not a database").unwrap();
        let result = write_complete_backup_from_database(
            &root,
            &archive,
            "0.2.0",
            &root.join(DB_FILES[0]),
            false,
            true,
            None,
        );
        assert!(result.is_err());

        assert_eq!(std::fs::read(&archive).unwrap(), original_bytes);
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());
        assert!(!PathBuf::from(format!("{}.replaced", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn archive_names_reject_windows_streams_and_excessive_lengths() {
        assert!(validate_archive_path(
            "documents/handbook.pdf",
            Path::new("documents/handbook.pdf")
        )
        .is_ok());
        assert!(validate_archive_path(
            "documents/handbook.pdf:hidden",
            Path::new("documents/handbook.pdf:hidden")
        )
        .is_err());
        let long = format!(
            "documents/{}.pdf",
            "x".repeat(MAX_ARCHIVE_COMPONENT_BYTES + 1)
        );
        assert!(validate_archive_path(&long, Path::new(&long)).is_err());
    }

    #[test]
    fn extreme_compression_ratios_are_refused() {
        assert!(validate_compression_ratio(1024, 1).is_ok());
        assert!(validate_compression_ratio(2 * 1024 * 1024, 1024).is_err());
        assert!(validate_compression_ratio(2 * 1024 * 1024, 0).is_err());
    }

    #[test]
    fn an_install_failure_after_protection_restores_current_data() {
        let root = scratch("install-rollback");
        let elsewhere = scratch("install-rollback-out");
        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("rollback.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        write_database(&root.join(DB_FILES[0]), "current data");
        write_document(&root, "handbook.pdf", "current document");
        stage_complete_restore_in(&root, &archive, "0.5.1").unwrap();

        let error = apply_pending_restore_in_with(&root, || {
            Err("injected failure before install".to_string())
        })
        .unwrap_err();
        assert!(error.contains("previous data was recovered"), "{error}");
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "current data");
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("current document")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_referenced_file_disappearing_after_the_database_snapshot_is_refused() {
        let root = scratch("disappearing-doc");
        let elsewhere = scratch("disappearing-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("disappearing.hfdbackup");

        let pre_docs = scan_active_documents(&root.join(DOCUMENTS_DIR)).unwrap();
        let snapshot = database_snapshot_with_retry(&root).unwrap();

        // The referenced document is deleted after the snapshot and before collection
        std::fs::remove_file(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap();

        let result = write_complete_backup_from_database(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            Some(&pre_docs),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when referenced file disappeared after snapshot"
        );
        match result.unwrap_err() {
            BackupExportError::Transient(err) => {
                assert!(
                    err.contains("disappeared") || err.contains("handbook.pdf"),
                    "Expected transient disappearance error, got: {err}"
                );
            }
            BackupExportError::Permanent(err) => {
                panic!("Expected Transient error, got Permanent: {err}");
            }
        }
        assert!(!archive.exists());
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_referenced_file_disappearing_during_collection_is_refused() {
        let root = scratch("disappearing-mid-doc");
        let elsewhere = scratch("disappearing-mid-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("disappearing-mid.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                let _ = std::fs::remove_file(root_for_hook.join(DOCUMENTS_DIR).join(doc_name));
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when referenced file disappeared during collection"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("disappeared")
                || err.contains("missing")
                || err.contains("Could not read")
                || err.contains("changed"),
            "Expected disappearance/change error, got: {err}"
        );
        assert!(!archive.exists());
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_new_import_or_split_appearing_after_the_snapshot_is_refused() {
        let root = scratch("extra-doc");
        let elsewhere = scratch("extra-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("extra.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        // A new import or split part appears on disk while export is in flight
        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                std::fs::write(
                    root_for_hook.join(DOCUMENTS_DIR).join("part-2.pdf"),
                    "split part 2",
                )
                .unwrap();
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when extra unreferenced document appeared during export"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("changed on disk") || err.contains("changed"),
            "Expected in-flight change error, got: {err}"
        );
        assert!(!archive.exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_document_changing_during_collection_is_detected_and_refused() {
        let root = scratch("changing-doc");
        let elsewhere = scratch("changing-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "initial content");
        let archive = elsewhere.join("changing.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                let doc_path = root_for_hook.join(DOCUMENTS_DIR).join(doc_name);
                std::fs::write(doc_path, "modified content during read").unwrap();
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when document changed during collection"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("changed during export") || err.contains("changed on disk"),
            "Expected change error, got: {err}"
        );
        assert!(!archive.exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_failed_retry_leaves_an_existing_valid_backup_untouched() {
        let root = scratch("failed-retry-preserve");
        let elsewhere = scratch("failed-retry-preserve-out");
        write_database(&root.join(DB_FILES[0]), "stable db");
        write_document(&root, "handbook.pdf", "stable document");
        let archive = elsewhere.join("valid-backup.hfdbackup");

        // 1. Create a valid initial backup
        create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert!(archive.is_file());
        let original_bytes = std::fs::read(&archive).unwrap();

        // 2. Now simulate a persistent failure: remove the database
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();

        // 3. Running complete backup should exhaust bounded retries and fail
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(
            result.is_err(),
            "Backup must fail when database snapshot persistently fails"
        );

        // 4. Verify existing backup at destination is completely untouched and intact
        assert_eq!(std::fs::read(&archive).unwrap(), original_bytes);
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());
        assert!(!PathBuf::from(format!("{}.replaced", archive.to_string_lossy())).exists());

        // And it still passes inspection
        inspect_archive(&root, &archive, "0.5.2").unwrap();

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_stable_database_and_document_set_exports_and_restores_successfully() {
        let root = scratch("stable-export-restore");
        let elsewhere = scratch("stable-export-restore-out");
        let restore_target = scratch("stable-export-restore-target");
        write_database(&root.join(DB_FILES[0]), "production training record");
        write_document(&root, "handbook.pdf", "chapter 1");
        write_document(&root, "lessons/brief.png", "briefing notes");
        let archive = elsewhere.join("stable.hfdbackup");

        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.files, 3); // db + 2 documents
        assert!(archive.is_file());

        // Proves format-v2 database and document completeness verification passes
        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(inspected.files, 3);

        // Proves restore extracts cleanly
        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 3);
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DB_FILES[0])
            .is_file());
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DOCUMENTS_DIR)
            .join("lessons/brief.png")
            .is_file());

        apply_pending_restore_in(&restore_target).unwrap();
        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("lessons/brief.png")
            .is_file());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn format_v3_inspection_proves_database_and_document_completeness() {
        let root = scratch("completeness-test");
        let elsewhere = scratch("completeness-test-out");
        write_database(&root.join(DB_FILES[0]), "db record");
        write_document(&root, "handbook.pdf", "chapter 1");
        let archive = elsewhere.join("incomplete.hfdbackup");

        // Craft an archive where the document is missing from the archive but in DB
        let db_with_ref = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);
        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION,
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();
        let saved_db = add_file_to_archive(&mut zip, &db_with_ref, DB_FILES[0]).unwrap();
        let integrity = vec![saved_db];
        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // Database references handbook.pdf, but archive contains NO documents.
        // Format-v3 inspection MUST refuse this archive!
        let error = inspect_archive(&root, &archive, "0.5.2").unwrap_err();
        assert!(
            error.contains("missing from the archive"),
            "Expected missing document completeness error, got: {error}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn export_with_missing_referenced_file_succeeds_and_restores_cleanly() {
        let root = scratch("missing-doc-export");
        let elsewhere = scratch("missing-doc-export-out");
        let restore_target = scratch("missing-doc-export-target");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook bytes");

        // Reference a missing file in the database without creating it in documents/
        let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, file_path) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
            params!["missing-notes.pdf", "missing-notes.pdf"],
        )
        .unwrap();
        drop(conn);

        let archive = elsewhere.join("missing.hfdbackup");
        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(
            info.missing_documents,
            vec!["missing-notes.pdf".to_string()]
        );
        assert_eq!(info.files, 2); // db + handbook.pdf

        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(
            inspected.missing_documents,
            vec!["missing-notes.pdf".to_string()]
        );
        assert_eq!(inspected.files, 2);

        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 2);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("missing-notes.pdf")
            .exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn export_with_unreferenced_orphan_file_succeeds_and_excludes_orphan() {
        let root = scratch("orphan-doc-export");
        let elsewhere = scratch("orphan-doc-export-out");
        let restore_target = scratch("orphan-doc-export-target");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook bytes");

        // Create an unreferenced file directly on disk without referencing it in DB
        std::fs::write(
            root.join(DOCUMENTS_DIR).join("orphan.pdf"),
            "unreferenced bytes",
        )
        .unwrap();

        let archive = elsewhere.join("orphan.hfdbackup");
        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.unreferenced_documents, vec!["orphan.pdf".to_string()]);
        assert_eq!(info.files, 2); // db + handbook.pdf (orphan excluded)

        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(inspected.files, 2);

        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 2);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("orphan.pdf")
            .exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn export_refuses_referenced_document_with_deletion_in_progress_and_retries_transiently() {
        let root = scratch("deletion-in-progress-export");
        let elsewhere = scratch("deletion-in-progress-export-out");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "in progress deletion test");

        // Insert reference into database but do not create file in documents/
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('1', 'staged-doc.pdf')",
                [],
            )
            .unwrap();
        }

        // Stage the document in documents/.trash
        let trash = root.join(DOCUMENTS_DIR).join(crate::documents::TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join("del-1.data"), "staged file content").unwrap();
        let meta = crate::documents::StagedDeletion {
            staged_id: "del-1".to_string(),
            original_relative_path: "staged-doc.pdf".to_string(),
            already_missing: false,
        };
        std::fs::write(
            trash.join("del-1.meta"),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        let archive = elsewhere.join("in-progress.hfdbackup");

        // 1. Single attempt: a referenced file that exists only as a staged .data+.meta in .trash
        // causes the attempt to return Transient
        let single_attempt = write_complete_backup_from_database(
            &root, &archive, "0.5.2", &db_path, false, true, None,
        );
        match single_attempt {
            Err(BackupExportError::Transient(msg)) => {
                assert!(
                    msg.contains("deletion was in progress"),
                    "Expected transient message explaining deletion in progress, got: {msg}"
                );
            }
            other => panic!("Expected Transient error, got: {other:?}"),
        }

        // 2. Full export with retry: when the staged deletion persists across all retries,
        // the final error explains that a deletion was in progress.
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(result.is_err(), "Export must fail across retries");
        let err = result.unwrap_err();
        assert!(
            err.contains("deletion was in progress"),
            "Final error must explain deletion was in progress, got: {err}"
        );
        assert!(!archive.exists(), "Archive must not exist on failure");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn export_refuses_referenced_document_when_trash_metadata_is_corrupt_and_retries_transiently() {
        let root = scratch("corrupt-trash-meta-export");
        let elsewhere = scratch("corrupt-trash-meta-export-out");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "corrupt trash metadata test");

        // Reference a document in the database that is not in documents/
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('1', 'staged-doc.pdf')",
                [],
            )
            .unwrap();
        }

        // Stage file in trash but with corrupt/malformed metadata
        let trash = root.join(DOCUMENTS_DIR).join(crate::documents::TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join("del-1.data"), "staged document bytes").unwrap();
        std::fs::write(trash.join("del-1.meta"), "{ malformed json: not valid }").unwrap();

        let archive = elsewhere.join("corrupt-meta.hfdbackup");

        // 1. Single attempt: fails with Transient error when trash cannot be inspected reliably
        let single_attempt = write_complete_backup_from_database(
            &root, &archive, "0.5.2", &db_path, false, true, None,
        );
        match single_attempt {
            Err(BackupExportError::Transient(msg)) => {
                assert!(
                    msg.contains("staged deletion metadata"),
                    "Expected transient error indicating metadata problem, got: {msg}"
                );
            }
            other => panic!("Expected Transient error, got: {other:?}"),
        }

        // 2. Full export with retry: fails safely and boundedly, with no archive finalized
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(result.is_err(), "Export must fail across retries");
        let err = result.unwrap_err();
        assert!(
            err.contains("staged deletion metadata"),
            "Final error must explain metadata inspection failure, got: {err}"
        );
        assert!(!archive.exists(), "Archive must not exist on failure");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn format_v2_with_unreferenced_document_inspects_and_restores_cleanly() {
        let root = scratch("v2-unreferenced-restore");
        let elsewhere = scratch("v2-unreferenced-restore-out");
        let restore_target = scratch("v2-unreferenced-restore-target");
        write_database(&root.join(DB_FILES[0]), "valid v2 db");
        write_document(&root, "handbook.pdf", "handbook contents");

        // Create an unreferenced file on disk
        let orphan_path = root.join(DOCUMENTS_DIR).join("unreferenced.pdf");
        std::fs::write(&orphan_path, "old style unreferenced document in v2").unwrap();

        let archive = elsewhere.join("old-v2.hfdbackup");

        // Construct a valid v2 archive containing both handbook.pdf and unreferenced.pdf
        let db_path = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: V2_ARCHIVE_VERSION,
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        let saved_orphan =
            add_file_to_archive(&mut zip, &orphan_path, "documents/unreferenced.pdf").unwrap();
        integrity.push(saved_orphan);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // 1. Proves inspection succeeds for valid old-style v2 archive with an unreferenced document
        let info = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.files, 3); // db + handbook.pdf + unreferenced.pdf
        assert_eq!(
            info.unreferenced_documents,
            vec!["unreferenced.pdf".to_string()]
        );

        // 2. Proves restore succeeds
        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 3);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("unreferenced.pdf")
            .is_file());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn format_v3_with_unreferenced_document_fails_inspection() {
        let root = scratch("v3-unreferenced-inspection");
        let elsewhere = scratch("v3-unreferenced-inspection-out");
        write_database(&root.join(DB_FILES[0]), "valid v3 db");
        write_document(&root, "handbook.pdf", "handbook contents");

        let orphan_path = root.join(DOCUMENTS_DIR).join("unreferenced.pdf");
        std::fs::write(&orphan_path, "unreferenced document in v3").unwrap();

        let archive = elsewhere.join("v3-with-unreferenced.hfdbackup");
        let db_path = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION, // v3
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        let saved_orphan =
            add_file_to_archive(&mut zip, &orphan_path, "documents/unreferenced.pdf").unwrap();
        integrity.push(saved_orphan);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        let err = inspect_archive(&root, &archive, "0.5.2").unwrap_err();
        assert!(
            err.contains("contains an unreferenced document: unreferenced.pdf"),
            "Expected unreferenced document error, got: {err}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn old_style_format_v2_with_missing_referenced_document_inspects_and_restores_with_warning() {
        let root = scratch("old-v2-missing-doc-root");
        let elsewhere = scratch("old-v2-missing-doc-out");
        let restore_target = scratch("old-v2-missing-doc-target");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "old v2 with missing doc");

        let connection = Connection::open(&db_path).unwrap();
        connection
            .execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('mat-1', 'present.pdf')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('mat-2', 'missing.pdf')",
                [],
            )
            .unwrap();
        drop(connection);

        let present_content = "content of present file";
        write_document(&root, "present.pdf", present_content);

        // 1. Construct an old-style format-v2 archive:
        // - formatVersion: 2
        // - NO missing_at_export field in manifest.json
        // - Valid integrity.json containing records for the files present in the archive
        // - Database references missing.pdf which is NOT in the archive
        let old_v2_archive = elsewhere.join("old-v2-missing.hfdbackup");
        let output = File::create(&old_v2_archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let old_manifest_json = r#"{
  "format": "her-flight-deck-complete-backup",
  "formatVersion": 2,
  "appVersion": "0.5.1",
  "createdAt": 1700000000
}"#;
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(old_manifest_json.as_bytes()).unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("present.pdf"),
            "documents/present.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // 2. Prove inspection succeeds and discloses the missing reference in restore info
        let info = inspect_archive(&root, &old_v2_archive, "0.5.2")
            .expect("old-style v2 archive must inspect successfully");
        assert_eq!(info.files, 2); // her-flight-deck.db + documents/present.pdf
        assert_eq!(info.missing_documents, vec!["missing.pdf".to_string()]);

        // 3. Prove restore succeeds and present files retain their exact bytes
        let staged = stage_complete_restore_in(&restore_target, &old_v2_archive, "0.5.2")
            .expect("old-style v2 archive must stage successfully");
        assert_eq!(staged.files, 2);
        assert_eq!(staged.missing_documents, vec!["missing.pdf".to_string()]);

        apply_pending_restore_in(&restore_target)
            .expect("old-style v2 archive must apply successfully");
        assert!(restore_target.join(DB_FILES[0]).is_file());
        let restored_present = restore_target.join(DOCUMENTS_DIR).join("present.pdf");
        assert!(restored_present.is_file());
        let read_back = std::fs::read_to_string(&restored_present).unwrap();
        assert_eq!(read_back, present_content);
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("missing.pdf")
            .exists());

        // 4. Prove a newly created archive (v3) that unexpectedly omits a referenced file fails validation
        let new_v3_archive = elsewhere.join("new-v3-unexpected-omission.hfdbackup");
        let output = File::create(&new_v3_archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let new_manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION, // 3
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(), // unexpectedly undeclared omission!
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&new_manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity_v3 = Vec::new();
        let saved_db_v3 = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity_v3.push(saved_db_v3);
        let saved_doc_v3 = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("present.pdf"),
            "documents/present.pdf",
        )
        .unwrap();
        integrity_v3.push(saved_doc_v3);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity_v3,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        let err = inspect_archive(&root, &new_v3_archive, "0.5.2").expect_err(
            "new archive omitting referenced file without declaration must fail validation",
        );
        assert!(
            err.contains("missing from the archive"),
            "Expected completeness error, got: {err}"
        );
        assert!(
            err.contains("missing.pdf"),
            "Expected mention of missing.pdf, got: {err}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn audit_failed_rollback_must_retain_original_database() {
        let root = scratch("audit-failed-rollback");
        let elsewhere = scratch("audit-failed-rollback-out");
        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("rollback.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current data");
        write_document(&root, "handbook.pdf", "current document");

        let current_db_bytes = std::fs::read(root.join(DB_FILES[0])).unwrap();
        let current_db_hash = sha256_digest(&current_db_bytes);
        let current_doc_bytes =
            std::fs::read(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap();
        let current_doc_hash = sha256_digest(&current_doc_bytes);

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();
        let error = apply_pending_restore_in_with(&root, || {
            std::fs::create_dir(root.join(DB_FILES[0])).unwrap();
            Err("injected install failure and rollback destination obstruction".to_string())
        })
        .unwrap_err();

        // 1. Error message must NOT claim previous data was recovered
        assert!(
            !error.contains("previous data was recovered"),
            "Error falsely claimed recovery succeeded when destination was obstructed: {error}"
        );

        // 2. The original database and documents must be retained in an identifiable recovery location
        let mut original_db_retained = false;
        let mut original_doc_retained = false;
        if let Ok(entries) = std::fs::read_dir(root.join(BACKUP_DIR)) {
            for entry in entries.filter_map(Result::ok) {
                let db_path = entry.path().join(DB_FILES[0]);
                if db_path.is_file() {
                    let bytes = std::fs::read(&db_path).unwrap();
                    if sha256_digest(&bytes) == current_db_hash {
                        original_db_retained = true;
                    }
                }
                let doc_path = entry.path().join(DOCUMENTS_DIR).join("handbook.pdf");
                if doc_path.is_file() {
                    let bytes = std::fs::read(&doc_path).unwrap();
                    if sha256_digest(&bytes) == current_doc_hash {
                        original_doc_retained = true;
                    }
                }
            }
        }

        assert!(
            original_db_retained,
            "Failed rollback must keep the original database in an identifiable recovery location with matching hash"
        );
        assert!(
            original_doc_retained,
            "Failed rollback must keep the original documents in an identifiable recovery location with matching hash"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn audit_document_return_obstruction_retains_document_and_db_wal() {
        let root = scratch("doc-obstruction-test");
        let elsewhere = scratch("doc-obstruction-out");

        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("backup.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        write_document(&root, "handbook.pdf", "current active document");
        let orig_doc_hash =
            sha256_digest(&std::fs::read(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap());

        let source = scratch("doc-obstruction-source");
        write_database(&source.join(DB_FILES[0]), "current active data");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute("UPDATE audit_payload SET value = 'active wal data'", [])
            .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        for name in DB_FILES {
            if source.join(name).is_file() {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
        }
        let orig_db_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let orig_wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());
        drop(conn);
        std::fs::remove_dir_all(&source).unwrap();
        assert!(root.join(DB_FILES[1]).is_file());

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        // Obstruct document return during rollback by creating an unexpected file at documents/
        let error = apply_pending_restore_in_with(&root, || {
            // Create a conflicting file at root/documents path so rollback cannot return documents
            std::fs::write(root.join(DOCUMENTS_DIR), b"blocking document return").unwrap();
            Err("injected install failure with doc return obstruction".to_string())
        })
        .unwrap_err();

        assert!(!error.contains("previous data was recovered"), "{error}");
        assert!(
            error.contains("recovery rollback could not return original data"),
            "{error}"
        );

        // Original database, WAL, and documents must be retained in the rollback directory
        let mut found_db = false;
        let mut found_wal = false;
        let mut found_doc = false;
        let backups = list_backups_in(&root).unwrap();
        assert!(!backups.is_empty());
        for b in backups {
            let p = PathBuf::from(b.path);
            let db_file = p.join(DB_FILES[0]);
            if db_file.is_file() && sha256_digest(&std::fs::read(&db_file).unwrap()) == orig_db_hash
            {
                found_db = true;
            }
            let wal_file = p.join(DB_FILES[1]);
            if wal_file.is_file()
                && sha256_digest(&std::fs::read(&wal_file).unwrap()) == orig_wal_hash
            {
                found_wal = true;
            }
            let doc_file = p.join(DOCUMENTS_DIR).join("handbook.pdf");
            if doc_file.is_file()
                && sha256_digest(&std::fs::read(&doc_file).unwrap()) == orig_doc_hash
            {
                found_doc = true;
            }
        }
        assert!(
            found_db,
            "Protected DB must be preserved with exact original hash"
        );
        assert!(
            found_wal,
            "Protected WAL must be preserved with exact original hash"
        );
        assert!(
            found_doc,
            "Protected documents must be preserved with exact original hash"
        );

        // Startup decision on this obstructed state must be BlockedUnresolved
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::BlockedUnresolved {
                reason,
                recovery_folder,
            } => {
                assert!(recovery_folder.is_some());
                assert!(reason.contains("recovery rollback could not return original data"));
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_failure_after_partial_protection_and_partial_install() {
        let root = scratch("partial-prot-inst");
        let elsewhere = scratch("partial-prot-inst-out");

        // Subtest A: Failure during protection returns whatever moved
        write_database(&root.join(DB_FILES[0]), "active original db");
        write_document(&root, "handbook.pdf", "active original doc");

        let rollback = root.join("backups").join("before-restore-test");
        std::fs::create_dir_all(&rollback).unwrap();
        // Move db to rollback as if protection partially completed
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-test".to_string(), true);
        journal.protected_db_files.push(DB_FILES[0].to_string());
        journal
            .original_db_artifacts
            .push(round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0]));
        journal.protected_documents = false; // documents were not moved yet
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentWithContent);
        journal.original_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        journal.phase = RestorePhase::Protecting;
        write_journal(&root, &journal).unwrap();

        // Rollback should put the database back into root
        execute_rollback(&root, &mut journal).unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "active original db"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("active original doc")
        );

        // Subtest B: Failure after DB is installed from pending
        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "handbook.pdf", "backup doc");
        let archive = elsewhere.join("backup.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        write_database(&root.join(DB_FILES[0]), "active db v2");
        write_document(&root, "handbook.pdf", "active doc v2");
        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        // Simulate protection done
        let rollback2 = root.join("backups").join("before-restore-test2");
        std::fs::create_dir_all(&rollback2).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback2.join(DB_FILES[0])).unwrap();
        std::fs::rename(root.join(DOCUMENTS_DIR), rollback2.join(DOCUMENTS_DIR)).unwrap();

        // Simulate DB installed from pending
        std::fs::rename(pending.join(DB_FILES[0]), root.join(DB_FILES[0])).unwrap();

        let mut journal2 = RestoreJournal::new("backups/before-restore-test2".to_string(), true);
        journal2.protected_db_files.push(DB_FILES[0].to_string());
        journal2.original_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(rollback2.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(rollback2.join(DB_FILES[0]))
                .unwrap()
                .len(),
        });
        journal2.protected_documents = true;
        journal2.original_documents_presence = Some(OriginalDocumentsPresence::PresentWithContent);
        journal2.original_document_artifacts =
            inventory_directory_artifacts(&rollback2.join(DOCUMENTS_DIR)).unwrap();
        journal2.installed_db_files.push(DB_FILES[0].to_string());
        journal2.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        });
        journal2.phase = RestorePhase::Activating;
        write_journal(&root, &journal2).unwrap();

        // Rollback should uninstall installed db and return original db and documents
        execute_rollback(&root, &mut journal2).unwrap();
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db v2");
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("active doc v2")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_db_wal_shm_documents_never_silently_mixed() {
        let root = scratch("no-silent-mix");
        let elsewhere = scratch("no-silent-mix-out");

        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "handbook.pdf", "backup doc");
        let archive = elsewhere.join("archive.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        // Active dataset with distinct DB, WAL, SHM, and documents
        write_database(&root.join(DB_FILES[0]), "original active db");
        let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original active db in wal'",
            [],
        )
        .unwrap();
        drop(conn);
        write_document(&root, "handbook.pdf", "original active doc");

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        let err =
            apply_pending_restore_in_with(&root, || Err("injected install error".to_string()))
                .unwrap_err();

        assert!(err.contains("previous data was recovered"), "{err}");

        // Check active files are 100% original dataset
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original active db in wal"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("original active doc")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_successful_complete_and_database_only_restores_keep_contracts() {
        let root = scratch("contracts-test");
        let elsewhere = scratch("contracts-out");

        // 1. Complete restore replaces DB and documents
        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "doc.pdf", "backup doc");
        let complete_archive = elsewhere.join("complete.hfdbackup");
        write_complete_backup(&root, &complete_archive, "0.5.3").unwrap();

        write_database(&root.join(DB_FILES[0]), "active db");
        write_document(&root, "doc.pdf", "active doc");
        stage_complete_restore_in(&root, &complete_archive, "0.5.3").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(database_contents(&root.join(DB_FILES[0])), "backup db");
        assert_eq!(
            document_contents(&root, "doc.pdf").as_deref(),
            Some("backup doc")
        );

        // 2. Safety copy (database-only restore) replaces database but preserves existing documents
        write_database(&root.join(DB_FILES[0]), "safety db");
        let safety_folder = root.join("backups").join("manual-safety-test");
        std::fs::create_dir_all(&safety_folder).unwrap();
        std::fs::copy(root.join(DB_FILES[0]), safety_folder.join(DB_FILES[0])).unwrap();

        write_database(&root.join(DB_FILES[0]), "active db 2");
        write_document(&root, "user-upload.pdf", "preserve my document");

        stage_local_restore_in(&root, "manual-safety-test").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(database_contents(&root.join(DB_FILES[0])), "safety db");
        assert_eq!(
            document_contents(&root, "user-upload.pdf").as_deref(),
            Some("preserve my document")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_pruning_cannot_discard_unresolved_recovery_folder() {
        let root = scratch("pruning-retention");
        let bdir = root.join("backups");
        std::fs::create_dir_all(&bdir).unwrap();

        // Create 15 regular backup folders
        for i in 1..=15 {
            let folder = bdir.join(format!("2026-09-01-{i:02}0000-auto"));
            std::fs::create_dir_all(&folder).unwrap();
            write_database(&folder.join(DB_FILES[0]), &format!("auto db {i}"));
        }

        // Create an unresolved recovery rollback folder with an older timestamp
        let recovery_folder = bdir.join("2026-08-01-000000-before-restore");
        std::fs::create_dir_all(&recovery_folder).unwrap();
        write_database(&recovery_folder.join(DB_FILES[0]), "precious original db");
        write_document(&recovery_folder, "notes.pdf", "precious notes");
        std::fs::write(recovery_folder.join(".recovery-pending"), b"pending").unwrap();

        // Also record a journal referencing it
        let journal = RestoreJournal {
            operation_id: "op-prune-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/2026-08-01-000000-before-restore".to_string(),
            replace_documents: true,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: true,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("test obstruction".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Run prune
        prune(&root).unwrap();

        // The precious recovery folder MUST NOT be pruned!
        assert!(
            recovery_folder.exists(),
            "Pruning must never delete unresolved recovery folder"
        );
        assert_eq!(
            database_contents(&recovery_folder.join(DB_FILES[0])),
            "precious original db"
        );
        assert_eq!(
            document_contents(&recovery_folder, "notes.pdf").as_deref(),
            Some("precious notes")
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_interrupted_states_resume_safely_on_startup() {
        let root = scratch("interrupted-states");

        // Case 1: Interrupted at Protected state
        write_database(&root.join(DB_FILES[0]), "active db");
        let rollback1 = root.join("backups").join("before-restore-case1");
        std::fs::create_dir_all(&rollback1).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback1.join(DB_FILES[0])).unwrap();

        let journal1 = RestoreJournal {
            operation_id: "op-interrupted-case1".to_string(),
            phase: RestorePhase::Protected,
            rollback_rel_path: "backups/before-restore-case1".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: sha256_digest(&std::fs::read(rollback1.join(DB_FILES[0])).unwrap()),
                size: std::fs::metadata(rollback1.join(DB_FILES[0]))
                    .unwrap()
                    .len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal1).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        // Case 2: Interrupted at Activating state after DB installed
        let rollback2 = root.join("backups").join("before-restore-case2");
        std::fs::create_dir_all(&rollback2).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback2.join(DB_FILES[0])).unwrap();
        write_database(&root.join(DB_FILES[0]), "partially installed db");

        let orig_ident2 = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(rollback2.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(rollback2.join(DB_FILES[0]))
                .unwrap()
                .len(),
        };
        let staged_ident2 = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        };
        let journal2 = RestoreJournal {
            operation_id: "op-interrupted-case2".to_string(),
            phase: RestorePhase::Activating,
            rollback_rel_path: "backups/before-restore-case2".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![DB_FILES[0].to_string()],
            installed_documents: false,
            original_db_artifacts: vec![orig_ident2],
            staged_db_artifacts: vec![staged_ident2],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal2).unwrap();

        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db");

        // Case 3: Interrupted at Committed state with pending cleanup lingering
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::write(pending.join("leftover.tmp"), b"leftover").unwrap();
        let plan3 = RestorePlan {
            operation_id: "op-interrupted-case3".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan3).unwrap(),
        )
        .unwrap();

        let journal3 = RestoreJournal {
            operation_id: "op-interrupted-case3".to_string(),
            phase: RestorePhase::Committed,
            rollback_rel_path: "backups/before-restore-case3".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal3).unwrap();

        let decision3 = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision3, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_repeated_startup_on_unresolved_recovery_is_idempotent() {
        let root = scratch("repeated-startup");
        write_database(&root.join(DB_FILES[0]), "original active db");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let rollback = root.join("backups").join("before-restore-repeat");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        // Obstruct root destination
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap();

        let journal = RestoreJournal {
            operation_id: "op-repeat-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-repeat".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: orig_hash.clone(),
                size: std::fs::metadata(rollback.join(DB_FILES[0])).unwrap().len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstructed".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Call 3 times
        for _ in 0..3 {
            let decision = handle_startup_restore_in(&root).unwrap();
            match decision {
                StartupRestoreDecision::BlockedUnresolved {
                    recovery_folder, ..
                } => {
                    assert_eq!(recovery_folder.as_ref(), Some(&rollback));
                }
                other => panic!("Expected BlockedUnresolved, got {other:?}"),
            }
            // Verify original file in rollback remains untouched
            let current_hash = sha256_digest(&std::fs::read(rollback.join(DB_FILES[0])).unwrap());
            assert_eq!(current_hash, orig_hash);
        }

        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_recovery_completes_after_obstruction_removed() {
        let root = scratch("obstruction-cleared");
        write_database(&root.join(DB_FILES[0]), "my active db before crash");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let rollback = root.join("backups").join("before-restore-clear");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        // Inject obstruction
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap();

        let journal = RestoreJournal {
            operation_id: "op-clear-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-clear".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: orig_hash.clone(),
                size: std::fs::metadata(rollback.join(DB_FILES[0])).unwrap().len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstructed".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Launch fails while obstruction present
        let decision1 = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision1,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        // User or remediation removes the obstruction
        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();

        // Next launch recovers automatically and safely
        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }

        assert!(root.join(DB_FILES[0]).is_file());
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "my active db before crash"
        );
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_malformed_journal_handled_conservatively() {
        let root = scratch("malformed-journal");

        // 1. Path traversal attempt
        let journal_traversal = r#"{
            "phase": "UnresolvedRecovery",
            "rollback_rel_path": "../../evil",
            "replace_documents": false,
            "protected_db_files": ["her-flight-deck.db"],
            "protected_documents": false,
            "installed_db_files": [],
            "installed_documents": false,
            "failure_reason": null
        }"#;
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), journal_traversal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::BlockedUnresolved { reason, .. } => {
                assert!(
                    reason.contains("validation failed")
                        || reason.contains("Invalid rollback path"),
                    "{reason}"
                );
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        // 2. Corrupted JSON
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), b"{ corrupted json").unwrap();
        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::BlockedUnresolved { reason, .. } => {
                assert!(reason.contains("corrupted or invalid"), "{reason}");
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_startup_blocks_on_unresolved_and_allows_safe_states() {
        let root = scratch("startup-decision-matrix");

        // Safe case A: Staging refused before touching data
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::write(pending.join(DB_FILES[0]), b"not a sqlite db").unwrap();
        write_database(&root.join(DB_FILES[0]), "existing safe db");

        let decision_refused = handle_startup_restore_in(&root).unwrap();
        match decision_refused {
            StartupRestoreDecision::StagingRefusedUnchanged { reason } => {
                assert!(reason.contains("not usable"), "{reason}");
            }
            other => panic!("Expected StagingRefusedUnchanged, got {other:?}"),
        }
        // Active data is unchanged
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "existing safe db"
        );

        // Unsafe case: Unresolved recovery blocks startup
        let rollback = root.join("backups").join("before-restore-matrix");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "precious db");
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap(); // obstruction

        let journal = RestoreJournal {
            operation_id: "op-matrix-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-matrix".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstruction".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        let decision_unresolved = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision_unresolved,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    /// GEN-REL-02 (GENREL02-R11): a restore that committed, then was cut off
    /// before its cleanup finished, still forgets the replaced library's
    /// Gemini jobs on the next launch, before the restore journal goes.
    #[test]
    fn a_committed_restore_forgets_gemini_jobs_even_after_an_interruption() {
        let root = scratch("gemini-jobs-after-restore");
        write_database(&root.join(DB_FILES[0]), "restored committed db");
        let job_journal = root.join(crate::gemini_jobs::JOURNAL_FILE);
        std::fs::write(
            &job_journal,
            serde_json::json!({"schema": "hfd-gemini-jobs/1", "jobs": [{
                "id": "job-aaaaaaaaaaaaaaaaaaaaaaaa", "kind": "study-aid", "materialId": "mat-a",
                "relativePath": "documents/a.pdf", "contentSha256": "x", "stage": "ready",
                "createdAt": 0, "updatedAt": 0, "result": {"title": "Before the restore"}
            }]})
            .to_string(),
        )
        .unwrap();
        let journal = RestoreJournal {
            operation_id: "op-gemini-jobs".to_string(),
            phase: RestorePhase::Committed,
            rollback_rel_path: "backups/before-restore-gemini-jobs".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal).unwrap();

        // The job journal cannot be cleared yet: the restore journal stays, so
        // the next launch tries again.
        crate::gemini_jobs::FAIL_CLEAR_FOR_TESTS
            .lock()
            .unwrap()
            .insert(root.clone());
        assert_eq!(
            handle_startup_restore_in(&root).unwrap(),
            StartupRestoreDecision::RestoreCompleted
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).exists(),
            "kept for the next launch"
        );
        assert!(std::fs::read_to_string(&job_journal)
            .unwrap()
            .contains("Before the restore"));
        // GENREL02-R14: during this launch the old answer is neither offered
        // nor saveable, and nothing new can start.
        assert!(crate::gemini_jobs::with(&root, |j| j.list()).is_empty());
        assert_eq!(
            crate::gemini_jobs::with(&root, |j| j.acknowledge("job-aaaaaaaaaaaaaaaaaaaaaaaa")),
            Ok(false)
        );
        assert_eq!(
            crate::gemini_jobs::with(&root, |j| j.begin(
                crate::gemini_jobs::JobKind::StudyAid,
                "mat-a",
                "documents/a.pdf",
                "x",
                None
            )),
            Err(crate::gemini_jobs::RESTORING.to_string())
        );

        // Next launch, with the obstruction gone.
        crate::gemini_jobs::FAIL_CLEAR_FOR_TESTS
            .lock()
            .unwrap()
            .remove(&root);
        // A fresh process: the per-folder journal is read from disk again.
        crate::gemini_jobs::forget_open_for_tests(&root);
        assert_eq!(
            handle_startup_restore_in(&root).unwrap(),
            StartupRestoreDecision::RestoreCompleted
        );
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        let left = std::fs::read_to_string(&job_journal).unwrap_or_default();
        assert!(!left.contains("Before the restore"), "{left}");
        // Once cleared, the launch is normal again.
        assert!(crate::gemini_jobs::with(&root, |j| j.begin(
            crate::gemini_jobs::JobKind::StudyAid,
            "mat-a",
            "documents/a.pdf",
            "x",
            None
        ))
        .is_ok());
        crate::gemini_jobs::forget_open_for_tests(&root);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn audit_committed_activation_with_cleanup_failure_does_not_replay() {
        let root = scratch("cleanup-no-replay");
        write_database(&root.join(DB_FILES[0]), "restored committed db");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "should not be installed again");
        let plan = RestorePlan {
            operation_id: "op-committed-cleanup".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let journal = RestoreJournal {
            operation_id: "op-committed-cleanup".to_string(),
            phase: RestorePhase::Committed,
            rollback_rel_path: "backups/before-restore-committed".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        // Active DB is STILL the committed restored db, NOT re-installed or rolled back
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "restored committed db"
        );
        assert!(!pending.exists());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn reviewer_recovered_restore_cleanup_failure_must_not_replay() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("review-recovered-cleanup");
        let elsewhere = scratch("review-recovered-cleanup-out");
        write_database(&root.join(DB_FILES[0]), "selected backup dataset");
        write_document(&root, "handbook.pdf", "selected backup document");
        let archive = elsewhere.join("selected.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current original dataset");
        write_document(&root, "handbook.pdf", "current original document");
        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        let mut held = None;
        let first_error = apply_pending_restore_in_with(&root, || {
            held = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(pending.join(DB_FILES[0]))
                    .unwrap(),
            );
            Err("injected activation failure with pending database locked against deletion".into())
        })
        .unwrap_err();
        let first_value = database_contents(&root.join(DB_FILES[0]));
        let first_document = document_contents(&root, "handbook.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).is_file();
        let pending_retained = pending.join(DB_FILES[0]).is_file();
        drop(held);
        let next = handle_startup_restore_in(&root).unwrap();
        let next_value = database_contents(&root.join(DB_FILES[0]));
        let next_document = document_contents(&root, "handbook.pdf");
        println!(
            "RECOVERED_REPLAY: first_error={first_error}; first_row={first_value}; first_document={first_document:?}; journal_retained={journal_retained}; pending_retained={pending_retained}; next={next:?}; next_row={next_value}; next_document={next_document:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert_eq!(
            next_value, "current original dataset",
            "A successfully rolled-back restore must remain cancelled after failed staging cleanup"
        );
        assert_eq!(next_document.as_deref(), Some("current original document"));
    }

    #[test]
    fn reviewer_unrecorded_wal_move_preserves_committed_rows() {
        let source = scratch("review-wal-source");
        let root = scratch("review-wal-move");
        write_database(&source.join(DB_FILES[0]), "checkpointed original row");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'committed row only in WAL'",
            [],
        )
        .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        for name in DB_FILES {
            if source.join(name).is_file() {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
        }
        let wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());
        drop(conn);
        let rollback = root.join("backups/before-restore-unrecorded-wal");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();
        let mut journal =
            RestoreJournal::new("backups/before-restore-unrecorded-wal".into(), false);
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        // Actual protection order: WAL rename succeeds, process exits before its journal update.
        std::fs::rename(root.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let wal_retained = [root.join(DB_FILES[1]), rollback.join(DB_FILES[1])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == wal_hash);
        let value = database_contents(&root.join(DB_FILES[0]));
        println!(
            "WAL_MOVE: decision={decision:?}; original_wal_retained={wal_retained}; row={value}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
        assert_eq!(
            value, "committed row only in WAL",
            "Rollback must preserve committed WAL data"
        );
    }

    #[test]
    fn reviewer_stale_rollback_journal_cannot_delete_returned_original() {
        let root = scratch("review-stale-rollback");
        write_database(
            &root.join(DB_FILES[0]),
            "original returned after failed journal update",
        );
        let original_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let rollback = root.join("backups/before-restore-stale-rollback");
        std::fs::create_dir_all(&rollback).unwrap();
        write_document(&rollback, "original.pdf", "original protected document");
        // Rollback's durable update failed, but its ignored error allowed the original DB
        // to return. A subsequent crash leaves the prior installed-files list on disk.
        let mut journal = RestoreJournal::new("backups/before-restore-stale-rollback".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        journal.installed_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let original_retained = [root.join(DB_FILES[0]), rollback.join(DB_FILES[0])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == original_hash);
        println!(
            "STALE_ROLLBACK: decision={decision:?}; original_database_retained={original_retained}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            original_retained,
            "A stale installed-files list must not delete the returned original database"
        );
    }

    #[cfg(windows)]
    #[test]
    fn reviewer_committed_cleanup_failure_must_not_replay() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("review-committed-cleanup");
        write_database(&root.join(DB_FILES[0]), "committed current dataset");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "obsolete pending dataset");
        let mut journal =
            RestoreJournal::new("backups/before-restore-committed-test".into(), false);
        journal.phase = RestorePhase::Committed;
        write_journal(&root, &journal).unwrap();
        let plan = RestorePlan {
            operation_id: journal.operation_id.clone(),
            kind: RestoreKind::Complete,
            source: "synthetic".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();
        // A genuine Windows filesystem failure: allow reads but deny deletion.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(pending.join(DB_FILES[0]))
            .unwrap();
        let first = handle_startup_restore_in(&root).unwrap();
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).is_file();
        let pending_retained = pending.join(DB_FILES[0]).is_file();
        drop(held);
        let second = handle_startup_restore_in(&root).unwrap();
        let value = database_contents(&root.join(DB_FILES[0]));
        println!(
            "CLEANUP_REPLAY: first={first:?}; committed_journal_retained={journal_retained}; pending_retained={pending_retained}; second={second:?}; row={value}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            value, "committed current dataset",
            "Cleanup failure must retain the commit decision across launches"
        );
    }

    #[test]
    fn reviewer_missing_journal_with_recovery_marker_blocks_startup() {
        let root = scratch("review-missing-journal");
        let rollback = root.join("backups/before-restore-journal-gap");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original stranded dataset");
        std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery").unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-journal-gap".into(), false);
        journal.phase = RestorePhase::UnresolvedRecovery;
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let replacement = serde_json::to_string_pretty(&journal).unwrap();
        std::fs::write(
            root.join(format!("{RESTORE_JOURNAL_FILE}.tmp-123")),
            replacement,
        )
        .unwrap();
        // Windows journal replacement deletes the old journal before renaming its temp file.
        std::fs::remove_file(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        println!(
            "MISSING_JOURNAL: decision={decision:?}; active_db_exists={}; recovery_db_exists={}",
            root.join(DB_FILES[0]).is_file(),
            rollback.join(DB_FILES[0]).is_file()
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A missing journal must not allow fresh-database startup over a known recovery set"
        );
    }

    #[test]
    fn reviewer_backups_parent_is_not_a_valid_recovery_folder() {
        let root = scratch("review-journal-parent");
        write_database(&root.join(DB_FILES[0]), "active unrelated dataset");
        let historical = root.join("backups/older-valid-safety-copy");
        std::fs::create_dir_all(&historical).unwrap();
        write_database(
            &historical.join(DB_FILES[0]),
            "valid historical safety copy",
        );
        let original_hash = sha256_digest(&std::fs::read(historical.join(DB_FILES[0])).unwrap());
        let journal = RestoreJournal::new("backups".into(), false);
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let retained = historical.join(DB_FILES[0]).is_file()
            && sha256_digest(&std::fs::read(historical.join(DB_FILES[0])).unwrap())
                == original_hash;
        println!("JOURNAL_PARENT: decision={decision:?}; historical_backup_retained={retained}");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            retained && matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Malformed journal must not delete the whole backups directory"
        );
    }

    #[test]
    fn reviewer_non_regular_journal_is_not_equivalent_to_absent() {
        let root = scratch("review-journal-directory");
        let rollback = root.join("backups/before-restore-nonregular-journal");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original stranded database");
        std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery").unwrap();
        std::fs::create_dir(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        println!(
            "NONREGULAR_JOURNAL: decision={decision:?}; active_db_exists={}",
            root.join(DB_FILES[0]).is_file()
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "An invalid journal path cannot be treated as no recovery"
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_legacy_restore_wal_is_not_mixed_with_returned_original() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round2-wal-active");
        let elsewhere = scratch("round2-wal-selected");
        write_database(&elsewhere.join(DB_FILES[0]), "selected checkpointed row");
        write_document(&elsewhere, "handbook.pdf", "selected document");
        let conn = Connection::open(elsewhere.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'selected WAL-only row'",
            [],
        )
        .unwrap();
        let archive_path = elsewhere.join("legacy-with-wal.hfdbackup");
        let mut zip = ZipWriter::new(File::create(&archive_path).unwrap());
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupManifest {
                format: ARCHIVE_FORMAT.into(),
                format_version: LEGACY_ARCHIVE_VERSION,
                app_version: "0.3.0".into(),
                created_at: 0,
                missing_at_export: vec![],
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        add_file_to_archive(&mut zip, &elsewhere.join(DB_FILES[0]), DB_FILES[0]).unwrap();
        add_file_to_archive(&mut zip, &elsewhere.join(DB_FILES[1]), DB_FILES[1]).unwrap();
        add_file_to_archive(
            &mut zip,
            &elsewhere.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        zip.finish().unwrap();
        drop(conn);
        write_database(&root.join(DB_FILES[0]), "current original row");
        // Original DB is checkpointed, with WAL mode retained but no WAL file.
        let original_conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        original_conn
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        drop(original_conn);
        assert!(!root.join(DB_FILES[1]).exists());
        write_document(&root, "handbook.pdf", "current original document");
        stage_complete_restore_in(&root, &archive_path, "0.5.3").unwrap();
        assert!(root.join(RESTORE_PENDING_DIR).join(DB_FILES[1]).is_file());
        let mut held_documents = None;
        let first = apply_pending_restore_in_with(&root, || {
            // Lock the staged directory itself so the actual document rename fails,
            // after the selected DB and WAL have already installed.
            held_documents = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .custom_flags(0x02000000)
                    .open(root.join(RESTORE_PENDING_DIR).join(DOCUMENTS_DIR))
                    .unwrap(),
            );
            Ok(())
        })
        .unwrap_err();
        drop(held_documents);
        let second = handle_startup_restore_in(&root).unwrap();
        let wal_left = root.join(DB_FILES[1]).is_file();
        let value = database_contents(&root.join(DB_FILES[0]));
        let doc = document_contents(&root, "handbook.pdf");
        println!("ROUND2_MIXED_WAL: first_error={first}; decision={second:?}; restored_wal_left_with_original_db={wal_left}; row={value}; doc={doc:?}");
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert_eq!(
            value, "current original row",
            "A staged legacy WAL must never replay into the returned original database"
        );
        assert_eq!(doc.as_deref(), Some("current original document"));
    }

    #[cfg(windows)]
    #[test]
    fn round2_failed_terminal_journal_removal_cannot_discard_new_restore() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round2-new-stage");
        let elsewhere = scratch("round2-new-stage-out");
        let second_source = scratch("round2-new-stage-second-source");
        write_database(&root.join(DB_FILES[0]), "first selected row");
        let first_archive = elsewhere.join("first.hfdbackup");
        write_complete_backup(&root, &first_archive, "0.5.3").unwrap();
        write_database(
            &second_source.join(DB_FILES[0]),
            "second explicitly requested row",
        );
        let second_archive = elsewhere.join("second.hfdbackup");
        write_complete_backup(&second_source, &second_archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current original row");
        stage_complete_restore_in(&root, &first_archive, "0.5.3").unwrap();
        let mut staged_db_lock = None;
        let _ = apply_pending_restore_in_with(&root, || {
            staged_db_lock = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(root.join(RESTORE_PENDING_DIR).join(DB_FILES[0]))
                    .unwrap(),
            );
            Err("injected first install failure".into())
        })
        .unwrap_err();
        drop(staged_db_lock);
        let old_id = read_journal(&root).unwrap().unwrap().operation_id;
        let held_journal = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(root.join(RESTORE_JOURNAL_FILE))
            .unwrap();
        let stage_result = stage_complete_restore_in(&root, &second_archive, "0.5.3");
        let new_id = if root.join(RESTORE_PENDING_DIR).join(RESTORE_PLAN).exists() {
            read_restore_plan(&root.join(RESTORE_PENDING_DIR)).operation_id
        } else {
            String::new()
        };
        let accepted = stage_result.is_ok();
        drop(held_journal);
        let decision = handle_startup_restore_in(&root).unwrap();
        let value = database_contents(&root.join(DB_FILES[0]));
        let pending_left = root.join(RESTORE_PENDING_DIR).exists();
        println!("ROUND2_NEW_STAGE: accepted={accepted}; old_id={old_id}; new_id={new_id}; decision={decision:?}; pending_left={pending_left}; row={value}");
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&second_source).unwrap();
        assert!(
            !accepted || value == "second explicitly requested row" || pending_left,
            "An old terminal operation must not silently delete an accepted new restore"
        );
    }

    #[test]
    fn round2_unidentified_regular_destination_is_not_deleted() {
        let root = scratch("round2-unidentified-db");
        write_database(&root.join(DB_FILES[0]), "unrelated replacement dataset");
        let unknown_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let rollback = root.join("backups/before-restore-unidentified");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "protected original dataset");
        let mut journal = RestoreJournal::new("backups/before-restore-unidentified".into(), false);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.installed_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let preserved = [root.join(DB_FILES[0]), rollback.join(DB_FILES[0])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == unknown_hash);
        println!(
            "ROUND2_UNKNOWN_DB: decision={decision:?}; unrelated_database_preserved={preserved}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(preserved, "A filename and presence of a rollback file cannot establish that the active file is disposable staged data");
    }

    #[cfg(windows)]
    fn round2_make_junction(link: &Path, target: &Path) {
        let quote = |path: &Path| path.to_string_lossy().replace('\'', "''");
        let script = format!("$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null", quote(link), quote(target));
        let out = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "Could not create disposable junction: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_dangling_journal_is_not_treated_as_absent() {
        let root = scratch("round2-dangling-journal");
        let elsewhere = scratch("round2-dangling-journal-out");
        let target = elsewhere.join("empty-target");
        std::fs::create_dir(&target).unwrap();
        round2_make_junction(&root.join(RESTORE_JOURNAL_FILE), &target);
        std::fs::remove_dir(&target).unwrap();
        assert!(std::fs::symlink_metadata(root.join(RESTORE_JOURNAL_FILE)).is_ok());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        let decision = handle_startup_restore_in(&root).unwrap();
        println!("ROUND2_DANGLING_JOURNAL: decision={decision:?}");
        std::fs::remove_dir(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A dangling reparse point at the journal path is not absent state"
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_linked_recovery_documents_do_not_enter_active_storage() {
        let root = scratch("round2-linked-documents");
        let elsewhere = scratch("round2-linked-documents-out");
        write_document(&elsewhere, "external.txt", "external document sentinel");
        let rollback = root.join("backups/before-restore-linked-docs");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "protected original dataset");
        round2_make_junction(
            &rollback.join(DOCUMENTS_DIR),
            &elsewhere.join(DOCUMENTS_DIR),
        );
        let mut journal = RestoreJournal::new("backups/before-restore-linked-docs".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let active_link = root.join(DOCUMENTS_DIR).exists();
        let external_read = document_contents(&root, "external.txt");
        println!("ROUND2_LINKED_DOCS: decision={decision:?}; active_docs_exist={active_link}; external_read_from_active={external_read:?}");
        assert_eq!(
            document_contents(&elsewhere, "external.txt").as_deref(),
            Some("external document sentinel")
        );
        if root.join(DOCUMENTS_DIR).exists() {
            std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        }
        if rollback.join(DOCUMENTS_DIR).exists() {
            std::fs::remove_dir(rollback.join(DOCUMENTS_DIR)).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A linked original artifact must be rejected before it is moved into active storage"
        );
        assert!(!active_link);
    }

    #[cfg(windows)]
    #[test]
    fn round2_linked_recovery_database_directory_does_not_enter_active_storage() {
        let root = scratch("round2-linked-db");
        let elsewhere = scratch("round2-linked-db-out");
        let target = elsewhere.join("target_dir");
        std::fs::create_dir_all(&target).unwrap();
        let rollback = root.join("backups/before-restore-linked-db");
        std::fs::create_dir_all(&rollback).unwrap();
        round2_make_junction(&rollback.join(DB_FILES[0]), &target);
        let mut journal = RestoreJournal::new("backups/before-restore-linked-db".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let active_exists = root.join(DB_FILES[0]).exists();
        if rollback.join(DB_FILES[0]).exists() {
            let _ = std::fs::remove_dir(rollback.join(DB_FILES[0]));
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Linked database path must be rejected"
        );
        assert!(!active_exists);
    }

    #[test]
    fn unidentified_document_and_sidecar_are_not_deleted() {
        let root = scratch("unidentified-doc-sidecar");
        write_database(&root.join(DB_FILES[0]), "active database");
        write_document(&root, "unrelated.pdf", "unrelated active document");
        let unknown_doc_hash =
            sha256_digest(&std::fs::read(root.join(DOCUMENTS_DIR).join("unrelated.pdf")).unwrap());
        std::fs::write(root.join(DB_FILES[1]), b"unrelated active WAL raw bytes").unwrap();
        let unknown_wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());

        let rollback = root.join("backups/before-restore-doc-sidecar");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original protected db");
        write_document(&rollback, "original.pdf", "original document");

        let mut journal = RestoreJournal::new("backups/before-restore-doc-sidecar".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        journal.installed_db_files.push(DB_FILES[0].into());
        journal.installed_db_files.push(DB_FILES[1].into());
        journal.installed_documents = true;
        // Notice: staged_db_artifacts does NOT contain the hash of root's DB_FILES[1]
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        // The unrelated WAL must not be deleted because it is unidentified!
        assert!(
            root.join(DB_FILES[1]).is_file()
                && sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap())
                    == unknown_wal_hash,
            "Unidentified WAL must be preserved"
        );
        // The unrelated document must also be preserved!
        assert!(
            root.join(DOCUMENTS_DIR).join("unrelated.pdf").is_file()
                && sha256_digest(
                    &std::fs::read(root.join(DOCUMENTS_DIR).join("unrelated.pdf")).unwrap()
                ) == unknown_doc_hash,
            "Unidentified document must be preserved"
        );
        // And startup must block on unresolved state rather than claiming full clean recovery
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unidentified sidecar must halt recovery with BlockedUnresolved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn matrix_interrupted_original_return_preserves_already_returned_files() {
        let source = scratch("matrix-source");
        let root = scratch("matrix-interrupted-return");
        write_database(&source.join(DB_FILES[0]), "checkpointed db");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original persistent database'",
            [],
        )
        .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        // Put DB_FILES[0] in root (as if it has already returned)
        std::fs::copy(source.join(DB_FILES[0]), root.join(DB_FILES[0])).unwrap();
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        // Put DB_FILES[1] in rollback (still pending return)
        let rollback = root.join("backups/before-restore-matrix-return");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::copy(source.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();
        let orig_wal_hash = sha256_digest(&std::fs::read(rollback.join(DB_FILES[1])).unwrap());
        drop(conn);

        let orig_ident_db = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: orig_hash.clone(),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        };
        let orig_ident_wal = ArtifactIdentity {
            name: DB_FILES[1].to_string(),
            sha256: orig_wal_hash.clone(),
            size: std::fs::metadata(rollback.join(DB_FILES[1])).unwrap().len(),
        };

        let mut journal = RestoreJournal::new("backups/before-restore-matrix-return".into(), false);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].to_string(), DB_FILES[1].to_string()];
        journal.original_db_artifacts = vec![orig_ident_db, orig_ident_wal];
        write_journal(&root, &journal).unwrap();

        // Rerunning rollback on startup must detect that DB_FILES[0] matches the original identity,
        // preserve it, move DB_FILES[1] from rollback, and complete recovery safely!
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert!(root.join(DB_FILES[1]).is_file());
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap()),
            orig_wal_hash
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original persistent database"
        );
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
    }

    #[test]
    fn matrix_missing_original_artifact_blocks_recovery_even_if_same_named_file_exists() {
        let root = scratch("matrix-missing-original");
        let rollback = root.join("backups/before-restore-missing-original");
        std::fs::create_dir_all(&rollback).unwrap();
        // The rollback folder has a file with the right name, but DIFFERENT content than expected!
        write_database(&rollback.join(DB_FILES[0]), "corrupted or altered db");

        let orig_ident = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
            size: 100,
        };

        let mut journal =
            RestoreJournal::new("backups/before-restore-missing-original".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].to_string()];
        journal.original_db_artifacts = vec![orig_ident];
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Hash mismatch on original artifact must block recovery"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn matrix_journal_unreadable_or_corrupt_phase_blocks_conservatively() {
        let root = scratch("matrix-corrupt-journal");
        let rollback = root.join("backups/before-restore-corrupt");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "precious database");

        std::fs::write(
            root.join(RESTORE_JOURNAL_FILE),
            br#"{"phase": "NonExistentPhase"}"#,
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unknown phase in journal must block startup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn round3_identity(path: &Path, name: &str) -> ArtifactIdentity {
        let bytes = std::fs::read(path).unwrap();
        ArtifactIdentity {
            name: name.into(),
            sha256: sha256_digest(&bytes),
            size: bytes.len() as u64,
        }
    }

    #[test]
    fn round3_changed_original_document_cannot_be_reported_recovered() {
        let root = scratch("round3-changed-original-doc");
        let rollback = root.join("backups/before-restore-round3-changed");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "original.pdf", "original document bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-changed".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("original.pdf"),
            b"altered document bytes!",
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let recovered_bytes = document_contents(&root, "original.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Must reject changed original document identity: {decision:?}, active={recovered_bytes:?}, journal_retained={journal_retained}");
    }

    #[test]
    fn round3_missing_original_document_cannot_be_reported_recovered() {
        let root = scratch("round3-missing-original-doc");
        let rollback = root.join("backups/before-restore-round3-missing");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "original.pdf", "original document bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-missing".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();
        std::fs::remove_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let original_missing = !root.join(DOCUMENTS_DIR).join("original.pdf").exists();
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Must reject missing original documents: {decision:?}, missing={original_missing}, journal_retained={journal_retained}");
    }

    #[test]
    fn round3_original_document_absence_must_not_leave_selected_documents() {
        let root = scratch("round3-original-doc-absence");
        let rollback = root.join("backups/before-restore-round3-absence");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original row without documents");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-absence".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::write(
            root.join(DOCUMENTS_DIR).join("selected.pdf"),
            b"selected backup document",
        )
        .unwrap();
        journal.staged_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        journal.installed_documents = true;
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let selected_left = root.join(DOCUMENTS_DIR).join("selected.pdf").exists();
        let original_row = database_contents(&root.join(DB_FILES[0]));
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }) || !selected_left,
            "Cannot accept a mixture of returned original DB and selected documents: {decision:?}, selected_left={selected_left}, row={original_row}");
    }

    #[cfg(windows)]
    #[test]
    fn round3_active_document_junction_cannot_be_accepted_as_returned_original() {
        let root = scratch("round3-active-doc-junction");
        let external = scratch("round3-external-docs");
        let rollback = root.join("backups/before-restore-round3-junction");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "returned original row");
        write_document(&external, "original.pdf", "external sentinel");
        let mut journal =
            RestoreJournal::new("backups/before-restore-round3-junction".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_documents = true;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&external.join(DOCUMENTS_DIR)).unwrap();
        round2_make_junction(&root.join(DOCUMENTS_DIR), &external.join(DOCUMENTS_DIR));
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let linked_active =
            is_symlink_or_reparse(&std::fs::symlink_metadata(root.join(DOCUMENTS_DIR)).unwrap());
        let external_bytes = document_contents(&external, "original.pdf");
        std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Active document junction must halt startup: {decision:?}, linked_active={linked_active}, external={external_bytes:?}");
    }

    #[test]
    fn round3_unknown_pending_owner_must_not_be_deleted_by_terminal_cleanup() {
        let root = scratch("round3-unknown-pending-owner");
        write_database(&root.join(DB_FILES[0]), "installed row");
        let rollback = root.join("backups/before-restore-round3-terminal");
        std::fs::create_dir_all(&rollback).unwrap();
        let mut journal =
            RestoreJournal::new("backups/before-restore-round3-terminal".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "known-terminal-owner".into();
        write_journal(&root, &journal).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "unidentified pending row");
        std::fs::write(pending.join(RESTORE_PLAN), b"{ corrupted ownership record").unwrap();
        let identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        let decision = handle_startup_restore_in(&root).unwrap();
        let pending_preserved = pending.join(DB_FILES[0]).is_file()
            && round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == identity;
        std::fs::remove_dir_all(&root).unwrap();
        assert!(pending_preserved,
            "Unknown ownership must not authorize deletion: {decision:?}, pending_preserved={pending_preserved}");
    }

    // =========================================================================
    // Task 1: Enforce original document identity and completeness
    // =========================================================================

    #[test]
    fn task1_missing_single_document_in_populated_dir_blocks() {
        let root = scratch("task1-missing-single-doc");
        let rollback = root.join("backups/before-restore-t1-single");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "doc1.pdf", "doc 1 bytes");
        write_document(&rollback, "doc2.pdf", "doc 2 bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-t1-single".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Simulate single missing document in rollback
        std::fs::remove_file(rollback.join(DOCUMENTS_DIR).join("doc2.pdf")).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Missing single document in populated directory must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_changed_same_size_document_bytes_blocks() {
        let root = scratch("task1-changed-same-size");
        let rollback = root.join("backups/before-restore-t1-samesize");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "doc.pdf", "AAAA");
        let mut journal = RestoreJournal::new("backups/before-restore-t1-samesize".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Alter bytes with SAME size
        std::fs::write(rollback.join(DOCUMENTS_DIR).join("doc.pdf"), b"BBBB").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Changed same-size document bytes must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_nested_document_paths_verified() {
        let root = scratch("task1-nested-doc-paths");
        let rollback = root.join("backups/before-restore-t1-nested");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        let sub = rollback.join(DOCUMENTS_DIR).join("curriculum/phase1");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("lesson.pdf"), b"lesson bytes in nested path").unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t1-nested".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Nested document paths must be recovered and verified: {decision:?}"
        );
        let active_nested = root
            .join(DOCUMENTS_DIR)
            .join("curriculum/phase1/lesson.pdf");
        assert!(active_nested.is_file());
        assert_eq!(
            std::fs::read(active_nested).unwrap(),
            b"lesson bytes in nested path"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_missing_entire_document_directory_blocks() {
        let root = scratch("task1-missing-entire-docs-dir");
        let rollback = root.join("backups/before-restore-t1-nodir");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "test.pdf", "test content");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-nodir".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Remove entire documents directory in rollback
        std::fs::remove_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Missing entire original documents directory must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_interrupted_return_after_directory_rename_resumes_cleanly() {
        let root = scratch("task1-interrupted-after-rename");
        let rollback = root.join("backups/before-restore-t1-interrupted");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original row in active root");
        write_document(&root, "manual.pdf", "original manual content");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-interrupted".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Rollback already has docs moved to root. Next startup must recognize all original files are back and succeed!
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Interrupted return with all originals in place must complete recovery cleanly: {decision:?}");
        assert!(root.join(DOCUMENTS_DIR).join("manual.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_repeated_startup_after_clearing_obstruction_succeeds() {
        let root = scratch("task1-repeated-startup-obstruction");
        let rollback = root.join("backups/before-restore-t1-obstruct");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original precious row");
        write_document(&rollback, "guide.pdf", "original guide bytes");

        // Obstruct active root
        write_database(&root.join(DB_FILES[0]), "obstruction row");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-obstruct".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // First launch: blocked due to obstruction
        let decision1 = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision1,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        // Clear obstruction
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();

        // Second launch: succeeds cleanly!
        let decision2 = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(
                decision2,
                StartupRestoreDecision::RolledBackRecovered { .. }
            ),
            "Second launch after clearing obstruction must succeed: {decision2:?}"
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original precious row"
        );
        assert!(root.join(DOCUMENTS_DIR).join("guide.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 2: Handle original document absence without mixing datasets
    // =========================================================================

    #[test]
    fn task2_original_document_absence_uninstalls_selected_documents() {
        let root = scratch("task2-absence-uninstalls-selected");
        let rollback = root.join("backups/before-restore-t2-absence");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db without docs");

        // Staged document installed in root
        write_document(
            &root,
            "staged_selected.pdf",
            "staged selected document bytes",
        );
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-absence".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = false; // Original had NO documents
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover to original absence: {decision:?}"
        );
        assert!(
            !root.join(DOCUMENTS_DIR).exists(),
            "Documents directory must be removed to restore absence"
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original db without docs"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_original_empty_document_dir_restored() {
        let root = scratch("task2-empty-dir-restored");
        let rollback = root.join("backups/before-restore-t2-empty");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db with empty docs");

        write_document(
            &root,
            "staged_selected.pdf",
            "staged selected document bytes",
        );
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-empty".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true; // Original HAD an empty documents directory
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover to original empty directory: {decision:?}"
        );
        assert!(
            root.join(DOCUMENTS_DIR).is_dir(),
            "Documents directory must exist"
        );
        assert!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR))
                .unwrap()
                .is_empty(),
            "Documents directory must be empty"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_original_populated_document_dir_restored() {
        let root = scratch("task2-populated-dir-restored");
        let rollback = root.join("backups/before-restore-t2-populated");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");
        write_document(&rollback, "orig1.pdf", "orig 1");
        write_document(&rollback, "orig2.pdf", "orig 2");

        write_document(&root, "staged1.pdf", "staged 1");
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-populated".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover populated original documents: {decision:?}"
        );
        assert!(root.join(DOCUMENTS_DIR).join("orig1.pdf").is_file());
        assert!(root.join(DOCUMENTS_DIR).join("orig2.pdf").is_file());
        assert!(!root.join(DOCUMENTS_DIR).join("staged1.pdf").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_unrelated_active_document_preserved_and_blocks() {
        let root = scratch("task2-unrelated-doc-preserved");
        let rollback = root.join("backups/before-restore-t2-unrelated");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");

        write_document(&root, "staged1.pdf", "staged 1");
        write_document(&root, "unrelated_user_doc.pdf", "do not delete me!");
        let staged_ident = vec![round3_identity(
            &root.join(DOCUMENTS_DIR).join("staged1.pdf"),
            "staged1.pdf",
        )];

        let mut journal = RestoreJournal::new("backups/before-restore-t2-unrelated".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unrelated active document must block recovery: {decision:?}"
        );
        assert!(
            root.join(DOCUMENTS_DIR)
                .join("unrelated_user_doc.pdf")
                .is_file(),
            "Unrelated document must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_overlapping_document_content_survives() {
        let root = scratch("task2-overlapping-doc");
        let rollback = root.join("backups/before-restore-t2-overlap");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(
            &root,
            "shared.pdf",
            "identical content in both original and staged",
        );

        let ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-t2-overlap".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = ident.clone();
        journal.staged_document_artifacts = ident;
        journal.installed_documents = true;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Overlapping document must not be deleted: {decision:?}"
        );
        assert!(root.join(DOCUMENTS_DIR).join("shared.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 3: Fallible and no-follow inspection across the entire dataset
    // =========================================================================

    #[cfg(windows)]
    #[test]
    fn task3_linked_inventory_root_rejected() {
        let root = scratch("task3-linked-root");
        let external = scratch("task3-external-target");
        write_document(&external, "test.pdf", "external content");
        round2_make_junction(&root.join(DOCUMENTS_DIR), &external.join(DOCUMENTS_DIR));

        let res = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR));
        assert!(
            res.is_err(),
            "inventory_directory_artifacts must reject a junction as root"
        );
        std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task3_linked_nested_child_rejected() {
        let root = scratch("task3-linked-child");
        let external = scratch("task3-external-child-target");
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&docs).unwrap();
        write_document(&external, "nested.pdf", "external nested content");
        round2_make_junction(&docs.join("nested_junction"), &external.join(DOCUMENTS_DIR));

        let res = inventory_directory_artifacts(&docs);
        assert!(
            res.is_err(),
            "inventory_directory_artifacts must reject a nested junction"
        );
        std::fs::remove_dir(docs.join("nested_junction")).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task3_active_db_link_rejected() {
        let root = scratch("task3-linked-db");
        let external = scratch("task3-external-db");
        write_database(&external.join(DB_FILES[0]), "external db");

        let rollback = root.join("backups/before-restore-t3-db");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original precious db");

        let mut journal = RestoreJournal::new("backups/before-restore-t3-db".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        write_journal(&root, &journal).unwrap();

        // Make root.join(DB_FILES[0]) a junction pointing to directory external
        round2_make_junction(&root.join(DB_FILES[0]), &external);

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Active DB link must block recovery: {decision:?}"
        );
        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[test]
    fn task3_journal_invalid_inventory_names_rejected() {
        let root = scratch("task3-invalid-journal-names");
        let mut journal = RestoreJournal::new("backups/before-restore-t3-invalid".into(), true);
        journal.phase = RestorePhase::Protected;
        // Inject traversal in document inventory
        journal.original_document_artifacts.push(ArtifactIdentity {
            name: "../traversal.pdf".into(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".into(),
            size: 10,
        });

        let validation_res = journal.validate(&root);
        assert!(
            validation_res.is_err(),
            "Traversal in document inventory must be rejected by validate"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 4: Strict pending deletion ownership
    // =========================================================================

    #[test]
    fn task4_terminal_cleanup_matching_id_committed() {
        let root = scratch("task4-matching-committed");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-matching-123".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-matching-123".into(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(
            !pending.exists(),
            "Pending directory with matching ID must be cleaned up"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted after cleanup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_matching_id_rolled_back() {
        let root = scratch("task4-matching-rolledback");
        write_database(&root.join(DB_FILES[0]), "recovered active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match-rb".into(), false);
        journal.phase = RestorePhase::RolledBack;
        journal.operation_id = "op-match-rb-456".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-match-rb-456".into(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::RolledBackRecovered { .. }
        ));
        assert!(
            !pending.exists(),
            "Pending directory with matching ID must be cleaned up"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted after cleanup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_mismatched_id_refuses_deletion() {
        let root = scratch("task4-mismatched-id");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-mismatch".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-journal-789".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db from other op");
        let plan = RestorePlan {
            operation_id: "op-OTHER-different".into(),
            kind: RestoreKind::Complete,
            source: "backup2.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Mismatched operation ID must block and refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_corrupted_plan_refuses_deletion() {
        let root = scratch("task4-corrupt-plan-refuses");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-corrupt".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-modern-with-id".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db with corrupted plan");
        std::fs::write(pending.join(RESTORE_PLAN), b"{ corrupted json").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Corrupted plan with modern journal must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_empty_id_refuses_deletion() {
        let root = scratch("task4-empty-id-refuses");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-empty-id".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-modern-with-id".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db with empty id");
        let plan = RestorePlan {
            operation_id: String::new(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Empty plan ID with modern journal must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_genuine_legacy_state() {
        let root = scratch("task4-legacy-cleanup");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-legacy".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = String::new(); // Legacy journal without operation_id
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "legacy staged db");
        // No plan in legacy pending either

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(
            !pending.exists(),
            "Legacy pending without plan must be cleaned up by legacy journal"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 5: Deterministic Fault Injection Matrix
    // =========================================================================

    #[test]
    fn task5_matrix_journal_temp_create_fault() {
        let root = scratch("task5-fault-temp-create");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalTempCreate);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Temp create fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_write_fault() {
        let root = scratch("task5-fault-write");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalWrite);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Write fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_sync_fault() {
        let root = scratch("task5-fault-sync");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalSync);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Sync fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_rename_fault() {
        let root = scratch("task5-fault-rename");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalRename);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Rename fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_delete_fault() {
        let root = scratch("task5-fault-delete");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        write_journal(&root, &journal).unwrap();
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());

        let _guard = ScopedFault::set(InjectedFault::JournalDelete);
        let res = remove_journal(&root);
        assert!(res.is_err(), "Delete fault must fail remove_journal");
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must remain on delete failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_unreadable_journal_file_blocks_startup() {
        let root = scratch("task5-unreadable-journal");
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), b"not valid json").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unreadable journal file must block startup: {decision:?}"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Unreadable journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_protect_move_fault_conserves_original_data() {
        let root = scratch("task5-fault-protect-move");
        write_database(&root.join(DB_FILES[0]), "original uncorrupted database");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged new database");

        let _guard = ScopedFault::set(InjectedFault::ProtectDbRename(0));
        let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
        assert!(
            matches!(res, RestoreApplicationResult::RefusedUnchanged(_)),
            "Failure during protect move must result in RefusedUnchanged: {res:?}"
        );
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash,
            "Original database must remain intact after protect failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_install_move_fault_triggers_clean_rollback() {
        let root = scratch("task5-fault-install-move");
        write_database(
            &root.join(DB_FILES[0]),
            "original database before install failure",
        );
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged new database");

        let _guard = ScopedFault::set(InjectedFault::InstallDbRename(0));
        let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
        assert!(
            matches!(res, RestoreApplicationResult::Recovered(_)),
            "Failure during install move must trigger successful recovery rollback: {res:?}"
        );
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash,
            "Original database must be restored after install failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_return_move_fault_conserves_all_files() {
        let root = scratch("task5-fault-return-move");
        let rollback = root.join("backups/before-restore-return-fault");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original database in rollback");

        let mut journal = RestoreJournal::new("backups/before-restore-return-fault".into(), false);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        write_journal(&root, &journal).unwrap();

        let _guard = ScopedFault::set(InjectedFault::ReturnDbRename(0));
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Failure during return move must block startup: {decision:?}"
        );
        assert!(
            rollback.join(DB_FILES[0]).is_file(),
            "Original file must be preserved in rollback"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Round 4: Ported Regressions & Verified Fixes
    // =========================================================================

    #[test]
    fn round4_modern_terminal_missing_plan_preserves_unknown_pending() {
        let mut results = Vec::new();
        for phase in [RestorePhase::Committed, RestorePhase::RolledBack] {
            let root = scratch(&format!("round4-missing-plan-{phase:?}"));
            write_database(&root.join(DB_FILES[0]), "active original row");
            let mut journal =
                RestoreJournal::new("backups/before-restore-round4-missing-plan".into(), false);
            journal.phase = phase.clone();
            journal.operation_id = "known-modern-terminal-owner".into();
            write_journal(&root, &journal).unwrap();
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "unknown pending row");
            let original_pending = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
            assert!(!pending.join(RESTORE_PLAN).exists());
            let decision = handle_startup_restore_in(&root).unwrap();
            let preserved = pending.join(DB_FILES[0]).is_file()
                && round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == original_pending;
            results.push(format!(
                "phase={phase:?}, decision={decision:?}, pending_preserved={preserved}"
            ));
            std::fs::remove_dir_all(&root).unwrap();
        }
        assert!(
            results
                .iter()
                .all(|r| r.ends_with("pending_preserved=true")),
            "Missing plan does not establish modern deletion ownership: {results:?}"
        );
    }

    #[test]
    fn round4_empty_original_manifest_rejects_unidentified_document() {
        let root = scratch("round4-empty-original-manifest");
        let rollback = root.join("backups/before-restore-round4-empty");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(
            &rollback.join(DB_FILES[0]),
            "original row with empty document directory",
        );
        let mut journal = RestoreJournal::new("backups/before-restore-round4-empty".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentEmpty);
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        assert!(journal.original_document_artifacts.is_empty());
        write_journal(&root, &journal).unwrap();
        // The formerly empty original directory now has content not in its recorded inventory.
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("unidentified.pdf"),
            b"unidentified document sentinel",
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let accepted_unknown = document_contents(&root, "unidentified.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A known-empty manifest must not disable complete-set verification: {decision:?}, active={accepted_unknown:?}, journal_retained={journal_retained}");
    }

    #[test]
    fn round4_document_protection_failure_recovers_on_next_launch() {
        let root = scratch("round4-protect-doc-failure");
        write_database(&root.join(DB_FILES[0]), "original protected row");
        write_document(&root, "original.pdf", "original protected document");
        let db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let doc_identity = round3_identity(
            &root.join(DOCUMENTS_DIR).join("original.pdf"),
            "original.pdf",
        );
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected backup row");
        write_document(&pending, "selected.pdf", "selected backup document");
        write_restore_plan(
            &pending,
            RestoreKind::Complete,
            "synthetic selected archive",
        )
        .unwrap();
        let first = {
            let _guard = ScopedFault::set(InjectedFault::ProtectDocsRename);
            apply_pending_restore_in_internal(&root, || Ok(())).unwrap()
        };
        let fault_observed =
            format!("{first:?}").contains("Injected test fault: ProtectDocsRename");
        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        let originals_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == db_identity
            && root.join(DOCUMENTS_DIR).join("original.pdf").is_file()
            && round3_identity(
                &root.join(DOCUMENTS_DIR).join("original.pdf"),
                "original.pdf",
            ) == doc_identity;
        let resolved = matches!(
            second,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        ) && matches!(
            third,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            fault_observed,
            "Fixture must exercise the document protection fault: {first:?}"
        );
        assert!(resolved && originals_preserved,
            "A cleared document protection failure must recover the conserved original dataset: first={first:?}, second={second:?}, third={third:?}, preserved={originals_preserved}");
    }

    #[cfg(windows)]
    #[test]
    fn round4_linked_pending_root_must_not_move_external_data() {
        let root = scratch("round4-linked-pending-root");
        let external = scratch("round4-external-pending-target");
        write_database(&root.join(DB_FILES[0]), "original active row");
        write_document(&root, "original.pdf", "original active document");
        let active_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        write_database(&external.join(DB_FILES[0]), "external sentinel row");
        write_document(&external, "external.pdf", "external document sentinel");
        write_restore_plan(
            &external,
            RestoreKind::Complete,
            "synthetic external ownership plan",
        )
        .unwrap();
        let external_db_identity = round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]);
        let pending = root.join(RESTORE_PENDING_DIR);
        round2_make_junction(&pending, &external);
        let decision = handle_startup_restore_in(&root).unwrap();
        let external_db_preserved = external.join(DB_FILES[0]).is_file()
            && round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]) == external_db_identity;
        let external_docs_preserved = document_contents(&external, "external.pdf")
            == Some("external document sentinel".into());
        let active_db_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db_identity;
        let active_row = if root.join(DB_FILES[0]).is_file() {
            Some(database_contents(&root.join(DB_FILES[0])))
        } else {
            None
        };
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_dir(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. })
            && external_db_preserved && external_docs_preserved && active_db_preserved,
            "Linked staging must be refused before following/moving external files: {decision:?}, external_db_preserved={external_db_preserved}, external_docs_preserved={external_docs_preserved}, active_db_preserved={active_db_preserved}, active_row={active_row:?}");
    }

    #[cfg(unix)]
    #[test]
    fn round4_linked_pending_root_must_not_move_external_data_unix() {
        let root = scratch("round4-linked-pending-root-unix");
        let external = scratch("round4-external-pending-target-unix");
        write_database(&root.join(DB_FILES[0]), "original active row");
        write_document(&root, "original.pdf", "original active document");
        let active_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        write_database(&external.join(DB_FILES[0]), "external sentinel row");
        write_document(&external, "external.pdf", "external document sentinel");
        write_restore_plan(
            &external,
            RestoreKind::Complete,
            "synthetic external ownership plan",
        )
        .unwrap();
        let external_db_identity = round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]);
        let pending = root.join(RESTORE_PENDING_DIR);
        std::os::unix::fs::symlink(&external, &pending).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let external_db_preserved = external.join(DB_FILES[0]).is_file()
            && round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]) == external_db_identity;
        let external_docs_preserved = document_contents(&external, "external.pdf")
            == Some("external document sentinel".into());
        let active_db_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db_identity;
        let active_row = if root.join(DB_FILES[0]).is_file() {
            Some(database_contents(&root.join(DB_FILES[0])))
        } else {
            None
        };
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_file(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. })
                && external_db_preserved
                && external_docs_preserved
                && active_db_preserved
                && active_row.as_deref() == Some("original active row"),
            "Linked staging must be refused before following/moving external files: {decision:?}, active_row={active_row:?}"
        );
    }

    // =========================================================================
    // Task 1: Staging/Pending Root Authorization
    // =========================================================================

    #[cfg(windows)]
    #[test]
    fn task1_linked_pending_root_without_documents() {
        let root = scratch("task1-linked-pending-no-docs");
        let external = scratch("task1-ext-no-docs");
        write_database(&root.join(DB_FILES[0]), "active row");
        write_database(&external.join(DB_FILES[0]), "ext row");
        write_restore_plan(&external, RestoreKind::Database, "db only").unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        round2_make_junction(&pending, &external);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(external.join(DB_FILES[0]).is_file());
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_dir(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task1_linked_staging_root_refuses_staging() {
        let root = scratch("task1-linked-staging");
        let external = scratch("task1-ext-staging");
        let staging = root.join(RESTORE_STAGING_DIR);
        round2_make_junction(&staging, &external);
        let res = fresh_staging(&root);
        assert!(
            res.is_err(),
            "fresh_staging must refuse linked staging directory"
        );
        assert!(format!("{res:?}").contains("unsafe symlink or reparse point"));
        if std::fs::symlink_metadata(&staging).is_ok() {
            std::fs::remove_dir(&staging).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[test]
    fn task1_invalid_directory_type_pending_refuses_activation() {
        let root = scratch("task1-file-as-pending");
        write_database(&root.join(DB_FILES[0]), "active row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::write(&pending, b"not a directory").unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_ordinary_valid_pending_activation_succeeds() {
        let root = scratch("task1-valid-pending");
        write_database(&root.join(DB_FILES[0]), "old active row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "new restored row");
        write_restore_plan(&pending, RestoreKind::Database, "test archive").unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "new restored row"
        );
        assert!(!pending.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 2: Reconcile Unmoved Original Documents
    // =========================================================================

    #[test]
    fn task2_protection_failure_with_empty_documents_recovers() {
        let root = scratch("task2-protect-empty-docs");
        write_database(&root.join(DB_FILES[0]), "active db row");
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let db_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected row");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let first = {
            let _guard = ScopedFault::set(InjectedFault::ProtectDocsRename);
            apply_pending_restore_in_internal(&root, || Ok(())).unwrap()
        };
        assert!(format!("{first:?}").contains("Injected test fault: ProtectDocsRename"));
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            second,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        ));
        assert_eq!(round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]), db_id);
        assert!(root.join(DOCUMENTS_DIR).is_dir());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_protection_failure_with_active_documents_modified_blocks() {
        let root = scratch("task2-protect-mod-docs");
        let rollback = root.join("backups/before-restore-t2-tamper");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db in rollback");
        write_document(&root, "orig.pdf", "tampered content");

        let mut journal = RestoreJournal::new("backups/before-restore-t2-tamper".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = vec![ArtifactIdentity {
            name: "orig.pdf".into(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".into(),
            size: 16,
        }];
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Modified active original document must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 3: Known-Empty Manifest Enforces Empty Set
    // =========================================================================

    #[test]
    fn task3_empty_manifest_with_nested_unexpected_file_blocks() {
        let root = scratch("task3-empty-nested-blocks");
        let rollback = root.join("backups/before-restore-t3-nested");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");
        let mut journal = RestoreJournal::new("backups/before-restore-t3-nested".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentEmpty);
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = vec![];
        write_journal(&root, &journal).unwrap();

        // Introduce nested unexpected file
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR).join("subdir")).unwrap();
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("subdir/nested.pdf"),
            b"unexpected nested",
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 4: Missing Plan Refuses Modern Terminal Cleanup
    // =========================================================================

    #[test]
    fn task4_modern_terminal_matching_plan_cleans_up() {
        let root = scratch("task4-matching-cleans-up");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-matched-999".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-matched-999".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 5: Fault-Injection Matrix Coverage
    // =========================================================================

    #[test]
    fn task5_occurrence_second_journal_write_failure_recovers_with_expected_cleanup() {
        #[cfg(windows)]
        use std::os::windows::fs::OpenOptionsExt;
        // A Windows deny-delete handle retains pending cleanup. Without that handle,
        // successful rollback clears the journal on every supported platform.
        #[cfg(windows)]
        let cleanup_retained_cases = [false, true];
        #[cfg(not(windows))]
        let cleanup_retained_cases = [false];

        for cleanup_retained in cleanup_retained_cases {
            let root = scratch("task5-occurrence-journal");
            write_database(&root.join(DB_FILES[0]), "original active db");
            let orig_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "restored db");
            write_restore_plan(&pending, RestoreKind::Database, "test").unwrap();
            let staged_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
            let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();

            #[cfg(windows)]
            let lock = cleanup_retained.then(|| {
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(pending.join(DB_FILES[0]))
                    .unwrap()
            });

            // Fail on the 2nd journal write (Protected phase write)
            let _guard = ScopedFault::set_occurrence(InjectedFault::JournalWrite, 2);
            let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
            assert!(
                matches!(res, RestoreApplicationResult::RefusedUnchanged(ref reason)
            if reason.contains("JournalWrite")),
                "Unexpected restore result: {res:?}"
            );
            assert_eq!(
                ScopedFault::fired_count(),
                1,
                "Second write fault must fire once"
            );
            assert_eq!(
                round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
                orig_identity,
                "Original database must be restored before pending cleanup"
            );

            if cleanup_retained {
                let journal_on_disk = read_journal(&root)
                    .unwrap()
                    .expect("Blocked cleanup must retain a valid rollback journal");
                assert_eq!(journal_on_disk.phase, RestorePhase::RolledBack);
                assert_eq!(
                    round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]),
                    staged_identity
                );
                assert_eq!(
                    std::fs::read(pending.join(RESTORE_PLAN)).unwrap(),
                    plan_bytes
                );
            } else {
                assert!(
                    read_journal(&root).unwrap().is_none(),
                    "Completed cleanup must clear the journal"
                );
                assert!(
                    !pending.exists(),
                    "Completed cleanup must remove owned pending data"
                );
            }
            assert!(find_abandoned_temporary_journal_sibling(&root)
                .unwrap()
                .is_none());

            drop(_guard);
            #[cfg(windows)]
            drop(lock);

            // Repeat startup safely resolves/conserves original dataset
            let decision = handle_startup_restore_in(&root).unwrap();
            if cleanup_retained {
                assert!(matches!(
                    decision,
                    StartupRestoreDecision::RolledBackRecovered { .. }
                ));
            } else {
                assert_eq!(decision, StartupRestoreDecision::ProceedNormally);
            }
            assert_eq!(
                round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
                orig_identity
            );
            assert!(read_journal(&root).unwrap().is_none());
            assert!(!pending.exists());
            assert!(find_abandoned_temporary_journal_sibling(&root)
                .unwrap()
                .is_none());
            std::fs::remove_dir_all(&root).unwrap();
        }
    }

    #[test]
    fn task5_root_readdir_fault_observed_and_blocks_safely() {
        let root = scratch("task5-root-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let _guard = ScopedFault::set(InjectedFault::RootReadDir);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_id
        );
        drop(_guard);

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_backups_readdir_fault_observed_and_blocks_safely() {
        let root = scratch("task5-backups-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let _guard = ScopedFault::set(InjectedFault::BackupsReadDir);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_id
        );
        drop(_guard);

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_journal_read_fault_observed_and_blocks_safely() {
        let root = scratch("task5-journal-read-fault");
        write_database(&root.join(DB_FILES[0]), "active db");
        let journal = RestoreJournal::new("backups/before-restore-test".into(), false);
        write_journal(&root, &journal).unwrap();

        let _guard = ScopedFault::set(InjectedFault::JournalRead);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_plan_read_fault_observed_and_refuses_deletion() {
        let root = scratch("task5-plan-read-fault");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-test".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-read-test".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "pending db");
        let plan = RestorePlan {
            operation_id: "op-read-test".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let _guard = ScopedFault::set(InjectedFault::PlanRead);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(pending.join(DB_FILES[0]).is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_inventory_readdir_fault_observed_and_blocks() {
        let root = scratch("task5-inventory-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        write_document(&root, "orig.pdf", "doc");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "restored db");
        write_document(&pending, "new.pdf", "new doc");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let _guard = ScopedFault::set(InjectedFault::InventoryReadDir);
        let res = apply_pending_restore_in_internal(&root, || Ok(()));
        assert!(ScopedFault::hits() >= 1);
        assert!(
            res.is_err()
                || matches!(
                    res,
                    Ok(RestoreApplicationResult::Unresolved { .. })
                        | Ok(RestoreApplicationResult::RefusedUnchanged(_))
                )
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task5_real_unreadable_journal_file_blocks_startup() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("task5-real-unreadable-journal");
        write_database(&root.join(DB_FILES[0]), "active db");
        let journal_path = root.join(RESTORE_JOURNAL_FILE);
        std::fs::write(&journal_path, b"valid journal text").unwrap();

        // Lock file with exclusive access (share_mode = 0 denies read/write/delete by others)
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&journal_path)
            .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "OS denied read on journal file must block startup: {decision:?}"
        );

        drop(lock);
        std::fs::remove_dir_all(&root).unwrap();
    }
    // =========================================================================
    // ROUND 5 REGRESSIONS & FINITE CRITICAL FAILURE EVIDENCE
    // =========================================================================

    #[test]
    fn round5_journal_write_or_sync_failures_can_recover_on_restart() {
        let mut outcomes = Vec::new();
        for fault in [InjectedFault::JournalWrite, InjectedFault::JournalSync] {
            for occurrence in [1, 2] {
                let root = scratch("round5-initial-journal");
                write_database(&root.join(DB_FILES[0]), "original row");
                write_document(&root, "original.pdf", "original document");
                let original_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
                let original_docs =
                    inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
                let pending = root.join(RESTORE_PENDING_DIR);
                std::fs::create_dir_all(&pending).unwrap();
                write_database(&pending.join(DB_FILES[0]), "selected row");
                write_document(&pending, "selected.pdf", "selected document");
                write_restore_plan(&pending, RestoreKind::Complete, "synthetic test").unwrap();
                let guard = ScopedFault::set_occurrence(fault, occurrence);
                let first = apply_pending_restore_in_internal(&root, || Ok(()));
                let hits = ScopedFault::hits();
                let fired = ScopedFault::fired_count();
                drop(guard);
                let original_preserved = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])
                    == original_db
                    && inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap()
                        == original_docs;
                let second = handle_startup_restore_in(&root).unwrap();
                let third = handle_startup_restore_in(&root).unwrap();
                let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                    && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
                println!("fault={fault:?}, occurrence={occurrence}, matching_calls={hits}, fired={fired}, first={first:?}, second={second:?}, third={third:?}, originals_preserved={original_preserved}");
                outcomes.push((
                    hits >= occurrence && fired >= 1 && original_preserved,
                    recovered,
                ));
                std::fs::remove_dir_all(&root).unwrap();
            }
        }
        assert!(
            outcomes.iter().all(|(safe, _)| *safe),
            "Fault must be reached and originals conserved"
        );
        assert!(outcomes.iter().all(|(_, recovered)| *recovered), "A cleared journal fault must not leave an untouched or successfully rolled-back profile permanently blocked: {outcomes:?}");
    }

    #[test]
    fn round5_legacy_pending_activation_does_not_leave_unverifiable_owner() {
        let mut outcomes = Vec::new();
        for old_plan in [false, true] {
            let root = scratch("round5-legacy-pending");
            write_database(&root.join(DB_FILES[0]), "original row");
            write_document(&root, "handbook.pdf", "original document");
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "selected legacy row");
            write_document(&pending, "handbook.pdf", "selected legacy document");
            if old_plan {
                std::fs::write(
                    pending.join(RESTORE_PLAN),
                    br#"{"kind":"complete","source":"legacy synthetic backup"}"#,
                )
                .unwrap();
            }
            let first = handle_startup_restore_in(&root).unwrap();
            let installed = database_contents(&root.join(DB_FILES[0]));
            let second = handle_startup_restore_in(&root).unwrap();
            let third = handle_startup_restore_in(&root).unwrap();
            let healthy = first == StartupRestoreDecision::RestoreCompleted
                && installed == "selected legacy row"
                && !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
            println!("old_plan={old_plan}, first={first:?}, second={second:?}, third={third:?}, installed={installed}");
            outcomes.push(healthy);
            std::fs::remove_dir_all(&root).unwrap();
        }
        assert!(outcomes.iter().all(|ok| *ok), "Supported legacy pending restore must remain launchable after actual activation, without weakening modern unknown-owner refusal");
    }

    #[cfg(windows)]
    #[test]
    fn round5_pending_cleanup_with_windows_lock_recovers_when_plan_survives() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round5-partial-cleanup");
        write_database(&root.join(DB_FILES[0]), "committed selected row");
        write_document(&root, "handbook.pdf", "committed selected document");
        let active_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let active_docs = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        // The ownership record is created first. The later payload holds a real deny-delete handle.
        write_restore_plan(&pending, RestoreKind::Complete, "synthetic cleanup").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned leftover row");
        let mut journal = RestoreJournal::new("backups/before-restore-round5-cleanup".into(), true);
        journal.operation_id = plan.operation_id;
        journal.phase = RestorePhase::Committed;
        write_journal(&root, &journal).unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(pending.join(DB_FILES[0]))
            .unwrap();
        let first = handle_startup_restore_in(&root).unwrap();
        let plan_after_first = pending.join(RESTORE_PLAN).exists();
        let payload_after_first = pending.join(DB_FILES[0]).is_file();
        drop(lock);
        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        let active_preserved = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db
            && inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap() == active_docs;
        let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
            && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
        println!("first={first:?}, plan_after_first={plan_after_first}, payload_after_first={payload_after_first}, second={second:?}, third={third:?}, active_preserved={active_preserved}");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            payload_after_first && active_preserved,
            "Real cleanup failure must preserve committed data and locked payload"
        );
        assert!(
            recovered,
            "Cleanup must recover once the real OS lock clears"
        );
    }

    #[test]
    fn round5_protection_failure_with_real_original_wal_and_shm_recovers() {
        let mut outcomes = Vec::new();
        for fault_index in [0, 1] {
            let source = scratch("round5-wal-source");
            write_database(&source.join(DB_FILES[0]), "original checkpointed row");
            let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
            conn.pragma_update(None, "journal_mode", "WAL").unwrap();
            conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
            conn.execute(
                "UPDATE audit_payload SET value = 'original committed WAL-only row'",
                [],
            )
            .unwrap();
            let root = scratch("round5-wal-active");
            // Capture a crashed-profile equivalent while the real committed WAL and SHM still exist.
            for name in DB_FILES {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
            drop(conn);
            let orig_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
            let orig_wal = round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]);
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "selected row");
            write_restore_plan(&pending, RestoreKind::Database, "synthetic test").unwrap();
            let guard = ScopedFault::set_occurrence(InjectedFault::ProtectDbRename(fault_index), 1);
            let first = handle_startup_restore_in(&root).unwrap();
            let hits = ScopedFault::hits();
            let fired = ScopedFault::fired_count();
            drop(guard);
            let second = handle_startup_restore_in(&root).unwrap();
            let third = handle_startup_restore_in(&root).unwrap();
            let conserved = root.join(DB_FILES[0]).is_file()
                && root.join(DB_FILES[1]).is_file()
                && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == orig_db
                && round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]) == orig_wal;
            // Read only after all startup invocations, so SQLite cannot change the evidence between them.
            let row = database_contents(&root.join(DB_FILES[0]));
            let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
            println!("index={fault_index}, hits={hits}, fired={fired}, first={first:?}, second={second:?}, third={third:?}, db_wal_conserved={conserved}, row={row}");
            outcomes.push((
                hits > 0 && fired >= 1 && conserved && row == "original committed WAL-only row",
                recovered,
            ));
            std::fs::remove_dir_all(&root).unwrap();
            std::fs::remove_dir_all(&source).unwrap();
        }
        assert!(
            outcomes.iter().all(|(safe, _)| *safe),
            "Original DB and committed WAL-only row must survive protection failure"
        );
        assert!(outcomes.iter().all(|(_, recovered)| *recovered), "Ephemeral SHM cache cleanup must not permanently prevent return of original committed DB/WAL: {outcomes:?}");
    }

    #[test]
    fn task4_legacy_database_restore_without_operation_id_preserves_documents() {
        let root = scratch("task4-legacy-db-plan");
        write_database(&root.join(DB_FILES[0]), "original database content");
        write_document(&root, "handbook.pdf", "original document untouched");
        let orig_doc = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db content");
        std::fs::write(
            pending.join(RESTORE_PLAN),
            br#"{"kind":"database","source":"legacy db backup"}"#,
        )
        .unwrap();

        let first = handle_startup_restore_in(&root).unwrap();
        assert_eq!(first, StartupRestoreDecision::RestoreCompleted);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "selected db content"
        );
        assert_eq!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap(),
            orig_doc,
            "Original documents must remain untouched during database-only restore"
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_pending_cleanup_interrupted_after_plan_removed_recovers_if_staged_payload_matches() {
        let root = scratch("task4-interrupted-cleanup-matching");
        write_database(&root.join(DB_FILES[0]), "active db row");
        write_document(&root, "manual.pdf", "active doc content");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged leftover row");

        let db_bytes = std::fs::read(pending.join(DB_FILES[0])).unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-cleanup-test".into(), true);
        journal.operation_id = "modern-op-987".into();
        journal.phase = RestorePhase::Committed;
        journal.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: hex::encode(Sha256::digest(&db_bytes)),
            size: db_bytes.len() as u64,
        });
        write_journal(&root, &journal).unwrap();
        // Notice: pending has NO RESTORE_PLAN (simulating interruption where plan was removed first)

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted, "Matching staged manifest must prove ownership and complete cleanup even if plan is missing");
        assert!(!pending.exists(), "Pending directory must be cleaned up");

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_pending_cleanup_interrupted_with_unknown_payload_refuses_deletion() {
        let root = scratch("task4-interrupted-cleanup-unknown");
        write_database(&root.join(DB_FILES[0]), "active db row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "unknown foreign row");

        let mut journal = RestoreJournal::new("backups/before-restore-unknown-test".into(), true);
        journal.operation_id = "modern-op-987".into();
        journal.phase = RestorePhase::Committed;
        // Staged manifest records a DIFFERENT hash
        journal.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
            size: 1234,
        });
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unknown leftover payload must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).exists(),
            "Unknown payload must be conserved byte-for-byte"
        );
        assert_eq!(
            database_contents(&pending.join(DB_FILES[0])),
            "unknown foreign row"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_wal_selected_install_failure_uninstalls_wal_and_recovers_original() {
        let source = scratch("task4-wal-install-src");
        write_database(&source.join(DB_FILES[0]), "original base");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original committed row in WAL'",
            [],
        )
        .unwrap();
        let root = scratch("task4-wal-install-root");
        for name in DB_FILES {
            std::fs::copy(source.join(name), root.join(name)).unwrap();
        }
        drop(conn);

        let staged_src = scratch("task4-wal-install-staged-src");
        write_database(&staged_src.join(DB_FILES[0]), "staged new base");
        let staged_conn = Connection::open(staged_src.join(DB_FILES[0])).unwrap();
        staged_conn
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        staged_conn
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        staged_conn
            .execute(
                "UPDATE audit_payload SET value = 'staged new row in WAL'",
                [],
            )
            .unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::copy(staged_src.join(DB_FILES[0]), pending.join(DB_FILES[0])).unwrap();
        std::fs::copy(staged_src.join(DB_FILES[1]), pending.join(DB_FILES[1])).unwrap();
        drop(staged_conn);
        std::fs::remove_dir_all(&staged_src).unwrap();
        let staged_wal = std::fs::read(pending.join(DB_FILES[1])).unwrap();
        assert!(
            staged_wal.len() >= 32
                && (staged_wal[0..4] == [0x37, 0x7f, 0x06, 0x82]
                    || staged_wal[0..4] == [0x37, 0x7f, 0x06, 0x83]),
            "Selected WAL fixture must be genuine SQLite WAL format"
        );
        write_restore_plan(&pending, RestoreKind::Database, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::InstallDbRename(1));
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "InstallDbRename(1) fault must fire");
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. })
                || matches!(first, StartupRestoreDecision::RolledBackRecovered { .. })
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert!(!matches!(
            second,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(!matches!(
            third,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        let row = database_contents(&root.join(DB_FILES[0]));
        assert_eq!(
            row, "original committed row in WAL",
            "Original committed row must survive selected WAL install failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
    }

    #[test]
    fn task4_document_selected_install_failure_recovers_original_documents() {
        let root = scratch("task4-doc-install-root");
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(&root, "doc1.pdf", "original content 1");
        write_document(&root, "doc2.pdf", "original content 2");
        let orig_docs = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db");
        write_document(&pending, "selected_doc.pdf", "selected content");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::InstallDocsRename);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "InstallDocsRename fault must fire");
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. })
                || matches!(first, StartupRestoreDecision::RolledBackRecovered { .. })
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert!(!matches!(
            second,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(!matches!(
            third,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        assert_eq!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap(),
            orig_docs,
            "Original documents must be fully recovered"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_journal_delete_failure_retries_safely_without_replay() {
        let root = scratch("task4-journal-del-fail");
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(&root, "original.pdf", "original doc");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db");
        write_document(&pending, "selected.pdf", "selected doc");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::JournalDelete);
        let _first = apply_pending_restore_in_internal(&root, || Ok(()));
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "JournalDelete fault must fire");
        // Because journal delete failed, the journal file survives in terminal phase
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "selected db");

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(
            second,
            StartupRestoreDecision::RestoreCompleted,
            "Second launch must complete journal cleanup without replaying restore"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must now be removed"
        );

        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "selected db");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task4_valid_canonical_journal_under_real_windows_lock_blocks_and_recovers() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("task4-valid-journal-lock");
        write_database(&root.join(DB_FILES[0]), "active db row");
        let rollback = root.join("backups/before-restore-lock-test");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "rollback db row");

        let active_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let mut journal = RestoreJournal::new("backups/before-restore-lock-test".into(), false);
        journal.operation_id = "op-valid-lock-test".into();
        journal.phase = RestorePhase::RolledBack;
        journal.original_db_artifacts.push(active_identity);
        write_journal(&root, &journal).unwrap();
        let journal_path = root.join(RESTORE_JOURNAL_FILE);
        assert!(
            journal_path.is_file(),
            "Canonical journal must exist on disk"
        );

        // Lock with share_mode = 0 (denies all read/write/delete by other processes)
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&journal_path)
            .unwrap();

        let first = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Startup must block under real OS file lock denying read"
        );

        // Release the lock
        drop(lock);

        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Startup must return RolledBackRecovered after lock is released: {second:?}"
        );

        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db row");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn round6_cleanup_enumeration_error_must_preserve_ownership_plan() {
        fn set_list_denied(path: &Path, deny: bool) {
            let quoted = path.to_string_lossy().replace('\'', "''");
            let action = if deny {
                "AddAccessRule"
            } else {
                "RemoveAccessRuleSpecific"
            };
            let script = format!("$ErrorActionPreference='Stop'; $p='{quoted}'; $acl=[System.IO.Directory]::GetAccessControl($p); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::ListDirectory,[System.Security.AccessControl.InheritanceFlags]::None,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Deny); $acl.{action}($rule); [System.IO.Directory]::SetAccessControl($p,$acl)");
            let out = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "Could not configure isolated directory-list permission: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        struct ListPermissionGuard(PathBuf);
        impl Drop for ListPermissionGuard {
            fn drop(&mut self) {
                set_list_denied(&self.0, false);
            }
        }
        let root = scratch("round6-cleanup-enumeration");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned payload row");
        write_restore_plan(&pending, RestoreKind::Complete, "isolated permission test").unwrap();
        let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();
        let payload_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-round6-cleanup".into(), true);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = plan.operation_id;
        journal.staged_db_artifacts.push(payload_identity.clone());
        set_list_denied(&pending, true);
        let permission_guard = ListPermissionGuard(pending.clone());
        let read_error = std::fs::read_dir(&pending).err().map(|e| e.kind());
        let ownership = verify_pending_cleanup_permission(&pending, &journal);
        let cleanup = remove_pending_directory_safely(&pending);
        let plan_preserved = std::fs::read(pending.join(RESTORE_PLAN)).ok().as_deref()
            == Some(plan_bytes.as_slice());
        let payload_preserved =
            round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == payload_identity;
        drop(permission_guard);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            read_error,
            Some(std::io::ErrorKind::PermissionDenied),
            "Must reach an actual OS directory enumeration error"
        );
        assert!(
            matches!(ownership, Ok(true)),
            "Plan reading remains permitted; directory listing is denied separately"
        );
        assert!(
            cleanup.is_err() && payload_preserved,
            "Failed cleanup must preserve its payload"
        );
        assert!(plan_preserved, "Failure to enumerate payload must not unlink the ownership plan before payload deletion is complete");
    }

    #[test]
    fn round6_cleanup_entry_read_fault_preserves_plan_and_recovers_on_restart() {
        let root = scratch("round6-entry-fault");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned payload");
        write_restore_plan(&pending, RestoreKind::Complete, "entry-fault-test").unwrap();
        let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();

        let guard = ScopedFault::set(InjectedFault::PendingEntryRead);
        let cleanup_res = remove_pending_directory_safely(&pending);
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(fired >= 1, "PendingEntryRead fault must fire");
        assert!(
            cleanup_res.is_err(),
            "Cleanup must fail when entry read fails"
        );
        let plan_after = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();
        assert_eq!(
            plan_after, plan_bytes,
            "Plan must survive failed entry reading"
        );
        assert!(
            pending.join(DB_FILES[0]).exists(),
            "Payload must survive failed entry reading"
        );

        // Now clear fault and retry cleanup directly
        let cleanup_retry = remove_pending_directory_safely(&pending);
        assert!(
            cleanup_retry.is_ok(),
            "Cleanup must succeed after fault clears"
        );
        assert!(
            !pending.exists(),
            "Pending directory must be completely removed"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn round6_cleanup_obstruction_during_startup_preserves_plan_and_clears_on_restart() {
        let root = scratch("round6-startup-obstruction");
        write_database(&root.join(DB_FILES[0]), "original committed db");
        let orig_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "restored db");
        let staged_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        write_restore_plan(&pending, RestoreKind::Database, "startup-obstruction").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        // Prepare committed restore journal
        let mut journal = RestoreJournal::new("backups/test-backup".into(), false);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Committed;
        journal.staged_db_artifacts.push(staged_identity);
        write_journal(&root, &journal).unwrap();

        // Inject PendingEntryRead fault during startup cleanup
        let guard = ScopedFault::set(InjectedFault::PendingEntryRead);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "PendingEntryRead fault must fire during startup"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Startup must block unresolved when pending cleanup fails: {first:?}"
        );
        assert!(
            pending.join(RESTORE_PLAN).exists(),
            "Plan must be preserved on disk"
        );

        // Second startup after fault clears: cleanup succeeds
        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists(), "Pending directory must be deleted");
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted"
        );

        // Third startup: proceed normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original committed db"
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_identity
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_prior_canonical_journal_preserved_on_write_sync_rename_failures() {
        let root = scratch("task4-prior-canonical-bytes");
        let mut initial_journal = RestoreJournal::new("backups/before-restore-test".into(), true);
        initial_journal.phase = RestorePhase::Protecting;
        write_journal(&root, &initial_journal).unwrap();

        let canonical_path = root.join(RESTORE_JOURNAL_FILE);
        let initial_bytes = std::fs::read(&canonical_path).unwrap();
        let initial_hash = hex::encode(Sha256::digest(&initial_bytes));

        let mut updated_journal = initial_journal.clone();
        updated_journal.phase = RestorePhase::Protected;

        let faults = [
            InjectedFault::JournalTempCreate,
            InjectedFault::JournalWrite,
            InjectedFault::JournalSync,
            InjectedFault::JournalRename,
        ];

        for fault in faults {
            let guard = ScopedFault::set(fault);
            let res = write_journal(&root, &updated_journal);
            let fired = ScopedFault::fired_count();
            drop(guard);

            assert!(fired >= 1, "Fault {fault:?} must fire: fired={fired}");
            assert!(res.is_err(), "Write must return Err on {fault:?}");

            // Prior canonical bytes and hash are completely unchanged!
            let current_bytes = std::fs::read(&canonical_path).unwrap();
            let current_hash = hex::encode(Sha256::digest(&current_bytes));
            assert_eq!(
                current_bytes, initial_bytes,
                "Canonical bytes must be unchanged on {fault:?}"
            );
            assert_eq!(
                current_hash, initial_hash,
                "Canonical hash must be unchanged on {fault:?}"
            );

            // No temporary siblings remain
            let abandoned = find_abandoned_temporary_journal_sibling(&root).unwrap();
            assert!(
                abandoned.is_none(),
                "No temporary sibling must remain after {fault:?}: found {abandoned:?}"
            );

            // Once fault is cleared, write succeeds
            write_journal(&root, &updated_journal).unwrap();
            let read_back = read_journal(&root).unwrap().unwrap();
            assert_eq!(read_back.phase, RestorePhase::Protected);

            // Reset back to initial for next fault iteration
            write_journal(&root, &initial_journal).unwrap();
        }

        std::fs::remove_dir_all(&root).unwrap();
    }

    fn find_abandoned_temporary_journal_sibling(
        dir: &Path,
    ) -> Result<Option<String>, std::io::Error> {
        let prefix = format!("{RESTORE_JOURNAL_FILE}.tmp-");
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) || name.starts_with(".tmp-") {
                return Ok(Some(name));
            }
        }
        Ok(None)
    }

    #[test]
    fn task4_temporary_sibling_detector_rejects_actual_prefix_leftover_negative_control() {
        let root = scratch("task4-temp-detector-negative-control");
        assert_eq!(
            find_abandoned_temporary_journal_sibling(&root).unwrap(),
            None,
            "Clean directory must have no temporary siblings"
        );

        let seeded_name = format!("{RESTORE_JOURNAL_FILE}.tmp-negative-control-leftover");
        let seeded_path = root.join(&seeded_name);
        std::fs::write(&seeded_path, b"deliberate unremoved temporary sibling").unwrap();
        assert!(
            seeded_path.is_file(),
            "Seeded temporary file must exist on disk"
        );

        let detected = find_abandoned_temporary_journal_sibling(&root).unwrap();
        assert_eq!(
            detected.as_deref(),
            Some(seeded_name.as_str()),
            "Detector must catch the real-prefix temporary journal sibling"
        );

        std::fs::remove_file(&seeded_path).unwrap();
        assert_eq!(
            find_abandoned_temporary_journal_sibling(&root).unwrap(),
            None,
            "Detector must clear after removing the seeded temporary file"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_wal_original_return_failure_preserves_committed_wal_and_recovers() {
        let source = scratch("c1-wal-return-source");
        write_database(&source.join(DB_FILES[0]), "base content");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'committed row in WAL only'",
            [],
        )
        .unwrap();

        let root = scratch("c1-wal-return-root");
        for name in [DB_FILES[0], DB_FILES[1]] {
            std::fs::copy(source.join(name), root.join(name)).unwrap();
        }
        drop(conn);
        std::fs::remove_dir_all(&source).unwrap();

        let wal_bytes = std::fs::read(root.join(DB_FILES[1])).unwrap();
        assert!(
            wal_bytes.len() >= 32
                && (wal_bytes[0..4] == [0x37, 0x7f, 0x06, 0x82]
                    || wal_bytes[0..4] == [0x37, 0x7f, 0x06, 0x83]),
            "Original WAL must be genuine SQLite WAL format"
        );
        let orig_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let orig_wal_identity = round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]);

        let rollback = root.join("backups/before-restore-c1-wal");
        std::fs::create_dir_all(&rollback).unwrap();
        // Move original DB and WAL into rollback
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();
        std::fs::rename(root.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();

        // Staged pending restore with distinct DB
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged restore content");
        write_restore_plan(&pending, RestoreKind::Database, "c1-wal-return").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-c1-wal".into(), false);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].to_string(), DB_FILES[1].to_string()];
        journal.original_db_artifacts = vec![orig_db_identity.clone(), orig_wal_identity.clone()];
        write_journal(&root, &journal).unwrap();

        // Inject ReturnDbRename(1) during rollback: DB[0] returns, DB[1] (WAL) fails to return
        let guard = ScopedFault::set(InjectedFault::ReturnDbRename(1));
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "ReturnDbRename(1) fault must fire: fired={fired}"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "First startup must block unresolved when WAL return fails: {first:?}"
        );
        // Original DB returned to root, original WAL safely retained in rollback directory
        assert!(
            root.join(DB_FILES[0]).exists(),
            "DB[0] must have returned to root"
        );
        assert!(
            rollback.join(DB_FILES[1]).exists(),
            "WAL must be safely retained in rollback"
        );
        assert_eq!(
            round3_identity(&rollback.join(DB_FILES[1]), DB_FILES[1]),
            orig_wal_identity
        );

        // Second startup: fault is cleared, rollback resumes and returns remaining WAL
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Second startup must recover rolled back original data: {second:?}"
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_db_identity
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]),
            orig_wal_identity
        );

        // Third startup: proceeds normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);

        // Verify SQLite can open and query the committed WAL-only row!
        let row = database_contents(&root.join(DB_FILES[0]));
        assert_eq!(
            row, "committed row in WAL only",
            "Committed WAL-only row must survive and be readable"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_documents_original_return_failure_preserves_documents_and_recovers() {
        let root = scratch("c1-docs-return-root");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let rollback = root.join("backups/before-restore-c1-docs");
        let rollback_docs = rollback.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&rollback_docs).unwrap();

        // Two distinct original synthetic document payloads
        let doc1_path = rollback_docs.join("manual.pdf");
        let doc2_path = rollback_docs.join("checklist.txt");
        std::fs::write(&doc1_path, b"%PDF-1.4 original document bytes").unwrap();
        std::fs::write(&doc2_path, b"Preflight checklist: original items").unwrap();
        let doc1_identity = round3_identity(&doc1_path, "manual.pdf");
        let doc2_identity = round3_identity(&doc2_path, "checklist.txt");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        write_restore_plan(&pending, RestoreKind::Complete, "c1-docs-return").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-c1-docs".into(), true);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_db_artifacts = vec![orig_db_identity];
        journal.original_document_artifacts = vec![doc1_identity.clone(), doc2_identity.clone()];
        write_journal(&root, &journal).unwrap();

        // Inject ReturnDocsRename fault during rollback
        let guard = ScopedFault::set(InjectedFault::ReturnDocsRename);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "ReturnDocsRename fault must fire: fired={fired}"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "First startup must block unresolved when document return fails: {first:?}"
        );
        // Documents preserved in rollback folder
        assert_eq!(round3_identity(&doc1_path, "manual.pdf"), doc1_identity);
        assert_eq!(round3_identity(&doc2_path, "checklist.txt"), doc2_identity);
        assert!(
            !root.join(DOCUMENTS_DIR).exists(),
            "Active documents dir must not be partially created on failure"
        );

        // Second startup: fault cleared, rollback returns documents
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Second startup must recover rolled back documents: {second:?}"
        );
        assert_eq!(
            round3_identity(&root.join(DOCUMENTS_DIR).join("manual.pdf"), "manual.pdf"),
            doc1_identity
        );
        assert_eq!(
            round3_identity(
                &root.join(DOCUMENTS_DIR).join("checklist.txt"),
                "checklist.txt"
            ),
            doc2_identity
        );

        // Third startup: proceeds normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);

        std::fs::remove_dir_all(&root).unwrap();
    }

    struct M2ArchiveFixture(PathBuf);
    impl Drop for M2ArchiveFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn m2_archive_fixture() -> (M2ArchiveFixture, Connection) {
        static FIXTURE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let count = FIXTURE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "m2-archive-test-{}-{}-{}",
            std::process::id(),
            count,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for migration in crate::migrations() {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute_batch(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations VALUES(11);
             INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('mat','Synthetic','2026-10-04','2026-10-04');",
        )
        .unwrap();
        crate::practice_sessions::mark_root_ready(&root);
        crate::practice_sessions::save_practice_test_at(
            &root,
            "mat",
            "Synthetic",
            r#"[{"question":"Synthetic","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#,
            "synthetic",
        )
        .unwrap();
        (M2ArchiveFixture(root), conn)
    }

    fn m2_start(f: &M2ArchiveFixture, c: &Connection) -> serde_json::Value {
        let v: String = c
            .query_row("SELECT id FROM practice_test_versions", [], |r| r.get(0))
            .unwrap();
        crate::practice_sessions::save_practice_session_at(
            &f.0,
            &serde_json::json!({
                "action": "start_or_resume",
                "operationId": "10000000-0000-4000-8000-000000000001",
                "materialId": "mat",
                "versionId": v
            }),
        )
        .unwrap()
    }

    fn m2_response(
        f: &M2ArchiveFixture,
        c: &Connection,
        s: &serde_json::Value,
        revision: i64,
        op: &str,
    ) -> serde_json::Value {
        let item: String = c
            .query_row("SELECT id FROM practice_test_items", [], |r| r.get(0))
            .unwrap();
        crate::practice_sessions::save_practice_session_at(
            &f.0,
            &serde_json::json!({
                "action": "record_response",
                "operationId": op,
                "attemptId": s["attemptId"],
                "itemId": item,
                "expectedRevision": revision,
                "selectedIndex": 1,
                "isDontKnow": false
            }),
        )
        .unwrap()
    }

    #[test]
    fn valid_schema_11_control_is_accepted() {
        let (f, _) = m2_archive_fixture();
        assert!(verify_application_database(&f.0.join("her-flight-deck.db")).is_ok());
    }

    #[test]
    fn missing_required_unique_index_is_refused() {
        let (f, c) = m2_archive_fixture();
        c.execute_batch("DROP INDEX uq_single_in_progress_attempt")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "archive without required single-attempt index was accepted"
        );
    }

    #[test]
    fn malformed_receipt_json_is_refused() {
        let (f, c) = m2_archive_fixture();
        m2_start(&f, &c);
        c.execute_batch("UPDATE practice_session_operations SET result_json='not-json'")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "archive with malformed receipt JSON was accepted"
        );
    }

    #[test]
    fn foreign_key_violation_is_refused() {
        let (f, c) = m2_archive_fixture();
        c.pragma_update(None, "foreign_keys", "OFF").unwrap();
        c.execute_batch("UPDATE practice_test_versions SET source_material_id='missing'")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "archive with missing source foreign key was accepted"
        );
    }

    #[test]
    fn frozen_key_score_is_derived() {
        let (f, c) = m2_archive_fixture();
        let s = m2_start(&f, &c);
        m2_response(&f, &c, &s, 0, "10000000-0000-4000-8000-000000000002");
        c.execute_batch("UPDATE practice_responses SET is_correct=1")
            .unwrap();
        let result = crate::practice_sessions::save_practice_session_at(
            &f.0,
            &serde_json::json!({
                "action": "complete_attempt",
                "operationId": "10000000-0000-4000-8000-000000000003",
                "attemptId": s["attemptId"],
                "expectedRevision": 1
            }),
        )
        .unwrap();
        assert_eq!(result["scorePercent"], serde_json::json!(0.0));
    }

    #[test]
    fn no_op_preserves_returned_answered_time() {
        let (f, c) = m2_archive_fixture();
        let s = m2_start(&f, &c);
        let first = m2_response(&f, &c, &s, 0, "10000000-0000-4000-8000-000000000002");
        std::thread::sleep(std::time::Duration::from_millis(20));
        let second = m2_response(&f, &c, &s, 1, "10000000-0000-4000-8000-000000000003");
        assert_eq!(first["answeredAt"], second["answeredAt"]);
    }

    #[test]
    fn receipt_empty_object_refused() {
        let (f, c) = m2_archive_fixture();
        m2_start(&f, &c);
        c.execute_batch("UPDATE practice_session_operations SET result_json='{}'")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "empty-object result was accepted"
        );
    }

    #[test]
    fn out_of_range_stored_response_refused() {
        let (f, c) = m2_archive_fixture();
        let s = m2_start(&f, &c);
        m2_response(&f, &c, &s, 0, "10000000-0000-4000-8000-000000000002");
        c.execute_batch("UPDATE practice_responses SET selected_index=99")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "selected_index=99 for two options was accepted"
        );
    }

    #[test]
    fn cross_material_attempt_refused() {
        let (f, c) = m2_archive_fixture();
        m2_start(&f, &c);
        c.execute_batch(
            "INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('other','Other synthetic','2026-10-04','2026-10-04');
             UPDATE practice_attempts SET source_material_id='other';",
        )
        .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "cross-material attempt owner was accepted"
        );
    }

    #[test]
    fn counterfeit_unique_index_refused() {
        let (f, c) = m2_archive_fixture();
        c.execute_batch(
            "DROP INDEX uq_single_in_progress_attempt;
             CREATE INDEX uq_single_in_progress_attempt ON practice_attempts(source_material_id);",
        )
        .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "same-name nonunique replacement was accepted"
        );
    }

    #[test]
    fn missing_version_column_refused() {
        let (f, c) = m2_archive_fixture();
        c.execute_batch("ALTER TABLE practice_test_versions DROP COLUMN model")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "missing version model column was accepted"
        );
    }

    #[test]
    fn null_completed_score_refused() {
        let (f, c) = m2_archive_fixture();
        let s = m2_start(&f, &c);
        m2_response(&f, &c, &s, 0, "10000000-0000-4000-8000-000000000002");
        crate::practice_sessions::save_practice_session_at(
            &f.0,
            &serde_json::json!({
                "action": "complete_attempt",
                "operationId": "10000000-0000-4000-8000-000000000003",
                "attemptId": s["attemptId"],
                "expectedRevision": 1
            }),
        )
        .unwrap();
        c.execute_batch("UPDATE practice_attempts SET score_percent=NULL")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "null completed score was accepted"
        );
    }

    #[test]
    fn valid_schema_11_archive_round_trip() {
        let (source_fixture, source_conn) = m2_archive_fixture();
        let s = m2_start(&source_fixture, &source_conn);
        m2_response(
            &source_fixture,
            &source_conn,
            &s,
            0,
            "10000000-0000-4000-8000-000000000002",
        );
        drop(source_conn);

        let backup_dir = scratch("schema-11-backup-out");
        let archive = backup_dir.join("schema11.hfdbackup");
        let info =
            create_consistent_complete_backup_with_retry(&source_fixture.0, &archive, "0.5.3")
                .unwrap();
        assert!(info.files >= 1);
        assert!(archive.is_file());

        let target_root = scratch("schema-11-restore-target");
        let staged = stage_complete_restore_in(&target_root, &archive, "0.5.3").unwrap();
        assert!(staged.files >= 1);

        apply_pending_restore_in(&target_root).unwrap();
        let restored_db = target_root.join(DB_FILES[0]);
        assert!(restored_db.is_file());
        assert!(verify_application_database(&restored_db).is_ok());

        let conn = Connection::open(&restored_db).unwrap();
        let version_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_test_versions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(version_count >= 1);
        let attempt_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_attempts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(attempt_count, 1);
        let response_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_responses", [], |r| r.get(0))
            .unwrap();
        assert_eq!(response_count, 1);

        let _ = std::fs::remove_dir_all(&backup_dir);
        let _ = std::fs::remove_dir_all(&target_root);
    }

    #[test]
    fn legacy_schema_10_archive_upgrade_round_trip() {
        let source_root = scratch("schema-10-source");
        let source_db = source_root.join(DB_FILES[0]);
        let conn = Connection::open(&source_db).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for migration in crate::migrations().iter().filter(|m| m.version <= 10) {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO _sqlx_migrations (version) VALUES (10);
             INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-10', 'Mat 10', '2026-10-01', '2026-10-01');
             INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at)
             VALUES ('mat-10', 'Title 10', '[{\"question\":\"Legacy Q\",\"options\":[\"A\",\"B\"],\"correctIndex\":0,\"explanation\":\"\",\"sourcePage\":null}]', 'local', 'synthetic', '2026-10-01', '2026-10-01');",
        )
        .unwrap();
        drop(conn);

        // Verify schema 10 source database passes validation
        assert!(verify_application_database(&source_db).is_ok());

        // Create backup of schema 10 database
        let backup_dir = scratch("schema-10-backup-out");
        let archive = backup_dir.join("schema10.hfdbackup");
        create_consistent_complete_backup_with_retry(&source_root, &archive, "0.5.3").unwrap();
        assert!(archive.is_file());

        // Restore into a target root
        let target_root = scratch("schema-10-upgrade-target");
        stage_complete_restore_in(&target_root, &archive, "0.5.3").unwrap();
        apply_pending_restore_in(&target_root).unwrap();

        let restored_db = target_root.join(DB_FILES[0]);
        assert!(verify_application_database(&restored_db).is_ok());

        // Apply migration 11 on the restored database
        let m11 = crate::migrations()
            .into_iter()
            .find(|m| m.version == 11)
            .unwrap();
        let conn = Connection::open(&restored_db).unwrap();
        conn.execute_batch(m11.sql).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations(version) VALUES (11);
             UPDATE _sqlx_migrations SET version = 11;",
        )
        .unwrap();
        drop(conn);

        // Run legacy conversion
        let converted = crate::practice_sessions::run_legacy_conversion_at(&target_root).unwrap();
        assert_eq!(converted, 1);

        // Now upgraded database must pass schema 11 invariant validation
        assert!(verify_application_database(&restored_db).is_ok());

        // Check active version created
        let conn = Connection::open(&restored_db).unwrap();
        let is_active: i64 = conn
            .query_row(
                "SELECT is_active FROM practice_test_versions WHERE source_material_id = 'mat-10'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(is_active, 1);

        let _ = std::fs::remove_dir_all(&source_root);
        let _ = std::fs::remove_dir_all(&backup_dir);
        let _ = std::fs::remove_dir_all(&target_root);
    }

    /// OFFLINE-03b r7 (a): her pre-authoring library survives the upgrade path.
    /// A schema-16 archive — one Gemini practice test with one completed
    /// attempt and one instructor-origin row — is backed up, staged, applied,
    /// and then takes the migrations it has not seen yet exactly as the app
    /// does on the next launch. The whole verification ladder passes on the
    /// upgraded database, the practice test reads back through the authoring
    /// reader with the content hash its version row already carried, the
    /// attempt survives and an authored test starts with an empty ledger.
    #[test]
    fn schema_16_archive_restores_and_upgrades_to_17() {
        let v1_questions = r#"[{"question":"Synthetic one","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#;
        let v2_questions = r#"[{"question":"Synthetic two","options":["A","B","C"],"correctIndex":2,"explanation":"Because C.","sourcePage":4}]"#;

        let source_root = scratch("schema-16-03b-source");
        let source_db = source_root.join(DB_FILES[0]);
        {
            let conn = Connection::open(&source_db).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            for migration in crate::migrations().iter().filter(|m| m.version <= 16) {
                conn.execute_batch(migration.sql).unwrap();
            }
            conn.execute_batch(
                "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
                 INSERT INTO _sqlx_migrations (version) VALUES (16);
                 INSERT INTO study_materials (id, title, created_at, updated_at)
                 VALUES ('mat-16', 'Synthetic sixteen', '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z');",
            )
            .unwrap();
        }

        // The test, one completed attempt against its first version, then a
        // regeneration. The instructor origin lands on the superseded version's
        // question, so the current test's hash stays the stored legacy hash.
        crate::practice_sessions::mark_root_ready(&source_root);
        crate::practice_sessions::save_practice_test_at(
            &source_root,
            "mat-16",
            "Synthetic sixteen",
            v1_questions,
            "synthetic",
        )
        .unwrap();
        let v1_id = {
            let conn = Connection::open(&source_db).unwrap();
            conn.query_row(
                "SELECT id FROM practice_test_versions WHERE source_material_id = 'mat-16' AND is_active = 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
        };
        let start = crate::practice_sessions::save_practice_session_at(
            &source_root,
            &serde_json::json!({
                "action": "start_or_resume",
                "operationId": "20000000-0000-4000-8000-000000000001",
                "materialId": "mat-16",
                "versionId": v1_id,
            }),
        )
        .unwrap();
        let v1_item = {
            let conn = Connection::open(&source_db).unwrap();
            conn.query_row(
                "SELECT id FROM practice_test_items WHERE version_id = ?1 ORDER BY ordinal",
                [&v1_id],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
        };
        crate::practice_sessions::save_practice_session_at(
            &source_root,
            &serde_json::json!({
                "action": "record_response",
                "operationId": "20000000-0000-4000-8000-000000000002",
                "attemptId": start["attemptId"],
                "itemId": v1_item.clone(),
                "expectedRevision": 0,
                "selectedIndex": 0,
                "isDontKnow": false,
            }),
        )
        .unwrap();
        crate::practice_sessions::save_practice_session_at(
            &source_root,
            &serde_json::json!({
                "action": "complete_attempt",
                "operationId": "20000000-0000-4000-8000-000000000003",
                "attemptId": start["attemptId"],
                "expectedRevision": 1,
            }),
        )
        .unwrap();
        crate::practice_sessions::save_practice_test_at(
            &source_root,
            "mat-16",
            "Synthetic sixteen",
            v2_questions,
            "synthetic",
        )
        .unwrap();
        let stored_hash = {
            let conn = Connection::open(&source_db).unwrap();
            let stored_hash: String = conn
                .query_row(
                    "SELECT content_hash FROM practice_test_versions WHERE source_material_id = 'mat-16' AND is_active = 1",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let v1_hash: String = conn
                .query_row(
                    "SELECT content_hash FROM practice_test_versions WHERE id = ?1",
                    [&v1_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_ne!(
                stored_hash, v1_hash,
                "the fixture must really span two versions"
            );
            conn.execute(
                "INSERT INTO practice_item_origins (item_id, origin) VALUES (?1, 'instructor')",
                [&v1_item],
            )
            .unwrap();
            stored_hash
        };

        // Still a schema-16 library: the ladder up to 16 accepts it.
        assert!(verify_application_database(&source_db).is_ok());

        let backup_dir = scratch("schema-16-03b-backup");
        let archive = backup_dir.join("schema16.hfdbackup");
        create_consistent_complete_backup_with_retry(&source_root, &archive, "0.6.0").unwrap();
        let target_root = scratch("schema-16-03b-target");
        stage_complete_restore_in(&target_root, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target_root).unwrap();
        let restored_db = target_root.join(DB_FILES[0]);
        assert!(restored_db.is_file());
        assert!(verify_application_database(&restored_db).is_ok());

        // The app's own upgrade step: every migration above the newest the
        // restored library records, in order, each one recorded as it lands.
        {
            let conn = Connection::open(&restored_db).unwrap();
            let applied: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(applied, 16);
            for migration in crate::migrations()
                .into_iter()
                .filter(|m| m.version > applied)
            {
                conn.execute_batch(migration.sql).unwrap();
                conn.execute(
                    "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
                    [migration.version],
                )
                .unwrap();
            }
        }

        // The whole ladder now runs the schema-17 authoring semantics too.
        assert!(
            verify_application_database(&restored_db).is_ok(),
            "a schema-16 archive upgraded to 17 must pass the application ladder"
        );

        let conn = Connection::open(&restored_db).unwrap();
        let current = crate::practice_authoring::read_current_snapshot(&conn, "mat-16")
            .unwrap()
            .expect("the restored practice test reads back through the authoring reader");
        assert_eq!(current.version_number, 2);
        assert_eq!(current.questions.len(), 1);
        assert_eq!(
            crate::practice_authoring::practice_content_hash(&current.questions),
            stored_hash,
            "the content hash must survive the archive and the upgrade unchanged"
        );
        let completed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_attempts WHERE source_material_id = 'mat-16' AND status = 'completed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(completed, 1, "her completed attempt must survive");
        let origins: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_item_origins", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(origins, 1);
        assert!(
            current.retired.is_empty(),
            "a test she never authored starts with an empty ledger"
        );

        let _ = std::fs::remove_dir_all(&source_root);
        let _ = std::fs::remove_dir_all(&backup_dir);
        let _ = std::fs::remove_dir_all(&target_root);
    }

    // GEN-01b: disposable databases only; the same contract runs in both TS engines.
    fn pdf_kit_test_database(path: &Path, through: i64) {
        let conn = Connection::open(path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
            .unwrap();
        for migration in crate::migrations()
            .into_iter()
            .filter(|m| m.version <= through)
        {
            conn.execute_batch(migration.sql).unwrap();
            conn.execute(
                "INSERT INTO _sqlx_migrations VALUES (?1)",
                [migration.version],
            )
            .unwrap();
        }
    }

    fn pdf_kit_contract() -> serde_json::Value {
        serde_json::from_str(include_str!("../fixtures/pdf-kit-validation/cases.json")).unwrap()
    }

    fn pdf_kit_seed(conn: &Connection) {
        for sql in pdf_kit_contract()["baseline"].as_array().unwrap() {
            conn.execute_batch(sql.as_str().unwrap()).unwrap();
        }
    }

    #[test]
    fn shared_pdf_kit_validation_contract_native_outcomes() {
        let contract = pdf_kit_contract();
        let mut mismatches = Vec::new();
        for case in contract["cases"].as_array().unwrap() {
            let root = scratch("pdf-kit-contract");
            let path = root.join(DB_FILES[0]);
            pdf_kit_test_database(&path, 18);
            {
                let conn = Connection::open(&path).unwrap();
                conn.pragma_update(None, "foreign_keys", "ON").unwrap();
                pdf_kit_seed(&conn);
                for sql in case["sql"].as_array().unwrap() {
                    conn.execute_batch(sql.as_str().unwrap()).unwrap();
                }
            }
            // Reopen: schema edits must take effect just as they do on app launch.
            let conn = Connection::open(&path).unwrap();
            let result = verify_schema_18_pdf_kit_semantics(&conn);
            let application = verify_application_database(&path);
            assert_eq!(
                application.is_ok(),
                result.is_ok(),
                "application ladder disagrees: {}",
                case["name"]
            );
            drop(conn);
            let outcome = if result.is_ok() { "accept" } else { "refuse" };
            if outcome != case["expect"].as_str().unwrap() {
                mismatches.push(format!("{}: {result:?}", case["name"]));
            }
            std::fs::remove_dir_all(root).unwrap();
        }
        assert!(mismatches.is_empty(), "{mismatches:#?}");
        assert!(contract["cases"].as_array().unwrap().len() >= 12);
    }

    #[test]
    fn schema_17_archive_restores_and_upgrades_to_18() {
        let root = scratch("kit17-source");
        let target = scratch("kit17-target");
        let path = root.join(DB_FILES[0]);
        pdf_kit_test_database(&path, 17);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('old','Synthetic','x','x')").unwrap();
        }
        assert!(verify_application_database(&path).is_ok());
        let backup_dir = scratch("kit-backup");
        let archive = backup_dir.join("schema17.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
        stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target).unwrap();
        let restored = target.join(DB_FILES[0]);
        assert!(verify_application_database(&restored).is_ok());
        {
            let conn = Connection::open(&restored).unwrap();
            assert_eq!(newest_migration_version(&conn).unwrap(), 17);
            assert_eq!(
                m3_count(
                    &conn,
                    "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'pdf_kit_%'",
                    &[]
                )
                .unwrap(),
                0
            );
            for migration in crate::migrations().into_iter().filter(|m| m.version > 17) {
                conn.execute_batch(migration.sql).unwrap();
                conn.execute(
                    "INSERT INTO _sqlx_migrations VALUES (?1)",
                    [migration.version],
                )
                .unwrap();
            }
            assert_eq!(newest_migration_version(&conn).unwrap(), 18);
            assert_eq!(
                m3_count(
                    &conn,
                    "SELECT COUNT(*) FROM study_materials WHERE id = 'old'",
                    &[]
                )
                .unwrap(),
                1
            );
            for table in ["pdf_kit_runs", "pdf_kit_item_sources"] {
                assert_eq!(
                    m3_count(&conn, &format!("SELECT COUNT(*) FROM {table}"), &[]).unwrap(),
                    0
                );
            }
        }
        assert!(verify_application_database(&restored).is_ok());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(backup_dir).unwrap();
        std::fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn schema_18_pdf_kit_archive_round_trip() {
        let root = scratch("kit18-source");
        let target = scratch("kit18-target");
        let path = root.join(DB_FILES[0]);
        pdf_kit_test_database(&path, 18);
        let before = {
            let conn = Connection::open(&path).unwrap();
            pdf_kit_seed(&conn);
            ["pdf_kit_runs", "pdf_kit_item_sources"].map(|table| {
                m3_rows(&conn, &format!("SELECT * FROM {table} ORDER BY rowid"), &[]).unwrap()
            })
        };
        let backup_dir = scratch("kit-backup");
        let archive = backup_dir.join("schema18.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
        stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target).unwrap();
        let restored = target.join(DB_FILES[0]);
        assert!(verify_application_database(&restored).is_ok());
        {
            let conn = Connection::open(&restored).unwrap();
            assert_eq!(newest_migration_version(&conn).unwrap(), 18);
            let after = ["pdf_kit_runs", "pdf_kit_item_sources"].map(|table| {
                m3_rows(&conn, &format!("SELECT * FROM {table} ORDER BY rowid"), &[]).unwrap()
            });
            assert_eq!(before, after);
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            conn.execute("DELETE FROM study_materials WHERE id = 'mat-kit'", [])
                .unwrap();
            for table in ["pdf_kit_runs", "pdf_kit_item_sources"] {
                assert_eq!(
                    m3_count(&conn, &format!("SELECT COUNT(*) FROM {table}"), &[]).unwrap(),
                    0
                );
            }
        }
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(backup_dir).unwrap();
        std::fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn tampered_schema_18_pdf_kit_archive_refused() {
        for sql in [
            "UPDATE pdf_kit_item_sources SET run_id = 'missing'",
            "UPDATE pdf_kit_runs SET content_sha256 = 'bad'",
            "UPDATE pdf_kit_item_sources SET content_hash = 'bad'",
            "UPDATE pdf_kit_item_sources SET page = 1001",
            "UPDATE pdf_kit_item_sources SET end_offset = start_offset",
        ] {
            let root = scratch("kit18-tampered");
            let target = scratch("kit18-refused-target");
            let path = root.join(DB_FILES[0]);
            pdf_kit_test_database(&path, 18);
            let backup_dir = scratch("kit-backup");
            let archive = backup_dir.join("tampered.hfdbackup");
            {
                let conn = Connection::open(&path).unwrap();
                pdf_kit_seed(&conn);
            }
            create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
            {
                let conn = Connection::open(&path).unwrap();
                conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
                conn.pragma_update(None, "ignore_check_constraints", "ON")
                    .unwrap();
                conn.execute_batch(sql).unwrap();
            }
            // Rebind archive integrity so refusal reaches database semantics,
            // rather than merely detecting changed ZIP bytes.
            let bytes = std::fs::read(&path).unwrap();
            rewrite_entry(&archive, DB_FILES[0], &bytes);
            let mut integrity: CompleteBackupIntegrity = {
                let mut zip = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
                serde_json::from_reader(zip.by_name(ARCHIVE_INTEGRITY).unwrap()).unwrap()
            };
            let entry = integrity
                .files
                .iter_mut()
                .find(|e| e.path == DB_FILES[0])
                .unwrap();
            entry.bytes = bytes.len() as u64;
            entry.sha256 = sha256_digest(&bytes);
            rewrite_entry(
                &archive,
                ARCHIVE_INTEGRITY,
                &serde_json::to_vec(&integrity).unwrap(),
            );
            let conn = Connection::open(&path).unwrap();
            assert!(
                verify_schema_18_pdf_kit_semantics(&conn).is_err(),
                "accepted semantics: {sql}"
            );
            drop(conn);
            let error = inspect_archive(&target, &archive, "0.6.0").unwrap_err();
            assert!(
                !error.contains("integrity"),
                "did not reach the native database verifier: {error}"
            );
            assert!(
                stage_complete_restore_in(&target, &archive, "0.6.0").is_err(),
                "staged tampering: {sql}"
            );
            assert!(!target.join(DB_FILES[0]).exists());
            std::fs::remove_dir_all(root).unwrap();
            std::fs::remove_dir_all(backup_dir).unwrap();
            std::fs::remove_dir_all(target).unwrap();
        }
    }

    /// OFFLINE-03b r7 (b): an authored schema-17 archive round-trips whole.
    /// Create, edit (carrying the exact retirement record) and an instructor
    /// correction all go through `practice_authoring::save_practice_authoring_at`.
    /// The restored library reads back the same snapshot field for field and
    /// keeps every receipt and history row, and replaying the exact edit
    /// operation there is recognised as the same committed operation —
    /// `already_saved`, not a second version.
    #[test]
    fn schema_17_authored_archive_round_trip() {
        use crate::practice_authoring::{
            decode_question, practice_retirement_record, read_current_snapshot,
            retirement_record_value, save_practice_authoring_at, snapshot_value,
        };

        let identity_one = "e1000000-0000-4000-8000-000000000001";
        let identity_two = "e2000000-0000-4000-8000-000000000002";
        let question = |identity: &str, stem: &str, origin: Option<&str>| {
            let mut value = serde_json::json!({
                "question": stem,
                "options": ["An ATC clearance", "A flight plan only", "Nothing"],
                "correctIndex": 0,
                "explanation": "Clearance before entering.",
                "sourcePage": 12,
                "identity": identity,
            });
            if let Some(origin) = origin {
                value
                    .as_object_mut()
                    .unwrap()
                    .insert("origin".to_string(), serde_json::json!(origin));
            }
            value
        };
        let next = |questions: Vec<serde_json::Value>, retired: Vec<serde_json::Value>| {
            serde_json::json!({
                "title": "Class B study aid",
                "provider": "manual",
                "model": "",
                "questions": questions,
                "retired": retired,
            })
        };
        let operation = |operation_id: &str,
                         reason: &str,
                         expected: serde_json::Value,
                         next: Option<serde_json::Value>| {
            serde_json::json!({
                "operationId": operation_id,
                "sourceMaterialId": "mat-a",
                "reason": reason,
                "expected": expected,
                "next": next.unwrap_or(serde_json::Value::Null),
            })
        };
        let retirement = |question: &serde_json::Value, reason: &str| {
            retirement_record_value(&practice_retirement_record(
                &decode_question(question).unwrap(),
                reason,
            ))
        };
        let current_json = |root: &Path| -> serde_json::Value {
            let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
            let value = read_current_snapshot(&conn, "mat-a")
                .unwrap()
                .map(|snapshot| snapshot_value(&snapshot))
                .unwrap_or(serde_json::Value::Null);
            drop(conn);
            value
        };
        let count = |conn: &Connection, sql: &str| -> i64 {
            conn.query_row(sql, [], |r| r.get(0)).unwrap()
        };

        let source_root = scratch("schema-17-03b-source");
        let source_db = source_root.join(DB_FILES[0]);
        {
            let conn = Connection::open(&source_db).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            for migration in crate::migrations() {
                conn.execute_batch(migration.sql).unwrap();
            }
            conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
                .unwrap();
            for migration in crate::migrations() {
                conn.execute(
                    "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
                    [migration.version],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-a', 'Class B clearances', '2026-10-19T09:00:00.000Z', '2026-10-19T09:00:00.000Z')",
                [],
            )
            .unwrap();
        }

        let first = question(identity_one, "What does entry into Class B require?", None);
        let second = question(identity_two, "What is the usual vertical limit?", None);
        save_practice_authoring_at(
            &source_root,
            &operation(
                "e0000000-0000-4000-8000-000000000001",
                "create",
                serde_json::Value::Null,
                Some(next(vec![first.clone(), second.clone()], vec![])),
            ),
        )
        .unwrap();

        let first_rewritten = question(
            identity_one,
            "What must you have before entering Class B?",
            None,
        );
        let edit = operation(
            "e0000000-0000-4000-8000-000000000002",
            "edit",
            current_json(&source_root),
            Some(next(
                vec![first_rewritten.clone(), second.clone()],
                vec![retirement(&first, "corrected")],
            )),
        );
        save_practice_authoring_at(&source_root, &edit).unwrap();

        let second_rewritten = question(
            identity_two,
            "Class B normally tops out at what altitude?",
            Some("instructor"),
        );
        save_practice_authoring_at(
            &source_root,
            &operation(
                "e0000000-0000-4000-8000-000000000003",
                "correct",
                current_json(&source_root),
                Some(next(
                    vec![first_rewritten, second_rewritten],
                    vec![
                        retirement(&first, "corrected"),
                        retirement(&second, "corrected"),
                    ],
                )),
            ),
        )
        .unwrap();

        let source_conn = Connection::open(&source_db).unwrap();
        let source_snapshot = read_current_snapshot(&source_conn, "mat-a").unwrap();
        let source_receipts = count(
            &source_conn,
            "SELECT COUNT(*) FROM practice_save_operations",
        );
        let source_history = count(
            &source_conn,
            "SELECT COUNT(*) FROM study_set_history WHERE kind = 'practice'",
        );
        drop(source_conn);
        assert!(verify_application_database(&source_db).is_ok());

        let backup_dir = scratch("schema-17-03b-backup");
        let archive = backup_dir.join("schema17.hfdbackup");
        create_consistent_complete_backup_with_retry(&source_root, &archive, "0.6.0").unwrap();
        let target_root = scratch("schema-17-03b-target");
        stage_complete_restore_in(&target_root, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target_root).unwrap();
        let restored_db = target_root.join(DB_FILES[0]);
        assert!(verify_application_database(&restored_db).is_ok());

        let restored_conn = Connection::open(&restored_db).unwrap();
        let restored_snapshot = read_current_snapshot(&restored_conn, "mat-a").unwrap();
        assert_eq!(
            restored_snapshot, source_snapshot,
            "the restored authored test must equal the source field for field"
        );
        assert_eq!(
            count(
                &restored_conn,
                "SELECT COUNT(*) FROM practice_save_operations"
            ),
            source_receipts
        );
        assert_eq!(
            count(
                &restored_conn,
                "SELECT COUNT(*) FROM study_set_history WHERE kind = 'practice'"
            ),
            source_history
        );
        assert_eq!(source_receipts, 3);
        assert_eq!(source_history, 2);
        drop(restored_conn);

        // The exact edit operation replayed against the restored library is the
        // same committed operation, so it changes nothing and says so.
        let replay = save_practice_authoring_at(&target_root, &edit).unwrap();
        assert_eq!(replay.status, "already_saved");
        let after = Connection::open(&restored_db).unwrap();
        assert_eq!(
            count(&after, "SELECT COUNT(*) FROM practice_save_operations"),
            source_receipts
        );
        assert_eq!(
            read_current_snapshot(&after, "mat-a").unwrap(),
            restored_snapshot
        );
        drop(after);

        let _ = std::fs::remove_dir_all(&source_root);
        let _ = std::fs::remove_dir_all(&backup_dir);
        let _ = std::fs::remove_dir_all(&target_root);
    }

    #[test]
    fn interrupted_conversion_preserves_state_and_safe_retry() {
        let root = scratch("interrupted-conversion");
        let db_path = root.join(DB_FILES[0]);
        let conn = Connection::open(&db_path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for migration in crate::migrations() {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations(version) VALUES (11);
             INSERT INTO study_materials(id, title, created_at, updated_at) VALUES('mat-retry', 'Retry Title', '2026-10-04', '2026-10-04');
             INSERT INTO practice_tests(source_material_id, title, questions_json, provider, model, generated_at, updated_at)
             VALUES('mat-retry', 'Retry Test', '[{\"question\":\"Retry Q\",\"options\":[\"A\",\"B\"],\"correctIndex\":0,\"explanation\":\"\",\"sourcePage\":null}]', 'local', 'synthetic', '2026-10-04', '2026-10-04');",
        )
        .unwrap();

        // Inject trigger that aborts item insertion during conversion
        conn.execute_batch(
            "CREATE TRIGGER abort_conversion_items BEFORE INSERT ON practice_test_items
             BEGIN
                 SELECT RAISE(ABORT, 'synthetic interruption during conversion');
             END;",
        )
        .unwrap();
        drop(conn);

        // Attempt conversion: must fail and rollback cleanly
        let err = crate::practice_sessions::run_legacy_conversion_at(&root).unwrap_err();
        assert!(err.contains("synthetic interruption"));

        // Verify preserved prior state: nothing partially written into versions/items
        let conn = Connection::open(&db_path).unwrap();
        let ver_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_test_versions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            ver_count, 0,
            "Versions must be rolled back on conversion interruption"
        );
        let item_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_test_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            item_count, 0,
            "Items must be rolled back on conversion interruption"
        );
        let (migrated_at, legacy_err): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT legacy_migrated_at, legacy_error FROM practice_tests WHERE source_material_id = 'mat-retry'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(migrated_at.is_none());
        assert!(legacy_err.is_none());

        // Remove synthetic block and retry conversion safely
        conn.execute_batch("DROP TRIGGER abort_conversion_items;")
            .unwrap();
        drop(conn);

        let converted = crate::practice_sessions::run_legacy_conversion_at(&root).unwrap();
        assert_eq!(converted, 1, "Retry must convert successfully");

        // Verify safe retry completed
        let conn = Connection::open(&db_path).unwrap();
        let ver_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_test_versions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(ver_count, 1);
        let (migrated_at, legacy_err): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT legacy_migrated_at, legacy_error FROM practice_tests WHERE source_material_id = 'mat-retry'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(migrated_at.is_some());
        assert!(legacy_err.is_none());
        drop(conn);

        // Complete database now passes schema 11 verification
        assert!(verify_application_database(&db_path).is_ok());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn interrupted_restore_preserves_prior_state_and_safe_retry() {
        let (orig_fixture, orig_conn) = m2_archive_fixture();
        drop(orig_conn);
        let orig_hash = sha256_digest(&std::fs::read(orig_fixture.0.join(DB_FILES[0])).unwrap());

        // Create a new backup archive to restore
        let (new_fixture, new_conn) = m2_archive_fixture();
        let s = m2_start(&new_fixture, &new_conn);
        m2_response(
            &new_fixture,
            &new_conn,
            &s,
            0,
            "10000000-0000-4000-8000-000000000002",
        );
        drop(new_conn);

        let backup_dir = scratch("interrupted-restore-archive");
        let archive = backup_dir.join("new.hfdbackup");
        create_consistent_complete_backup_with_retry(&new_fixture.0, &archive, "0.5.3").unwrap();

        // Stage restore into orig_fixture
        stage_complete_restore_in(&orig_fixture.0, &archive, "0.5.3").unwrap();

        // 1. Interrupted restore due to fault during install
        {
            let _guard = ScopedFault::set(InjectedFault::InstallDbRename(0));
            let res = apply_pending_restore_in_internal(&orig_fixture.0, || Ok(())).unwrap();
            assert!(
                matches!(res, RestoreApplicationResult::Recovered(_)),
                "Interrupted restore must rollback and recover: {res:?}"
            );
        }

        // Verify original prior state is completely preserved
        assert_eq!(
            sha256_digest(&std::fs::read(orig_fixture.0.join(DB_FILES[0])).unwrap()),
            orig_hash,
            "Original database must be intact after interrupted restore"
        );

        // 2. Safe retry: stage again and apply without fault
        stage_complete_restore_in(&orig_fixture.0, &archive, "0.5.3").unwrap();
        let res_retry = apply_pending_restore_in_internal(&orig_fixture.0, || Ok(())).unwrap();
        assert!(
            matches!(res_retry, RestoreApplicationResult::Installed),
            "Safe retry must succeed and install: {res_retry:?}"
        );

        // Restored database is valid schema 11 and has the restored response
        let restored_db = orig_fixture.0.join(DB_FILES[0]);
        assert!(verify_application_database(&restored_db).is_ok());
        let conn = Connection::open(&restored_db).unwrap();
        let response_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_responses", [], |r| r.get(0))
            .unwrap();
        assert_eq!(response_count, 1);

        let _ = std::fs::remove_dir_all(&backup_dir);
    }

    mod codex_m2_final_review {
        use super::*;
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        fn fixture() -> (Fixture, Connection) {
            let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "m2-codex-rereview-{}-{}-{}",
                std::process::id(),
                seq,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&root).unwrap();
            let c = Connection::open(root.join("her-flight-deck.db")).unwrap();
            c.pragma_update(None, "foreign_keys", "ON").unwrap();
            for m in crate::migrations() {
                c.execute_batch(m.sql).unwrap();
            }
            c.execute_batch(
                "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(11);INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('mat','Synthetic','2026-10-04','2026-10-04');",
            )
            .unwrap();
            crate::practice_sessions::mark_root_ready(&root);
            crate::practice_sessions::save_practice_test_at(
                &root,
                "mat",
                "Synthetic",
                r#"[{"question":"Synthetic","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#,
                "synthetic",
            )
            .unwrap();
            (Fixture(root), c)
        }
        fn start(f: &Fixture, c: &Connection) -> serde_json::Value {
            let v: String = c
                .query_row("SELECT id FROM practice_test_versions", [], |r| r.get(0))
                .unwrap();
            crate::practice_sessions::save_practice_session_at(
                &f.0,
                &serde_json::json!({"action":"start_or_resume","operationId":"20000000-0000-4000-8000-000000000001","materialId":"mat","versionId":v}),
            )
            .unwrap()
        }
        fn record(f: &Fixture, c: &Connection, s: &serde_json::Value) {
            let i: String = c
                .query_row("SELECT id FROM practice_test_items", [], |r| r.get(0))
                .unwrap();
            crate::practice_sessions::save_practice_session_at(
                &f.0,
                &serde_json::json!({"action":"record_response","operationId":"20000000-0000-4000-8000-000000000002","attemptId":s["attemptId"],"itemId":i,"expectedRevision":0,"selectedIndex":1,"isDontKnow":false}),
            )
            .unwrap();
        }
        #[test]
        fn unique_index_wrong_key_refused() {
            let (f, c) = fixture();
            c.execute_batch("DROP INDEX uq_single_in_progress_attempt;CREATE UNIQUE INDEX uq_single_in_progress_attempt ON practice_attempts(id) WHERE status = 'in_progress' AND source_material_id IS NOT NULL").unwrap();
            assert!(
                verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
                "same-name UNIQUE index on id was accepted instead of material key"
            );
        }
        #[test]
        fn no_op_ownership_trigger_refused() {
            let (f, c) = fixture();
            c.execute_batch("DROP TRIGGER trg_enforce_response_item_version_insert;CREATE TRIGGER trg_enforce_response_item_version_insert BEFORE INSERT ON practice_responses BEGIN SELECT 1;END;").unwrap();
            assert!(
                verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
                "same-name no-op ownership trigger was accepted"
            );
        }
        #[test]
        fn receipt_wrong_frozen_version_refused() {
            let (f, c) = fixture();
            start(&f, &c);
            c.execute_batch("UPDATE practice_session_operations SET result_json=json_set(result_json,'$.versionId','missing-version')").unwrap();
            assert!(
                verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
                "receipt result for wrong frozen version was accepted"
            );
        }
        #[test]
        fn in_progress_false_totals_refused() {
            let (f, c) = fixture();
            start(&f, &c);
            c.execute_batch("UPDATE practice_attempts SET total_questions=99,answered_count=88")
                .unwrap();
            assert!(
                verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
                "one-question unfinished attempt with 99 total/88 answered was accepted"
            );
        }
        #[test]
        fn startup_conversion_and_native_write_refuse_invalid_state() {
            let (f, c) = fixture();
            let s = start(&f, &c);
            record(&f, &c, &s);
            c.execute_batch("UPDATE practice_responses SET selected_index=99")
                .unwrap();
            assert!(verify_application_database(&f.0.join("her-flight-deck.db")).is_err());
            let conversion = crate::practice_sessions::run_legacy_conversion_at(&f.0);
            let v: String = c
                .query_row("SELECT id FROM practice_test_versions", [], |r| r.get(0))
                .unwrap();
            let write = crate::practice_sessions::save_practice_session_at(
                &f.0,
                &serde_json::json!({"action":"start_or_resume","operationId":"20000000-0000-4000-8000-000000000003","materialId":"mat","versionId":v}),
            );
            assert!(
                conversion.is_err() || write.is_err(),
                "startup conversion and direct session write both succeed for validator-refused state"
            );
        }
    }

    #[test]
    fn only_a_completed_restore_asks_for_the_window_to_come_forward() {
        assert_eq!(
            startup_restore_outcome(StartupRestoreDecision::RestoreCompleted),
            Ok(true)
        );
        assert_eq!(
            startup_restore_outcome(StartupRestoreDecision::ProceedNormally),
            Ok(false)
        );
        assert_eq!(
            startup_restore_outcome(StartupRestoreDecision::StagingRefusedUnchanged {
                reason: "damaged".to_string()
            }),
            Ok(false)
        );
        assert_eq!(
            startup_restore_outcome(StartupRestoreDecision::RolledBackRecovered {
                reason: "disk full".to_string()
            }),
            Ok(false)
        );
    }

    #[test]
    fn an_unresolved_restore_still_blocks_startup() {
        let outcome = startup_restore_outcome(StartupRestoreDecision::BlockedUnresolved {
            reason: "active data obstructed".to_string(),
            recovery_folder: Some(PathBuf::from(
                "/tmp/hfd/backups/2026-10-16-035630-before-restore",
            )),
        });
        let message = outcome.expect_err("an ambiguous restore must block startup");
        assert!(message.starts_with("Startup blocked to prevent data loss: active data obstructed"));
        assert!(message.contains("2026-10-16-035630-before-restore"));
    }

    #[derive(Debug, PartialEq, Eq, Clone)]
    enum OpenerCall {
        Reveal(PathBuf),
        OpenPath(PathBuf),
    }

    #[derive(Default)]
    struct TestFolderOpener {
        calls: std::sync::Mutex<Vec<OpenerCall>>,
        fail_with: Option<String>,
    }

    impl FolderOpener for TestFolderOpener {
        fn reveal_item_in_dir(&self, path: &Path) -> Result<(), String> {
            self.calls
                .lock()
                .unwrap()
                .push(OpenerCall::Reveal(path.to_path_buf()));
            match &self.fail_with {
                Some(err) => Err(err.clone()),
                None => Ok(()),
            }
        }

        fn open_path(&self, path: &Path) -> Result<(), String> {
            self.calls
                .lock()
                .unwrap()
                .push(OpenerCall::OpenPath(path.to_path_buf()));
            match &self.fail_with {
                Some(err) => Err(err.clone()),
                None => Ok(()),
            }
        }
    }

    #[test]
    fn item_to_reveal_distinguishes_content_emptiness_and_errors() {
        let root = std::env::temp_dir().join(format!("hfd-reveal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // An empty folder has nothing inside, so the folder itself is selected in its parent.
        assert_eq!(item_to_reveal_in(&root).unwrap(), root);

        // Without the database, the first item in name order is selected.
        std::fs::create_dir_all(root.join("documents")).unwrap();
        std::fs::create_dir_all(root.join("backups")).unwrap();
        assert_eq!(item_to_reveal_in(&root).unwrap(), root.join("backups"));

        // The database is preferred whenever it is there.
        std::fs::write(root.join(DB_FILES[0]), b"db").unwrap();
        assert_eq!(item_to_reveal_in(&root).unwrap(), root.join(DB_FILES[0]));

        // A missing folder or inspection failure returns Err instead of None.
        assert!(item_to_reveal_in(&root.join("missing")).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn open_data_folder_routes_command_through_opener_adapter() {
        let root = scratch("open-routing.app");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // 1. Empty .app root on macOS reveals the directory itself (not open_path).
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, true, &opener);
        assert!(result.is_ok());
        assert_eq!(
            opener.calls.lock().unwrap().as_slice(),
            &[OpenerCall::Reveal(root.clone())]
        );

        // 2. Database-absent, nonempty root on macOS reveals the first child.
        std::fs::create_dir_all(root.join("documents")).unwrap();
        std::fs::create_dir_all(root.join("backups")).unwrap();
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, true, &opener);
        assert!(result.is_ok());
        assert_eq!(
            opener.calls.lock().unwrap().as_slice(),
            &[OpenerCall::Reveal(root.join("backups"))]
        );

        // 3. Database-present root on macOS reveals the database file.
        std::fs::write(root.join(DB_FILES[0]), b"db").unwrap();
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, true, &opener);
        assert!(result.is_ok());
        assert_eq!(
            opener.calls.lock().unwrap().as_slice(),
            &[OpenerCall::Reveal(root.join(DB_FILES[0]))]
        );

        // 4. Listing error on missing root returns an inspection error and dispatches nothing.
        let missing = root.join("missing_dir.app");
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&missing, true, &opener);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.starts_with(&format!("Could not open {}", missing.display())),
            "unexpected error: {err}"
        );
        assert!(
            opener.calls.lock().unwrap().is_empty(),
            "opener should not be called on listing error"
        );

        // 5. Non-macOS platforms route directly to open_path.
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, false, &opener);
        assert!(result.is_ok());
        assert_eq!(
            opener.calls.lock().unwrap().as_slice(),
            &[OpenerCall::OpenPath(root.clone())]
        );

        // 6. Opener failure is formatted with "Could not open <root>: <err>".
        let opener = TestFolderOpener {
            calls: std::sync::Mutex::new(Vec::new()),
            fail_with: Some("access denied".to_string()),
        };
        let result = open_data_folder_with(&root, true, &opener);
        assert_eq!(
            result,
            Err(format!("Could not open {}: access denied", root.display()))
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn open_data_folder_handles_permission_denied_listing() {
        use std::os::unix::fs::PermissionsExt;

        let root = scratch("open-perm-denied.app");
        let child = root.join("child.txt");
        std::fs::write(&child, b"content").unwrap();

        struct PermissionGuard<'a>(&'a Path);
        impl Drop for PermissionGuard<'_> {
            fn drop(&mut self) {
                let _ = std::fs::set_permissions(self.0, std::fs::Permissions::from_mode(0o755));
                let _ = std::fs::remove_dir_all(self.0);
            }
        }

        let _guard = PermissionGuard(&root);
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o000)).unwrap();

        // If running as root (e.g. in some container environments), root can read 0o000 directories.
        if std::fs::read_dir(&root).is_ok() {
            // When running as root, permissions are ignored by the OS; skip assertion.
            return;
        }

        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, true, &opener);
        assert!(
            result.is_err(),
            "expected error for permission-denied directory"
        );
        let err = result.unwrap_err();
        let expected_prefix = format!("Could not open {}", root.display());
        assert!(
            err.starts_with(&expected_prefix),
            "expected error to start with '{expected_prefix}', got '{err}'"
        );
        assert!(
            opener.calls.lock().unwrap().is_empty(),
            "opener should not be called when listing fails with permission denied"
        );
    }
}
