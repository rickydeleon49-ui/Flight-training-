//! Content-addressed PDF store inside the sync folder: `blobs/<sha256>`.
//!
//! Blobs are written once and verified on every read. Nothing here follows a
//! symlink, reads more than the cap plus one byte, or names a path in an error.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::documents::{contained_document_path, DOCUMENTS_DIR};

pub(crate) const BLOBS_DIR: &str = "blobs";
pub(crate) const MAX_BLOB_BYTES: u64 = crate::pdf::MAX_PDF_BYTES;

#[derive(Debug)]
pub(crate) enum BlobError {
    BadName,
    TooLarge,
    ShaMismatch,
    NotAFile,
    Missing,
    NoIdentity,
    BadMaterialPath,
    LocalFileDiffers,
    Io(std::io::ErrorKind),
    Db(rusqlite::Error),
}

impl std::fmt::Display for BlobError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::BadName => "the file name is not a content hash",
            Self::TooLarge => "the file is larger than 50 MB",
            Self::ShaMismatch => "the file content does not match its hash",
            Self::NotAFile => "the file is not a regular file",
            Self::Missing => "the file has not arrived yet",
            Self::NoIdentity => "the PDF has not been checked on this device yet",
            Self::BadMaterialPath => "the PDF path is not valid",
            Self::LocalFileDiffers => "a different file is already in the library",
            Self::Io(_) => "the sync folder could not be read or written",
            Self::Db(_) => "the library could not be read",
        })
    }
}

impl std::error::Error for BlobError {}

impl From<std::io::Error> for BlobError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.kind())
    }
}

impl From<rusqlite::Error> for BlobError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Db(e)
    }
}

pub(crate) fn is_blob_name(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn blob_relative_path(sha: &str) -> Option<String> {
    is_blob_name(sha).then(|| format!("{BLOBS_DIR}/{sha}"))
}

fn blob_path(sync_root: &Path, sha: &str) -> Result<PathBuf, BlobError> {
    if !is_blob_name(sha) {
        return Err(BlobError::BadName);
    }
    Ok(sync_root.join(BLOBS_DIR).join(sha))
}

pub(crate) fn blob_exists(sync_root: &Path, sha: &str) -> Result<bool, BlobError> {
    match std::fs::symlink_metadata(blob_path(sync_root, sha)?) {
        Ok(m) => Ok(m.is_file()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PutOutcome {
    Written { sha256: String, bytes: u64 },
    AlreadyPresent { sha256: String, bytes: u64 },
}

/// Removes its file on drop unless disarmed, so a failure leaves no temp.
struct TempGuard(Option<PathBuf>);

impl TempGuard {
    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for TempGuard {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            let _ = std::fs::remove_file(p);
        }
    }
}

fn unique_suffix() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{nanos}", std::process::id())
}

fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// Copy at most the cap (+1 to detect overflow) from `source`, hashing as it
/// goes. Returns the hex digest and the byte count.
fn stream<R: Read, W: Write>(source: R, sink: &mut W) -> Result<(String, u64), BlobError> {
    let mut limited = source.take(MAX_BLOB_BYTES + 1);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let n = match limited.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e.into()),
        };
        total += n as u64;
        if total > MAX_BLOB_BYTES {
            return Err(BlobError::TooLarge);
        }
        hasher.update(&buf[..n]);
        sink.write_all(&buf[..n])?;
    }
    Ok((hex::encode(hasher.finalize()), total))
}

/// SHA-256 of a regular file, bounded by the cap.
fn hash_file(path: &Path) -> Result<(String, u64), BlobError> {
    stream(File::open(path)?, &mut std::io::sink())
}

pub(crate) fn put_blob_from_file(
    sync_root: &Path,
    source: &Path,
    expected_sha: Option<&str>,
) -> Result<PutOutcome, BlobError> {
    let meta = std::fs::symlink_metadata(source)?;
    if !meta.is_file() {
        return Err(BlobError::NotAFile);
    }
    if meta.len() > MAX_BLOB_BYTES {
        return Err(BlobError::TooLarge);
    }
    put_blob(sync_root, File::open(source)?, expected_sha)
}

