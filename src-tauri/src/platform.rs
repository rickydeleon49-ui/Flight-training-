//! Platform abstraction boundary for the iOS port.
//!
//! Everything in `documents.rs`, `pdf.rs`, and `backup.rs` is already
//! platform-neutral: it operates on
//! paths handed to it by `storage::app_root`, which itself resolves through
//! Tauri's own cross-platform `app_config_dir()`. The two things that
//! genuinely differ by platform are credential storage
//! and platform identification for UI copy.
//!
//! Active credential operations call `secrets` directly; `secrets` itself
//! picks the OS secure store (macOS Keychain on Developer ID signed builds
//! or the iOS keychain) or the private file. The iOS keychain path still
//! needs real device validation. `CredentialStore` and `FileCredentialStore`
//! remain isolated scaffolding with no production behavior change.

// Not yet called from any Tauri command — see the module doc comment.
// `#[cfg(test)]` code doesn't count as usage
// for this lint, so without this the crate's normal (non-test) build would
// refuse to compile scaffolding that is deliberately not wired in yet.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::secrets;

/// Where the Gemini API key is stored, kept behind a trait so a future iOS
/// implementation can back onto Keychain without changing any call site.
///
/// See the module doc comment in `secrets.rs` for which builds use the OS
/// secure store and which keep the private file.
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

/// An adapter onto `secrets::{load_key, save_key, forget_key}` (secure store
/// with private-file fallback), not a reimplementation. Active operations in
/// `gemini.rs` call `secrets` directly. This store and trait remain isolated
/// scaffolding with no production behavior change.
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
/// e.g. hiding "reveal in Finder" (no iOS equivalent) or showing
/// iOS-specific Settings guidance.
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

/// Convenience constructor mirroring `storage::app_root`'s signature shape,
/// for the day `gemini.rs` is wired through the trait instead of calling
/// `secrets` directly.
pub fn file_credential_store(root: &Path) -> FileCredentialStore {
    FileCredentialStore::new(root.to_path_buf())
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
        let store = file_credential_store(&root);

        assert_eq!(store.load().unwrap(), None);

        store.save("test-key-value").unwrap();
        assert_eq!(store.load().unwrap(), Some("test-key-value".to_string()));

        store.forget().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }

    #[test]
    fn forgetting_an_absent_key_is_not_an_error() {
        let root = scratch("forget-absent");
        let store = file_credential_store(&root);
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
