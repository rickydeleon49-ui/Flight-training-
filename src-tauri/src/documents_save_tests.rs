//! Ordinary study-material saves and reference-safe file cleanup, against a
//! database built from the app's real registered migrations.
//!
//! Every case gets its own disposable profile. Connections are locals declared
//! after the profile, so they close before the profile's `Drop` removes the
//! directory, and a removal failure in a passing test fails that test instead
//! of silently leaving a fixture behind.

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

const PROFILE_PREFIX: &str = "hfd-a2-save-";

pub(super) struct Profile {
    root: PathBuf,
}

impl Profile {
    pub(super) fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "{PROFILE_PREFIX}{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let profile = Self { root };
        let db = profile.db();
        for migration in crate::migrations() {
            db.execute_batch(migration.sql).unwrap();
        }
        profile
    }

    pub(super) fn path(&self) -> &Path {
        &self.root
    }

    pub(super) fn docs(&self) -> PathBuf {
        self.root.join(DOCUMENTS_DIR)
    }

    /// A fresh connection, i.e. the database as it reads after reopening.
    pub(super) fn db(&self) -> Connection {
        let db = Connection::open(self.root.join("her-flight-deck.db")).unwrap();
        db.pragma_update(None, "foreign_keys", "ON").unwrap();
        db
    }

    pub(super) fn write_doc(&self, relative: &str, bytes: &[u8]) -> PathBuf {
        let path = self.docs().join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, bytes).unwrap();
        path
    }
}

impl Drop for Profile {
    fn drop(&mut self) {
        let in_temp = self.root.parent() == Some(std::env::temp_dir().as_path());
        let ours = self
            .root
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(PROFILE_PREFIX));
        if !(in_temp && ours) {
            return;
        }
        let removed = std::fs::remove_dir_all(&self.root);
        if !std::thread::panicking() {
            removed.unwrap_or_else(|e| panic!("dispose {}: {e}", self.root.display()));
        }
    }
}

pub(super) fn op(mode: &str, id: &str, tags: Option<&[&str]>) -> MaterialSaveOperation {
    MaterialSaveOperation {
        mode: mode.to_string(),
        id: id.to_string(),
        fields: MaterialSaveFields {
            title: (mode == "create").then(|| format!("Synthetic {id}")),
            ..Default::default()
        },
        tags: tags.map(|t| t.iter().map(|s| s.to_string()).collect()),
        created_at: None,
        updated_at: None,
    }
}

fn with_file(mut operation: MaterialSaveOperation, path: &str) -> MaterialSaveOperation {
    operation.fields.file_path = Some(Some(path.to_string()));
    operation
}

