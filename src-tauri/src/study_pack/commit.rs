//! The one transaction that makes an import real (design I2, section 1).
//! Receipt, content and provenance rows commit together or not at all. Only
//! INSERTs are written; the guard in `guard.rs` aborts anything else.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use rusqlite::{params, Connection, Transaction, TransactionBehavior};
use serde_json::{json, Value};

use super::fault;
use super::format::{CardJson, GuideJson, PracticeJson, QuestionJson, SectionJson};
use super::guard::{self, execute};
use super::journal::JournalFile;
use super::plan::{self, Decision, ItemPlan, Link, Plan};
use super::titles;
use super::validate::{PackItem, ValidatedPack};
use crate::practice_sessions::{compute_canonical_hash, db_now_iso, generate_uuid_v4};

pub const CHANGED: &str = "Your library changed while adding. Press Add again.";

#[derive(Debug)]
pub enum CommitError {
    /// Her library changed since staging; nothing was written.
    Changed,
    /// Nothing was written.
    Failed(String),
    /// COMMIT returned an error: the outcome is not known.
    Unknown(String),
}

impl From<String> for CommitError {
    fn from(message: String) -> Self {
        CommitError::Failed(message)
    }
}

pub struct CommitInput<'a> {
    pub root: &'a Path,
    pub pack: &'a ValidatedPack,
    pub op_id: &'a str,
    pub pack_sha256: &'a str,
    pub id_map: &'a BTreeMap<String, String>,
    pub files: &'a [JournalFile],
    pub staged_plan: &'a Plan,
}

pub fn open_commit_connection(root: &Path) -> Result<Connection, String> {
    let conn = super::open_library(root, false, 5000)
        .map_err(|e| format!("Could not open your library: {e}"))?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| format!("Could not open your library: {e}"))?;
    // Cannot change inside a transaction: WAL then syncs on every commit.
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(|e| format!("Could not open your library: {e}"))?;
    Ok(conn)
}

pub fn commit(input: &CommitInput<'_>) -> Result<(), CommitError> {
    let mut conn = open_commit_connection(input.root)?;
    fault::hit("pre-commit")?;
    {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("Could not start adding the study pack: {e}"))?;
        guard::install(&tx)?;
        let mut ids = |reference: &str| {
            input
                .id_map
                .get(reference)
                .cloned()
                .unwrap_or_else(|| format!("unplanned-{reference}"))
        };
        let live = plan::compute(&tx, input.root, input.pack, &mut ids)?;
        if live != *input.staged_plan {
            return Err(CommitError::Changed);
        }
        write_all(&tx, input, &live)?;
        fault::hit("before-commit")?;
        tx.commit().map_err(|e| {
            CommitError::Unknown(format!("The study pack may not have been saved: {e}"))
        })?;
    }
    fault::hit("after-commit").map_err(CommitError::Unknown)?;
    Ok(())
}

fn uuid(tx: &Transaction) -> Result<String, String> {
    generate_uuid_v4(tx).map_err(|e| format!("Could not add the study pack: {e}"))
}

fn failed(e: impl std::fmt::Display) -> String {
    format!("Could not add the study pack: {e}")
}

fn write_all(tx: &Transaction, input: &CommitInput<'_>, plan: &Plan) -> Result<(), String> {
    let pack = input.pack;
    let now = db_now_iso(tx).map_err(failed)?;
    let totals = plan.totals(pack);
    // The receipt first: item rows refer to it with an immediate foreign key.
    execute(
        tx,
        "INSERT INTO study_pack_imports
           (operation_id, pack_id, pack_sha256, pack_format, added, added_guides, added_documents,
            added_pictures, added_practice, skipped, new_versions, readded, cards_left_out,
            cards_left_out_removed, committed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            input.op_id,
            pack.manifest.pack_id,
            input.pack_sha256,
            pack.manifest.pack_format,
            totals.added,
            totals.added_guides,
            totals.added_documents,
            totals.added_pictures,
            totals.added_practice,
            totals.skipped,
            totals.new_versions,
            totals.readded,
            totals.cards_left_out,
            totals.cards_left_out_removed,
            now
        ],
    )?;

    let adds: Vec<(&PackItem, &ItemPlan)> = pack
        .items
        .iter()
        .zip(&plan.items)
        .filter(|(_, p)| p.decision == Decision::Add)
        .collect();

    // Materials first: lineage and picture regions refer to them.
    for (item, ip) in &adds {
        insert_material(tx, input, item, ip, &now)?;
    }
    for (item, ip) in &adds {
        insert_lineage(tx, item, ip, &now)?;
    }
    for (item, ip) in &adds {
        insert_content(tx, input, item, ip, &now)?;
    }

    for (item, ip) in pack.items.iter().zip(&plan.items) {
        let Some((link, material)) = &ip.row else {
            continue;
        };
        execute(
            tx,
            "INSERT INTO study_pack_items
               (namespace, item_id, revision, kind, file_sha256, material_id, link, operation_id, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                pack.manifest.namespace,
                item.manifest.item_id,
                item.manifest.revision,
                item.manifest.kind,
                item.manifest.file.as_ref().map(|f| f.sha256.clone()),
                material,
                match link {
                    Link::Added => "added",
                    Link::Alias => "alias",
                },
                input.op_id,
                now
            ],
        )?;
    }
    Ok(())
}

