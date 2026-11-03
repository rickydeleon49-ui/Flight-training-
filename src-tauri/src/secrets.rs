//! Provider keys, kept beside her other data.
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

use crate::provider::ProviderId;

/// The file holding the key, directly inside the application data folder.
pub const KEY_FILE: &str = "gemini-key";

/// Where a partly written key waits before it replaces the real one.
#[cfg(test)]
const KEY_FILE_WRITING: &str = "gemini-key.writing";

fn key_file(provider: ProviderId) -> &'static str {
    match provider {
        ProviderId::Gemini => KEY_FILE,
        ProviderId::Claude => "claude-key",
    }
}

fn key_path(root: &Path, provider: ProviderId) -> PathBuf {
    root.join(key_file(provider))
}

/// Read the stored key.
///
/// `Ok(None)` means no key is stored, which is deliberately different from an
/// error: the old credential manager could not tell those apart, so a refusal
/// to hand the key over looked exactly like never having saved one.
pub fn load_key(root: &Path) -> Result<Option<String>, String> {
    load_key_for(root, ProviderId::Gemini)
}

pub(crate) fn load_key_for(root: &Path, provider: ProviderId) -> Result<Option<String>, String> {
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

/// Save the key, replacing any previous one.
pub fn save_key(root: &Path, key: &str) -> Result<(), String> {
    save_key_for(root, ProviderId::Gemini, key)
}

pub(crate) fn save_key_for(root: &Path, provider: ProviderId, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("There is no key to save.".to_string());
    }
    std::fs::create_dir_all(root)
        .map_err(|e| format!("Could not create the application data directory: {e}"))?;

    // Write beside the target and rename over it, so an interrupted write
    // cannot leave her with half a key and no way to tell.
    let writing = root.join(format!("{}.writing", key_file(provider)));
    if let Err(e) = write_private(&writing, key) {
        let _ = std::fs::remove_file(&writing);
        return Err(format!("Could not save the {} key: {e}", provider.name()));
    }
    std::fs::rename(&writing, key_path(root, provider)).map_err(|e| {
        let _ = std::fs::remove_file(&writing);
        format!("Could not save the {} key: {e}", provider.name())
    })
}

/// Remove the stored key. Not having one is not a failure.
pub fn forget_key(root: &Path) -> Result<(), String> {
    forget_key_for(root, ProviderId::Gemini)
}

pub(crate) fn forget_key_for(root: &Path, provider: ProviderId) -> Result<(), String> {
    match std::fs::remove_file(key_path(root, provider)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove the {} key: {e}", provider.name())),
    }
}

/// Write `contents` to a new file that is readable and writable by her
/// account alone from the moment it exists: mode 0600 on Unix, and on
/// Windows a protected DACL with a single entry for her account (nothing
/// inherited from the folder). A file left behind by an interrupted save is
/// removed first, because opening an existing file would keep whatever
/// permissions it already had.
fn write_private(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;

    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    #[cfg(windows)]
    let mut file = windows_acl::OwnerOnly::new()?.create_new(path)?;
    #[cfg(not(windows))]
    let mut file = {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path)?
    };
    file.write_all(contents.as_bytes())?;
    file.sync_all()
}

/// The Windows half of `write_private`: a security descriptor whose DACL has
/// one access-allowed entry, for the account running the app, and is marked
/// protected so the folder's inheritable entries are not merged in.
#[cfg(windows)]
pub(crate) mod windows_acl {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Security::{
        AddAccessAllowedAce, GetLengthSid, GetTokenInformation, InitializeAcl,
        InitializeSecurityDescriptor, SetSecurityDescriptorControl, SetSecurityDescriptorDacl,
        TokenUser, ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, PSID, SECURITY_ATTRIBUTES,
        SECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, CREATE_NEW, FILE_ALL_ACCESS, FILE_ATTRIBUTE_NORMAL,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// `SECURITY_DESCRIPTOR_REVISION` (Win32_System_SystemServices, not
    /// enabled just for this constant).
    const SECURITY_DESCRIPTOR_REVISION: u32 = 1;

