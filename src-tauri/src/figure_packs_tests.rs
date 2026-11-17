use super::*;
use std::io::Write;
use std::net::TcpListener;

struct Dir(PathBuf);
impl Dir {
    fn new(tag: &str) -> Self {
        static N: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "hfd-figpack-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
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

fn zip_of(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut out);
        let options = zip::write::SimpleFileOptions::default();
        for (name, data) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
    }
    out.into_inner()
}

fn manifest(id: &str, files: &[(&str, &[u8])]) -> Vec<u8> {
    let list: Vec<_> = files
        .iter()
        .map(|(f, d)| serde_json::json!({"file": f, "faaNumber": 1, "width": 10, "height": 10, "sha256": sha_hex(d)}))
        .collect();
    serde_json::to_vec(&serde_json::json!({"id": id, "edition": "x", "files": list})).unwrap()
}

fn good_zip(id: &str) -> Vec<u8> {
    let a: &[u8] = b"image-a";
    let b: &[u8] = b"image-b";
    zip_of(&[
        ("faa-1.webp", a.to_vec()),
        ("faa-2.webp", b.to_vec()),
        (
            "pack.json",
            manifest(id, &[("faa-1.webp", a), ("faa-2.webp", b)]),
        ),
    ])
}

fn write_zip(dir: &Dir, bytes: &[u8]) -> PathBuf {
    let path = dir.0.join("in.zip");
    std::fs::write(&path, bytes).unwrap();
    path
}

#[test]
fn names_are_validated() {
    assert!(valid_id("sectionals-2h"));
    for bad in ["", "..", "a/b", "A", "a.b", "a b", "../x"] {
        assert!(!valid_id(bad), "{bad}");
    }
    assert!(valid_file("faa-49.webp"));
    for bad in [
        "faa-49.png",
        "../faa-1.webp",
        "a/b.webp",
        "pack.json",
        ".webp",
        "a.webp.webp",
    ] {
        assert!(!valid_file(bad), "{bad}");
    }
}

#[test]
fn start_url_and_host_checks() {
    assert!(
        check_start_url("https://github.com/rickydeleon49-ui/x/releases/download/v1/p.zip").is_ok()
    );
    assert!(check_start_url("https://objects.githubusercontent.com/abc?x=1").is_ok());
    for bad in [
        "http://github.com/rickydeleon49-ui/x.zip",
        "https://github.com/other/x.zip",
        "https://github.com.evil.com/rickydeleon49-ui/x.zip",
        "https://github.com@evil.com/rickydeleon49-ui/x.zip",
        "https://github.com:444/rickydeleon49-ui/x.zip",
        "https://example.com/x.zip",
        "file:///etc/passwd",
    ] {
        assert!(check_start_url(bad).is_err(), "{bad}");
    }
    let ok = |u: &str| host_allowed(&reqwest::Url::parse(u).unwrap());
    assert!(ok("https://github.com/x"));
    assert!(ok("https://objects.githubusercontent.com/x"));
    assert!(ok("https://release-assets.githubusercontent.com/x"));
    assert!(!ok("https://evilgithubusercontent.com/x"));
    assert!(!ok("https://githubusercontent.com.evil.com/x"));
    assert!(!ok("http://github.com/x"));
    assert!(!ok("https://example.com/x"));
}

#[test]
fn happy_path_installs_and_reads_back() {
    let dir = Dir::new("ok");
    let bytes = good_zip("pack-a");
    let zip_path = write_zip(&dir, &bytes);
    assert!(!status_in(&dir.0, "pack-a").unwrap().installed);
    install_zip(&dir.0, "pack-a", &zip_path, &sha_hex(&bytes)).unwrap();
    let status = status_in(&dir.0, "pack-a").unwrap();
    assert!(status.installed && status.bytes > 14);
    use base64::Engine;
    let data = image_in(&dir.0, "pack-a", "faa-1.webp").unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .unwrap(),
        b"image-a"
    );
    assert!(image_in(&dir.0, "pack-a", "faa-9.webp").is_err());
    assert!(image_in(&dir.0, "pack-a", "../pack.json").is_err());
    // Reinstalling replaces the old copy; no temp folder is left.
    install_zip(&dir.0, "pack-a", &zip_path, &sha_hex(&bytes)).unwrap();
    assert!(!packs_root(&dir.0).join(".tmp-pack-a").exists());
    remove_in(&dir.0, "pack-a").unwrap();
    assert!(!status_in(&dir.0, "pack-a").unwrap().installed);
}

#[test]
fn status_needs_every_listed_file() {
    let dir = Dir::new("partial");
    let bytes = good_zip("pack-a");
    let zip_path = write_zip(&dir, &bytes);
    install_zip(&dir.0, "pack-a", &zip_path, &sha_hex(&bytes)).unwrap();
    std::fs::remove_file(packs_root(&dir.0).join("pack-a").join("faa-2.webp")).unwrap();
    assert!(!status_in(&dir.0, "pack-a").unwrap().installed);
}

