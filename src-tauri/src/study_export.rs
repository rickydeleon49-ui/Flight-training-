//! Saving an exported study packet or printable handout (P54-04), or a
//! printable lesson brief (P54-05).
//!
//! The webview prepares the text; this command asks her where to save it with
//! the native dialog and writes it there. The webview never names a path, and
//! nothing here reads the database, the documents folder or the network.
//!
//! The write is all-or-nothing: the bytes go to a temporary file beside the
//! destination, are flushed to disk and then renamed over it. A recoverable
//! failed save leaves any file already at that name untouched and
//! attempts to remove its temporary file. A forced process termination or an
//! OS refusal of cleanup can leave a temporary file; a partial write is never
//! renamed to the destination.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::study_packet::MAX_PACKET_BYTES;

/// A handout holds the same content plus markup; twice a packet is ample.
const MAX_HANDOUT_BYTES: u64 = 2 * MAX_PACKET_BYTES;
/// A lesson brief is one page of her own short lines; 1 MiB is far beyond
/// any real lesson and still refuses runaway input before the dialog opens.
const MAX_BRIEF_BYTES: u64 = 1024 * 1024;
const _: () = assert!(MAX_BRIEF_BYTES < MAX_HANDOUT_BYTES);
/// A calendar file contains one VCALENDAR with one VEVENT; 64 KiB is far beyond
/// any single-lesson calendar export and still refuses runaway input before the dialog opens.
const MAX_CALENDAR_BYTES: u64 = 64 * 1024;
const _: () = assert!(MAX_CALENDAR_BYTES < MAX_BRIEF_BYTES);
/// Suggested names longer than this are shortened.
const MAX_SUGGESTED_NAME_CHARS: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportKind {
    Packet,
    Handout,
    Brief,
    Calendar,
}

impl ExportKind {
    fn extension(self) -> &'static str {
        match self {
            Self::Packet => "json",
            Self::Handout | Self::Brief => "html",
            Self::Calendar => "ics",
        }
    }

    fn filter_name(self) -> &'static str {
        match self {
            Self::Packet => "Study packet",
            Self::Handout | Self::Brief => "Web page",
            Self::Calendar => "Calendar file",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Self::Packet => "Save study packet",
            Self::Handout => "Save printable handout",
            Self::Brief => "Save lesson brief",
            Self::Calendar => "Save calendar file",
        }
    }

    fn limit(self) -> u64 {
        match self {
            Self::Packet => MAX_PACKET_BYTES,
            Self::Handout => MAX_HANDOUT_BYTES,
            Self::Brief => MAX_BRIEF_BYTES,
            Self::Calendar => MAX_CALENDAR_BYTES,
        }
    }
}

/// What the webview receives after a save: the chosen file's name only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedExport {
    pub file_name: String,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportError {
    TooLarge,
    NotRegularFile,
    WriteFailed,
}

/// The serialized error: a fixed code and message, never a path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportFailure {
    pub code: &'static str,
    pub message: &'static str,
}

impl From<ExportError> for ExportFailure {
    fn from(error: ExportError) -> Self {
        let (code, message) = match error {
            ExportError::TooLarge => (
                "too_large",
                "This export is too large to save. Choose fewer parts.",
            ),
            ExportError::NotRegularFile => (
                "not_regular_file",
                "That name belongs to a folder or something other than a file. Choose another name.",
            ),
            ExportError::WriteFailed => (
                "write_failed",
                "The file could not be saved there. Nothing was changed. Try another folder.",
            ),
        };
        ExportFailure { code, message }
    }
}

