//! Platform abstraction boundary for the iOS port.
//!
//! Everything in `documents.rs`, `pdf.rs`, and `backup.rs` is already
//! platform-neutral — see `docs/ios/ARCHITECTURE.md` §1: it operates on
//! paths handed to it by `storage::app_root`, which itself resolves through
//! Tauri's own cross-platform `app_config_dir()`. The two things that
//! genuinely differ by platform are credential storage (§4 of that document)
//! and platform identification for UI copy.
//!
//! Only the desktop implementations below are wired into the running app.
//! An iOS `CredentialStore` needs Apple's Keychain Protected Store (via the
//! `keyring` crate's iOS backend — already a dependency, see `gemini.rs`'s
//! legacy-migration use of it) and cannot be written with confidence until
//! it can be built and exercised on a Mac with the iOS SDK. See
//! `docs/ios/SETUP.md` Step 6.

// Not yet called from any Tauri command — see the module doc comment and
// `docs/ios/ARCHITECTURE.md` §3. `#[cfg(test)]` code doesn't count as usage
// for this lint, so without this the crate's normal (non-test) build would
// refuse to compile scaffolding that is deliberately not wired in yet.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::secrets;

/// Where the Gemini API key is stored, kept behind a trait so a future iOS
/// implementation can back onto Keychain without changing any call site.
///
/// Desktop deliberately does **not** use the OS keychain — see the module
/// doc comment in `secrets.rs` for why an unsigned, frequently-updated
/// desktop build makes that the wrong choice there. That reasoning does not
/// apply to iOS, where every build (development, TestFlight, or App Store)
/// carries a stable signing identity and Keychain items persist correctly
/// across updates. See `docs/ios/ARCHITECTURE.md` §4.
pub trait CredentialStore {
    /// The stored key, or `None` if nothing has been saved yet. Distinct
    /// from an error: a store that cannot say whether a key exists is not
    /// the same as one that has confirmed there isn't one.
    fn load(&self) -> Result<Option<String>, String>;
    /// Save the key, replacing any previous one.
    fn save(&self, key: &str) -> Result<(), String>;
    /// Remove the stored key. Not having one is not a failure.
    fn forget(&self) -> Result<(), String>;
}

/// Desktop's existing credential store: a plain file beside the database.
///
/// This delegates to `secrets::{load_key, save_key, forget_key}` unchanged —
/// it is an adapter onto already-shipped, already-tested behavior, not a
/// reimplementation. Wiring `gemini.rs`'s commands through this trait
/// instead of calling `secrets` directly is left for when an iOS
/// implementation actually exists to select between; doing so today would
/// change working code for a platform that cannot yet be built or tested.
pub struct FileCredentialStore {
    root: PathBuf,
}

impl FileCredentialStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

impl CredentialStore for FileCredentialStore {
    fn load(&self) -> Result<Option<String>, String> {
        secrets::load_key(&self.root)
    }

    fn save(&self, key: &str) -> Result<(), String> {
        secrets::save_key(&self.root, key)
    }

    fn forget(&self) -> Result<(), String> {
        secrets::forget_key(&self.root)
    }
}

/// What platform the app is running on, for UI copy and capability gating —
/// e.g. hiding "reveal in Finder" (no iOS equivalent, see
/// `docs/ios/ARCHITECTURE.md` §5.4) or showing iOS-specific Settings
/// guidance (`docs/ios/SETUP.md`, `docs/ios/TESTFLIGHT.md`).
pub trait PlatformInfo {
    /// One of `"macos"`, `"windows"`, `"linux"`, or `"ios"`.
    fn name(&self) -> &'static str;
    /// True for a touch-first platform whose UI needs the iPhone/iPad
    /// adaptations described in Milestone 4, false for desktop.
    fn is_mobile(&self) -> bool;
}

/// The current build's platform, determined at compile time.
///
/// This intentionally covers every `target_os` this crate can be compiled
/// for today (desktop) plus `ios`, so that adding the iOS target in
/// Milestone 3 does not require touching this match again — only building
/// and wiring the crate for that target, which this environment cannot do.
pub struct CompiledPlatformInfo;

impl PlatformInfo for CompiledPlatformInfo {
    fn name(&self) -> &'static str {
        if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "ios") {
            "ios"
        } else {
            "linux"
        }
    }

    fn is_mobile(&self) -> bool {
        cfg!(target_os = "ios") || cfg!(target_os = "android")
    }
}

#[cfg(target_os = "ios")]
pub struct KeychainCredentialStore;

#[cfg(target_os = "ios")]
impl CredentialStore for KeychainCredentialStore {
    fn load(&self) -> Result<Option<String>, String> {
        // A genuine implementation will use keyring::Entry here, which is already a dependency.
        Err("Keychain implementation pending Mac compilation".to_string())
    }
    fn save(&self, _key: &str) -> Result<(), String> {
        Err("Keychain implementation pending Mac compilation".to_string())
    }
    fn forget(&self) -> Result<(), String> {
        Err("Keychain implementation pending Mac compilation".to_string())
    }
}

/// Convenience constructor returning the active credential store for the current platform.
pub fn active_credential_store(root: &Path) -> Box<dyn CredentialStore> {
    #[cfg(target_os = "ios")]
    {
        let _ = root; // Root path is not needed for Keychain
        Box::new(KeychainCredentialStore)
    }
    #[cfg(not(target_os = "ios"))]
    {
        Box::new(FileCredentialStore::new(root.to_path_buf()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "her-flight-deck-platform-test-{label}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_file_credential_store_round_trips_through_the_existing_secrets_module() {
        let root = scratch("round-trip");
        let store = active_credential_store(&root);

        assert_eq!(store.load().unwrap(), None);

        store.save("test-key-value").unwrap();
        assert_eq!(store.load().unwrap(), Some("test-key-value".to_string()));

        store.forget().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }

    #[test]
    fn forgetting_an_absent_key_is_not_an_error() {
        let root = scratch("forget-absent");
        let store = active_credential_store(&root);
        store.forget().unwrap();
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    #[test]
    fn compiled_platform_info_never_reports_ios_or_mobile_on_this_desktop_build() {
        // This crate is compiled for a desktop target in every environment
        // that can run `cargo test` today — there is no iOS toolchain here
        // to compile the `target_os = "ios"` branch against, so the only
        // thing this test can honestly assert is what desktop reports.
        let info = CompiledPlatformInfo;
        assert!(!info.is_mobile());
        assert_ne!(info.name(), "ios");
    }
}
