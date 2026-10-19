//! The derived, content-addressed cache (OFFLINE-01 proposal §4.3).
//!
//! `content-cache.db` sits beside the database but outside the backup
//! archive. Entries are keyed by the SHA-256 of a file's bytes and the
//! extractor version, so a restore or rollback can never make one wrong:
//! a material simply looks up the hash of whatever file it has now. Losing
//! the cache only costs re-extraction. Anything doubtful is deleted and
//! rebuilt rather than trusted.
//!
//! Schema 2 adds the offline search index (OFFLINE-02 design §5):
//! `search_passage` holds the canonical text of every eligible page, and
//! `passage_fts` is an FTS5 index over it, kept in step by triggers.

use super::inspect::Outcome;
use super::supervisor::Extraction;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use unicode_normalization::UnicodeNormalization;

pub const CACHE_FILE: &str = "content-cache.db";
/// Bump when extraction output can change; old entries then simply miss.
pub const EXTRACTOR_VERSION: i64 = 1;
const SCHEMA: &str = "2";

/// Snippet match markers (design §6.3). Canonical text never contains them,
/// so every marker in a snippet came from FTS5.
pub const MARK_START: char = '\u{E000}';
pub const MARK_END: char = '\u{E001}';

/// The one canonical form of searchable text (design §3.1): NFKC, control
/// characters as spaces, snippet markers removed. The index, its rebuild,
/// deletes and snippets all use this text; `page_text` keeps the original.
pub fn canonical(text: &str) -> String {
    text.nfkc()
        .filter(|c| *c != MARK_START && *c != MARK_END)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

/// Cache files already validated by this process (design §5): the full
/// FTS integrity check runs once per process, at first open.
pub(crate) type FileIdentity = (u64, Option<std::time::SystemTime>);

pub(crate) fn file_identity(path: &Path) -> Option<FileIdentity> {
    let meta = std::fs::metadata(path).ok()?;
    #[cfg(unix)]
    let inode = std::os::unix::fs::MetadataExt::ino(&meta);
    #[cfg(not(unix))]
    let inode = 0;
    Some((inode, meta.created().ok()))
}

fn validated() -> &'static Mutex<HashMap<PathBuf, FileIdentity>> {
    static SEEN: OnceLock<Mutex<HashMap<PathBuf, FileIdentity>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Per-outcome page counts for one extracted file.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    pub text: u32,
    pub blank: u32,
    pub image_only: u32,
    pub text_unreadable: u32,
    pub unknown: u32,
    pub failed: u32,
}

impl Counts {
    pub fn pages(&self) -> u32 {
        self.text + self.blank + self.image_only + self.text_unreadable + self.unknown + self.failed
    }
    fn add(&mut self, outcome: Outcome) {
        match outcome {
            Outcome::Text => self.text += 1,
            Outcome::Blank => self.blank += 1,
            Outcome::ImageOnly => self.image_only += 1,
            Outcome::TextUnreadable => self.text_unreadable += 1,
            Outcome::Unknown => self.unknown += 1,
            Outcome::Failed => self.failed += 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Summary {
    Complete(Counts),
    /// The whole file could not be processed; a privacy-safe code.
    Failed(String),
}

pub struct Cache {
    conn: Connection,
}

fn outcome_name(o: Outcome) -> &'static str {
    match o {
        Outcome::Text => "text",
        Outcome::Blank => "blank",
        Outcome::ImageOnly => "image_only",
        Outcome::TextUnreadable => "text_unreadable",
        Outcome::Unknown => "unknown",
        Outcome::Failed => "failed",
    }
}

fn outcome_from(name: &str) -> Option<Outcome> {
    Some(match name {
        "text" => Outcome::Text,
        "blank" => Outcome::Blank,
        "image_only" => Outcome::ImageOnly,
        "text_unreadable" => Outcome::TextUnreadable,
        "unknown" => Outcome::Unknown,
        "failed" => Outcome::Failed,
        _ => return None,
    })
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

impl Cache {
    /// Open the cache in `root`, replacing it if it is missing, from another
    /// schema, marked incomplete or fails SQLite's integrity check.
    pub fn open(root: &Path) -> Result<Self, String> {
        let path = root.join(CACHE_FILE);
        if let Ok(conn) = Connection::open(&path) {
            if Self::trustworthy(&path, &conn) && Self::validate_once(&path, &conn) {
                Self::configure(&conn);
                return Ok(Self { conn });
            }
        }
        Self::dispose(&path);
        validated()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&path);
        let conn = Connection::open(&path).map_err(|_| "cache_open".to_string())?;
        Self::create(&conn).map_err(|_| "cache_create".to_string())?;
        Self::configure(&conn);
        validated()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(path.clone(), file_identity(&path).ok_or("cache_open")?);
        Ok(Self { conn })
    }

    /// WAL, so a search reads while a publish writes (design §5).
    fn configure(conn: &Connection) {
        let _ = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0));
        let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
    }

