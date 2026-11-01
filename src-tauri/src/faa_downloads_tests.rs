use super::*;
use lopdf::{dictionary, Document, Object};
use std::io::Read;
use std::net::TcpListener;
use std::sync::atomic::AtomicBool;

fn pdf_bytes(pages: u32) -> Vec<u8> {
    let mut document = Document::with_version("1.5");
    let pages_id = document.new_object_id();
    let kids: Vec<Object> = (0..pages)
        .map(|_| {
            document
                .add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                })
                .into()
        })
        .collect();
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Count" => i64::from(pages), "Kids" => kids,
        }),
    );
    let catalog_id = document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    document.trailer.set("Root", catalog_id);
    let mut out = Vec::new();
    document.save_to(&mut out).unwrap();
    out
}

/// One synthetic response on loopback; never a real network call.
struct Server {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}
impl Server {
    /// Sends `response`, then (if `stall`) holds the connection open.
    fn new(response: Vec<u8>, stall: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/fixture.pdf", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        let (r, s, d) = (requests.clone(), stop.clone(), done.clone());
        std::thread::spawn(move || {
            let mut stream = None;
            crate::test_wait::wait_for("faa fixture connection", || {
                if s.load(Ordering::SeqCst) {
                    return true;
                }
                match listener.accept() {
                    Ok((socket, _)) => {
                        stream = Some(socket);
                        true
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => false,
                    Err(e) => panic!("{e}"),
                }
            });
            if let Some(mut socket) = stream {
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut header = Vec::new();
                let mut byte = [0; 1];
                while !header.ends_with(b"\r\n\r\n") && header.len() < 8192 {
                    if socket.read(&mut byte).unwrap_or(0) == 0 {
                        break;
                    }
                    header.push(byte[0]);
                }
                r.lock().unwrap().push(String::from_utf8(header).unwrap());
                let _ = socket.write_all(&response);
                let _ = socket.flush();
                if stall {
                    crate::test_wait::wait_for("faa fixture release", || s.load(Ordering::SeqCst));
                }
            }
            d.store(true, Ordering::SeqCst);
        });
        Self {
            url,
            requests,
            stop,
            done,
        }
    }
    fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        crate::test_wait::wait_for("faa fixture stopped", || self.done.load(Ordering::SeqCst));
    }
}

fn http(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n",
        body.len()
    )
    .into_bytes();
    out.extend(body);
    out
}
fn pdf_ok(body: &[u8]) -> Vec<u8> {
    http(
        "200 OK",
        "Content-Type: application/pdf\r\nLast-Modified: Mon, 01 Mar 2021 10:00:00 GMT\r\n",
        body,
    )
}

fn entry(cap: u64) -> Entry {
    Entry {
        id: "afh-3c-ch04".into(),
        title: "Test".into(),
        edition: "FAA-H-8083-3C",
        published: "2021",
        url: "https://www.faa.gov/unused.pdf".into(),
        file_name: "FAA-H-8083-3C-ch04.pdf".into(),
        max_bytes: cap,
        kind: Kind::AfhChapter,
    }
}

