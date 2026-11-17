//! Optional figure packs (BL-80, part 4b): a small zip of extra figure images
//! (for example sectional chart excerpts) that the student downloads once.
//!
//! The webview passes a pack id, the https address, the pinned SHA-256 and the
//! expected size. Nothing is trusted from the network: the address host is
//! checked before the request and again for the final (redirected) address,
//! the body is capped, the zip must hash to the pinned SHA-256, every entry is
//! validated (flat `*.webp` names or `pack.json` only, each under 3 MB) and
//! each image must match the hash listed in `pack.json`. The pack is built in
//! a temp folder and renamed into place, so a failed or cancelled download
//! leaves nothing behind. Nothing is sent but one GET per click.
use crate::gemini_cancel::{CancelToken, Cancellable};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

const MIB: u64 = 1024 * 1024;
const PACKS_DIR: &str = "figure-packs";
const TMP_DIR: &str = ".tmp";
const MAX_FILE_BYTES: u64 = 3 * MIB;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ENTRIES: usize = 200;
const SLACK_BYTES: u64 = MIB;
const TOTAL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PROGRESS_EVERY: Duration = Duration::from_millis(100);
const PREFIX_GITHUB: &str = "https://github.com/rickydeleon49-ui/";
const PREFIX_OBJECTS: &str = "https://objects.githubusercontent.com/";

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub(crate) fn valid_file(name: &str) -> bool {
    match name.strip_suffix(".webp") {
        Some(stem) => valid_id(stem) && name.len() <= 80,
        None => false,
    }
}

/// The address the webview may ask for (before any request).
pub(crate) fn check_start_url(address: &str) -> Result<(), String> {
    let bad = || "That download address is not allowed.".to_string();
    if !(address.starts_with(PREFIX_GITHUB) || address.starts_with(PREFIX_OBJECTS)) {
        return Err(bad());
    }
    let url = reqwest::Url::parse(address).map_err(|_| bad())?;
    if url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.fragment().is_none()
    {
        Ok(())
    } else {
        Err(bad())
    }
}

/// A host the download may be at, including after redirects.
pub(crate) fn host_allowed(url: &reqwest::Url) -> bool {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return false;
    }
    match url.host_str() {
        Some(host) => {
            host == "github.com"
                || host == "githubusercontent.com"
                || host.ends_with(".githubusercontent.com")
        }
        None => false,
    }
}

fn packs_root(root: &Path) -> PathBuf {
    root.join(PACKS_DIR)
}

fn pack_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("That pack name is not valid.".into());
    }
    Ok(packs_root(root).join(id))
}

#[derive(Deserialize)]
struct PackFile {
    file: String,
    sha256: String,
}
#[derive(Deserialize)]
struct PackManifest {
    id: String,
    files: Vec<PackFile>,
}

fn read_manifest(dir: &Path) -> Result<PackManifest, String> {
    let bytes = std::fs::read(dir.join("pack.json")).map_err(|_| "pack.json is missing.")?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("pack.json is too big.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "pack.json is not readable.".into())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackStatus {
    installed: bool,
    bytes: u64,
}

pub(crate) fn status_in(root: &Path, id: &str) -> Result<PackStatus, String> {
    let dir = pack_dir(root, id)?;
    let none = PackStatus {
        installed: false,
        bytes: 0,
    };
    let Ok(manifest) = read_manifest(&dir) else {
        return Ok(none);
    };
    let mut bytes = std::fs::metadata(dir.join("pack.json"))
        .map(|m| m.len())
        .unwrap_or(0);
    for entry in &manifest.files {
        if !valid_file(&entry.file) {
            return Ok(none);
        }
        match std::fs::metadata(dir.join(&entry.file)) {
            Ok(m) if m.is_file() => bytes += m.len(),
            _ => return Ok(none),
        }
    }
    Ok(PackStatus {
        installed: true,
        bytes,
    })
}

pub(crate) fn image_in(root: &Path, id: &str, file: &str) -> Result<String, String> {
    use base64::Engine;
    let dir = pack_dir(root, id)?;
    if !valid_file(file) {
        return Err("That figure name is not valid.".into());
    }
    let manifest = read_manifest(&dir)?;
    if !manifest.files.iter().any(|f| f.file == file) {
        return Err("That figure is not in this pack.".into());
    }
    let bytes = std::fs::read(dir.join(file)).map_err(|_| "That figure is not on this device.")?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub(crate) fn remove_in(root: &Path, id: &str) -> Result<(), String> {
    let dir = pack_dir(root, id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|_| "Could not remove the download.")?;
    }
    Ok(())
}

fn sha_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn read_capped<R: Read>(reader: R, cap: u64) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    reader
        .take(cap + 1)
        .read_to_end(&mut out)
        .map_err(|_| "The download could not be read.".to_string())?;
    if out.len() as u64 > cap {
        return Err("The download has a file that is too big.".into());
    }
    Ok(out)
}

