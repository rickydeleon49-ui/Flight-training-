//! The Gemini key, kept beside her other data.
//!
//! It used to live in the operating system's credential manager. On macOS a
//! keychain item is bound to the code signature of the application that saved
//! it, and this application is not signed with a stable identity — so every new
//! version is a different application as far as the keychain is concerned. Her
//! key became unreadable after each update and she had to paste it again.
//!
//! A file in her data folder has no such opinion about which build is asking,
//! so it survives updates. It is an ordinary file that anything running as her
//! account can read, and nothing more than that is claimed for it — the
//! interface says "saved on this computer", not "protected".
//!
//! It is deliberately not part of any backup. `write_complete_backup` archives
//! the database and `documents/` only, and `allowed_archive_path` refuses this
//! name on the way in, so a backup file she sends somewhere never carries her
//! key and no archive can plant one.

use std::path::{Path, PathBuf};

/// The file holding the key, directly inside the application data folder.
pub const KEY_FILE: &str = "gemini-key";

/// Where a partly written key waits before it replaces the real one.
const KEY_FILE_WRITING: &str = "gemini-key.writing";

fn key_path(root: &Path) -> PathBuf {
    root.join(KEY_FILE)
}

/// Read the stored key.
///
/// `Ok(None)` means no key is stored, which is deliberately different from an
/// error: the old credential manager could not tell those apart, so a refusal
/// to hand the key over looked exactly like never having saved one.
pub fn load_key(root: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(key_path(root)) {
        Ok(contents) => {
            let trimmed = contents.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read the saved Gemini key: {e}")),
    }
}

/// Save the key, replacing any previous one.
pub fn save_key(root: &Path, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("There is no key to save.".to_string());
    }
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not create the application data directory: {e}"))?;

    // Write beside the target and rename over it, so an interrupted write
    // cannot leave her with half a key and no way to tell.
    let writing = root.join(KEY_FILE_WRITING);
    std::fs::write(&writing, key).map_err(|e| format!("Could not save the Gemini key: {e}"))?;
    if let Err(error) = restrict(&writing) {
        let _ = std::fs::remove_file(&writing);
        return Err(error);
    }
    std::fs::rename(&writing, key_path(root)).map_err(|e| {
        let _ = std::fs::remove_file(&writing);
        format!("Could not save the Gemini key: {e}")
    })
}

/// Remove the stored key. Not having one is not a failure.
pub fn forget_key(root: &Path) -> Result<(), String> {
    match std::fs::remove_file(key_path(root)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove the Gemini key: {e}")),
    }
}

/// Readable and writable by her account alone, on platforms that say so.
#[cfg(unix)]
fn restrict(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("Could not restrict the Gemini key file: {e}"))
}

/// Windows keeps the application data folder inside her user profile and has
/// no mode to set here.
#[cfg(not(unix))]
fn restrict(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    const KEY: &str = "AIzaSyExampleKeyThatIsLongEnough";

    /// A private directory to play the part of her application data folder.
    fn scratch(label: &str) -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "hfd-{label}-{}-{}-{unique}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_saved_key_reads_back() {
        let root = scratch("key-roundtrip");
        save_key(&root, KEY).unwrap();
        assert_eq!(load_key(&root).unwrap(), Some(KEY.to_string()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn no_key_is_not_an_error() {
        let root = scratch("key-absent");
        assert_eq!(load_key(&root).unwrap(), None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_empty_file_counts_as_no_key() {
        let root = scratch("key-empty");
        std::fs::write(root.join(KEY_FILE), "   \n").unwrap();
        assert_eq!(load_key(&root).unwrap(), None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn surrounding_whitespace_is_not_part_of_the_key() {
        let root = scratch("key-trim");
        save_key(&root, &format!("  {KEY}\n")).unwrap();
        assert_eq!(load_key(&root).unwrap(), Some(KEY.to_string()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn saving_again_replaces_the_previous_key() {
        let root = scratch("key-replace");
        save_key(&root, KEY).unwrap();
        save_key(&root, "AIzaSyADifferentKeyEntirely").unwrap();
        assert_eq!(
            load_key(&root).unwrap(),
            Some("AIzaSyADifferentKeyEntirely".to_string())
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn saving_leaves_no_half_written_file_behind() {
        let root = scratch("key-atomic");
        save_key(&root, KEY).unwrap();
        assert!(!root.join(KEY_FILE_WRITING).exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn forgetting_removes_the_key_and_is_safe_to_repeat() {
        let root = scratch("key-forget");
        save_key(&root, KEY).unwrap();
        forget_key(&root).unwrap();
        assert_eq!(load_key(&root).unwrap(), None);
        forget_key(&root).unwrap();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_blank_key_is_refused_rather_than_stored() {
        let root = scratch("key-blank");
        assert!(save_key(&root, "   ").is_err());
        assert_eq!(load_key(&root).unwrap(), None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_data_folder_is_created_if_it_is_missing() {
        let parent = scratch("key-missing-root");
        let root = parent.join("not-yet-there");
        save_key(&root, KEY).unwrap();
        assert_eq!(load_key(&root).unwrap(), Some(KEY.to_string()));
        std::fs::remove_dir_all(&parent).ok();
    }

    #[cfg(unix)]
    #[test]
    fn the_key_file_is_readable_only_by_her_account() {
        use std::os::unix::fs::PermissionsExt;

        let root = scratch("key-mode");
        save_key(&root, KEY).unwrap();
        let mode = std::fs::metadata(root.join(KEY_FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        std::fs::remove_dir_all(&root).ok();
    }
}
