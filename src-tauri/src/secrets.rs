//! Provider keys (Gemini, Claude): in the operating system's secure store
//! where that store is real and stable, otherwise in a private file beside
//! her other data.
//!
//! History. Until PUB-R6 the keys lived only in the files `gemini-key` and
//! `claude-key`. This comment used to say the keychain had been abandoned
//! because an unstable code signature made the key unreadable after every
//! update. The real cause was different: the `keyring` dependency was built
//! without any platform backend, so it silently used keyring's in-memory
//! mock store and every key was gone when the app quit. The `apple-native`
//! and `windows-native` backends are now enabled (owner-approved).
//!
//! Where a key lives (`system_store`):
//! - Windows: Credential Manager. iOS: the keychain.
//! - macOS: the login keychain, but only when this running build is signed
//!   with a Developer ID (`signing::developer_id`, checked against the
//!   running code's own signature). An ad-hoc signed or unsigned build (dev,
//!   QA, `cargo test`) is a different application to the keychain after every
//!   rebuild, and macOS would ask for her password each time, so those keep
//!   the file.
//! - Anywhere else (Linux, Android): the file. No backend is compiled in
//!   there, and keyring's mock store must never be mistaken for a real one.
//! - Unit tests never reach a real store; they pass an in-memory fake.
//!
//! The fallback file uses mode 0600 on Unix. On other platforms it retains
//! the existing file permissions; Windows DACL hardening is not included.
//!
//! Moving across. A key still in the file is copied into the store, read
//! back and compared, and only then are the file and any `.writing` leftover
//! deleted. Any failure leaves the file in place and in use, and the move is
//! tried again on the next launch. When both hold a key the file wins: it is
//! either not moved yet or a save made while the store was failing, so it is
//! the newest. Store errors are never logged with their secret, and no store
//! error message ever contains the key.
//!
//! Keys are deliberately not part of any backup. `write_complete_backup`
//! archives the database and `documents/` only, and `allowed_archive_path`
//! refuses the key file names on the way in, so a backup file she sends
//! somewhere never carries her key and no archive can plant one.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::provider::ProviderId;

/// The file holding the key, directly inside the application data folder.
pub const KEY_FILE: &str = "gemini-key";

/// Where a partly written key waits before it replaces the real one.
#[cfg(test)]
const KEY_FILE_WRITING: &str = "gemini-key.writing";

/// The secure-store service every key is filed under.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
const STORE_SERVICE: &str = "com.herflightdeck.app";

fn key_file(provider: ProviderId) -> &'static str {
    match provider {
        ProviderId::Gemini => KEY_FILE,
        ProviderId::Claude => "claude-key",
    }
}

fn key_path(root: &Path, provider: ProviderId) -> PathBuf {
    root.join(key_file(provider))
}

fn writing_path(root: &Path, provider: ProviderId) -> PathBuf {
    root.join(format!("{}.writing", key_file(provider)))
}

/// iOS containers move on update; its per-app keychain needs a stable account.
/// Desktop profiles retain the absolute path so QA copies never share a key.
fn store_account(root: &Path, provider: ProviderId) -> String {
    store_account_for(root, provider, cfg!(target_os = "ios"))
}

fn store_account_for(root: &Path, provider: ProviderId, ios: bool) -> String {
    if ios {
        key_file(provider).to_string()
    } else {
        format!("{}:{}", key_file(provider), root.display())
    }
}

/// Only presence and read failure cross the status boundary, never the key
/// or the store's error text. Reading status never saves or forgets a key.
pub(crate) fn key_read_status(key: Result<Option<String>, String>) -> (bool, bool) {
    match key {
        Ok(key) => (key.is_some(), false),
        Err(_) => (false, true),
    }
}

/// An operating-system secure store, behind a trait so tests can use an
/// in-memory fake. Error strings must never contain the secret.
pub(crate) trait SecureStore {
    /// The stored secret; `Ok(None)` when there is none.
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    /// Store `secret`, replacing any previous one.
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    /// Remove the secret. Not having one is not a failure.
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// The real store, through the `keyring` crate's native backend.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
#[cfg_attr(test, allow(dead_code))]
struct KeyringStore;

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
#[cfg_attr(test, allow(dead_code))]
impl KeyringStore {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(STORE_SERVICE, account).map_err(describe_store_error)
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
impl SecureStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(describe_store_error(e)),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(describe_store_error)
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(describe_store_error(e)),
        }
    }
}