/// Verifies the zip at `zip_path` against `expected_sha256`, validates every
/// entry, and moves the finished pack into `root/figure-packs/<id>`.
pub(crate) fn install_zip(
    root: &Path,
    id: &str,
    zip_path: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let final_dir = pack_dir(root, id)?;
    // Hash the whole zip first: nothing is opened that does not match the pin.
    let mut file = std::fs::File::open(zip_path).map_err(|_| "Could not read the download.")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|_| "Could not read the download.")?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    if !hex::encode(hasher.finalize()).eq_ignore_ascii_case(expected_sha256.trim()) {
        return Err("The download did not match what was expected, so it was not used.".into());
    }
    let bad = || "The download was not a valid figure pack.".to_string();
    let mut archive = zip::ZipArchive::new(file).map_err(|_| bad())?;
    if archive.is_empty() || archive.len() > MAX_ENTRIES {
        return Err(bad());
    }
    let temp_dir = packs_root(root).join(format!(".tmp-{id}"));
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).map_err(|_| "Could not save the download.")?;
    let result = (|| -> Result<(), String> {
        let mut seen: HashSet<String> = HashSet::new();
        let mut hashes: HashMap<String, String> = HashMap::new();
        let mut has_manifest = false;
        for i in 0..archive.len() {
            let entry = archive.by_index(i).map_err(|_| bad())?;
            let name = entry.name().map_err(|_| bad())?.to_string();
            let is_manifest = name == "pack.json";
            if entry.is_dir() || !(is_manifest || valid_file(&name)) || !seen.insert(name.clone()) {
                return Err(bad());
            }
            let cap = if is_manifest {
                MAX_MANIFEST_BYTES
            } else {
                MAX_FILE_BYTES
            };
            if entry.size() > cap {
                return Err(bad());
            }
            let data = read_capped(entry, cap)?;
            if is_manifest {
                has_manifest = true;
            } else {
                hashes.insert(name.clone(), sha_hex(&data));
            }
            std::fs::write(temp_dir.join(&name), &data)
                .map_err(|_| "Could not save the download.")?;
        }
        if !has_manifest {
            return Err(bad());
        }
        let manifest = read_manifest(&temp_dir).map_err(|_| bad())?;
        if manifest.id != id || manifest.files.is_empty() {
            return Err(bad());
        }
        let mut listed: HashSet<&str> = HashSet::new();
        for entry in &manifest.files {
            let actual = hashes.get(&entry.file).ok_or_else(bad)?;
            if !listed.insert(entry.file.as_str()) || !actual.eq_ignore_ascii_case(&entry.sha256) {
                return Err(bad());
            }
        }
        // Every image in the zip must be listed.
        if listed.len() != hashes.len() {
            return Err(bad());
        }
        Ok(())
    })();
    if let Err(message) = result {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(message);
    }
    // Replace any older copy, then move the finished folder into place.
    let _ = std::fs::remove_dir_all(&final_dir);
    if std::fs::rename(&temp_dir, &final_dir).is_err() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        let _ = std::fs::remove_dir_all(&final_dir);
        return Err("Could not save the download.".into());
    }
    Ok(())
}

/// Removes leftovers from a crash or quit mid-download.
pub(crate) fn clean_tmp_in(root: &Path) {
    let dir = packs_root(root);
    let _ = std::fs::remove_dir_all(dir.join(TMP_DIR));
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(".tmp-") {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

fn network(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "The download took too long.".into()
    } else if error.is_connect() {
        "Could not reach the download. Check your internet.".into()
    } else {
        "The download was interrupted.".into()
    }
}

fn client() -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 || !host_allowed(attempt.url()) {
            attempt.stop()
        } else {
            attempt.follow()
        }
    });
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(TOTAL_TIMEOUT)
        .redirect(policy)
        .no_proxy()
        .user_agent(concat!("HerFlightDeck/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Could not start the download.".to_string())
}

