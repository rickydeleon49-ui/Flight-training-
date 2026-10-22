//! Native local-only kit orchestration. Unsaved candidates live only in the journal.
use crate::extraction::{
    cache::{Cache, Summary, EXTRACTOR_VERSION},
    service::hash_file,
};
use crate::{
    gemini_jobs,
    pdf_study_kit::{self, CachedPage, KitInput},
};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitError {
    pub code: &'static str,
    pub message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material_id: Option<String>,
}
fn error(code: &'static str) -> KitError {
    KitError { code, job_id: None, material_id: None, message: match code {
        "EXTRACTION_UNAVAILABLE" => "Making a study kit from your PDF isn't available in this version yet. It's coming in a later update.",
        "CACHE_MISSING" => "Prepare this PDF for offline study first, then try making a kit again.",
        "SOURCE_CHANGED" => "This PDF or your chosen pages changed. Keep your earlier work, or start a new kit.",
        "DRAFT_NOT_READY" => "Your PDF kit is still being prepared. Your saved work is still here.",
        "INTERRUPTED" => "Preparation stopped. Your saved work is still here. Start a new kit when you are ready.",
        "CANCELLED" => "Stopped. Your saved work is still here.",
        "KIT_EXISTS_SAME" => "Your earlier study kit for this PDF is ready to return to.",
        "KIT_IN_PROGRESS_OTHER" => "A study kit for another PDF is still finishing.",
        "JOURNAL_FULL" => "Your draft space is full. Save or discard a waiting study aid or practice test, then try again.",
        "JOURNAL_RECOVERY" => "Your drafts need recovery before a new kit can begin. Quit and reopen Her Flight Deck, then try again.",
        _ => "Your PDF kit could not be prepared. Your saved work is still here.",
    }}
}
fn begin_error(failure: gemini_jobs::PdfKitBeginError) -> KitError {
    use gemini_jobs::PdfKitBeginError::*;
    let (code, blocker) = match failure {
        ExistsSame {
            job_id,
            material_id,
        } => ("KIT_EXISTS_SAME", Some((job_id, material_id))),
        InProgressOther {
            job_id,
            material_id,
        } => ("KIT_IN_PROGRESS_OTHER", Some((job_id, material_id))),
        Full => ("JOURNAL_FULL", None),
        Recovery => ("JOURNAL_RECOVERY", None),
        Invalid => ("INVALID_ARGUMENT", None),
        Storage => ("STORAGE_ERROR", None),
    };
    let mut failure = error(code);
    if let Some((job, material)) = blocker {
        failure.job_id = Some(job);
        failure.material_id = Some(material);
    }
    failure
}
fn conn(root: &Path) -> Result<Connection, KitError> {
    Connection::open_with_flags(
        root.join("her-flight-deck.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| error("STORAGE_ERROR"))
}
fn managed(root: &Path, material: &str) -> Result<(String, PathBuf, String), KitError> {
    let relative: String = conn(root)?
        .query_row(
            "SELECT file_path FROM study_materials WHERE id = ?1",
            [material],
            |r| r.get(0),
        )
        .map_err(|_| error("SOURCE_CHANGED"))?;
    let safe =
        crate::documents::safe_relative_path(&relative).map_err(|_| error("SOURCE_CHANGED"))?;
    let base = root
        .join(crate::documents::DOCUMENTS_DIR)
        .canonicalize()
        .map_err(|_| error("SOURCE_CHANGED"))?;
    let path = base
        .join(safe)
        .canonicalize()
        .map_err(|_| error("SOURCE_CHANGED"))?;
    if !path.starts_with(&base)
        || !relative.to_ascii_lowercase().ends_with(".pdf")
        || std::fs::metadata(&path)
            .map_err(|_| error("SOURCE_CHANGED"))?
            .len()
            > 50 * 1024 * 1024
    {
        return Err(error("SOURCE_CHANGED"));
    }
    let hash = hash_file(&path).ok_or_else(|| error("SOURCE_CHANGED"))?;
    Ok((relative, path, hash))
}
fn prepare_at(root: &Path, material: &str, pages: Option<Vec<u32>>) -> Result<String, KitError> {
    prepare_at_with_extraction(
        root,
        material,
        pages,
        crate::extraction::worker::extraction_enabled(),
    )
}
fn prepare_at_with_extraction(
    root: &Path,
    material: &str,
    pages: Option<Vec<u32>>,
    enabled: bool,
) -> Result<String, KitError> {
    let missing = || {
        error(if enabled {
            "CACHE_MISSING"
        } else {
            "EXTRACTION_UNAVAILABLE"
        })
    };
    let (relative, path, hash) = managed(root, material)?;
    if !root.join(crate::extraction::cache::CACHE_FILE).is_file() {
        return Err(missing());
    }
    let cache = Cache::open(root).map_err(|_| missing())?;
    let count = match cache.summary(&hash) {
        Some(Summary::Complete(c)) => c.pages(),
        _ => return Err(missing()),
    };
    let doc = lopdf::Document::load(&path).map_err(|_| error("SOURCE_CHANGED"))?;
    if count == 0 || count > 1000 || doc.get_pages().len() != count as usize {
        return Err(error("SOURCE_CHANGED"));
    }
    let pages = pages.unwrap_or_else(|| (1..=count).collect());
    if pages.is_empty()
        || pages.len() > 1000
        || pages.iter().any(|p| *p == 0 || *p > count)
        || pages.windows(2).any(|w| w[0] >= w[1])
    {
        return Err(error("INVALID_ARGUMENT"));
    }
    for p in &pages {
        if cache.page(&hash, *p).is_none() {
            return Err(missing());
        }
    }
    // Recheck after reading the document: never label parsed bytes with an older hash.
    if hash_file(&path).as_deref() != Some(&hash) {
        return Err(error("SOURCE_CHANGED"));
    }
    let connection = conn(root)?;
    let run_id = crate::practice_sessions::generate_uuid_v4(&connection)
        .map_err(|_| error("STORAGE_ERROR"))?;
    let operation_id = crate::practice_sessions::generate_uuid_v4(&connection)
        .map_err(|_| error("STORAGE_ERROR"))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| error("STORAGE_ERROR"))?
        .as_millis() as i64;
    let identity = json!({"materialId":material,"relativePath":relative,"contentSha256":hash,"selectedPages":pages,"extractorVersion":EXTRACTOR_VERSION,"algorithmVersion":pdf_study_kit::ALGORITHM_VERSION,"pageCount":count});
    let draft = json!({"kind":"pdf-kit","version":1,"runId":run_id,"identity":identity,"identityDigest":crate::practice_sessions::compute_canonical_hash(&identity),"createdAt":crate::card_reviews::format_iso_ms(now),"editorOperationId":operation_id,"reviewState":"preparing","candidates":null});
    gemini_jobs::with(root, |j| j.begin_pdf_kit(material, &relative, &hash, draft))
        .map_err(begin_error)
}
fn read(root: &Path, id: &str) -> Result<(gemini_jobs::JobRecord, Value), KitError> {
    let record = gemini_jobs::with(root, |j| {
        j.list()
            .into_iter()
            .find(|r| r.id == id && r.kind == gemini_jobs::JobKind::PdfKit)
    })
    .ok_or_else(|| error("DRAFT_UNAVAILABLE"))?;
    let d = record.draft.clone().ok_or_else(|| error("INVALID_DRAFT"))?;
    let i = &d["identity"];
    if d["kind"] != "pdf-kit"
        || d["version"] != 1
        || d["identityDigest"] != crate::practice_sessions::compute_canonical_hash(i)
        || i["materialId"] != record.material_id
        || i["relativePath"] != record.relative_path
        || i["contentSha256"] != record.content_sha256
        || i["extractorVersion"] != EXTRACTOR_VERSION
        || i["algorithmVersion"] != pdf_study_kit::ALGORITHM_VERSION
    {
        return Err(error("SOURCE_CHANGED"));
    }
    let (relative, _, hash) = managed(root, &record.material_id)?;
    if relative != record.relative_path || hash != record.content_sha256 {
        return Err(error("SOURCE_CHANGED"));
    }
    Ok((record, d))
}
fn work_at(root: &Path, id: &str) -> Result<(), KitError> {
    let result = (|| {
        let (record, mut d) = read(root, id)?;
        let i = &d["identity"];
        let (_, path, hash) = managed(root, &record.material_id)?;
        let pages: Vec<u32> = serde_json::from_value(i["selectedPages"].clone())
            .map_err(|_| error("INVALID_DRAFT"))?;
        let cache = Cache::open(root).map_err(|_| error("CACHE_MISSING"))?;
        let mut input = KitInput {
            content_sha256: hash.clone(),
            extractor_version: EXTRACTOR_VERSION,
            page_count: i["pageCount"]
                .as_u64()
                .ok_or_else(|| error("INVALID_DRAFT"))? as u32,
            pages: vec![],
        };
        let started = std::time::Instant::now();
        let keep_going = || {
            started.elapsed() < std::time::Duration::from_secs(30)
                && gemini_jobs::with(root, |j| j.pdf_kit_running(id))
        };
        for page in pages {
            if !keep_going() {
                return Err(error("CANCELLED"));
            }
            let (outcome, text) = cache
                .page(&hash, page)
                .ok_or_else(|| error("CACHE_MISSING"))?;
            input.pages.push(CachedPage {
                content_sha256: hash.clone(),
                extractor_version: EXTRACTOR_VERSION,
                page,
                outcome,
                text,
            });
        }
        let doc = lopdf::Document::load(path).map_err(|_| error("SOURCE_CHANGED"))?;
        let candidates = pdf_study_kit::extract_cancellable(&input, Some(&doc), &keep_going)
            .map_err(|_| {
                error(if keep_going() {
                    "EXTRACTION_FAILED"
                } else {
                    "CANCELLED"
                })
            })?;
        read(root, id)?;
        d["candidates"] = serde_json::to_value(candidates).map_err(|_| error("STORAGE_ERROR"))?;
        d["reviewState"] = json!("review-required");
        gemini_jobs::with(root, |j| j.finish_pdf_kit(id, d)).map_err(|_| error("STORAGE_ERROR"))
    })();
    if let Err(e) = &result {
        let _ = gemini_jobs::with(root, |j| j.failed(id, e.message));
    }
    result
}
fn validate_candidates(d: &Value) -> Result<(), KitError> {
    let k: pdf_study_kit::KitCandidates =
        serde_json::from_value(d["candidates"].clone()).map_err(|_| error("INVALID_DRAFT"))?;
    let pages: Vec<u32> = serde_json::from_value(d["identity"]["selectedPages"].clone())
        .map_err(|_| error("INVALID_DRAFT"))?;
    if k.content_sha256 != d["identity"]["contentSha256"]
        || k.algorithm_version != pdf_study_kit::ALGORITHM_VERSION
        || k.glossary.len() > 40
        || k.cloze.len() > 40
        || k.outline.len() > 40
        || k.questions.len() > 20
        || k.pages_used.iter().any(|p| !pages.contains(p))
    {
        return Err(error("INVALID_DRAFT"));
    }
    let evidence = k
        .glossary
        .iter()
        .chain(&k.cloze)
        .flat_map(|c| &c.evidence)
        .chain(k.outline.iter().flat_map(|o| &o.evidence))
        .chain(
            k.questions
                .iter()
                .flat_map(|q| q.evidence.iter().chain(q.choice_evidence.iter().flatten())),
        );
    for e in evidence {
        if !pages.contains(&e.page)
            || e.quote.is_empty()
            || e.quote.chars().count() > 2000
            || e.end_offset > 131072
            || e.start_offset >= e.end_offset
            || e.end_offset - e.start_offset != e.quote.len()
        {
            return Err(error("INVALID_DRAFT"));
        }
    }
    Ok(())
}
fn get_at(root: &Path, id: &str) -> Result<Value, KitError> {
    let (record, mut d) = read(root, id)?;
    if d["candidates"].is_null() {
        return Err(error(match record.stage {
            gemini_jobs::JobStage::Running => "DRAFT_NOT_READY",
            gemini_jobs::JobStage::Cancelled => "CANCELLED",
            _ => "INTERRUPTED",
        }));
    }
    validate_candidates(&d)?;
    // Return evidence and opaque identities; the managed path remains native-only.
    d["identity"]
        .as_object_mut()
        .ok_or_else(|| error("INVALID_DRAFT"))?
        .remove("relativePath");
    d.as_object_mut()
        .ok_or_else(|| error("INVALID_DRAFT"))?
        .remove("identityDigest");
    Ok(d)
}
/// Save-time identity check; no automatic rebuilding and no cache requirement.
pub(crate) fn validate_save_at(
    root: &Path,
    sources: &crate::pdf_kit_sources::Sources,
) -> Result<(), KitError> {
    let record = gemini_jobs::with(root, |j| {
        j.list().into_iter().find(|r| {
            r.kind == gemini_jobs::JobKind::PdfKit
                && r.draft
                    .as_ref()
                    .is_some_and(|d| d["runId"] == sources.run_id)
        })
    })
    .ok_or_else(|| error("SOURCE_CHANGED"))?;
    let (_, d) = read(root, &record.id)?;
    validate_candidates(&d)?;
    let i = &d["identity"];
    let r = &sources.run;
    if d["candidates"].is_null()
        || i["materialId"] != r.material_id
        || i["contentSha256"] != r.content_sha256
        || i["selectedPages"] != json!(r.selected_pages)
        || i["extractorVersion"] != r.extractor_version
        || i["algorithmVersion"] != r.algorithm_version
        || d["createdAt"] != r.created_at
    {
        return Err(error("SOURCE_CHANGED"));
    }
    fn contains(v: &Value, s: &crate::pdf_kit_sources::Source) -> bool {
        match v {
            Value::Array(a) => a.iter().any(|v| contains(v, s)),
            Value::Object(o) => {
                (v["page"] == s.page
                    && v["startOffset"] == s.start_offset
                    && v["endOffset"] == s.end_offset
                    && v["quote"] == s.quote)
                    || o.values().any(|v| contains(v, s))
            }
            _ => false,
        }
    }
    if sources.items.iter().any(|s| !contains(&d["candidates"], s)) {
        return Err(error("INVALID_ARGUMENT"));
    }
    Ok(())
}
#[tauri::command]
pub async fn prepare_pdf_study_kit(
    app: tauri::AppHandle,
    material_id: String,
    pages: Option<Vec<u32>>,
) -> Result<String, KitError> {
    let root = crate::storage::app_root(&app).map_err(|_| error("STORAGE_ERROR"))?;
    let prepare_root = root.clone();
    let id = tauri::async_runtime::spawn_blocking(move || {
        prepare_at(&prepare_root, &material_id, pages)
    })
    .await
    .map_err(|_| error("STORAGE_ERROR"))??;
    let worker_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = work_at(&root, &worker_id);
    });
    Ok(id)
}
#[tauri::command]
pub async fn get_pdf_study_kit(app: tauri::AppHandle, job_id: String) -> Result<Value, KitError> {
    let root = crate::storage::app_root(&app).map_err(|_| error("STORAGE_ERROR"))?;
    tauri::async_runtime::spawn_blocking(move || get_at(&root, &job_id))
        .await
        .map_err(|_| error("STORAGE_ERROR"))?
}
#[cfg(test)]
#[path = "pdf_kit_tests.rs"]
mod tests;