/// Ask where to save, then write `contents` there.
///
/// `Ok(None)` means the dialog was cancelled and nothing was written. The
/// dialog and the write run on a blocking worker, never on the UI thread.
#[tauri::command]
pub async fn save_study_export(
    app: AppHandle,
    kind: ExportKind,
    suggested_name: String,
    contents: String,
) -> Result<Option<SavedExport>, ExportFailure> {
    // Refused before any dialog, so she is never asked where to save something
    // that cannot be saved.
    if contents.len() as u64 > kind.limit() {
        return Err(ExportError::TooLarge.into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(choice) = app
            .dialog()
            .file()
            .set_title(kind.title())
            .set_file_name(suggested_file_name(&suggested_name, kind))
            .add_filter(kind.filter_name(), &[kind.extension()])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = choice.into_path().map_err(|_| ExportError::WriteFailed)?;
        write_export(&path, contents.as_bytes(), kind.limit()).map(Some)
    })
    .await
    .map_err(|_| ExportFailure::from(ExportError::WriteFailed))?
    .map_err(ExportFailure::from)
}

/// A file name for the dialog's suggestion: no folders, no control
/// characters, a bounded length and the kind's extension.
pub(crate) fn suggested_file_name(suggested: &str, kind: ExportKind) -> String {
    let extension = kind.extension();
    let cleaned: String = suggested
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let mut stem = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let dotted = format!(".{extension}");
    if stem.to_lowercase().ends_with(&dotted) {
        stem.truncate(stem.len() - dotted.len());
    }
    let stem: String = stem
        .trim_start_matches(|c: char| c == '.' || c.is_whitespace())
        .chars()
        .take(MAX_SUGGESTED_NAME_CHARS)
        .collect();
    let stem = stem.trim();
    let stem = if stem.is_empty() {
        match kind {
            ExportKind::Calendar => "Lesson",
            _ => "Study export",
        }
    } else {
        stem
    };
    format!("{stem}.{extension}")
}

/// Write `bytes` to `path` all at once. An existing regular file at `path` is
/// replaced only after the new bytes are safely on disk.
pub(crate) fn write_export(
    path: &Path,
    bytes: &[u8],
    limit: u64,
) -> Result<SavedExport, ExportError> {
    write_export_with(path, bytes, limit, |file, bytes| {
        file.write_all(bytes)?;
        file.sync_all()
    })
}

