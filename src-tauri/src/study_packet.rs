//! Read-only native picker for structured study packets (`hfd-study-packet`).
//!
//! Slice A of the structured study import, under the owner's source-only
//! exception (docs/STRUCTURED_STUDY_IMPORT_SLICE_A_OWNER_EXCEPTION_2026-10-03.md).
//! The command opens a native dialog for one JSON file, reads it with a hard
//! bound, and returns its text for the TypeScript validator. It never copies a
//! document, creates a directory, touches the database, persists anything or
//! uses the network. The webview cannot name a path: the user picks it here.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// The contract's 4 MiB packet limit; the same number as `MAX_TEXT_BYTES`.
pub(crate) const MAX_PACKET_BYTES: u64 = 4 * 1024 * 1024;
/// File names longer than this are shortened before they reach the webview.
const MAX_FILE_NAME_CHARS: usize = 255;

/// What the webview receives. `sha256` covers the original bytes, BOM
/// included; it is for display and is not the persistence content hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedPacket {
    pub file_name: String,
    pub byte_length: u64,
    pub sha256: String,
    pub text: String,
    pub bom_removed: bool,
}

/// Every way reading can fail. Each maps to one fixed code and message that
/// never include file contents or a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PacketReadError {
    NotRegularFile,
    Empty,
    TooLarge,
    ReadFailed,
    UnsupportedEncoding,
    InvalidUtf8,
}

/// The serialized error: a fixed code and message only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PacketReadFailure {
    pub code: &'static str,
    pub message: &'static str,
}

impl PacketReadError {
    pub fn failure(self) -> PacketReadFailure {
        let (code, message) = match self {
            // A directory, pipe or device is reported like any unreadable file.
            Self::NotRegularFile | Self::ReadFailed => {
                ("file_read_failed", "The file could not be read.")
            }
            Self::Empty => ("file_empty", "The file is empty."),
            Self::TooLarge => (
                "file_too_large",
                "The file is larger than the 4 MiB limit for a study packet.",
            ),
            Self::UnsupportedEncoding => (
                "unsupported_encoding",
                "The file is not UTF-8. Export it again as UTF-8 JSON.",
            ),
            Self::InvalidUtf8 => (
                "invalid_utf8",
                "The file contains bytes that are not valid UTF-8.",
            ),
        };
        PacketReadFailure { code, message }
    }
}

impl From<PacketReadError> for PacketReadFailure {
    fn from(error: PacketReadError) -> Self {
        error.failure()
    }
}

/// Let the user choose one `.json` study packet and read it.
///
/// `Ok(None)` means the dialog was cancelled. The dialog and the read both run
/// on a blocking worker, never on the UI thread.
#[tauri::command]
pub async fn pick_study_packet(app: AppHandle) -> Result<Option<PickedPacket>, PacketReadFailure> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(choice) = app
            .dialog()
            .file()
            .set_title("Choose a study packet")
            .add_filter("Study packet", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = choice
            .into_path()
            .map_err(|_| PacketReadError::ReadFailed)?;
        read_packet_file(&path).map(Some)
    })
    .await
    .map_err(|_| PacketReadError::ReadFailed.failure())?
    .map_err(PacketReadFailure::from)
}

/// Read a packet from a path the user selected.
///
/// The path is checked to be a regular file *before* opening, so a named pipe
/// cannot block the open, and the opened handle is checked again.
pub(crate) fn read_packet_file(path: &Path) -> Result<PickedPacket, PacketReadError> {
    let metadata = std::fs::metadata(path).map_err(|_| PacketReadError::ReadFailed)?;
    if !metadata.is_file() {
        return Err(PacketReadError::NotRegularFile);
    }
    let file = File::open(path).map_err(|_| PacketReadError::ReadFailed)?;
    let opened = file.metadata().map_err(|_| PacketReadError::ReadFailed)?;
    if !opened.is_file() {
        return Err(PacketReadError::NotRegularFile);
    }
    let bytes = read_bounded(file, opened.len(), MAX_PACKET_BYTES)?;
    decode_packet(display_name(path), bytes)
}

/// The size seen before reading is checked first; then at most `limit + 1`
/// bytes are read, so a file that grows after that check is still refused.
pub(crate) fn read_bounded<R: Read>(
    reader: R,
    observed_len: u64,
    limit: u64,
) -> Result<Vec<u8>, PacketReadError> {
    if observed_len > limit {
        return Err(PacketReadError::TooLarge);
    }
    let mut bytes = Vec::with_capacity(observed_len.min(limit) as usize);
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PacketReadError::ReadFailed)?;
    if bytes.len() as u64 > limit {
        return Err(PacketReadError::TooLarge);
    }
    Ok(bytes)
}