pub(crate) fn put_blob<R: Read>(
    sync_root: &Path,
    source: R,
    expected_sha: Option<&str>,
) -> Result<PutOutcome, BlobError> {
    if expected_sha.is_some_and(|s| !is_blob_name(s)) {
        return Err(BlobError::BadName);
    }
    let dir = sync_root.join(BLOBS_DIR);
    std::fs::create_dir_all(&dir)?;
    let temp = dir.join(format!(".tmp-{}", unique_suffix()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let mut guard = TempGuard(Some(temp.clone()));
    let (sha, bytes) = stream(source, &mut file)?;
    if expected_sha.is_some_and(|e| e != sha) {
        return Err(BlobError::ShaMismatch);
    }
    file.sync_all()?;
    drop(file);
    install_verified(&dir, &temp, &mut guard, sha, bytes)
}

/// Move a verified temp to `blobs/<sha>`: leave a matching blob alone, repair
/// a corrupt regular file, refuse anything else.
fn install_verified(
    dir: &Path,
    temp: &Path,
    guard: &mut TempGuard,
    sha: String,
    bytes: u64,
) -> Result<PutOutcome, BlobError> {
    let target = dir.join(&sha);
    match std::fs::symlink_metadata(&target) {
        Ok(m) if m.is_file() => {
            if hash_file(&target).is_ok_and(|(h, _)| h == sha) {
                return Ok(PutOutcome::AlreadyPresent { sha256: sha, bytes });
            }
            // Corrupt copy: the verified temp has the right bytes for this
            // name, so replacing loses nothing.
        }
        Ok(_) => return Err(BlobError::NotAFile),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    // The only writer that can race the checks above is another put of the same
    // sha, whose bytes are identical, so the rename never changes content.
    std::fs::rename(temp, &target)?;
    guard.disarm();
    sync_dir(dir);
    Ok(PutOutcome::Written { sha256: sha, bytes })
}

pub(crate) fn read_blob_into<W: Write>(
    sync_root: &Path,
    sha: &str,
    sink: &mut W,
) -> Result<u64, BlobError> {
    let path = blob_path(sync_root, sha)?;
    match std::fs::symlink_metadata(&path) {
        Ok(m) if m.is_file() => {}
        Ok(_) => return Err(BlobError::NotAFile),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(BlobError::Missing),
        Err(e) => return Err(e.into()),
    }
    read_verified(File::open(path)?, sha, sink)
}

fn read_verified<R: Read, W: Write>(source: R, sha: &str, sink: &mut W) -> Result<u64, BlobError> {
    let (actual, bytes) = stream(source, sink)?;
    if actual != sha {
        return Err(BlobError::ShaMismatch);
    }
    Ok(bytes)
}

pub(crate) fn read_blob(sync_root: &Path, sha: &str) -> Result<Vec<u8>, BlobError> {
    let mut out = Vec::new();
    read_blob_into(sync_root, sha, &mut out)?;
    Ok(out)
}

pub(crate) struct MaterialFile {
    pub material_id: String,
    pub relative_path: String,
    pub content_sha256: String,
}

pub(crate) enum MaterialBlob {
    NoFile,
    Unverified { relative_path: String },
    Ready(MaterialFile),
}

pub(crate) fn material_blob(
    conn: &Connection,
    material_id: &str,
) -> Result<Option<MaterialBlob>, BlobError> {
    let row: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT m.file_path, i.content_sha256 FROM study_materials m \
             LEFT JOIN material_content_identities i ON i.material_id = m.id WHERE m.id = ?1",
            [material_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((path, sha)) = row else {
        return Ok(None);
    };
    let Some(relative_path) = path.filter(|p| !p.trim().is_empty()) else {
        return Ok(Some(MaterialBlob::NoFile));
    };
    let Some(content_sha256) = sha else {
        return Ok(Some(MaterialBlob::Unverified { relative_path }));
    };
    if !is_blob_name(&content_sha256) {
        return Err(BlobError::BadName);
    }
    Ok(Some(MaterialBlob::Ready(MaterialFile {
        material_id: material_id.to_string(),
        relative_path,
        content_sha256,
    })))
}

pub(crate) fn materials_with_sha(conn: &Connection, sha: &str) -> Result<Vec<String>, BlobError> {
    if !is_blob_name(sha) {
        return Err(BlobError::BadName);
    }
    let mut stmt = conn.prepare(
        "SELECT material_id FROM material_content_identities WHERE content_sha256 = ?1 \
         ORDER BY material_id",
    )?;
    let ids = stmt
        .query_map([sha], |r| r.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(ids)
}

fn ready_material(
    conn: &Connection,
    app_root: &Path,
    material_id: &str,
) -> Result<Option<(PathBuf, String)>, BlobError> {
    match material_blob(conn, material_id)? {
        None | Some(MaterialBlob::NoFile) => Ok(None),
        Some(MaterialBlob::Unverified { .. }) => Err(BlobError::NoIdentity),
        Some(MaterialBlob::Ready(f)) => {
            let path = contained_document_path(&app_root.join(DOCUMENTS_DIR), &f.relative_path)
                .map_err(|_| BlobError::BadMaterialPath)?;
            Ok(Some((path, f.content_sha256)))
        }
    }
}

pub(crate) fn publish_material_blob(
    conn: &Connection,
    app_root: &Path,
    sync_root: &Path,
    material_id: &str,
) -> Result<Option<PutOutcome>, BlobError> {
    let Some((path, sha)) = ready_material(conn, app_root, material_id)? else {
        return Ok(None);
    };
    put_blob_from_file(sync_root, &path, Some(&sha)).map(Some)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PlaceOutcome {
    Placed { bytes: u64 },
    AlreadyPresent,
    NotYetAvailable,
}

pub(crate) fn place_material_blob(
    conn: &Connection,
    app_root: &Path,
    sync_root: &Path,
    material_id: &str,
) -> Result<Option<PlaceOutcome>, BlobError> {
    place_material_blob_with(
        conn,
        app_root,
        sync_root,
        material_id,
        |sha, sink| read_blob_into(sync_root, sha, sink),
        || {},
    )
}

/// `fill` streams the verified blob into the temp file; `before_link` runs
/// just before the target is created (a seam for the race test).
pub(crate) fn place_material_blob_with(
    conn: &Connection,
    app_root: &Path,
    sync_root: &Path,
    material_id: &str,
    fill: impl FnOnce(&str, &mut File) -> Result<u64, BlobError>,
    before_link: impl FnOnce(),
) -> Result<Option<PlaceOutcome>, BlobError> {
    let Some((target, sha)) = ready_material(conn, app_root, material_id)? else {
        return Ok(None);
    };
    match std::fs::symlink_metadata(&target) {
        Ok(m) if m.is_file() => {
            return match hash_file(&target) {
                Ok((h, _)) if h == sha => Ok(Some(PlaceOutcome::AlreadyPresent)),
                Ok(_) | Err(BlobError::TooLarge) => Err(BlobError::LocalFileDiffers),
                Err(e) => Err(e),
            };
        }
        Ok(_) => return Err(BlobError::LocalFileDiffers),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    if !blob_exists(sync_root, &sha)? {
        return Ok(Some(PlaceOutcome::NotYetAvailable));
    }
    let parent = target.parent().ok_or(BlobError::BadMaterialPath)?;
    std::fs::create_dir_all(parent)?;
    let temp = parent.join(format!(".hfd-blob-{}-{}.tmp", &sha[..8], unique_suffix()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let _guard = TempGuard(Some(temp.clone()));
    let bytes = match fill(&sha, &mut file) {
        Ok(b) => b,
        // A cloud placeholder that cannot be read yet is not an error.
        Err(BlobError::Io(_) | BlobError::Missing) => {
            return Ok(Some(PlaceOutcome::NotYetAvailable))
        }
        Err(e) => return Err(e),
    };
    file.sync_all()?;
    drop(file);
    before_link();
    // The library folder is inside the app sandbox, so a hard link is safe here
    // and refuses to replace a file that appeared since the check above.
    match std::fs::hard_link(&temp, &target) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(BlobError::LocalFileDiffers)
        }
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::Unsupported | std::io::ErrorKind::PermissionDenied
            ) =>
        {
            // No hard links on this volume: re-check, then rename. A file created
            // in the gap between the two calls would be replaced; the window is
            // a few microseconds inside the app's own folder.
            if std::fs::symlink_metadata(&target).is_ok() {
                return Err(BlobError::LocalFileDiffers);
            }
            std::fs::rename(&temp, &target)?;
        }
        Err(e) => return Err(e.into()),
    }
    sync_dir(parent);
    Ok(Some(PlaceOutcome::Placed { bytes }))
}