    /// The `TOKEN_USER` of this process, in u64-aligned storage.
    pub(crate) struct CurrentUser {
        buffer: Vec<u64>,
    }

    impl CurrentUser {
        pub(crate) fn new() -> std::io::Result<Self> {
            let mut token: HANDLE = std::ptr::null_mut();
            // SAFETY: GetCurrentProcess returns a pseudo-handle; token is writable.
            if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
                return Err(std::io::Error::last_os_error());
            }
            let result = (|| {
                let mut needed = 0u32;
                // SAFETY: a size query with a null buffer of length zero.
                unsafe {
                    GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed)
                };
                if needed == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
                // SAFETY: buffer holds at least `needed` writable bytes.
                if unsafe {
                    GetTokenInformation(
                        token,
                        TokenUser,
                        buffer.as_mut_ptr().cast(),
                        needed,
                        &mut needed,
                    )
                } == 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(Self { buffer })
            })();
            // SAFETY: token was opened above and is closed once.
            unsafe { CloseHandle(token) };
            result
        }

        /// Her SID. Valid while `self` lives.
        pub(crate) fn sid(&self) -> PSID {
            // SAFETY: the buffer was filled by GetTokenInformation(TokenUser)
            // and is aligned for TOKEN_USER.
            unsafe { (*(self.buffer.as_ptr() as *const TOKEN_USER)).User.Sid }
        }
    }

    /// Security attributes granting her account full access and nobody else
    /// any. The descriptor and ACL live on the heap so the raw pointers in
    /// `attributes` stay valid while this value lives.
    pub(crate) struct OwnerOnly {
        _acl: Vec<u64>,
        _descriptor: Box<SECURITY_DESCRIPTOR>,
        attributes: Box<SECURITY_ATTRIBUTES>,
    }

    impl OwnerOnly {
        pub(crate) fn new() -> std::io::Result<Self> {
            let user = CurrentUser::new()?;
            let sid = user.sid();
            // SAFETY: sid is a valid SID from the process token.
            let sid_len = unsafe { GetLengthSid(sid) } as usize;
            let acl_len = std::mem::size_of::<ACL>() + std::mem::size_of::<ACCESS_ALLOWED_ACE>()
                - std::mem::size_of::<u32>()
                + sid_len;
            let mut acl = vec![0u64; acl_len.div_ceil(8)];
            let acl_ptr = acl.as_mut_ptr() as *mut ACL;
            let mut descriptor = Box::new(SECURITY_DESCRIPTOR::default());
            let descriptor_ptr = (&mut *descriptor as *mut SECURITY_DESCRIPTOR).cast();
            // SAFETY: acl and descriptor are writable, correctly sized and
            // outlive every pointer handed out; the SID is copied into the ACE.
            let ok = unsafe {
                InitializeAcl(acl_ptr, acl_len as u32, ACL_REVISION) != 0
                    && AddAccessAllowedAce(acl_ptr, ACL_REVISION, FILE_ALL_ACCESS, sid) != 0
                    && InitializeSecurityDescriptor(descriptor_ptr, SECURITY_DESCRIPTOR_REVISION)
                        != 0
                    && SetSecurityDescriptorDacl(descriptor_ptr, 1, acl_ptr, 0) != 0
                    && SetSecurityDescriptorControl(
                        descriptor_ptr,
                        SE_DACL_PROTECTED,
                        SE_DACL_PROTECTED,
                    ) != 0
            };
            if !ok {
                return Err(std::io::Error::last_os_error());
            }
            let attributes = Box::new(SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor_ptr,
                bInheritHandle: 0,
            });
            Ok(Self {
                _acl: acl,
                _descriptor: descriptor,
                attributes,
            })
        }

        /// Create `path` (it must not exist yet) with this security, open
        /// for writing. std's `OpenOptions` cannot pass security attributes,
        /// so this calls `CreateFileW` and hands the handle to a `File`.
        pub(crate) fn create_new(&self, path: &std::path::Path) -> std::io::Result<std::fs::File> {
            use std::os::windows::ffi::OsStrExt;
            use std::os::windows::io::FromRawHandle;

            let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
            if wide.contains(&0) {
                return Err(std::io::Error::from(std::io::ErrorKind::InvalidInput));
            }
            wide.push(0);
            // SAFETY: wide is NUL-terminated; the attributes, descriptor and
            // ACL are owned by `self` and outlive the call.
            let handle = unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    GENERIC_WRITE,
                    0,
                    &*self.attributes,
                    CREATE_NEW,
                    FILE_ATTRIBUTE_NORMAL,
                    std::ptr::null_mut(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                return Err(std::io::Error::last_os_error());
            }
            // SAFETY: handle is a fresh, valid file handle owned by nobody else.
            Ok(unsafe { std::fs::File::from_raw_handle(handle) })
        }
    }
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

    /// What a file's DACL says: whether it is protected from inheritance and,
    /// for each entry, (ACE type, whether its SID is her account's).
    #[cfg(windows)]
    fn windows_dacl(path: &Path) -> (bool, Vec<(u8, bool)>) {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::LocalFree;
        use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
        use windows_sys::Win32::Security::{
            EqualSid, GetAce, GetSecurityDescriptorControl, ACCESS_ALLOWED_ACE, ACL,
            DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED,
        };

        let user = windows_acl::CurrentUser::new().unwrap();
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        wide.push(0);
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        // SAFETY: wide is NUL-terminated; out pointers are writable.
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut descriptor,
            )
        };
        assert_eq!(status, 0, "GetNamedSecurityInfoW failed");
        assert!(!dacl.is_null(), "the file has no DACL at all");
        let mut control = 0u16;
        let mut revision = 0u32;
        // SAFETY: descriptor and dacl come from GetNamedSecurityInfoW and are
        // freed once below with LocalFree.
        unsafe {
            assert_ne!(
                GetSecurityDescriptorControl(descriptor, &mut control, &mut revision),
                0
            );
            let mut entries = Vec::new();
            for index in 0..u32::from((*dacl).AceCount) {
                let mut ace: *mut std::ffi::c_void = std::ptr::null_mut();
                assert_ne!(GetAce(dacl, index, &mut ace), 0);
                let ace = ace as *const ACCESS_ALLOWED_ACE;
                let sid = std::ptr::addr_of!((*ace).SidStart) as *mut std::ffi::c_void;
                entries.push(((*ace).Header.AceType, EqualSid(sid, user.sid()) != 0));
            }
            LocalFree(descriptor);
            (control & SE_DACL_PROTECTED != 0, entries)
        }
    }

    /// The saved key file grants access to her account alone: one allow
    /// entry, for her SID, and nothing inherited (no Users, no Everyone).
    #[cfg(windows)]
    #[test]
    fn the_key_file_is_readable_only_by_her_account_on_windows() {
        let root = scratch("key-acl");
        save_key(&root, KEY).unwrap();
        let (protected, entries) = windows_dacl(&root.join(KEY_FILE));
        assert!(protected, "the key file inherits its folder's entries");
        assert_eq!(
            entries,
            vec![(0, true)],
            "expected exactly one allow entry for her"
        );
        assert_eq!(load_key(&root).unwrap().as_deref(), Some(KEY));
        std::fs::remove_dir_all(&root).ok();
    }

    /// A stale `.writing` file with the folder's inherited (wider) access is
    /// replaced by a new owner-only file, not reused.
    #[cfg(windows)]
    #[test]
    fn the_key_is_never_written_into_a_readable_file_on_windows() {
        let root = scratch("key-acl-at-creation");
        let writing = root.join(KEY_FILE_WRITING);
        std::fs::write(&writing, "stale").unwrap();
        let (stale_protected, _) = windows_dacl(&writing);
        assert!(!stale_protected, "precondition: the stale file inherits");

        write_private(&writing, KEY).unwrap();
        let (protected, entries) = windows_dacl(&writing);
        assert!(protected);
        assert_eq!(entries, vec![(0, true)]);
        assert_eq!(std::fs::read_to_string(&writing).unwrap(), KEY);
        std::fs::remove_dir_all(&root).ok();
    }
}
