//! Offline search over prepared documents (OFFLINE-02a). The contract is
//! docs/OFFLINE_02_SEARCH_DESIGN_2026-10-19.md; section numbers below refer
//! to it.
//!
//! What she types is parsed into words and phrases and quoted as FTS5
//! string literals, so nothing she types is query syntax (§3). A search runs
//! on its own thread and read-only connection, one at a time, with a newer
//! request superseding the older and a deadline enforced both between steps
//! and inside SQLite (§6.2). Responses are bounded in count, text and bytes
//! (§6.3). Nothing here reaches a provider.

use super::cache::{canonical, MARK_END, MARK_START};
use rusqlite::{params, Connection, ErrorCode, InterruptHandle, OpenFlags};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

pub const MAX_QUERY_CHARS: usize = 200;
pub const MAX_TERMS: usize = 8;
pub const MAX_TERM_CHARS: usize = 64;
pub const MAX_MATERIALS: usize = 5000;
pub const PAGE_GROUPS: usize = 20;
pub const PASSAGES_PER_GROUP: usize = 3;
pub const MAX_OFFSET: usize = 200;
pub const CANDIDATE_LIMIT: usize = 2000;
pub const SNIPPET_CHARS: usize = 240;
pub const LABEL_CHARS: usize = 120;
pub const MAX_RESPONSE_BYTES: usize = 65_536;
pub const DEADLINE: Duration = Duration::from_secs(2);
pub const TICK: Duration = Duration::from_millis(10);

/* ------------------------------------------------------------------ */
/* Query parsing (§3)                                                  */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Term {
    Word(String),
    Phrase(String),
}

impl Term {
    fn text(&self) -> &str {
        match self {
            Term::Word(t) | Term::Phrase(t) => t,
        }
    }
}

/// Why a search didn't run or didn't finish. `code()` is what the UI gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stop {
    QueryTooLong,
    TooManyTerms,
    TermTooLong,
    EmptyQuery,
    TooManyMaterials,
    OffsetTooDeep,
    Timeout,
    Superseded,
    Failed,
}

impl Stop {
    pub fn code(&self) -> &'static str {
        match self {
            Stop::QueryTooLong => "query_too_long",
            Stop::TooManyTerms => "too_many_terms",
            Stop::TermTooLong => "term_too_long",
            Stop::EmptyQuery => "empty_query",
            Stop::TooManyMaterials => "too_many_materials",
            Stop::OffsetTooDeep => "offset_too_deep",
            Stop::Timeout => "timeout",
            Stop::Superseded => "superseded",
            Stop::Failed => "search_failed",
        }
    }
}

/// A term the tokenizer would index at least one word of.
fn indexable(term: &str) -> bool {
    term.chars().any(char::is_alphanumeric)
}

/// Parse what she typed (§3): NFKC first, then quoted phrases and
/// whitespace-separated words. An unmatched quote is ordinary text.
pub fn parse(query: &str) -> Result<Vec<Term>, Stop> {
    let text = canonical(query);
    if text.chars().count() > MAX_QUERY_CHARS {
        return Err(Stop::QueryTooLong);
    }
    let mut terms = Vec::new();
    let mut rest = text.as_str();
    while let Some(open) = rest.find('"') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('"') else {
            break;
        };
        terms.extend(
            rest[..open]
                .split_whitespace()
                .map(|w| Term::Word(w.into())),
        );
        let phrase = after[..close]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !phrase.is_empty() {
            terms.push(Term::Phrase(phrase));
        }
        rest = &after[close + 1..];
    }
    terms.extend(rest.split_whitespace().map(|w| Term::Word(w.into())));
    terms.retain(|t| indexable(t.text()));
    if terms.is_empty() {
        return Err(Stop::EmptyQuery);
    }
    if terms.len() > MAX_TERMS {
        return Err(Stop::TooManyTerms);
    }
    if terms
        .iter()
        .any(|t| t.text().chars().count() > MAX_TERM_CHARS)
    {
        return Err(Stop::TermTooLong);
    }
    Ok(terms)
}

