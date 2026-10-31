//! Startup ownership of the same folder used by SQLite and backups.
//! The handle lives in Tauri state until process exit. Never unlink the lock:
//! another opener must always lock the same inode, even after a crash.
use std::fs::{File, OpenOptions};
use std::path::Path;

const LOCK_FILE: &str = "study-library.lock";
const VERSION_FILE: &str = "last-run-version.txt";
const ALREADY_OPEN: &str = "Her Flight Deck is already open on this Mac. Use the open window.";
const UNAVAILABLE: &str =
    "Her Flight Deck couldn't safely open your study library. Please close the app and try again.";

#[derive(Debug)]
pub(crate) struct LibraryLock {
    _file: File,
}

/// Parse using the same semver type Tauri uses, without another dependency.
/// Build metadata does not affect precedence; prereleases do.
fn check_version(root: &Path, current: &tauri::PackageInfo) -> Result<(), String> {
    let Ok(text) = std::fs::read_to_string(root.join(VERSION_FILE)) else {
        return Ok(());
    };
    let Ok(previous) = text.trim().parse() else {
        return Ok(());
    };
    if current.version.cmp_precedence(&previous).is_lt() {
        return Err(format!(
            "This study library was last used by a newer version of Her Flight Deck ({previous}). Please install that version or newer."
        ));
    }
    Ok(())
}

pub(crate) fn acquire(root: &Path, current: &tauri::PackageInfo) -> Result<LibraryLock, String> {
    // Check before even creating the folder/lock, so a newer library is left
    // byte-for-byte unchanged, including when it has no lock file yet.
    check_version(root, current)?;
    std::fs::create_dir_all(root).map_err(|_| UNAVAILABLE.to_owned())?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(LOCK_FILE))
        .map_err(|_| UNAVAILABLE.to_owned())?;
    file.try_lock().map_err(|error| match error {
        std::fs::TryLockError::WouldBlock => ALREADY_OPEN.to_owned(),
        std::fs::TryLockError::Error(_) => UNAVAILABLE.to_owned(),
    })?;
    let lock = LibraryLock { _file: file };
    // A running copy may have updated the marker between the first check and
    // acquiring ownership. No restore, backup, cleanup or DB work precedes this.
    check_version(root, current)?;
    Ok(lock)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "hfd-single-copy-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn snapshot(&self) -> Vec<(String, Vec<u8>)> {
            let mut entries: Vec<_> = std::fs::read_dir(&self.0)
                .unwrap()
                .map(|entry| {
                    let entry = entry.unwrap();
                    (
                        entry.file_name().to_string_lossy().into_owned(),
                        std::fs::read(entry.path()).unwrap(),
                    )
                })
                .collect();
            entries.sort();
            entries
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn package(version: &str) -> tauri::PackageInfo {
        tauri::PackageInfo {
            name: "synthetic-single-copy".into(),
            version: version.parse().unwrap(),
            authors: "",
            description: "",
            crate_name: "synthetic_single_copy",
        }
    }

    #[test]
    fn version_precedence() {
        let root = Scratch::new();
        for (previous, current, refuses) in [
            ("0.6.6", "0.6.5", true),
            ("0.10.0", "0.9.0", true),
            ("1.0.0", "1.0.0-rc.1", true),
            ("1.0.0-rc.10", "1.0.0-rc.2", true),
            ("0.6.5", "0.6.5", false),
            ("0.6.4", "0.6.5", false),
            ("1.0.0-rc.1", "1.0.0", false),
            ("1.0.0+new", "1.0.0+old", false),
            ("garbage", "0.6.5", false),
            ("", "0.6.5", false),
            (" \n0.6.6\n", "0.6.5", true),
        ] {
            std::fs::write(root.0.join(VERSION_FILE), previous).unwrap();
            assert_eq!(
                check_version(&root.0, &package(current)).is_err(),
                refuses,
                "{previous} / {current}"
            );
        }
        std::fs::remove_file(root.0.join(VERSION_FILE)).unwrap();
        assert!(check_version(&root.0, &package("0.6.5")).is_ok());
        std::fs::write(root.0.join(VERSION_FILE), [0xff]).unwrap();
        assert!(check_version(&root.0, &package("0.6.5")).is_ok());
        std::fs::remove_file(root.0.join(VERSION_FILE)).unwrap();
        std::fs::create_dir(root.0.join(VERSION_FILE)).unwrap();
        assert!(check_version(&root.0, &package("0.6.5")).is_ok());
    }

    #[test]
    fn newer_refusal_writes_nothing() {
        let root = Scratch::new();
        std::fs::write(root.0.join(VERSION_FILE), "9.0.0").unwrap();
        std::fs::write(root.0.join("her-flight-deck.db"), "synthetic untouched DB").unwrap();
        let before = root.snapshot();
        assert_eq!(acquire(&root.0, &package("0.6.5")).unwrap_err(), "This study library was last used by a newer version of Her Flight Deck (9.0.0). Please install that version or newer.");
        assert_eq!(root.snapshot(), before);
    }

    #[test]
    fn lock_refuses_without_writes_and_releases_on_drop() {
        let root = Scratch::new();
        let current = package("0.6.5");
        let first = acquire(&root.0, &current).unwrap();
        std::fs::write(root.0.join(LOCK_FILE), "do not truncate").unwrap();
        std::fs::write(root.0.join("her-flight-deck.db"), "synthetic DB").unwrap();
        let before = root.snapshot();
        assert_eq!(acquire(&root.0, &current).unwrap_err(), ALREADY_OPEN);
        assert_eq!(root.snapshot(), before);
        // Separate QA folders remain independent.
        let qa = Scratch::new();
        let _qa_lock = acquire(&qa.0, &current).unwrap();
        drop(first);
        let _again = acquire(&root.0, &current).unwrap();
        assert_eq!(root.snapshot(), before);
    }
}
