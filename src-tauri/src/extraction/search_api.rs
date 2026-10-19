//! Native OFFLINE-02a boundary. No network, browser database, authoritative
//! writes or arbitrary file-opening capability. Release enablement remains the
//! same compile-time gate as OFFLINE-01 preparation.
// Offline tooling initializes only through the app's normal transaction and
// complete schema validation. This does not expose a readiness bypass or IPC.
pub use crate::practice_sessions::run_legacy_conversion_at as initialize_storage;

use super::cache::{Cache, Summary};
use super::search::{self, Control, Coverage, Initialization, Request, Stop, Target, Ticket};
use super::service::{self, Service};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn database(root: &Path) -> Result<Connection, String> {
    if !crate::practice_sessions::is_root_ready(root) {
        return Err("storage_not_ready".into());
    }
    let db = Connection::open_with_flags(
        root.join("her-flight-deck.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "storage_unavailable".to_string())?;
    db.busy_timeout(Duration::from_millis(50))
        .map_err(|_| "storage_unavailable".to_string())?;
    Ok(db)
}

/// Stored paths still have to remain inside the managed document directory,
/// including after symlink resolution. A database row is not an open-path API.
fn managed_file(svc: &Service, relative: &str) -> Option<PathBuf> {
    let path = svc.document_path(relative)?;
    let base = svc
        .root()
        .join(crate::documents::DOCUMENTS_DIR)
        .canonicalize()
        .ok()?;
    let resolved = path.canonicalize().ok()?;
    (resolved.starts_with(base) && resolved.is_file()).then_some(path)
}

fn resolve(
    svc: &Service,
    ids: &[String],
    control: &Control,
    cache: &Connection,
) -> Result<(Vec<Target>, Coverage), Stop> {
    control.check()?;
    let db = database(svc.root()).map_err(|_| Stop::Failed)?;
    let _snapshot = db.unchecked_transaction().map_err(|_| Stop::Failed)?;
    let mut stmt = db
        .prepare(
            "SELECT title, material_type, original_file_name, created_at, file_path
        FROM study_materials WHERE id = ?1",
        )
        .map_err(|_| Stop::Failed)?;
    let mut targets = Vec::new();
    let mut coverage = Coverage::default();
    let mut seen = HashSet::new();
    for id in ids {
        control.check()?;
        if !seen.insert(id) {
            continue;
        }
        let row = stmt
            .query_row([id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .optional()
            .map_err(|_| Stop::Failed)?;
        let Some((title, material_type, original_file_name, added_at, Some(relative))) = row else {
            coverage.missing += 1;
            continue;
        };
        let Some(path) = managed_file(svc, &relative) else {
            coverage.missing += 1;
            continue;
        };
        if !Service::is_pdf(&path) {
            coverage.not_pdf += 1;
            continue;
        }
        let Some(sha) = svc.current(&path) else {
            coverage.not_checked += 1;
            continue;
        };
        if svc.is_queued_prepare(&relative) || svc.preparing_hash(&sha) {
            coverage.preparing += 1;
            continue;
        }
        match Cache::summary_from(cache, &sha).map_err(|_| Stop::Failed)? {
            None => coverage.not_prepared += 1,
            Some(Summary::Failed(_)) => coverage.could_not_prepare += 1,
            Some(Summary::Complete(counts)) => {
                coverage.searched_documents += 1;
                coverage.searched_pages += counts.text;
                coverage.image_pages += counts.image_only;
                coverage.other_unsearchable_pages +=
                    counts.blank + counts.text_unreadable + counts.unknown + counts.failed;
                targets.push(Target {
                    material_id: id.clone(),
                    title,
                    material_type,
                    original_file_name,
                    added_at,
                    sha256: sha,
                });
            }
        }
    }
    control.check()?;
    Ok((targets, coverage))
}

/// Rust consumers can observe background setup without issuing a query.
/// The webview receives the same distinction as `index_preparing` from search.
pub fn search_initialization(svc: &Service) -> Result<Initialization, String> {
    if !service::extraction_enabled() {
        return Err("offline_extraction_disabled".into());
    }
    Ok(svc.search_host().initialization())
}

/// Admission is synchronous and bounded before any runtime wait. Resolution
/// and coverage run on the search thread, not the hashing/extraction executor.
pub fn submit_search(
    svc: Arc<Service>,
    query: String,
    material_ids: Vec<String>,
    content_types: Vec<String>,
    offset: usize,
    entered: Instant,
) -> Result<Ticket, String> {
    if !service::extraction_enabled() {
        return Err("offline_extraction_disabled".into());
    }
    if material_ids.len() > search::MAX_MATERIALS {
        return Err(Stop::TooManyMaterials.code().into());
    }
    if offset > search::MAX_OFFSET {
        return Err(Stop::OffsetTooDeep.code().into());
    }
    if content_types != ["documentPages"] {
        return Err("unsupported_content_type".into());
    }
    let terms = search::parse(&query).map_err(|s| s.code().to_string())?;
    let host = svc.search_host();
    match host.initialization() {
        Initialization::Preparing => return Err("index_preparing".into()),
        Initialization::Failed => {
            host.retry_initialization();
            return Err("index_unavailable".into());
        }
        Initialization::Ready => {}
    }
    let owned = svc.clone();
    Ok(host.submit(entered, move |control, cache| {
        let (targets, coverage) = resolve(&owned, &material_ids, control, cache)?;
        Ok(Request {
            targets,
            terms,
            offset,
            coverage,
        })
    }))
}

#[tauri::command]
pub async fn search_offline_content(
    app: tauri::AppHandle,
    query: String,
    material_ids: Vec<String>,
    content_types: Vec<String>,
    offset: usize,
) -> Result<search::Response, String> {
    let entered = Instant::now();
    if !service::extraction_enabled() {
        return Err("offline_extraction_disabled".into());
    }
    let ticket = submit_search(
        service::service(&app)?,
        query,
        material_ids,
        content_types,
        offset,
        entered,
    )?;
    tauri::async_runtime::spawn_blocking(move || ticket.wait().map_err(|s| s.code().to_string()))
        .await
        .map_err(|_| "task_failed".to_string())?
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Destination {
    Ok,
    Changed,
    Missing,
}

/// Re-resolve first, then stream the actual bytes through the existing hashing
/// lane. Never trust a stamp to authorize a destination. The subsequent open
/// remains a separate operation with the documented check-to-open race.
pub fn verify_destination(
    svc: &Service,
    material_id: &str,
    sha: &str,
) -> Result<Destination, String> {
    if !service::extraction_enabled() {
        return Err("offline_extraction_disabled".into());
    }
    if sha.len() != 64 || !sha.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid_hash".into());
    }
    let db = database(svc.root())?;
    let relative: Option<String> = db
        .query_row(
            "SELECT file_path FROM study_materials WHERE id = ?1",
            [material_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "storage_unavailable".to_string())?
        .flatten();
    let Some(path) = relative.as_deref().and_then(|r| managed_file(svc, r)) else {
        return Ok(Destination::Missing);
    };
    let actual = svc.verify(&path);
    // A delete/repoint during hashing must not validate the old destination.
    let current: Option<String> = db
        .query_row(
            "SELECT file_path FROM study_materials WHERE id = ?1",
            [material_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "storage_unavailable".to_string())?
        .flatten();
    if current != relative || managed_file(svc, relative.as_deref().unwrap_or("")).is_none() {
        return Ok(Destination::Missing);
    }
    Ok(match actual {
        Some(h) if h == sha => Destination::Ok,
        Some(_) => Destination::Changed,
        None => Destination::Missing,
    })
}

#[tauri::command]
pub async fn verify_offline_destination(
    app: tauri::AppHandle,
    material_id: String,
    content_sha256: String,
) -> Result<Destination, String> {
    if !service::extraction_enabled() {
        return Err("offline_extraction_disabled".into());
    }
    let svc = service::service(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        verify_destination(&svc, &material_id, &content_sha256)
    })
    .await
    .map_err(|_| "task_failed".to_string())?
}

#[cfg(test)]
mod tests;
