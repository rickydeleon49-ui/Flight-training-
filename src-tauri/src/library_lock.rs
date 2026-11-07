//! One exclusion lock shared by study-pack import, backup, restore and the
//! Library check (PACK-01 design, I5). There is one process per library (the
//! startup lock plus the single-instance plugin), so an in-process lock keyed
//! by the library folder is enough. Keying by folder keeps parallel tests that
//! use different folders independent without changing what production does.
//!
//! A command takes the lock once, with `try_acquire`, and passes the
//! `&LibraryGuard` to every inner helper. Helpers never lock, so a helper that
//! runs inside another (reconcile inside restore staging) cannot deadlock.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Holder {
    /// Adding a study pack.
    Pack,
    /// Backup, restore or Library check/repair.
    Library,
}

pub(crate) const PACK_BUSY: &str = "A study pack is being added. Try again when it finishes.";
pub(crate) const LIBRARY_BUSY: &str = "A backup or restore is running. Try again in a moment.";

static HELD: Mutex<Option<HashMap<PathBuf, Holder>>> = Mutex::new(None);

fn table() -> MutexGuard<'static, Option<HashMap<PathBuf, Holder>>> {
    HELD.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn key(root: &Path) -> PathBuf {
    root.canonicalize().unwrap_or_else(|_| root.to_path_buf())
}

/// Proof that the caller holds the library lock. Dropping it releases it.
#[derive(Debug)]
pub(crate) struct LibraryGuard {
    key: PathBuf,
    #[allow(dead_code)]
    holder: Holder,
}

impl LibraryGuard {
    #[allow(dead_code)]
    pub(crate) fn holder(&self) -> Holder {
        self.holder
    }

    /// Whether this guard is the lock of that library folder.
    pub(crate) fn covers(&self, root: &Path) -> bool {
        self.key == key(root)
    }
}

impl Drop for LibraryGuard {
    fn drop(&mut self) {
        if let Some(map) = table().as_mut() {
            map.remove(&self.key);
        }
    }
}

/// Take the lock without waiting. Busy gives the one sentence the user sees.
pub(crate) fn try_acquire(root: &Path, holder: Holder) -> Result<LibraryGuard, String> {
    let key = key(root);
    let mut guard = table();
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some(current) = map.get(&key) {
        return Err(match current {
            Holder::Pack => PACK_BUSY,
            Holder::Library => LIBRARY_BUSY,
        }
        .to_string());
    }
    map.insert(key.clone(), holder);
    Ok(LibraryGuard { key, holder })
}

/// Run `work` under the lock. For a backup, restore or Library holder the
/// pack folder is reconciled first (design section 1), but only when this
/// process owns the library; storage that could not be locked is left alone.
pub(crate) fn with_library_lock<T>(
    root: &Path,
    owned: bool,
    mode: crate::study_pack::reconcile::Mode,
    work: impl FnOnce(&LibraryGuard) -> Result<T, String>,
) -> Result<T, String> {
    let guard = try_acquire(root, Holder::Library)?;
    if owned {
        crate::study_pack::reconcile::reconcile_locked(&guard, root, mode)?;
    }
    work(&guard)
}

/// Whether this process owns the library (the startup lock was taken).
pub(crate) fn owned(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.try_state::<crate::startup_guard::LibraryLock>()
        .is_some_and(|lock| lock.locked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_second_taker_is_told_who_is_busy_and_release_frees_it() {
        let dir = std::env::temp_dir().join(format!("hfd-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = try_acquire(&dir, Holder::Pack).unwrap();
        assert!(first.covers(&dir));
        assert_eq!(try_acquire(&dir, Holder::Library).unwrap_err(), PACK_BUSY);
        drop(first);
        let second = try_acquire(&dir, Holder::Library).unwrap();
        assert_eq!(try_acquire(&dir, Holder::Pack).unwrap_err(), LIBRARY_BUSY);
        drop(second);
        let other = std::env::temp_dir().join(format!("hfd-lock-b-{}", std::process::id()));
        std::fs::create_dir_all(&other).unwrap();
        let _a = try_acquire(&dir, Holder::Pack).unwrap();
        let _b = try_acquire(&other, Holder::Pack).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&other).ok();
    }
}
