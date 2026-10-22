use super::*;
use crate::extraction::{
    cache::Cache,
    inspect::Outcome,
    supervisor::{Extraction, PageResult},
};
use lopdf::{dictionary, Document, Object};
use rusqlite::Connection;
use std::path::PathBuf;
struct Rig(PathBuf);
impl Drop for Rig {
    fn drop(&mut self) {
        crate::gemini_jobs::forget_open_for_tests(&self.0);
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
impl Rig {
    fn new(cached: bool) -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "hfd-pdf-kit-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        std::fs::create_dir_all(root.join("documents")).unwrap();
        let mut doc = Document::with_version("1.5");
        let pages = doc.new_object_id();
        let page = doc.add_object(dictionary! {"Type" => "Page", "Parent" => pages, "MediaBox" => vec![0.into(),0.into(),595.into(),842.into()]});
        doc.objects.insert(
            pages,
            Object::Dictionary(
                dictionary! {"Type" => "Pages", "Count" => 1, "Kids" => vec![page.into()]},
            ),
        );
        let catalog = doc.add_object(dictionary! {"Type" => "Catalog", "Pages" => pages});
        doc.trailer.set("Root", catalog);
        doc.save(root.join("documents/a.pdf")).unwrap();
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        for m in crate::migrations() {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute("INSERT INTO study_materials (id,title,file_path,created_at,updated_at) VALUES ('mat-a','Synthetic','a.pdf','now','now')",[]).unwrap();
        if cached {
            let sha = crate::extraction::service::hash_file(&root.join("documents/a.pdf")).unwrap();
            Cache::open(&root)
                .unwrap()
                .publish(&Extraction {
                    sha256: sha,
                    pages: vec![PageResult {
                        index: 1,
                        outcome: Outcome::Text,
                        text:
                            "Lift: A synthetic upward force.\nDrag: A synthetic opposing force.\n"
                                .into(),
                        error: None,
                    }],
                    peak_bytes: 0,
                })
                .unwrap();
        }
        Self(root)
    }
    fn ready(&self) -> String {
        let id = prepare_at(&self.0, "mat-a", Some(vec![1])).unwrap();
        work_at(&self.0, &id).unwrap();
        id
    }
}
#[test]
fn prepare_kit_zero_network_and_cache_missing_typed() {
    let r = Rig::new(false);
    assert_eq!(
        prepare_at(&r.0, "mat-a", None).unwrap_err().code,
        "CACHE_MISSING"
    );
    let r = Rig::new(true);
    let id = r.ready();
    let d = get_at(&r.0, &id).unwrap();
    assert!(!d["candidates"]["glossary"].as_array().unwrap().is_empty());
    let implementation = include_str!("pdf_kit.rs");
    for forbidden in [
        "reqwest",
        "configure_gemini",
        "admit_bounded",
        "PreparedSources",
        "secrets::",
    ] {
        assert!(!implementation.contains(forbidden));
    }
}
#[test]
fn kit_draft_survives_restart_and_never_autosaves() {
    let r = Rig::new(true);
    let id = r.ready();
    let before = get_at(&r.0, &id).unwrap();
    crate::gemini_jobs::forget_open_for_tests(&r.0);
    assert_eq!(get_at(&r.0, &id).unwrap(), before);
    let conn = Connection::open(r.0.join("her-flight-deck.db")).unwrap();
    for table in [
        "ai_study_sets",
        "practice_tests",
        "pdf_kit_runs",
        "pdf_kit_item_sources",
    ] {
        assert_eq!(
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
#[test]
fn source_changed_requires_consent_at_get_and_save() {
    let r = Rig::new(true);
    let id = r.ready();
    let mut d = read(&r.0, &id).unwrap().1;
    d["identity"]["selectedPages"] = serde_json::json!([2]);
    crate::gemini_jobs::with(&r.0, |j| {
        j.test_replace_pdf_draft(&id, d).unwrap();
    });
    assert_eq!(get_at(&r.0, &id).unwrap_err().code, "SOURCE_CHANGED");
    let r = Rig::new(true);
    let id = r.ready();
    std::fs::write(r.0.join("documents/a.pdf"), b"changed").unwrap();
    assert_eq!(get_at(&r.0, &id).unwrap_err().code, "SOURCE_CHANGED");
}

fn source_payload(d: &Value) -> crate::pdf_kit_sources::Sources {
    let e = &d["candidates"]["glossary"][0]["evidence"][0];
    crate::pdf_kit_sources::decode(&serde_json::json!({"runId":d["runId"],"run":{"materialId":"mat-a","contentSha256":d["identity"]["contentSha256"],"selectedPages":[1],"extractorVersion":d["identity"]["extractorVersion"],"algorithmVersion":d["identity"]["algorithmVersion"],"createdAt":d["createdAt"]},"items":[{"itemKind":"question","logicalId":"001c0001-0000-4000-8000-000000000050","contentHash":"a".repeat(64),"page":e["page"],"startOffset":e["startOffset"],"endOffset":e["endOffset"],"quote":e["quote"]}]}),"mat-a").unwrap()
}

#[test]
fn old_algorithm_kit_is_stale_at_get_and_save_then_rebuildable() {
    let r = Rig::new(true);
    let id = r.ready();
    let mut d = read(&r.0, &id).unwrap().1;
    assert_eq!(d["identity"]["algorithmVersion"], 3);
    assert_eq!(d["candidates"]["algorithmVersion"], 3);
    d["identity"]["algorithmVersion"] = json!(1);
    d["candidates"]["algorithmVersion"] = json!(1);
    d["identityDigest"] = json!(crate::practice_sessions::compute_canonical_hash(
        &d["identity"]
    ));
    let old_sources = source_payload(&d);
    crate::gemini_jobs::with(&r.0, |j| j.test_replace_pdf_draft(&id, d).unwrap());
    assert_eq!(get_at(&r.0, &id).unwrap_err().code, "SOURCE_CHANGED");
    assert_eq!(
        validate_save_at(&r.0, &old_sources).unwrap_err().code,
        "SOURCE_CHANGED"
    );
    // The existing explicit discard/rebuild flow produces a separate v3 run.
    assert!(crate::gemini_jobs::with(&r.0, |j| j.acknowledge(&id)).unwrap());
    let rebuilt = get_at(&r.0, &r.ready()).unwrap();
    assert_eq!(rebuilt["identity"]["algorithmVersion"], 3);
    assert_eq!(rebuilt["candidates"]["algorithmVersion"], 3);
    assert_ne!(rebuilt["runId"], old_sources.run_id);
    validate_save_at(&r.0, &source_payload(&rebuilt)).unwrap();
    assert_eq!(
        validate_save_at(&r.0, &old_sources).unwrap_err().code,
        "SOURCE_CHANGED"
    );
}

#[test]
fn current_algorithm_kit_rejects_old_candidates_and_save_provenance() {
    let r = Rig::new(true);
    let id = r.ready();
    let mut d = read(&r.0, &id).unwrap().1;
    assert_eq!(d["identity"]["algorithmVersion"], 3);
    let mut old_sources = source_payload(&d);
    old_sources.run.algorithm_version = 1;
    assert_eq!(
        validate_save_at(&r.0, &old_sources).unwrap_err().code,
        "SOURCE_CHANGED"
    );
    d["candidates"]["algorithmVersion"] = json!(1);
    crate::gemini_jobs::with(&r.0, |j| j.test_replace_pdf_draft(&id, d).unwrap());
    assert_eq!(get_at(&r.0, &id).unwrap_err().code, "INVALID_DRAFT");
    assert_eq!(
        validate_save_at(&r.0, &old_sources).unwrap_err().code,
        "INVALID_DRAFT"
    );
}
#[test]
fn save_rechecks_pdf_and_selected_pages() {
    let r = Rig::new(true);
    let id = r.ready();
    let d = get_at(&r.0, &id).unwrap();
    let mut sources = source_payload(&d);
    validate_save_at(&r.0, &sources).unwrap();
    sources.run.selected_pages = vec![2];
    assert_eq!(
        validate_save_at(&r.0, &sources).unwrap_err().code,
        "SOURCE_CHANGED"
    );
    sources.run.selected_pages = vec![1];
    std::fs::write(r.0.join("documents/a.pdf"), b"changed").unwrap();
    assert_eq!(
        validate_save_at(&r.0, &sources).unwrap_err().code,
        "SOURCE_CHANGED"
    );
}
#[test]
fn local_kit_cancel_preserves_draft_and_never_completes() {
    let r = Rig::new(true);
    let id = prepare_at(&r.0, "mat-a", None).unwrap();
    assert!(
        crate::gemini_jobs::with(&r.0, |j| j.cancel(&id))
            .unwrap()
            .cancelled
    );
    assert_eq!(work_at(&r.0, &id).unwrap_err().code, "CANCELLED");
    let record =
        crate::gemini_jobs::with(&r.0, |j| j.list().into_iter().find(|r| r.id == id).unwrap());
    assert_eq!(record.stage, crate::gemini_jobs::JobStage::Cancelled);
    assert!(record.draft.unwrap()["candidates"].is_null());
}
#[test]
fn local_kit_does_not_use_provider_admission() {
    let r = Rig::new(true);
    let provider = crate::gemini_jobs::with(&r.0, |j| {
        j.begin(
            crate::gemini_jobs::JobKind::StudyAid,
            "other",
            "b.pdf",
            &"a".repeat(64),
            None,
        )
    })
    .unwrap();
    let id = r.ready();
    assert_ne!(id, provider);
    assert!(crate::gemini_jobs::with(&r.0, |j| j.admits(&provider)));
}

#[test]
fn kit_receipt_retry_after_acknowledgement_needs_no_draft() {
    let r = Rig::new(true);
    let id = r.ready();
    let d = get_at(&r.0, &id).unwrap();
    let mut sources = source_payload(&d);
    let question = serde_json::json!({"question":"Synthetic question","options":["A","B"],"correctIndex":0,"explanation":"Synthetic","sourcePage":1,"identity":sources.items[0].logical_id});
    sources.items[0].content_hash = crate::practice_sessions::compute_canonical_hash(
        &crate::pdf_kit_sources::content("question", &question),
    );
    let op = serde_json::json!({"operationId":d["editorOperationId"],"sourceMaterialId":"mat-a","reason":"create","expected":null,"next":{"title":"Kit","provider":"manual","model":"","questions":[question],"retired":[]},"pdfKitSources":sources});
    let mut changed_pages = op.clone();
    changed_pages["pdfKitSources"]["run"]["selectedPages"] = serde_json::json!([2]);
    changed_pages["pdfKitSources"]["items"][0]["page"] = serde_json::json!(2);
    assert_eq!(
        crate::practice_authoring::save_practice_authoring_at(&r.0, &changed_pages)
            .unwrap_err()
            .code,
        crate::practice_authoring::PracticeAuthoringErrorCode::SourceChanged
    );
    assert_eq!(
        crate::practice_authoring::save_practice_authoring_at(&r.0, &op)
            .unwrap()
            .status,
        "saved"
    );
    assert!(crate::gemini_jobs::with(&r.0, |j| j.acknowledge(&id)).unwrap());
    assert_eq!(
        crate::practice_authoring::save_practice_authoring_at(&r.0, &op)
            .unwrap()
            .status,
        "already_saved"
    );
}

#[test]
fn kit_extraction_unavailable_typed_when_disabled_and_no_cache() {
    let missing = Rig::new(false);
    assert_eq!(
        prepare_at_with_extraction(&missing.0, "mat-a", None, false)
            .unwrap_err()
            .code,
        "EXTRACTION_UNAVAILABLE"
    );
    assert_eq!(
        prepare_at_with_extraction(&missing.0, "mat-a", None, true)
            .unwrap_err()
            .code,
        "CACHE_MISSING"
    );
    let cached = Rig::new(true);
    let id = prepare_at_with_extraction(&cached.0, "mat-a", None, false).unwrap();
    work_at(&cached.0, &id).unwrap();
    assert!(!get_at(&cached.0, &id).unwrap()["candidates"]["glossary"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn pdf_kit_admission_errors_keep_codes_and_blocker_identity_at_ipc() {
    use crate::gemini_jobs::PdfKitBeginError::*;
    for (failure, code, blocker) in [
        (
            ExistsSame {
                job_id: "job-a".into(),
                material_id: "mat-a".into(),
            },
            "KIT_EXISTS_SAME",
            true,
        ),
        (
            InProgressOther {
                job_id: "job-a".into(),
                material_id: "mat-a".into(),
            },
            "KIT_IN_PROGRESS_OTHER",
            true,
        ),
        (Full, "JOURNAL_FULL", false),
        (Recovery, "JOURNAL_RECOVERY", false),
        (Invalid, "INVALID_ARGUMENT", false),
        (Storage, "STORAGE_ERROR", false),
    ] {
        let failure = begin_error(failure);
        assert_eq!(failure.code, code);
        let public = serde_json::to_value(failure).unwrap();
        if blocker {
            assert_eq!(public["jobId"], "job-a");
            assert_eq!(public["materialId"], "mat-a");
        } else {
            assert!(public.get("jobId").is_none());
            assert!(public.get("materialId").is_none());
        }
    }
}

#[test]
fn pdf_kit_prepare_preserves_same_and_other_refusals() {
    let r = Rig::new(true);
    let id = prepare_at(&r.0, "mat-a", None).unwrap();
    let failure = prepare_at(&r.0, "mat-a", None).unwrap_err();
    assert_eq!(failure.code, "KIT_EXISTS_SAME");
    assert_eq!(failure.job_id.as_deref(), Some(id.as_str()));
    assert_eq!(failure.material_id.as_deref(), Some("mat-a"));
    let conn = Connection::open(r.0.join("her-flight-deck.db")).unwrap();
    conn.execute("INSERT INTO study_materials (id,title,file_path,created_at,updated_at) VALUES ('mat-b','Synthetic second','a.pdf','now','now')",[]).unwrap();
    let failure = prepare_at(&r.0, "mat-b", None).unwrap_err();
    assert_eq!(failure.code, "KIT_IN_PROGRESS_OTHER");
    assert_eq!(failure.job_id.as_deref(), Some(id.as_str()));
    assert_eq!(failure.material_id.as_deref(), Some("mat-a"));
    gemini_jobs::with(&r.0, |j| j.cancel(&id)).unwrap();
    assert_eq!(work_at(&r.0, &id).unwrap_err().code, "CANCELLED");
    let replacement = prepare_at(&r.0, "mat-a", None).unwrap();
    assert_ne!(id, replacement);
    assert!(!gemini_jobs::with(&r.0, |j| j.list())
        .iter()
        .any(|j| j.id == id));
}