    /// The FTS index agrees with its external content: the check with
    /// `rank = 1` compares the two.
    pub(crate) fn fts_consistent(conn: &Connection) -> bool {
        conn.execute(
            "INSERT INTO passage_fts(passage_fts, rank) VALUES ('integrity-check', 1)",
            [],
        )
        .is_ok()
    }

    /// At first open in this process: check the index against its content,
    /// rebuild it once if it disagrees, and give up (dispose) if that fails.
    fn validate_once(path: &Path, conn: &Connection) -> bool {
        let mut seen = validated().lock().unwrap_or_else(|e| e.into_inner());
        let identity = file_identity(path);
        if identity.is_some() && seen.get(path).copied() == identity {
            return true;
        }
        let ok = Self::fts_consistent(conn) || {
            conn.execute_batch(
                "BEGIN; INSERT INTO passage_fts(passage_fts) VALUES ('rebuild'); COMMIT;",
            )
            .is_ok()
                && Self::fts_consistent(conn)
        };
        if ok {
            if let Some(identity) = identity {
                seen.insert(path.to_path_buf(), identity);
            }
        } else {
            let _ = conn.execute_batch("ROLLBACK;");
        }
        ok
    }

    /// Compare complete object definitions, not just schema version/counts.
    /// A valid FTS index today cannot prove a missing trigger will index the
    /// next publish. This small catalog check also runs on memoized opens.
    fn schema_matches(conn: &Connection) -> bool {
        type Objects = Vec<(String, String, String)>;
        fn objects(conn: &Connection) -> rusqlite::Result<Objects> {
            let mut stmt = conn.prepare(
                "SELECT type, name, sql FROM sqlite_master
                WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
            )?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect()
        }
        static EXPECTED: OnceLock<Option<Objects>> = OnceLock::new();
        let expected = EXPECTED.get_or_init(|| {
            let reference = Connection::open_in_memory().ok()?;
            Self::create(&reference).ok()?;
            objects(&reference).ok()
        });
        let Some(expected) = expected else {
            return false;
        };
        objects(conn).is_ok_and(|actual| actual == *expected)
    }