/// Original bytes to the returned packet: hash first, then encoding checks.
pub(crate) fn decode_packet(
    file_name: String,
    bytes: Vec<u8>,
) -> Result<PickedPacket, PacketReadError> {
    if bytes.is_empty() {
        return Err(PacketReadError::Empty);
    }
    if bytes.starts_with(&[0xfe, 0xff]) || bytes.starts_with(&[0xff, 0xfe]) {
        return Err(PacketReadError::UnsupportedEncoding);
    }
    let sha256 = hex(&Sha256::digest(&bytes));
    let byte_length = bytes.len() as u64;
    let bom_removed = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let body = if bom_removed { &bytes[3..] } else { &bytes[..] };
    let text = std::str::from_utf8(body).map_err(|_| PacketReadError::InvalidUtf8)?;
    if text.is_empty() {
        return Err(PacketReadError::Empty);
    }
    Ok(PickedPacket {
        file_name,
        byte_length,
        sha256,
        text: text.to_string(),
        bom_removed,
    })
}

/// The last path component only, never the directory.
fn display_name(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name: String = name.chars().take(MAX_FILE_NAME_CHARS).collect();
    if name.is_empty() {
        "study-packet.json".to_string()
    } else {
        name
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;

    /// An owned temporary directory, removed afterwards. Never the app profile.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "hfd-study-packet-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const PACKET: &[u8] = br#"{"format":"hfd-study-packet","formatVersion":1,"title":"Invented","guide":{"summary":"x"}}"#;

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    fn padded(len: usize) -> Vec<u8> {
        let mut bytes = PACKET.to_vec();
        bytes.resize(len, b' ');
        bytes
    }

    #[test]
    fn reads_a_regular_file_and_hashes_its_original_bytes() {
        let dir = TempDir::new("plain");
        let picked = read_packet_file(&dir.file("packet.json", PACKET)).unwrap();
        assert_eq!(picked.file_name, "packet.json");
        assert_eq!(picked.byte_length, PACKET.len() as u64);
        assert_eq!(picked.sha256, sha(PACKET));
        assert_eq!(picked.text.as_bytes(), PACKET);
        assert!(!picked.bom_removed);
    }

    #[test]
    fn strips_one_utf8_bom_but_hashes_it() {
        let dir = TempDir::new("bom");
        let mut bytes = vec![0xef, 0xbb, 0xbf];
        bytes.extend_from_slice(PACKET);
        let picked = read_packet_file(&dir.file("bom.json", &bytes)).unwrap();
        assert!(picked.bom_removed);
        assert_eq!(picked.text.as_bytes(), PACKET);
        assert_eq!(picked.byte_length, bytes.len() as u64);
        assert_eq!(picked.sha256, sha(&bytes));
        assert_ne!(picked.sha256, sha(PACKET));
    }

    #[test]
    fn only_one_bom_is_stripped() {
        let mut bytes = vec![0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf];
        bytes.extend_from_slice(PACKET);
        let picked = decode_packet("x.json".into(), bytes).unwrap();
        assert!(
            picked.text.starts_with('\u{feff}'),
            "the second BOM stays for the validator to refuse"
        );
    }

    #[test]
    fn empty_files_and_a_bom_alone_are_empty() {
        let dir = TempDir::new("empty");
        assert_eq!(
            read_packet_file(&dir.file("empty.json", b"")),
            Err(PacketReadError::Empty)
        );
        assert_eq!(
            read_packet_file(&dir.file("bom-only.json", &[0xef, 0xbb, 0xbf])),
            Err(PacketReadError::Empty)
        );
    }

    #[test]
    fn accepts_exactly_the_limit_and_refuses_one_byte_more() {
        let dir = TempDir::new("limit");
        let at =
            read_packet_file(&dir.file("at.json", &padded(MAX_PACKET_BYTES as usize))).unwrap();
        assert_eq!(at.byte_length, MAX_PACKET_BYTES);
        assert_eq!(
            read_packet_file(&dir.file("over.json", &padded(MAX_PACKET_BYTES as usize + 1))),
            Err(PacketReadError::TooLarge)
        );
    }

    #[test]
    fn refuses_an_oversized_observed_length_before_reading_anything() {
        struct MustNotRead;
        impl Read for MustNotRead {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                panic!("read after the size check failed");
            }
        }
        assert_eq!(
            read_bounded(MustNotRead, MAX_PACKET_BYTES + 1, MAX_PACKET_BYTES),
            Err(PacketReadError::TooLarge)
        );
    }

    #[test]
    fn growth_after_the_size_check_is_still_refused_simulated_reader() {
        // Simulated: the observed length says 10 bytes, the stream then yields more than the limit.
        let grown = vec![b' '; MAX_PACKET_BYTES as usize + 10];
        assert_eq!(
            read_bounded(Cursor::new(grown), 10, MAX_PACKET_BYTES),
            Err(PacketReadError::TooLarge)
        );
    }

    #[test]
    fn growth_after_the_size_check_is_still_refused_real_file() {
        // Real temporary file: observe its size, append past the limit through a second handle, then read.
        let dir = TempDir::new("growth");
        let path = dir.file("growing.json", PACKET);
        let file = File::open(&path).unwrap();
        let observed = file.metadata().unwrap().len();
        let mut writer = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writer
            .write_all(&vec![b' '; MAX_PACKET_BYTES as usize])
            .unwrap();
        writer.flush().unwrap();
        assert!(observed <= MAX_PACKET_BYTES);
        assert_eq!(
            read_bounded(file, observed, MAX_PACKET_BYTES),
            Err(PacketReadError::TooLarge)
        );
    }

    #[test]
    fn refuses_invalid_utf8_and_utf16_byte_order_marks() {
        let dir = TempDir::new("encoding");
        assert_eq!(
            read_packet_file(&dir.file("bad.json", &[b'{', b'"', 0xc3, 0x28, b'"', b'}'])),
            Err(PacketReadError::InvalidUtf8)
        );
        assert_eq!(
            read_packet_file(&dir.file("overlong.json", &[b'"', 0xc0, 0xaf, b'"'])),
            Err(PacketReadError::InvalidUtf8)
        );
        assert_eq!(
            read_packet_file(&dir.file("utf16le.json", &[0xff, 0xfe, b'{', 0, b'}', 0])),
            Err(PacketReadError::UnsupportedEncoding)
        );
        assert_eq!(
            read_packet_file(&dir.file("utf16be.json", &[0xfe, 0xff, 0, b'{', 0, b'}'])),
            Err(PacketReadError::UnsupportedEncoding)
        );
    }

    #[test]
    fn requires_a_regular_file() {
        let dir = TempDir::new("kinds");
        assert_eq!(
            read_packet_file(&dir.0),
            Err(PacketReadError::NotRegularFile)
        );
        assert_eq!(
            read_packet_file(&dir.0.join("missing.json")),
            Err(PacketReadError::ReadFailed)
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_named_pipe_without_blocking() {
        let dir = TempDir::new("fifo");
        let fifo = dir.0.join("pipe.json");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(status.success());
        // Opening a FIFO for reading would block until a writer appears; the pre-open check refuses it first.
        assert_eq!(
            read_packet_file(&fifo),
            Err(PacketReadError::NotRegularFile)
        );
    }

    #[test]
    fn returns_only_the_file_name_never_the_directory() {
        let dir = TempDir::new("name");
        let path = dir.file("Private Folder Packet.json", PACKET);
        let picked = read_packet_file(&path).unwrap();
        assert_eq!(picked.file_name, "Private Folder Packet.json");
        let parent = dir.0.to_string_lossy().into_owned();
        assert!(!serde_json::to_string(&picked).unwrap().contains(&parent));
    }

    #[test]
    fn failures_are_fixed_codes_and_messages_without_contents_or_paths() {
        let dir = TempDir::new("failures");
        let secret = "SENTINEL-PRIVATE-7f3a";
        let path = dir.file(&format!("{secret}.json"), &[0xff, 0xfe, b's', 0]);
        let failure = read_packet_file(&path).unwrap_err().failure();
        let json = serde_json::to_string(&failure).unwrap();
        assert_eq!(
            json,
            r#"{"code":"unsupported_encoding","message":"The file is not UTF-8. Export it again as UTF-8 JSON."}"#
        );
        assert!(!json.contains(secret));
        for error in [
            PacketReadError::NotRegularFile,
            PacketReadError::Empty,
            PacketReadError::TooLarge,
            PacketReadError::ReadFailed,
            PacketReadError::UnsupportedEncoding,
            PacketReadError::InvalidUtf8,
        ] {
            let failure = error.failure();
            assert!(
                [
                    "file_read_failed",
                    "file_empty",
                    "file_too_large",
                    "unsupported_encoding",
                    "invalid_utf8"
                ]
                .contains(&failure.code),
                "{failure:?}"
            );
            assert!(!failure.message.contains('/'));
        }
    }

    #[test]
    fn serializes_camel_case_fields_for_the_webview() {
        let picked = decode_packet("p.json".into(), PACKET.to_vec()).unwrap();
        let value: serde_json::Value = serde_json::to_value(&picked).unwrap();
        let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            ["bomRemoved", "byteLength", "fileName", "sha256", "text"]
        );
    }

    #[test]
    fn cancellation_is_an_empty_result() {
        // The command returns Ok(None) when the dialog is dismissed; the webview receives null.
        let cancelled: Option<PickedPacket> = None;
        assert_eq!(serde_json::to_string(&cancelled).unwrap(), "null");
    }

    #[test]
    fn reading_writes_nothing_beside_the_selected_file() {
        let dir = TempDir::new("readonly");
        let path = dir.file("packet.json", PACKET);
        let before = std::fs::read_dir(&dir.0).unwrap().count();
        read_packet_file(&path).unwrap();
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), before);
        assert_eq!(std::fs::read(&path).unwrap(), PACKET);
    }
}