/// A store error in words that never include a secret: only the platform's
/// own failure description is kept, never stored bytes.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "ios"))]
#[cfg_attr(test, allow(dead_code))]
fn describe_store_error(error: keyring::Error) -> String {
    match error {
        keyring::Error::PlatformFailure(e) => format!("the secure store failed ({e})"),
        keyring::Error::NoStorageAccess(e) => {
            format!("the secure store is locked or unavailable ({e})")
        }
        keyring::Error::NoEntry => "the secure store has no such item".to_string(),
        keyring::Error::BadEncoding(_) => "the secure store item is not text".to_string(),
        keyring::Error::TooLong(..) | keyring::Error::Invalid(..) => {
            "the secure store refused the item name".to_string()
        }
        keyring::Error::Ambiguous(_) => "the secure store holds duplicate items".to_string(),
        _ => "the secure store failed".to_string(),
    }
}

/// Which secure store this build uses, or `None` for the file only. See the
/// module comment; decided by platform and, on macOS, by the running code's
/// signature, never by a build-type flag.
#[cfg(test)]
fn system_store() -> Option<&'static dyn SecureStore> {
    None
}

#[cfg(all(not(test), any(target_os = "windows", target_os = "ios")))]
fn system_store() -> Option<&'static dyn SecureStore> {
    Some(&KeyringStore)
}

#[cfg(all(not(test), target_os = "macos"))]
fn system_store() -> Option<&'static dyn SecureStore> {
    if signing::developer_id() {
        Some(&KeyringStore)
    } else {
        None
    }
}

#[cfg(all(
    not(test),
    not(any(target_os = "macos", target_os = "windows", target_os = "ios"))
))]
fn system_store() -> Option<&'static dyn SecureStore> {
    None
}

/// Whether this run may still try to move a file key into the store. One
/// attempt per profile and provider per launch: a failing store is not
/// hammered on every status check, and the next launch tries again.
fn first_move_attempt(root: &Path, provider: ProviderId) -> bool {
    static TRIED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    let mut tried = TRIED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    tried
        .get_or_insert_with(HashSet::new)
        .insert(store_account(root, provider))
}

/// Read the stored key.
///
/// `Ok(None)` means no key is stored, which is deliberately different from an
/// error: a store or folder that cannot be read never looks like a key she
/// never entered.
pub fn load_key(root: &Path) -> Result<Option<String>, String> {
    load_key_for(root, ProviderId::Gemini)
}

pub(crate) fn load_key_for(root: &Path, provider: ProviderId) -> Result<Option<String>, String> {
    let store = system_store();
    let may_move = store.is_some() && first_move_attempt(root, provider);
    load_key_with(root, provider, store, may_move)
}

/// `load_key_for` against an explicit store. With `may_move`, a key found in
/// the file is moved into the store (verified before the file goes).
pub(crate) fn load_key_with(
    root: &Path,
    provider: ProviderId,
    store: Option<&dyn SecureStore>,
    may_move: bool,
) -> Result<Option<String>, String> {
    if let Some(key) = load_file(root, provider)? {
        if let (Some(store), true) = (store, may_move) {
            // Best effort: on any failure the file stays and is used.
            let _ = move_into_store(root, provider, store, &key);
        }
        return Ok(Some(key));
    }
    let Some(store) = store else {
        return Ok(None);
    };
    match store.get(&store_account(root, provider)) {
        Ok(Some(secret)) => {
            let trimmed = secret.trim();
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(format!(
            "Could not read the saved {} key: {e}",
            provider.name()
        )),
    }
}

fn load_file(root: &Path, provider: ProviderId) -> Result<Option<String>, String> {
    match std::fs::read_to_string(key_path(root, provider)) {
        Ok(contents) => {
            let trimmed = contents.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!(
            "Could not read the saved {} key: {e}",
            provider.name()
        )),
    }
}

/// Write `key` to the store and read it back; `Err` unless it reads back
/// exactly.
fn store_verified(
    root: &Path,
    provider: ProviderId,
    store: &dyn SecureStore,
    key: &str,
) -> Result<(), String> {
    let account = store_account(root, provider);
    store.set(&account, key)?;
    match store.get(&account)? {
        Some(back) if back == key => Ok(()),
        _ => Err("the secure store did not give the key back unchanged".to_string()),
    }
}

/// Move a file key into the store: write, read back, compare, and only then
/// delete the file and any `.writing` leftover.
fn move_into_store(
    root: &Path,
    provider: ProviderId,
    store: &dyn SecureStore,
    key: &str,
) -> Result<(), String> {
    store_verified(root, provider, store, key)?;
    remove_key_files(root, provider)
}

/// Remove the key file and any `.writing` leftover. Absent is fine.
fn remove_key_files(root: &Path, provider: ProviderId) -> Result<(), String> {
    for path in [writing_path(root, provider), key_path(root, provider)] {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not remove the {} key: {e}", provider.name())),
        }
    }
    Ok(())
}