/// Keep validation, replacement and cleanup identical when a test injects an
/// actual partial-write or flush failure. No environment or path test bypass.
fn write_export_with(
    path: &Path,
    bytes: &[u8],
    limit: u64,
    persist: impl FnOnce(&mut File, &[u8]) -> std::io::Result<()>,
) -> Result<SavedExport, ExportError> {
    if bytes.len() as u64 > limit {
        return Err(ExportError::TooLarge);
    }
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => return Err(ExportError::NotRegularFile),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(ExportError::WriteFailed),
    }
    let directory = path.parent().ok_or(ExportError::WriteFailed)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(ExportError::WriteFailed)?;
    let temporary = temporary_path(directory, name);

    /// Removes the temporary file unless the rename consumed it.
    struct Pending(Option<PathBuf>);
    impl Drop for Pending {
        fn drop(&mut self) {
            if let Some(path) = self.0.take() {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| ExportError::WriteFailed)?;
    let mut pending = Pending(Some(temporary.clone()));
    persist(&mut file, bytes).map_err(|_| ExportError::WriteFailed)?;
    drop(file);
    std::fs::rename(&temporary, path).map_err(|_| ExportError::WriteFailed)?;
    pending.0 = None;

    #[cfg(unix)]
    {
        // Best effort: the rename has already happened.
        if let Ok(dir) = File::open(directory) {
            let _ = dir.sync_all();
        }
    }

    Ok(SavedExport {
        file_name: name.to_string(),
        byte_length: bytes.len() as u64,
    })
}

fn temporary_path(directory: &Path, name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    directory.join(format!(
        ".{name}.hfd-export-{}-{nanos}.tmp",
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hfd-study-export-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn writes_exact_bytes_and_leaves_no_temporary_file() {
        let dir = scratch("write");
        let path = dir.join("Weather.json");
        let saved = write_export(&path, b"{\"a\":1}\n", MAX_PACKET_BYTES).unwrap();
        assert_eq!(
            saved,
            SavedExport {
                file_name: "Weather.json".into(),
                byte_length: 8
            }
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"{\"a\":1}\n");
        assert_eq!(entries(&dir), vec!["Weather.json".to_string()]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replaces_an_existing_file_only_with_the_complete_new_bytes() {
        let dir = scratch("replace");
        let path = dir.join("Handout.html");
        std::fs::write(&path, "old").unwrap();
        write_export(&path, b"new contents", MAX_HANDOUT_BYTES).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new contents");
        assert_eq!(entries(&dir), vec!["Handout.html".to_string()]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_a_folder_at_the_chosen_name_and_changes_nothing() {
        let dir = scratch("folder");
        let path = dir.join("Taken.json");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("inside.txt"), "keep").unwrap();
        assert_eq!(
            write_export(&path, b"x", MAX_PACKET_BYTES),
            Err(ExportError::NotRegularFile)
        );
        assert_eq!(entries(&dir), vec!["Taken.json".to_string()]);
        assert_eq!(
            std::fs::read_to_string(path.join("inside.txt")).unwrap(),
            "keep"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_at_the_chosen_name() {
        let dir = scratch("symlink");
        let target = dir.join("real.json");
        std::fs::write(&target, "keep").unwrap();
        let link = dir.join("link.json");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(
            write_export(&link, b"x", MAX_PACKET_BYTES),
            Err(ExportError::NotRegularFile)
        );
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "keep");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_folder_fails_without_creating_anything() {
        let dir = scratch("missing");
        let path = dir.join("absent").join("Packet.json");
        assert_eq!(
            write_export(&path, b"x", MAX_PACKET_BYTES),
            Err(ExportError::WriteFailed)
        );
        assert!(entries(&dir).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_rename_keeps_the_old_file_and_removes_the_temporary_one() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("readonly");
        let path = dir.join("Packet.json");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
        let result = write_export(&path, b"new", MAX_PACKET_BYTES);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        // Running as root can write anyway; then the save simply succeeds.
        if result.is_err() {
            assert_eq!(result, Err(ExportError::WriteFailed));
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        }
        assert_eq!(entries(&dir), vec!["Packet.json".to_string()]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn partial_write_failure_keeps_old_destination_and_cleans_temporary() {
        let dir = scratch("partial-write");
        let path = dir.join("Packet.json");
        std::fs::write(&path, b"original").unwrap();
        let result = write_export_with(&path, b"replacement", MAX_PACKET_BYTES, |file, bytes| {
            file.write_all(&bytes[..3])?;
            Err(std::io::Error::other("injected write failure"))
        });
        assert_eq!(result, Err(ExportError::WriteFailed));
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(entries(&dir), vec!["Packet.json"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn flush_failure_on_new_export_cleans_temporary_without_publishing() {
        let dir = scratch("flush");
        let path = dir.join("Handout.html");
        let result = write_export_with(
            &path,
            b"complete bytes",
            MAX_HANDOUT_BYTES,
            |file, bytes| {
                file.write_all(bytes)?;
                Err(std::io::Error::other("injected flush failure"))
            },
        );
        assert_eq!(result, Err(ExportError::WriteFailed));
        assert!(!path.exists());
        assert!(entries(&dir).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn persistence_panic_cleans_temporary_during_unwinding() {
        let dir = scratch("panic");
        let path = dir.join("Packet.json");
        let result = std::panic::catch_unwind(|| {
            let _ = write_export_with(&path, b"replacement", MAX_PACKET_BYTES, |file, bytes| {
                file.write_all(bytes).unwrap();
                panic!("injected persistence panic");
            });
        });
        assert!(result.is_err());
        assert!(!path.exists());
        assert!(entries(&dir).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rename_failure_after_complete_write_cleans_temporary() {
        let dir = scratch("rename-after-write");
        let path = dir.join("Taken.json");
        let result = write_export_with(&path, b"complete", MAX_PACKET_BYTES, |file, bytes| {
            file.write_all(bytes)?;
            file.sync_all()?;
            // A directory appears after the initial destination check. Rename
            // really fails here, after temporary bytes exist, on every host.
            std::fs::create_dir(&path)?;
            std::fs::write(path.join("keep"), b"keep")
        });
        assert_eq!(result, Err(ExportError::WriteFailed));
        assert_eq!(entries(&dir), vec!["Taken.json"]);
        assert_eq!(std::fs::read(path.join("keep")).unwrap(), b"keep");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_more_than_the_limit_before_writing() {
        let dir = scratch("limit");
        let path = dir.join("Big.json");
        assert_eq!(
            write_export(&path, &[b'x'; 11], 10),
            Err(ExportError::TooLarge)
        );
        assert!(entries(&dir).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_lesson_brief_is_its_own_bounded_html_kind() {
        let kind: ExportKind = serde_json::from_str("\"brief\"").unwrap();
        assert_eq!(kind, ExportKind::Brief);
        assert_eq!(kind.extension(), "html");
        assert_eq!(kind.title(), "Save lesson brief");
        assert_eq!(kind.limit(), MAX_BRIEF_BYTES);
        assert_eq!(
            suggested_file_name("Lesson brief 2026-10-24 Pattern work.json", kind),
            "Lesson brief 2026-10-24 Pattern work.json.html"
        );
        assert!(serde_json::from_str::<ExportKind>("\"Brief\"").is_err());

        let dir = scratch("brief-limit");
        let path = dir.join("Brief.html");
        let oversized = vec![b'x'; MAX_BRIEF_BYTES as usize + 1];
        assert_eq!(
            write_export(&path, &oversized, kind.limit()),
            Err(ExportError::TooLarge)
        );
        assert!(entries(&dir).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_calendar_export_is_its_own_bounded_ics_kind() {
        let kind: ExportKind = serde_json::from_str("\"calendar\"").unwrap();
        assert_eq!(kind, ExportKind::Calendar);
        assert_eq!(kind.extension(), "ics");
        assert_eq!(kind.filter_name(), "Calendar file");
        assert_eq!(kind.title(), "Save calendar file");
        assert_eq!(kind.limit(), MAX_CALENDAR_BYTES);
        assert_eq!(
            suggested_file_name("Lesson 2026-10-24 Pattern work.json", kind),
            "Lesson 2026-10-24 Pattern work.json.ics"
        );
        assert_eq!(suggested_file_name("   ", kind), "Lesson.ics");
        assert!(serde_json::from_str::<ExportKind>("\"Calendar\"").is_err());

        let dir = scratch("calendar-limit");
        let path = dir.join("Lesson.ics");
        let oversized = vec![b'x'; MAX_CALENDAR_BYTES as usize + 1];
        assert_eq!(
            write_export(&path, &oversized, kind.limit()),
            Err(ExportError::TooLarge)
        );
        assert!(entries(&dir).is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn suggested_names_are_plain_file_names_with_the_right_extension() {
        assert_eq!(
            suggested_file_name("Weather / Ch 12: METARs", ExportKind::Packet),
            "Weather Ch 12 METARs.json"
        );
        assert_eq!(
            suggested_file_name("../../etc/passwd", ExportKind::Handout),
            "etc passwd.html"
        );
        assert_eq!(
            suggested_file_name("Guide.json", ExportKind::Packet),
            "Guide.json"
        );
        assert_eq!(
            suggested_file_name("  \u{0}\n ", ExportKind::Handout),
            "Study export.html"
        );
        let long = "x".repeat(500);
        assert_eq!(
            suggested_file_name(&long, ExportKind::Packet),
            format!("{}.json", "x".repeat(MAX_SUGGESTED_NAME_CHARS))
        );
    }

    #[test]
    fn failures_never_include_a_path() {
        for error in [
            ExportError::TooLarge,
            ExportError::NotRegularFile,
            ExportError::WriteFailed,
        ] {
            let failure = ExportFailure::from(error);
            assert!(!failure.message.contains('/'));
        }
    }
}
