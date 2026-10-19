//! The derived, content-addressed cache (OFFLINE-01 proposal §4.3).
//!
//! `content-cache.db` sits beside the database but outside the backup
//! archive. Entries are keyed by the SHA-256 of a file's bytes and the
//! extractor version, so a restore or rollback can never make one wrong:
//! a material simply looks up the hash of whatever file it has now. Losing
//! the cache only costs re-extraction. Anything doubtful is deleted and
//! rebuilt rather than trusted.

use super::inspect::Outcome;
use super::supervisor::Extraction;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const CACHE_FILE: &str = "content-cache.db";
/// Bump when extraction output can change; old entries then simply miss.
pub const EXTRACTOR_VERSION: i64 = 1;
const SCHEMA: &str = "1";

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
            if Self::trustworthy(&conn) {
                return Ok(Self { conn });
            }
        }
        Self::dispose(&path);
        let conn = Connection::open(&path).map_err(|_| "cache_open".to_string())?;
        Self::create(&conn).map_err(|_| "cache_create".to_string())?;
        Ok(Self { conn })
    }

    fn trustworthy(conn: &Connection) -> bool {
        let meta = |key: &str| -> Option<String> {
            conn.query_row("SELECT value FROM cache_meta WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .ok()
        };
        let integrity: Option<String> = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).ok();
        meta("schema").as_deref() == Some(SCHEMA)
            && meta("state").as_deref() == Some("complete")
            && integrity.as_deref() == Some("ok")
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
             INSERT INTO cache_meta VALUES ('schema', '1'), ('state', 'complete');
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

    fn clear(tx: &rusqlite::Transaction<'_>, sha256: &str) -> rusqlite::Result<()> {
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
        self.conn
            .query_row(
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
            .ok()
            .flatten()
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
        let p = std::env::temp_dir().join(format!(
            "hfd-cache-{}-{}",
            std::process::id(),
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
}