/// Save the key, replacing any previous one.
pub fn save_key(root: &Path, key: &str) -> Result<(), String> {
    save_key_for(root, ProviderId::Gemini, key)
}

pub(crate) fn save_key_for(root: &Path, provider: ProviderId, key: &str) -> Result<(), String> {
    save_key_with(root, provider, system_store(), key)
}

/// `save_key_for` against an explicit store. The store is tried first; if it
/// fails, or the old file cannot be removed (the file would win over the
/// store), the key goes to the private file instead.
pub(crate) fn save_key_with(
    root: &Path,
    provider: ProviderId,
    store: Option<&dyn SecureStore>,
    key: &str,
) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("There is no key to save.".to_string());
    }
    if let Some(store) = store {
        if store_verified(root, provider, store, key).is_ok()
            && remove_key_files(root, provider).is_ok()
        {
            return Ok(());
        }
    }
    save_file(root, provider, key)
}

fn save_file(root: &Path, provider: ProviderId, key: &str) -> Result<(), String> {
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not create the application data directory: {e}"))?;

    // Write beside the target and rename over it, so an interrupted write
    // cannot leave her with half a key and no way to tell.
    let writing = writing_path(root, provider);
    if let Err(e) = write_private(&writing, key) {
        let _ = std::fs::remove_file(&writing);
        return Err(format!("Could not save the {} key: {e}", provider.name()));
    }
    std::fs::rename(&writing, key_path(root, provider)).map_err(|e| {
        let _ = std::fs::remove_file(&writing);
        format!("Could not save the {} key: {e}", provider.name())
    })
}

/// Remove the stored key from the file and the store. Not having one is not
/// a failure.
pub fn forget_key(root: &Path) -> Result<(), String> {
    forget_key_for(root, ProviderId::Gemini)
}

pub(crate) fn forget_key_for(root: &Path, provider: ProviderId) -> Result<(), String> {
    forget_key_with(root, provider, system_store())
}

/// `forget_key_for` against an explicit store. Both are always attempted; a
/// failure in either is reported, so "cleared" is never claimed while a key
/// may remain.
pub(crate) fn forget_key_with(
    root: &Path,
    provider: ProviderId,
    store: Option<&dyn SecureStore>,
) -> Result<(), String> {
    let file = remove_key_files(root, provider);
    let stored = match store {
        Some(store) => store
            .delete(&store_account(root, provider))
            .map_err(|e| format!("Could not remove the {} key: {e}", provider.name())),
        None => Ok(()),
    };
    file.and(stored)
}

/// Whether the running app is signed with a Developer ID, read from its own
/// code signature (`SecCodeCopySelf` + `SecCodeCheckValidity` against the
/// Developer ID requirement). Only such a build has a designated requirement
/// that survives rebuilds and updates, so only it can use the keychain
/// without a password prompt after each new build. Calls the system Security
/// framework directly (already linked through `keyring`'s `apple-native`).
#[cfg(target_os = "macos")]
pub(crate) mod signing {
    use std::ffi::c_void;
    use std::sync::OnceLock;

    type CFTypeRef = *const c_void;
    type OSStatus = i32;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_SEC_CS_DEFAULT_FLAGS: u32 = 0;