fn second_copy_suffix(input: &CommitInput<'_>, ip: &ItemPlan) -> Option<String> {
    ip.second_copy
        .then(|| titles::suffix(&input.pack.manifest.created_at))
}

fn material_of(ip: &ItemPlan) -> Result<&str, String> {
    ip.material
        .as_deref()
        .ok_or_else(|| "A study pack item has no material.".to_string())
}

fn insert_material(
    tx: &Transaction,
    input: &CommitInput<'_>,
    item: &PackItem,
    ip: &ItemPlan,
    now: &str,
) -> Result<(), String> {
    let material = material_of(ip)?;
    let suffix = second_copy_suffix(input, ip);
    let title = titles::stored(&item.json.title, suffix.as_deref());
    let (path, original, size): (Option<String>, Option<String>, Option<i64>) =
        match &item.manifest.file {
            Some(file) => {
                let staged = input
                    .files
                    .iter()
                    .find(|f| f.item_ref == item.manifest.item_ref)
                    .ok_or_else(|| "A study pack file was not staged.".to_string())?;
                (
                    Some(staged.dest.clone()),
                    Some(file.original_file_name.clone()),
                    Some(file.bytes as i64),
                )
            }
            None => (None, None, None),
        };
    execute(
        tx,
        "INSERT INTO study_materials
           (id, title, material_type, topic, review_status, priority, goal_id, event_id, notes,
            file_path, original_file_name, file_size, created_at, updated_at, last_reviewed_at)
         VALUES (?1, ?2, ?3, ?4, 'needs_review', 'later', NULL, NULL, '', ?5, ?6, ?7, ?8, ?8, NULL)",
        params![
            material,
            title,
            item.json.material_type,
            item.json.topic,
            path,
            original,
            size,
            now
        ],
    )?;
    if item.manifest.kind == "document" {
        let file = item.manifest.file.as_ref().ok_or("A PDF has no file.")?;
        execute(
            tx,
            "INSERT INTO material_content_identities (material_id, content_sha256, total_pages, verified_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![material, file.sha256, file.total_pages, now],
        )?;
    }
    Ok(())
}

fn insert_lineage(
    tx: &Transaction,
    item: &PackItem,
    ip: &ItemPlan,
    now: &str,
) -> Result<(), String> {
    let Some(l) = &item.json.lineage else {
        return Ok(());
    };
    execute(
        tx,
        "INSERT INTO material_split_lineage
           (material_id, parent_material_id, root_material_id, source_page_start, source_page_end,
            parent_page_start, parent_page_end, child_page_count, source_file_name, source_title,
            source_content_sha256, source_total_pages, parent_file_name, parent_title,
            parent_content_sha256, parent_total_pages, nested_level, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            material_of(ip)?,
            ip.parent,
            ip.root,
            l.source_page_start,
            l.source_page_end,
            l.parent_page_start,
            l.parent_page_end,
            l.child_page_count,
            l.source_file_name,
            l.source_title,
            l.source_content_sha256,
            l.source_total_pages,
            l.parent_file_name,
            l.parent_title,
            l.parent_content_sha256,
            l.parent_total_pages,
            l.nested_level,
            now
        ],
    )?;
    Ok(())
}

