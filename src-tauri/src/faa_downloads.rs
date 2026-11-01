//! One-click download of FAA handbooks from www.faa.gov (Slice 3a).
//!
//! The webview passes only a manifest id. The URL, the size cap and the file
//! name all come from the static manifest below, and the URL is checked again
//! before any request: https, host exactly `www.faa.gov`, no credentials, no
//! port, no query. Redirects are never followed. The body goes to a temp file
//! under `documents/.incoming/` with a running byte count and SHA-256, is
//! checked as a real PDF, and only then moved into the library. A temp file is
//! removed on every failure and the folder is emptied at startup.
//! Nothing is sent but one GET per click: no query, no cookies, no telemetry.
use crate::documents::{stored_destination_in, ImportedDocument, DOCUMENTS_DIR};
use crate::gemini_cancel::{CancelToken, Cancellable};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MIB: u64 = 1024 * 1024;
/// Cap for every chapter and addendum.
const DEFAULT_CAP: u64 = 50 * MIB;
/// The one exception: the full Pilot's Handbook (about 74 MB).
const PHAK_FULL_CAP: u64 = 100 * MIB;
const TOTAL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const INCOMING_DIR: &str = ".incoming";
const HOST: &str = "www.faa.gov";
const AVIATION: &str = "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation";
const AFH_BASE: &str = "https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Kind {
    AfhChapter,
    AfhAddendum,
    /// The full 25C handbook. Not offered by the shelf until slice 3d.
    PhakFull,
}

#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub id: String,
    pub title: String,
    pub edition: &'static str,
    pub published: &'static str,
    pub url: String,
    pub file_name: String,
    pub max_bytes: u64,
    pub kind: Kind,
}

/// What the shelf may show; never includes the URL.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EntryInfo {
    id: String,
    title: String,
    edition: &'static str,
    published: &'static str,
    max_bytes: u64,
    kind: Kind,
    /// False for the full Pilot's Handbook until its own slice (3d).
    offered_now: bool,
}

fn afh(id: String, title: String, file: &str, name: String) -> Entry {
    Entry {
        id,
        title,
        edition: "FAA-H-8083-3C",
        published: "2021",
        url: format!("{AFH_BASE}/{file}.pdf"),
        file_name: name,
        max_bytes: DEFAULT_CAP,
        kind: Kind::AfhChapter,
    }
}

/// Every file the app can fetch. There is deliberately no 25B entry.
pub(crate) fn manifest() -> Vec<Entry> {
    let mut out = vec![afh(
        "afh-3c-front".into(),
        "Airplane Flying Handbook, front matter".into(),
        "01_afh_front",
        "FAA-H-8083-3C-front.pdf".into(),
    )];
    for chapter in 1..=18u32 {
        out.push(afh(
            format!("afh-3c-ch{chapter:02}"),
            format!("Airplane Flying Handbook, chapter {chapter}"),
            &format!("{:02}_afh_ch{chapter}", chapter + 1),
            format!("FAA-H-8083-3C-ch{chapter:02}.pdf"),
        ));
    }
    out.push(afh(
        "afh-3c-glossary".into(),
        "Airplane Flying Handbook, glossary".into(),
        "20_afh_glossary",
        "FAA-H-8083-3C-glossary.pdf".into(),
    ));
    out.push(afh(
        "afh-3c-index".into(),
        "Airplane Flying Handbook, index".into(),
        "21_afh_index",
        "FAA-H-8083-3C-index.pdf".into(),
    ));
    out.push(Entry {
        id: "afh-addendum-mosaic".into(),
        title: "Airplane Flying Handbook addendum (MOSAIC)".into(),
        edition: "FAA-H-8083-3C addendum (MOSAIC)",
        published: "2025-10",
        url: format!("{AVIATION}/AFH_Addendum_(MOSAIC).pdf"),
        file_name: "FAA-H-8083-3C-addendum-MOSAIC.pdf".into(),
        max_bytes: DEFAULT_CAP,
        kind: Kind::AfhAddendum,
    });
    out.push(Entry {
        id: "phak-25c-full".into(),
        title: "Pilot's Handbook of Aeronautical Knowledge (full book)".into(),
        edition: "FAA-H-8083-25C",
        published: "2023",
        url: format!("{AVIATION}/faa-h-8083-25c.pdf"),
        file_name: "FAA-H-8083-25C.pdf".into(),
        max_bytes: PHAK_FULL_CAP,
        kind: Kind::PhakFull,
    });
    out
}