    /// Apple-anchored chain whose intermediate is the Developer ID CA and
    /// whose leaf is a Developer ID Application certificate.
    const DEVELOPER_ID_REQUIREMENT: &str = "anchor apple generic \
        and certificate 1[field.1.2.840.113635.100.6.2.6] exists \
        and certificate leaf[field.1.2.840.113635.100.6.1.13] exists";

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithBytes(
            alloc: CFTypeRef,
            bytes: *const u8,
            num_bytes: isize,
            encoding: u32,
            is_external_representation: u8,
        ) -> CFTypeRef;
        fn CFRelease(cf: CFTypeRef);
    }

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecCodeCopySelf(flags: u32, code: *mut CFTypeRef) -> OSStatus;
        fn SecRequirementCreateWithString(
            text: CFTypeRef,
            flags: u32,
            requirement: *mut CFTypeRef,
        ) -> OSStatus;
        fn SecCodeCheckValidity(code: CFTypeRef, flags: u32, requirement: CFTypeRef) -> OSStatus;
    }

    /// Checked once per run.
    pub(crate) fn developer_id() -> bool {
        static SIGNED: OnceLock<bool> = OnceLock::new();
        *SIGNED.get_or_init(check)
    }

    fn check() -> bool {
        // SAFETY: every CF object created here is checked for null and
        // released exactly once; out-pointers are valid locals.
        unsafe {
            let text = CFStringCreateWithBytes(
                std::ptr::null(),
                DEVELOPER_ID_REQUIREMENT.as_ptr(),
                DEVELOPER_ID_REQUIREMENT.len() as isize,
                K_CF_STRING_ENCODING_UTF8,
                0,
            );
            if text.is_null() {
                return false;
            }
            let mut requirement: CFTypeRef = std::ptr::null();
            let made =
                SecRequirementCreateWithString(text, K_SEC_CS_DEFAULT_FLAGS, &mut requirement);
            CFRelease(text);
            if made != 0 || requirement.is_null() {
                return false;
            }
            let mut code: CFTypeRef = std::ptr::null();
            let copied = SecCodeCopySelf(K_SEC_CS_DEFAULT_FLAGS, &mut code);
            let valid = copied == 0
                && !code.is_null()
                && SecCodeCheckValidity(code, K_SEC_CS_DEFAULT_FLAGS, requirement) == 0;
            if !code.is_null() {
                CFRelease(code);
            }
            CFRelease(requirement);
            valid
        }
    }
}