#[test]
fn wrong_sha_is_rejected_and_leaves_nothing() {
    let dir = Dir::new("sha");
    let zip_path = write_zip(&dir, &good_zip("pack-a"));
    let err = install_zip(&dir.0, "pack-a", &zip_path, &"0".repeat(64)).unwrap_err();
    assert!(err.contains("did not match"));
    assert!(!packs_root(&dir.0).join("pack-a").exists());
    assert!(!packs_root(&dir.0).join(".tmp-pack-a").exists());
}

fn rejected(tag: &str, bytes: Vec<u8>) {
    let dir = Dir::new(tag);
    let zip_path = write_zip(&dir, &bytes);
    assert!(
        install_zip(&dir.0, "pack-a", &zip_path, &sha_hex(&bytes)).is_err(),
        "{tag}"
    );
    assert!(!packs_root(&dir.0).join("pack-a").exists(), "{tag}");
    assert!(!packs_root(&dir.0).join(".tmp-pack-a").exists(), "{tag}");
}

#[test]
fn bad_zips_are_rejected() {
    let a: &[u8] = b"image-a";
    let m = manifest("pack-a", &[("faa-1.webp", a)]);
    rejected(
        "traversal",
        zip_of(&[("../faa-1.webp", a.to_vec()), ("pack.json", m.clone())]),
    );
    rejected(
        "subdir",
        zip_of(&[("sub/faa-1.webp", a.to_vec()), ("pack.json", m.clone())]),
    );
    rejected(
        "extra-file",
        zip_of(&[
            ("faa-1.webp", a.to_vec()),
            ("evil.exe", b"x".to_vec()),
            ("pack.json", m.clone()),
        ]),
    );
    rejected(
        "unlisted-image",
        zip_of(&[
            ("faa-1.webp", a.to_vec()),
            ("faa-2.webp", a.to_vec()),
            ("pack.json", m.clone()),
        ]),
    );
    rejected("missing-listed", zip_of(&[("pack.json", m.clone())]));
    rejected("no-manifest", zip_of(&[("faa-1.webp", a.to_vec())]));
    rejected(
        "hash-mismatch",
        zip_of(&[("faa-1.webp", b"other".to_vec()), ("pack.json", m.clone())]),
    );
    rejected(
        "wrong-id",
        zip_of(&[
            ("faa-1.webp", a.to_vec()),
            ("pack.json", manifest("other", &[("faa-1.webp", a)])),
        ]),
    );
    rejected("not-a-zip", b"hello".to_vec());
    let big = vec![0u8; (MAX_FILE_BYTES + 1) as usize];
    let bm = manifest("pack-a", &[("faa-1.webp", &big)]);
    rejected("too-big", zip_of(&[("faa-1.webp", big), ("pack.json", bm)]));
}

#[test]
fn bad_ids_never_touch_disk() {
    let dir = Dir::new("ids");
    assert!(status_in(&dir.0, "../x").is_err());
    assert!(remove_in(&dir.0, "a/b").is_err());
    assert!(image_in(&dir.0, "..", "faa-1.webp").is_err());
}

/// One synthetic response on loopback; never a real network call.
fn serve(body: Vec<u8>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/p.zip", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        if let Ok((mut socket, _)) = listener.accept() {
            let mut buf = [0u8; 2048];
            let _ = socket.read(&mut buf);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(head.as_bytes());
            let _ = socket.write_all(&body);
        }
    });
    url
}

#[test]
fn download_run_installs_and_reports_progress() {
    let dir = Dir::new("net");
    let bytes = good_zip("pack-a");
    let url = serve(bytes.clone());
    let mut last = 0u64;
    let result = tauri::async_runtime::block_on(run(
        &dir.0,
        "pack-a",
        &url,
        &sha_hex(&bytes),
        bytes.len() as u64,
        false,
        Arc::new(CancelToken::default()),
        |received, _| last = received,
    ));
    assert_eq!(result, Ok(()));
    assert_eq!(last, bytes.len() as u64);
    assert!(status_in(&dir.0, "pack-a").unwrap().installed);
    assert_eq!(
        std::fs::read_dir(packs_root(&dir.0).join(TMP_DIR))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn download_over_the_size_cap_is_refused() {
    let dir = Dir::new("cap");
    let body = vec![1u8; (SLACK_BYTES + 100) as usize];
    let url = serve(body.clone());
    let result = tauri::async_runtime::block_on(run(
        &dir.0,
        "pack-a",
        &url,
        &sha_hex(&body),
        10,
        false,
        Arc::new(CancelToken::default()),
        |_, _| {},
    ));
    assert!(result.unwrap_err().contains("bigger"));
    assert!(!packs_root(&dir.0).join("pack-a").exists());
    assert_eq!(
        std::fs::read_dir(packs_root(&dir.0).join(TMP_DIR))
            .map(|d| d.count())
            .unwrap_or(0),
        0
    );
}