#[tauri::command]
pub(crate) fn list_faa_downloads() -> Vec<EntryInfo> {
    manifest()
        .into_iter()
        .map(|e| EntryInfo {
            offered_now: true,
            id: e.id,
            title: e.title,
            edition: e.edition,
            published: e.published,
            max_bytes: e.max_bytes,
            kind: e.kind,
        })
        .collect()
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Failure {
    kind: &'static str,
    message: String,
}

fn fail(kind: &'static str, message: &str) -> Failure {
    Failure {
        kind,
        message: message.to_string(),
    }
}

/// The only addresses ever requested.
pub(crate) fn check_allowed(address: &str) -> Result<(), Failure> {
    let bad = || fail("blocked", "That address is not an FAA handbook address.");
    let url = reqwest::Url::parse(address).map_err(|_| bad())?;
    if url.scheme() == "https"
        && url.host_str() == Some(HOST)
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
    {
        Ok(())
    } else {
        Err(bad())
    }
}

/// Removes its file unless `keep` is called, so every early exit and a
/// cancelled (dropped) download leaves nothing behind.
struct Temp {
    path: PathBuf,
    keep: bool,
}
impl Temp {
    fn create(dir: &Path, id: &str) -> Result<(Self, std::fs::File), Failure> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let storage = |_| fail("storage", "Could not save the download on this Mac.");
        std::fs::create_dir_all(dir).map_err(storage)?;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let name = format!(
            "{id}-{nanos}-{}-{}.pdf",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let path = dir.join(name);
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(storage)?;
        Ok((Temp { path, keep: false }, file))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// A downloaded, verified PDF waiting in the incoming folder.
struct Fetched {
    temp: Temp,
    sha256: String,
    bytes: u64,
    last_modified: Option<String>,
}

#[derive(Default)]
struct Progress {
    received: AtomicU64,
    total: AtomicU64,
}

fn network(error: reqwest::Error) -> Failure {
    if error.is_timeout() {
        fail("timeout", "faa.gov did not answer in time.")
    } else if error.is_connect() {
        fail("offline", "Could not reach faa.gov. Check the connection.")
    } else {
        fail("interrupted", "The download was interrupted.")
    }
}

fn client(total: Duration) -> Result<reqwest::Client, Failure> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(total)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_proxy()
        .user_agent(concat!("HerFlightDeck/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| fail("unavailable", "Could not start the download."))
}

/// GET `address` into a temp file under `incoming`. The address is NOT
/// checked here (tests use loopback); `download` checks it first.
async fn fetch_to_temp(
    client: &reqwest::Client,
    address: &str,
    id: &str,
    cap: u64,
    incoming: &Path,
    progress: &Progress,
) -> Result<Fetched, Failure> {
    let mut response = client.get(address).send().await.map_err(network)?;
    let status = response.status();
    if status.is_redirection() {
        return Err(fail(
            "moved",
            "FAA moved this file. Add the PDF yourself, or try again later.",
        ));
    }
    if status.as_u16() == 404 {
        return Err(fail("notFound", "faa.gov no longer has this file there."));
    }
    if status.as_u16() != 200 {
        return Err(fail("server", "faa.gov did not give the file."));
    }
    let headers = response.headers();
    if headers
        .get("content-encoding")
        .is_some_and(|v| v != "identity")
    {
        return Err(fail("badType", "faa.gov sent something unexpected."));
    }
    let is_pdf = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim().to_ascii_lowercase().starts_with("application/pdf"));
    if !is_pdf {
        return Err(fail("badType", "faa.gov did not send a PDF."));
    }
    let last_modified = headers
        .get("last-modified")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.chars().take(64).collect::<String>());
    let declared = response.content_length();
    if declared.is_some_and(|n| n > cap) {
        return Err(fail("tooBig", "This file is bigger than expected."));
    }
    progress
        .total
        .store(declared.unwrap_or(0), Ordering::SeqCst);

    let (temp, mut file) = Temp::create(incoming, id)?;
    let mut hasher = Sha256::new();
    let mut bytes = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        bytes += chunk.len() as u64;
        if bytes > cap {
            return Err(fail("tooBig", "This file is bigger than expected."));
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|_| fail("storage", "Could not save the download on this Mac."))?;
        progress.received.store(bytes, Ordering::SeqCst);
    }
    file.flush()
        .map_err(|_| fail("storage", "Could not save the download on this Mac."))?;
    drop(file);
    if bytes == 0 || declared.is_some_and(|n| n != bytes) {
        return Err(fail("interrupted", "The download did not finish."));
    }
    Ok(Fetched {
        temp,
        sha256: hex::encode(hasher.finalize()),
        bytes,
        last_modified,
    })
}

/// Real PDF check on the downloaded bytes; returns the page count.
fn verify_pdf(path: &Path) -> Result<crate::study_page_sources::Preview, Failure> {
    let bad = || fail("notPdf", "That download was not a readable PDF.");
    let data = std::fs::read(path).map_err(|_| bad())?;
    if !data.starts_with(b"%PDF") {
        return Err(bad());
    }
    let (content_sha256, total_pages) =
        crate::navigation::identity_of_bytes(&data).map_err(|_| bad())?;
    Ok(crate::study_page_sources::Preview {
        content_sha256,
        total_pages,
    })
}

/// Everything slice 3b needs to store next to the material.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Downloaded {
    document: ImportedDocument,
    manifest_id: String,
    source_url: String,
    edition: &'static str,
    sha256: String,
    bytes: u64,
    http_last_modified: Option<String>,
}

