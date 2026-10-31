//! Native, explicit-activation section guides. No UI or queue.
use super::*;
use std::collections::BTreeMap;

const KIND: &str = "guide-sections-v1";
/// The planner new guides use: one request for up to PART_PAGES chosen pages,
/// like asking a chat about the whole PDF; longer selections split into as
/// few parts as possible, preferring chapter starts.
const PLANNER: &str = "pdf-parts-150-v1";
/// The earlier planner (5 pages, up to 10 inside a heading). Drafts and queued
/// guides started with it keep it, so they still resume after an update.
const LEGACY_PLANNER: &str = "pdf-outline-5-10-v1";
/// The prompt new guides use: a basic section (short overview + key points).
const PROMPT: &str = "guide-section-prompt-v2";
/// The earlier, longer prompt. Drafts started with it finish with it, so one
/// guide never mixes the two styles.
const LEGACY_PROMPT: &str = "guide-section-prompt-v1";
const SCHEMA_VERSION: &str = "guide-section-answer-v1";
/// The most sections one guide may hold, so one activation stays finishable.
const MAX_SECTIONS: usize = 40;
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
    /// A plain, student-safe reason she may read as written (GUIDE_FAILED).
    /// Only the section request's own answer/refusal/timeout sentences use it;
    /// any other internal text stays GUIDE_PAUSED and shows the generic line.
    fn native(message: &str) -> Self {
        Self::new("GUIDE_FAILED", message)
    }
    fn plan_changed() -> Self {
        Self::new("PLAN_CHANGED", "Her Flight Deck was updated since this guide started. Keep your earlier sections, or start a new guide?")
    }
}
fn identity_mismatch_error(old: &Identity, current: &Identity) -> SectionError {
    if old.original_sha256 == current.original_sha256
        && old.selected_sha256 == current.selected_sha256
        && old.chosen_pages == current.chosen_pages
        && old.material_id == current.material_id
        && old.relative_path == current.relative_path
        && old.base_revision == current.base_revision
    {
        SectionError::plan_changed()
    } else {
        SectionError::source()
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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum QueueState {
    WaitingForHer,
    Running,
    Paused,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Draft {
    kind: String,
    version: u32,
    #[serde(
        default,
        rename = "queueState",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) queue_state: Option<QueueState>,
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

#[derive(Clone, Debug)]
struct PlannedSection {
    section: Section,
    has_hint: bool,
    first_heading: String,
    merged_count: usize,
}

/// Chosen pages one request may cover. 150 pages stay well inside Gemini's
/// document limits and Claude's 300-page / 32 MB request guards.
const PART_PAGES: usize = 150;
/// The planner and prompt one guide is made with.
#[derive(Clone, Copy, Debug)]
struct Recipe {
    planner: &'static str,
    prompt: &'static str,
}
const CURRENT: Recipe = Recipe {
    planner: PLANNER,
    prompt: PROMPT,
};
/// The recipe a draft keeps: its own versions when this app still knows them,
/// otherwise the current ones (which then report PLAN_CHANGED to the draft).
fn recipe_for(identity: &Identity) -> Recipe {
    Recipe {
        planner: if identity.planner_version == LEGACY_PLANNER {
            LEGACY_PLANNER
        } else {
            PLANNER
        },
        prompt: if identity.prompt_version == LEGACY_PROMPT {
            LEGACY_PROMPT
        } else {
            PROMPT
        },
    }
}
/// The generating wait for one request: a part of up to 150 pages gets the
/// whole-document wait (480 s); an earlier five-page section keeps 240 s. The
/// 900-second activation total is unchanged: one part always fits, and a
/// second part that runs out of it pauses with the first kept, then resumes.
fn generating_seconds(recipe: Recipe) -> u64 {
    if recipe.planner == LEGACY_PLANNER {
        240
    } else {
        480
    }
}
fn plan_for(
    planner: &str,
    pages: &[u32],
    hints: &[(u32, u32, String)],
) -> Result<Vec<Section>, SectionError> {
    if planner == LEGACY_PLANNER {
        plan_legacy(pages, hints)
    } else {
        plan(pages, hints)
    }
}
fn too_many_sections() -> SectionError {
    SectionError::new(
        "TOO_MANY_SECTIONS",
        "Choose fewer pages; this guide needs more than 40 sections.",
    )
}
fn check_pages(pages: &[u32]) -> Result<(), SectionError> {
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
    Ok(())
}

/// The current planner: each run of consecutive chosen pages is one request
/// when it has at most PART_PAGES pages; a longer run splits into the fewest
/// parts, ending a part just before a chapter start when one keeps that count.
fn plan(pages: &[u32], hints: &[(u32, u32, String)]) -> Result<Vec<Section>, SectionError> {
    check_pages(pages)?;
    let starts: Vec<u32> = hints.iter().map(|(start, _, _)| *start).collect();
    let mut output = Vec::new();
    let mut run_start = 0;
    for at in 0..pages.len() {
        if at + 1 == pages.len() || pages[at + 1] != pages[at] + 1 {
            split_run(&pages[run_start..=at], &starts, &mut output);
            run_start = at + 1;
        }
    }
    condense(output, MAX_SECTIONS).ok_or_else(too_many_sections)
}
fn split_run(run: &[u32], starts: &[u32], output: &mut Vec<PlannedSection>) {
    let mut at = 0;
    while at < run.len() {
        let left = run.len() - at;
        let parts = left.div_ceil(PART_PAGES);
        let even = left.div_ceil(parts);
        // The chapter start nearest the even split that still leaves the rest
        // within the remaining parts.
        let size = (1..left.min(PART_PAGES + 1))
            .filter(|&len| left - len <= PART_PAGES * (parts - 1))
            .filter(|&len| starts.contains(&run[at + len]))
            .min_by_key(|&len| len.abs_diff(even))
            .unwrap_or(even);
        let (first, last) = (run[at], run[at + size - 1]);
        output.push(PlannedSection {
            section: Section {
                id: String::new(),
                heading: format!("Pages {first}–{last}"),
                page_start: first,
                page_end: last,
            },
            has_hint: false,
            first_heading: String::new(),
            merged_count: 1,
        });
        at += size;
    }
}

/// The earlier five-page planner, kept unchanged for drafts made with it.
fn plan_legacy(pages: &[u32], hints: &[(u32, u32, String)]) -> Result<Vec<Section>, SectionError> {
    check_pages(pages)?;
    let mut output: Vec<PlannedSection> = Vec::new();
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
        let heading = hint.map_or_else(
            || format!("Pages {first}–{}", pages[end]),
            |(_, _, h)| h.chars().take(200).collect(),
        );
        output.push(PlannedSection {
            first_heading: heading.clone(),
            has_hint: hint.is_some(),
            merged_count: 1,
            section: Section {
                id: String::new(),
                heading,
                page_start: first,
                page_end: pages[end],
            },
        });
        at = end + 1;
    }
    // Sensible section size: merge neighbouring sections within the same chosen run
    // while a section has fewer than 5 pages, as long as the merged section stays at most 10 pages.
    let mut i = 0;
    while i < output.len() {
        let page_count = output[i].section.page_end - output[i].section.page_start + 1;
        if page_count < 5 {
            if i + 1 < output.len()
                && output[i].section.page_end + 1 == output[i + 1].section.page_start
                && (output[i + 1].section.page_end - output[i].section.page_start + 1) <= 10
            {
                let next = output.remove(i + 1);
                output[i].section.page_end = next.section.page_end;
                output[i].merged_count += next.merged_count;
                if output[i].has_hint {
                    output[i].section.heading = format!(
                        "{} (and {} more)",
                        output[i].first_heading,
                        output[i].merged_count - 1
                    );
                } else {
                    output[i].section.heading = format!(
                        "Pages {}–{}",
                        output[i].section.page_start, output[i].section.page_end
                    );
                }
                continue;
            } else if i > 0
                && output[i - 1].section.page_end + 1 == output[i].section.page_start
                && (output[i].section.page_end - output[i - 1].section.page_start + 1) <= 10
            {
                let curr = output.remove(i);
                output[i - 1].section.page_end = curr.section.page_end;
                output[i - 1].merged_count += curr.merged_count;
                if output[i - 1].has_hint {
                    output[i - 1].section.heading = format!(
                        "{} (and {} more)",
                        output[i - 1].first_heading,
                        output[i - 1].merged_count - 1
                    );
                } else {
                    output[i - 1].section.heading = format!(
                        "Pages {}–{}",
                        output[i - 1].section.page_start,
                        output[i - 1].section.page_end
                    );
                }
                continue;
            }
        }
        i += 1;
    }
    // Many headings are worth keeping, so a long outline never refuses on its
    // own: neighbours merge until the guide fits the limit.
    condense(output, MAX_SECTIONS).ok_or_else(too_many_sections)
}

/// Merge neighbouring sections until at most `limit` remain, keeping the first
/// heading of every group. Order, contiguity and the chosen runs all survive:
/// two sections from different runs are never merged, so a selection of more
/// than `limit` separate runs is the one case with no legal plan.
fn condense(sections: Vec<PlannedSection>, limit: usize) -> Option<Vec<Section>> {
    let mut runs: Vec<Vec<PlannedSection>> = Vec::new();
    for planned in sections {
        match runs.last_mut() {
            Some(run)
                if run.last().is_some_and(|last| {
                    last.section.page_end + 1 == planned.section.page_start
                }) =>
            {
                run.push(planned)
            }
            _ => runs.push(vec![planned]),
        }
    }
    if runs.len() > limit {
        return None;
    }
    // Every run keeps at least one section. Spare sections go to the run whose
    // groups would otherwise be the largest, so no section swallows a chapter.
    let mut groups = vec![1usize; runs.len()];
    let mut spare = limit - runs.len();
    while spare > 0 {
        let Some(widest) = widest_group(&runs, &groups) else {
            break;
        };
        groups[widest] += 1;
        spare -= 1;
    }
    let mut manifest = Vec::with_capacity(limit);
    for (run, &parts) in runs.iter().zip(&groups) {
        let mut at = 0;
        for group in 0..parts {
            let size = run.len() / parts + usize::from(group < run.len() % parts);
            manifest.push(merged(&run[at..at + size]));
            at += size;
        }
    }
    for (index, section) in manifest.iter_mut().enumerate() {
        section.id = format!("section-{:02}", index + 1);
    }
    Some(manifest)
}

/// The run that still has sections left to split and forms the largest groups.
fn widest_group(runs: &[Vec<PlannedSection>], groups: &[usize]) -> Option<usize> {
    let mut widest = None;
    for (index, run) in runs.iter().enumerate() {
        if groups[index] >= run.len() {
            continue;
        }
        let size = run.len().div_ceil(groups[index]);
        if widest.map_or(true, |(largest, _)| size > largest) {
            widest = Some((size, index));
        }
    }
    widest.map(|(_, index)| index)
}

/// A merged group keeps the first heading; a group with no bookmark heading
/// restates the pages it now covers.
fn merged(group: &[PlannedSection]) -> Section {
    let mut section = group[0].section.clone();
    if let Some(last) = group.last() {
        section.page_end = last.section.page_end;
    }
    let total_count: usize = group.iter().map(|p| p.merged_count).sum();
    section.heading = match (group[0].has_hint, total_count) {
        (false, _) => format!("Pages {}–{}", section.page_start, section.page_end),
        (true, 1) => group[0].first_heading.clone(),
        (true, count) => format!("{} (and {} more)", group[0].first_heading, count - 1),
    };
    section
}

fn source(
    root: &Path,
    request: &SectionRequest,
    model: &str,
    recipe: Recipe,
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
    // lopdf's existing bookmark helper provides page starts with their outline
    // level. A handbook bookmarks almost every page, so only the outer levels
    // become boundaries: the next level joins only while the outline still
    // leaves the guide within the section limit for these pages. Prefer the
    // outer heading at duplicate starts and derive nonoverlapping ranges once.
    let mut levels: BTreeMap<usize, Vec<(u32, String)>> = BTreeMap::new();
    if let Ok(toc) = document.get_toc() {
        for entry in toc.toc {
            if let Ok(page) = u32::try_from(entry.page) {
                if page > 0 && page <= total && !entry.title.trim().is_empty() {
                    levels
                        .entry(entry.level)
                        .or_default()
                        .push((page, entry.title));
                }
            }
        }
    }
    let chosen = (
        request.chosen_pages.first().copied().unwrap_or(1),
        request.chosen_pages.last().copied().unwrap_or(total),
    );
    let headings_at = |level: usize| {
        levels.get(&level).map_or(0, |entries| {
            entries
                .iter()
                .filter(|(page, _)| *page >= chosen.0 && *page <= chosen.1)
                .count()
        })
    };
    let mut starts: BTreeMap<u32, String> = BTreeMap::new();
    if let Some(outer) = levels.keys().next().copied() {
        let inner = if headings_at(outer) + headings_at(outer + 1) <= MAX_SECTIONS {
            outer + 1
        } else {
            outer
        };
        for level in outer..=inner {
            let Some(entries) = levels.get(&level) else {
                continue;
            };
            for (page, title) in entries {
                starts.entry(*page).or_insert(title.clone());
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
    let manifest = plan_for(recipe.planner, &request.chosen_pages, &hints)?;
    let selected = crate::pdf::selected_bytes(&bytes, &request.chosen_pages)?;
    if model.starts_with("claude-") {
        crate::provider::claude::check_size(selected.len() as u64)?;
    } else {
        check_size("application/pdf", selected.len() as u64)?;
    }
    let mut loaded = LoadedSource::new(selected, "application/pdf", &request.relative_path);
    loaded.page_count = Some(request.chosen_pages.len() as u32);
    let identity = Identity {
        material_id: request.material_id.clone(),
        relative_path: request.relative_path.clone(),
        original_sha256: calculate_sha256(&bytes),
        selected_sha256: loaded.content_sha256.clone(),
        chosen_pages: request.chosen_pages.clone(),
        planner_version: recipe.planner.into(),
        manifest,
        model: model.into(),
        prompt_version: recipe.prompt.into(),
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
        queue_state: None,
        identity,
        results,
        activations: vec![],
        timing: Value::Null,
        supersedes: None,
        prepared_file: None,
    }
}

pub(crate) fn queue_study_guide_at(
    root: &Path,
    req: &SectionRequest,
    choice: ModelChoice,
) -> Result<String, SectionError> {
    let (identity, _) = source(
        root,
        req,
        AnyProvider::selected(root).models(choice.into()).0,
        CURRENT,
    )?;
    let mut draft = new_draft(identity);
    draft.queue_state = Some(QueueState::WaitingForHer);
    gemini_jobs::with(root, |j| {
        j.queue_sections(
            &req.material_id,
            &req.relative_path,
            &draft.identity.selected_sha256,
            req.base_revision.as_deref(),
            req.request_id.as_deref(),
            serde_json::to_value(&draft).map_err(|e| e.to_string())?,
        )
    })
    .map_err(Into::into)
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
        || d.identity.manifest.len() > MAX_SECTIONS
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
/// Length asked of the model for one basic guide part: a 2–3 sentence
/// overview (~400 characters) plus 6–10 topic headings with 2–4 short bullets
/// each (~450–650 a topic) is about 3,000–7,000 characters, so 8,000 fits the
/// largest without inviting long paragraphs. Validation still accepts up to
/// study_sets::MAX_BODY.
const REQUESTED_BODY_CHARS: usize = 8_000;
/// Output tokens for one part: the answer is about 2,000–2,500 tokens, and
/// Gemini 3.x counts its thinking on up to 150 pages in the same allowance,
/// so 16,384 leaves room for both (the old 8,192 risked a cut-off answer).
const PART_OUTPUT_TOKENS: u32 = 16_384;
/// The length the earlier, longer prompt asked for (older drafts only).
const LEGACY_BODY_CHARS: usize = 12_000;
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
    // Some model answers double-escape newlines inside the JSON body.
    let body = if !a.body.contains(['\n', '\r']) {
        a.body.replace("\\r\\n", "\n").replace("\\n", "\n")
    } else {
        a.body
    };
    let mut source_pages = a.source_pages;
    source_pages.sort_unstable();
    source_pages.dedup();
    source_pages.retain(|p| *p >= s.page_start && *p <= s.page_end && chosen.contains(p));
    source_pages.truncate(10);
    // The prompt asks for at most REQUESTED_BODY_CHARS; models sometimes run
    // over, so accept anything the study set itself can store.
    if body.trim().is_empty()
        || body.chars().count() > crate::study_sets::MAX_BODY
        || source_pages.is_empty()
    {
        return Err(
            "The section answer or its source pages were invalid; earlier sections are kept."
                .into(),
        );
    }
    let mut content = ResultBody {
        body,
        source_pages,
        content_digest: String::new(),
        model: model.into(),
    };
    content.content_digest = digest(&content);
    Ok(content)
}
/// Study kits use the same section validator, so a guide that runs over the
/// requested 8,000 characters is kept up to what a study set can store
/// (study_sets::MAX_BODY), exactly like a guide part.
pub(super) fn validate_basic_kit_guide(
    value: &Value,
    pages: &[u32],
    model: &str,
) -> Result<(String, Vec<u32>), String> {
    let section = Section {
        id: "study-kit".into(),
        heading: "Study guide".into(),
        page_start: 1,
        page_end: pages.last().copied().unwrap_or(0),
    };
    let result =
        validate_section(&section, &value.to_string(), pages, model).map_err(|e| e.message)?;
    Ok((result.body, result.source_pages))
}

fn request_body(section: &Section, identity: &Identity, part: Value) -> Value {
    let mapping: Vec<_> = identity
        .chosen_pages
        .iter()
        .enumerate()
        .filter(|(_, p)| **p >= section.page_start && **p <= section.page_end)
        .map(|(i, p)| json!({"pdfPage":i+1,"sourcePage":p}))
        .collect();
    let helper = if identity.model.starts_with("claude-") {
        "Claude"
    } else {
        "Gemini"
    };
    let prompt = if identity.prompt_version == LEGACY_PROMPT {
        format!("{LEGACY_PROMPT}: Write only section {} ({}) from the attached PDF. Read ONLY these selected PDF pages and cite their original sourcePage numbers: {}. Do not discuss other pages. Use only supported facts; do not invent procedures or regulations. Return JSON with body (nonempty Markdown, at most {LEGACY_BODY_CHARS} characters) and sourcePages (ordered unique original source page numbers actually used). This is a {helper} study aid to check against current FAA material and her instructor.", section.id, section.heading, json!(mapping))
    } else {
        let number = identity
            .manifest
            .iter()
            .position(|s| s.id == section.id)
            .map_or(1, |i| i + 1);
        let what = match identity.manifest.len() {
            1 => format!("a study guide for the attached PDF ({})", section.heading),
            n => format!(
                "part {number} of {n} ({}) of a study guide for the attached PDF",
                section.heading
            ),
        };
        format!("{PROMPT}: Write {what}. Read ONLY these selected PDF pages and cite their original sourcePage numbers: {}. Do not discuss other pages. Use only supported facts; do not invent procedures or regulations. Keep it basic for a beginner, like a short chat answer: a 2–3 sentence overview, then one Markdown ### heading per main topic or chapter (about 6–10 topics), each with 2–4 short bullets in plain words. Explain each technical term in plain words the first time it appears (e.g. precession, aneroid). No long paragraphs. Return JSON with body (nonempty Markdown, at most {REQUESTED_BODY_CHARS} characters) and sourcePages (ordered unique original source page numbers actually used). This is a {helper} study aid to check against current FAA material and her instructor.", json!(mapping))
    };
    let tokens = if identity.prompt_version == LEGACY_PROMPT {
        8192
    } else {
        PART_OUTPUT_TOKENS
    };
    json!({"contents":[{"role":"user","parts":[{"text":prompt},part]}],"generationConfig":{"responseMimeType":"application/json","maxOutputTokens":tokens,"responseSchema":crate::provider::AnyProvider::default().translate_schema(&crate::provider::schemas::section())}})
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
        summary: format!(
            "{} study aid. Check against current FAA material and your instructor.",
            if produced_by(d).starts_with("claude-") {
                "Claude"
            } else {
                "Gemini"
            }
        ),
        sections,
        flashcards: vec![],
        source_notes: format!(
            "Source SHA-256: {}; selected PDF SHA-256: {}; sections: {}",
            d.identity.original_sha256,
            d.identity.selected_sha256,
            json!(provenance)
        ),
        model: produced_by(d),
    })
}
/// The model that wrote most sections (ties go to the one that is not the
/// frozen primary, so a fallback is never labelled as the stronger model).
/// Each section's own model stays in the provenance above.
fn produced_by(d: &Draft) -> String {
    let mut counts: Vec<(&str, usize)> = Vec::new();
    for c in d.results.values().filter_map(|r| r.content.as_ref()) {
        match counts.iter_mut().find(|(m, _)| *m == c.model) {
            Some((_, n)) => *n += 1,
            None => counts.push((&c.model, 1)),
        }
    }
    counts
        .into_iter()
        .max_by_key(|(m, n)| (*n, *m != d.identity.model))
        .map_or_else(|| d.identity.model.clone(), |(m, _)| m.to_string())
}

pub(super) async fn activate(
    ctx: &GenContext<'_>,
    root: &Path,
    req: &SectionRequest,
    id: Option<&str>,
    hook: Hook<'_>,
    started: Hook<'_>,
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
    if let Some(old) = old.as_ref() {
        let owner = if old.identity.model.starts_with("claude-") {
            crate::provider::ProviderId::Claude
        } else {
            crate::provider::ProviderId::Gemini
        };
        if owner != ctx.provider.id() {
            let name = owner.name();
            return Err(SectionError::native(&format!("This draft was started with {name}. Use {name} in Settings to continue it, or discard it and start a new one. Your finished work is kept.")));
        }
    }
    let recipe = old.as_ref().map_or(CURRENT, |d| recipe_for(&d.identity));
    let (identity, selected) = source(root, req, ctx.primary(), recipe)?;
    if let Some(old) = old.as_ref() {
        if old.identity != identity {
            return Err(identity_mismatch_error(&old.identity, &identity));
        }
    }
    let id = match id {
        Some(id) => id.to_string(),
        None => admit(root, req, &new_draft(identity.clone()))?,
    };
    ctx.budget
        .section_generation_limit(generating_seconds(recipe));
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
    // Publish the id only after cancellation can be observed, like as_job_with.
    started(&id);
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
            if d.queue_state.is_some() {
                d.queue_state = Some(QueueState::Running);
            }
            store(root, &id, &d)?;
            let (path, job) = (root.to_path_buf(), id.clone());
            if !ctx.budget.enable_stages(Arc::new(move |timing| {
                gemini_jobs::with(&path, |j| j.checkpoint_timing(&job, timing.clone()).is_ok())
            })) {
                return Err(gemini_budget::CHECKPOINT_FAILED.into());
            }
            let lease = if ctx.provider.id() == crate::provider::ProviderId::Claude {
                crate::provider::claude::check_source(&selected)?;
                None
            } else {
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
                Some(lease)
            };
            // Once a section falls back, the rest of this run stays on the
            // fallback: one switch per run, so it cannot drain the spare sends.
            let mut model = ctx.primary();
            for (index, section) in identity.manifest.iter().enumerate() {
                if read_draft(root, &id)?.results[&section.id].status == Status::Complete {
                    continue;
                }
                if source(root, req, ctx.primary(), recipe)?.0 != identity {
                    return Err(SectionError::source());
                }
                if !ctx.current() || lease.as_ref().is_some_and(|lease| !lease.is_current()) {
                    return Err(gemini_files::STALE_CONTEXT.into());
                }
                hook("before-reservation");
                let (path, job, unit) = (root.to_path_buf(), id.clone(), section.id.clone());
                ctx.budget
                    .allocate_with(Arc::new(move || reserve(&path, &job, &unit)));
                let body = request_body(
                    section,
                    &identity,
                    ctx.provider
                        .source_part(&selected, lease.as_ref().map(|l| l.prepared())),
                );
                // No earlier answer appears in this request body.
                (ctx.say)(match identity.manifest.len() {
                    1 => "Gemini is writing your study guide…".to_string(),
                    n => format!("Writing part {} of {n}: {}…", index + 1, section.heading),
                });
                let content = section_generate(
                    ctx,
                    &body,
                    section,
                    &identity.chosen_pages,
                    &mut model,
                    hook,
                )
                .await?;
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
                (ctx.say)(match identity.manifest.len() {
                    1 => "Study guide written.".to_string(),
                    n => format!("Part {} of {n} saved.", index + 1),
                });
                if !ctx.budget.can_continue() {
                    return Err(gemini_cancel::CANCELLED.into());
                }
            }
            if let Some(lease) = lease {
                ctx.cache
                    .finish_admitted(lease, ctx.http, ctx.api_key, ctx.budget)
                    .await;
            }
        }
        if source(root, req, ctx.primary(), recipe)?.0 != identity {
            return Err(SectionError::source());
        }
        let answer = assembly(&read_draft(root, &id)?)?;
        Ok(answer)
    };
    let outcome = match gemini_cancel::Cancellable::new(
        ctx.budget.run(work),
        registration.token.clone(),
    )
    .await
    {
        Ok(Ok(outcome)) => outcome,
        _ if !ctx.budget.can_continue() || registration.token.is_cancelled() => {
            Err(gemini_cancel::CANCELLED.into())
        }
        _ => {
            ctx.budget.categorize("time limit reached");
            Err(SectionError::new(
                    "GUIDE_PAUSED",
                    "This took longer than 15 minutes, so Her Flight Deck paused. Your finished sections are kept — Try again to continue.",
                ))
        }
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
            if let Ok(mut d) = read_draft(root, &id) {
                if d.queue_state.is_some() {
                    d.queue_state = Some(QueueState::Paused);
                    let _ = store(root, &id, &d);
                }
            }
            gemini_jobs::with(root, |j| j.failed(&id, &error.message))?;
            running.id = None;
            Err(error)
        }
    }
}