/// Write `contents` to a new file that is readable and writable by her
/// account alone from the moment it exists, on platforms that say so. A file
/// left behind by an interrupted save is removed first, because opening an
/// existing file would keep whatever mode it already had.
fn write_private(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;

    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()
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
    fn provider_keys_are_isolated_through_save_replace_and_forget() {
        let root = scratch("provider-isolation");
        save_key(&root, KEY).unwrap();
        let gemini_bytes = std::fs::read(root.join("gemini-key")).unwrap();
        save_key_for(&root, ProviderId::Claude, "  synthetic-claude-key\n").unwrap();
        assert_eq!(
            std::fs::read(root.join("gemini-key")).unwrap(),
            gemini_bytes
        );
        assert_eq!(
            std::fs::read_to_string(root.join("claude-key")).unwrap(),
            "synthetic-claude-key"
        );
        save_key_for(&root, ProviderId::Claude, "replacement-claude-key").unwrap();
        assert_eq!(load_key(&root).unwrap().as_deref(), Some(KEY));
        assert_eq!(
            load_key_for(&root, ProviderId::Claude).unwrap().as_deref(),
            Some("replacement-claude-key")
        );
        forget_key(&root).unwrap();
        assert_eq!(
            load_key_for(&root, ProviderId::Claude).unwrap().as_deref(),
            Some("replacement-claude-key")
        );
        save_key(&root, KEY).unwrap();
        forget_key_for(&root, ProviderId::Claude).unwrap();
        forget_key_for(&root, ProviderId::Claude).unwrap();
        assert_eq!(load_key(&root).unwrap().as_deref(), Some(KEY));
        assert_eq!(load_key_for(&root, ProviderId::Claude).unwrap(), None);
        assert!(!root.join("claude-key.writing").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn both_provider_files_are_private_even_after_stale_temporary_files() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("provider-private");
        for id in [ProviderId::Gemini, ProviderId::Claude] {
            let writing = root.join(format!("{}.writing", key_file(id)));
            std::fs::write(&writing, "stale").unwrap();
            std::fs::set_permissions(&writing, std::fs::Permissions::from_mode(0o644)).unwrap();
            save_key_for(&root, id, "synthetic-key").unwrap();
            assert_eq!(
                std::fs::metadata(key_path(&root, id))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert!(!writing.exists());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn claude_empty_and_unreadable_keys_follow_existing_rules() {
        let root = scratch("claude-key-errors");
        assert_eq!(load_key_for(&root, ProviderId::Claude).unwrap(), None);
        assert!(save_key_for(&root, ProviderId::Claude, "  ").is_err());
        std::fs::write(root.join("claude-key"), " \n").unwrap();
        assert_eq!(load_key_for(&root, ProviderId::Claude).unwrap(), None);
        std::fs::remove_file(root.join("claude-key")).unwrap();
        std::fs::create_dir(root.join("claude-key")).unwrap();
        assert!(load_key_for(&root, ProviderId::Claude).is_err());
        std::fs::remove_dir_all(root).unwrap();
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

    /// The half-written file is private from creation, not tightened after
    /// the key is already in it; a stale world-readable one is not reused.
    #[cfg(unix)]
    #[test]
    fn the_key_is_never_written_into_a_readable_file() {
        use std::os::unix::fs::PermissionsExt;

        let root = scratch("key-mode-at-creation");
        let writing = root.join(KEY_FILE_WRITING);
        std::fs::write(&writing, "stale").unwrap();
        std::fs::set_permissions(&writing, std::fs::Permissions::from_mode(0o644)).unwrap();

        write_private(&writing, KEY).unwrap();
        let mode = std::fs::metadata(&writing).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(std::fs::read_to_string(&writing).unwrap(), KEY);
        std::fs::remove_dir_all(&root).ok();
    }
}

/// An in-memory `SecureStore` for tests, with switches for each failure the
/// real stores can produce. Tests never touch the real keychain.
#[cfg(test)]
pub(crate) mod fake {
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;

    use super::SecureStore;

    #[derive(Default)]
    pub(crate) struct FakeStore {
        pub(crate) items: RefCell<HashMap<String, String>>,
        pub(crate) fail_get: Cell<bool>,
        pub(crate) fail_set: Cell<bool>,
        pub(crate) fail_delete: Cell<bool>,
        /// Store something other than what was given (a read-back mismatch).
        pub(crate) garble: Cell<bool>,
    }

    impl FakeStore {
        pub(crate) fn only_secret(&self) -> Option<String> {
            let items = self.items.borrow();
            assert!(items.len() <= 1, "expected at most one stored item");
            items.values().next().cloned()
        }
    }

    impl SecureStore for FakeStore {
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            if self.fail_get.get() {
                return Err("fake store: get refused".to_string());
            }
            Ok(self.items.borrow().get(account).cloned())
        }

        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            if self.fail_set.get() {
                return Err("fake store: set refused".to_string());
            }
            let stored = if self.garble.get() {
                format!("{secret}-garbled")
            } else {
                secret.to_string()
            };
            self.items.borrow_mut().insert(account.to_string(), stored);
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            if self.fail_delete.get() {
                return Err("fake store: delete refused".to_string());
            }
            self.items.borrow_mut().remove(account);
            Ok(())
        }
    }
}

#[cfg(test)]
mod store_tests {
    use super::fake::FakeStore;
    use super::*;

    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    const KEY: &str = "AIzaSyExampleKeyThatIsLongEnough";

    fn scratch(label: &str) -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("hfd-store-{label}-{}-{unique}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An existing file key (as a 0.6.x user has it) as the old app wrote it.
    fn existing_file_key(root: &Path, provider: ProviderId, key: &str) {
        save_key_with(root, provider, None, key).unwrap();
        assert!(key_path(root, provider).is_file());
    }

    #[test]
    fn accounts_are_stable_on_ios_and_isolated_on_desktop() {
        let first = Path::new("/container/first/profile");
        let second = Path::new("/container/second/profile");
        for id in [ProviderId::Gemini, ProviderId::Claude] {
            assert_eq!(
                store_account_for(first, id, true),
                store_account_for(second, id, true)
            );
            assert_ne!(
                store_account_for(first, id, false),
                store_account_for(second, id, false)
            );
            assert_eq!(
                store_account_for(first, id, false),
                format!("{}:{}", key_file(id), first.display())
            );
        }
        assert_ne!(
            store_account_for(first, ProviderId::Gemini, true),
            store_account_for(first, ProviderId::Claude, true)
        );
    }

    #[test]
    fn unreadable_status_preserves_each_provider_store_and_partial_file() {
        let root = scratch("status-read-error");
        for id in [ProviderId::Gemini, ProviderId::Claude] {
            let store = FakeStore::default();
            save_key_with(&root, id, Some(&store), KEY).unwrap();
            std::fs::write(writing_path(&root, id), "partial-file").unwrap();
            store.fail_get.set(true);
            let read = load_key_with(&root, id, Some(&store), true);
            assert_eq!(key_read_status(read), (false, true));
            assert_eq!(store.only_secret().as_deref(), Some(KEY));
            assert_eq!(
                std::fs::read_to_string(writing_path(&root, id)).unwrap(),
                "partial-file"
            );
            assert!(!key_path(&root, id).exists());
            store.fail_get.set(false);
            assert_eq!(
                key_read_status(load_key_with(&root, id, Some(&store), true)),
                (true, false)
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unit_tests_never_reach_the_real_store() {
        assert!(system_store().is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_test_build_is_not_developer_id_signed() {
        // The test binary is ad-hoc (linker) signed, so it must keep the file.
        assert!(!signing::developer_id());
    }

    #[test]
    fn a_file_key_moves_into_the_store_and_the_file_goes() {
        let root = scratch("move");
        let store = FakeStore::default();
        for id in [ProviderId::Gemini, ProviderId::Claude] {
            existing_file_key(&root, id, &format!("{KEY}-{}", key_file(id)));
            std::fs::write(writing_path(&root, id), "stale").unwrap();
        }
        for id in [ProviderId::Gemini, ProviderId::Claude] {
            let expected = format!("{KEY}-{}", key_file(id));
            assert_eq!(
                load_key_with(&root, id, Some(&store), true).unwrap(),
                Some(expected.clone())
            );
            assert!(!key_path(&root, id).exists(), "file kept after a good move");
            assert!(!writing_path(&root, id).exists());
            assert_eq!(
                store.items.borrow().get(&store_account(&root, id)),
                Some(&expected)
            );
            // And it now reads from the store.
            assert_eq!(
                load_key_with(&root, id, Some(&store), false).unwrap(),
                Some(expected)
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_read_back_mismatch_keeps_the_file_and_its_key() {
        let root = scratch("mismatch");
        existing_file_key(&root, ProviderId::Gemini, KEY);
        let store = FakeStore::default();
        store.garble.set(true);
        assert_eq!(
            load_key_with(&root, ProviderId::Gemini, Some(&store), true).unwrap(),
            Some(KEY.to_string())
        );
        assert_eq!(
            std::fs::read_to_string(key_path(&root, ProviderId::Gemini)).unwrap(),
            KEY
        );
        // The file still wins over whatever the store holds.
        assert_eq!(
            load_key_with(&root, ProviderId::Gemini, Some(&store), false).unwrap(),
            Some(KEY.to_string())
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_store_error_during_the_move_keeps_the_file() {
        let root = scratch("move-error");
        existing_file_key(&root, ProviderId::Claude, KEY);
        for fail in ["set", "get"] {
            let store = FakeStore::default();
            match fail {
                "set" => store.fail_set.set(true),
                _ => store.fail_get.set(true),
            }
            assert_eq!(
                load_key_with(&root, ProviderId::Claude, Some(&store), true).unwrap(),
                Some(KEY.to_string())
            );
            assert!(key_path(&root, ProviderId::Claude).is_file());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saving_with_a_working_store_leaves_no_file() {
        let root = scratch("save-store");
        let store = FakeStore::default();
        existing_file_key(&root, ProviderId::Gemini, "AIzaSyTheOldKeyFromBefore");
        save_key_with(
            &root,
            ProviderId::Gemini,
            Some(&store),
            &format!(" {KEY}\n"),
        )
        .unwrap();
        assert!(!key_path(&root, ProviderId::Gemini).exists());
        assert!(!writing_path(&root, ProviderId::Gemini).exists());
        assert_eq!(store.only_secret().as_deref(), Some(KEY));
        assert_eq!(
            load_key_with(&root, ProviderId::Gemini, Some(&store), true).unwrap(),
            Some(KEY.to_string())
        );
        assert!(save_key_with(&root, ProviderId::Gemini, Some(&store), "  ").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_store_error_on_save_falls_back_to_a_private_file() {
        let root = scratch("save-fallback");
        let store = FakeStore::default();
        save_key_with(
            &root,
            ProviderId::Gemini,
            Some(&store),
            "AIzaSyAnOlderStoredKey",
        )
        .unwrap();
        store.fail_set.set(true);
        save_key_with(&root, ProviderId::Gemini, Some(&store), KEY).unwrap();
        assert_eq!(
            std::fs::read_to_string(key_path(&root, ProviderId::Gemini)).unwrap(),
            KEY
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(key_path(&root, ProviderId::Gemini))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        // The newer file key wins over the older stored one.
        assert_eq!(
            load_key_with(&root, ProviderId::Gemini, Some(&store), false).unwrap(),
            Some(KEY.to_string())
        );
        // Next launch, with the store healthy again, it moves across.
        store.fail_set.set(false);
        assert_eq!(
            load_key_with(&root, ProviderId::Gemini, Some(&store), true).unwrap(),
            Some(KEY.to_string())
        );
        assert_eq!(store.only_secret().as_deref(), Some(KEY));
        assert!(!key_path(&root, ProviderId::Gemini).exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_unreadable_store_with_no_file_is_an_error_not_an_absent_key() {
        let root = scratch("get-error");
        let store = FakeStore::default();
        assert_eq!(
            load_key_with(&root, ProviderId::Claude, Some(&store), true).unwrap(),
            None
        );
        store.fail_get.set(true);
        let error = load_key_with(&root, ProviderId::Claude, Some(&store), true).unwrap_err();
        assert!(error.contains("Claude"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clearing_removes_the_key_from_both_stores() {
        let root = scratch("forget-both");
        let store = FakeStore::default();
        save_key_with(&root, ProviderId::Gemini, Some(&store), KEY).unwrap();
        save_key_with(
            &root,
            ProviderId::Claude,
            Some(&store),
            "synthetic-claude-key",
        )
        .unwrap();
        // A fallback file beside the stored key, as after a store hiccup.
        existing_file_key(&root, ProviderId::Gemini, "AIzaSyFallbackFileKeyHere");
        forget_key_with(&root, ProviderId::Gemini, Some(&store)).unwrap();
        assert!(!key_path(&root, ProviderId::Gemini).exists());
        assert_eq!(
            load_key_with(&root, ProviderId::Gemini, Some(&store), true).unwrap(),
            None
        );
        // The other provider is untouched; forgetting twice is fine.
        assert_eq!(
            load_key_with(&root, ProviderId::Claude, Some(&store), true).unwrap(),
            Some("synthetic-claude-key".to_string())
        );
        forget_key_with(&root, ProviderId::Gemini, Some(&store)).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_store_that_cannot_delete_still_loses_the_file_and_says_so() {
        let root = scratch("forget-error");
        let store = FakeStore::default();
        save_key_with(&root, ProviderId::Gemini, Some(&store), KEY).unwrap();
        existing_file_key(&root, ProviderId::Gemini, KEY);
        store.fail_delete.set(true);
        let error = forget_key_with(&root, ProviderId::Gemini, Some(&store)).unwrap_err();
        assert!(!error.contains(KEY), "an error must never carry the key");
        assert!(!key_path(&root, ProviderId::Gemini).exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "ios"))]
    #[test]
    fn separate_profiles_never_share_a_stored_key() {
        let first = scratch("profile-a");
        let second = scratch("profile-b");
        let store = FakeStore::default();
        save_key_with(&first, ProviderId::Gemini, Some(&store), KEY).unwrap();
        assert_eq!(
            load_key_with(&second, ProviderId::Gemini, Some(&store), true).unwrap(),
            None
        );
        std::fs::remove_dir_all(first).unwrap();
        std::fs::remove_dir_all(second).unwrap();
    }

    #[test]
    fn a_move_is_tried_once_per_profile_and_provider_per_launch() {
        let root = scratch("once");
        assert!(first_move_attempt(&root, ProviderId::Gemini));
        assert!(!first_move_attempt(&root, ProviderId::Gemini));
        assert!(first_move_attempt(&root, ProviderId::Claude));
        std::fs::remove_dir_all(root).unwrap();
    }
}
