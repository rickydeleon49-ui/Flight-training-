//! Small local notices, outside SQLite and the portable backup allowlist.
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::backup::StartupRestoreDecision;
use crate::logging::log;
use crate::storage::app_root;

static RESTORE_NOTE_THIS_RUN: Mutex<Option<&'static str>> = Mutex::new(None);
static UPGRADE_FAILED_THIS_RUN: AtomicBool = AtomicBool::new(false);

const UPGRADE_FAILED: &str = "upgrade-copy-failed";
const RESTORE_OUTCOME: &str = "last-restore-outcome.txt";
const REFUSED: &str = "The backup couldn't be put back, so your current data was left unchanged.";
const RECOVERED: &str = "The backup couldn't be put back, so your previous data was recovered.";

pub(crate) fn record_upgrade_failure(root: &Path) {
    UPGRADE_FAILED_THIS_RUN.store(true, Ordering::Relaxed);
    // Never overwrite an existing path (including a symlink). The marker
    // needs no payload; keeping this launch's status also covers a full disk.
    if let Err(error) = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join(UPGRADE_FAILED))
    {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            return;
        }
        log::error!("Could not record the failed pre-update safety copy notice.");
    }
}

pub(crate) fn clear_upgrade_failure(root: &Path) {
    UPGRADE_FAILED_THIS_RUN.store(false, Ordering::Relaxed);
    clear_notice(root, UPGRADE_FAILED);
}

fn clear_notice(root: &Path, name: &str) {
    if let Err(error) = std::fs::remove_file(root.join(name)) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("Could not clear a data safety notice.");
        }
    }
}

fn upgrade_failed_in(root: &Path) -> bool {
    // An unreadable marker is not evidence that the safety copy succeeded.
    !matches!(std::fs::symlink_metadata(root.join(UPGRADE_FAILED)), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
}

#[tauri::command]
pub fn upgrade_copy_failed(app: AppHandle) -> Result<bool, String> {
    Ok(UPGRADE_FAILED_THIS_RUN.load(Ordering::Relaxed) || upgrade_failed_in(&app_root(&app)?))
}

fn restore_sentence(decision: &StartupRestoreDecision) -> Option<&'static str> {
    match decision {
        StartupRestoreDecision::StagingRefusedUnchanged { .. } => Some(REFUSED),
        StartupRestoreDecision::RolledBackRecovered { .. } => Some(RECOVERED),
        _ => None,
    }
}

pub(crate) fn record_restore_outcome(root: &Path, decision: &StartupRestoreDecision) {
    if let Some(sentence) = restore_sentence(decision) {
        if let Ok(mut note) = RESTORE_NOTE_THIS_RUN.lock() {
            *note = Some(sentence);
        }
        // Create without following or overwriting any existing path. If a
        // previous notice is still present, the current launch uses its own
        // outcome below; either persisted sentence honestly reports a failure.
        use std::io::Write;
        let saved = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join(RESTORE_OUTCOME))
            .and_then(|mut file| {
                file.write_all(sentence.as_bytes())?;
                file.sync_all()
            });
        if saved.is_err() {
            log::error!("Could not record the restore outcome notice.");
        }
    }
}

fn read_restore_outcome(root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(root.join(RESTORE_OUTCOME)).ok()?;
    // Never show arbitrary file contents as a message.
    matches!(text.as_str(), REFUSED | RECOVERED).then_some(text)
}

pub(crate) fn show_restore_outcome(app: &AppHandle) {
    let Ok(root) = app_root(app) else { return };
    let current = RESTORE_NOTE_THIS_RUN
        .lock()
        .ok()
        .and_then(|mut note| note.take());
    if let Some(sentence) = current
        .map(str::to_owned)
        .or_else(|| read_restore_outcome(&root))
    {
        app.dialog()
            .message(sentence)
            .title("Your data")
            .show(move |_| clear_notice(&root, RESTORE_OUTCOME));
    }
}

fn blocked_startup_message(folder: &Path) -> String {
    format!(
        "Her Flight Deck stopped before opening so nothing would be lost. Your data is safe in {}. Please send this message to whoever helps you with the app.",
        folder.display()
    )
}

/// Preserve the existing continue/block decision, replacing only its wording.
pub(crate) fn startup_gate(
    outcome: Result<bool, String>,
    folder: Option<&Path>,
) -> Result<bool, String> {
    outcome.map_err(|_| match folder {
        Some(folder) => blocked_startup_message(folder),
        None => "Her Flight Deck stopped before opening so nothing would be lost. Please send this message to whoever helps you with the app.".into(),
    })
}

pub(crate) fn show_blocked_startup(app: &AppHandle, message: String) {
    // The root contains both active data and any protected recovery folders.
    // Keep paths and internal restore diagnostics out of the log.
    log::error!(
        "Her Flight Deck stopped before opening to protect data after an unresolved restore."
    );
    let handle = app.clone();
    // An asynchronous native dialog keeps the main event loop available. No
    // webview has been created on this path, so SQLite cannot be opened.
    app.dialog()
        .message(message)
        .title("Your data")
        .show(move |_| handle.exit(1));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "hfd-notices-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        root
    }

    #[test]
    fn upgrade_notice_is_written_and_cleared() {
        let root = scratch();
        assert!(!upgrade_failed_in(&root));
        record_upgrade_failure(&root);
        assert!(upgrade_failed_in(&root));
        clear_upgrade_failure(&root);
        assert!(!upgrade_failed_in(&root));
        clear_upgrade_failure(&root);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restore_outcome_survives_a_normal_start_and_is_cleared_after_display() {
        let root = scratch();
        for (decision, sentence) in [
            (
                StartupRestoreDecision::StagingRefusedUnchanged {
                    reason: "internal".into(),
                },
                REFUSED,
            ),
            (
                StartupRestoreDecision::RolledBackRecovered {
                    reason: "internal".into(),
                },
                RECOVERED,
            ),
        ] {
            record_restore_outcome(&root, &decision);
            record_restore_outcome(&root, &StartupRestoreDecision::ProceedNormally);
            assert_eq!(read_restore_outcome(&root).as_deref(), Some(sentence));
            clear_notice(&root, RESTORE_OUTCOME);
            assert_eq!(read_restore_outcome(&root), None);
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_gate_keeps_errors_blocked_and_successes_unchanged_without_panicking() {
        let folder = Path::new("/fictional/data");
        assert_eq!(startup_gate(Ok(false), Some(folder)), Ok(false));
        assert_eq!(startup_gate(Ok(true), Some(folder)), Ok(true));
        let result = startup_gate(Err("internal obstruction details".into()), Some(folder));
        assert_eq!(result, Err(blocked_startup_message(folder)));
        let message = startup_gate(Err("internal".into()), None).unwrap_err();
        assert!(message.contains("stopped before opening"));
        assert!(!message.contains("internal"));
    }

    #[test]
    fn blocked_message_names_the_protected_folder_without_internal_instructions() {
        let message = blocked_startup_message(Path::new("/fictional/data"));
        assert_eq!(message, "Her Flight Deck stopped before opening so nothing would be lost. Your data is safe in /fictional/data. Please send this message to whoever helps you with the app.");
        assert_eq!(
            restore_sentence(&StartupRestoreDecision::BlockedUnresolved {
                reason: "obstruction".into(),
                recovery_folder: None
            }),
            None
        );
    }
}
