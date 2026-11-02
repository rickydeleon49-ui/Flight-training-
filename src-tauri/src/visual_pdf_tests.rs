use super::*;
use lopdf::{dictionary, Document, Object};
const PNG: &[u8] = crate::visual_cards::tests::PNG;
struct Fixture {
    root: PathBuf,
    conn: Connection,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn fixture() -> Fixture {
    let conn = Connection::open_in_memory().unwrap();
    let id = crate::practice_sessions::generate_uuid_v4(&conn).unwrap();
    let root = std::env::temp_dir().join(format!("hfd-capture-test-{id}"));
    std::fs::create_dir_all(root.join("documents")).unwrap();
    let conn = crate::visual_cards::tests::library(&root);
    let mut doc = Document::with_version("1.5");
    let pages = doc.new_object_id();
    let mut kids = Vec::new();
    for i in 0..3 {
        let content = doc.add_object(lopdf::Stream::new(
            dictionary! {},
            format!("% fictional repeated practice panel {i}\n10 10 100 100 re S 110 10 100 100 re S 210 10 100 100 re S\n").into_bytes(),
        ));
        kids.push(Object::Reference(doc.add_object(dictionary! {
            "Type"=>"Page", "Parent"=>pages, "MediaBox"=>vec![0.into(),0.into(),400.into(),600.into()],
            "CropBox"=>vec![Object::Integer(i*10),0.into(),Object::Integer(400-i*10),600.into()],
            "Rotate"=>i*90, "Contents"=>content,
        })));
    }
    doc.objects.insert(
        pages,
        Object::Dictionary(dictionary! {"Type"=>"Pages","Kids"=>kids,"Count"=>3}),
    );
    let labels = doc.add_object(dictionary!{"Nums"=>vec![0.into(),Object::Dictionary(dictionary!{"S"=>"r","St"=>4}),1.into(),Object::Dictionary(dictionary!{"S"=>"D","P"=>Object::string_literal("A-"),"St"=>1})]});
    let catalog =
        doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages,"PageLabels"=>labels});
    doc.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    std::fs::write(root.join("documents/book.pdf"), &bytes).unwrap();
    conn.execute(
        "UPDATE study_materials SET title='Practice panel',file_path='book.pdf' WHERE id='owner'",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO material_content_identities VALUES ('owner',?1,3,'x')",
        [format!("{:x}", Sha256::digest(&bytes))],
    )
    .unwrap();
    for (i, label) in ["iv", "A-1", "A-2"].iter().enumerate() {
        let id = crate::practice_sessions::generate_uuid_v4(&conn).unwrap();
        conn.execute("INSERT INTO material_bookmarks(id,material_id,page_index,page_label,originating_content_sha256,title,notes,status,created_at,updated_at) SELECT ?1,'owner',?2,?3,content_sha256,'Panel','','verified','x','x' FROM material_content_identities WHERE material_id='owner'",params![id,i+1,label]).unwrap();
    }
    Fixture { root, conn }
}
fn fake(dir: &Path, _: u32) -> Result<PathBuf, String> {
    let path = dir.join("fake.png");
    std::fs::write(&path, PNG).unwrap();
    Ok(path)
}
fn count(f: &Fixture) -> i64 {
    f.conn
        .query_row("SELECT count(*) FROM study_materials", [], |r| r.get(0))
        .unwrap()
}
#[test]
fn selected_page_preserves_crop_rotate_labels_hash_and_visible_image_survives_pdf_delete() {
    let mut f = fixture();
    let original = std::fs::read(f.root.join("documents/book.pdf")).unwrap();
    let mut ids = Vec::new();
    for page in 1..=3 {
        let mut temporary = PathBuf::new();
        let capture = capture_on(&mut f.conn, &f.root, "owner", page, 2048, |dir, px| {
            temporary = dir.to_owned();
            let d = Document::load(dir.join("page.pdf")).unwrap();
            assert_eq!(d.get_pages().len(), 1);
            let p = d.get_dictionary(*d.get_pages().get(&1).unwrap()).unwrap();
            assert_eq!(
                p.get(b"Rotate").unwrap().as_i64().unwrap(),
                (page as i64 - 1) * 90
            );
            assert_eq!(
                p.get(b"CropBox").unwrap().as_array().unwrap()[0]
                    .as_i64()
                    .unwrap(),
                (page as i64 - 1) * 10
            );
            fake(dir, px)
        })
        .unwrap();
        assert!(!temporary.exists());
        assert_eq!(capture.source.id, capture.material_id);
        let saved_title: String = f
            .conn
            .query_row(
                "SELECT title FROM study_materials WHERE id=?1",
                [&capture.material_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            saved_title,
            format!(
                "Practice panel p. {} (picture)",
                ["iv", "A-1", "A-2"][(page - 1) as usize]
            )
        );
        let source_page: u32 = f
            .conn
            .query_row(
                "SELECT physical_page FROM study_page_sources WHERE id=?1",
                [&capture.material_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(source_page, page);
        assert_eq!(
            capture.source.printed_label.as_deref(),
            Some(["iv", "A-1", "A-2"][(page - 1) as usize])
        );
        let image = crate::visual_cards::image_on(&f.conn, &f.root, &capture.material_id).unwrap();
        assert_eq!(
            (image.image_width, image.image_height),
            (capture.image_width, capture.image_height)
        );
        assert_eq!(image.image_sha256, capture.image_sha256);
        ids.push(capture.material_id);
    }
    assert_eq!(
        std::fs::read(f.root.join("documents/book.pdf")).unwrap(),
        original
    );
    f.conn
        .execute("DELETE FROM study_materials WHERE id='owner'", [])
        .unwrap();
    for id in ids {
        assert!(crate::visual_cards::image_on(&f.conn, &f.root, &id).is_ok());
    }
}
#[test]
fn changed_edition_before_or_during_capture_refuses_and_cleans() {
    let mut f = fixture();
    let path = f.root.join("documents/book.pdf");
    let original = std::fs::read(&path).unwrap();
    std::fs::write(&path, b"different edition same name").unwrap();
    assert!(capture_on(&mut f.conn, &f.root, "owner", 1, 100, fake)
        .unwrap_err()
        .contains("changed"));
    std::fs::write(&path, original).unwrap();
    let mut temporary = PathBuf::new();
    let result = capture_on(&mut f.conn, &f.root, "owner", 1, 100, |dir, px| {
        temporary = dir.into();
        std::fs::write(&path, b"changed during render").unwrap();
        fake(dir, px)
    });
    assert!(result.unwrap_err().contains("changed"));
    assert!(!temporary.exists());
    assert_eq!(count(&f), 2);
}
#[test]
fn invalid_page_size_png_and_failed_save_leave_no_copies() {
    let mut f = fixture();
    for (page, px) in [(0, 100), (4, 100), (1, 0), (1, 2049)] {
        assert!(capture_on(&mut f.conn, &f.root, "owner", page, px, fake).is_err());
    }
    for oversized in [false, true] {
        let mut temporary = PathBuf::new();
        assert!(capture_on(&mut f.conn, &f.root, "owner", 1, 100, |dir, _| {
            temporary = dir.into();
            let path = dir.join("bad.png");
            let mut bytes = PNG.to_vec();
            if oversized {
                bytes.resize(crate::visual_cards::MAX_BYTES + 1, 0);
            } else {
                bytes[16..20].copy_from_slice(&4097_u32.to_be_bytes());
            }
            std::fs::write(&path, bytes).unwrap();
            Ok(path)
        })
        .is_err());
        assert!(!temporary.exists());
    }
    f.conn.execute_batch("CREATE TRIGGER fail BEFORE INSERT ON study_page_sources BEGIN SELECT RAISE(ABORT,'full'); END;").unwrap();
    assert!(capture_on(&mut f.conn, &f.root, "owner", 1, 100, fake).is_err());
    assert_eq!(count(&f), 2);
    assert_eq!(
        std::fs::read_dir(f.root.join("documents")).unwrap().count(),
        2
    );
}
#[test]
fn missing_tools_and_injected_timeout_clean_temp() {
    let mut f = fixture();
    let mut temporary = PathBuf::new();
    assert!(
        capture_on(&mut f.conn, &f.root, "owner", 1, 100, |dir, px| {
            temporary = dir.into();
            raster(
                dir,
                px,
                Path::new("/missing/qlmanage"),
                Path::new("/missing/sips"),
                Duration::from_secs(1),
            )
        })
        .unwrap_err()
        .contains("unavailable")
    );
    assert!(!temporary.exists());
    // /usr/bin/yes is a harmless long-running fake: output is discarded, killed and reaped.
    let result = capture_on(&mut f.conn, &f.root, "owner", 1, 100, |dir, _| {
        temporary = dir.into();
        run(
            Path::new("/usr/bin/yes"),
            &[],
            Instant::now() + Duration::from_millis(40),
        )?;
        unreachable!()
    });
    assert!(result.unwrap_err().contains("timed out"));
    assert!(!temporary.exists());
    assert_eq!(count(&f), 2);
}
#[test]
fn changed_note_refuses_even_when_material_identity_is_current() {
    let mut f = fixture();
    f.conn
        .execute(
            "UPDATE material_bookmarks SET originating_content_sha256=?1 WHERE page_index=2",
            ["a".repeat(64)],
        )
        .unwrap();
    assert!(capture_on(&mut f.conn, &f.root, "owner", 2, 100, fake)
        .unwrap_err()
        .contains("changed since"));
    assert_eq!(count(&f), 2);
}
#[test]
fn tool_failure_and_fallback_use_the_owned_paths() {
    let mut f = fixture();
    let mut temporary = PathBuf::new();
    let result = capture_on(&mut f.conn, &f.root, "owner", 1, 100, |dir, px| {
        temporary = dir.into();
        // A successful fake fallback supplies the known fixture output. Quick Look
        // fails to start; /usr/bin/true accepts args without reading any files.
        std::fs::write(dir.join("page.png"), PNG).unwrap();
        raster(
            dir,
            px,
            Path::new("/missing/qlmanage"),
            Path::new("/usr/bin/true"),
            Duration::from_secs(1),
        )
    });
    assert!(result.is_ok());
    assert!(!temporary.exists());
    let result = capture_on(&mut f.conn, &f.root, "owner", 1, 100, |dir, px| {
        raster(
            dir,
            px,
            Path::new("/usr/bin/false"),
            Path::new("/usr/bin/false"),
            Duration::from_secs(1),
        )
    });
    assert!(result.unwrap_err().contains("couldn't turn"));
}
#[test]
#[ignore = "Claude: real Mac Quick Look feasibility/geometry check with synthetic PDF only"]
fn real_mac_raster() {
    let mut f = fixture();
    assert!(
        capture_on(&mut f.conn, &f.root, "owner", 2, 1000, |dir, px| raster(
            dir,
            px,
            Path::new("/usr/bin/qlmanage"),
            Path::new("/usr/bin/sips"),
            Duration::from_secs(30)
        ))
        .is_ok()
    );
}
