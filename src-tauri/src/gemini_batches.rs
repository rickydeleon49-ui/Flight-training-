//! GEN-REL-05. One guide + at most six ten-card units, with only two extra
//! submissions across all units (nine total). Reservations precede dispatch
//! and survive restart, including a request whose answer was never received.
use super::*;
use std::collections::HashSet;

const MAX_SUBMISSIONS: u32 = 9;
const BATCH: usize = 10;

pub(super) fn target(value: Option<u32>) -> Result<u32, String> {
    match value.unwrap_or(40) {
        n @ (20 | 40 | 60) => Ok(n),
        _ => Err("Choose a target of 20, 40 or 60 cards.".to_string()),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Draft {
    target: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    timing: Option<Value>,
    deadline: u64,
    #[serde(default = "initial_remaining_millis")]
    remaining_millis: u64,
    requests: [u32; 7],
    next: usize,
    complete: bool,
    admissions: u32,
    guide: Option<GeneratedStudyAid>,
    cards: Vec<Flashcard>,
}

fn initial_remaining_millis() -> u64 {
    300_000
}

fn seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read(root: &Path, id: &str) -> Result<Draft, String> {
    let value = gemini_jobs::with(root, |journal| {
        journal
            .list()
            .into_iter()
            .find(|j| j.id == id)
            .and_then(|j| j.draft)
    });
    serde_json::from_value(value.ok_or("The card draft could not be found.")?).map_err(|_| {
        "The card draft could not be read. Discard it before starting again.".to_string()
    })
}

fn write(root: &Path, id: &str, draft: &Draft) -> Result<(), String> {
    gemini_jobs::with(root, |journal| {
        journal.checkpoint_draft(id, serde_json::to_value(draft).map_err(|e| e.to_string())?)
    })
}

fn reserve(root: &Path, id: &str, unit: usize, remaining_millis: u64) -> Option<u32> {
    // The reservation and cancel decision share the journal lock.
    gemini_jobs::with(root, |journal| {
        if !journal.admits(id) {
            return None;
        }
        let value = journal.list().into_iter().find(|j| j.id == id)?.draft?;
        let mut draft: Draft = serde_json::from_value(value).ok()?;
        let sum: u32 = draft.requests.iter().sum();
        let extras: u32 = draft.requests.iter().map(|n| n.saturating_sub(1)).sum();
        if unit >= 7
            || remaining_millis == 0
            || seconds() >= draft.deadline
            || sum >= MAX_SUBMISSIONS
            || draft.requests[unit] >= 3
            || (draft.requests[unit] > 0 && extras >= 2)
        {
            return None;
        }
        draft.remaining_millis = draft.remaining_millis.min(remaining_millis);
        if let Some(timing) = &mut draft.timing {
            timing["remainingMillis"] = json!(draft.remaining_millis);
        }
        draft.requests[unit] += 1;
        let attempt = draft.requests[unit];
        journal
            .checkpoint_draft(id, serde_json::to_value(draft).ok()?)
            .ok()?;
        Some(attempt)
    })
}

fn normalized(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn pair(card: &Flashcard) -> (String, String) {
    (normalized(&card.front), normalized(&card.back))
}

fn validate(aid: &GeneratedStudyAid, pages: Option<u32>, max_cards: usize) -> Result<(), String> {
    let bad_text = |s: &str| s.trim().is_empty() || s.len() > 16_000;
    if bad_text(&aid.title)
        || aid.title.len() > 500
        || bad_text(&aid.summary)
        || aid.sections.len() > 40
        || aid.source_notes.len() > 16_000
        || aid
            .sections
            .iter()
            .any(|s| bad_text(&s.heading) || bad_text(&s.body))
        || aid.flashcards.len() > max_cards
    {
        return Err(
            "Gemini's batch was incomplete or too large. The earlier draft is kept.".to_string(),
        );
    }
    for card in &aid.flashcards {
        if bad_text(&card.front)
            || bad_text(&card.back)
            || card.front.len() > 2000
            || card.back.len() > 4000
            || match (pages, card.source_page) {
                (Some(n), Some(p)) => p == 0 || p > n,
                (Some(_), None) | (None, Some(_)) => true,
                (None, None) => false,
            }
        {
            return Err("A card had missing or invalid source references or text. The earlier draft is kept.".to_string());
        }
    }
    Ok(())
}

/// The back answers in its own words; a back that restates the front reads
/// like the question twice when she flips the card.
const CARD_BACK_RULE: &str =
    "Each back must answer the front directly; never restate or repeat the front's question.";

fn card_batch_prompt(
    unit: usize,
    target: impl std::fmt::Display,
    previous: &str,
    safety: &str,
) -> String {
    format!("Create the next batch of at most 10 distinct grounded flashcards, batch {unit}, target maximum {target}. {previous}Keep sections empty; title and summary briefly describe the batch. {CARD_BACK_RULE} {safety}")
}

fn unchanged(root: &Path, source: &LoadedSource) -> Result<(), String> {
    // LoadedSource keeps the SQLite file_path, relative to documents/ just
    // like ImportedDocument and stored_document_path. The journal's root is
    // the app-data directory, not the documents directory.
    let safe = documents::safe_relative_path(&source.scope)?;
    let bytes = std::fs::read(root.join(documents::DOCUMENTS_DIR).join(safe)).map_err(|_| {
        "The selected source is no longer available. The draft was not published.".to_string()
    })?;
    if calculate_sha256(&bytes) != source.content_sha256 {
        return Err(
            "The selected source changed between batches. The draft was not published.".to_string(),
        );
    }
    Ok(())
}

pub(super) async fn generate(
    ctx: &GenContext<'_>,
    source: &LoadedSource,
    root: &Path,
    material: &str,
    target: u32,
) -> Result<GeneratedStudyAid, String> {
    let id = gemini_jobs::with(root, |j| {
        j.list()
            .into_iter()
            .find(|j| {
                j.material_id == material
                    && j.kind == JobKind::StudyAid
                    && j.stage == JobStage::Running
            })
            .map(|j| j.id)
    })
    .ok_or("The generation record is missing.")?;
    let has_draft = gemini_jobs::with(root, |j| {
        j.list()
            .into_iter()
            .find(|j| j.id == id)
            .is_some_and(|j| j.draft.as_ref().is_some_and(|d| d.get("target").is_some()))
    });
    if !has_draft {
        write(
            root,
            &id,
            &Draft {
                target,
                timing: (!ctx.budget.timing_value().is_null()).then(|| ctx.budget.timing_value()),
                deadline: seconds() + ctx.budget.remaining().as_secs(),
                remaining_millis: ctx.budget.remaining().as_millis() as u64,
                requests: [0; 7],
                next: 0,
                complete: false,
                admissions: 0,
                guide: None,
                cards: vec![],
            },
        )?;
    }
    let mut draft = read(root, &id)?;
    if source.bytes.is_empty()
        || (source.mime == "text/plain" && source.bytes.iter().all(u8::is_ascii_whitespace))
    {
        return Err("This source is empty, so no grounded study cards can be made.".to_string());
    }
    if draft.target != target {
        return Err(format!("This draft has a target of {} cards. Choose that target to resume, or discard the draft first.", draft.target));
    }
    ctx.budget.restore_attempts(draft.requests.iter().sum());
    if has_draft {
        ctx.budget
            .restore_draft(&serde_json::to_value(&draft).map_err(|e| e.to_string())?);
        ctx.budget.shorten(
            std::time::Duration::from_secs(draft.deadline.saturating_sub(seconds()))
                .min(std::time::Duration::from_millis(draft.remaining_millis)),
        );
    }
    let pages = if source.mime == "application/pdf" {
        Some(
            lopdf::Document::load_mem(&source.bytes)
                .map_err(|_| "The source PDF could not be read.")?
                .get_pages()
                .len() as u32,
        )
    } else {
        None
    };
    let safety = "Use only facts supported by the attached source. Never pad with duplicates, paraphrases or unsupported facts. Return fewer cards if no further distinct grounded facts are supported. Do not invent page references. For PDFs every card must cite its actual 1-based page within this selected file; otherwise sourcePage must be null. Keep clear student-pilot wording, ambiguity and outdated-source warnings. This is a study aid, not operational flight instruction; remind the learner to verify current FAA, aircraft, flight-school and instructor guidance. Return JSON with title, summary, sections (heading/body), sourceNotes; card batches also include flashcards (front/back/sourcePage).";
    while !draft.complete && draft.next <= (target / 10) as usize {
        unchanged(root, source)?;
        let unit = draft.next;
        let (r, i) = (root.to_path_buf(), id.clone());
        let remaining = ctx.budget.remaining_clock();
        ctx.budget.allocate_with(Arc::new(move || {
            reserve(&r, &i, unit, remaining().as_millis() as u64)
        }));
        let prompt = if unit == 0 {
            format!("Create the study guide only. Omit flashcards. {safety}")
        } else {
            let previous = if draft.cards.is_empty() {
                String::new()
            } else {
                format!(
                    "Do not repeat these accepted cards: {}. ",
                    serde_json::to_string(&draft.cards).map_err(|e| e.to_string())?
                )
            };
            card_batch_prompt(unit, target, &previous, safety)
        };
        let mut answer = study_aid_request(ctx, source, &prompt, if unit == 0 { 8192 } else { 4096 }, unit == 0).await.map_err(|message| {
            if message == gemini_cancel::CANCELLED && gemini_jobs::with(root, |j| j.admits(&id)) {
                "The job reached its request allowance, or its request reservation could not be kept. The earlier draft is kept; nothing was published.".to_string()
            } else { message }
        })?;
        unchanged(root, source)?;
        ctx.budget.validation_checkpoint()?;
        validate(&answer, pages, if unit == 0 { 0 } else { BATCH })?;
        ctx.budget.validation_checkpoint()?;
        // Reload reservations so a checkpoint cannot erase the request ledger.
        draft = read(root, &id)?;
        if draft.next != unit {
            return Err("The batch was already recorded. Nothing was published.".to_string());
        }
        let mut seen: HashSet<_> = draft.cards.iter().map(pair).collect();
        let returned = answer.flashcards.len();
        let before = draft.cards.len();
        for card in answer.flashcards.drain(..) {
            if seen.insert(pair(&card)) {
                draft.cards.push(card);
            }
        }
        if unit == 0 {
            draft.guide = Some(answer);
        }
        draft.next += 1;
        draft.complete = draft.next > (target / 10) as usize
            || (unit > 0 && (returned < BATCH || draft.cards.len() == before));
        draft.remaining_millis = draft
            .remaining_millis
            .min(ctx.budget.remaining().as_millis() as u64);
        if ctx.budget.stage_policy() {
            draft.timing = Some(ctx.budget.timing_value());
        } else if let Some(timing) = &mut draft.timing {
            timing["remainingMillis"] = json!(draft.remaining_millis);
        }
        write(root, &id, &draft)?;
        (ctx.say)(format!(
            "{} / {target} distinct cards checked and kept as a draft.",
            draft.cards.len()
        ));
        // A short or repeated batch is honest source exhaustion, never a reason
        // to keep asking for padding. No incremental live writes occur.
        if unit > 0 && (returned < BATCH || draft.cards.len() == before) {
            break;
        }
    }
    if draft.cards.is_empty() {
        // Retry the card unit, retaining all request reservations and timing.
        // A completed empty draft must never become a successful study set.
        draft.complete = false;
        draft.next = 1;
        write(root, &id, &draft)?;
        return Err("Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.".into());
    }
    let mut answer = draft.guide.take().ok_or("The guide draft is incomplete.")?;
    answer.flashcards = draft.cards;
    answer.source_notes.push_str(&format!("\n{} / {target} distinct cards. The target is a maximum; fewer cards means the returned source-grounded set was smaller. Verify all AI-generated material against current FAA, aircraft and instructor guidance.", answer.flashcards.len()));
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fake_gemini::{FakeGemini, Gate};
    use crate::gemini_budget::testing::fake_budget;
    use crate::test_wait::wait_for;
    use std::time::Duration;

    fn envelope(value: Value) -> String {
        json!({"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":value.to_string()}]}}]}).to_string()
    }
    fn aid(start: usize, count: usize) -> Value {
        json!({"title":"Synthetic study aid","summary":"Only synthetic facts.","sections":[],"flashcards":(start..start+count).map(|n| json!({"front":format!("Question {n}"),"back":format!("Answer {n}"),"sourcePage":1})).collect::<Vec<_>>(),"sourceNotes":"Verify current FAA and instructor guidance."})
    }
    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "hfd-batches-{}-{}-{}",
                std::process::id(),
                {
                    static NEXT: std::sync::atomic::AtomicU64 =
                        std::sync::atomic::AtomicU64::new(0);
                    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                },
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct Rig {
        root: TempDir,
        source: LoadedSource,
        fake: FakeGemini,
        http: Client,
        cache: PreparedSources,
    }
    impl Rig {
        fn new() -> Self {
            let root = TempDir::new();
            let source = LoadedSource::new(
                super::super::generation_tests::pdf(2, "batch-source"),
                "application/pdf",
                "source.pdf",
            );
            std::fs::create_dir(root.path().join("documents")).unwrap();
            std::fs::write(
                root.path()
                    .join(documents::DOCUMENTS_DIR)
                    .join(&source.scope),
                &source.bytes,
            )
            .unwrap();
            Self {
                root,
                source,
                fake: FakeGemini::start(),
                http: generation_client().unwrap(),
                cache: PreparedSources::new(
                    gemini_files::Policy::default(),
                    gemini_files::system_clock(),
                ),
            }
        }
        fn begin(&self) -> String {
            gemini_jobs::with(self.root.path(), |j| {
                j.begin(
                    JobKind::StudyAid,
                    "material",
                    &self.source.scope,
                    &self.source.content_sha256,
                    None,
                )
            })
            .unwrap()
        }
        fn run(&self, target: u32) -> Result<GeneratedStudyAid, String> {
            let (budget, _) = fake_budget(Duration::from_secs(300));
            let path = self.root.path().to_path_buf();
            let id = gemini_jobs::with(&path, |j| {
                j.list()
                    .into_iter()
                    .find(|j| j.stage == JobStage::Running)
                    .unwrap()
                    .id
            });
            budget.attach_admission(Arc::new(move || {
                gemini_jobs::with(&path, |j| j.admit_bounded(&id))
            }));
            let ctx = GenContext {
                http: &self.http,
                base: &self.fake.base,
                api_key: "synthetic-only",
                choice: ModelChoice::Standard,
                cache: &self.cache,
                epoch: self.cache.epoch(),
                budget: &budget,
                say: &|_| {},
            };
            tauri::async_runtime::block_on(generate(
                &ctx,
                &self.source,
                self.root.path(),
                "material",
                target,
            ))
        }
        fn count(&self) -> usize {
            self.fake.count(|r| r.is_generate())
        }
        fn script(&self, values: Vec<Value>) {
            self.fake
                .behave(|b| b.generate_answers = values.into_iter().map(envelope).collect());
        }
    }

    #[test]
    fn guide_cards_are_discarded_without_extra_requests() {
        for cards in [
            json!([]),
            aid(900, 1)["flashcards"].clone(),
            aid(900, 11)["flashcards"].clone(),
            json!({"malformed": true}),
            json!(null),
        ] {
            let r = Rig::new();
            r.begin();
            let mut guide = aid(900, 0);
            guide["flashcards"] = cards;
            if guide["flashcards"].is_null() {
                guide.as_object_mut().unwrap().remove("flashcards");
            }
            r.script(vec![guide, aid(0, 10), aid(10, 10)]);
            let result = r.run(20).unwrap();
            assert_eq!(result.flashcards.len(), 20);
            assert_eq!(result.flashcards[0].front, "Question 0");
            assert_eq!(r.count(), 3);
            for (unit, request) in r.fake.log().iter().filter(|r| r.is_generate()).enumerate() {
                let value = request.json();
                let schema = &value["generationConfig"]["responseSchema"];
                assert_eq!(schema["properties"].get("flashcards").is_some(), unit > 0);
                assert_eq!(
                    schema["required"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("flashcards")),
                    unit > 0
                );
            }
        }
    }

    #[test]
    fn selected_policy_is_persisted_and_used_by_card_reservations() {
        let r = Rig::new();
        let id = r.begin();
        r.script(vec![aid(0, 0), aid(0, 10), aid(10, 10)]);
        let (budget, time) = fake_budget(Duration::from_secs(300));
        let (root, timing_id) = (r.root.path().to_path_buf(), id.clone());
        budget.enable_rate(Arc::new(move |timing| {
            gemini_jobs::with(&root, |j| j.checkpoint_timing(&timing_id, timing.clone())).is_ok()
        }));
        let ctx = GenContext {
            http: &r.http,
            base: &r.fake.base,
            api_key: "synthetic-only",
            choice: ModelChoice::Standard,
            cache: &r.cache,
            epoch: r.cache.epoch(),
            budget: &budget,
            say: &|_| {},
        };
        tauri::async_runtime::block_on(generate(&ctx, &r.source, r.root.path(), "material", 20))
            .unwrap();
        let draft = read(r.root.path(), &id).unwrap();
        assert_eq!(draft.timing.as_ref().unwrap()["allowedMillis"], 600_000);
        assert!(draft.remaining_millis > 300_000);
        assert_eq!(draft.requests.iter().sum::<u32>(), 3);
        // Reopening is Interrupted, not running, and performs no network.
        let before = r.fake.log().len();
        let reopened = gemini_jobs::Journal::open(r.root.path());
        let job = &reopened.list()[0];
        assert_eq!(job.stage, JobStage::Interrupted);
        assert_eq!(r.fake.log().len(), before);
        let (resumed, _) = fake_budget(Duration::from_secs(300));
        resumed.restore_draft(job.draft.as_ref().unwrap());
        assert!(resumed.remaining().as_millis() <= draft.remaining_millis as u128);
        time.advance(Duration::from_secs(301));
        assert!(
            budget.remaining().as_secs() > 0,
            "card initialization must not retain a 300-second shortening"
        );
    }

    #[test]
    fn failed_rate_checkpoint_keeps_prior_allowance_and_card_ledger() {
        let r = Rig::new();
        let id = r.begin();
        let (budget, _) = fake_budget(Duration::from_secs(300));
        let (root, timing_id) = (r.root.path().to_path_buf(), id.clone());
        budget.enable_rate(Arc::new(move |timing| {
            gemini_jobs::with(&root, |j| j.checkpoint_timing(&timing_id, timing.clone())).is_ok()
        }));
        let prior = gemini_jobs::with(r.root.path(), |j| j.list()[0].draft.clone());
        std::fs::create_dir(r.root.path().join("gemini-jobs.json.writing")).unwrap();
        assert!(budget.rate_sample(Duration::from_secs(1), 0, 50_000_000));
        assert_eq!(budget.total().as_secs(), 300);
        assert_eq!(
            gemini_jobs::with(r.root.path(), |j| j.list()[0].draft.clone()),
            prior
        );
    }

    #[test]
    fn remaining_allowance_is_checkpointed_from_monotonic_time() {
        let r = Rig::new();
        let id = r.begin();
        r.script(vec![aid(0, 0), aid(0, 10), aid(10, 10)]);
        let (budget, time) = fake_budget(Duration::from_secs(300));
        let say = |message: String| {
            if message.contains(" / ") {
                time.advance(Duration::from_secs(30));
            }
        };
        let ctx = GenContext {
            http: &r.http,
            base: &r.fake.base,
            api_key: "synthetic-only",
            choice: ModelChoice::Standard,
            cache: &r.cache,
            epoch: r.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        tauri::async_runtime::block_on(generate(&ctx, &r.source, r.root.path(), "material", 20))
            .unwrap();
        let draft = read(r.root.path(), &id).unwrap();
        assert_eq!(draft.remaining_millis, 240_000);
        // Older drafts without the optional field remain readable with the
        // original ceiling; their persisted wall deadline still applies.
        let mut value = serde_json::to_value(draft).unwrap();
        value.as_object_mut().unwrap().remove("remainingMillis");
        let legacy: Draft = serde_json::from_value(value).unwrap();
        assert_eq!(legacy.remaining_millis, 300_000);
    }

    #[test]
    fn resumed_allowance_cannot_exceed_persisted_remaining_time() {
        let r = Rig::new();
        let id = r.begin();
        r.script(vec![aid(0, 0), aid(0, 1)]);
        r.run(20).unwrap();
        let mut value = serde_json::to_value(read(r.root.path(), &id).unwrap()).unwrap();
        value["deadline"] = json!(seconds() + 3600); // Mac clock moved backwards.
        value["remainingMillis"] = json!(0);
        value["complete"] = json!(false);
        value["next"] = json!(1);
        gemini_jobs::with(r.root.path(), |j| j.checkpoint_draft(&id, value)).unwrap();
        let before = r.count();
        assert!(r.run(20).is_err());
        assert_eq!(r.count(), before);
    }

    #[test]
    fn targets_default_and_invalid_counts() {
        assert_eq!(target(None).unwrap(), 40);
        for n in [20, 40, 60] {
            assert_eq!(target(Some(n)).unwrap(), n);
        }
        for n in [0, 10, 21, 41, 61, u32::MAX] {
            assert!(target(Some(n)).is_err());
        }
    }

    #[test]
    fn source_checks_use_managed_nested_paths_and_ignore_app_root_decoys() {
        let r = Rig::new();
        let source = LoadedSource::new(
            r.source.bytes.clone(),
            "application/pdf",
            "chapters/ch1.pdf",
        );
        let managed = r
            .root
            .path()
            .join(documents::DOCUMENTS_DIR)
            .join(&source.scope);
        std::fs::create_dir_all(managed.parent().unwrap()).unwrap();
        std::fs::write(&managed, &source.bytes).unwrap();
        let decoy = r.root.path().join(&source.scope);
        std::fs::create_dir_all(decoy.parent().unwrap()).unwrap();
        std::fs::write(&decoy, b"wrong file outside documents").unwrap();
        assert!(unchanged(r.root.path(), &source).is_ok());

        std::fs::write(&decoy, &source.bytes).unwrap();
        std::fs::write(&managed, b"changed managed file").unwrap();
        assert!(unchanged(r.root.path(), &source)
            .unwrap_err()
            .contains("changed"));
        std::fs::remove_file(&managed).unwrap();
        assert!(unchanged(r.root.path(), &source)
            .unwrap_err()
            .contains("no longer available"));
    }

    #[test]
    fn source_checks_reject_unsafe_stored_paths() {
        let r = Rig::new();
        let absolute = r.root.path().join("absolute.pdf");
        std::fs::write(&absolute, &r.source.bytes).unwrap();
        // Both absolute and traversal paths could otherwise reach these bytes.
        for scope in [
            absolute.to_str().unwrap(),
            "../absolute.pdf",
            "",
            "C:\\source.pdf",
            "a/../source.pdf",
        ] {
            let source = LoadedSource::new(r.source.bytes.clone(), "application/pdf", scope);
            assert_eq!(
                unchanged(r.root.path(), &source).unwrap_err(),
                "Invalid document path."
            );
        }
    }

    #[test]
    fn removing_managed_source_while_response_is_held_keeps_draft_unpublished() {
        let r = Rig::new();
        let id = r.begin();
        let gate = Arc::new(Gate::default());
        r.fake.behave(|b| {
            b.generate_gate = Some(gate.clone());
            b.generate_answers = vec![envelope(aid(0, 0))];
        });
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| r.run(20));
            wait_for("source-removal generation gate", || gate.waiting() > 0);
            std::fs::remove_file(
                r.root
                    .path()
                    .join(documents::DOCUMENTS_DIR)
                    .join(&r.source.scope),
            )
            .unwrap();
            gate.open();
            assert!(worker
                .join()
                .unwrap()
                .unwrap_err()
                .contains("no longer available"));
        });
        let draft = read(r.root.path(), &id).unwrap();
        assert!(draft.guide.is_none());
        assert!(draft.cards.is_empty());
        assert!(!draft.complete);
        assert_eq!(r.count(), 1);
    }

    #[test]
    fn targets_use_ten_card_batches_single_upload_and_bounded_tokens() {
        for n in [20, 40, 60] {
            let r = Rig::new();
            let id = r.begin();
            let mut values = vec![aid(0, 0)];
            for i in 0..n / 10 {
                values.push(aid((i * 10) as usize, 10));
            }
            r.script(values);
            let result = r.run(n).unwrap();
            assert_eq!(result.flashcards.len(), n as usize);
            assert!(result.source_notes.contains(&format!("{n} / {n}")));
            let draft = read(r.root.path(), &id).unwrap();
            assert!(draft.complete);
            assert_eq!(draft.requests.iter().sum::<u32>(), 1 + n / 10);
            assert_eq!(r.count(), 1 + n as usize / 10);
            let log = r.fake.log();
            let upload_bytes: usize = log
                .iter()
                .filter(|r| r.is_upload_finalize())
                .map(|r| r.body.len())
                .sum();
            assert_eq!(upload_bytes, r.source.bytes.len());
            for (i, req) in log.iter().filter(|r| r.is_generate()).enumerate() {
                let v = req.json();
                assert!(v
                    .pointer("/contents/0/parts/1/file_data/file_uri")
                    .is_some());
                assert!(v.to_string().find("inline_data").is_none());
                assert_eq!(
                    v["generationConfig"]["maxOutputTokens"],
                    if i == 0 { 8192 } else { 4096 }
                );
            }
            println!("MEASURE target={n} upload_bytes={upload_bytes} source_bytes={} generation_requests={} all_http={} admission_checks={}",r.source.bytes.len(), r.count(), log.len(), draft.admissions);
        }
    }

    #[test]
    fn completed_empty_draft_is_an_error_without_network() {
        let root = TempDir::new();
        let source = LoadedSource::new(b"Synthetic source".to_vec(), "text/plain", "source.txt");
        let id = gemini_jobs::with(root.path(), |j| {
            j.begin(
                JobKind::StudyAid,
                "material",
                &source.scope,
                &source.content_sha256,
                None,
            )
        })
        .unwrap();
        let draft = Draft {
            target: 20,
            timing: None,
            deadline: seconds() + 300,
            remaining_millis: 300_000,
            requests: [1, 1, 0, 0, 0, 0, 0],
            next: 2,
            complete: true,
            admissions: 2,
            guide: Some(serde_json::from_value(aid(0, 0)).unwrap()),
            cards: vec![],
        };
        write(root.path(), &id, &draft).unwrap();
        let (budget, _) = fake_budget(Duration::from_secs(300));
        let http = generation_client().unwrap();
        let cache = PreparedSources::new(
            gemini_files::Policy::default(),
            gemini_files::system_clock(),
        );
        let ctx = GenContext {
            http: &http,
            base: "http://127.0.0.1:1",
            api_key: "synthetic-only",
            choice: ModelChoice::Standard,
            cache: &cache,
            epoch: cache.epoch(),
            budget: &budget,
            say: &|_| {},
        };
        let answer =
            tauri::async_runtime::block_on(generate(&ctx, &source, root.path(), "material", 20));
        assert_eq!(answer.unwrap_err(), "Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.");
        let kept = read(root.path(), &id).unwrap();
        assert_eq!(kept.requests, [1, 1, 0, 0, 0, 0, 0]);
        assert!(!kept.complete);
        assert_eq!(kept.next, 1);
    }

    #[test]
    fn empty_cards_fail_and_retry_keeps_reservations() {
        let r = Rig::new();
        let id = r.begin();
        r.script(vec![aid(0, 0), aid(0, 0), aid(0, 3)]);
        assert_eq!(r.run(20).unwrap_err(), "Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.");
        let draft = read(r.root.path(), &id).unwrap();
        assert!(draft.cards.is_empty());
        assert!(!draft.complete);
        assert_eq!(draft.requests.iter().sum::<u32>(), 2);
        assert_eq!(r.run(20).unwrap().flashcards.len(), 3);
        assert_eq!(
            read(r.root.path(), &id)
                .unwrap()
                .requests
                .iter()
                .sum::<u32>(),
            3
        );
        let log = r.fake.log();
        let prompts: Vec<_> = log
            .iter()
            .filter(|r| r.is_generate())
            .map(|r| r.json().to_string())
            .collect();
        assert!(prompts.iter().all(|p| !p.contains("or an empty array")));
        assert!(prompts
            .iter()
            .all(|p| !p.contains("Do not repeat these accepted cards")));
    }

    #[test]
    fn short_empty_duplicate_and_repeated_batches_never_pad_or_commit_twice() {
        for count in [3, 10] {
            let r = Rig::new();
            let id = r.begin();
            r.script(vec![aid(0, 0), aid(0, count), aid(0, count)]);
            let answer = r.run(40).unwrap();
            assert_eq!(answer.flashcards.len(), count);
            let calls = r.count();
            let again = r.run(40).unwrap();
            assert_eq!(again.flashcards.len(), count);
            assert_eq!(r.count(), calls);
            assert!(read(r.root.path(), &id).unwrap().complete);
        }
        let a: Flashcard = serde_json::from_value(
            json!({"front":"  A  QUESTION\n", "back":"An   ANSWER", "sourcePage":1}),
        )
        .unwrap();
        let b: Flashcard = serde_json::from_value(
            json!({"front":"a question", "back":"an answer", "sourcePage":2}),
        )
        .unwrap();
        assert_eq!(pair(&a), pair(&b));
    }

    #[test]
    fn missing_bad_pages_malformed_truncated_and_oversized_batches_keep_draft() {
        for bad in [json!(null), json!(0), json!(3), json!("one")] {
            let r = Rig::new();
            let id = r.begin();
            let mut batch = aid(0, 1);
            batch["flashcards"][0]["sourcePage"] = bad;
            r.script(vec![aid(0, 0), batch]);
            assert!(r.run(20).is_err());
            let d = read(r.root.path(), &id).unwrap();
            assert!(d.cards.is_empty());
            assert_eq!(d.next, 1);
        }
        for bad in [
            "{broken".to_string(),
            json!({"candidates":[{"finishReason":"MAX_TOKENS"}]}).to_string(),
            "x".repeat(1024 * 1024 + 1),
        ] {
            let r = Rig::new();
            let id = r.begin();
            r.fake
                .behave(|b| b.generate_answers = vec![envelope(aid(0, 0)), bad]);
            assert!(r.run(20).is_err());
            assert_eq!(read(r.root.path(), &id).unwrap().next, 1);
        }
        let r = Rig::new();
        r.begin();
        r.script(vec![aid(0, 0), aid(0, 11)]);
        assert!(r.run(20).is_err());
    }

    #[test]
    fn durable_request_cap_retry_exhaustion_and_shared_deadline() {
        let r = Rig::new();
        let id = r.begin();
        r.script(vec![aid(0, 0), aid(0, 10), aid(10, 10)]);
        r.run(20).unwrap();
        let mut d = read(r.root.path(), &id).unwrap();
        d.requests = [1; 7];
        d.requests[0] = 2;
        d.requests[1] = 2;
        write(r.root.path(), &id, &d).unwrap();
        assert_eq!(d.requests.iter().sum::<u32>(), 9);
        assert_eq!(reserve(r.root.path(), &id, 2, 300_000), None);
        d.requests = [0; 7];
        d.deadline = seconds().saturating_sub(1);
        d.complete = false;
        d.next = 1;
        write(r.root.path(), &id, &d).unwrap();
        let before = r.count();
        assert!(r.run(20).is_err());
        assert_eq!(r.count(), before);
        let r = Rig::new();
        let id = r.begin();
        r.fake
            .behave(|b| b.generate_statuses = vec![(503, "{}".into()); 10]);
        assert!(r.run(60).is_err());
        assert_eq!(r.count(), 3);
        assert_eq!(read(r.root.path(), &id).unwrap().requests[0], 3);
    }

    #[test]
    fn source_change_between_batches_and_resume_are_refused() {
        let r = Rig::new();
        let id = r.begin();
        let gate = Arc::new(Gate::default());
        r.fake.behave(|b| {
            b.generate_gate = Some(gate.clone());
            b.generate_answers = vec![envelope(aid(0, 0))];
        });
        std::thread::scope(|s| {
            let worker = s.spawn(|| r.run(20));
            wait_for("source-change generation request counter", || r.count() > 0);
            std::fs::write(
                r.root
                    .path()
                    .join(documents::DOCUMENTS_DIR)
                    .join(&r.source.scope),
                b"changed",
            )
            .unwrap();
            gate.open();
            assert!(worker.join().unwrap().unwrap_err().contains("changed"));
        });
        assert!(read(r.root.path(), &id).unwrap().guide.is_none());
        gemini_jobs::with(r.root.path(), |j| j.failed(&id, "interrupted")).unwrap();
        assert!(gemini_jobs::with(r.root.path(), |j| j.begin(
            JobKind::StudyAid,
            "material",
            &r.source.scope,
            "different",
            None
        ))
        .is_err());
    }
    #[test]
    fn cancellable_drop_restart_resume_preserves_ledger_and_unique_batches() {
        cancel_restart_resume(true);
    }

    #[test]
    fn journal_cancel_before_token_wake_preserves_draft_without_post_cancel_write() {
        cancel_restart_resume(false);
    }

    fn cancel_restart_resume(wake_before_probe: bool) {
        let r = Rig::new();
        let id = r.begin();
        let gate = Arc::new(Gate::default());
        r.script(vec![aid(0, 0), aid(0, 10)]);
        let registration = gemini_cancel::register(&id);
        let (budget, _) = fake_budget(Duration::from_secs(300));
        let path = r.root.path().to_path_buf();
        let admit_id = id.clone();
        budget.attach_admission(Arc::new(move || {
            gemini_jobs::with(&path, |j| j.admit_bounded(&admit_id))
        }));
        // Match the command: polling checks cancellation without spending a
        // dispatch reservation or repeatedly writing the journal.
        let (path, probe_id) = (r.root.path().to_path_buf(), id.clone());
        budget.attach_probe(Arc::new(move || {
            gemini_jobs::with(&path, |j| j.admits(&probe_id))
        }));
        let say = |message: String| {
            if message.contains(" / ") {
                // Synchronous with the guide checkpoint, before generate can
                // start its first card request.
                r.fake.behave(|b| b.generate_gate = Some(gate.clone()));
            }
        };
        let ctx = GenContext {
            http: &r.http,
            base: &r.fake.base,
            api_key: "synthetic-only",
            choice: ModelChoice::Standard,
            cache: &r.cache,
            epoch: r.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        std::thread::scope(|scope| {
            let token = registration.token.clone();
            let worker = scope.spawn(|| {
                tauri::async_runtime::block_on(gemini_cancel::Cancellable::new(
                    generate(&ctx, &r.source, r.root.path(), "material", 20),
                    token,
                ))
            });
            wait_for("cancel/restart generation gate", || gate.waiting() > 0);
            assert_eq!(r.count(), 2, "the guide and the held first card request");
            assert_eq!(read(r.root.path(), &id).unwrap().next, 1);
            let journal_path = r.root.path().join("gemini-jobs.json");
            let cancelled_journal = gemini_jobs::with(r.root.path(), |j| {
                assert!(j.cancel(&id).unwrap().cancelled);
                if wake_before_probe {
                    // Select token-driven cancellation deterministically. A
                    // budget probe cannot observe the cancelled journal until
                    // this lock is released, after the token has been signalled.
                    registration.token.cancel();
                }
                std::fs::read(&journal_path).unwrap()
            });
            let result = worker.join().unwrap();
            if wake_before_probe {
                assert!(
                    matches!(result, Err(gemini_cancel::Cancelled)),
                    "cancelled worker returned {result:?}"
                );
            } else {
                // Force the other valid ordering: the journal stops the work
                // before the token is signalled. Outer Ok is not a successful
                // generation: its payload must be the cancellation error.
                assert!(
                    matches!(&result, Ok(Err(message)) if message == gemini_cancel::CANCELLED),
                    "journal-cancelled worker returned {result:?}"
                );
                registration.token.cancel();
            }
            assert_eq!(std::fs::read(&journal_path).unwrap(), cancelled_journal);
            // The abandoned request is still held at the gate. Give it its own
            // answer and wait until it has taken it, so it cannot take one of
            // the answers queued for the resume below.
            r.fake
                .behave(|b| b.generate_answers = vec![envelope(aid(90, 10))]);
            gate.open();
            wait_for("abandoned generation answer queue to be consumed", || {
                let mut taken = false;
                r.fake.behave(|b| taken = b.generate_answers.is_empty());
                taken
            });
            assert_eq!(std::fs::read(&journal_path).unwrap(), cancelled_journal);
            assert_eq!(r.count(), 2, "cancellation dispatched nothing else");
            let job = gemini_jobs::with(r.root.path(), |j| j.list()[0].clone());
            assert_eq!(job.stage, JobStage::Cancelled);
            assert!(
                job.result.is_none(),
                "cancellation kept no publishable result"
            );
        });
        gemini_jobs::with(r.root.path(), |j| j.failed(&id, "cancelled")).unwrap();
        let reopened = gemini_jobs::Journal::open(r.root.path());
        assert_eq!(reopened.list()[0].stage, JobStage::Cancelled);
        let draft = read(r.root.path(), &id).unwrap();
        assert_eq!(draft.next, 1);
        assert_eq!(draft.requests[1], 1);
        assert!(draft.cards.is_empty());
        r.fake.behave(|b| {
            b.generate_gate = None;
            b.generate_answers = vec![envelope(aid(0, 10)), envelope(aid(10, 10))];
        });
        let next_id = r.begin();
        assert_eq!(
            read(r.root.path(), &next_id).unwrap().deadline,
            draft.deadline
        );
        let result = r.run(20).unwrap();
        assert_eq!(result.flashcards.len(), 20);
        let d = read(r.root.path(), &next_id).unwrap();
        assert_eq!(d.requests[0], 1);
        assert_eq!(d.requests[1], 2);
        assert_eq!(d.requests[2], 1);
        assert_eq!(r.count(), 4);
        // With all units checkpointed, a repeated completion makes no request.
        let repeated = r.run(20).unwrap();
        assert_eq!(repeated.flashcards.len(), 20);
        assert_eq!(r.count(), 4);
    }

    #[test]
    fn empty_source_and_transport_admission_cap_dispatch_nothing() {
        let mut r = Rig::new();
        r.source = LoadedSource::new(vec![], "text/plain", "empty.txt");
        std::fs::write(
            r.root
                .path()
                .join(documents::DOCUMENTS_DIR)
                .join(&r.source.scope),
            [],
        )
        .unwrap();
        r.begin();
        assert!(r.run(20).unwrap_err().contains("empty"));
        assert_eq!(r.count(), 0);
        let r = Rig::new();
        let id = r.begin();
        r.script(vec![aid(0, 0), aid(0, 1)]);
        r.run(20).unwrap();
        let mut d = read(r.root.path(), &id).unwrap();
        d.complete = false;
        d.next = 1;
        d.admissions = 512;
        write(r.root.path(), &id, &d).unwrap();
        let calls = r.fake.log().len();
        assert!(r.run(20).is_err());
        assert_eq!(r.fake.log().len(), calls);
    }
    #[test]
    fn sixty_cards_with_two_recoveries_has_exactly_nine_submissions() {
        let r = Rig::new();
        let id = r.begin();
        let mut values = vec![aid(0, 0)];
        for i in 0..6 {
            values.push(aid(i * 10, 10));
        }
        r.script(values);
        r.fake
            .behave(|b| b.generate_statuses = vec![(503, "{}".into()); 2]);
        assert_eq!(r.run(60).unwrap().flashcards.len(), 60);
        assert_eq!(r.count(), 9);
        assert_eq!(
            read(r.root.path(), &id)
                .unwrap()
                .requests
                .iter()
                .sum::<u32>(),
            9
        );
        println!(
            "MEASURE target=60 with_recoveries=2 generation_requests=9 all_http={}",
            r.fake.log().len()
        );
    }

    #[test]
    fn one_active_budget_covers_later_batches_and_failed_final_journal_write_keeps_draft() {
        let r = Rig::new();
        let id = r.begin();
        r.script(vec![aid(0, 0), aid(0, 10)]);
        let (budget, time) = fake_budget(Duration::from_secs(300));
        let say = |message: String| {
            if message.contains(" / ") {
                time.advance(Duration::from_secs(300));
            }
        };
        let ctx = GenContext {
            http: &r.http,
            base: &r.fake.base,
            api_key: "synthetic-only",
            choice: ModelChoice::Standard,
            cache: &r.cache,
            epoch: r.cache.epoch(),
            budget: &budget,
            say: &say,
        };
        assert!(tauri::async_runtime::block_on(generate(
            &ctx,
            &r.source,
            r.root.path(),
            "material",
            20
        ))
        .is_err());
        assert_eq!(r.count(), 1);
        assert_eq!(read(r.root.path(), &id).unwrap().next, 1);
        std::fs::create_dir(r.root.path().join("gemini-jobs.json.writing")).unwrap();
        assert!(gemini_jobs::with(r.root.path(), |j| j.ready(&id, aid(0, 1))).is_err());
        let reopened = gemini_jobs::Journal::open(r.root.path());
        assert_eq!(reopened.list()[0].stage, JobStage::Interrupted);
        assert!(reopened.list()[0].draft.is_some());
        assert!(reopened.list()[0].result.is_none());
    }

    #[test]
    fn card_batch_prompt_asks_for_backs_that_do_not_restate_the_front() {
        let prompt = super::card_batch_prompt(1, 40, "", "Use only facts.");
        assert!(prompt.contains(super::CARD_BACK_RULE), "{prompt}");
        assert!(
            prompt.contains("never restate or repeat the front"),
            "{prompt}"
        );
    }
}
