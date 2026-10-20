//! Native, explicit-activation section guides. No UI or queue.
use super::*;
use std::collections::BTreeMap;

const KIND: &str = "guide-sections-v1";
const PLANNER: &str = "pdf-outline-5-10-v1";
const PROMPT: &str = "guide-section-prompt-v1";
const SCHEMA_VERSION: &str = "guide-section-answer-v1";
type Hints = Vec<(u32, u32, String)>;
type Hook<'a> = &'a (dyn Fn(&str) + Sync);

#[derive(Clone, Debug, Serialize)]
pub struct SectionError {
    pub code: String,
    pub message: String,
}
impl SectionError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
    fn source() -> Self {
        Self::new("SOURCE_CHANGED", "This PDF or your chosen pages changed. Keep your earlier work, or explicitly start a new guide.")
    }
}
impl From<String> for SectionError {
    fn from(message: String) -> Self {
        Self::new("GUIDE_PAUSED", &message)
    }
}
impl From<&str> for SectionError {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRequest {
    material_id: String,
    relative_path: String,
    chosen_pages: Vec<u32>,
    base_revision: Option<String>,
    request_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Section {
    id: String,
    heading: String,
    page_start: u32,
    page_end: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    material_id: String,
    relative_path: String,
    original_sha256: String,
    selected_sha256: String,
    chosen_pages: Vec<u32>,
    planner_version: String,
    manifest: Vec<Section>,
    model: String,
    prompt_version: String,
    schema_version: String,
    base_revision: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Status {
    Pending,
    InFlight,
    Complete,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResultBody {
    body: String,
    source_pages: Vec<u32>,
    content_digest: String,
    model: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct SectionResult {
    status: Status,
    content: Option<ResultBody>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Activation {
    id: u64,
    submissions: u32,
    reservations: BTreeMap<String, u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Draft {
    kind: String,
    version: u32,
    identity: Identity,
    results: BTreeMap<String, SectionResult>,
    activations: Vec<Activation>,
    timing: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    supersedes: Option<String>,
    #[serde(
        default,
        rename = "preparedFile",
        skip_serializing_if = "Option::is_none"
    )]
    prepared_file: Option<gemini_files::Descriptor>,
}

fn reference_error(error: gemini_files::ReferenceError) -> SectionError {
    SectionError::new(error.code(), error.message())
}

/// Acknowledgement is also deliberate discard. First commit removal; only
/// then attempt cleanup, authenticated with the key that created the file.
type DiscardedReference = Option<(gemini_files::Descriptor, String)>;
pub(super) fn take_discard_at(
    root: &Path,
    id: &str,
    cache: &PreparedSources,
) -> Result<(bool, DiscardedReference), String> {
    let (removed, descriptor) = gemini_jobs::with(root, |j| {
        let records = j.list();
        let raw = records
            .iter()
            .find(|r| r.id == id)
            .and_then(|r| r.draft.as_ref());
        let descriptor = raw.and_then(|d| {
            let descriptor: gemini_files::Descriptor =
                serde_json::from_value(d.get("preparedFile")?.clone()).ok()?;
            let sha = d
                .get("identity")?
                .get("selectedSha256")?
                .as_str()?
                .to_string();
            Some((descriptor, sha))
        });
        let removed = j.acknowledge(id)?;
        let descriptor = descriptor.filter(|(d, _)| {
            !j.list().iter().any(|r| {
                r.draft
                    .as_ref()
                    .and_then(|v| v.get("preparedFile"))
                    .and_then(|v| {
                        serde_json::from_value::<gemini_files::Descriptor>(v.clone()).ok()
                    })
                    .is_some_and(|other| d.same_remote(&other))
            })
        });
        Ok::<_, String>((removed, descriptor))
    })?;
    if removed {
        cache.release_owner(id);
    }
    Ok((removed, descriptor))
}
#[cfg(test)]
async fn discard_at(
    root: &Path,
    id: &str,
    cache: &PreparedSources,
    http: &Client,
    base: &str,
    key: Option<&str>,
) -> Result<bool, String> {
    let (removed, descriptor) = take_discard_at(root, id, cache)?;
    if let (true, Some((descriptor, sha)), Some(key)) = (removed, descriptor, key) {
        cache
            .discard_reference(&descriptor, id, http, base, key, &sha)
            .await;
    }
    Ok(removed)
}

fn plan(pages: &[u32], hints: &[(u32, u32, String)]) -> Result<Vec<Section>, SectionError> {
    if pages.is_empty()
        || pages.len() > 1000
        || pages[0] == 0
        || pages.windows(2).any(|p| p[0] >= p[1])
    {
        return Err(SectionError::new(
            "INVALID_PAGES",
            "Choose PDF pages in source order.",
        ));
    }
    let mut output = Vec::new();
    let mut at = 0;
    while at < pages.len() {
        let first = pages[at];
        let hint = hints
            .iter()
            .find(|(start, end, _)| first >= *start && first <= *end);
        let limit = hint.map_or(5, |_| 10);
        let mut end = at;
        while end + 1 < pages.len()
            && end + 1 - at < limit
            && pages[end + 1] == pages[end] + 1
            && match hint {
                Some((_, last, _)) => pages[end + 1] <= *last,
                None => !hints
                    .iter()
                    .any(|(s, e, _)| pages[end + 1] >= *s && pages[end + 1] <= *e),
            }
        {
            end += 1;
        }
        output.push(Section {
            id: format!("section-{:02}", output.len() + 1),
            heading: hint.map_or_else(
                || format!("Pages {first}–{}", pages[end]),
                |(_, _, h)| h.chars().take(200).collect(),
            ),
            page_start: first,
            page_end: pages[end],
        });
        if output.len() > 40 {
            return Err(SectionError::new(
                "TOO_MANY_SECTIONS",
                "Choose fewer pages; this guide needs more than 40 sections.",
            ));
        }
        at = end + 1;
    }
    Ok(output)
}

fn source(
    root: &Path,
    request: &SectionRequest,
    model: &str,
) -> Result<(Identity, LoadedSource), SectionError> {
    let safe = documents::safe_relative_path(&request.relative_path)?;
    let path = root.join(documents::DOCUMENTS_DIR).join(safe);
    // Canonical containment excludes symlinks out of managed documents too.
    let base = root
        .join(documents::DOCUMENTS_DIR)
        .canonicalize()
        .map_err(|_| SectionError::source())?;
    let canonical = path.canonicalize().map_err(|_| SectionError::source())?;
    if !canonical.starts_with(base) {
        return Err(SectionError::source());
    }
    let len = std::fs::metadata(&canonical)
        .map_err(|_| SectionError::source())?
        .len();
    if len > MAX_PDF_BYTES {
        return Err("This PDF is too large.".into());
    }
    let bytes = std::fs::read(canonical).map_err(|_| SectionError::source())?;
    let document = lopdf::Document::load_mem(&bytes).map_err(|_| SectionError::source())?;
    let total = document.get_pages().len() as u32;
    if total == 0 || total > crate::pdf::MAX_PAGES {
        return Err("Choose a smaller PDF.".into());
    }
    // lopdf's existing bookmark helper provides page starts. Prefer the outer
    // heading at duplicate starts and derive nonoverlapping ranges once.
    let mut starts: BTreeMap<u32, String> = BTreeMap::new();
    if let Ok(toc) = document.get_toc() {
        for entry in toc.toc {
            if let Ok(page) = u32::try_from(entry.page) {
                if page > 0 && page <= total && !entry.title.trim().is_empty() {
                    starts.entry(page).or_insert(entry.title);
                }
            }
        }
    }
    let starts: Vec<_> = starts.into_iter().collect();
    let hints: Hints = starts
        .iter()
        .enumerate()
        .map(|(i, (p, h))| {
            (
                *p,
                starts.get(i + 1).map_or(total, |(p, _)| p - 1),
                h.clone(),
            )
        })
        .collect();
    let manifest = plan(&request.chosen_pages, &hints)?;
    let selected = crate::pdf::selected_bytes(&bytes, &request.chosen_pages)?;
    check_size("application/pdf", selected.len() as u64)?;
    let loaded = LoadedSource::new(selected, "application/pdf", &request.relative_path);
    let identity = Identity {
        material_id: request.material_id.clone(),
        relative_path: request.relative_path.clone(),
        original_sha256: calculate_sha256(&bytes),
        selected_sha256: loaded.content_sha256.clone(),
        chosen_pages: request.chosen_pages.clone(),
        planner_version: PLANNER.into(),
        manifest,
        model: model.into(),
        prompt_version: PROMPT.into(),
        schema_version: SCHEMA_VERSION.into(),
        base_revision: request.base_revision.clone(),
    };
    Ok((identity, loaded))
}
fn new_draft(identity: Identity) -> Draft {
    let results = identity
        .manifest
        .iter()
        .map(|s| {
            (
                s.id.clone(),
                SectionResult {
                    status: Status::Pending,
                    content: None,
                },
            )
        })
        .collect();
    Draft {
        kind: KIND.into(),
        version: 1,
        identity,
        results,
        activations: vec![],
        timing: Value::Null,
        supersedes: None,
        prepared_file: None,
    }
}
fn read_draft(root: &Path, id: &str) -> Result<Draft, SectionError> {
    let value = gemini_jobs::with(root, |j| {
        j.list()
            .into_iter()
            .find(|j| j.id == id)
            .and_then(|j| j.draft)
    })
    .ok_or_else(|| {
        SectionError::new(
            "DRAFT_UNAVAILABLE",
            "The draft is unavailable or quarantined; nothing was sent.",
        )
    })?;
    // A present-but-null/malformed descriptor is not an absent reference.
    if let Some(raw) = value.get("preparedFile") {
        serde_json::from_value::<gemini_files::Descriptor>(raw.clone())
            .map_err(|_| reference_error(gemini_files::ReferenceError::Invalid))?;
    }
    let d: Draft = serde_json::from_value(value).map_err(|_| {
        SectionError::new(
            "INVALID_DRAFT",
            "The draft could not be read; it is kept for recovery.",
        )
    })?;
    if d.kind != KIND
        || d.version != 1
        || d.identity.manifest.is_empty()
        || d.identity.manifest.len() > 40
        || d.results.len() != d.identity.manifest.len()
    {
        return Err("Invalid section draft; it is kept for recovery.".into());
    }
    for section in &d.identity.manifest {
        let result = d.results.get(&section.id).ok_or("Missing section result")?;
        match (&result.status, &result.content) {
            (Status::Complete, Some(content)) => {
                validate_section(
                    section,
                    &json!({"body":content.body,"sourcePages":content.source_pages}).to_string(),
                    &d.identity.chosen_pages,
                    &content.model,
                )?;
                if digest(content) != content.content_digest {
                    return Err("Invalid section digest".into());
                }
            }
            (Status::Pending | Status::InFlight, None) => (),
            _ => return Err("Invalid section checkpoint".into()),
        }
    }
    Ok(d)
}
fn store(root: &Path, id: &str, draft: &Draft) -> Result<(), SectionError> {
    gemini_jobs::with(root, |j| {
        j.checkpoint_draft(id, serde_json::to_value(draft).map_err(|e| e.to_string())?)
    })
    .map_err(Into::into)
}
fn admit(root: &Path, req: &SectionRequest, draft: &Draft) -> Result<String, SectionError> {
    gemini_jobs::with(root, |j| {
        j.begin_sections(
            &req.material_id,
            &req.relative_path,
            &draft.identity.selected_sha256,
            req.base_revision.as_deref(),
            req.request_id.as_deref(),
            serde_json::to_value(draft).map_err(|e| e.to_string())?,
        )
    })
    .map_err(Into::into)
}
fn digest(content: &ResultBody) -> String {
    calculate_sha256(
        &serde_json::to_vec(
            &json!({"body":content.body,"sourcePages":content.source_pages,"model":content.model}),
        )
        .unwrap(),
    )
}
fn validate_section(
    s: &Section,
    text: &str,
    chosen: &[u32],
    model: &str,
) -> Result<ResultBody, SectionError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Answer {
        body: String,
        source_pages: Vec<u32>,
    }
    let a: Answer = serde_json::from_str(text)
        .map_err(|_| "The section answer was incomplete; earlier sections are kept.")?;
    if a.body.trim().is_empty()
        || a.body.chars().count() > 16_000
        || a.source_pages.is_empty()
        || a.source_pages.len() > 10
        || a.source_pages.windows(2).any(|p| p[0] >= p[1])
        || a.source_pages
            .iter()
            .any(|p| *p < s.page_start || *p > s.page_end || !chosen.contains(p))
    {
        return Err(
            "The section answer or its source pages were invalid; earlier sections are kept."
                .into(),
        );
    }
    let mut content = ResultBody {
        body: a.body,
        source_pages: a.source_pages,
        content_digest: String::new(),
        model: model.into(),
    };
    content.content_digest = digest(&content);
    Ok(content)
}
fn request_body(section: &Section, identity: &Identity, part: Value) -> Value {
    let mapping: Vec<_> = identity
        .chosen_pages
        .iter()
        .enumerate()
        .filter(|(_, p)| **p >= section.page_start && **p <= section.page_end)
        .map(|(i, p)| json!({"pdfPage":i+1,"sourcePage":p}))
        .collect();
    let prompt = format!("{PROMPT}: Write only section {} ({}) from the attached PDF. Read ONLY these selected PDF pages and cite their original sourcePage numbers: {}. Do not discuss other pages. Use only supported facts; do not invent procedures or regulations. Return JSON with body (nonempty Markdown, at most 16000 characters) and sourcePages (ordered unique original source page numbers actually used). This is a Gemini study aid to check against current FAA material and her instructor.", section.id, section.heading, json!(mapping));
    json!({"contents":[{"role":"user","parts":[{"text":prompt},part]}],"generationConfig":{"responseMimeType":"application/json","maxOutputTokens":8192,"responseSchema":{"type":"OBJECT","required":["body","sourcePages"],"properties":{"body":{"type":"STRING"},"sourcePages":{"type":"ARRAY","items":{"type":"INTEGER"}}}}}})
}
fn reserve(root: &Path, id: &str, section: &str) -> Option<u32> {
    // Both the durable reservation and cancellation decision use this lock.
    gemini_jobs::with(root, |j| {
        if !j.admits(id) {
            return None;
        }
        let value = j.list().into_iter().find(|j| j.id == id)?.draft?;
        let mut d: Draft = serde_json::from_value(value).ok()?;
        if d.results.get(section)?.status == Status::Complete {
            return None;
        }
        let activation = d.activations.last_mut()?;
        let count = activation.reservations.get(section).copied().unwrap_or(0);
        let extras: u32 = activation
            .reservations
            .values()
            .map(|n| n.saturating_sub(1))
            .sum();
        if count >= 3
            || activation.submissions >= d.identity.manifest.len() as u32 + 2
            || (count > 0 && extras >= 2)
        {
            return None;
        }
        activation.submissions += 1;
        activation.reservations.insert(section.into(), count + 1);
        d.results.get_mut(section)?.status = Status::InFlight;
        j.checkpoint_draft(id, serde_json::to_value(d).ok()?).ok()?;
        Some(count + 1)
    })
}
fn assembly(d: &Draft) -> Result<GeneratedStudyAid, SectionError> {
    let mut sections = Vec::new();
    for section in &d.identity.manifest {
        let result = &d.results[&section.id];
        if result.status != Status::Complete {
            return Err("The guide is unfinished.".into());
        }
        let content = result.content.as_ref().ok_or("Missing validated content")?;
        sections.push(StudySection {
            heading: section.heading.clone(),
            body: content.body.clone(),
        });
    }
    // Section digests/pages/models remain in the durable draft until acknowledgement.
    let provenance: Vec<_> = d
        .identity
        .manifest
        .iter()
        .map(|s| {
            let c = d.results[&s.id].content.as_ref().unwrap();
            json!({"id":s.id,"pages":c.source_pages,"model":c.model,"sha256":c.content_digest})
        })
        .collect();
    Ok(GeneratedStudyAid {
        title: "Section study guide".into(),
        summary: "Gemini study aid. Check against current FAA material and her instructor.".into(),
        sections,
        flashcards: vec![],
        source_notes: format!(
            "Source SHA-256: {}; selected PDF SHA-256: {}; sections: {}",
            d.identity.original_sha256,
            d.identity.selected_sha256,
            json!(provenance)
        ),
        model: d.identity.model.clone(),
    })
}

pub(super) async fn activate(
    ctx: &GenContext<'_>,
    root: &Path,
    req: &SectionRequest,
    id: Option<&str>,
    hook: Hook<'_>,
) -> Result<JobAnswer<GeneratedStudyAid>, SectionError> {
    // Compare ordered pages before parsing them, so a changed ordering is a
    // SOURCE_CHANGED refusal, including orderings invalid for a new guide.
    let old = id.map(|id| read_draft(root, id)).transpose()?;
    if old.as_ref().is_some_and(|d| {
        d.identity.chosen_pages != req.chosen_pages
            || d.identity.material_id != req.material_id
            || d.identity.relative_path != req.relative_path
            || d.identity.base_revision != req.base_revision
    }) {
        return Err(SectionError::source());
    }
    let (identity, selected) = source(root, req, ctx.choice.primary())?;
    if old.as_ref().is_some_and(|d| d.identity != identity) {
        return Err(SectionError::source());
    }
    let id = match id {
        Some(id) => id.to_string(),
        None => admit(root, req, &new_draft(identity.clone()))?,
    };
    gemini_jobs::with(root, |j| j.activate_sections(&id))?;
    let mut running = RunningJob {
        root,
        id: Some(id.clone()),
        changed: &|_| {},
    };
    let registration = gemini_cancel::register(&id);
    let (path, job) = (root.to_path_buf(), id.clone());
    ctx.budget.attach_probe(Arc::new(move || {
        gemini_jobs::with(&path, |j| j.admits(&job))
    }));
    let (path, job) = (root.to_path_buf(), id.clone());
    ctx.budget.attach_admission(Arc::new(move || {
        gemini_jobs::with(&path, |j| j.admits(&job))
    }));
    let work = async {
        let mut d = read_draft(root, &id)?;
        if d.results.values().any(|r| r.status != Status::Complete) {
            d.activations.push(Activation {
                id: d.activations.len() as u64 + 1,
                submissions: 0,
                reservations: BTreeMap::new(),
            });
            // A new explicit activation intentionally never restores old wall time.
            d.timing = Value::Null;
            store(root, &id, &d)?;
            let (path, job) = (root.to_path_buf(), id.clone());
            if !ctx.budget.enable_stages(Arc::new(move |timing| {
                gemini_jobs::with(&path, |j| j.checkpoint_timing(&job, timing.clone()).is_ok())
            })) {
                return Err(gemini_budget::CHECKPOINT_FAILED.into());
            }
            let restored = match d.prepared_file.as_ref() {
                Some(descriptor) => ctx
                    .cache
                    .resume_reference(
                        descriptor,
                        ctx.http,
                        ctx.base,
                        ctx.api_key,
                        &selected.as_source(),
                        ctx.epoch,
                        ctx.budget,
                    )
                    .await
                    .map_err(reference_error)?,
                None => None,
            };
            let lease = match restored {
                Some(lease) => lease,
                None => {
                    ctx.cache
                        .prepare(
                            ctx.http,
                            ctx.base,
                            ctx.api_key,
                            &selected.as_source(),
                            ctx.epoch,
                            d.prepared_file.as_ref().map(|d| d.name()),
                            ctx.budget,
                            ctx.say,
                        )
                        .await?
                }
            };
            let descriptor = gemini_files::Descriptor::from_lease(
                &lease,
                ctx.base,
                ctx.api_key,
                &identity.selected_sha256,
            )
            .map_err(reference_error)?;
            hook("before-descriptor-commit");
            if !ctx.cache.retain_committed(&lease, &id, || {
                // Timing checkpoints may have advanced while preparation ran.
                let mut latest = read_draft(root, &id)?;
                latest.prepared_file = Some(descriptor);
                store(root, &id, &latest)
            })? {
                return Err(gemini_files::STALE_CONTEXT.into());
            }
            hook("after-descriptor-commit");
            for section in &identity.manifest {
                if read_draft(root, &id)?.results[&section.id].status == Status::Complete {
                    continue;
                }
                if source(root, req, ctx.choice.primary())?.0 != identity {
                    return Err(SectionError::source());
                }
                if !ctx.current() || !lease.is_current() {
                    return Err(gemini_files::STALE_CONTEXT.into());
                }
                hook("before-reservation");
                let (path, job, unit) = (root.to_path_buf(), id.clone(), section.id.clone());
                ctx.budget
                    .allocate_with(Arc::new(move || reserve(&path, &job, &unit)));
                let body = request_body(
                    section,
                    &identity,
                    source_part(&selected, Some(lease.prepared())),
                );
                // No earlier answer appears in this request body.
                let (raw, model) = section_generate(ctx, &body, hook).await?;
                ctx.budget.reset_stage(Stage::Validating);
                ctx.budget.validation_checkpoint()?;
                let text = extract_text(&raw)?;
                let content = validate_section(section, &text, &identity.chosen_pages, model)?;
                ctx.budget.validation_checkpoint()?;
                hook("before-section-commit");
                let mut d = read_draft(root, &id)?;
                d.results.insert(
                    section.id.clone(),
                    SectionResult {
                        status: Status::Complete,
                        content: Some(content),
                    },
                );
                store(root, &id, &d)?;
                hook("after-section-commit");
                if !ctx.budget.can_continue() {
                    return Err(gemini_cancel::CANCELLED.into());
                }
            }
            ctx.cache
                .finish_admitted(lease, ctx.http, ctx.api_key, ctx.budget)
                .await;
        }
        if source(root, req, ctx.choice.primary())?.0 != identity {
            return Err(SectionError::source());
        }
        let answer = assembly(&read_draft(root, &id)?)?;
        Ok(answer)
    };
    let outcome =
        match gemini_cancel::Cancellable::new(ctx.budget.run(work), registration.token.clone())
            .await
        {
            Ok(Ok(outcome)) => outcome,
            _ if !ctx.budget.can_continue() || registration.token.is_cancelled() => {
                Err(gemini_cancel::CANCELLED.into())
            }
            _ => Err(gemini_files::out_of_time(ctx.budget, "finishing the guide").into()),
        };
    match outcome {
        Ok(answer) => {
            gemini_jobs::with(root, |j| {
                j.sections_ready(
                    &id,
                    serde_json::to_value(&answer).map_err(|e| e.to_string())?,
                )
            })?;
            hook("after-ready");
            running.id = None;
            Ok(JobAnswer {
                answer,
                job_id: Some(id),
                content_sha256: identity.selected_sha256,
                checkpointed: true,
            })
        }
        Err(error) => {
            gemini_jobs::with(root, |j| j.failed(&id, &error.message))?;
            running.id = None;
            Err(error)
        }
    }
}

// Section retries deliberately stay on the frozen model; at most three and
// two extra submissions over the manifest, recorded before any send.
async fn section_generate(
    ctx: &GenContext<'_>,
    body: &Value,
    hook: Hook<'_>,
) -> Result<(String, &'static str), SectionError> {
    for attempt in 1..=3 {
        if ctx.budget.start_attempt().is_none() {
            return Err(
                "The section request limit was reached or its reservation could not be saved."
                    .into(),
            );
        }
        hook("after-reservation");
        if !ctx.budget.can_continue() || !ctx.current() {
            return Err(gemini_cancel::CANCELLED.into());
        }
        let retry_after = match generate_once(ctx, ctx.choice.primary(), body)
            .await
            .map_err(|e| e.message)?
        {
            Attempt::Answered(raw) => return Ok((raw, ctx.choice.primary())),
            Attempt::Refused {
                status,
                body,
                retry_after,
            } => {
                if !is_retryable(status) || (status == 429 && is_lasting_quota(&body)) {
                    return Err(describe_refusal(
                        RefusalContext::Generation,
                        status,
                        &body,
                        ctx.choice.primary(),
                    )
                    .into());
                }
                retry_after
            }
            Attempt::Lost(_) => None,
        };
        if attempt < 3
            && !ctx
                .budget
                .pause(retry_after.unwrap_or_else(|| backoff_delay(attempt - 1, 0)))
                .await
        {
            break;
        }
    }
    Err("The section could not finish; completed sections are kept. Try again to continue.".into())
}

fn restart_draft(
    root: &Path,
    old_id: &str,
    consent: bool,
    req: &SectionRequest,
    choice: ModelChoice,
) -> Result<String, SectionError> {
    if !consent {
        return Err(SectionError::new(
            "CONSENT_REQUIRED",
            "Starting a new guide requires explicit consent.",
        ));
    }
    let old = read_draft(root, old_id)?;
    if old.identity.material_id != req.material_id {
        return Err(SectionError::source());
    }
    let (identity, _) = source(root, req, choice.primary())?;
    let mut draft = new_draft(identity);
    draft.supersedes = Some(old_id.into());
    admit(root, req, &draft)
}

/// Existing save errors retain their wire shape; source identity refusals add
/// the typed SOURCE_CHANGED code only for an explicitly supplied guide job.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum GuideSaveError {
    Guide(SectionError),
    Save(crate::study_sets::StudySetErrorWire),
}
impl From<SectionError> for GuideSaveError {
    fn from(value: SectionError) -> Self {
        Self::Guide(value)
    }
}
impl From<crate::study_sets::StudySetErrorWire> for GuideSaveError {
    fn from(value: crate::study_sets::StudySetErrorWire) -> Self {
        Self::Save(value)
    }
}

pub(crate) fn save_guide_at(
    root: &Path,
    id: &str,
    operation: &Value,
) -> Result<crate::study_sets::SaveResult, GuideSaveError> {
    let d = read_draft(root, id)?;
    let request = SectionRequest {
        material_id: d.identity.material_id.clone(),
        relative_path: d.identity.relative_path.clone(),
        chosen_pages: d.identity.chosen_pages.clone(),
        base_revision: d.identity.base_revision.clone(),
        request_id: None,
    };
    let (identity, _) = source(root, &request, &d.identity.model)?;
    if identity != d.identity {
        return Err(SectionError::source().into());
    }
    assembly(&d)?;
    // Use the existing full-row revision check and exact save retry protocol.
    // A UI regeneration review may change next, but cannot change the base.
    let decoded = crate::study_sets::decode_operation(operation).map_err(|e| e.error())?;
    let expected_revision = decoded
        .expected
        .as_ref()
        .and_then(|r| r.get("updated_at"))
        .and_then(Value::as_str);
    if decoded.material_id != d.identity.material_id
        || expected_revision != d.identity.base_revision.as_deref()
    {
        return Err(crate::study_sets::StudySetErrorCode::StaleContent
            .error()
            .into());
    }
    crate::study_sets::save_study_set_at(root, operation).map_err(Into::into)
}

#[tauri::command]
pub async fn resume_study_guide(
    app: AppHandle,
    request: SectionRequest,
    job_id: Option<String>,
) -> Result<JobAnswer<GeneratedStudyAid>, SectionError> {
    let budget = Budget::new(gemini_budget::ACTIVE_BUDGET);
    let root = app_root(&app)?;
    // A locally complete guide needs neither a key nor a provider lookup.
    let complete = job_id
        .as_deref()
        .map(|id| read_draft(&root, id))
        .transpose()?
        .is_some_and(|d| d.results.values().all(|r| r.status == Status::Complete));
    let key = if complete {
        String::new()
    } else {
        stored_key(&app)?
    };
    let http = generation_client()?;
    let reporter = reporter_for(&app, &request.material_id, JobKind::StudyAid);
    reporter.follow(&budget);
    let say = |m| reporter.say(m);
    let ctx = GenContext {
        http: &http,
        base: GOOGLE_BASE,
        api_key: &key,
        choice: load_choice(&root),
        cache: prepared_sources(),
        epoch: prepared_sources().epoch(),
        budget: &budget,
        say: &say,
    };
    activate(&ctx, &root, &request, job_id.as_deref(), &|_| {}).await
}
#[tauri::command]
pub async fn restart_study_guide(
    app: AppHandle,
    job_id: String,
    consent: bool,
    request: SectionRequest,
) -> Result<JobAnswer<GeneratedStudyAid>, SectionError> {
    let root = app_root(&app)?;
    let new_id = restart_draft(&root, &job_id, consent, &request, load_choice(&root))?;
    resume_study_guide(app, request, Some(new_id)).await
}

#[cfg(test)]
#[path = "gemini_sections_tests.rs"]
mod tests;