// Reservations still bound sends to three per section and two extra per guide.
async fn section_generate(
    ctx: &GenContext<'_>,
    body: &Value,
    section: &Section,
    pages: &[u32],
    model: &mut &'static str,
    hook: Hook<'_>,
) -> Result<ResultBody, SectionError> {
    let mut shape_retried = false;
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
        let retry_after = match generate_once(ctx, model, body)
            .await
            .map_err(|e| e.message)?
        {
            Attempt::Answered(raw) => {
                ctx.budget.reset_stage(Stage::Validating);
                ctx.budget.validation_checkpoint()?;
                let validated = ctx
                    .extract_text(&raw)
                    .map_err(|e| SectionError::native(&e))
                    .and_then(|text| {
                        validate_section(section, &text, pages, model)
                            .map_err(|e| SectionError::native(&e.message))
                    });
                ctx.budget.validation_checkpoint()?;
                match validated {
                    Ok(content) => return Ok(content),
                    Err(error) => {
                        if shape_retried || attempt == 3 {
                            return Err(error);
                        }
                        shape_retried = true;
                        if ctx.primary() != ctx.fallback()
                            && ctx.choice == ModelChoice::MostCapable
                            && *model != ctx.fallback()
                        {
                            *model = ctx.fallback();
                            (ctx.say)(ctx.choice.fallback_notice().to_string());
                        }
                        continue;
                    }
                }
            }
            Attempt::Refused {
                status,
                body,
                retry_after,
            } => {
                if ctx.provider.id() == crate::provider::ProviderId::Claude {
                    if !matches!(status, 408 | 429 | 500 | 502 | 503 | 504 | 529) {
                        return Err(SectionError::native(
                            &crate::provider::claude::error_message(status),
                        ));
                    }
                    retry_after
                } else {
                    if has_invalid_key_reason(&body) {
                        return Err(SectionError::native(&describe_refusal(
                            RefusalContext::Generation,
                            status,
                            &body,
                            model,
                        )));
                    }
                    if status == 429 && is_lasting_quota(&body) {
                        return Err(SectionError::native(&quota_message()));
                    }
                    let access_fallback = status == 403 && !has_invalid_key_reason(&body);
                    let can_fallback = ctx.choice == ModelChoice::MostCapable
                        && *model != ctx.fallback()
                        && (access_fallback || status == 404 || is_retryable(status));
                    if can_fallback && attempt < 3 {
                        *model = ctx.fallback();
                        (ctx.say)(ctx.choice.fallback_notice().to_string());
                        if access_fallback || status == 404 {
                            continue;
                        }
                    } else if !is_retryable(status) {
                        return Err(SectionError::native(&describe_refusal(
                            RefusalContext::Generation,
                            status,
                            &body,
                            model,
                        )));
                    }
                    retry_after
                }
            }
            Attempt::Lost(lost @ (Lost::NoAnswerInTime | Lost::AnswerCutShort)) => {
                return Err(SectionError::native(&lost_message_for(
                    lost,
                    ctx.budget,
                    ctx.provider,
                )));
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
    if ctx.provider.id() == crate::provider::ProviderId::Claude {
        return Err(SectionError::native(&format!(
            "{} Your finished sections are kept.",
            crate::provider::claude::error_message(529)
        )));
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
    let (identity, _) = source(
        root,
        req,
        AnyProvider::selected(root).models(choice.into()).0,
        CURRENT,
    )?;
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
    let (identity, _) = source(root, &request, &d.identity.model, recipe_for(&d.identity))?;
    if identity != d.identity {
        return Err(identity_mismatch_error(&d.identity, &identity).into());
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
pub async fn queue_study_guide(
    app: AppHandle,
    request: SectionRequest,
) -> Result<String, SectionError> {
    let root = app_root(&app)?;
    let id = queue_study_guide_at(&root, &request, load_choice(&root))?;
    let _ = app.emit(
        JOB_EVENT,
        JobChanged {
            id: id.clone(),
            stage: JobStage::Interrupted,
        },
    );
    Ok(id)
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
    let epoch = prepared_sources().epoch();
    let provider = AnyProvider::selected(&root);
    let key = if complete {
        String::new()
    } else {
        stored_key_for(&root, provider)?
    };
    let http = generation_client().map_err(|error| {
        if provider.id() == crate::provider::ProviderId::Claude {
            "Could not start the connection to Claude.".to_string()
        } else {
            error
        }
    })?;
    let reporter = reporter_for(&app, &request.material_id, JobKind::StudyAid);
    reporter.follow(&budget);
    let say = |m| reporter.say(provider.wording(m));
    let ctx = GenContext {
        provider,
        http: &http,
        base: provider.base(),
        api_key: &key,
        choice: load_choice(&root),
        cache: prepared_sources(),
        epoch,
        budget: &budget,
        say: &say,
    };
    activate(&ctx, &root, &request, job_id.as_deref(), &|_| {}, &|id| {
        reporter.started(id)
    })
    .await
    .map_err(|mut error| {
        error.message = provider.wording(error.message);
        error
    })
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