/// Removes its file unless disarmed, so every early exit or a dropped
/// (cancelled) download leaves nothing behind.
struct Temp(PathBuf);
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Streams `address` into a temp file under `figure-packs/.tmp`. The start
/// address is not checked here (tests use loopback); the final host is checked
/// by `download` through `check_final`.
async fn fetch_zip(
    client: &reqwest::Client,
    address: &str,
    id: &str,
    expected_bytes: u64,
    root: &Path,
    check_final: bool,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<Temp, String> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut response = client.get(address).send().await.map_err(network)?;
    if check_final && !host_allowed(response.url()) {
        return Err("The download came from an address that is not allowed.".into());
    }
    if response.status().as_u16() != 200 {
        return Err("The download is not available right now.".into());
    }
    let cap = expected_bytes + SLACK_BYTES;
    let declared = response.content_length();
    if declared.is_some_and(|n| n > cap) {
        return Err("The download is bigger than expected.".into());
    }
    let tmp = packs_root(root).join(TMP_DIR);
    std::fs::create_dir_all(&tmp).map_err(|_| "Could not save the download.")?;
    let path = tmp.join(format!(
        "{id}-{}-{}.zip",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "Could not save the download.")?;
    let temp = Temp(path);
    let total = declared.unwrap_or(expected_bytes);
    let mut received = 0u64;
    let mut last = Instant::now() - PROGRESS_EVERY;
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        received += chunk.len() as u64;
        if received > cap {
            return Err("The download is bigger than expected.".into());
        }
        out.write_all(&chunk)
            .map_err(|_| "Could not save the download.")?;
        if last.elapsed() >= PROGRESS_EVERY {
            last = Instant::now();
            on_progress(received, total);
        }
    }
    out.flush().map_err(|_| "Could not save the download.")?;
    drop(out);
    on_progress(received, total);
    if received == 0 || declared.is_some_and(|n| n != received) {
        return Err("The download did not finish.".into());
    }
    Ok(temp)
}

static ACTIVE: Mutex<Option<(String, Arc<CancelToken>)>> = Mutex::new(None);

struct Release(Arc<CancelToken>);
impl Drop for Release {
    fn drop(&mut self) {
        let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
        if active
            .as_ref()
            .is_some_and(|(_, t)| Arc::ptr_eq(t, &self.0))
        {
            *active = None;
        }
    }
}

/// The whole download for one pack under `root`.
#[allow(clippy::too_many_arguments)]
async fn run(
    root: &Path,
    id: &str,
    address: &str,
    sha256: &str,
    bytes: u64,
    check_final: bool,
    token: Arc<CancelToken>,
    on_progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    let client = client()?;
    let work = fetch_zip(&client, address, id, bytes, root, check_final, on_progress);
    let temp = Cancellable::new(work, token)
        .await
        .map_err(|_| "The download was cancelled.".to_string())??;
    let (root, id, sha256) = (root.to_path_buf(), id.to_string(), sha256.to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let result = install_zip(&root, &id, &temp.0, &sha256);
        drop(temp);
        result
    })
    .await
    .map_err(|_| "Could not save the download.".to_string())?
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    id: String,
    received: u64,
    total: u64,
}

fn root_of(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::storage::app_root(app).map_err(|_| "Could not open the app folder.".to_string())
}

#[tauri::command]
pub(crate) fn figure_pack_status(app: tauri::AppHandle, id: String) -> Result<PackStatus, String> {
    status_in(&root_of(&app)?, &id)
}

#[tauri::command]
pub(crate) fn figure_pack_image(
    app: tauri::AppHandle,
    id: String,
    file: String,
) -> Result<String, String> {
    image_in(&root_of(&app)?, &id, &file)
}

#[tauri::command]
pub(crate) fn figure_pack_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    remove_in(&root_of(&app)?, &id)
}

#[tauri::command]
pub(crate) fn figure_pack_cancel(id: String) {
    if let Some((active_id, token)) = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if *active_id == id {
            token.cancel();
        }
    }
}

#[tauri::command]
pub(crate) async fn figure_pack_download(
    app: tauri::AppHandle,
    id: String,
    url: String,
    sha256: String,
    bytes: u64,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("That pack name is not valid.".into());
    }
    check_start_url(&url)?;
    if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("That download is not set up correctly.".into());
    }
    if bytes == 0 || bytes > 100 * MIB {
        return Err("That download is not set up correctly.".into());
    }
    let root = root_of(&app)?;
    let token = Arc::new(CancelToken::default());
    {
        let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
        if active.is_some() {
            return Err("Another download is already running.".into());
        }
        *active = Some((id.clone(), token.clone()));
    }
    let _release = Release(token.clone());
    let emit_id = id.clone();
    run(
        &root,
        &id,
        &url,
        &sha256,
        bytes,
        true,
        token,
        move |received, total| {
            let _ = app.emit(
                "figure-pack-progress",
                ProgressPayload {
                    id: emit_id.clone(),
                    received,
                    total,
                },
            );
        },
    )
    .await
}

#[cfg(test)]
#[path = "figure_packs_tests.rs"]
mod tests;