/// Tag names linked to a material, read from a fresh connection, sorted.
pub(super) fn persisted_tags(profile: &Profile, id: &str) -> Vec<String> {
    let db = profile.db();
    let mut stmt = db
        .prepare(
            "SELECT t.name FROM material_tags mt JOIN tags t ON t.id = mt.tag_id
             WHERE mt.material_id = ?1 ORDER BY t.name",
        )
        .unwrap();
    let names = stmt
        .query_map([id], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<String>, _>>()
        .unwrap();
    names
}

/// Every column of a material row, read from a fresh connection.
pub(super) fn full_row(profile: &Profile, id: &str) -> Option<Vec<String>> {
    let db = profile.db();
    let row = db
        .query_row(
            "SELECT id, title, material_type, topic, review_status, priority, goal_id,
                    event_id, notes, file_path, original_file_name, file_size,
                    created_at, updated_at, last_reviewed_at
             FROM study_materials WHERE id = ?1",
            [id],
            |row| {
                (0..15)
                    .map(|i| {
                        row.get::<_, rusqlite::types::Value>(i)
                            .map(|value| format!("{value:?}"))
                    })
                    .collect::<Result<Vec<_>, _>>()
            },
        )
        .optional()
        .unwrap();
    row
}

fn tag_rows(profile: &Profile) -> Vec<(String, String)> {
    let db = profile.db();
    let mut stmt = db.prepare("SELECT id, name FROM tags ORDER BY id").unwrap();
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    rows
}

fn count(profile: &Profile, sql: &str) -> i64 {
    profile.db().query_row(sql, [], |row| row.get(0)).unwrap()
}

fn sorted(mut tags: Vec<String>) -> Vec<String> {
    tags.sort();
    tags
}

/* ----------------------------- R1: tags ----------------------------- */

#[test]
fn replacing_a_tag_persists_the_acknowledged_tag_after_reopen() {
    let profile = Profile::new();
    save_material_operation_at(profile.path(), &op("create", "tags-1", Some(&["Old tag"])))
        .unwrap();
    let result =
        save_material_operation_at(profile.path(), &op("update", "tags-1", Some(&["New tag"])))
            .unwrap();
    assert_eq!(result.tags, vec!["New tag".to_string()]);
    assert_eq!(persisted_tags(&profile, "tags-1"), result.tags);
    // The old tag row is preserved, never deleted to free its id.
    assert!(tag_rows(&profile).iter().any(|(_, name)| name == "Old tag"));
}

#[test]
fn repeated_replacement_reorder_removal_and_shared_tags_stay_truthful() {
    let profile = Profile::new();
    let p = profile.path();
    save_material_operation_at(p, &op("create", "other", Some(&["Shared", "Weather"]))).unwrap();
    save_material_operation_at(p, &op("create", "tags-2", Some(&["A", "B", "C"]))).unwrap();

    let steps: [&[&str]; 6] = [
        &["C", "A"],
        &["D", "E", "F"],
        &["F", "E", "D"],
        &[],
        &["A", "Shared"],
        &["Weather", "Shared", "G"],
    ];
    for tags in steps {
        let result = save_material_operation_at(p, &op("update", "tags-2", Some(tags))).unwrap();
        let wanted: Vec<String> = tags.iter().map(|s| s.to_string()).collect();
        assert_eq!(
            result.tags, wanted,
            "returned tags keep the requested order"
        );
        assert_eq!(persisted_tags(&profile, "tags-2"), sorted(wanted));
    }
    // The other material's links to the shared rows are untouched.
    assert_eq!(persisted_tags(&profile, "other"), vec!["Shared", "Weather"]);
    // One row per name; reuse never duplicates a tag.
    assert_eq!(
        count(&profile, "SELECT COUNT(*) FROM tags"),
        count(&profile, "SELECT COUNT(DISTINCT name) FROM tags")
    );
}

#[test]
fn orphan_tags_and_unrelated_id_collisions_do_not_suppress_links() {
    let profile = Profile::new();
    {
        let db = profile.db();
        // An orphan with the requested name, and a row occupying the id the
        // old position-derived scheme would have chosen, under another name.
        db.execute_batch(
            "INSERT INTO tags (id, name, created_at) VALUES ('orphan-id', 'Orphan', '2026-01-01T00:00:00.000Z');
             INSERT INTO tags (id, name, created_at) VALUES ('tags-3-tag-0', 'Unrelated', '2026-01-01T00:00:00.000Z');
             INSERT INTO tags (id, name, created_at) VALUES ('tags-3-tag-1', 'Also unrelated', '2026-01-01T00:00:00.000Z');",
        )
        .unwrap();
    }
    let result = save_material_operation_at(
        profile.path(),
        &op("create", "tags-3", Some(&["Fresh", "Orphan"])),
    )
    .unwrap();
    assert_eq!(result.tags, vec!["Fresh", "Orphan"]);
    assert_eq!(persisted_tags(&profile, "tags-3"), vec!["Fresh", "Orphan"]);
    let rows = tag_rows(&profile);
    assert!(rows.contains(&("orphan-id".into(), "Orphan".into())));
    assert!(rows.contains(&("tags-3-tag-0".into(), "Unrelated".into())));
    assert!(rows.contains(&("tags-3-tag-1".into(), "Also unrelated".into())));
    let linked_orphan: String = profile
        .db()
        .query_row(
            "SELECT tag_id FROM material_tags WHERE material_id = 'tags-3' AND tag_id = 'orphan-id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(linked_orphan, "orphan-id");

    save_material_operation_at(
        profile.path(),
        &op("update", "tags-3", Some(&["Unrelated", "New"])),
    )
    .unwrap();
    assert_eq!(persisted_tags(&profile, "tags-3"), vec!["New", "Unrelated"]);
}

/// Each injected failure, on create and on update, must roll back everything.
#[test]
fn tag_and_link_failures_roll_back_create_and_update() {
    let triggers = [
        "CREATE TRIGGER inject BEFORE INSERT ON tags BEGIN SELECT RAISE(FAIL, 'injected tag failure'); END;",
        "CREATE TRIGGER inject BEFORE INSERT ON material_tags BEGIN SELECT RAISE(FAIL, 'injected link failure'); END;",
        // A silently ignored insert: the old code would still have reported success.
        "CREATE TRIGGER inject BEFORE INSERT ON tags BEGIN SELECT RAISE(IGNORE); END;",
        "CREATE TRIGGER inject BEFORE INSERT ON material_tags BEGIN SELECT RAISE(IGNORE); END;",
    ];
    for trigger in triggers {
        let profile = Profile::new();
        let p = profile.path();
        let docs_before = profile.write_doc("kept.pdf", b"kept bytes");
        let mut original = with_file(op("create", "prior", Some(&["Keep"])), "kept.pdf");
        original.fields.notes = Some("Original notes".to_string());
        save_material_operation_at(p, &original).unwrap();
        let prior_row = full_row(&profile, "prior");
        let prior_tags = tag_rows(&profile);
        profile.db().execute_batch(trigger).unwrap();

        let created = save_material_operation_at(p, &op("create", "debris", Some(&["Brand new"])));
        assert!(
            created.is_err(),
            "{trigger}: create must fail, got {created:?}"
        );
        assert_eq!(full_row(&profile, "debris"), None, "{trigger}");
        assert_eq!(
            count(
                &profile,
                "SELECT COUNT(*) FROM material_tags WHERE material_id = 'debris'"
            ),
            0
        );

        let mut edit = op("update", "prior", Some(&["Different"]));
        edit.fields.title = Some("Edited".to_string());
        edit.fields.notes = Some("Edited notes".to_string());
        let updated = save_material_operation_at(p, &edit);
        assert!(
            updated.is_err(),
            "{trigger}: update must fail, got {updated:?}"
        );
        assert_eq!(full_row(&profile, "prior"), prior_row, "{trigger}");
        assert_eq!(persisted_tags(&profile, "prior"), vec!["Keep"], "{trigger}");
        assert_eq!(tag_rows(&profile), prior_tags, "{trigger}: no new tag rows");
        assert_eq!(std::fs::read(&docs_before).unwrap(), b"kept bytes");
    }
}

#[test]
fn tag_normalization_omission_clearing_unicode_and_case_are_preserved() {
    let profile = Profile::new();
    let p = profile.path();
    let created = save_material_operation_at(
        p,
        &op(
            "create",
            "norm",
            Some(&[
                "IFR",
                "  IFR  ",
                "ifr",
                "   ",
                "Navigation ✈",
                "Ünïcode",
                "IFR",
            ]),
        ),
    )
    .unwrap();
    assert_eq!(created.tags, vec!["IFR", "ifr", "Navigation ✈", "Ünïcode"]);
    assert_eq!(
        persisted_tags(&profile, "norm"),
        sorted(created.tags.clone()),
        "case-distinct names stay distinct, as SQLite's binary UNIQUE treats them"
    );

    let mut retitle = op("update", "norm", None);
    retitle.fields.title = Some("Retitled".to_string());
    let omitted = save_material_operation_at(p, &retitle).unwrap();
    assert_eq!(omitted.tags, persisted_tags(&profile, "norm"));

    let cleared = save_material_operation_at(p, &op("update", "norm", Some(&[]))).unwrap();
    assert!(cleared.tags.is_empty());
    assert!(persisted_tags(&profile, "norm").is_empty());

    let refused = save_material_operation_at(p, &op("create", "norm", Some(&["Intruder"])));
    assert!(refused.is_err());
    assert_eq!(
        full_row(&profile, "norm").unwrap()[1],
        format!("{:?}", rusqlite::types::Value::Text("Retitled".into()))
    );
    assert!(persisted_tags(&profile, "norm").is_empty());
}

/* ------------------------- shared JS/native contract ------------------------- */

fn json_rows(db: &Connection, sql: &str) -> serde_json::Value {
    let mut stmt = db.prepare(sql).unwrap();
    let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let rows = stmt
        .query_map([], |row| {
            let mut object = serde_json::Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => serde_json::json!(n),
                    rusqlite::types::ValueRef::Real(f) => serde_json::json!(f),
                    rusqlite::types::ValueRef::Text(t) => {
                        serde_json::json!(String::from_utf8_lossy(t).to_string())
                    }
                    rusqlite::types::ValueRef::Blob(_) => serde_json::Value::Null,
                };
                object.insert(name.clone(), value);
            }
            Ok(serde_json::Value::Object(object))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    serde_json::Value::Array(rows)
}

/// The same shape as `snapshot` in `src/data/materialSaveContract.test.ts`.
fn contract_snapshot(profile: &Profile) -> serde_json::Value {
    let db = profile.db();
    let tag_names: Vec<serde_json::Value> = json_rows(&db, "SELECT name FROM tags ORDER BY name")
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["name"].clone())
        .collect();
    serde_json::json!({
        "materials": json_rows(&db, "SELECT id, title, material_type, topic, review_status, priority, goal_id, event_id,
              notes, file_path, original_file_name, file_size, created_at, updated_at,
              last_reviewed_at
         FROM study_materials ORDER BY id"),
        "links": json_rows(&db, "SELECT mt.material_id, t.name FROM material_tags mt JOIN tags t ON t.id = mt.tag_id
        ORDER BY mt.material_id, t.name"),
        "tagNames": tag_names,
    })
}

#[test]
fn shared_contract_fixtures_return_and_persist_the_same_results_as_the_browser_transaction() {
    let steps: serde_json::Value = serde_json::from_str(include_str!(
        "../fixtures/material-save-contract/steps.json"
    ))
    .unwrap();
    let expected: serde_json::Value = serde_json::from_str(include_str!(
        "../fixtures/material-save-contract/expected.json"
    ))
    .unwrap();
    let profile = Profile::new();
    for file in steps["files"].as_array().unwrap() {
        profile.write_doc(file.as_str().unwrap(), b"contract bytes");
    }
    let steps = steps["steps"].as_array().unwrap();
    let expected = expected["results"].as_array().unwrap();
    assert_eq!(steps.len(), expected.len());
    for (step, want) in steps.iter().zip(expected) {
        let name = step["name"].as_str().unwrap();
        // Deserialized exactly as Tauri would hand it to the command.
        let operation: MaterialSaveOperation =
            serde_json::from_value(step["operation"].clone()).unwrap();
        let returned = save_material_operation_at(profile.path(), &operation)
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(
            serde_json::to_value(&returned).unwrap(),
            want["returned"],
            "{name}: returned material"
        );
        assert_eq!(
            contract_snapshot(&profile),
            want["after"],
            "{name}: rows after reopen"
        );
    }
}

/* ---------------------- R2: reference-safe cleanup ---------------------- */

pub(super) fn sha256(path: &Path) -> String {
    use sha2::Digest;
    hex::encode(sha2::Sha256::digest(std::fs::read(path).unwrap()))
}

fn attach(profile: &Profile, id: &str, stored_path: &str) {
    // Legacy and alias spellings are written directly, as an older version or
    // a restored backup could have stored them; the save command itself only
    // accepts the canonical spelling of a new attachment.
    profile
        .db()
        .execute(
            "INSERT INTO study_materials (id, title, file_path, created_at, updated_at)
             VALUES (?1, ?1, ?2, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')",
            params![id, stored_path],
        )
        .unwrap();
}

fn references(profile: &Profile) -> Vec<(String, Option<String>)> {
    let db = profile.db();
    let mut stmt = db
        .prepare("SELECT id, file_path FROM study_materials ORDER BY id")
        .unwrap();
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    rows
}

fn trash_is_empty(profile: &Profile) -> bool {
    let trash = profile.docs().join(TRASH_DIR);
    !trash.exists() || std::fs::read_dir(trash).unwrap().next().is_none()
}

/// Promoted reviewer reproduction: `nested//attached.pdf` used to remove the
/// file `nested/attached.pdf` was attached under.
#[test]
fn an_equivalent_slash_spelling_cannot_delete_a_referenced_file() {
    let profile = Profile::new();
    let path = profile.write_doc("nested/attached.pdf", b"Synthetic referenced bytes");
    let hash = sha256(&path);
    save_material_operation_at(
        profile.path(),
        &with_file(op("create", "alias", None), "nested/attached.pdf"),
    )
    .unwrap();
    let before = references(&profile);
    for alias in [
        "nested//attached.pdf",
        "nested/./attached.pdf",
        "nested/attached.pdf/",
    ] {
        let result = delete_document_in(profile.path(), alias);
        assert!(result.is_err(), "{alias} must be refused, got {result:?}");
        assert!(path.is_file(), "{alias} removed the referenced file");
        assert_eq!(sha256(&path), hash);
    }
    assert_eq!(references(&profile), before);
    assert!(trash_is_empty(&profile));
}

/// Promoted reviewer reproduction: on a case-insensitive Windows volume,
/// `CASEGUIDE.PDF` used to remove the file attached as `CaseGuide.pdf`.
#[cfg(windows)]
#[test]
fn a_windows_case_alias_cannot_delete_or_trash_a_referenced_file() {
    let profile = Profile::new();
    let path = profile.write_doc("CaseGuide.pdf", b"Synthetic referenced bytes");
    let hash = sha256(&path);
    save_material_operation_at(
        profile.path(),
        &with_file(op("create", "case-alias", None), "CaseGuide.pdf"),
    )
    .unwrap();
    let before = references(&profile);
    let deleted = delete_document_in(profile.path(), "CASEGUIDE.PDF");
    assert!(deleted.is_err(), "{deleted:?}");
    let trashed = trash_unlinked_file_in(profile.path(), "caseguide.pdf");
    assert!(trashed.is_err(), "{trashed:?}");
    assert!(path.is_file());
    assert_eq!(sha256(&path), hash);
    assert_eq!(references(&profile), before);
    assert!(trash_is_empty(&profile));
}

/// Legacy stored spellings protect the file they resolve to, whichever
/// spelling the cleanup request uses.
#[test]
fn legacy_and_shared_stored_spellings_protect_the_physical_file() {
    let profile = Profile::new();
    let backslash = profile.write_doc("legacy/back.pdf", b"backslash bytes");
    let redundant = profile.write_doc("legacy/redundant.pdf", b"redundant bytes");
    let shared = profile.write_doc("shared.pdf", b"shared bytes");
    attach(&profile, "m-back", "legacy\\back.pdf");
    attach(&profile, "m-redundant", "legacy//redundant.pdf");
    attach(&profile, "m-shared-1", "shared.pdf");
    attach(&profile, "m-shared-2", "shared.pdf");
    let files = [&backslash, &redundant, &shared];
    let hashes = files.map(|p| sha256(p));

    for request in [
        "legacy/back.pdf",
        "legacy\\back.pdf",
        "legacy/redundant.pdf",
        "shared.pdf",
    ] {
        assert!(
            delete_document_in(profile.path(), request).is_err(),
            "{request}"
        );
        assert!(
            trash_unlinked_file_in(profile.path(), request).is_err(),
            "{request}"
        );
    }
    #[cfg(windows)]
    for request in ["LEGACY/BACK.PDF", "Legacy/Redundant.PDF", "SHARED.pdf"] {
        assert!(
            delete_document_in(profile.path(), request).is_err(),
            "{request}"
        );
    }
    assert_eq!(files.map(|p| sha256(p)), hashes);
    assert_eq!(references(&profile).len(), 4);
    assert!(trash_is_empty(&profile));
}

/// A stored reference reached through a directory link is the same file.
#[test]
fn a_directory_link_alias_cannot_delete_a_referenced_file() {
    let profile = Profile::new();
    let path = profile.write_doc("real/linked.pdf", b"linked bytes");
    attach(&profile, "m-linked", "real/linked.pdf");
    let link = profile.docs().join("alias");
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(profile.docs().join("real"), &link);
    // A symlink needs Developer Mode or elevation on Windows; a junction does not.
    #[cfg(windows)]
    let made =
        std::os::windows::fs::symlink_dir(profile.docs().join("real"), &link).or_else(|_| {
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(profile.docs().join("real"))
                .stdout(std::process::Stdio::null())
                .status()?;
            if status.success() {
                Ok(())
            } else {
                Err(std::io::Error::other(format!("mklink /J failed: {status}")))
            }
        });
    if let Err(error) = made {
        eprintln!("SKIPPED directory-link alias: cannot create a directory link here ({error})");
        return;
    }
    let result = delete_document_in(profile.path(), "alias/linked.pdf");
    assert!(result.is_err(), "{result:?}");
    assert!(path.is_file());
    assert_eq!(std::fs::read(&path).unwrap(), b"linked bytes");
    // A link to a file is never deleted through, either.
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&path, profile.docs().join("file-link.pdf")).unwrap();
        assert!(delete_document_in(profile.path(), "file-link.pdf").is_err());
        assert!(path.is_file());
    }
    #[cfg(windows)]
    std::fs::remove_dir(&link).unwrap();
    #[cfg(unix)]
    std::fs::remove_file(&link).unwrap();
}

/// On a case-sensitive volume `Guide.pdf` and `GUIDE.PDF` are two files; the
/// referenced one is protected and the unused one can still be cleaned up.
/// Windows NTFS and default macOS APFS volumes are case-insensitive, so this
/// runs where the temporary directory is case-sensitive (Linux CI); it proves
/// nothing about a case-sensitive APFS volume on a Mac.
#[test]
fn distinct_case_files_on_a_case_sensitive_volume_are_not_conflated() {
    let profile = Profile::new();
    let probe = profile.write_doc("Probe.pdf", b"probe");
    let case_sensitive = !profile.docs().join("PROBE.PDF").exists();
    std::fs::remove_file(probe).unwrap();
    if !case_sensitive {
        eprintln!("SKIPPED case-sensitive identity: this volume is case-insensitive");
        return;
    }
    let referenced = profile.write_doc("Guide.pdf", b"referenced");
    let unused = profile.write_doc("GUIDE.PDF", b"unused");
    attach(&profile, "m-guide", "Guide.pdf");
    delete_document_in(profile.path(), "GUIDE.PDF").unwrap();
    assert!(!unused.exists());
    assert_eq!(std::fs::read(&referenced).unwrap(), b"referenced");
    assert!(delete_document_in(profile.path(), "Guide.pdf").is_err());
}

#[test]
fn unsafe_paths_and_uninspectable_databases_fail_closed() {
    let profile = Profile::new();
    let path = profile.write_doc("kept.pdf", b"kept");
    for request in [
        "../escaped.pdf",
        "sub/../kept.pdf",
        ".trash/forged.pdf",
        "/kept.pdf",
        "C:/kept.pdf",
        "kept.pdf:stream",
        "kept.pdf.",
        "kept.pdf ",
    ] {
        assert!(
            delete_document_in(profile.path(), request).is_err(),
            "{request}"
        );
    }
    assert!(path.is_file());

    // A corrupt database cannot be inspected, so nothing is removed.
    let db_path = profile.path().join("her-flight-deck.db");
    let real = std::fs::read(&db_path).unwrap();
    std::fs::write(&db_path, b"not a database").unwrap();
    assert!(delete_document_in(profile.path(), "kept.pdf").is_err());
    assert!(path.is_file());
    // Nor can a missing one.
    std::fs::remove_file(&db_path).unwrap();
    assert!(delete_document_in(profile.path(), "kept.pdf").is_err());
    assert!(path.is_file());
    // A database without the materials table is refused, not treated as empty.
    {
        let empty = Connection::open(&db_path).unwrap();
        empty
            .execute_batch("CREATE TABLE unrelated (id TEXT)")
            .unwrap();
    }
    assert!(delete_document_in(profile.path(), "kept.pdf").is_err());
    assert!(path.is_file());
    std::fs::write(&db_path, real).unwrap();
    assert!(trash_is_empty(&profile));
}

#[test]
fn unused_and_no_longer_referenced_files_are_still_cleaned_up() {
    let profile = Profile::new();
    let unused = profile.write_doc("unused.pdf", b"unused");
    let detached = profile.write_doc("detached.pdf", b"detached");
    let kept = profile.write_doc("kept.pdf", b"kept");
    attach(&profile, "m-kept", "kept.pdf");
    attach(&profile, "m-detached", "detached.pdf");
    // References that cannot open anything never protect an unrelated file.
    attach(&profile, "m-escaping", "../unused.pdf");
    attach(&profile, "m-missing", "gone/missing.pdf");

    delete_document_in(profile.path(), "unused.pdf").unwrap();
    assert!(!unused.exists());
    // Intentional removal: the material row goes first, then its file.
    profile
        .db()
        .execute("DELETE FROM study_materials WHERE id = 'm-detached'", [])
        .unwrap();
    delete_document_in(profile.path(), "detached.pdf").unwrap();
    assert!(!detached.exists());
    assert!(delete_document_in(profile.path(), "already-gone.pdf").is_ok());
    assert!(kept.is_file());
    assert!(trash_is_empty(&profile));
}

/* ------------------- R3: attachments versus cleanup ------------------- */

/// Promoted reviewer reproduction. Both commands take the database's writer
/// lock for their whole check-and-change, so running them one after the other
/// is exactly the cleanup-wins ordering.
#[test]
fn cleanup_first_then_a_save_cannot_attach_the_deleted_file() {
    let profile = Profile::new();
    let p = profile.path();
    let old = profile.write_doc("old.pdf", b"old bytes");
    let old_hash = sha256(&old);
    save_material_operation_at(
        p,
        &with_file(op("create", "existing", Some(&["Kept"])), "old.pdf"),
    )
    .unwrap();
    let existing_row = full_row(&profile, "existing");
    let path = profile.write_doc("new-import.pdf", b"Synthetic imported bytes");

    delete_document_in(p, "new-import.pdf").unwrap();
    assert!(!path.exists());

    let created = save_material_operation_at(
        p,
        &with_file(op("create", "attach", None), "new-import.pdf"),
    );
    assert!(created.is_err(), "{created:?}");
    assert_eq!(full_row(&profile, "attach"), None);

    let mut replace = with_file(op("update", "existing", Some(&["Other"])), "new-import.pdf");
    replace.fields.title = Some("Should not land".to_string());
    let replaced = save_material_operation_at(p, &replace);
    assert!(replaced.is_err(), "{replaced:?}");
    assert_eq!(full_row(&profile, "existing"), existing_row);
    assert_eq!(persisted_tags(&profile, "existing"), vec!["Kept"]);
    assert_eq!(sha256(&old), old_hash);
    assert_eq!(
        count(
            &profile,
            "SELECT COUNT(*) FROM study_materials WHERE file_path = 'new-import.pdf'"
        ),
        0
    );
}

#[test]
fn save_first_then_cleanup_preserves_the_now_referenced_file() {
    let profile = Profile::new();
    let p = profile.path();
    let path = profile.write_doc("new-import.pdf", b"Synthetic imported bytes");
    let hash = sha256(&path);
    save_material_operation_at(
        p,
        &with_file(op("create", "attach", None), "new-import.pdf"),
    )
    .unwrap();
    assert!(delete_document_in(p, "new-import.pdf").is_err());
    assert!(trash_unlinked_file_in(p, "new-import.pdf").is_err());
    assert_eq!(sha256(&path), hash);
    assert_eq!(
        references(&profile),
        vec![("attach".to_string(), Some("new-import.pdf".to_string()))]
    );
}

/// The file disappears while the save is waiting for the writer lock (the
/// test holds it, standing in for cleanup's critical section). However the
/// threads are scheduled, the save checks the file only after it has the lock.
#[test]
fn a_save_waiting_for_the_writer_lock_sees_the_cleanup_outcome() {
    let profile = Profile::new();
    let path = profile.write_doc("racing.pdf", b"racing bytes");
    let locker = profile.db();
    locker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let root = profile.path().to_path_buf();
    let save = std::thread::spawn(move || {
        save_material_operation_at(&root, &with_file(op("create", "racer", None), "racing.pdf"))
    });
    std::fs::remove_file(&path).unwrap();
    locker.execute_batch("COMMIT").unwrap();
    let result = save.join().unwrap();
    assert!(result.is_err(), "{result:?}");
    assert_eq!(full_row(&profile, "racer"), None);
}

#[test]
fn a_failed_replacement_keeps_the_old_row_tags_and_file() {
    let profile = Profile::new();
    let p = profile.path();
    let old = profile.write_doc("old.pdf", b"old bytes");
    let old_hash = sha256(&old);
    let mut original = with_file(op("create", "keep", Some(&["Old tag"])), "old.pdf");
    original.fields.original_file_name = Some(Some("Old.pdf".to_string()));
    original.fields.file_size = Some(Some(9));
    save_material_operation_at(p, &original).unwrap();
    let prior = full_row(&profile, "keep");
    let new = profile.write_doc("replacement.pdf", b"replacement bytes");
    profile
        .db()
        .execute_batch(
            "CREATE TRIGGER inject BEFORE INSERT ON material_tags BEGIN SELECT RAISE(FAIL, 'injected'); END;",
        )
        .unwrap();

    let mut replace = with_file(op("update", "keep", Some(&["New tag"])), "replacement.pdf");
    replace.fields.original_file_name = Some(Some("Replacement.pdf".to_string()));
    replace.fields.file_size = Some(Some(17));
    assert!(save_material_operation_at(p, &replace).is_err());
    assert_eq!(full_row(&profile, "keep"), prior);
    assert_eq!(persisted_tags(&profile, "keep"), vec!["Old tag"]);
    assert_eq!(sha256(&old), old_hash);

    // Only the genuinely unused new copy can be discarded; the old one cannot.
    assert!(delete_document_in(p, "old.pdf").is_err());
    delete_document_in(p, "replacement.pdf").unwrap();
    assert!(!new.exists());
    assert_eq!(sha256(&old), old_hash);
}

#[test]
fn ordinary_attachment_flows_still_work() {
    let profile = Profile::new();
    let p = profile.path();

    // A note without a file.
    let note = save_material_operation_at(p, &op("create", "note", Some(&["Note"]))).unwrap();
    assert_eq!(note.file_path, None);

    // A large original: no split-part size or page limit for ordinary imports.
    let large = profile.docs().join("large.pdf");
    std::fs::File::create(&large)
        .unwrap()
        .set_len(crate::pdf::MAX_PDF_BYTES + 1024 * 1024)
        .unwrap();
    let saved = save_material_operation_at(p, &with_file(op("create", "large", None), "large.pdf"))
        .unwrap();
    assert_eq!(saved.file_path.as_deref(), Some("large.pdf"));

    // A successful replacement, then explicit removal of the attachment.
    profile.write_doc("second.pdf", b"second");
    save_material_operation_at(p, &with_file(op("update", "large", None), "second.pdf")).unwrap();
    assert_eq!(references(&profile)[0].1.as_deref(), Some("second.pdf"));
    let mut remove = op("update", "large", None);
    remove.fields.file_path = Some(None);
    assert_eq!(
        save_material_operation_at(p, &remove).unwrap().file_path,
        None
    );

    // A metadata edit of a material whose recorded file has gone missing,
    // including one that re-sends the recorded path, and a legacy spelling.
    attach(&profile, "missing", "gone/missing.pdf");
    attach(&profile, "legacy", "gone\\legacy.pdf");
    let mut edit = with_file(op("update", "missing", None), "gone/missing.pdf");
    edit.fields.title = Some("Renamed while missing".to_string());
    let edited = save_material_operation_at(p, &edit).unwrap();
    assert_eq!(edited.file_path.as_deref(), Some("gone/missing.pdf"));
    let mut legacy = with_file(op("update", "legacy", None), "gone\\legacy.pdf");
    legacy.fields.notes = Some("Still editable".to_string());
    save_material_operation_at(p, &legacy).unwrap();
}

#[test]
fn new_attachments_must_be_real_app_owned_files() {
    let profile = Profile::new();
    let p = profile.path();
    profile.write_doc(".trash/staged.data", b"trash");
    profile.write_doc("nested/real.pdf", b"real");
    std::fs::create_dir_all(profile.docs().join("folder.pdf")).unwrap();
    for path in [
        "missing.pdf",
        ".trash/staged.data",
        "nested//real.pdf",
        "nested\\real.pdf",
        "nested/./real.pdf",
        "../outside.pdf",
        "folder.pdf",
        "real.pdf ",
    ] {
        let created = save_material_operation_at(p, &with_file(op("create", "bad", None), path));
        assert!(created.is_err(), "{path}: {created:?}");
        assert_eq!(full_row(&profile, "bad"), None, "{path}");
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            profile.docs().join("nested/real.pdf"),
            profile.docs().join("link.pdf"),
        )
        .unwrap();
        assert!(
            save_material_operation_at(p, &with_file(op("create", "bad", None), "link.pdf"))
                .is_err()
        );
    }
    save_material_operation_at(p, &with_file(op("create", "good", None), "nested/real.pdf"))
        .unwrap();
}

/* --------------------------- SQLite writer locks --------------------------- */

/// Another connection holds the writer lock for a while (standing in for a
/// backup snapshot or an autosave); the save waits inside SQLite's busy
/// timeout and then commits. The elapsed time shows it really waited.
#[test]
fn an_ordinary_save_waits_out_a_transient_writer_lock() {
    let profile = Profile::new();
    let locker = profile.db();
    locker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let hold = Duration::from_millis(400);
    let release = std::thread::spawn(move || {
        std::thread::sleep(hold);
        locker.execute_batch("COMMIT").unwrap();
    });
    let started = std::time::Instant::now();
    let saved = save_material_operation_at(profile.path(), &op("create", "waited", Some(&["Tag"])));
    let elapsed = started.elapsed();
    release.join().unwrap();
    assert!(saved.is_ok(), "{saved:?}");
    assert!(
        elapsed >= Duration::from_millis(300),
        "did not wait: {elapsed:?}"
    );
    assert_eq!(persisted_tags(&profile, "waited"), vec!["Tag"]);
    eprintln!("MEASURED transient lock: save committed after {elapsed:?}");
}

/// A lock that never clears is reported after one busy timeout (5 s, about
/// 5.5 s measured on Windows), with the "database is locked" wording the
/// frontend retry recognises, and nothing is written. The frontend makes at
/// most four such attempts with 100/300/700 ms pauses, so the user waits
/// roughly 4 x 5.5 s + 1.1 s, about 23 s, in total.
#[test]
fn an_ordinary_save_reports_a_permanent_writer_lock_after_one_busy_timeout() {
    let profile = Profile::new();
    let locker = profile.db();
    locker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let started = std::time::Instant::now();
    let result =
        save_material_operation_at(profile.path(), &op("create", "blocked", Some(&["Tag"])));
    let elapsed = started.elapsed();
    locker.execute_batch("ROLLBACK").unwrap();
    drop(locker);
    let error = result.unwrap_err();
    assert!(error.contains("database is locked"), "{error}");
    assert!(
        elapsed >= Duration::from_millis(4500) && elapsed < Duration::from_secs(10),
        "expected one ~5 s busy timeout, took {elapsed:?}"
    );
    assert_eq!(full_row(&profile, "blocked"), None);
    assert!(persisted_tags(&profile, "blocked").is_empty());
    eprintln!("MEASURED permanent lock: one native attempt gave up after {elapsed:?}");
}
