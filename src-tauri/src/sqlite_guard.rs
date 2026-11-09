//! Refuses SQLite file pairs that did not come from this app.
//!
//! RUSTSEC-2026-0459: SQLite older than 3.54 can hand back uninitialised
//! memory when it opens a database next to a `-wal` file whose page size
//! differs from the database's. The bundled SQLite cannot be upgraded yet, so
//! every database that arrives from outside (a backup, a safety copy, a phone
//! archive) is checked here before SQLite ever opens it.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

const WAL_HEADER_BYTES: usize = 32;
const WAL_MAGIC_LE: u32 = 0x377f_0682;
const WAL_MAGIC_BE: u32 = 0x377f_0683;

const DAMAGED: &str = "That backup looks damaged: its database and its log file do not match, so nothing was changed.";

/// The page size a SQLite database header declares (offset 16, big-endian;
/// the stored value 1 means 65536).
pub(crate) fn db_page_size(header: &[u8]) -> Option<u32> {
    let raw = u16::from_be_bytes([*header.get(16)?, *header.get(17)?]);
    Some(if raw == 1 { 65_536 } else { u32::from(raw) })
}

/// The page size a WAL header declares (offset 8, big-endian), or `None` when
/// the header is too short or does not start with a WAL magic number.
pub(crate) fn wal_page_size(header: &[u8]) -> Option<u32> {
    if header.len() < WAL_HEADER_BYTES {
        return None;
    }
    let magic = u32::from_be_bytes(header[0..4].try_into().ok()?);
    if magic != WAL_MAGIC_LE && magic != WAL_MAGIC_BE {
        return None;
    }
    Some(u32::from_be_bytes(header[8..12].try_into().ok()?))
}

fn wal_path(db_path: &Path) -> PathBuf {
    let mut name = db_path.as_os_str().to_os_string();
    name.push("-wal");
    PathBuf::from(name)
}

/// Refuse a database whose `-wal` file does not match it. No `-wal` file, or
/// an empty one (SQLite treats that as no log), passes. Reads only headers.
pub(crate) fn check_wal_pair(db_path: &Path) -> Result<(), String> {
    let wal = wal_path(db_path);
    let Ok(meta) = std::fs::symlink_metadata(&wal) else {
        return Ok(());
    };
    if meta.len() == 0 && meta.is_file() {
        return Ok(());
    }
    let mut wal_header = Vec::with_capacity(WAL_HEADER_BYTES);
    File::open(&wal)
        .and_then(|f| f.take(WAL_HEADER_BYTES as u64).read_to_end(&mut wal_header))
        .map_err(|_| DAMAGED.to_string())?;
    let wal_size = wal_page_size(&wal_header).ok_or_else(|| DAMAGED.to_string())?;

    let mut db_header = Vec::with_capacity(18);
    File::open(db_path)
        .and_then(|f| f.take(18).read_to_end(&mut db_header))
        .map_err(|_| DAMAGED.to_string())?;
    let db_size = db_page_size(&db_header).ok_or_else(|| DAMAGED.to_string())?;

    if db_size == wal_size {
        Ok(())
    } else {
        Err(DAMAGED.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db_header(page: u16) -> Vec<u8> {
        let mut h = vec![0u8; 100];
        h[..16].copy_from_slice(b"SQLite format 3\0");
        h[16..18].copy_from_slice(&page.to_be_bytes());
        h
    }

    fn wal_header(magic: u32, page: u32) -> Vec<u8> {
        let mut h = vec![0u8; WAL_HEADER_BYTES];
        h[0..4].copy_from_slice(&magic.to_be_bytes());
        h[8..12].copy_from_slice(&page.to_be_bytes());
        h
    }

    #[test]
    fn page_size_parsing_handles_the_65536_encoding() {
        assert_eq!(db_page_size(&db_header(4096)), Some(4096));
        assert_eq!(db_page_size(&db_header(1)), Some(65_536));
        assert_eq!(db_page_size(&[0u8; 10]), None);
        assert_eq!(wal_page_size(&wal_header(WAL_MAGIC_LE, 4096)), Some(4096));
        assert_eq!(
            wal_page_size(&wal_header(WAL_MAGIC_BE, 65_536)),
            Some(65_536)
        );
        assert_eq!(wal_page_size(&wal_header(0x1234_5678, 4096)), None);
        assert_eq!(wal_page_size(&wal_header(WAL_MAGIC_LE, 4096)[..31]), None);
    }

    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn pair(db: &[u8], wal: Option<&[u8]>) -> (Dir, PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "hfd-sqlite-guard-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("her-flight-deck.db");
        std::fs::write(&path, db).unwrap();
        if let Some(w) = wal {
            std::fs::write(dir.join("her-flight-deck.db-wal"), w).unwrap();
        }
        (Dir(dir), path)
    }

    #[test]
    fn guard_accepts_matching_missing_and_empty_wal() {
        let (_d, p) = pair(&db_header(4096), None);
        assert!(check_wal_pair(&p).is_ok());
        let (_d, p) = pair(&db_header(4096), Some(&[]));
        assert!(check_wal_pair(&p).is_ok());
        let (_d, p) = pair(&db_header(4096), Some(&wal_header(WAL_MAGIC_LE, 4096)));
        assert!(check_wal_pair(&p).is_ok());
        let (_d, p) = pair(&db_header(1), Some(&wal_header(WAL_MAGIC_BE, 65_536)));
        assert!(check_wal_pair(&p).is_ok());
    }

    #[test]
    fn guard_refuses_mismatch_truncation_bad_magic_and_bad_header() {
        let (_d, p) = pair(&db_header(4096), Some(&wal_header(WAL_MAGIC_LE, 8192)));
        assert!(check_wal_pair(&p).is_err());
        let (_d, p) = pair(
            &db_header(4096),
            Some(&wal_header(WAL_MAGIC_LE, 4096)[..20]),
        );
        assert!(check_wal_pair(&p).is_err());
        let (_d, p) = pair(&db_header(4096), Some(&wal_header(0xdead_beef, 4096)));
        assert!(check_wal_pair(&p).is_err());
        let (_d, p) = pair(&[1, 2, 3], Some(&wal_header(WAL_MAGIC_LE, 4096)));
        assert!(check_wal_pair(&p).is_err());
    }
}
