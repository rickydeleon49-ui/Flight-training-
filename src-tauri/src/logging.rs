//! The app's own log file (WINSTATE-01, owner-approved 29 October 2026).
//!
//! Messages go to a small rotating file in the system log folder
//! (`~/Library/Logs/com.herflightdeck.app/her-flight-deck.log` on a Mac), so
//! a bug report is one file, and also to stdout in debug builds. Nothing
//! about it is visible to her: no setting, no screen, no webview command.
//!
//! Privacy: a log line is a fixed sentence plus, at most, an error *kind* or
//! a platform error that carries no data of hers. It never holds an API key,
//! file contents, PDF text, her notes, a file name, or a path inside her data
//! folder. Error strings built by the backup and document code often name
//! paths and documents, so those are left out of the log entirely. Only this
//! crate's own messages are recorded: other libraries' logs (HTTP, SQL,
//! webview) are switched off, so a request URL or SQL statement can never
//! reach the file. A source test below enforces the call-site rules.

use tauri::AppHandle;
pub(crate) use tauri_plugin_log::log;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// One file stays small enough to attach to a message.
const MAX_LOG_FILE_BYTES: u128 = 1024 * 1024;
/// Rotated files kept beside the active one.
const KEPT_OLD_LOG_FILES: usize = 1;
const LOG_FILE_NAME: &str = "her-flight-deck";
// At most a few megabytes on her disk. `KeepSome(0)` would underflow inside
// the plugin's rotation, so at least one old file is kept.
const _: () = assert!(MAX_LOG_FILE_BYTES <= 2 * 1024 * 1024);
const _: () = assert!(KEPT_OLD_LOG_FILES >= 1 && KEPT_OLD_LOG_FILES <= 2);

/// Start recording this crate's messages. A logging problem must never stop
/// her opening the app, so any failure here leaves logging off and carries on.
/// The plugin's webview command is never registered: only the Rust side logs.
pub fn attach(app: &AppHandle) {
    let mut builder = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.into()),
        }))
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_OLD_LOG_FILES))
        .level(log::LevelFilter::Off)
        .level_for(env!("CARGO_CRATE_NAME"), log::LevelFilter::Info);
    if cfg!(debug_assertions) {
        builder = builder.target(Target::new(TargetKind::Stdout));
    }
    if let Ok((_unregistered_plugin, max_level, logger)) = builder.split(app) {
        let _ = tauri_plugin_log::attach_logger(max_level, logger);
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// Production part of a source file: everything before its
    /// `#[cfg(test)]` + `mod tests` block, line endings normalized.
    fn production_source(source: &str) -> String {
        let normalized = source.replace("\r\n", "\n");
        let boundary = [
            "\n#[cfg(test)]\nmod tests",
            "\n#[cfg(test)]\npub(crate) mod tests",
        ]
        .iter()
        .filter_map(|marker| normalized.find(marker))
        .min();
        match boundary {
            Some(boundary) => normalized[..boundary].to_string(),
            None => normalized,
        }
    }

    fn is_test_only_file(name: &str) -> bool {
        name.ends_with("_tests.rs") || name == "fake_gemini.rs" || name == "test_wait.rs"
    }

    fn production_sources() -> Vec<(String, String)> {
        let mut files = Vec::new();
        let mut pending = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
        while let Some(dir) = pending.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    pending.push(path);
                    continue;
                }
                let name = path.file_name().unwrap().to_string_lossy().to_string();
                if path.extension().is_some_and(|e| e == "rs") && !is_test_only_file(&name) {
                    let source = std::fs::read_to_string(&path).unwrap();
                    files.push((name, production_source(&source)));
                }
            }
        }
        assert!(files.len() > 20, "the scan must see the crate's sources");
        files
    }

    /// The text of every `trace!`/`debug!`/`info!`/`warn!`/`error!` call,
    /// from the macro name to its closing parenthesis.
    fn log_calls(source: &str) -> Vec<String> {
        let mut calls = Vec::new();
        for level in ["trace", "debug", "info", "warn", "error"] {
            let needle = format!("{level}!(");
            let mut from = 0;
            while let Some(found) = source[from..].find(&needle) {
                let start = from + found;
                let before = source[..start].chars().next_back();
                from = start + needle.len();
                if before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
                    continue;
                }
                let mut depth = 1;
                let mut end = from;
                for (offset, c) in source[from..].char_indices() {
                    match c {
                        '(' => depth += 1,
                        ')' => depth -= 1,
                        _ => {}
                    }
                    if depth == 0 {
                        end = from + offset;
                        break;
                    }
                }
                calls.push(source[start..=end].to_string());
            }
        }
        calls
    }

    /// Words that would put a secret, her content, or a path into the log.
    const FORBIDDEN_IN_LOG_CALLS: [&str; 11] = [
        "key",
        "secret",
        "token",
        "password",
        "credential",
        "path",
        "display()",
        "content",
        "text",
        "note",
        "reason",
    ];

    fn offending_word(call: &str) -> Option<&'static str> {
        let lower = call.to_lowercase();
        FORBIDDEN_IN_LOG_CALLS
            .into_iter()
            .find(|word| lower.contains(word))
    }

    #[test]
    fn no_log_call_formats_a_secret_her_content_or_a_path() {
        let mut seen = 0;
        for (name, source) in production_sources() {
            for call in log_calls(&source) {
                seen += 1;
                assert_eq!(
                    offending_word(&call),
                    None,
                    "{name}: a log call may not mention secrets, her content or paths: {call}"
                );
            }
        }
        assert!(seen >= 20, "expected the converted log calls, saw {seen}");
    }

    #[test]
    fn production_code_does_not_print_to_the_terminal() {
        for (name, source) in production_sources() {
            for print in ["println!(", "eprintln!(", "print!(", "eprint!(", "dbg!("] {
                let hits = source
                    .match_indices(print)
                    .filter(|(at, _)| {
                        !source[..*at]
                            .chars()
                            .next_back()
                            .is_some_and(|c| c.is_alphanumeric() || c == '_')
                    })
                    .count();
                assert_eq!(hits, 0, "{name} uses {print}; use the log macros");
            }
        }
    }

    #[test]
    fn the_scan_catches_a_key_a_path_and_her_text() {
        let source = r#"
            log::warn!("Gemini refused {api_key}");
            log::error!("Could not copy {}", path.display());
            log::info!("Page said {page_text:?}");
            log::warn!("Fine sentence with an {kind:?}");
        "#;
        let calls = log_calls(source);
        assert_eq!(calls.len(), 4);
        let mut flagged: Vec<_> = calls.iter().filter_map(|c| offending_word(c)).collect();
        flagged.sort_unstable();
        assert_eq!(flagged, vec!["key", "path", "text"]);
    }

    #[test]
    fn the_webview_gets_no_log_or_window_state_permission() {
        let capabilities = include_str!("../capabilities/default.json");
        assert!(!capabilities.contains("\"log:"));
        assert!(!capabilities.contains("window-state:"));
    }
}