/// The FTS5 expression: every term a string literal, all required.
pub fn match_expression(terms: &[Term]) -> String {
    terms
        .iter()
        .map(|t| format!("\"{}\"", t.text().replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/* ------------------------------------------------------------------ */
/* Bounded text (§6.3)                                                 */
/* ------------------------------------------------------------------ */

/// Clip a label to `max` characters, with an ellipsis if cut.
pub fn clip_label(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Clip a snippet to `max` visible characters. Markers don't count, are
/// always paired, and a stray one is dropped; a mark cut by the clip is
/// closed.
pub fn clip_snippet(s: &str, max: usize) -> String {
    let mut out = String::new();
    let mut open = false;
    let mut shown = 0;
    let total = s
        .chars()
        .filter(|c| *c != MARK_START && *c != MARK_END)
        .count();
    let budget = if total > max {
        max.saturating_sub(1)
    } else {
        max
    };
    for c in s.chars() {
        match c {
            MARK_START if !open => {
                out.push(c);
                open = true;
            }
            MARK_END if open => {
                out.push(c);
                open = false;
            }
            MARK_START | MARK_END => {}
            _ => {
                if shown == budget {
                    break;
                }
                out.push(c);
                shown += 1;
            }
        }
    }
    // A mark opened with nothing after it is dropped rather than left empty.
    if open {
        if out.ends_with(MARK_START) {
            out.pop();
        } else {
            out.push(MARK_END);
        }
    }
    if total > max {
        out.push('…');
    }
    out
}

/* ------------------------------------------------------------------ */
/* Requests and responses                                              */
/* ------------------------------------------------------------------ */

/// One material whose current file is verified this session (§4.1).
#[derive(Debug, Clone)]
pub struct Target {
    pub material_id: String,
    pub title: String,
    pub material_type: String,
    pub original_file_name: Option<String>,
    pub added_at: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    pub content_sha256: String,
    pub page_index: u32,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub material_id: String,
    pub title: String,
    pub material_type: String,
    pub original_file_name: Option<String>,
    pub added_at: String,
    pub passages: Vec<Passage>,
}

/// Category counts over the filtered materials (§4.3).
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub searched_documents: u32,
    pub searched_pages: u32,
    pub image_pages: u32,
    pub other_unsearchable_pages: u32,
    pub not_prepared: u32,
    pub not_checked: u32,
    pub preparing: u32,
    pub could_not_prepare: u32,
    pub missing: u32,
    pub not_pdf: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub groups: Vec<Group>,
    pub coverage: Coverage,
    pub next_offset: Option<usize>,
    /// More matches exist than the candidate cap kept (§6.2).
    pub more_beyond_cap: bool,
    /// Passages or groups were dropped to fit the byte bound (§6.3).
    pub trimmed: bool,
}

/// Trim a response to the byte bound (§6.3): passages from the last group,
/// then whole last groups. `next_offset` then points at the first group not
/// shown in full.
pub fn fit(response: &mut Response, offset: usize) {
    loop {
        let bytes = serde_json::to_vec(response)
            .map(|v| v.len())
            .unwrap_or(usize::MAX);
        if bytes <= MAX_RESPONSE_BYTES || response.groups.is_empty() {
            return;
        }
        response.trimmed = true;
        let last = response.groups.len() - 1;
        if response.groups[last].passages.len() > 1 {
            response.groups[last].passages.pop();
        } else {
            response.groups.pop();
        }
        response.next_offset = Some(offset + response.groups.len().min(last));
    }
}

/* ------------------------------------------------------------------ */
/* Cancellation (§6.2)                                                 */
/* ------------------------------------------------------------------ */

/// One request's cancellation state. `cancelled` never clears.
pub struct Control {
    id: u64,
    until: Instant,
    cancelled: AtomicBool,
    superseded: AtomicBool,
}

impl Control {
    pub fn check(&self) -> Result<(), Stop> {
        self.stopped().map_or(Ok(()), Err)
    }

    fn stopped(&self) -> Option<Stop> {
        if self.superseded.load(Ordering::SeqCst) {
            return Some(Stop::Superseded);
        }
        if self.cancelled.load(Ordering::SeqCst) || Instant::now() >= self.until {
            self.cancelled.store(true, Ordering::SeqCst);
            return Some(Stop::Timeout);
        }
        None
    }
}

/// Shared between the search thread and its watchdog.
struct Guard {
    /// The request whose statement is running, if any.
    active: Mutex<Option<u64>>,
    /// The request being served, if any. Cleared when it ends (the timer
    /// is retired), before the next request is admitted.
    current: Mutex<Option<Arc<Control>>>,
    interrupt: Mutex<Option<InterruptHandle>>,
    /// Interrupts issued, for tests.
    interrupts: AtomicU64,
    shutdown: AtomicBool,
}

impl Guard {
    /// One watchdog tick: past its deadline, a request is cancelled, and
    /// its statement interrupted for as long as it is active. A no-op
    /// interrupt before SQLite starts is followed by another next tick.
    fn tick(&self) {
        let current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        let Some(control) = current.as_ref() else {
            return;
        };
        if Instant::now() >= control.until {
            control.cancelled.store(true, Ordering::SeqCst);
        }
        if !control.cancelled.load(Ordering::SeqCst) && !control.superseded.load(Ordering::SeqCst) {
            return;
        }
        let active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if *active == Some(control.id) {
            if let Some(handle) = self
                .interrupt
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                handle.interrupt();
                self.interrupts.fetch_add(1, Ordering::SeqCst);
            }
        }
    }
}

/// Where the search thread can be paused in tests (§6.2 startup race).
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Point {
    /// After `active` is recorded, before the cancellation re-check.
    A,
    /// After the re-check, before SQLite's first step.
    B,
}

/* ------------------------------------------------------------------ */
/* The searcher                                                        */
/* ------------------------------------------------------------------ */

#[cfg(test)]
type PauseHook = Arc<Mutex<Option<Box<dyn Fn(Point, &'static str) + Send>>>>;
#[cfg(test)]
type SetupHook = Arc<Mutex<Option<Box<dyn FnOnce(&mut Searcher) + Send>>>>;

/// The search thread's own read-only connection and its guard.
pub struct Searcher {
    conn: Connection,
    guard: Arc<Guard>,
    #[cfg(test)]
    hook: PauseHook,
    #[cfg(test)]
    extra_where: Option<&'static str>,
    #[cfg(test)]
    stepped: Arc<AtomicBool>,
    #[cfg(test)]
    interrupted: Arc<AtomicBool>,
}

struct Candidate {
    rowid: i64,
    rank: f64,
    sha256: String,
    page_index: u32,
}

fn sql_stop(control: &Control, e: rusqlite::Error) -> Stop {
    if e.sqlite_error_code() == Some(ErrorCode::OperationInterrupted) {
        return control.stopped().unwrap_or(Stop::Timeout);
    }
    Stop::Failed
}

impl Searcher {
    fn open(cache_file: &PathBuf, guard: Arc<Guard>) -> Result<Self, Stop> {
        let conn = Connection::open_with_flags(
            cache_file,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| Stop::Failed)?;
        conn.execute_batch(
            "PRAGMA cache_size = -16384;
             PRAGMA temp_store = FILE;
             CREATE TEMP TABLE IF NOT EXISTS current_sha (
               sha TEXT PRIMARY KEY, sort_title TEXT NOT NULL, sort_id TEXT NOT NULL);",
        )
        .map_err(|_| Stop::Failed)?;
        let _ = conn.busy_timeout(Duration::from_secs(1));
        *guard.interrupt.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(conn.get_interrupt_handle());
        Ok(Self {
            conn,
            guard,
            #[cfg(test)]
            hook: Arc::new(Mutex::new(None)),
            #[cfg(test)]
            extra_where: None,
            #[cfg(test)]
            stepped: Arc::new(AtomicBool::new(false)),
            #[cfg(test)]
            interrupted: Arc::new(AtomicBool::new(false)),
        })
    }

    #[cfg(test)]
    fn pause(&self, point: Point, label: &'static str) {
        if let Some(hook) = self.hook.lock().unwrap().as_ref() {
            hook(point, label);
        }
    }

    /// Run one statement's worth of work under the request's control
    /// (§6.2): `active` is recorded for the watchdog, the request is
    /// re-checked before SQLite starts, and `active` is cleared under the
    /// same mutex as soon as the work ends.
    fn statement<T>(
        &self,
        control: &Control,
        #[allow(unused_variables)] label: &'static str,
        work: impl FnOnce() -> Result<T, Stop>,
    ) -> Result<T, Stop> {
        *self.guard.active.lock().unwrap_or_else(|e| e.into_inner()) = Some(control.id);
        #[cfg(test)]
        self.pause(Point::A, label);
        let result = match control.stopped() {
            Some(stop) => Err(stop),
            None => {
                #[cfg(test)]
                self.pause(Point::B, label);
                work()
            }
        };
        *self.guard.active.lock().unwrap_or_else(|e| e.into_inner()) = None;
        result
    }

    fn candidates(
        &self,
        control: &Control,
        expression: &str,
        limit: Option<usize>,
    ) -> Result<Vec<Candidate>, Stop> {
        #[cfg(test)]
        let extra = self.extra_where.unwrap_or("");
        #[cfg(not(test))]
        let extra = "";
        let sql = format!(
            "SELECT f.rowid, f.rank, p.content_sha256, p.page_index
             FROM passage_fts AS f
             JOIN search_passage AS p ON p.id = f.rowid
             JOIN temp.current_sha AS c ON c.sha = p.content_sha256
             WHERE passage_fts MATCH ?1 AND p.extractor_version = ?3 {extra}
             ORDER BY f.rank, c.sort_title, c.sort_id, p.page_index
             LIMIT ?2"
        );
        let limit = limit.map(|l| l as i64).unwrap_or(-1);
        self.statement(control, "candidates", || {
            #[cfg(test)]
            self.stepped.store(true, Ordering::SeqCst);
            let mut stmt = self.conn.prepare(&sql).map_err(|_| Stop::Failed)?;
            let mut rows = stmt
                .query(params![expression, limit, super::cache::EXTRACTOR_VERSION])
                .map_err(|e| self.note(control, e))?;
            // The first step (where the sort happens) is covered by SQLite
            // interruption; each row after it is checked here too.
            let mut out = Vec::new();
            loop {
                match rows.next() {
                    Ok(Some(r)) => out.push(Candidate {
                        rowid: r.get(0).map_err(|_| Stop::Failed)?,
                        rank: r.get(1).map_err(|_| Stop::Failed)?,
                        sha256: r.get(2).map_err(|_| Stop::Failed)?,
                        page_index: r.get(3).map_err(|_| Stop::Failed)?,
                    }),
                    Ok(None) => return Ok(out),
                    Err(e) => return Err(self.note(control, e)),
                }
                if let Some(stop) = control.stopped() {
                    return Err(stop);
                }
            }
        })
    }

    fn note(&self, control: &Control, e: rusqlite::Error) -> Stop {
        #[cfg(test)]
        if e.sqlite_error_code() == Some(ErrorCode::OperationInterrupted) {
            self.interrupted.store(true, Ordering::SeqCst);
        }
        sql_stop(control, e)
    }

    fn load_targets(&self, control: &Control, targets: &[Target]) -> Result<(), Stop> {
        // The smallest (title, id) among materials sharing a hash orders
        // that hash's passages at the cutoff (§6.2).
        let mut keys: HashMap<&str, (String, &str)> = HashMap::new();
        for t in targets {
            control.check()?;
            let key = (t.title.to_lowercase(), t.material_id.as_str());
            keys.entry(t.sha256.as_str())
                .and_modify(|k| {
                    if key < *k {
                        *k = key.clone();
                    }
                })
                .or_insert(key);
        }
        self.statement(control, "targets", || {
            self.conn
                .execute("DELETE FROM temp.current_sha", [])
                .map_err(|e| self.note(control, e))?;
            let mut insert = self
                .conn
                .prepare("INSERT INTO temp.current_sha VALUES (?1, ?2, ?3)")
                .map_err(|_| Stop::Failed)?;
            for (sha, (title, id)) in &keys {
                control.check()?;
                insert
                    .execute(params![sha, title, id])
                    .map_err(|e| self.note(control, e))?;
            }
            Ok(())
        })
    }

    fn snippet(&self, control: &Control, expression: &str, rowid: i64) -> Result<String, Stop> {
        self.statement(control, "snippet", || {
            self.conn
                .query_row(
                    "SELECT snippet(passage_fts, 0, ?2, ?3, '…', 24)
                     FROM passage_fts WHERE passage_fts MATCH ?1 AND rowid = ?4",
                    params![
                        expression,
                        MARK_START.to_string(),
                        MARK_END.to_string(),
                        rowid
                    ],
                    |r| r.get::<_, String>(0),
                )
                .map(|s| clip_snippet(&s, SNIPPET_CHARS))
                .map_err(|e| self.note(control, e))
        })
    }

    /// Every match, uncapped, in the production order: the untimed
    /// exhaustive check in the measurement plan (§7).
    pub fn exhaustive(
        &self,
        targets: &[Target],
        terms: &[Term],
    ) -> Result<Vec<(String, u32)>, Stop> {
        let control = Control {
            id: 0,
            until: Instant::now() + Duration::from_secs(3600),
            cancelled: AtomicBool::new(false),
            superseded: AtomicBool::new(false),
        };
        self.load_targets(&control, targets)?;
        Ok(self
            .candidates(&control, &match_expression(terms), None)?
            .into_iter()
            .map(|c| (c.sha256, c.page_index))
            .collect())
    }

    /// Coverage, candidates and snippets share a WAL snapshot. A publish or
    /// prune can commit concurrently without changing any row under this request.
    fn resolve_run(&self, control: &Control, resolve: Resolver) -> Result<Response, Stop> {
        control.check()?;
        let _snapshot = self
            .conn
            .unchecked_transaction()
            .map_err(|_| Stop::Failed)?;
        let request = self.statement(control, "resolve", || resolve(control, &self.conn))?;
        control.check()?;
        self.run_inner(
            control,
            &request.targets,
            &request.terms,
            request.offset,
            request.coverage,
        )
    }

    /// One search (§6.2–§6.4), inside the request's snapshot.
    fn run_inner(
        &self,
        control: &Control,
        targets: &[Target],
        terms: &[Term],
        offset: usize,
        coverage: Coverage,
    ) -> Result<Response, Stop> {
        if offset > MAX_OFFSET {
            return Err(Stop::OffsetTooDeep);
        }
        let expression = match_expression(terms);
        self.load_targets(control, targets)?;
        // One sentinel determines whether the cap really dropped a match.
        // It is never expanded, grouped or shown.
        let mut candidates = self.candidates(control, &expression, Some(CANDIDATE_LIMIT + 1))?;
        let more_beyond_cap = candidates.len() > CANDIDATE_LIMIT;
        candidates.truncate(CANDIDATE_LIMIT);

        // Expand each passage to every material with its bytes, after the
        // cut, so duplicates never displace other passages.
        let mut by_sha: HashMap<&str, Vec<&Target>> = HashMap::new();
        for t in targets {
            by_sha.entry(t.sha256.as_str()).or_default().push(t);
        }
        struct Building<'t> {
            target: &'t Target,
            best: f64,
            passages: Vec<&'t Candidate>,
        }
        let mut groups: Vec<Building> = Vec::new();
        let mut index: HashMap<&str, usize> = HashMap::new();
        for c in &candidates {
            if let Some(stop) = control.stopped() {
                return Err(stop);
            }
            for t in by_sha.get(c.sha256.as_str()).into_iter().flatten() {
                let at = *index.entry(t.material_id.as_str()).or_insert_with(|| {
                    groups.push(Building {
                        target: t,
                        best: c.rank,
                        passages: Vec::new(),
                    });
                    groups.len() - 1
                });
                if groups[at].passages.len() < PASSAGES_PER_GROUP {
                    groups[at].passages.push(c);
                }
            }
        }
        groups.sort_by(|a, b| {
            a.best
                .total_cmp(&b.best)
                .then_with(|| {
                    a.target
                        .title
                        .to_lowercase()
                        .cmp(&b.target.title.to_lowercase())
                })
                .then_with(|| a.target.material_id.cmp(&b.target.material_id))
        });

        let end = (offset + PAGE_GROUPS).min(groups.len());
        let next_offset = (end < groups.len() && end <= MAX_OFFSET).then_some(end);
        let mut shown = Vec::new();
        for g in groups.iter().skip(offset).take(end.saturating_sub(offset)) {
            let mut passages = Vec::new();
            for c in &g.passages {
                passages.push(Passage {
                    content_sha256: c.sha256.clone(),
                    page_index: c.page_index,
                    snippet: self.snippet(control, &expression, c.rowid)?,
                });
            }
            shown.push(Group {
                material_id: g.target.material_id.clone(),
                title: clip_label(&g.target.title, LABEL_CHARS),
                material_type: clip_label(&g.target.material_type, LABEL_CHARS),
                original_file_name: g
                    .target
                    .original_file_name
                    .as_deref()
                    .map(|n| clip_label(n, LABEL_CHARS)),
                added_at: clip_label(&g.target.added_at, LABEL_CHARS),
                passages,
            });
        }
        if let Some(stop) = control.stopped() {
            return Err(stop);
        }
        let mut response = Response {
            groups: shown,
            coverage,
            next_offset,
            more_beyond_cap,
            trimmed: false,
        };
        fit(&mut response, offset);
        control.check()?;
        Ok(response)
    }
}

/// Untimed audit tooling only: exercise the production candidate SQL with
/// either its cap or no cap, before measuring bounded commands. No IPC exposes
/// this function. The exhaustive path is required by the frozen measurement plan.
pub fn audit_order(
    cache_file: PathBuf,
    targets: &[Target],
    query: &str,
    capped: bool,
) -> Result<Vec<(String, u32)>, Stop> {
    let host = Host::start(cache_file.clone());
    let searcher = Searcher::open(&cache_file, host.guard.clone())?;
    let control = Control {
        id: 0,
        until: Instant::now() + Duration::from_secs(3600),
        cancelled: AtomicBool::new(false),
        superseded: AtomicBool::new(false),
    };
    let _snapshot = searcher
        .conn
        .unchecked_transaction()
        .map_err(|_| Stop::Failed)?;
    searcher.load_targets(&control, targets)?;
    Ok(searcher
        .candidates(
            &control,
            &match_expression(&parse(query)?),
            capped.then_some(CANDIDATE_LIMIT),
        )?
        .into_iter()
        .map(|c| (c.sha256, c.page_index))
        .collect())
}

/* ------------------------------------------------------------------ */
/* The search thread: admission and supersession (§6.2)                */
/* ------------------------------------------------------------------ */

pub struct Request {
    pub targets: Vec<Target>,
    pub terms: Vec<Term>,
    pub offset: usize,
    pub coverage: Coverage,
}

type Resolver = Box<dyn FnOnce(&Control, &Connection) -> Result<Request, Stop> + Send>;

/// A bounded wait for a submitted request. Admission happens synchronously,
/// before an async command hands the wait to the runtime's blocking pool.
pub struct Ticket {
    control: Arc<Control>,
    answer: mpsc::Receiver<Result<Response, Stop>>,
}

impl Ticket {
    pub fn wait(self) -> Result<Response, Stop> {
        let remaining = self.control.until.saturating_duration_since(Instant::now());
        match self.answer.recv_timeout(remaining) {
            Ok(result) => {
                self.control.check()?;
                result
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.control.cancelled.store(true, Ordering::SeqCst);
                Err(self.control.stopped().unwrap_or(Stop::Timeout))
            }
            Err(_) => Err(Stop::Failed),
        }
    }
}

struct Job {
    control: Arc<Control>,
    resolve: Resolver,
    reply: mpsc::Sender<Result<Response, Stop>>,
}

#[derive(Default)]
struct Slot {
    waiting: Option<Job>,
    running: Option<Arc<Control>>,
    next_id: u64,
    shutdown: bool,
}

/// One search at a time, at most one waiting; a newer request replaces the
/// waiting one and interrupts the running one.
pub struct Host {
    slot: Arc<(Mutex<Slot>, Condvar)>,
    guard: Arc<Guard>,
    deadline: Duration,
    #[cfg(test)]
    pub(crate) searcher_setup: SetupHook,
}

impl Host {
    pub fn start(cache_file: PathBuf) -> Self {
        Self::start_with(cache_file, DEADLINE)
    }

    pub fn start_with(cache_file: PathBuf, deadline: Duration) -> Self {
        let guard = Arc::new(Guard {
            active: Mutex::new(None),
            current: Mutex::new(None),
            interrupt: Mutex::new(None),
            interrupts: AtomicU64::new(0),
            shutdown: AtomicBool::new(false),
        });
        let slot: Arc<(Mutex<Slot>, Condvar)> = Arc::default();
        #[cfg(test)]
        let searcher_setup: SetupHook = Arc::new(Mutex::new(None));
        {
            let guard = guard.clone();
            std::thread::spawn(move || {
                while !guard.shutdown.load(Ordering::SeqCst) {
                    guard.tick();
                    std::thread::sleep(TICK);
                }
            });
        }
        {
            let guard = guard.clone();
            let slot = slot.clone();
            #[cfg(test)]
            let setup = searcher_setup.clone();
            std::thread::spawn(move || {
                let mut searcher: Option<Searcher> = None;
                let mut identity = None;
                loop {
                    let job = {
                        let (lock, wake) = &*slot;
                        let mut s = lock.lock().unwrap_or_else(|e| e.into_inner());
                        loop {
                            if s.shutdown {
                                return;
                            }
                            if let Some(job) = s.waiting.take() {
                                s.running = Some(job.control.clone());
                                break job;
                            }
                            s = wake.wait(s).unwrap_or_else(|e| e.into_inner());
                        }
                    };
                    *guard.current.lock().unwrap_or_else(|e| e.into_inner()) =
                        Some(job.control.clone());
                    // A disposable cache may have been replaced since the last
                    // request. Never keep searching the unlinked old database.
                    let current_identity = super::cache::file_identity(&cache_file);
                    if identity != current_identity {
                        searcher = None;
                    }
                    if searcher.is_none() {
                        // Validation/rebuild is isolated from the extraction executor.
                        // If first-open validation exceeds the request budget, its
                        // ticket still returns timeout and the next request retries.
                        let ready = cache_file
                            .parent()
                            .and_then(|root| super::cache::Cache::open(root).ok());
                        if ready.is_some() && job.control.check().is_ok() {
                            searcher = Searcher::open(&cache_file, guard.clone()).ok();
                            identity = super::cache::file_identity(&cache_file);
                        }
                        #[cfg(test)]
                        if let (Some(s), Some(f)) =
                            (searcher.as_mut(), setup.lock().unwrap().take())
                        {
                            f(s);
                        }
                    }
                    let result = match job.control.check() {
                        Err(stop) => Err(stop),
                        Ok(()) => match &searcher {
                            Some(s) => s.resolve_run(&job.control, job.resolve),
                            None => Err(Stop::Failed),
                        },
                    };
                    // Retire this request's timer before the next is admitted.
                    *guard.current.lock().unwrap_or_else(|e| e.into_inner()) = None;
                    slot.0.lock().unwrap_or_else(|e| e.into_inner()).running = None;
                    let _ = job.reply.send(result);
                }
            });
        }
        Self {
            slot,
            guard,
            deadline,
            #[cfg(test)]
            searcher_setup,
        }
    }

    /// Submit already resolved targets (tests and measurement tooling).
    pub fn search(&self, request: Request) -> Result<Response, Stop> {
        self.submit(Instant::now(), move |_, _| Ok(request)).wait()
    }

    /// Resolve authoritative rows and session stamps on the search thread,
    /// inside the same deadline as SQL, snippets and serialization.
    pub fn submit<F>(&self, entered: Instant, resolve: F) -> Ticket
    where
        F: FnOnce(&Control, &Connection) -> Result<Request, Stop> + Send + 'static,
    {
        let (reply, answer) = mpsc::channel();
        let (lock, wake) = &*self.slot;
        let mut s = lock.lock().unwrap_or_else(|e| e.into_inner());
        s.next_id += 1;
        let control = Arc::new(Control {
            id: s.next_id,
            until: entered + self.deadline,
            cancelled: AtomicBool::new(false),
            superseded: AtomicBool::new(false),
        });
        if let Some(old) = s.waiting.take() {
            old.control.superseded.store(true, Ordering::SeqCst);
            let _ = old.reply.send(Err(Stop::Superseded));
        }
        if let Some(running) = &s.running {
            running.superseded.store(true, Ordering::SeqCst);
        }
        s.waiting = Some(Job {
            control: control.clone(),
            resolve: Box::new(resolve),
            reply,
        });
        wake.notify_all();
        Ticket { control, answer }
    }

    pub fn interrupts(&self) -> u64 {
        self.guard.interrupts.load(Ordering::SeqCst)
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.guard.shutdown.store(true, Ordering::SeqCst);
        let (lock, wake) = &*self.slot;
        lock.lock().unwrap_or_else(|e| e.into_inner()).shutdown = true;
        wake.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::super::cache::{Cache, CACHE_FILE};
    use super::super::inspect::Outcome;
    use super::super::supervisor::{Extraction, PageResult};
    use super::*;
    use rusqlite::functions::FunctionFlags;

    fn temp() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "hfd-search-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn sha(n: usize) -> String {
        format!("{n:064x}")
    }

    fn publish(root: &std::path::Path, sha: &str, pages: &[(Outcome, &str)]) {
        let mut cache = Cache::open(root).unwrap();
        cache
            .publish(&Extraction {
                peak_bytes: 0,
                sha256: sha.into(),
                pages: pages
                    .iter()
                    .enumerate()
                    .map(|(i, (o, t))| PageResult {
                        index: i as u32 + 1,
                        outcome: *o,
                        text: t.to_string(),
                        error: None,
                    })
                    .collect(),
            })
            .unwrap();
    }

    fn target(id: &str, title: &str, sha: &str) -> Target {
        Target {
            material_id: id.into(),
            title: title.into(),
            material_type: "handbook".into(),
            original_file_name: Some(format!("{id}.pdf")),
            added_at: "2026-10-19T00:00:00.000Z".into(),
            sha256: sha.into(),
        }
    }

    fn search(
        host: &Host,
        targets: &[Target],
        query: &str,
        offset: usize,
    ) -> Result<Response, Stop> {
        host.search(Request {
            targets: targets.to_vec(),
            terms: parse(query)?,
            offset,
            coverage: Coverage::default(),
        })
    }

    fn pages_of(r: &Response) -> Vec<(String, Vec<u32>)> {
        r.groups
            .iter()
            .map(|g| {
                (
                    g.material_id.clone(),
                    g.passages.iter().map(|p| p.page_index).collect(),
                )
            })
            .collect()
    }

    /* ---------------- parsing (§3) ---------------- */

    #[test]
    fn words_and_phrases_are_literal_and_all_required() {
        assert_eq!(
            parse(r#"crosswind "density  altitude" AND"#).unwrap(),
            vec![
                Term::Word("crosswind".into()),
                Term::Phrase("density altitude".into()),
                Term::Word("AND".into()),
            ]
        );
        assert_eq!(
            match_expression(&parse(r#"NEAR(a b) "x" OR*"#).unwrap()),
            r#""NEAR(a" AND "b)" AND "x" AND "OR*""#
        );
        // An unmatched quote is ordinary text, doubled inside the literal.
        let terms = parse(r#"pitot "static"#).unwrap();
        assert_eq!(
            terms,
            vec![Term::Word("pitot".into()), Term::Word("\"static".into())]
        );
        assert_eq!(match_expression(&terms), r#""pitot" AND """static""#);
    }

    #[test]
    fn queries_are_canonical_and_bounded() {
        assert_eq!(
            parse("\u{FB01}nal").unwrap(),
            vec![Term::Word("final".into())]
        );
        assert_eq!(parse("  ... -- !!"), Err(Stop::EmptyQuery));
        assert_eq!(parse(r#""""#), Err(Stop::EmptyQuery));
        assert_eq!(parse(&"a".repeat(201)), Err(Stop::QueryTooLong));
        assert!(parse(&"a ".repeat(100)).is_err());
        assert_eq!(parse("a b c d e f g h i"), Err(Stop::TooManyTerms));
        assert!(parse("a b c d e f g h").is_ok());
        assert_eq!(parse(&"w".repeat(65)), Err(Stop::TermTooLong));
        assert!(parse(&"w".repeat(64)).is_ok());
    }

    /* ---------------- bounded text (§6.3) ---------------- */

    #[test]
    fn snippets_clip_by_visible_characters_and_keep_marks_paired() {
        let m = |s: &str| s.replace('[', "\u{E000}").replace(']', "\u{E001}");
        assert_eq!(clip_snippet(&m("ab [cd] ef"), 240), m("ab [cd] ef"));
        // A mark cut by the clip is closed.
        assert_eq!(clip_snippet(&m("ab [cdef]"), 5), m("ab [c]…"));
        // A mark that would open on nothing is dropped.
        assert_eq!(clip_snippet(&m("abcd[ef]"), 5), m("abcd…"));
        // Stray markers are removed.
        assert_eq!(clip_snippet(&m("a]b[[c]]d"), 240), m("ab[c]d"));
        let long: String = "漢".repeat(10_000);
        let clipped = clip_snippet(&long, SNIPPET_CHARS);
        assert_eq!(clipped.chars().count(), SNIPPET_CHARS);
        assert_eq!(
            clip_label(&"t".repeat(1000), LABEL_CHARS).chars().count(),
            LABEL_CHARS
        );
    }

    /* ---------------- searching ---------------- */

    #[test]
    fn finds_matches_only_in_current_hashes_and_never_unreadable_pages() {
        let root = temp();
        let (a, b, old) = (sha(1), sha(2), sha(3));
        publish(
            &root,
            &a,
            &[
                (Outcome::Text, "Crosswind landing technique"),
                (Outcome::Text, "metar"),
            ],
        );
        publish(
            &root,
            &b,
            &[
                (Outcome::TextUnreadable, "crosswind garbage"),
                (Outcome::Text, "café crosswind"),
            ],
        );
        publish(&root, &old, &[(Outcome::Text, "crosswind in the old file")]);
        let host = Host::start(root.join(CACHE_FILE));
        let targets = [target("m1", "Handbook", &a), target("m2", "Weather", &b)];
        // BM25 precedes title: the shorter matching page is more relevant.
        let db = Connection::open(root.join(CACHE_FILE)).unwrap();
        let ranks: Vec<f64> = db
            .prepare(
                "SELECT rank FROM passage_fts WHERE passage_fts MATCH 'crosswind' ORDER BY rank",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(ranks[0] < ranks[1]);
        let r = search(&host, &targets, "CROSSWIND", 0).unwrap();
        assert_eq!(
            pages_of(&r),
            vec![("m2".into(), vec![2]), ("m1".into(), vec![1])]
        );
        // Accents fold; phrases are consecutive words.
        assert_eq!(
            pages_of(&search(&host, &targets, "cafe", 0).unwrap()),
            vec![("m2".into(), vec![2])]
        );
        assert_eq!(
            search(&host, &targets, r#""landing crosswind""#, 0)
                .unwrap()
                .groups,
            vec![]
        );
        assert_eq!(
            pages_of(&search(&host, &targets, r#""crosswind landing""#, 0).unwrap()),
            vec![("m1".into(), vec![1])]
        );
        // A deleted material, or one whose file changed, is simply not a target.
        assert_eq!(
            search(&host, &targets[..1], "cafe", 0).unwrap().groups,
            vec![]
        );
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_bytes_hit_every_material_that_has_them() {
        let root = temp();
        let a = sha(7);
        publish(&root, &a, &[(Outcome::Text, "vortex generators")]);
        let host = Host::start(root.join(CACHE_FILE));
        let targets = [target("m1", "Copy B", &a), target("m2", "Copy A", &a)];
        let r = search(&host, &targets, "vortex", 0).unwrap();
        assert_eq!(
            pages_of(&r),
            vec![("m2".into(), vec![1]), ("m1".into(), vec![1])]
        );
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ties_at_the_cutoff_are_decided_by_title_then_id_then_page() {
        let root = temp();
        // 25 materials x 100 identical pages: 2,500 equal-score passages.
        // Titles sort in the opposite order to their hashes.
        let mut targets = Vec::new();
        let page = vec![(Outcome::Text, "tie word here"); 100];
        for i in 0..25 {
            let h = sha(1000 - i);
            publish(&root, &h, &page);
            targets.push(target(&format!("id{i:02}"), &format!("Title {i:02}"), &h));
        }
        // A duplicate of title 19's bytes with a late title: expanded after
        // the cut, it never displaces another passage.
        targets.push(target("zz", "Zulu copy", &sha(1000 - 19)));
        let host = Host::start(root.join(CACHE_FILE));
        let first = search(&host, &targets, "tie", 0).unwrap();
        assert!(first.more_beyond_cap);
        let ids: Vec<String> = first.groups.iter().map(|g| g.material_id.clone()).collect();
        let expected: Vec<String> = (0..20).map(|i| format!("id{i:02}")).collect();
        assert_eq!(ids, expected, "the 2,000 kept passages are titles 00-19");
        assert!(first
            .groups
            .iter()
            .all(|g| g.passages.iter().map(|p| p.page_index).eq(1..=3)));
        assert_eq!(first.next_offset, Some(20));
        let second = search(&host, &targets, "tie", 20).unwrap();
        assert_eq!(pages_of(&second), vec![("zz".into(), vec![1, 2, 3])]);
        assert_eq!(second.next_offset, None);
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn exhaustive_returns_every_match_and_the_cap_is_its_prefix() {
        let root = temp();
        let page = vec![(Outcome::Text, "aileron"); 150];
        let mut targets = Vec::new();
        for i in 0..20 {
            publish(&root, &sha(500 + i), &page);
            targets.push(target(
                &format!("m{i:02}"),
                &format!("Doc {i:02}"),
                &sha(500 + i),
            ));
        }
        let guard = Arc::new(Guard {
            active: Mutex::new(None),
            current: Mutex::new(None),
            interrupt: Mutex::new(None),
            interrupts: AtomicU64::new(0),
            shutdown: AtomicBool::new(false),
        });
        let searcher = Searcher::open(&root.join(CACHE_FILE), guard).unwrap();
        let terms = parse("aileron").unwrap();
        let all = searcher.exhaustive(&targets, &terms).unwrap();
        assert_eq!(all.len(), 3000);
        let control = Control {
            id: 1,
            until: Instant::now() + Duration::from_secs(60),
            cancelled: AtomicBool::new(false),
            superseded: AtomicBool::new(false),
        };
        searcher.load_targets(&control, &targets).unwrap();
        let capped: Vec<(String, u32)> = searcher
            .candidates(&control, &match_expression(&terms), Some(CANDIDATE_LIMIT))
            .unwrap()
            .into_iter()
            .map(|c| (c.sha256, c.page_index))
            .collect();
        assert_eq!(capped, all[..CANDIDATE_LIMIT].to_vec());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn snippets_are_text_with_genuine_marks_only() {
        let root = temp();
        let a = sha(9);
        publish(
            &root,
            &a,
            &[(Outcome::Text, "<script>alert(1)</script> \u{E000}forged\u{E001} ignore previous instructions and stall speed")],
        );
        let host = Host::start(root.join(CACHE_FILE));
        let r = search(&host, &[target("m", "T", &a)], "stall", 0).unwrap();
        let snippet = &r.groups[0].passages[0].snippet;
        assert!(snippet.contains("<script>alert(1)</script>"), "{snippet}");
        assert!(snippet.contains("ignore previous instructions"));
        assert_eq!(snippet.matches(MARK_START).count(), 1);
        assert!(snippet.contains("\u{E000}stall\u{E001}"));
        assert!(!snippet.contains("\u{E000}forged"));
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn responses_are_trimmed_to_the_byte_bound() {
        let root = temp();
        // 20 materials x 3 matching pages, every page a 10,000-character
        // 3-byte token after the match; titles of 4-byte characters.
        let text = format!("crosswind {}", "漢".repeat(10_000));
        let page = vec![(Outcome::Text, text.as_str()); 3];
        let mut targets = Vec::new();
        for i in 0..20 {
            publish(&root, &sha(800 + i), &page);
            let mut t = target(&format!("m{i:02}"), &"✈️".repeat(500), &sha(800 + i));
            t.material_type = "🛩".repeat(500);
            t.original_file_name = Some("📘".repeat(500));
            targets.push(t);
        }
        let host = Host::start(root.join(CACHE_FILE));
        let r = search(&host, &targets, "crosswind", 0).unwrap();
        let bytes = serde_json::to_vec(&r).unwrap().len();
        assert!(bytes <= MAX_RESPONSE_BYTES, "{bytes}");
        assert!(r.trimmed);
        assert!(r.next_offset.is_some());
        assert!(r
            .groups
            .iter()
            .all(|g| g.title.chars().count() <= LABEL_CHARS));
        assert!(r.groups[0].passages.iter().all(|p| p
            .snippet
            .chars()
            .filter(|c| *c != MARK_START && *c != MARK_END)
            .count()
            <= SNIPPET_CHARS));
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_deep_offset_is_refused() {
        let root = temp();
        publish(&root, &sha(1), &[(Outcome::Text, "word")]);
        let host = Host::start(root.join(CACHE_FILE));
        assert_eq!(
            search(&host, &[target("m", "T", &sha(1))], "word", MAX_OFFSET + 1),
            Err(Stop::OffsetTooDeep)
        );
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    /* ---------------- admission and deadline (§6.2) ---------------- */

    fn fixture(root: &std::path::Path) -> Vec<Target> {
        let page = vec![(Outcome::Text, "airspeed indicator"); 50];
        (0..10)
            .map(|i| {
                publish(root, &sha(300 + i), &page);
                target(&format!("m{i}"), &format!("Doc {i}"), &sha(300 + i))
            })
            .collect()
    }

    /// Install a hook on the host's searcher before its first search.
    fn with_searcher(host: &Host, f: impl FnOnce(&mut Searcher) + Send + 'static) {
        *host.searcher_setup.lock().unwrap() = Some(Box::new(f));
    }

    #[test]
    fn a_newer_search_supersedes_the_running_one() {
        let root = temp();
        let targets = fixture(&root);
        let host = Arc::new(Host::start(root.join(CACHE_FILE)));
        let (paused_tx, paused) = mpsc::channel::<()>();
        let (release, release_rx) = mpsc::channel::<()>();
        let release_rx = Mutex::new(release_rx);
        let once = AtomicBool::new(false);
        with_searcher(&host, move |s| {
            *s.hook.lock().unwrap() = Some(Box::new(move |point, label| {
                if point == Point::A && label == "candidates" && !once.swap(true, Ordering::SeqCst)
                {
                    paused_tx.send(()).unwrap();
                    release_rx.lock().unwrap().recv().unwrap();
                }
            }));
        });
        let first = {
            let host = host.clone();
            let targets = targets.clone();
            std::thread::spawn(move || search(&host, &targets, "airspeed", 0))
        };
        paused.recv().unwrap();
        let second = {
            let host = host.clone();
            let targets = targets.clone();
            std::thread::spawn(move || search(&host, &targets, "indicator", 0))
        };
        // Give the second request time to be admitted, then let the first go.
        while host.slot.0.lock().unwrap().waiting.is_none() {
            std::thread::sleep(Duration::from_millis(1));
        }
        release.send(()).unwrap();
        assert_eq!(first.join().unwrap(), Err(Stop::Superseded));
        assert_eq!(second.join().unwrap().unwrap().groups.len(), 10);
        let _ = std::fs::remove_dir_all(root);
    }

    const TEST_DEADLINE: Duration = Duration::from_millis(300);

    #[test]
    fn point_a_a_deadline_before_the_recheck_never_starts_sqlite() {
        let root = temp();
        let targets = fixture(&root);
        let host = Host::start_with(root.join(CACHE_FILE), TEST_DEADLINE);
        let stepped = Arc::new(Mutex::new(None::<Arc<AtomicBool>>));
        let seen = stepped.clone();
        let once = AtomicBool::new(false);
        with_searcher(&host, move |s| {
            *seen.lock().unwrap() = Some(s.stepped.clone());
            *s.hook.lock().unwrap() = Some(Box::new(move |point, label| {
                if point == Point::A && label == "candidates" && !once.swap(true, Ordering::SeqCst)
                {
                    // Hold here until the deadline has certainly passed.
                    std::thread::sleep(TEST_DEADLINE + Duration::from_millis(50));
                }
            }));
        });
        assert_eq!(search(&host, &targets, "airspeed", 0), Err(Stop::Timeout));
        let stepped = stepped.lock().unwrap().clone().unwrap();
        assert!(!stepped.load(Ordering::SeqCst), "no SQLite step ran");
        // The next request runs normally.
        assert_eq!(
            search(&host, &targets, "airspeed", 0).unwrap().groups.len(),
            10
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn point_b_a_later_tick_interrupts_the_running_statement() {
        let root = temp();
        let targets = fixture(&root);
        let host = Host::start_with(root.join(CACHE_FILE), TEST_DEADLINE);
        let interrupted = Arc::new(Mutex::new(None::<Arc<AtomicBool>>));
        let seen = interrupted.clone();
        let guard = host.guard.clone();
        let gate_open = Arc::new(AtomicBool::new(true));
        let gate = gate_open.clone();
        let once = AtomicBool::new(false);
        let at_interrupt = Arc::new(AtomicU64::new(0));
        let recorded = at_interrupt.clone();
        with_searcher(&host, move |s| {
            *seen.lock().unwrap() = Some(s.interrupted.clone());
            s.extra_where = Some("AND hfd_test_gate() = 1");
            let g = guard.clone();
            s.conn
                .create_scalar_function("hfd_test_gate", 0, FunctionFlags::SQLITE_UTF8, move |_| {
                    // Inside the running statement: hold until the watchdog
                    // has issued a second interrupt, which lands while this
                    // statement is provably active.
                    if gate.swap(false, Ordering::SeqCst) {
                        let limit = Instant::now() + Duration::from_secs(2);
                        while g.interrupts.load(Ordering::SeqCst) < 2 {
                            assert!(
                                Instant::now() < limit,
                                "watchdog failed to repeat interrupt"
                            );
                            std::thread::sleep(Duration::from_millis(1));
                        }
                        recorded.store(g.interrupts.load(Ordering::SeqCst), Ordering::SeqCst);
                    }
                    Ok(1)
                })
                .unwrap();
            let g = guard.clone();
            *s.hook.lock().unwrap() = Some(Box::new(move |point, label| {
                if point == Point::B && label == "candidates" && !once.swap(true, Ordering::SeqCst)
                {
                    // After the re-check: wait for the deadline and for the
                    // watchdog's first interrupt, a no-op with no statement
                    // running, before letting SQLite start.
                    let limit = Instant::now() + Duration::from_secs(2);
                    while g.interrupts.load(Ordering::SeqCst) < 1 {
                        assert!(
                            Instant::now() < limit,
                            "watchdog did not acknowledge deadline"
                        );
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            }));
        });
        let started = Instant::now();
        assert_eq!(search(&host, &targets, "airspeed", 0), Err(Stop::Timeout));
        assert!(started.elapsed() <= TEST_DEADLINE + Duration::from_millis(100));
        let interrupted = interrupted.lock().unwrap().clone().unwrap();
        // The caller now receives its timeout without waiting for SQLite.
        // Separately require the running statement to retire within the same
        // 100 ms allowance; this still proves the repeated tick is effective.
        while !interrupted.load(Ordering::SeqCst)
            && started.elapsed() < TEST_DEADLINE + Duration::from_millis(100)
        {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(
            interrupted.load(Ordering::SeqCst),
            "SQLite reported SQLITE_INTERRUPT"
        );
        assert!(
            at_interrupt.load(Ordering::SeqCst) >= 2,
            "a later tick interrupted it"
        );
        // The next request runs normally, gate and all.
        assert_eq!(
            search(&host, &targets, "airspeed", 0).unwrap().groups.len(),
            10
        );
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn snapshot_keeps_candidates_and_snippets_consistent_across_publish() {
        let root = temp();
        let sha = sha(1);
        publish(&root, &sha, &[(Outcome::Text, "crosswind old")]);
        let host = Host::start(root.join(CACHE_FILE));
        let changed = root.clone();
        let hash = sha.clone();
        let once = AtomicBool::new(false);
        with_searcher(&host, move |s| {
            *s.hook.lock().unwrap() = Some(Box::new(move |point, label| {
                if point == Point::A && label == "snippet" && !once.swap(true, Ordering::SeqCst) {
                    publish(&changed, &hash, &[(Outcome::Text, "new different")]);
                }
            }));
        });
        let targets = [target("a", "A", &sha)];
        let r = search(&host, &targets, "crosswind", 0).unwrap();
        assert_eq!(pages_of(&r), vec![("a".into(), vec![1])]);
        assert!(r.groups[0].passages[0].snippet.contains("old"));
        assert!(search(&host, &targets, "crosswind", 0)
            .unwrap()
            .groups
            .is_empty());
        assert_eq!(
            pages_of(&search(&host, &targets, "different", 0).unwrap()),
            vec![("a".into(), vec![1])]
        );
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolution_and_queue_time_share_command_entry_deadline() {
        let root = temp();
        Cache::open(&root).unwrap();
        let host = Host::start_with(root.join(CACHE_FILE), TEST_DEADLINE);
        let called = Arc::new(AtomicBool::new(false));
        let seen = called.clone();
        let ticket = host.submit(Instant::now() - TEST_DEADLINE, move |_, _| {
            seen.store(true, Ordering::SeqCst);
            Err(Stop::Failed)
        });
        assert_eq!(ticket.wait(), Err(Stop::Timeout));
        // A subsequent request completes only after the obsolete job retires.
        assert!(search(&host, &[], "wind", 0).unwrap().groups.is_empty());
        assert!(!called.load(Ordering::SeqCst));
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn newest_waiter_replaces_previous_without_running_its_resolver() {
        let root = temp();
        Cache::open(&root).unwrap();
        let host = Host::start(root.join(CACHE_FILE));
        let (started_tx, started) = mpsc::channel();
        let (release, held) = mpsc::channel();
        let first = host.submit(Instant::now(), move |control, _| {
            started_tx.send(()).unwrap();
            held.recv().unwrap();
            control.check()?;
            Err(Stop::Failed)
        });
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        let second = host.submit(Instant::now(), |_, _| {
            panic!("replaced waiter must never resolve")
        });
        let third = host.submit(Instant::now(), |_, _| {
            Ok(Request {
                targets: vec![],
                terms: parse("wind")?,
                offset: 0,
                coverage: Coverage::default(),
            })
        });
        assert_eq!(second.wait(), Err(Stop::Superseded));
        release.send(()).unwrap();
        assert_eq!(first.wait(), Err(Stop::Superseded));
        assert!(third.wait().unwrap().groups.is_empty());
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn exact_candidate_cap_is_not_reported_as_more_matches() {
        let root = temp();
        let sha = sha(1);
        publish(&root, &sha, &vec![(Outcome::Text, "wind"); CANDIDATE_LIMIT]);
        let host = Host::start(root.join(CACHE_FILE));
        assert!(
            !search(&host, &[target("a", "A", &sha)], "wind", 0)
                .unwrap()
                .more_beyond_cap
        );
        publish(
            &root,
            &sha,
            &vec![(Outcome::Text, "wind"); CANDIDATE_LIMIT + 1],
        );
        assert!(
            search(&host, &[target("a", "A", &sha)], "wind", 0)
                .unwrap()
                .more_beyond_cap
        );
        drop(host);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_replaced_disposable_cache_does_not_leave_an_old_connection_searchable() {
        let root = temp();
        let sha = sha(1);
        publish(&root, &sha, &[(Outcome::Text, "old")]);
        let host = Host::start(root.join(CACHE_FILE));
        let targets = [target("a", "A", &sha)];
        assert_eq!(search(&host, &targets, "old", 0).unwrap().groups.len(), 1);
        // Replace the complete database inode as cache disposal/rebuild would.
        let other = temp();
        publish(&other, &sha, &[(Outcome::Text, "new")]);
        let conn = Connection::open(other.join(CACHE_FILE)).unwrap();
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        drop(conn);
        for suffix in ["-wal", "-shm"] {
            let _ = std::fs::remove_file(root.join(format!("{CACHE_FILE}{suffix}")));
        }
        std::fs::rename(other.join(CACHE_FILE), root.join(CACHE_FILE)).unwrap();
        assert!(search(&host, &targets, "old", 0).unwrap().groups.is_empty());
        assert_eq!(search(&host, &targets, "new", 0).unwrap().groups.len(), 1);
        drop(host);
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(other);
    }
    #[test]
    fn old_extractor_versions_are_not_candidates_even_for_a_current_hash() {
        let root = temp();
        let sha = sha(1);
        publish(&root, &sha, &[(Outcome::Text, "current")]);
        let db = Connection::open(root.join(CACHE_FILE)).unwrap();
        db.execute("INSERT INTO search_passage(content_sha256,extractor_version,page_index,text) VALUES(?1,0,1,'obsolete')",[&sha]).unwrap();
        let host = Host::start(root.join(CACHE_FILE));
        let targets = [target("a", "A", &sha)];
        assert!(search(&host, &targets, "obsolete", 0)
            .unwrap()
            .groups
            .is_empty());
        assert_eq!(
            search(&host, &targets, "current", 0).unwrap().groups.len(),
            1
        );
        drop(host);
        drop(db);
        let _ = std::fs::remove_dir_all(root);
    }
}