    fn trustworthy(path: &Path, conn: &Connection) -> bool {
        let meta = |key: &str| -> Option<String> {
            conn.query_row("SELECT value FROM cache_meta WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .ok()
        };
        if meta("schema").as_deref() != Some(SCHEMA)
            || meta("state").as_deref() != Some("complete")
            || !Self::schema_matches(conn)
        {
            return false;
        }
        // Full database + FTS validation belongs to first open per process,
        // not every material-readiness check or first search connection.
        // Replacing the file invalidates the memo; state/schema are always read.
        let identity = file_identity(path);
        let already_validated = identity.is_some()
            && validated()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(path)
                .copied()
                == identity;
        already_validated
            || conn
                .query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0))
                .ok()
                .as_deref()
                == Some("ok")
    }

    fn dispose(path: &Path) {
        for p in [
            path.to_path_buf(),
            sibling(path, "-wal"),
            sibling(path, "-shm"),
            sibling(path, "-journal"),
        ] {
            let _ = std::fs::remove_file(p);
        }
    }

    fn create(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "BEGIN;
             DROP TABLE IF EXISTS cache_meta;
             DROP TABLE IF EXISTS extraction;
             DROP TABLE IF EXISTS page_text;
             DROP TABLE IF EXISTS passage_fts;
             DROP TABLE IF EXISTS search_passage;
             CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE extraction (
               content_sha256 TEXT NOT NULL, extractor_version INTEGER NOT NULL,
               status TEXT NOT NULL CHECK (status IN ('complete', 'failed')),
               error TEXT, pages INTEGER NOT NULL,
               text INTEGER NOT NULL, blank INTEGER NOT NULL, image_only INTEGER NOT NULL,
               text_unreadable INTEGER NOT NULL, unknown INTEGER NOT NULL, failed INTEGER NOT NULL,
               PRIMARY KEY (content_sha256, extractor_version));
             CREATE TABLE page_text (
               content_sha256 TEXT NOT NULL, extractor_version INTEGER NOT NULL,
               page_index INTEGER NOT NULL, outcome TEXT NOT NULL, text TEXT NOT NULL, error TEXT,
               PRIMARY KEY (content_sha256, extractor_version, page_index));
             CREATE TABLE search_passage (
               id INTEGER PRIMARY KEY,
               content_sha256 TEXT NOT NULL, extractor_version INTEGER NOT NULL,
               page_index INTEGER NOT NULL, text TEXT NOT NULL,
               UNIQUE (content_sha256, extractor_version, page_index));
             CREATE VIRTUAL TABLE passage_fts USING fts5(
               text, content='search_passage', content_rowid='id',
               tokenize='unicode61 remove_diacritics 2');
             CREATE TRIGGER search_passage_ai AFTER INSERT ON search_passage BEGIN
               INSERT INTO passage_fts(rowid, text) VALUES (new.id, new.text);
             END;
             CREATE TRIGGER search_passage_ad AFTER DELETE ON search_passage BEGIN
               INSERT INTO passage_fts(passage_fts, rowid, text) VALUES ('delete', old.id, old.text);
             END;
             CREATE TRIGGER search_passage_au BEFORE UPDATE ON search_passage BEGIN
               SELECT RAISE(ABORT, 'search_passage rows are immutable');
             END;
             INSERT INTO cache_meta VALUES ('schema', '2'), ('state', 'complete');
             COMMIT;",
        )
    }

    /// Record a complete extraction for its content hash, atomically.
    pub fn publish(&mut self, extraction: &Extraction) -> Result<(), String> {
        let mut counts = Counts::default();
        for page in &extraction.pages {
            counts.add(page.outcome);
        }
        let tx = self.conn.transaction().map_err(|_| "cache_write")?;
        Self::clear(&tx, &extraction.sha256).map_err(|_| "cache_write")?;
        tx.execute(
            "INSERT INTO extraction VALUES (?1, ?2, 'complete', NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                extraction.sha256,
                EXTRACTOR_VERSION,
                counts.pages(),
                counts.text,
                counts.blank,
                counts.image_only,
                counts.text_unreadable,
                counts.unknown,
                counts.failed
            ],
        )
        .map_err(|_| "cache_write")?;
        for page in &extraction.pages {
            tx.execute(
                "INSERT INTO page_text VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    extraction.sha256,
                    EXTRACTOR_VERSION,
                    page.index,
                    outcome_name(page.outcome),
                    page.text,
                    page.error
                ],
            )
            .map_err(|_| "cache_write")?;
            // Only readable text becomes a search passage (design §4.1).
            if page.outcome == Outcome::Text {
                tx.execute(
                    "INSERT INTO search_passage (content_sha256, extractor_version, page_index, text)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        extraction.sha256,
                        EXTRACTOR_VERSION,
                        page.index,
                        canonical(&page.text)
                    ],
                )
                .map_err(|_| "cache_write")?;
            }
        }
        tx.commit().map_err(|_| "cache_write".to_string())
    }

    /// Record that a file's bytes could not be processed at all.
    pub fn publish_failure(&mut self, sha256: &str, code: &str) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|_| "cache_write")?;
        Self::clear(&tx, sha256).map_err(|_| "cache_write")?;
        tx.execute(
            "INSERT INTO extraction VALUES (?1, ?2, 'failed', ?3, 0, 0, 0, 0, 0, 0, 0)",
            params![sha256, EXTRACTOR_VERSION, code],
        )
        .map_err(|_| "cache_write")?;
        tx.commit().map_err(|_| "cache_write".to_string())
    }

    /// Remove a hash's entries. Passages go first: their delete trigger
    /// hands FTS the exact text that was indexed (design §5).
    fn clear(tx: &rusqlite::Transaction<'_>, sha256: &str) -> rusqlite::Result<()> {
        tx.execute(
            "DELETE FROM search_passage WHERE content_sha256 = ?1 AND extractor_version = ?2",
            params![sha256, EXTRACTOR_VERSION],
        )?;
        tx.execute(
            "DELETE FROM page_text WHERE content_sha256 = ?1 AND extractor_version = ?2",
            params![sha256, EXTRACTOR_VERSION],
        )?;
        tx.execute(
            "DELETE FROM extraction WHERE content_sha256 = ?1 AND extractor_version = ?2",
            params![sha256, EXTRACTOR_VERSION],
        )?;
        Ok(())
    }

    pub fn summary(&self, sha256: &str) -> Option<Summary> {
        Self::summary_from(&self.conn, sha256).ok().flatten()
    }

    /// Read coverage on the search request's WAL snapshot.
    pub fn summary_from(conn: &Connection, sha256: &str) -> rusqlite::Result<Option<Summary>> {
        conn.query_row(
            "SELECT status, error, text, blank, image_only, text_unreadable, unknown, failed
                 FROM extraction WHERE content_sha256 = ?1 AND extractor_version = ?2",
            params![sha256, EXTRACTOR_VERSION],
            |r| {
                let status: String = r.get(0)?;
                if status == "failed" {
                    let code: Option<String> = r.get(1)?;
                    return Ok(Summary::Failed(code.unwrap_or_else(|| "failed".into())));
                }
                Ok(Summary::Complete(Counts {
                    text: r.get(2)?,
                    blank: r.get(3)?,
                    image_only: r.get(4)?,
                    text_unreadable: r.get(5)?,
                    unknown: r.get(6)?,
                    failed: r.get(7)?,
                }))
            },
        )
        .optional()
    }

    /// One page's outcome and text, for the search work that follows.
    pub fn page(&self, sha256: &str, index: u32) -> Option<(Outcome, String)> {
        self.conn
            .query_row(
                "SELECT outcome, text FROM page_text
                 WHERE content_sha256 = ?1 AND extractor_version = ?2 AND page_index = ?3",
                params![sha256, EXTRACTOR_VERSION, index],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()
            .ok()
            .flatten()
            .and_then(|(o, t)| outcome_from(&o).map(|o| (o, t)))
    }

    /// Remove up to `limit` entries whose hash no material references any
    /// more. Returns how many were removed.
    pub fn prune(&mut self, keep: &HashSet<String>, limit: usize) -> Result<usize, String> {
        let stale: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT DISTINCT content_sha256 FROM extraction")
                .map_err(|_| "cache_read")?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|_| "cache_read")?;
            rows.filter_map(Result::ok)
                .filter(|h| !keep.contains(h))
                .take(limit)
                .collect()
        };
        let tx = self.conn.transaction().map_err(|_| "cache_write")?;
        for hash in &stale {
            tx.execute(
                "DELETE FROM search_passage WHERE content_sha256 = ?1",
                [hash],
            )
            .map_err(|_| "cache_write")?;
            tx.execute("DELETE FROM page_text WHERE content_sha256 = ?1", [hash])
                .map_err(|_| "cache_write")?;
            tx.execute("DELETE FROM extraction WHERE content_sha256 = ?1", [hash])
                .map_err(|_| "cache_write")?;
        }
        tx.commit().map_err(|_| "cache_write")?;
        Ok(stale.len())
    }
}

