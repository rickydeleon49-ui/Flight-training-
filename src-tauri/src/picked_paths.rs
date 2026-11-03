//! Files the user chose in a system open/save dialog during this run.
//!
//! A few commands take an absolute path from the webview: importing a study
//! file, saving or reading a complete backup. Those paths must come from a
//! dialog she answered, never from text the page made up. The dialog plugin
//! adds every chosen path to the fs plugin's scope; this module listens for
//! those additions and keeps its own set, so the commands can refuse any
//! other path. Each path is kept under both its literal and its resolved
//! spelling (symlinks, `/var` vs `/private/var`, Windows `\\?\`), and a
//! not-yet-existing save target under its resolved folder plus file name.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, Runtime};

const NOT_PICKED: &str = "Choose the file again with the file picker.";

#[derive(Clone, Default)]
pub struct PickedPaths(Arc<Mutex<HashSet<PathBuf>>>);

impl PickedPaths {
    pub fn record(&self, path: &Path) {
        let mut set = self.0.lock().unwrap_or_else(|e| e.into_inner());
        set.insert(path.to_path_buf());
        if let Some(resolved) = resolved(path) {
            set.insert(resolved);
        }
    }

    pub fn contains(&self, path: &Path) -> bool {
        let set = self.0.lock().unwrap_or_else(|e| e.into_inner());
        set.contains(path) || resolved(path).is_some_and(|key| set.contains(&key))
    }
}

/// The canonical spelling of `path`, or of its folder plus its file name when
/// the file does not exist yet (a save target).
fn resolved(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }
    let name = path.file_name()?;
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty())?;
    parent.canonicalize().ok().map(|dir| dir.join(name))
}

/// Start recording dialog picks. Call once, during setup.
pub fn install<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_fs::FsExt;
    let picked = PickedPaths::default();
    app.manage(picked.clone());
    if let Some(scope) = app.try_fs_scope() {
        scope.listen(move |event| {
            if let tauri::scope::fs::Event::PathAllowed(path) = event {
                picked.record(path);
            }
        });
    }
}

/// Refuse a webview-supplied path the user did not pick in a dialog.
pub fn require_picked<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<(), String> {
    let picked = app.try_state::<PickedPaths>().ok_or(NOT_PICKED)?;
    // The phone's picker answers with a `file://` URL; compare its path.
    let path = crate::backup::picked_backup_path(path).map_err(|_| NOT_PICKED)?;
    if picked.contains(&path) {
        Ok(())
    } else {
        Err(NOT_PICKED.to_string())
    }
}

/// Like `require_picked`, but also accepts a file already inside `root`
/// (the app data folder), such as an incoming backup the app copied there.
pub fn require_picked_or_inside<R: Runtime>(
    app: &AppHandle<R>,
    root: &Path,
    path: &str,
) -> Result<(), String> {
    let literal = crate::backup::picked_backup_path(path).map_err(|_| NOT_PICKED)?;
    if is_inside(root, &literal) {
        return Ok(());
    }
    require_picked(app, path)
}

fn is_inside(root: &Path, path: &Path) -> bool {
    match (root.canonicalize(), path.canonicalize()) {
        (Ok(root), Ok(path)) => path.starts_with(root),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hfd-picked-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_recorded_paths_count_as_picked() {
        let dir = scratch("record");
        let chosen = dir.join("chosen.pdf");
        let other = dir.join("other.pdf");
        std::fs::write(&chosen, b"x").unwrap();
        std::fs::write(&other, b"y").unwrap();
        let picked = PickedPaths::default();
        picked.record(&chosen);
        assert!(picked.contains(&chosen));
        assert!(!picked.contains(&other));
        assert!(!picked.contains(Path::new("/etc/passwd")));
        // The same file through `..` resolves to the picked one.
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(picked.contains(&sub.join("..").join("chosen.pdf")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_save_target_matches_before_and_after_it_exists() {
        let dir = scratch("save");
        let target = dir.join("backup.hfdbackup");
        let picked = PickedPaths::default();
        picked.record(&target);
        assert!(picked.contains(&target));
        std::fs::write(&target, b"z").unwrap();
        assert!(picked.contains(&target));
        assert!(!picked.contains(&dir.join("elsewhere.hfdbackup")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_to_an_unpicked_file_is_not_picked() {
        let dir = scratch("link");
        let secret = dir.join("secret.db");
        std::fs::write(&secret, b"s").unwrap();
        let chosen = dir.join("chosen.pdf");
        std::fs::write(&chosen, b"x").unwrap();
        let link = dir.join("link.pdf");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let picked = PickedPaths::default();
        picked.record(&chosen);
        assert!(!picked.contains(&link));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn inside_root_accepts_only_real_children() {
        let root = scratch("root");
        let outside = scratch("outside");
        let file = root.join("incoming.hfdbackup");
        std::fs::write(&file, b"b").unwrap();
        let foreign = outside.join("foreign.hfdbackup");
        std::fs::write(&foreign, b"f").unwrap();
        assert!(is_inside(&root, &file));
        assert!(!is_inside(&root, &foreign));
        assert!(!is_inside(
            &root,
            &root
                .join("..")
                .join(outside.file_name().unwrap())
                .join("foreign.hfdbackup")
        ));
        #[cfg(unix)]
        {
            let link = root.join("link.hfdbackup");
            std::os::unix::fs::symlink(&foreign, &link).unwrap();
            assert!(!is_inside(&root, &link));
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }
}