/// Move the verified temp file into the documents folder (no second copy).
fn finish(
    documents_dir: &Path,
    material_id: &str,
    entry: &Entry,
    address: &str,
    mut fetched: Fetched,
    identity: crate::study_page_sources::Preview,
) -> Result<Downloaded, Failure> {
    let storage = |_| fail("storage", "Could not add the file to the library.");
    let (destination, stored_name) =
        stored_destination_in(documents_dir, material_id, &entry.file_name)
            .map_err(|_| fail("storage", "Could not add the file to the library."))?;
    if let Err(error) = std::fs::rename(&fetched.temp.path, &destination) {
        let _ = std::fs::remove_file(&destination);
        return Err(storage(error));
    }
    fetched.temp.keep = true;
    Ok(Downloaded {
        document: ImportedDocument {
            relative_path: stored_name,
            original_file_name: entry.file_name.clone(),
            file_size: fetched.bytes,
            pdf_identity: Some(identity),
        },
        manifest_id: entry.id.clone(),
        source_url: address.to_string(),
        edition: entry.edition,
        sha256: fetched.sha256.clone(),
        bytes: fetched.bytes,
        http_last_modified: fetched.last_modified.clone(),
    })
}

/// Whole download against `address` into `documents_dir`.
async fn run(
    entry: &Entry,
    address: &str,
    material_id: &str,
    documents_dir: &Path,
    client: &reqwest::Client,
    token: Arc<CancelToken>,
    progress: &Progress,
) -> Result<Downloaded, Failure> {
    let incoming = documents_dir.join(INCOMING_DIR);
    let work = fetch_to_temp(
        client,
        address,
        &entry.id,
        entry.max_bytes,
        &incoming,
        progress,
    );
    let fetched = Cancellable::new(work, token)
        .await
        .map_err(|_| fail("cancelled", "The download was cancelled."))??;
    let path = fetched.temp.path.clone();
    let identity = tauri::async_runtime::spawn_blocking(move || verify_pdf(&path))
        .await
        .map_err(|_| fail("notPdf", "That download was not a readable PDF."))??;
    finish(
        documents_dir,
        material_id,
        entry,
        address,
        fetched,
        identity,
    )
}

struct Active {
    token: Arc<CancelToken>,
    progress: Arc<Progress>,
}
static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

struct Release(Arc<CancelToken>);
impl Drop for Release {
    fn drop(&mut self) {
        let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
        if active
            .as_ref()
            .is_some_and(|a| Arc::ptr_eq(&a.token, &self.0))
        {
            *active = None;
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgressInfo {
    received: u64,
    /// 0 when the server did not say.
    total: u64,
}

#[tauri::command]
pub(crate) fn faa_download_progress() -> Option<ProgressInfo> {
    let active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    active.as_ref().map(|a| ProgressInfo {
        received: a.progress.received.load(Ordering::SeqCst),
        total: a.progress.total.load(Ordering::SeqCst),
    })
}

#[tauri::command]
pub(crate) fn cancel_faa_download() {
    if let Some(active) = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        active.token.cancel();
    }
}

#[tauri::command]
pub(crate) async fn download_faa_handbook(
    app: tauri::AppHandle,
    id: String,
    material_id: String,
) -> Result<Downloaded, Failure> {
    let entry = manifest()
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| fail("unknown", "That handbook is not on the list."))?;
    check_allowed(&entry.url)?;
    if material_id.trim().is_empty() {
        return Err(fail("storage", "Could not add the file to the library."));
    }
    let client = client(TOTAL_TIMEOUT)?;
    let documents_dir = crate::storage::app_root(&app)
        .map(|root| root.join(DOCUMENTS_DIR))
        .map_err(|_| fail("storage", "Could not open the library folder."))?;
    std::fs::create_dir_all(&documents_dir)
        .map_err(|_| fail("storage", "Could not open the library folder."))?;
    let token = Arc::new(CancelToken::default());
    let progress = Arc::new(Progress::default());
    {
        let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
        if active.is_some() {
            return Err(fail("busy", "Another download is already running."));
        }
        *active = Some(Active {
            token: token.clone(),
            progress: progress.clone(),
        });
    }
    let _release = Release(token.clone());
    run(
        &entry,
        &entry.url,
        &material_id,
        &documents_dir,
        &client,
        token,
        &progress,
    )
    .await
}

/// Empties `documents/.incoming` (left by a crash or a quit mid-download).
pub(crate) fn clean_incoming_in(root: &Path) {
    let _ = std::fs::remove_dir_all(root.join(DOCUMENTS_DIR).join(INCOMING_DIR));
}

pub(crate) fn clean_incoming(app: &tauri::AppHandle) {
    if let Ok(root) = crate::storage::app_root(app) {
        clean_incoming_in(&root);
    }
}

#[cfg(test)]
#[path = "faa_downloads_tests.rs"]
mod tests;