#[cfg(test)]
mod tests {
    use super::super::supervisor::PageResult;
    use super::*;

    fn temp() -> PathBuf {
        // A counter as well as the time: parallel tests can read the same
        // clock value, and must never share a folder.
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "hfd-cache-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn page(index: u32, outcome: Outcome, text: &str) -> PageResult {
        PageResult {
            index,
            outcome,
            text: text.into(),
            error: None,
        }
    }

    fn extraction(sha: &str) -> Extraction {
        Extraction {
            peak_bytes: 0,
            sha256: sha.into(),
            pages: vec![
                page(1, Outcome::Text, "metar"),
                page(2, Outcome::ImageOnly, ""),
                page(3, Outcome::Blank, ""),
            ],
        }
    }

    #[test]
    fn publish_then_read_back_by_content_hash() {
        let root = temp();
        let mut cache = Cache::open(&root).unwrap();
        let sha = "a".repeat(64);
        assert_eq!(cache.summary(&sha), None);
        cache.publish(&extraction(&sha)).unwrap();
        let Some(Summary::Complete(c)) = cache.summary(&sha) else {
            panic!()
        };
        assert_eq!((c.text, c.image_only, c.blank, c.pages()), (1, 1, 1, 3));
        assert_eq!(cache.page(&sha, 1), Some((Outcome::Text, "metar".into())));
        drop(cache);
        let reopened = Cache::open(&root).unwrap();
        assert!(
            reopened.summary(&sha).is_some(),
            "a complete cache survives reopening"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn republishing_replaces_rather_than_duplicates() {
        let root = temp();
        let mut cache = Cache::open(&root).unwrap();
        let sha = "b".repeat(64);
        cache.publish(&extraction(&sha)).unwrap();
        cache.publish_failure(&sha, "encrypted").unwrap();
        assert_eq!(
            cache.summary(&sha),
            Some(Summary::Failed("encrypted".into()))
        );
        assert_eq!(cache.page(&sha, 1), None);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn untrustworthy_caches_are_disposed_and_rebuilt() {
        for poison in ["state", "schema", "garbage"] {
            let root = temp();
            let sha = "c".repeat(64);
            {
                let mut cache = Cache::open(&root).unwrap();
                cache.publish(&extraction(&sha)).unwrap();
                match poison {
                    "state" => cache
                        .conn
                        .execute(
                            "UPDATE cache_meta SET value = 'building' WHERE key = 'state'",
                            [],
                        )
                        .map(|_| ()),
                    "schema" => cache
                        .conn
                        .execute("UPDATE cache_meta SET value = '0' WHERE key = 'schema'", [])
                        .map(|_| ()),
                    _ => Ok(()),
                }
                .unwrap();
            }
            if poison == "garbage" {
                std::fs::write(root.join(CACHE_FILE), b"not a database at all").unwrap();
            }
            let cache = Cache::open(&root).unwrap();
            assert_eq!(
                cache.summary(&sha),
                None,
                "{poison}: doubtful cache was rebuilt empty"
            );
            let _ = std::fs::remove_dir_all(root);
        }
    }

    #[test]
    fn prune_removes_only_unreferenced_hashes_within_its_limit() {
        let root = temp();
        let mut cache = Cache::open(&root).unwrap();
        let (keep, gone1, gone2) = ("d".repeat(64), "e".repeat(64), "f".repeat(64));
        for sha in [&keep, &gone1, &gone2] {
            cache.publish(&extraction(sha)).unwrap();
        }
        let keep_set: HashSet<String> = [keep.clone()].into();
        assert_eq!(cache.prune(&keep_set, 1).unwrap(), 1);
        assert_eq!(cache.prune(&keep_set, 10).unwrap(), 1);
        assert!(cache.summary(&keep).is_some());
        assert!(cache.summary(&gone1).is_none() && cache.summary(&gone2).is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    /* ---------------- search index (OFFLINE-02 design §5) ---------------- */

    fn hits(cache: &Cache, query: &str) -> Vec<(String, u32)> {
        let mut stmt = cache
            .conn
            .prepare(
                "SELECT p.content_sha256, p.page_index FROM passage_fts f
                 JOIN search_passage p ON p.id = f.rowid
                 WHERE passage_fts MATCH ?1 ORDER BY p.content_sha256, p.page_index",
            )
            .unwrap();
        stmt.query_map([query], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn doc(sha: &str, pages: &[(Outcome, &str)]) -> Extraction {
        Extraction {
            peak_bytes: 0,
            sha256: sha.into(),
            pages: pages
                .iter()
                .enumerate()
                .map(|(i, (o, t))| page(i as u32 + 1, *o, t))
                .collect(),
        }
    }

    fn consistent(cache: &Cache) -> bool {
        Cache::fts_consistent(&cache.conn)
    }

    #[test]
    fn canonical_text_is_nfkc_without_controls_or_markers() {
        assert_eq!(canonical("\u{FB01}nal"), "final");
        assert_eq!(canonical("ＡＢＣ１２"), "ABC12");
        assert_eq!(canonical("a\u{0}b\tc\u{85}d"), "a b c d");
        assert_eq!(canonical("x\u{E000}y\u{E001}z"), "xyz");
        assert_eq!(canonical("café"), "café");
    }

    #[test]
    fn only_text_pages_become_passages() {
        let root = temp();
        let mut cache = Cache::open(&root).unwrap();
        let sha = "c".repeat(64);
        cache
            .publish(&doc(
                &sha,
                &[
                    (Outcome::Text, "crosswind landing"),
                    (Outcome::TextUnreadable, "crosswind garbage"),
                    (Outcome::Unknown, "crosswind maybe"),
                    (Outcome::Failed, "crosswind failed"),
                ],
            ))
            .unwrap();
        assert_eq!(hits(&cache, "crosswind"), vec![(sha.clone(), 1)]);
        assert!(consistent(&cache));
        // The FTS rebuild re-reads only eligible passages.
        cache
            .conn
            .execute(
                "INSERT INTO passage_fts(passage_fts) VALUES ('rebuild')",
                [],
            )
            .unwrap();
        assert_eq!(hits(&cache, "crosswind"), vec![(sha, 1)]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn every_write_path_keeps_the_index_exact() {
        let root = temp();
        let mut cache = Cache::open(&root).unwrap();
        let (a, b) = ("d".repeat(64), "e".repeat(64));
        // Publish.
        cache
            .publish(&doc(
                &a,
                &[
                    (Outcome::Text, "density altitude"),
                    (Outcome::Text, "metar"),
                ],
            ))
            .unwrap();
        cache
            .publish(&doc(&b, &[(Outcome::Text, "density chart")]))
            .unwrap();
        assert!(consistent(&cache));
        assert_eq!(
            hits(&cache, "density"),
            vec![(a.clone(), 1), (b.clone(), 1)]
        );
        // Replacement: the old text is gone, the new text is found.
        cache
            .publish(&doc(
                &a,
                &[(Outcome::Text, "isogonic line"), (Outcome::ImageOnly, "")],
            ))
            .unwrap();
        assert!(consistent(&cache));
        assert_eq!(hits(&cache, "density"), vec![(b.clone(), 1)]);
        assert_eq!(hits(&cache, "metar"), vec![]);
        assert_eq!(hits(&cache, "isogonic"), vec![(a.clone(), 1)]);
        // Failure replaces a complete extraction.
        cache.publish_failure(&a, "encrypted").unwrap();
        assert!(consistent(&cache));
        assert_eq!(hits(&cache, "isogonic"), vec![]);
        // Prune drops an unreferenced hash.
        cache
            .publish(&doc(&a, &[(Outcome::Text, "isogonic again")]))
            .unwrap();
        let keep: HashSet<String> = [a.clone()].into_iter().collect();
        assert_eq!(cache.prune(&keep, 10).unwrap(), 1);
        assert!(consistent(&cache));
        assert_eq!(hits(&cache, "density"), vec![]);
        assert_eq!(hits(&cache, "isogonic"), vec![(a, 1)]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn passages_are_immutable() {
        let root = temp();
        let mut cache = Cache::open(&root).unwrap();
        cache
            .publish(&doc(&"f".repeat(64), &[(Outcome::Text, "pitot tube")]))
            .unwrap();
        assert!(cache
            .conn
            .execute("UPDATE search_passage SET text = 'other'", [])
            .is_err());
        assert!(consistent(&cache));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn passage_ids_survive_vacuum() {
        let root = temp();
        let mut cache = Cache::open(&root).unwrap();
        let (a, b) = ("1".repeat(64), "2".repeat(64));
        cache
            .publish(&doc(&a, &[(Outcome::Text, "alpha")]))
            .unwrap();
        cache
            .publish(&doc(&b, &[(Outcome::Text, "bravo")]))
            .unwrap();
        cache.publish_failure(&a, "malformed").unwrap();
        let before: i64 = cache
            .conn
            .query_row("SELECT id FROM search_passage", [], |r| r.get(0))
            .unwrap();
        cache.conn.execute_batch("VACUUM").unwrap();
        let after: i64 = cache
            .conn
            .query_row("SELECT id FROM search_passage", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, after);
        assert!(consistent(&cache));
        assert_eq!(hits(&cache, "bravo"), vec![(b, 1)]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn an_inconsistent_index_is_rebuilt_at_first_open() {
        let root = temp();
        let sha = "3".repeat(64);
        {
            let mut cache = Cache::open(&root).unwrap();
            cache
                .publish(&doc(&sha, &[(Outcome::Text, "magneto check")]))
                .unwrap();
            // Corrupt the index: remove the entry with the wrong text.
            let id: i64 = cache
                .conn
                .query_row("SELECT id FROM search_passage", [], |r| r.get(0))
                .unwrap();
            cache
                .conn
                .execute(
                    "INSERT INTO passage_fts(passage_fts, rowid, text) VALUES ('delete', ?1, 'other words')",
                    [id],
                )
                .unwrap();
            assert!(!consistent(&cache));
        }
        // A new process would validate again.
        validated().lock().unwrap().remove(&root.join(CACHE_FILE));
        let cache = Cache::open(&root).unwrap();
        assert!(consistent(&cache));
        assert_eq!(hits(&cache, "magneto"), vec![(sha.clone(), 1)]);
        assert!(cache.summary(&sha).is_some(), "rebuilt, not disposed");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_corrupt_database_is_disposed() {
        let root = temp();
        let sha = "4".repeat(64);
        {
            let mut cache = Cache::open(&root).unwrap();
            cache
                .publish(&doc(&sha, &[(Outcome::Text, "carburetor ice")]))
                .unwrap();
        }
        validated().lock().unwrap().remove(&root.join(CACHE_FILE));
        let path = root.join(CACHE_FILE);
        let _ = std::fs::remove_file(sibling(&path, "-wal"));
        let _ = std::fs::remove_file(sibling(&path, "-shm"));
        std::fs::write(&path, b"not a database at all").unwrap();
        let cache = Cache::open(&root).unwrap();
        assert_eq!(cache.summary(&sha), None);
        assert!(consistent(&cache));
        let _ = std::fs::remove_dir_all(root);
    }

    /// Run by `a_kill_mid_publish_keeps_the_last_committed_index`: publish
    /// inside a transaction, signal, and hang until killed.
    #[test]
    #[ignore]
    fn helper_hang_mid_publish() {
        let Ok(root) = std::env::var("HFD_TEST_CACHE_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let mut cache = Cache::open(&root).unwrap();
        let tx = cache.conn.transaction().unwrap();
        Cache::clear(&tx, &"5".repeat(64)).unwrap();
        tx.execute(
            "INSERT INTO search_passage (content_sha256, extractor_version, page_index, text)
             VALUES (?1, ?2, 1, 'half written')",
            params!["5".repeat(64), EXTRACTOR_VERSION],
        )
        .unwrap();
        std::fs::write(root.join("ready"), b"").unwrap();
        std::thread::sleep(std::time::Duration::from_secs(60));
    }

    #[cfg(unix)]
    #[test]
    fn a_kill_mid_publish_keeps_the_last_committed_index() {
        let root = temp();
        let sha = "5".repeat(64);
        {
            let mut cache = Cache::open(&root).unwrap();
            cache
                .publish(&doc(&sha, &[(Outcome::Text, "committed words")]))
                .unwrap();
        }
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "extraction::cache::tests::helper_hang_mid_publish",
                "--nocapture",
            ])
            .env("HFD_TEST_CACHE_ROOT", &root)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let start = std::time::Instant::now();
        while !root.join("ready").exists() {
            assert!(
                start.elapsed().as_secs() < 30,
                "helper never got mid-publish"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        child.kill().unwrap();
        child.wait().unwrap();
        validated().lock().unwrap().remove(&root.join(CACHE_FILE));
        let cache = Cache::open(&root).unwrap();
        assert!(consistent(&cache));
        assert_eq!(hits(&cache, "committed"), vec![(sha.clone(), 1)]);
        assert_eq!(hits(&cache, "half"), vec![]);
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn missing_or_changed_index_triggers_cannot_be_trusted_after_reopen() {
        for poison in ["missing", "changed"] {
            let root = temp();
            let sha = "9".repeat(64);
            {
                let mut cache = Cache::open(&root).unwrap();
                cache
                    .publish(&doc(&sha, &[(Outcome::Text, "original wind")]))
                    .unwrap();
                cache
                    .conn
                    .execute_batch("DROP TRIGGER search_passage_ai")
                    .unwrap();
                if poison == "changed" {
                    cache.conn.execute_batch("CREATE TRIGGER search_passage_ai AFTER INSERT ON search_passage BEGIN SELECT 1; END;").unwrap();
                }
                assert!(
                    consistent(&cache),
                    "current rows still agree; integrity alone does not test future writes"
                );
            }
            let mut reopened = Cache::open(&root).unwrap();
            reopened
                .publish(&doc(&sha, &[(Outcome::Text, "replacement crosswind")]))
                .unwrap();
            assert_eq!(
                hits(&reopened, "crosswind"),
                vec![(sha, 1)],
                "{poison} trigger silently lost new text"
            );
            assert!(consistent(&reopened));
            let _ = std::fs::remove_dir_all(root);
        }
    }
}