fn insert_content(
    tx: &Transaction,
    input: &CommitInput<'_>,
    item: &PackItem,
    ip: &ItemPlan,
    now: &str,
) -> Result<(), String> {
    let material = material_of(ip)?;
    let suffix = second_copy_suffix(input, ip);

    // R1: fresh ids for everything inside the item.
    let mut card_ids: HashMap<String, String> = HashMap::new();
    let mut question_ids: HashMap<String, String> = HashMap::new();
    let mut guide: Option<GuideJson> = None;
    let mut region_ids: HashMap<String, String> = HashMap::new();
    let mut regions: Vec<crate::visual_cards::Region> = Vec::new();
    if let Some(g) = &item.json.guide {
        let mut next = g.clone();
        next.title = titles::stored(&g.title, suffix.as_deref());
        next.sections = g
            .sections
            .iter()
            .map(|s| -> Result<SectionJson, String> {
                let id = uuid(tx)?;
                card_ids.insert(s.item_id.clone(), id.clone());
                Ok(SectionJson {
                    item_id: id,
                    ..s.clone()
                })
            })
            .collect::<Result<_, _>>()?;
        let mut cards: Vec<CardJson> = Vec::new();
        for card in &g.flashcards {
            if ip.dropped_cards.contains(&card.item_id) {
                continue;
            }
            let id = uuid(tx)?;
            card_ids.insert(card.item_id.clone(), id.clone());
            let mut kept = CardJson {
                item_id: id,
                ..card.clone()
            };
            if let Some(pack_region) = &card.visual_region_id {
                let new_region = match region_ids.get(pack_region) {
                    Some(id) => id.clone(),
                    None => {
                        let source = item
                            .json
                            .visual_regions
                            .as_deref()
                            .unwrap_or(&[])
                            .iter()
                            .find(|r| &r.id == pack_region)
                            .ok_or("A picture card has no picture.")?;
                        let image = ip
                            .regions
                            .get(pack_region)
                            .ok_or("A picture card has no picture.")?;
                        let mut region = crate::visual_cards::Region {
                            id: String::new(),
                            owner_material_id: material.to_string(),
                            image_material_id: Some(image.clone()),
                            image_sha256: source.image_sha256.clone(),
                            image_width: source.image_width,
                            image_height: source.image_height,
                            x: source.x,
                            y: source.y,
                            w: source.w,
                            h: source.h,
                            rotation: source.rotation,
                        };
                        region.id = region.hash();
                        region_ids.insert(pack_region.clone(), region.id.clone());
                        regions.push(region.clone());
                        region.id
                    }
                };
                kept.visual_region_id = Some(new_region);
            }
            cards.push(kept);
        }
        next.flashcards = cards;
        guide = Some(next);
    }
    let mut practice: Option<PracticeJson> = None;
    if let Some(p) = &item.json.practice {
        let mut next = p.clone();
        next.title = titles::stored(&p.title, suffix.as_deref());
        next.questions = p
            .questions
            .iter()
            .map(|q| -> Result<QuestionJson, String> {
                let id = uuid(tx)?;
                question_ids.insert(q.identity.clone(), id.clone());
                Ok(QuestionJson {
                    identity: id,
                    ..q.clone()
                })
            })
            .collect::<Result<_, _>>()?;
        practice = Some(next);
    }

    // R3: citations, with the run, the logical ids and every content hash made new.
    let target = super::validate::citation_target(guide.as_ref(), practice.as_ref());
    let sources = match &item.json.citations {
        Some(c) => remap_citations(tx, c, material, &target, &card_ids, &question_ids, ip, now)?,
        None => None,
    };

    if let Some(g) = &guide {
        let next = crate::study_sets::validate_next(&super::validate::guide_value(g))
            .map_err(|_| "The study guide could not be added.".to_string())?;
        crate::study_sets::insert_new_set(tx, material, &next, &regions, sources.as_ref(), now)?;
    } else if let Some(sources) = &sources {
        crate::pdf_kit_sources::write(tx, sources)?;
    }

    if let Some(p) = &practice {
        insert_practice(tx, material, &item.json.title, suffix.as_deref(), p, now)?;
    }

    for video in &item.json.videos {
        execute(
            tx,
            "INSERT INTO material_video_links (id, material_id, url, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![uuid(tx)?, material, video.url, video.title, now],
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn remap_citations(
    tx: &Transaction,
    citations: &super::format::CitationsJson,
    material: &str,
    target: &Value,
    card_ids: &HashMap<String, String>,
    question_ids: &HashMap<String, String>,
    ip: &ItemPlan,
    now: &str,
) -> Result<Option<crate::pdf_kit_sources::Sources>, String> {
    let run_id = uuid(tx)?;
    let mut items = Vec::new();
    for source in &citations.items {
        let logical = match source.item_kind.as_str() {
            "summary" => format!("summary:{run_id}"),
            "section" => card_ids
                .get(&source.logical_id)
                .cloned()
                .ok_or("citation")?,
            "card" => {
                if ip.dropped_cards.contains(&source.logical_id) {
                    continue;
                }
                card_ids
                    .get(&source.logical_id)
                    .cloned()
                    .ok_or("citation")?
            }
            "question" => question_ids
                .get(&source.logical_id)
                .cloned()
                .ok_or("citation")?,
            _ => return Err("A citation is invalid.".into()),
        };
        // The hash is of the item as it will be stored, so it is recomputed.
        let stored = if source.item_kind == "summary" {
            target["summary"].clone()
        } else {
            let field = match source.item_kind.as_str() {
                "question" => "questions",
                "card" => "flashcards",
                _ => "sections",
            };
            target[field]
                .as_array()
                .and_then(|list| {
                    list.iter().find(|v| {
                        v.get("identity")
                            .or_else(|| v.get("itemId"))
                            .and_then(Value::as_str)
                            == Some(&logical)
                    })
                })
                .cloned()
                .ok_or("citation")?
        };
        items.push(crate::pdf_kit_sources::Source {
            item_kind: source.item_kind.clone(),
            logical_id: logical,
            content_hash: compute_canonical_hash(&crate::pdf_kit_sources::content(
                &source.item_kind,
                &stored,
            )),
            page: source.page,
            start_offset: source.start_offset,
            end_offset: source.end_offset,
            quote: source.quote.clone(),
        });
    }
    if items.is_empty() {
        return Ok(None);
    }
    let sources = crate::pdf_kit_sources::Sources {
        run_id,
        run: crate::pdf_kit_sources::Run {
            material_id: material.to_string(),
            content_sha256: citations.run.content_sha256.clone(),
            selected_pages: citations.run.selected_pages.clone(),
            extractor_version: citations.run.extractor_version,
            algorithm_version: citations.run.algorithm_version,
            created_at: now.to_string(),
        },
        items,
    };
    let value = serde_json::to_value(&sources).map_err(failed)?;
    let checked = crate::pdf_kit_sources::decode(&value, material)
        .map_err(|_| "A citation is invalid.".to_string())?;
    crate::pdf_kit_sources::validate_content(&checked, target)
        .map_err(|_| "A citation is invalid.".to_string())?;
    Ok(Some(checked))
}

fn insert_practice(
    tx: &Transaction,
    material: &str,
    material_title_source: &str,
    suffix: Option<&str>,
    practice: &PracticeJson,
    now: &str,
) -> Result<(), String> {
    use crate::practice_authoring as pa;
    let questions: Vec<pa::AuthoringQuestion> = practice
        .questions
        .iter()
        .map(|q| pa::AuthoringQuestion {
            acs_task: q.acs_tasks.first().cloned(),
            question: q.question.clone(),
            options: q.options.clone(),
            correct_index: q.correct_index,
            explanation: q.explanation.clone(),
            source_page: q.source_page,
            identity: q.identity.clone(),
            origin: q.origin.clone(),
            replaces: None,
        })
        .collect();
    let next = pa::PracticeNext {
        title: practice.title.clone(),
        provider: practice.provider.clone(),
        model: practice.model.clone(),
        questions,
        retired: Vec::new(),
    };
    let hash = pa::practice_content_hash(&next.questions);
    let version = uuid(tx)?;
    let stored_title = titles::stored(material_title_source, suffix);
    pa::insert_version_rows(
        tx,
        &pa::VersionRows {
            version_id: &version,
            material_id: material,
            source_material_title: &stored_title,
            version_number: 1,
            content_hash: &hash,
        },
        &next,
        now,
    )
    .map_err(|e| failed(e.message()))?;
    let legacy: Vec<Value> = next
        .questions
        .iter()
        .map(|q| {
            json!({
                "question": q.question, "options": q.options, "correctIndex": q.correct_index,
                "explanation": q.explanation, "sourcePage": q.source_page,
            })
        })
        .collect();
    execute(
        tx,
        "INSERT INTO practice_tests
           (source_material_id, title, questions_json, provider, model, generated_at, updated_at,
            legacy_migrated_at, legacy_error, retired_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6, NULL, '[]')",
        params![
            material,
            next.title,
            Value::Array(legacy).to_string(),
            next.provider,
            next.model,
            now
        ],
    )?;
    Ok(())
}