struct Fixture {
    dir: tempdir::Dir,
}
mod tempdir {
    pub struct Dir(pub std::path::PathBuf);
    impl Dir {
        pub fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "faa-dl-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Dir(path)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
impl Fixture {
    fn new(tag: &str) -> Self {
        Self {
            dir: tempdir::Dir::new(tag),
        }
    }
    fn docs(&self) -> &Path {
        &self.dir.0
    }
    fn incoming_files(&self) -> usize {
        std::fs::read_dir(self.docs().join(INCOMING_DIR))
            .map(|d| d.count())
            .unwrap_or(0)
    }
    fn run(&self, cap: u64, url: &str) -> Result<Downloaded, Failure> {
        let progress = Progress::default();
        self.run_with(cap, url, Arc::new(CancelToken::default()), &progress)
    }
    fn run_with(
        &self,
        cap: u64,
        url: &str,
        token: Arc<CancelToken>,
        progress: &Progress,
    ) -> Result<Downloaded, Failure> {
        tauri::async_runtime::block_on(super::run(
            &entry(cap),
            url,
            "mat-1",
            self.docs(),
            &client(Duration::from_secs(30)).unwrap(),
            token,
            progress,
        ))
    }
}

#[test]
fn faa_manifest_is_https_faa_only_unique_and_capped() {
    let all = manifest();
    // Front, 18 chapters, glossary, index, addendum, PHAK 25C.
    assert_eq!(all.len(), 23);
    let mut ids: Vec<_> = all.iter().map(|e| e.id.clone()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), all.len());
    for e in &all {
        check_allowed(&e.url).unwrap_or_else(|_| panic!("{}", e.url));
        assert!(e.url.starts_with("https://www.faa.gov/"));
        assert!(e.url.ends_with(".pdf"));
        assert!(!e.url.contains("phak/"), "no 25B chapter files: {}", e.url);
        assert!(!e.url.contains("25b") && !e.id.contains("25b"));
        assert!(!e.edition.contains("25B"));
        assert!(e.file_name.ends_with(".pdf") && !e.file_name.contains('/'));
        if e.kind == Kind::PhakFull {
            assert_eq!(e.max_bytes, 100 * 1024 * 1024);
            assert_eq!(e.edition, "FAA-H-8083-25C");
        } else {
            assert_eq!(e.max_bytes, 50 * 1024 * 1024);
        }
    }
    assert_eq!(all.iter().filter(|e| e.kind == Kind::PhakFull).count(), 1);
    let ch4 = all.iter().find(|e| e.id == "afh-3c-ch04").unwrap();
    assert!(ch4.url.ends_with("/airplane_handbook/05_afh_ch4.pdf"));
    let info = list_faa_downloads();
    assert_eq!(info.len(), 23);
    assert!(
        info.iter()
            .find(|i| i.id == "phak-25c-full")
            .unwrap()
            .offered_now
    );
    assert!(info
        .iter()
        .filter(|i| i.id != "phak-25c-full")
        .all(|i| i.offered_now));
    assert!(!serde_json::to_string(&info).unwrap().contains("http"));
}

#[test]
fn faa_allow_list_rejects_other_hosts_schemes_and_tricks() {
    for bad in [
        "http://www.faa.gov/a.pdf",
        "https://faa.gov/a.pdf",
        "https://evil.example/a.pdf",
        "https://www.faa.gov.evil.example/a.pdf",
        "https://www.faa.gov@evil.example/a.pdf",
        "https://user:pw@www.faa.gov/a.pdf",
        "https://www.faa.gov:8443/a.pdf",
        "https://sub.www.faa.gov/a.pdf",
        "https://www.faa.gov/a.pdf?x=1",
        "https://www.faa.gov/a.pdf#frag",
        "ftp://www.faa.gov/a.pdf",
        "file:///etc/passwd",
        "http://127.0.0.1/a.pdf",
        "",
        "not a url",
    ] {
        assert_eq!(check_allowed(bad).unwrap_err().kind, "blocked", "{bad}");
    }
    check_allowed("https://www.faa.gov/a/b.pdf").unwrap();
}

#[test]
fn faa_happy_path_moves_verified_pdf_with_provenance() {
    let body = pdf_bytes(3);
    let server = Server::new(pdf_ok(&body), false);
    let fx = Fixture::new("happy");
    let out = fx.run(50 * 1024 * 1024, &server.url).unwrap();
    let (sha, pages) = crate::navigation::identity_of_bytes(&body).unwrap();
    assert_eq!(out.sha256, sha);
    assert_eq!(out.bytes, body.len() as u64);
    assert_eq!(out.manifest_id, "afh-3c-ch04");
    assert_eq!(out.edition, "FAA-H-8083-3C");
    assert_eq!(out.source_url, server.url);
    assert_eq!(
        out.http_last_modified.as_deref(),
        Some("Mon, 01 Mar 2021 10:00:00 GMT")
    );
    let identity = out.document.pdf_identity.as_ref().unwrap();
    assert_eq!(identity.content_sha256, sha);
    assert_eq!(identity.total_pages, pages);
    assert_eq!(pages, 3);
    assert_eq!(out.document.file_size, body.len() as u64);
    assert_eq!(
        std::fs::read(fx.docs().join(&out.document.relative_path)).unwrap(),
        body
    );
    assert!(out.document.relative_path.starts_with("mat-1-"));
    assert_eq!(fx.incoming_files(), 0, "moved, not copied");
    let sent = server.requests.lock().unwrap()[0].to_ascii_lowercase();
    assert!(sent.starts_with("get /fixture.pdf http/1.1"));
    assert!(!sent.contains("cookie") && !sent.contains("authorization"));
}

#[test]
fn faa_redirect_is_an_error_and_never_followed() {
    let server = Server::new(
        http(
            "302 Found",
            "Location: http://127.0.0.1:1/elsewhere.pdf\r\n",
            b"",
        ),
        false,
    );
    let fx = Fixture::new("redirect");
    assert_eq!(fx.run(1 << 20, &server.url).unwrap_err().kind, "moved");
    assert_eq!(server.request_count(), 1);
    assert_eq!(fx.incoming_files(), 0);
}

#[test]
fn faa_wrong_content_type_status_and_encoding_are_refused() {
    let body = pdf_bytes(1);
    let cases: Vec<(Vec<u8>, &str)> = vec![
        (
            http("200 OK", "Content-Type: text/html\r\n", &body),
            "badType",
        ),
        (http("200 OK", "", &body), "badType"),
        (
            http(
                "200 OK",
                "Content-Type: application/pdf\r\nContent-Encoding: gzip\r\n",
                &body,
            ),
            "badType",
        ),
        (
            http("404 Not Found", "Content-Type: application/pdf\r\n", &body),
            "notFound",
        ),
        (
            http(
                "503 Unavailable",
                "Content-Type: application/pdf\r\n",
                &body,
            ),
            "server",
        ),
    ];
    for (response, kind) in cases {
        let server = Server::new(response, false);
        let fx = Fixture::new("refused");
        assert_eq!(fx.run(1 << 20, &server.url).unwrap_err().kind, kind);
        assert_eq!(fx.incoming_files(), 0);
    }
}

#[test]
fn faa_declared_length_over_cap_stops_before_the_body() {
    // Header promises 1000 bytes against a 100-byte cap; no body is ever sent.
    let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n".to_vec();
    let server = Server::new(response, true);
    let fx = Fixture::new("declared");
    assert_eq!(fx.run(100, &server.url).unwrap_err().kind, "tooBig");
    assert!(
        !fx.docs().join(INCOMING_DIR).exists(),
        "no temp file was even created"
    );
}

#[test]
fn faa_body_over_cap_without_length_aborts_and_removes_temp() {
    let mut response =
        b"HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nConnection: close\r\n\r\n".to_vec();
    response.extend(vec![b'x'; 4096]);
    let server = Server::new(response, false);
    let fx = Fixture::new("overcap");
    assert_eq!(fx.run(1000, &server.url).unwrap_err().kind, "tooBig");
    assert_eq!(fx.incoming_files(), 0);
}

#[test]
fn faa_truncated_body_is_an_error_and_removes_temp() {
    let body = pdf_bytes(2);
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend(&body[..body.len() / 2]);
    let server = Server::new(response, false);
    let fx = Fixture::new("truncated");
    assert_eq!(
        fx.run(1 << 20, &server.url).unwrap_err().kind,
        "interrupted"
    );
    assert_eq!(fx.incoming_files(), 0);
    assert_eq!(std::fs::read_dir(fx.docs()).unwrap().count(), 1); // only .incoming
}

#[test]
fn faa_download_that_is_not_a_pdf_is_removed() {
    for body in [
        b"<html>FAA is down</html>".to_vec(),
        b"%PDF-1.4 but not really a document".to_vec(),
    ] {
        let server = Server::new(pdf_ok(&body), false);
        let fx = Fixture::new("notpdf");
        assert_eq!(fx.run(1 << 20, &server.url).unwrap_err().kind, "notPdf");
        assert_eq!(fx.incoming_files(), 0);
        assert_eq!(
            std::fs::read_dir(fx.docs()).unwrap().count(),
            1,
            "nothing reached the library"
        );
    }
}

#[test]
fn faa_cancel_mid_download_cleans_up_and_reports_cancelled() {
    let body = pdf_bytes(2);
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len() + 5000
    )
    .into_bytes();
    response.extend(&body);
    let server = Server::new(response, true);
    let fx = Fixture::new("cancel");
    let token = Arc::new(CancelToken::default());
    let progress = Arc::new(Progress::default());
    let watcher = {
        let (token, progress) = (token.clone(), progress.clone());
        std::thread::spawn(move || {
            crate::test_wait::wait_for("first bytes", || {
                progress.received.load(Ordering::SeqCst) > 0
            });
            token.cancel();
        })
    };
    let err = fx
        .run_with(1 << 20, &server.url, token, &progress)
        .unwrap_err();
    watcher.join().unwrap();
    assert_eq!(err.kind, "cancelled");
    assert_eq!(fx.incoming_files(), 0);
    assert_eq!(std::fs::read_dir(fx.docs()).unwrap().count(), 1);
}

#[test]
fn faa_startup_cleanup_empties_incoming_only() {
    let fx = Fixture::new("startup");
    let docs = fx.docs().join(DOCUMENTS_DIR);
    std::fs::create_dir_all(docs.join(INCOMING_DIR)).unwrap();
    std::fs::write(docs.join(INCOMING_DIR).join("left.pdf"), b"x").unwrap();
    std::fs::write(docs.join("keep.pdf"), b"y").unwrap();
    clean_incoming_in(fx.docs());
    assert!(!docs.join(INCOMING_DIR).exists());
    assert!(docs.join("keep.pdf").exists());
    clean_incoming_in(fx.docs()); // missing folder is fine
}

#[test]
fn faa_unknown_manifest_id_is_not_in_the_list() {
    assert!(!manifest().iter().any(|e| e.id == "afh-3c-ch99"));
    assert!(!manifest().iter().any(|e| e.id.contains("25b")));
}
