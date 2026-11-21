use super::*;

mod relaunch_tests {
    use super::*;

    #[test]
    fn the_bundle_is_found_from_the_executable() {
        assert_eq!(
            mac_bundle_of(Path::new(
                "/Applications/Her Flight Deck.app/Contents/MacOS/her-flight-deck"
            )),
            Some(PathBuf::from("/Applications/Her Flight Deck.app"))
        );
        assert_eq!(
            mac_bundle_of(Path::new("/tmp/target/debug/her-flight-deck")),
            None
        );
    }

    #[test]
    fn the_relaunch_waits_for_this_process_then_opens_the_app() {
        let script = mac_relaunch_script(42, Path::new("/Applications/Her's Deck.app"));
        assert!(script.starts_with("while kill -0 42 "));
        assert!(script.contains("open -n '/Applications/Her'\\''s Deck.app'"));
    }
}

#[allow(clippy::module_inception)]
mod tests {
    use super::*;
    use rusqlite::params;

    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn sha256_digest(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    /// A private directory to play the part of her application data folder.
    #[cfg(unix)]
    #[test]
    fn local_restore_refuses_names_and_links_outside_the_safety_copies() {
        let root = scratch("local-restore-links");
        let outside = scratch("local-restore-links-outside");
        let backups = backup_dir(&root).unwrap();
        write_database(&outside.join(DB_FILES[0]), "someone else's library");
        std::os::unix::fs::symlink(&outside, backups.join("planted")).unwrap();
        assert_eq!(
            stage_local_restore_in(&root, "planted").unwrap_err(),
            "That is not a safety copy this app made."
        );
        for name in ["planted", "..", "../outside", "/etc", "a/b", "a\\b", ""] {
            assert!(
                stage_local_restore_in(&root, name).is_err(),
                "{name:?} must be refused"
            );
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }

    fn scratch(label: &str) -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "hfd-{label}-{}-{}-{unique}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A minimal real application database with recognizable test contents.
    fn write_database(path: &Path, contents: &str) {
        for candidate in [
            path.to_path_buf(),
            PathBuf::from(format!("{}-wal", path.to_string_lossy())),
            PathBuf::from(format!("{}-shm", path.to_string_lossy())),
        ] {
            let _ = std::fs::remove_file(candidate);
        }
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE settings (id TEXT PRIMARY KEY);
                 CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT, created_at TEXT);
                 CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
                 CREATE TABLE audit_payload (value TEXT NOT NULL);
                 INSERT INTO _sqlx_migrations(version) VALUES (9);",
            )
            .unwrap();
        connection
            .execute("INSERT INTO audit_payload(value) VALUES (?1)", [contents])
            .unwrap();
    }

    fn incoming_fixture() -> (PathBuf, PathBuf) {
        let container = scratch("incoming");
        let root = container.join("app");
        std::fs::create_dir(&root).unwrap();
        write_database(&root.join(DB_FILES[0]), "fictional import record");
        let archive = container.join("picked.hfdbackup");
        write_complete_backup(&root, &archive, "0.6.6").unwrap();
        (root, archive)
    }

    #[test]
    fn import_copies_into_incoming_and_inspects() {
        let (root, archive) = incoming_fixture();
        let info = import_picked_backup_in(&root, archive.to_str().unwrap(), "0.6.6", |_| {
            Ok(Some(u64::MAX))
        })
        .unwrap();
        let copy = root.join(INCOMING_DIR).join("latest.hfdbackup");
        assert_eq!(info.path, copy.to_string_lossy());
        assert_eq!(
            std::fs::read(copy).unwrap(),
            std::fs::read(archive).unwrap()
        );
        assert!(!root
            .join(INCOMING_DIR)
            .join("latest.hfdbackup.tmp")
            .exists());
        assert_eq!(info.app_version, "0.6.6");
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn import_replaces_previous_incoming_copy() {
        let (root, archive) = incoming_fixture();
        let copy = copy_incoming_backup(&root, archive.to_str().unwrap()).unwrap();
        std::fs::write(&copy, "previous incoming copy").unwrap();
        import_picked_backup_in(&root, archive.to_str().unwrap(), "0.6.6", |_| Ok(None)).unwrap();
        assert_eq!(
            std::fs::read(copy).unwrap(),
            std::fs::read(archive).unwrap()
        );
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn import_refuses_when_free_space_is_short() {
        let (root, archive) = incoming_fixture();
        let bytes = std::fs::metadata(&archive).unwrap().len();
        let error = import_picked_backup_in(&root, archive.to_str().unwrap(), "0.6.6", |root| {
            Ok(Some(
                std::fs::metadata(root.join(INCOMING_DIR).join("latest.hfdbackup"))
                    .unwrap()
                    .len()
                    * 2,
            ))
        })
        .unwrap_err();
        assert_eq!(error, format!("This phone needs about {} free to restore this backup, but only {} is free. Free up some space and try again.", restore_size(bytes * 3), restore_size(bytes * 2)));
        assert_eq!(
            std::fs::read_dir(root.join(INCOMING_DIR)).unwrap().count(),
            0
        );
        assert_eq!(required_restore_bytes(u64::MAX), u64::MAX);
        assert_eq!(restore_size(3 * 1024 * 1024 * 1024), "3.0 GB");
        assert_eq!(restore_size(2 * 1024 * 1024), "2.0 MB");
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn import_skips_space_check_when_unknown() {
        let (root, archive) = incoming_fixture();
        assert!(
            import_picked_backup_in(&root, archive.to_str().unwrap(), "0.6.6", |_| Ok(None))
                .is_ok()
        );
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn staged_restore_accepts_source_under_incoming() {
        let (root, archive) = incoming_fixture();
        let copy = copy_incoming_backup(&root, archive.to_str().unwrap()).unwrap();
        stage_complete_restore_in(&root, &copy, "0.6.6").unwrap();
        assert!(root.join(RESTORE_PENDING_DIR).join(DB_FILES[0]).is_file());
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn incoming_dir_is_never_an_allowed_archive_path() {
        assert!(!allowed_archive_path(Path::new(INCOMING_DIR), true));
        assert!(!allowed_archive_path(
            Path::new(".incoming/latest.hfdbackup"),
            false
        ));
    }

    #[test]
    fn phone_work_file_is_never_an_allowed_archive_path() {
        assert!(!allowed_archive_path(
            Path::new(crate::phone_work::PHONE_WORK_FILE),
            false
        ));
    }

    #[test]
    fn applying_a_restore_records_the_baseline() {
        let (root, archive) = incoming_fixture();
        stage_complete_restore_in(&root, &archive, "0.6.6").unwrap();
        assert!(!root.join(crate::phone_work::PHONE_WORK_FILE).exists());
        apply_pending_restore_in(&root).unwrap();
        assert!(root.join(crate::phone_work::PHONE_WORK_FILE).is_file());
        let work = crate::phone_work::unsaved_phone_work_in(&root).unwrap();
        assert_eq!(
            (
                work.reviews,
                work.tests,
                work.bookmarks,
                work.reading_positions
            ),
            (0, 0, 0, 0)
        );
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn restore_clears_device_id_so_a_new_one_is_made() {
        let (root, archive) = incoming_fixture();
        {
            let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO app_metadata VALUES ('device_id', 'mac-1'), ('other', 'keep');",
                )
                .unwrap();
        }
        write_complete_backup(&root, &archive, "0.6.6").unwrap();
        stage_complete_restore_in(&root, &archive, "0.6.6").unwrap();
        // Staging must not clear the current install's ID.
        assert_eq!(
            Connection::open(root.join(DB_FILES[0]))
                .unwrap()
                .query_row(
                    "SELECT value FROM app_metadata WHERE key = 'device_id'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "mac-1"
        );
        assert!(matches!(
            handle_startup_restore_in(&root).unwrap(),
            StartupRestoreDecision::RestoreCompleted
        ));
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        let id: Option<String> = connection
            .query_row(
                "SELECT value FROM app_metadata WHERE key = 'device_id'",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(id, None);
        assert_eq!(
            connection
                .query_row(
                    "SELECT value FROM app_metadata WHERE key = 'other'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "keep"
        );
        // Same insert-if-absent contract used by ensureDeviceId at startup.
        connection
            .execute(
                "INSERT OR IGNORE INTO app_metadata VALUES ('device_id', 'phone-new')",
                [],
            )
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT value FROM app_metadata WHERE key = 'device_id'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "phone-new"
        );
        drop(connection);
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_staged_restore_notes_which_mac_the_copy_came_from() {
        let (root, archive) = incoming_fixture();
        {
            let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO app_metadata VALUES ('device_id', 'aaaa-mac');",
                )
                .unwrap();
        }
        write_complete_backup(&root, &archive, "0.6.6").unwrap();
        stage_complete_restore_in(&root, &archive, "0.6.6").unwrap();
        assert!(matches!(
            handle_startup_restore_in(&root).unwrap(),
            StartupRestoreDecision::RestoreCompleted
        ));
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        let source: String = connection
            .query_row(
                "SELECT value FROM app_metadata WHERE key = 'sync_copy_from_device'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(source, "aaaa-mac");
        drop(connection);
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_restore_clears_the_restart_keys() {
        let (root, archive) = incoming_fixture();
        {
            let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO app_metadata VALUES ('device_id', 'aaaa-mac'),
                  ('sync_stream_restarted', '1'), ('sync_copy_superseded', 'bbbb-mac');",
                )
                .unwrap();
        }
        write_complete_backup(&root, &archive, "0.6.6").unwrap();
        stage_complete_restore_in(&root, &archive, "0.6.6").unwrap();
        assert!(matches!(
            handle_startup_restore_in(&root).unwrap(),
            StartupRestoreDecision::RestoreCompleted
        ));
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        let has = |key: &str| -> bool {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM app_metadata WHERE key = ?1",
                    [key],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap()
                == 1
        };
        assert!(!has("sync_stream_restarted"));
        assert!(!has("sync_copy_superseded"));
        assert!(has("sync_copy_from_device"));
        drop(connection);
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    fn floor_after_restore(with_log: bool) -> (Option<String>, Option<String>) {
        let (root, archive) = incoming_fixture();
        {
            let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO app_metadata VALUES ('device_id', 'mac-1'), ('exported_through_seq', '2');",
                )
                .unwrap();
            if with_log {
                connection
                    .execute_batch(
                        "CREATE TABLE local_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT);
                    INSERT INTO local_changes (note) VALUES ('a'), ('b'), ('c');",
                    )
                    .unwrap();
            }
        }
        write_complete_backup(&root, &archive, "0.6.6").unwrap();
        stage_complete_restore_in(&root, &archive, "0.6.6").unwrap();
        assert!(matches!(
            handle_startup_restore_in(&root).unwrap(),
            StartupRestoreDecision::RestoreCompleted
        ));
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        let get = |key: &str| -> Option<String> {
            connection
                .query_row(
                    "SELECT value FROM app_metadata WHERE key = ?1",
                    [key],
                    |r| r.get(0),
                )
                .optional()
                .unwrap()
        };
        let out = (get("sync_floor_seq"), get("exported_through_seq"));
        drop(connection);
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
        out
    }

    #[test]
    fn restore_sets_the_sync_floor_and_clears_the_watermark() {
        // The change log came with the restored copy: the floor is its newest entry.
        assert_eq!(floor_after_restore(true), (Some("3".to_string()), None));
        // No change log at all (an older copy) still restores, floor 0.
        assert_eq!(floor_after_restore(false), (Some("0".to_string()), None));
    }

    #[test]
    fn incoming_picker_paths_and_regular_file_guards() {
        let (root, archive) = incoming_fixture();
        let spaced = root.join("picked copy.hfdbackup");
        std::fs::rename(archive, &spaced).unwrap();
        let url = format!("file://{}", spaced.to_string_lossy().replace(' ', "%20"));
        let copy = copy_incoming_backup(&root, &url).unwrap();
        assert_eq!(
            std::fs::read(copy).unwrap(),
            std::fs::read(&spaced).unwrap()
        );
        assert!(copy_incoming_backup(&root, root.to_str().unwrap()).is_err());
        assert!(copy_incoming_backup(&root, "file://%zz").is_err());
        // A plain path is used as-is, even with a literal '%'.
        let percent = root.join("50%20notes.hfdbackup");
        std::fs::copy(&spaced, &percent).unwrap();
        assert!(copy_incoming_backup(&root, percent.to_str().unwrap()).is_ok());
        // A stale temporary file from an interrupted copy does not block the next import.
        std::fs::write(
            root.join(INCOMING_DIR).join("latest.hfdbackup.tmp"),
            "stale",
        )
        .unwrap();
        assert!(copy_incoming_backup(&root, spaced.to_str().unwrap()).is_ok());
        #[cfg(unix)]
        {
            let link = root.join("linked.hfdbackup");
            std::os::unix::fs::symlink(&spaced, &link).unwrap();
            assert!(copy_incoming_backup(&root, link.to_str().unwrap()).is_err());
        }
        let large = root.join("large.hfdbackup");
        File::create(&large)
            .unwrap()
            .set_len(MAX_RESTORE_BYTES + 1)
            .unwrap();
        assert!(copy_incoming_backup(&root, large.to_str().unwrap()).is_err());
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn current_database_version_matches_the_registered_migrations() {
        let latest = crate::migrations().last().unwrap().version;
        assert_eq!(latest, crate::CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn current_practice_test_schema_can_be_backed_up_but_future_schema_cannot() {
        let root = scratch("practice-schema-backup");
        let database = root.join(DB_FILES[0]);
        write_database(&database, "version nine");
        let snapshot = database_snapshot_with_retry(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "version nine");
        std::fs::remove_file(snapshot).unwrap();

        Connection::open(&database)
            .unwrap()
            .execute(
                "UPDATE _sqlx_migrations SET version = ?1",
                [crate::CURRENT_SCHEMA_VERSION + 1],
            )
            .unwrap();
        assert!(verify_application_database(&database)
            .unwrap_err()
            .contains("newer"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn req_15_schema_10_backup_validates_without_new_tables() {
        let root = scratch("schema-10-backup");
        let database = root.join(DB_FILES[0]);
        let conn = Connection::open(&database).unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (id TEXT PRIMARY KEY);
             CREATE TABLE study_materials (id TEXT PRIMARY KEY, file_path TEXT);
             CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO _sqlx_migrations (version) VALUES (10);",
        )
        .unwrap();

        // Schema 10 must pass without requiring practice_test_versions or other migration 11 tables
        assert!(verify_application_database(&database).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn req_16_schema_11_backup_validation_catches_semantic_violations() {
        let root = scratch("schema-11-backup");
        let database = root.join(DB_FILES[0]);

        // Start with a full schema 11 db
        let conn = Connection::open(&database).unwrap();
        conn.busy_timeout(BUSY_TIMEOUT).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for m in crate::migrations() {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute_batch("CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY); INSERT INTO _sqlx_migrations (version) VALUES (11);").unwrap();

        // 1. Valid empty schema 11 db passes
        assert!(verify_application_database(&database).is_ok());

        // 2. Add material, version, items, and completed attempt with score
        conn.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-1', 'Test', '2026-10-04T12:00:00Z', '2026-10-04T12:00:00Z')", []).unwrap();
        conn.execute("INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, version_number, content_hash, created_at, is_active) VALUES ('ver-1', 'mat-1', 'mat-1', 'Test', 1, 'h', '2026-10-04T12:00:00Z', 1)", []).unwrap();
        conn.execute("INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index) VALUES ('item-1', 'ver-1', 0, 'Q1', '[\"A\",\"B\"]', 0)", []).unwrap();
        conn.execute("INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index) VALUES ('item-2', 'ver-1', 1, 'Q2', '[\"A\",\"B\"]', 1)", []).unwrap();

        conn.execute("INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, started_at, completed_at, status, total_questions, answered_count, correct_count, incorrect_count, dont_know_count, score_percent) VALUES ('att-1', 'ver-1', 'mat-1', 'Test', '2026-10-04T12:00:00Z', '2026-10-04T12:05:00Z', 'completed', 2, 2, 2, 0, 0, 100.0)", []).unwrap();
        conn.execute("INSERT INTO practice_responses (id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at) VALUES ('r-1', 'att-1', 'item-1', 0, 0, 1, '2026-10-04T12:01:00Z')", []).unwrap();
        conn.execute("INSERT INTO practice_responses (id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at) VALUES ('r-2', 'att-1', 'item-2', 1, 0, 1, '2026-10-04T12:02:00Z')", []).unwrap();

        // Consistent state passes
        assert!(verify_application_database(&database).is_ok());

        // 3. Corrupt completed score (e.g. 50.0 instead of 100.0)
        conn.execute(
            "UPDATE practice_attempts SET score_percent = 50.0 WHERE id = 'att-1'",
            [],
        )
        .unwrap();
        let err_score = verify_application_database(&database).unwrap_err();
        assert!(err_score.contains("inconsistent score percentage"));

        // Restore correct score
        conn.execute(
            "UPDATE practice_attempts SET score_percent = 100.0 WHERE id = 'att-1'",
            [],
        )
        .unwrap();
        assert!(verify_application_database(&database).is_ok());

        // 4. Cross-version violation: second version with item belonging to it, but response points to att-1
        conn.execute("INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, version_number, content_hash, created_at, is_active) VALUES ('ver-2', NULL, 'mat-1', 'Test', 2, 'h2', '2026-10-04T12:00:00Z', 0)", []).unwrap();
        conn.execute("INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index) VALUES ('item-3', 'ver-2', 0, 'Q3', '[\"A\",\"B\"]', 0)", []).unwrap();
        conn.execute_batch("DROP TRIGGER trg_enforce_response_item_version_update; UPDATE practice_responses SET item_id = 'item-3' WHERE id = 'r-2';").unwrap();

        let err_cross = verify_application_database(&database).unwrap_err();
        assert!(err_cross.contains("different version"));

        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manual_safety_copy_is_a_consistent_online_snapshot() {
        let root = scratch("manual-online-snapshot");
        write_database(&root.join(DB_FILES[0]), "before");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute("UPDATE audit_payload SET value = 'after'", [])
            .unwrap();

        let backup = create_consistent_local_backup(&root).unwrap();
        let saved = PathBuf::from(backup).join(DB_FILES[0]);
        assert_eq!(database_contents(&saved), "after");
        verify_application_database(&saved).unwrap();
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn database_contents(path: &Path) -> String {
        Connection::open(path)
            .unwrap()
            .query_row("SELECT value FROM audit_payload LIMIT 1", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    fn write_document(root: &Path, relative: &str, contents: &str) {
        let path = root.join(DOCUMENTS_DIR).join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, contents).unwrap();
        let db_path = root.join(DB_FILES[0]);
        if db_path.is_file() {
            if let Ok(conn) = Connection::open(&db_path) {
                let normalized = relative.replace('\\', "/");
                let _ = conn.execute(
                    "INSERT INTO study_materials (id, file_path) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
                    params![normalized, normalized],
                );
            }
        }
    }

    fn document_contents(root: &Path, relative: &str) -> Option<String> {
        std::fs::read_to_string(root.join(DOCUMENTS_DIR).join(relative)).ok()
    }

    fn rewrite_entry(archive_path: &Path, target: &str, replacement: &[u8]) {
        let input = File::open(archive_path).unwrap();
        let mut input = ZipArchive::new(input).unwrap();
        let rewritten = archive_path.with_extension("rewritten");
        let output = File::create(&rewritten).unwrap();
        let mut output = ZipWriter::new(output);
        for index in 0..input.len() {
            let mut entry = input.by_index(index).unwrap();
            let name = entry.name().unwrap().into_owned();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            output.start_file(&name, archive_options()).unwrap();
            output
                .write_all(if name == target { replacement } else { &bytes })
                .unwrap();
        }
        output.finish().unwrap();
        std::fs::rename(rewritten, archive_path).unwrap();
    }

    fn write_legacy_backup(root: &Path, archive_path: &Path, app_version: &str) {
        let output = File::create(archive_path).unwrap();
        let mut archive = ZipWriter::new(output);
        archive
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .unwrap();
        archive
            .write_all(
                serde_json::to_string(&CompleteBackupManifest {
                    format: ARCHIVE_FORMAT.to_string(),
                    format_version: LEGACY_ARCHIVE_VERSION,
                    app_version: app_version.to_string(),
                    created_at: 0,
                    missing_at_export: Vec::new(),
                    detached_at_export: Vec::new(),
                    schema_version: None,
                    device_id: None,
                    platform: None,
                })
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        add_file_to_archive(&mut archive, &root.join(DB_FILES[0]), DB_FILES[0]).unwrap();
        archive.finish().unwrap();
    }

    #[test]
    fn an_archive_may_only_contain_her_database_and_documents() {
        assert!(allowed_archive_path(Path::new(ARCHIVE_MANIFEST), false));
        assert!(allowed_archive_path(Path::new(DB_FILES[0]), false));
        assert!(allowed_archive_path(Path::new(DB_FILES[1]), false));
        assert!(allowed_archive_path(
            &Path::new(DOCUMENTS_DIR).join("chart.pdf"),
            false
        ));
        assert!(allowed_archive_path(Path::new(DOCUMENTS_DIR), true));

        // A backup file must never be able to say how it gets installed.
        assert!(!allowed_archive_path(Path::new(RESTORE_PLAN), false));
        // Nor drop anything else beside her data.
        assert!(!allowed_archive_path(
            Path::new("last-run-version.txt"),
            false
        ));
        // Nor hand her a Gemini key chosen by whoever wrote the archive.
        assert!(!allowed_archive_path(
            Path::new(crate::secrets::KEY_FILE),
            false
        ));
        // Nor any other provider's key or the provider choice (PROVIDER-01).
        assert!(!allowed_archive_path(Path::new("claude-key"), false));
        assert!(!allowed_archive_path(Path::new("ai-provider"), false));
        assert!(!allowed_archive_path(Path::new("documents"), false));
        assert!(!allowed_archive_path(Path::new(DB_FILES[0]), true));
    }

    /// PUB-R6: with keys in the secure store (and with a store failure that
    /// falls back to the private files) no backup carries either key.
    #[test]
    fn no_backup_contains_a_provider_key_on_either_storage_path() {
        use crate::provider::ProviderId;
        use crate::secrets::fake::FakeStore;
        const GEMINI: &str = "AIzaSySyntheticBackupProbeKey000";
        const CLAUDE: &str = "sk-ant-synthetic-backup-probe-key";
        for store_fails in [false, true] {
            let root = scratch("backup-no-key");
            let elsewhere = scratch("backup-no-key-out");
            write_database(&root.join(DB_FILES[0]), "her real training record");
            write_document(&root, "handbook.pdf", "chapter one");
            let store = FakeStore::default();
            store.fail_set.set(store_fails);
            crate::secrets::save_key_with(&root, ProviderId::Gemini, Some(&store), GEMINI).unwrap();
            crate::secrets::save_key_with(&root, ProviderId::Claude, Some(&store), CLAUDE).unwrap();
            assert_eq!(root.join("gemini-key").is_file(), store_fails);

            let archive = elsewhere.join("keys.hfdbackup");
            write_complete_backup(&root, &archive, "0.6.7").unwrap();
            let mut zip = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
            for index in 0..zip.len() {
                let mut entry = zip.by_index(index).unwrap();
                let name = entry.name().unwrap().into_owned();
                assert!(!name.contains("-key"), "{name} looks like a key file");
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                for key in [GEMINI, CLAUDE] {
                    assert!(
                        !bytes.windows(key.len()).any(|w| w == key.as_bytes()),
                        "{name} carries a provider key"
                    );
                }
            }
            std::fs::remove_dir_all(&root).unwrap();
            std::fs::remove_dir_all(&elsewhere).unwrap();
        }
    }

    #[test]
    fn a_database_is_recognized_by_its_header() {
        assert!(is_sqlite_header(SQLITE_MAGIC));
        assert!(is_sqlite_header(b"SQLite format 3\0and then some pages"));
        assert!(!is_sqlite_header(b"SQLite format 3"));
        assert!(!is_sqlite_header(b""));
        assert!(!is_sqlite_header(b"PK\x03\x04 a zip file, not a database"));
    }

    #[test]
    fn a_chosen_safety_copy_cannot_climb_out_of_the_backup_folder() {
        assert_eq!(
            safe_backup_name("2026-09-05-174233-manual").unwrap(),
            "2026-09-05-174233-manual"
        );
        assert_eq!(
            safe_backup_name(" 2026-09-05-174233-manual ").unwrap(),
            "2026-09-05-174233-manual"
        );

        for bad in ["", "  ", ".", "..", "../documents", "a/b", "a\\b", "a\0b"] {
            assert!(safe_backup_name(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn a_restore_plan_survives_being_written_and_read_back() {
        let json = serde_json::to_string(&RestorePlan {
            operation_id: "test-op".to_string(),
            kind: RestoreKind::Database,
            source: "2026-09-05-174233-before-0.3.0".to_string(),
        })
        .unwrap();
        let read: RestorePlan = serde_json::from_str(&json).unwrap();
        assert_eq!(read.kind, RestoreKind::Database);
        assert_eq!(read.operation_id, "test-op");
    }

    #[test]
    fn a_missing_or_damaged_plan_is_treated_as_a_complete_archive() {
        // Every version before restore plans existed staged complete archives,
        // and a half-written plan must not silently keep the wrong documents.
        let dir = std::env::temp_dir().join(format!("hfd-plan-{}", unix_timestamp()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Complete);

        std::fs::write(dir.join(RESTORE_PLAN), "{ not json").unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Complete);

        write_restore_plan(&dir, RestoreKind::Database, "a safety copy").unwrap();
        assert_eq!(read_restore_plan(&dir).kind, RestoreKind::Database);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_a_folder_holding_a_real_database_offers_to_be_restored() {
        let dir = std::env::temp_dir().join(format!("hfd-copy-{}", unix_timestamp()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!folder_is_restorable(&dir));

        std::fs::write(dir.join(DB_FILES[0]), b"not a database at all").unwrap();
        assert!(!folder_is_restorable(&dir));

        let mut database = SQLITE_MAGIC.to_vec();
        database.extend_from_slice(&[0u8; 128]);
        std::fs::write(dir.join(DB_FILES[0]), database).unwrap();
        assert!(folder_is_restorable(&dir));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_timestamp_reads_as_a_sortable_date() {
        // Copies are pruned oldest-first by name, so the shape matters.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_702), (2026, 9, 6));
    }

    /* --------------------- backup and restore, end to end ---------------- */

    #[test]
    fn zip_2_4_2_backup_fixture_inspects_verifies_and_restores() {
        // Frozen bytes from the pre-upgrade writer, never regenerated by zip 9.
        let root = scratch("zip-2-restore");
        let archive = root.join("old.hfdbackup");
        std::fs::write(
            &archive,
            include_bytes!("../../fixtures/backups/zip-2.4.2.hfdbackup"),
        )
        .unwrap();
        write_database(&root.join(DB_FILES[0]), "current fictional record");
        let info = inspect_archive(&root, &archive, "0.6.7").unwrap();
        assert_eq!(info.files, 2);
        assert_eq!(info.app_version, "0.6.7");
        stage_complete_restore_in(&root, &archive, "0.6.7").unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "current fictional record"
        );
        apply_pending_restore_in(&root).unwrap();
        verify_application_database(&root.join(DB_FILES[0])).unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "fictional zip 2.4.2 record"
        );
        assert_eq!(
            document_contents(&root, "lesson.txt").as_deref(),
            Some("fictional crosswind notes\n")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_complete_backup_puts_back_the_database_and_every_document() {
        let root = scratch("complete");
        let elsewhere = scratch("elsewhere");
        write_database(&root.join(DB_FILES[0]), "her real training record");
        write_document(&root, "airplane-flying-handbook.pdf", "chapter nine");
        write_document(&root, "lessons/debrief.png", "crosswind notes");

        let archive = elsewhere.join("her-flight-deck.hfdbackup");
        let saved = write_complete_backup(&root, &archive, "0.2.0").unwrap();
        assert_eq!(saved.app_version, "0.2.0");
        // The database and both documents.
        assert_eq!(saved.files, 3);
        assert!(archive.is_file());

        // Something goes wrong afterwards: the record is replaced and a file lost.
        write_database(&root.join(DB_FILES[0]), "damaged after an update");
        std::fs::remove_file(root.join(DOCUMENTS_DIR).join("lessons/debrief.png")).unwrap();

        let staged = stage_complete_restore_in(&root, &archive, "0.2.0").unwrap();
        assert_eq!(staged.files, 3);
        // Staging alone must not have touched anything of hers.
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "damaged after an update"
        );

        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "her real training record"
        );
        assert_eq!(
            document_contents(&root, "airplane-flying-handbook.pdf").as_deref(),
            Some("chapter nine")
        );
        assert_eq!(
            document_contents(&root, "lessons/debrief.png").as_deref(),
            Some("crosswind notes")
        );

        // And what was there before the restore is still recoverable.
        let rollbacks: Vec<BackupInfo> = list_backups_in(&root)
            .unwrap()
            .into_iter()
            .filter(|backup| backup.name.ends_with("-before-restore"))
            .collect();
        assert_eq!(rollbacks.len(), 1);
        assert!(rollbacks[0].restorable);

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_safety_copy_puts_the_database_back_and_leaves_her_uploads_alone() {
        let root = scratch("safety-copy");
        write_database(&root.join(DB_FILES[0]), "before the update");
        write_document(&root, "handbook.pdf", "still hers");

        // First launch of a new version: a copy is taken before anything opens.
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        let copies = list_backups_in(&root).unwrap();
        assert_eq!(copies.len(), 1);
        let copy = copies[0].name.clone();
        assert!(copy.ends_with("-before-0.3.0"));

        // The update goes badly, and she uploads something else in the meantime.
        write_database(&root.join(DB_FILES[0]), "lost her lessons");
        write_document(&root, "new-checklist.pdf", "added since");

        stage_local_restore_in(&root, &copy).unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "before the update"
        );
        // Her uploads were never in that copy and must not be swept away by it.
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("still hers")
        );
        assert_eq!(
            document_contents(&root, "new-checklist.pdf").as_deref(),
            Some("added since")
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_write_ahead_log_travels_with_the_database() {
        // If a checkpoint could not finish, her newest entries live only in the
        // log. A backup that left it behind would quietly lose them.
        let root = scratch("wal");
        let elsewhere = scratch("wal-out");
        write_database(&root.join(DB_FILES[0]), "checkpointed pages");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute(
                "UPDATE audit_payload SET value = 'pages written since the last checkpoint'",
                [],
            )
            .unwrap();
        assert!(root.join(DB_FILES[1]).is_file());

        let archive = elsewhere.join("with-log.hfdbackup");
        let saved = write_complete_backup(&root, &archive, "0.2.0").unwrap();
        assert_eq!(saved.files, 2);
        drop(connection);

        let _ = std::fs::remove_file(root.join(DB_FILES[1]));
        write_database(&root.join(DB_FILES[0]), "something else entirely");

        stage_complete_restore_in(&root, &archive, "0.2.0").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "pages written since the last checkpoint"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_damaged_backup_is_refused_before_anything_of_hers_moves() {
        let root = scratch("damaged");
        let elsewhere = scratch("damaged-out");
        // An archive written around a file that is not a database at all.
        std::fs::write(root.join(DB_FILES[0]), b"this is not a database").unwrap();
        let archive = elsewhere.join("damaged.hfdbackup");
        write_complete_backup(&root, &archive, "0.2.0").unwrap();

        write_database(&root.join(DB_FILES[0]), "her real record");
        write_document(&root, "handbook.pdf", "hers");

        assert!(inspect_archive(&root, &archive, "0.2.0").is_err());
        assert!(stage_complete_restore_in(&root, &archive, "0.2.0").is_err());

        // Refused means refused: her current data is exactly as it was.
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "her real record"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("hers")
        );
        assert!(!root.join(RESTORE_PENDING_DIR).exists());
        assert!(!root.join(RESTORE_STAGING_DIR).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn an_archive_carrying_anything_unexpected_is_refused() {
        let elsewhere = scratch("hostile");
        let archive = elsewhere.join("hostile.hfdbackup");

        let file = File::create(&archive).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file(ARCHIVE_MANIFEST, archive_options())
            .unwrap();
        writer
            .write_all(
                serde_json::to_string(&CompleteBackupManifest {
                    format: ARCHIVE_FORMAT.to_string(),
                    format_version: LEGACY_ARCHIVE_VERSION,
                    app_version: "0.2.0".to_string(),
                    created_at: 0,
                    missing_at_export: Vec::new(),
                    detached_at_export: Vec::new(),
                    schema_version: None,
                    device_id: None,
                    platform: None,
                })
                .unwrap()
                .as_bytes(),
            )
            .unwrap();
        writer.start_file(DB_FILES[0], archive_options()).unwrap();
        writer.write_all(SQLITE_MAGIC).unwrap();
        // A restore plan would decide whether her documents get replaced.
        writer.start_file(RESTORE_PLAN, archive_options()).unwrap();
        writer
            .write_all(b"{\"kind\":\"database\",\"source\":\"\"}")
            .unwrap();
        writer.finish().unwrap();

        let refusal = inspect_archive(&elsewhere, &archive, "0.2.0").unwrap_err();
        assert!(refusal.contains("unexpected file"), "{refusal}");

        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn failed_upgrade_copy_records_notice_until_a_later_copy_succeeds() {
        let root = scratch("upgrade-notice");
        write_database(&root.join(DB_FILES[0]), "her record");
        std::fs::write(root.join(BACKUP_DIR), b"obstruction").unwrap();
        assert!(backup_if_upgraded_in(&root, "0.3.0").is_err());
        assert!(root.join("upgrade-copy-failed").is_file());
        assert!(!root.join(VERSION_FILE).exists());
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "her record");
        std::fs::remove_file(root.join(BACKUP_DIR)).unwrap();
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        assert!(!root.join("upgrade-copy-failed").exists());
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "her record");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_copy_is_taken_whenever_another_version_wrote_the_database() {
        let root = scratch("upgrade");

        // A genuine first run: nothing to copy, but the version is recorded.
        backup_if_upgraded_in(&root, "0.2.0").unwrap();
        assert!(list_backups_in(&root).unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(root.join(VERSION_FILE)).unwrap(),
            "0.2.0"
        );

        // Reopening the same version does not pile up copies.
        write_database(&root.join(DB_FILES[0]), "her record");
        backup_if_upgraded_in(&root, "0.2.0").unwrap();
        assert!(list_backups_in(&root).unwrap().is_empty());

        // A new version does.
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        assert_eq!(list_backups_in(&root).unwrap().len(), 1);

        // And so does a database whose version we have no record of, which is
        // the case where we know least about what wrote it.
        std::fs::remove_file(root.join(VERSION_FILE)).unwrap();
        backup_if_upgraded_in(&root, "0.3.0").unwrap();
        assert_eq!(list_backups_in(&root).unwrap().len(), 2);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_backup_cannot_be_saved_inside_the_folder_it_is_protecting() {
        // A backup that lives inside the data folder is lost with it.
        let root = scratch("inside");
        write_database(&root.join(DB_FILES[0]), "her record");

        let refusal =
            write_complete_backup(&root, &root.join("copy.hfdbackup"), "0.2.0").unwrap_err();
        assert!(refusal.contains("outside"), "{refusal}");

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn restored_files_are_hashed_from_exactly_the_bytes_written() {
        let root = scratch("copy-and-hash");
        let content: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let destination = root.join("restored.pdf");
        let mut output = File::create(&destination).unwrap();
        let (bytes, sha) = copy_and_hash(&mut content.as_slice(), &mut output).unwrap();
        output.sync_all().unwrap();
        drop(output);

        assert_eq!(bytes, content.len() as u64);
        assert_eq!(std::fs::read(&destination).unwrap(), content);
        assert_eq!(sha, hex::encode(Sha256::digest(&content)));

        let mut changed = content.clone();
        changed[100_000] ^= 1;
        let mut other = File::create(root.join("changed.pdf")).unwrap();
        let (_, changed_sha) = copy_and_hash(&mut changed.as_slice(), &mut other).unwrap();
        assert_ne!(changed_sha, sha);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_same_size_content_change_fails_the_integrity_check() {
        let root = scratch("checksum");
        let elsewhere = scratch("checksum-out");
        write_database(&root.join(DB_FILES[0]), "training record");
        write_document(&root, "handbook.pdf", "original bytes");
        let archive = elsewhere.join("checked.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        rewrite_entry(&archive, "documents/handbook.pdf", b"tampered bytes");
        let error = inspect_archive(&root, &archive, "0.5.1").unwrap_err();
        assert!(error.contains("integrity check"), "{error}");
        assert!(stage_complete_restore_in(&root, &archive, "0.5.1").is_err());

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_format_version_one_backup_still_restores() {
        let root = scratch("legacy-v1");
        let elsewhere = scratch("legacy-v1-out");
        write_database(&root.join(DB_FILES[0]), "from version one");
        let archive = elsewhere.join("legacy.hfdbackup");
        write_legacy_backup(&root, &archive, "0.5.1");
        write_database(&root.join(DB_FILES[0]), "current");

        stage_complete_restore_in(&root, &archive, "0.5.1").unwrap();
        apply_pending_restore_in(&root).unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "from version one"
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_valid_sqlite_file_with_the_wrong_schema_is_refused() {
        let root = scratch("wrong-schema");
        let elsewhere = scratch("wrong-schema-out");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .execute("CREATE TABLE somebody_elses_data (value TEXT)", [])
            .unwrap();
        drop(connection);
        let archive = elsewhere.join("wrong-schema.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        let error = stage_complete_restore_in(&root, &archive, "0.5.1").unwrap_err();
        assert!(error.contains("missing settings"), "{error}");
        assert!(!root.join(RESTORE_PENDING_DIR).exists());

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn an_online_snapshot_includes_committed_wal_changes() {
        let root = scratch("online-snapshot");
        write_database(&root.join(DB_FILES[0]), "before");
        let connection = Connection::open(root.join(DB_FILES[0])).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        connection
            .execute("UPDATE audit_payload SET value = 'after'", [])
            .unwrap();

        let snapshot = database_snapshot(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "after");
        verify_application_database(&snapshot).unwrap();

        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_transient_lock_during_snapshot_clears_and_the_backup_still_completes() {
        let root = scratch("snapshot-transient-lock");
        write_database(&root.join(DB_FILES[0]), "before the lock");

        let locker = Connection::open(root.join(DB_FILES[0])).unwrap();
        locker.execute("BEGIN EXCLUSIVE", []).unwrap();
        // Held briefly on another thread — long enough that the snapshot's
        // own read has to wait for it, short enough that the busy timeout
        // (and, if that were not enough, the bounded retry around the whole
        // snapshot) comfortably outlasts it. This is the same shape of
        // collision as an ordinary autosave or a split saving its parts
        // landing at the same moment as a backup.
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            locker.execute("COMMIT", []).unwrap();
        });

        let snapshot = database_snapshot_with_retry(&root).unwrap();
        assert_eq!(database_contents(&snapshot), "before the lock");

        handle.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_lock_that_never_clears_fails_the_snapshot_boundedly_with_a_plain_message() {
        let root = scratch("snapshot-permanent-lock");
        write_database(&root.join(DB_FILES[0]), "locked forever");

        let locker = Connection::open(root.join(DB_FILES[0])).unwrap();
        locker.execute("BEGIN EXCLUSIVE", []).unwrap();

        let started = std::time::Instant::now();
        let error = database_snapshot_with_retry(&root).unwrap_err();
        let elapsed = started.elapsed();

        assert!(error.contains("busy"), "{error}");
        // Bounded by (SNAPSHOT_LOCK_RETRIES + 1) attempts, each capped at
        // BUSY_TIMEOUT — not an unlimited or open-ended wait, however long a
        // real lock happens to be held.
        assert!(
            elapsed < Duration::from_secs(40),
            "gave up after {elapsed:?}, longer than the configured bound allows"
        );

        locker.execute("ROLLBACK", []).unwrap();
        drop(locker);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_valid_backup_still_passes_its_own_finished_archive_check() {
        let root = scratch("verified-finish");
        let elsewhere = scratch("verified-finish-out");
        write_database(&root.join(DB_FILES[0]), "her real record");
        let archive = elsewhere.join("verified.hfdbackup");

        let info = write_complete_backup_from_database(
            &root,
            &archive,
            "0.2.0",
            &root.join(DB_FILES[0]),
            false,
            true,
            None,
        )
        .unwrap();
        assert!(archive.is_file());
        assert_eq!(info.app_version, "0.2.0");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_failed_rewrite_leaves_an_existing_backup_exactly_as_it_was() {
        let root = scratch("preserve-existing");
        let elsewhere = scratch("preserve-existing-out");
        write_database(&root.join(DB_FILES[0]), "the real record");
        let archive = elsewhere.join("her-flight-deck.hfdbackup");

        // A first, successful backup already exists at the destination.
        write_complete_backup(&root, &archive, "0.2.0").unwrap();
        let original_bytes = std::fs::read(&archive).unwrap();

        // A second attempt whose database is damaged must fail its
        // pre-rename integrity check — and never touch the file already
        // sitting at the destination.
        std::fs::write(root.join(DB_FILES[0]), b"not a database").unwrap();
        let result = write_complete_backup_from_database(
            &root,
            &archive,
            "0.2.0",
            &root.join(DB_FILES[0]),
            false,
            true,
            None,
        );
        assert!(result.is_err());

        assert_eq!(std::fs::read(&archive).unwrap(), original_bytes);
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());
        assert!(!PathBuf::from(format!("{}.replaced", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn archive_names_reject_windows_streams_and_excessive_lengths() {
        assert!(validate_archive_path(
            "documents/handbook.pdf",
            Path::new("documents/handbook.pdf")
        )
        .is_ok());
        assert!(validate_archive_path(
            "documents/handbook.pdf:hidden",
            Path::new("documents/handbook.pdf:hidden")
        )
        .is_err());
        let long = format!(
            "documents/{}.pdf",
            "x".repeat(MAX_ARCHIVE_COMPONENT_BYTES + 1)
        );
        assert!(validate_archive_path(&long, Path::new(&long)).is_err());
    }

    #[test]
    fn archive_reader_preserves_raw_path_refusals() {
        let root = scratch("zip-path-guards");
        write_database(&root.join(DB_FILES[0]), "fictional current record");
        let cases: &[&[&str]] = &[
            &["documents\\escape.txt"],
            &["documents/file.txt:stream"],
            &["../escape.txt"],
            &["/documents/escape.txt"],
            &["documents/../../escape.txt"],
            &["documents/\0escape.txt"],
            &["documents/lesson.txt", "documents//lesson.txt"],
        ];
        for names in cases {
            let archive = root.join("hostile.hfdbackup");
            write_legacy_backup(&root, &archive, "0.6.7");
            let file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&archive)
                .unwrap();
            let mut writer = ZipWriter::new_append(file).unwrap();
            for name in *names {
                writer.start_file(name, archive_options()).unwrap();
                writer.write_all(b"fictional hostile content").unwrap();
            }
            writer.finish().unwrap();
            assert!(
                inspect_archive(&root, &archive, "0.6.7").is_err(),
                "{names:?}"
            );
            assert!(
                stage_complete_restore_in(&root, &archive, "0.6.7").is_err(),
                "{names:?}"
            );
            assert_eq!(
                database_contents(&root.join(DB_FILES[0])),
                "fictional current record"
            );
            assert!(!root.join(RESTORE_PENDING_DIR).exists());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extreme_compression_ratios_are_refused() {
        assert!(validate_compression_ratio(1024, 1, MAX_COMPRESSION_RATIO).is_ok());
        assert!(validate_compression_ratio(2 * 1024 * 1024, 1024, MAX_COMPRESSION_RATIO).is_err());
        assert!(validate_compression_ratio(2 * 1024 * 1024, 0, MAX_COMPRESSION_RATIO).is_err());
    }

    #[test]
    fn an_install_failure_after_protection_restores_current_data() {
        let root = scratch("install-rollback");
        let elsewhere = scratch("install-rollback-out");
        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("rollback.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.1").unwrap();

        write_database(&root.join(DB_FILES[0]), "current data");
        write_document(&root, "handbook.pdf", "current document");
        stage_complete_restore_in(&root, &archive, "0.5.1").unwrap();

        let error = apply_pending_restore_in_with(&root, || {
            Err("injected failure before install".to_string())
        })
        .unwrap_err();
        assert!(error.contains("previous data was recovered"), "{error}");
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "current data");
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("current document")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn a_referenced_file_disappearing_after_the_database_snapshot_is_refused() {
        let root = scratch("disappearing-doc");
        let elsewhere = scratch("disappearing-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("disappearing.hfdbackup");

        let pre_docs = scan_active_documents(&root.join(DOCUMENTS_DIR)).unwrap();
        let snapshot = database_snapshot_with_retry(&root).unwrap();

        // The referenced document is deleted after the snapshot and before collection
        std::fs::remove_file(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap();

        let result = write_complete_backup_from_database(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            Some(&pre_docs),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when referenced file disappeared after snapshot"
        );
        match result.unwrap_err() {
            BackupExportError::Transient(err) => {
                assert!(
                    err.contains("disappeared") || err.contains("handbook.pdf"),
                    "Expected transient disappearance error, got: {err}"
                );
            }
            BackupExportError::Permanent(err) => {
                panic!("Expected Transient error, got Permanent: {err}");
            }
        }
        assert!(!archive.exists());
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_referenced_file_disappearing_during_collection_is_refused() {
        let root = scratch("disappearing-mid-doc");
        let elsewhere = scratch("disappearing-mid-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("disappearing-mid.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                let _ = std::fs::remove_file(root_for_hook.join(DOCUMENTS_DIR).join(doc_name));
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when referenced file disappeared during collection"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("disappeared")
                || err.contains("missing")
                || err.contains("Could not read")
                || err.contains("changed"),
            "Expected disappearance/change error, got: {err}"
        );
        assert!(!archive.exists());
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_new_import_or_split_appearing_after_the_snapshot_is_refused() {
        let root = scratch("extra-doc");
        let elsewhere = scratch("extra-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook contents");
        let archive = elsewhere.join("extra.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        // A new import or split part appears on disk while export is in flight
        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                std::fs::write(
                    root_for_hook.join(DOCUMENTS_DIR).join("part-2.pdf"),
                    "split part 2",
                )
                .unwrap();
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when extra unreferenced document appeared during export"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("changed on disk") || err.contains("changed"),
            "Expected in-flight change error, got: {err}"
        );
        assert!(!archive.exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_document_changing_during_collection_is_detected_and_refused() {
        let root = scratch("changing-doc");
        let elsewhere = scratch("changing-doc-out");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "initial content");
        let archive = elsewhere.join("changing.hfdbackup");

        let snapshot = database_snapshot_with_retry(&root).unwrap();

        let root_for_hook = root.clone();
        let mut hook = |doc_name: &str| {
            if doc_name == "handbook.pdf" {
                let doc_path = root_for_hook.join(DOCUMENTS_DIR).join(doc_name);
                std::fs::write(doc_path, "modified content during read").unwrap();
            }
        };

        let result = write_complete_backup_from_database_with_hook(
            &root,
            &archive,
            "0.5.2",
            &snapshot,
            false,
            true,
            None,
            Some(&mut hook),
        );
        let _ = std::fs::remove_file(snapshot);

        assert!(
            result.is_err(),
            "Backup must fail when document changed during collection"
        );
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("changed during export") || err.contains("changed on disk"),
            "Expected change error, got: {err}"
        );
        assert!(!archive.exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_failed_retry_leaves_an_existing_valid_backup_untouched() {
        let root = scratch("failed-retry-preserve");
        let elsewhere = scratch("failed-retry-preserve-out");
        write_database(&root.join(DB_FILES[0]), "stable db");
        write_document(&root, "handbook.pdf", "stable document");
        let archive = elsewhere.join("valid-backup.hfdbackup");

        // 1. Create a valid initial backup
        create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert!(archive.is_file());
        let original_bytes = std::fs::read(&archive).unwrap();

        // 2. Now simulate a persistent failure: remove the database
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();

        // 3. Running complete backup should exhaust bounded retries and fail
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(
            result.is_err(),
            "Backup must fail when database snapshot persistently fails"
        );

        // 4. Verify existing backup at destination is completely untouched and intact
        assert_eq!(std::fs::read(&archive).unwrap(), original_bytes);
        assert!(!PathBuf::from(format!("{}.part", archive.to_string_lossy())).exists());
        assert!(!PathBuf::from(format!("{}.replaced", archive.to_string_lossy())).exists());

        // And it still passes inspection
        inspect_archive(&root, &archive, "0.5.2").unwrap();

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn a_stable_database_and_document_set_exports_and_restores_successfully() {
        let root = scratch("stable-export-restore");
        let elsewhere = scratch("stable-export-restore-out");
        let restore_target = scratch("stable-export-restore-target");
        write_database(&root.join(DB_FILES[0]), "production training record");
        write_document(&root, "handbook.pdf", "chapter 1");
        write_document(&root, "lessons/brief.png", "briefing notes");
        let archive = elsewhere.join("stable.hfdbackup");

        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.files, 3); // db + 2 documents
        assert!(archive.is_file());

        // Proves format-v2 database and document completeness verification passes
        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(inspected.files, 3);
        let file_bytes = std::fs::metadata(&archive).unwrap().len();
        assert_eq!(info.file_bytes, file_bytes);
        assert_eq!(inspected.file_bytes, file_bytes);
        assert_eq!(inspected.bytes, info.bytes);
        assert_ne!(inspected.bytes, file_bytes);
        let json = serde_json::to_value(&inspected).unwrap();
        assert_eq!(json["fileBytes"], file_bytes);
        assert_eq!(json["bytes"], info.bytes);

        // Proves restore extracts cleanly
        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 3);
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DB_FILES[0])
            .is_file());
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(RESTORE_PENDING_DIR)
            .join(DOCUMENTS_DIR)
            .join("lessons/brief.png")
            .is_file());

        apply_pending_restore_in(&restore_target).unwrap();
        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("lessons/brief.png")
            .is_file());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn format_v3_inspection_proves_database_and_document_completeness() {
        let root = scratch("completeness-test");
        let elsewhere = scratch("completeness-test-out");
        write_database(&root.join(DB_FILES[0]), "db record");
        write_document(&root, "handbook.pdf", "chapter 1");
        let archive = elsewhere.join("incomplete.hfdbackup");

        // Craft an archive where the document is missing from the archive but in DB
        let db_with_ref = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);
        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION,
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
            detached_at_export: Vec::new(),
            schema_version: None,
            device_id: None,
            platform: None,
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();
        let saved_db = add_file_to_archive(&mut zip, &db_with_ref, DB_FILES[0]).unwrap();
        let integrity = vec![saved_db];
        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // Database references handbook.pdf, but archive contains NO documents.
        // Format-v3 inspection MUST refuse this archive!
        let error = inspect_archive(&root, &archive, "0.5.2").unwrap_err();
        assert!(
            error.contains("missing from the archive"),
            "Expected missing document completeness error, got: {error}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn export_with_missing_referenced_file_succeeds_and_restores_cleanly() {
        let root = scratch("missing-doc-export");
        let elsewhere = scratch("missing-doc-export-out");
        let restore_target = scratch("missing-doc-export-target");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook bytes");

        // Reference a missing file in the database without creating it in documents/
        let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        conn.execute(
            "INSERT INTO study_materials (id, file_path) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
            params!["missing-notes.pdf", "missing-notes.pdf"],
        )
        .unwrap();
        drop(conn);

        let archive = elsewhere.join("missing.hfdbackup");
        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(
            info.missing_documents,
            vec!["missing-notes.pdf".to_string()]
        );
        assert_eq!(info.files, 2); // db + handbook.pdf

        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(
            inspected.missing_documents,
            vec!["missing-notes.pdf".to_string()]
        );
        assert_eq!(inspected.files, 2);

        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 2);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("missing-notes.pdf")
            .exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn export_with_unreferenced_orphan_file_succeeds_and_excludes_orphan() {
        let root = scratch("orphan-doc-export");
        let elsewhere = scratch("orphan-doc-export-out");
        let restore_target = scratch("orphan-doc-export-target");
        write_database(&root.join(DB_FILES[0]), "valid db");
        write_document(&root, "handbook.pdf", "handbook bytes");

        // Create an unreferenced file directly on disk without referencing it in DB
        std::fs::write(
            root.join(DOCUMENTS_DIR).join("orphan.pdf"),
            "unreferenced bytes",
        )
        .unwrap();

        let archive = elsewhere.join("orphan.hfdbackup");
        let info = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.unreferenced_documents, vec!["orphan.pdf".to_string()]);
        assert_eq!(info.files, 2); // db + handbook.pdf (orphan excluded)

        let inspected = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(inspected.files, 2);

        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 2);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("orphan.pdf")
            .exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn export_refuses_referenced_document_with_deletion_in_progress_and_retries_transiently() {
        let root = scratch("deletion-in-progress-export");
        let elsewhere = scratch("deletion-in-progress-export-out");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "in progress deletion test");

        // Insert reference into database but do not create file in documents/
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('1', 'staged-doc.pdf')",
                [],
            )
            .unwrap();
        }

        // Stage the document in documents/.trash
        let trash = root.join(DOCUMENTS_DIR).join(crate::documents::TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join("del-1.data"), "staged file content").unwrap();
        let meta = crate::documents::StagedDeletion {
            staged_id: "del-1".to_string(),
            original_relative_path: "staged-doc.pdf".to_string(),
            already_missing: false,
        };
        std::fs::write(
            trash.join("del-1.meta"),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        let archive = elsewhere.join("in-progress.hfdbackup");

        // 1. Single attempt: a referenced file that exists only as a staged .data+.meta in .trash
        // causes the attempt to return Transient
        let single_attempt = write_complete_backup_from_database(
            &root, &archive, "0.5.2", &db_path, false, true, None,
        );
        match single_attempt {
            Err(BackupExportError::Transient(msg)) => {
                assert!(
                    msg.contains("deletion was in progress"),
                    "Expected transient message explaining deletion in progress, got: {msg}"
                );
            }
            other => panic!("Expected Transient error, got: {other:?}"),
        }

        // 2. Full export with retry: when the staged deletion persists across all retries,
        // the final error explains that a deletion was in progress.
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(result.is_err(), "Export must fail across retries");
        let err = result.unwrap_err();
        assert!(
            err.contains("deletion was in progress"),
            "Final error must explain deletion was in progress, got: {err}"
        );
        assert!(!archive.exists(), "Archive must not exist on failure");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn export_refuses_referenced_document_when_trash_metadata_is_corrupt_and_retries_transiently() {
        let root = scratch("corrupt-trash-meta-export");
        let elsewhere = scratch("corrupt-trash-meta-export-out");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "corrupt trash metadata test");

        // Reference a document in the database that is not in documents/
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('1', 'staged-doc.pdf')",
                [],
            )
            .unwrap();
        }

        // Stage file in trash but with corrupt/malformed metadata
        let trash = root.join(DOCUMENTS_DIR).join(crate::documents::TRASH_DIR);
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join("del-1.data"), "staged document bytes").unwrap();
        std::fs::write(trash.join("del-1.meta"), "{ malformed json: not valid }").unwrap();

        let archive = elsewhere.join("corrupt-meta.hfdbackup");

        // 1. Single attempt: fails with Transient error when trash cannot be inspected reliably
        let single_attempt = write_complete_backup_from_database(
            &root, &archive, "0.5.2", &db_path, false, true, None,
        );
        match single_attempt {
            Err(BackupExportError::Transient(msg)) => {
                assert!(
                    msg.contains("staged deletion metadata"),
                    "Expected transient error indicating metadata problem, got: {msg}"
                );
            }
            other => panic!("Expected Transient error, got: {other:?}"),
        }

        // 2. Full export with retry: fails safely and boundedly, with no archive finalized
        let result = create_consistent_complete_backup_with_retry(&root, &archive, "0.5.2");
        assert!(result.is_err(), "Export must fail across retries");
        let err = result.unwrap_err();
        assert!(
            err.contains("staged deletion metadata"),
            "Final error must explain metadata inspection failure, got: {err}"
        );
        assert!(!archive.exists(), "Archive must not exist on failure");

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn format_v2_with_unreferenced_document_inspects_and_restores_cleanly() {
        let root = scratch("v2-unreferenced-restore");
        let elsewhere = scratch("v2-unreferenced-restore-out");
        let restore_target = scratch("v2-unreferenced-restore-target");
        write_database(&root.join(DB_FILES[0]), "valid v2 db");
        write_document(&root, "handbook.pdf", "handbook contents");

        // Create an unreferenced file on disk
        let orphan_path = root.join(DOCUMENTS_DIR).join("unreferenced.pdf");
        std::fs::write(&orphan_path, "old style unreferenced document in v2").unwrap();

        let archive = elsewhere.join("old-v2.hfdbackup");

        // Construct a valid v2 archive containing both handbook.pdf and unreferenced.pdf
        let db_path = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: V2_ARCHIVE_VERSION,
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
            detached_at_export: Vec::new(),
            schema_version: None,
            device_id: None,
            platform: None,
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        let saved_orphan =
            add_file_to_archive(&mut zip, &orphan_path, "documents/unreferenced.pdf").unwrap();
        integrity.push(saved_orphan);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // 1. Proves inspection succeeds for valid old-style v2 archive with an unreferenced document
        let info = inspect_archive(&root, &archive, "0.5.2").unwrap();
        assert_eq!(info.files, 3); // db + handbook.pdf + unreferenced.pdf
        assert_eq!(
            info.unreferenced_documents,
            vec!["unreferenced.pdf".to_string()]
        );

        // 2. Proves restore succeeds
        let staged = stage_complete_restore_in(&restore_target, &archive, "0.5.2").unwrap();
        assert_eq!(staged.files, 3);
        apply_pending_restore_in(&restore_target).unwrap();

        assert!(restore_target.join(DB_FILES[0]).is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("handbook.pdf")
            .is_file());
        assert!(restore_target
            .join(DOCUMENTS_DIR)
            .join("unreferenced.pdf")
            .is_file());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn format_v3_with_unreferenced_document_fails_inspection() {
        let root = scratch("v3-unreferenced-inspection");
        let elsewhere = scratch("v3-unreferenced-inspection-out");
        write_database(&root.join(DB_FILES[0]), "valid v3 db");
        write_document(&root, "handbook.pdf", "handbook contents");

        let orphan_path = root.join(DOCUMENTS_DIR).join("unreferenced.pdf");
        std::fs::write(&orphan_path, "unreferenced document in v3").unwrap();

        let archive = elsewhere.join("v3-with-unreferenced.hfdbackup");
        let db_path = root.join(DB_FILES[0]);
        let output = File::create(&archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION, // v3
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(),
            detached_at_export: Vec::new(),
            schema_version: None,
            device_id: None,
            platform: None,
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        let saved_orphan =
            add_file_to_archive(&mut zip, &orphan_path, "documents/unreferenced.pdf").unwrap();
        integrity.push(saved_orphan);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        let err = inspect_archive(&root, &archive, "0.5.2").unwrap_err();
        assert!(
            err.contains("contains an unreferenced document: unreferenced.pdf"),
            "Expected unreferenced document error, got: {err}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn old_style_format_v2_with_missing_referenced_document_inspects_and_restores_with_warning() {
        let root = scratch("old-v2-missing-doc-root");
        let elsewhere = scratch("old-v2-missing-doc-out");
        let restore_target = scratch("old-v2-missing-doc-target");
        let db_path = root.join(DB_FILES[0]);
        write_database(&db_path, "old v2 with missing doc");

        let connection = Connection::open(&db_path).unwrap();
        connection
            .execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('mat-1', 'present.pdf')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO study_materials (id, file_path) VALUES ('mat-2', 'missing.pdf')",
                [],
            )
            .unwrap();
        drop(connection);

        let present_content = "content of present file";
        write_document(&root, "present.pdf", present_content);

        // 1. Construct an old-style format-v2 archive:
        // - formatVersion: 2
        // - NO missing_at_export field in manifest.json
        // - Valid integrity.json containing records for the files present in the archive
        // - Database references missing.pdf which is NOT in the archive
        let old_v2_archive = elsewhere.join("old-v2-missing.hfdbackup");
        let output = File::create(&old_v2_archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let old_manifest_json = r#"{
  "format": "her-flight-deck-complete-backup",
  "formatVersion": 2,
  "appVersion": "0.5.1",
  "createdAt": 1700000000
}"#;
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(old_manifest_json.as_bytes()).unwrap();

        let mut integrity = Vec::new();
        let saved_db = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity.push(saved_db);

        let saved_doc = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("present.pdf"),
            "documents/present.pdf",
        )
        .unwrap();
        integrity.push(saved_doc);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        // 2. Prove inspection succeeds and discloses the missing reference in restore info
        let info = inspect_archive(&root, &old_v2_archive, "0.5.2")
            .expect("old-style v2 archive must inspect successfully");
        assert_eq!(info.files, 2); // her-flight-deck.db + documents/present.pdf
        assert_eq!(info.missing_documents, vec!["missing.pdf".to_string()]);

        // 3. Prove restore succeeds and present files retain their exact bytes
        let staged = stage_complete_restore_in(&restore_target, &old_v2_archive, "0.5.2")
            .expect("old-style v2 archive must stage successfully");
        assert_eq!(staged.files, 2);
        assert_eq!(staged.missing_documents, vec!["missing.pdf".to_string()]);

        apply_pending_restore_in(&restore_target)
            .expect("old-style v2 archive must apply successfully");
        assert!(restore_target.join(DB_FILES[0]).is_file());
        let restored_present = restore_target.join(DOCUMENTS_DIR).join("present.pdf");
        assert!(restored_present.is_file());
        let read_back = std::fs::read_to_string(&restored_present).unwrap();
        assert_eq!(read_back, present_content);
        assert!(!restore_target
            .join(DOCUMENTS_DIR)
            .join("missing.pdf")
            .exists());

        // 4. Prove a newly created archive (v3) that unexpectedly omits a referenced file fails validation
        let new_v3_archive = elsewhere.join("new-v3-unexpected-omission.hfdbackup");
        let output = File::create(&new_v3_archive).unwrap();
        let mut zip = ZipWriter::new(output);

        let new_manifest = CompleteBackupManifest {
            format: ARCHIVE_FORMAT.to_string(),
            format_version: ARCHIVE_VERSION, // 3
            app_version: "0.5.2".to_string(),
            created_at: unix_timestamp(),
            missing_at_export: Vec::new(), // unexpectedly undeclared omission!
            detached_at_export: Vec::new(),
            schema_version: None,
            device_id: None,
            platform: None,
        };
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(serde_json::to_string(&new_manifest).unwrap().as_bytes())
            .unwrap();

        let mut integrity_v3 = Vec::new();
        let saved_db_v3 = add_file_to_archive(&mut zip, &db_path, DB_FILES[0]).unwrap();
        integrity_v3.push(saved_db_v3);
        let saved_doc_v3 = add_file_to_archive(
            &mut zip,
            &root.join(DOCUMENTS_DIR).join("present.pdf"),
            "documents/present.pdf",
        )
        .unwrap();
        integrity_v3.push(saved_doc_v3);

        zip.start_file(ARCHIVE_INTEGRITY, archive_options())
            .unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupIntegrity {
                algorithm: "sha256".to_string(),
                files: integrity_v3,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();

        let err = inspect_archive(&root, &new_v3_archive, "0.5.2").expect_err(
            "new archive omitting referenced file without declaration must fail validation",
        );
        assert!(
            err.contains("missing from the archive"),
            "Expected completeness error, got: {err}"
        );
        assert!(
            err.contains("missing.pdf"),
            "Expected mention of missing.pdf, got: {err}"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&restore_target).unwrap();
    }

    #[test]
    fn audit_failed_rollback_must_retain_original_database() {
        let root = scratch("audit-failed-rollback");
        let elsewhere = scratch("audit-failed-rollback-out");
        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("rollback.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current data");
        write_document(&root, "handbook.pdf", "current document");

        let current_db_bytes = std::fs::read(root.join(DB_FILES[0])).unwrap();
        let current_db_hash = sha256_digest(&current_db_bytes);
        let current_doc_bytes =
            std::fs::read(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap();
        let current_doc_hash = sha256_digest(&current_doc_bytes);

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();
        let error = apply_pending_restore_in_with(&root, || {
            std::fs::create_dir(root.join(DB_FILES[0])).unwrap();
            Err("injected install failure and rollback destination obstruction".to_string())
        })
        .unwrap_err();

        // 1. Error message must NOT claim previous data was recovered
        assert!(
            !error.contains("previous data was recovered"),
            "Error falsely claimed recovery succeeded when destination was obstructed: {error}"
        );

        // 2. The original database and documents must be retained in an identifiable recovery location
        let mut original_db_retained = false;
        let mut original_doc_retained = false;
        if let Ok(entries) = std::fs::read_dir(root.join(BACKUP_DIR)) {
            for entry in entries.filter_map(Result::ok) {
                let db_path = entry.path().join(DB_FILES[0]);
                if db_path.is_file() {
                    let bytes = std::fs::read(&db_path).unwrap();
                    if sha256_digest(&bytes) == current_db_hash {
                        original_db_retained = true;
                    }
                }
                let doc_path = entry.path().join(DOCUMENTS_DIR).join("handbook.pdf");
                if doc_path.is_file() {
                    let bytes = std::fs::read(&doc_path).unwrap();
                    if sha256_digest(&bytes) == current_doc_hash {
                        original_doc_retained = true;
                    }
                }
            }
        }

        assert!(
            original_db_retained,
            "Failed rollback must keep the original database in an identifiable recovery location with matching hash"
        );
        assert!(
            original_doc_retained,
            "Failed rollback must keep the original documents in an identifiable recovery location with matching hash"
        );

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
    }

    #[test]
    fn audit_document_return_obstruction_retains_document_and_db_wal() {
        let root = scratch("doc-obstruction-test");
        let elsewhere = scratch("doc-obstruction-out");

        write_database(&root.join(DB_FILES[0]), "backup data");
        write_document(&root, "handbook.pdf", "backup document");
        let archive = elsewhere.join("backup.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        write_document(&root, "handbook.pdf", "current active document");
        let orig_doc_hash =
            sha256_digest(&std::fs::read(root.join(DOCUMENTS_DIR).join("handbook.pdf")).unwrap());

        let source = scratch("doc-obstruction-source");
        write_database(&source.join(DB_FILES[0]), "current active data");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute("UPDATE audit_payload SET value = 'active wal data'", [])
            .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        for name in DB_FILES {
            if source.join(name).is_file() {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
        }
        let orig_db_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let orig_wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());
        drop(conn);
        std::fs::remove_dir_all(&source).unwrap();
        assert!(root.join(DB_FILES[1]).is_file());

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        // Obstruct document return during rollback by creating an unexpected file at documents/
        let error = apply_pending_restore_in_with(&root, || {
            // Create a conflicting file at root/documents path so rollback cannot return documents
            std::fs::write(root.join(DOCUMENTS_DIR), b"blocking document return").unwrap();
            Err("injected install failure with doc return obstruction".to_string())
        })
        .unwrap_err();

        assert!(!error.contains("previous data was recovered"), "{error}");
        assert!(
            error.contains("recovery rollback could not return original data"),
            "{error}"
        );

        // Original database, WAL, and documents must be retained in the rollback directory
        let mut found_db = false;
        let mut found_wal = false;
        let mut found_doc = false;
        let backups = list_backups_in(&root).unwrap();
        assert!(!backups.is_empty());
        for b in backups {
            let p = PathBuf::from(b.path);
            let db_file = p.join(DB_FILES[0]);
            if db_file.is_file() && sha256_digest(&std::fs::read(&db_file).unwrap()) == orig_db_hash
            {
                found_db = true;
            }
            let wal_file = p.join(DB_FILES[1]);
            if wal_file.is_file()
                && sha256_digest(&std::fs::read(&wal_file).unwrap()) == orig_wal_hash
            {
                found_wal = true;
            }
            let doc_file = p.join(DOCUMENTS_DIR).join("handbook.pdf");
            if doc_file.is_file()
                && sha256_digest(&std::fs::read(&doc_file).unwrap()) == orig_doc_hash
            {
                found_doc = true;
            }
        }
        assert!(
            found_db,
            "Protected DB must be preserved with exact original hash"
        );
        assert!(
            found_wal,
            "Protected WAL must be preserved with exact original hash"
        );
        assert!(
            found_doc,
            "Protected documents must be preserved with exact original hash"
        );

        // Startup decision on this obstructed state must be BlockedUnresolved
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::BlockedUnresolved {
                reason,
                recovery_folder,
            } => {
                assert!(recovery_folder.is_some());
                assert!(reason.contains("recovery rollback could not return original data"));
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_failure_after_partial_protection_and_partial_install() {
        let root = scratch("partial-prot-inst");
        let elsewhere = scratch("partial-prot-inst-out");

        // Subtest A: Failure during protection returns whatever moved
        write_database(&root.join(DB_FILES[0]), "active original db");
        write_document(&root, "handbook.pdf", "active original doc");

        let rollback = root.join("backups").join("before-restore-test");
        std::fs::create_dir_all(&rollback).unwrap();
        // Move db to rollback as if protection partially completed
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-test".to_string(), true);
        journal.protected_db_files.push(DB_FILES[0].to_string());
        journal
            .original_db_artifacts
            .push(round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0]));
        journal.protected_documents = false; // documents were not moved yet
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentWithContent);
        journal.original_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        journal.phase = RestorePhase::Protecting;
        write_journal(&root, &journal).unwrap();

        // Rollback should put the database back into root
        execute_rollback(&root, &mut journal).unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "active original db"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("active original doc")
        );

        // Subtest B: Failure after DB is installed from pending
        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "handbook.pdf", "backup doc");
        let archive = elsewhere.join("backup.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        write_database(&root.join(DB_FILES[0]), "active db v2");
        write_document(&root, "handbook.pdf", "active doc v2");
        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        // Simulate protection done
        let rollback2 = root.join("backups").join("before-restore-test2");
        std::fs::create_dir_all(&rollback2).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback2.join(DB_FILES[0])).unwrap();
        std::fs::rename(root.join(DOCUMENTS_DIR), rollback2.join(DOCUMENTS_DIR)).unwrap();

        // Simulate DB installed from pending
        std::fs::rename(pending.join(DB_FILES[0]), root.join(DB_FILES[0])).unwrap();

        let mut journal2 = RestoreJournal::new("backups/before-restore-test2".to_string(), true);
        journal2.protected_db_files.push(DB_FILES[0].to_string());
        journal2.original_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(rollback2.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(rollback2.join(DB_FILES[0]))
                .unwrap()
                .len(),
        });
        journal2.protected_documents = true;
        journal2.original_documents_presence = Some(OriginalDocumentsPresence::PresentWithContent);
        journal2.original_document_artifacts =
            inventory_directory_artifacts(&rollback2.join(DOCUMENTS_DIR)).unwrap();
        journal2.installed_db_files.push(DB_FILES[0].to_string());
        journal2.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        });
        journal2.phase = RestorePhase::Activating;
        write_journal(&root, &journal2).unwrap();

        // Rollback should uninstall installed db and return original db and documents
        execute_rollback(&root, &mut journal2).unwrap();
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db v2");
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("active doc v2")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_db_wal_shm_documents_never_silently_mixed() {
        let root = scratch("no-silent-mix");
        let elsewhere = scratch("no-silent-mix-out");

        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "handbook.pdf", "backup doc");
        let archive = elsewhere.join("archive.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();

        // Active dataset with distinct DB, WAL, SHM, and documents
        write_database(&root.join(DB_FILES[0]), "original active db");
        let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original active db in wal'",
            [],
        )
        .unwrap();
        drop(conn);
        write_document(&root, "handbook.pdf", "original active doc");

        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();

        let err =
            apply_pending_restore_in_with(&root, || Err("injected install error".to_string()))
                .unwrap_err();

        assert!(err.contains("previous data was recovered"), "{err}");

        // Check active files are 100% original dataset
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original active db in wal"
        );
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("original active doc")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_successful_complete_and_database_only_restores_keep_contracts() {
        let root = scratch("contracts-test");
        let elsewhere = scratch("contracts-out");

        // 1. Complete restore replaces DB and documents
        write_database(&root.join(DB_FILES[0]), "backup db");
        write_document(&root, "doc.pdf", "backup doc");
        let complete_archive = elsewhere.join("complete.hfdbackup");
        write_complete_backup(&root, &complete_archive, "0.5.3").unwrap();

        write_database(&root.join(DB_FILES[0]), "active db");
        write_document(&root, "doc.pdf", "active doc");
        stage_complete_restore_in(&root, &complete_archive, "0.5.3").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(database_contents(&root.join(DB_FILES[0])), "backup db");
        assert_eq!(
            document_contents(&root, "doc.pdf").as_deref(),
            Some("backup doc")
        );

        // 2. Safety copy (database-only restore) replaces database but preserves existing documents
        write_database(&root.join(DB_FILES[0]), "safety db");
        let safety_folder = root.join("backups").join("manual-safety-test");
        std::fs::create_dir_all(&safety_folder).unwrap();
        std::fs::copy(root.join(DB_FILES[0]), safety_folder.join(DB_FILES[0])).unwrap();

        write_database(&root.join(DB_FILES[0]), "active db 2");
        write_document(&root, "user-upload.pdf", "preserve my document");

        stage_local_restore_in(&root, "manual-safety-test").unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert_eq!(database_contents(&root.join(DB_FILES[0])), "safety db");
        assert_eq!(
            document_contents(&root, "user-upload.pdf").as_deref(),
            Some("preserve my document")
        );

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn audit_pruning_cannot_discard_unresolved_recovery_folder() {
        let root = scratch("pruning-retention");
        let bdir = root.join("backups");
        std::fs::create_dir_all(&bdir).unwrap();

        // Create 15 regular backup folders
        for i in 1..=15 {
            let folder = bdir.join(format!("2026-09-01-{i:02}0000-auto"));
            std::fs::create_dir_all(&folder).unwrap();
            write_database(&folder.join(DB_FILES[0]), &format!("auto db {i}"));
        }

        // Create an unresolved recovery rollback folder with an older timestamp
        let recovery_folder = bdir.join("2026-08-01-000000-before-restore");
        std::fs::create_dir_all(&recovery_folder).unwrap();
        write_database(&recovery_folder.join(DB_FILES[0]), "precious original db");
        write_document(&recovery_folder, "notes.pdf", "precious notes");
        std::fs::write(recovery_folder.join(".recovery-pending"), b"pending").unwrap();

        // Also record a journal referencing it
        let journal = RestoreJournal {
            operation_id: "op-prune-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/2026-08-01-000000-before-restore".to_string(),
            replace_documents: true,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: true,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("test obstruction".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Run prune
        prune(&root).unwrap();

        // The precious recovery folder MUST NOT be pruned!
        assert!(
            recovery_folder.exists(),
            "Pruning must never delete unresolved recovery folder"
        );
        assert_eq!(
            database_contents(&recovery_folder.join(DB_FILES[0])),
            "precious original db"
        );
        assert_eq!(
            document_contents(&recovery_folder, "notes.pdf").as_deref(),
            Some("precious notes")
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_interrupted_states_resume_safely_on_startup() {
        let root = scratch("interrupted-states");

        // Case 1: Interrupted at Protected state
        write_database(&root.join(DB_FILES[0]), "active db");
        let rollback1 = root.join("backups").join("before-restore-case1");
        std::fs::create_dir_all(&rollback1).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback1.join(DB_FILES[0])).unwrap();

        let journal1 = RestoreJournal {
            operation_id: "op-interrupted-case1".to_string(),
            phase: RestorePhase::Protected,
            rollback_rel_path: "backups/before-restore-case1".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: sha256_digest(&std::fs::read(rollback1.join(DB_FILES[0])).unwrap()),
                size: std::fs::metadata(rollback1.join(DB_FILES[0]))
                    .unwrap()
                    .len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal1).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        // Case 2: Interrupted at Activating state after DB installed
        let rollback2 = root.join("backups").join("before-restore-case2");
        std::fs::create_dir_all(&rollback2).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback2.join(DB_FILES[0])).unwrap();
        write_database(&root.join(DB_FILES[0]), "partially installed db");

        let orig_ident2 = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(rollback2.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(rollback2.join(DB_FILES[0]))
                .unwrap()
                .len(),
        };
        let staged_ident2 = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        };
        let journal2 = RestoreJournal {
            operation_id: "op-interrupted-case2".to_string(),
            phase: RestorePhase::Activating,
            rollback_rel_path: "backups/before-restore-case2".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![DB_FILES[0].to_string()],
            installed_documents: false,
            original_db_artifacts: vec![orig_ident2],
            staged_db_artifacts: vec![staged_ident2],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal2).unwrap();

        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db");

        // Case 3: Interrupted at Committed state with pending cleanup lingering
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::write(pending.join("leftover.tmp"), b"leftover").unwrap();
        let plan3 = RestorePlan {
            operation_id: "op-interrupted-case3".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan3).unwrap(),
        )
        .unwrap();

        let journal3 = RestoreJournal {
            operation_id: "op-interrupted-case3".to_string(),
            phase: RestorePhase::Committed,
            rollback_rel_path: "backups/before-restore-case3".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal3).unwrap();

        let decision3 = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision3, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_repeated_startup_on_unresolved_recovery_is_idempotent() {
        let root = scratch("repeated-startup");
        write_database(&root.join(DB_FILES[0]), "original active db");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let rollback = root.join("backups").join("before-restore-repeat");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        // Obstruct root destination
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap();

        let journal = RestoreJournal {
            operation_id: "op-repeat-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-repeat".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: orig_hash.clone(),
                size: std::fs::metadata(rollback.join(DB_FILES[0])).unwrap().len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstructed".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Call 3 times
        for _ in 0..3 {
            let decision = handle_startup_restore_in(&root).unwrap();
            match decision {
                StartupRestoreDecision::BlockedUnresolved {
                    recovery_folder, ..
                } => {
                    assert_eq!(recovery_folder.as_ref(), Some(&rollback));
                }
                other => panic!("Expected BlockedUnresolved, got {other:?}"),
            }
            // Verify original file in rollback remains untouched
            let current_hash = sha256_digest(&std::fs::read(rollback.join(DB_FILES[0])).unwrap());
            assert_eq!(current_hash, orig_hash);
        }

        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_recovery_completes_after_obstruction_removed() {
        let root = scratch("obstruction-cleared");
        write_database(&root.join(DB_FILES[0]), "my active db before crash");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let rollback = root.join("backups").join("before-restore-clear");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();

        // Inject obstruction
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap();

        let journal = RestoreJournal {
            operation_id: "op-clear-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-clear".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![ArtifactIdentity {
                name: DB_FILES[0].to_string(),
                sha256: orig_hash.clone(),
                size: std::fs::metadata(rollback.join(DB_FILES[0])).unwrap().len(),
            }],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstructed".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        // Launch fails while obstruction present
        let decision1 = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision1,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        // User or remediation removes the obstruction
        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();

        // Next launch recovers automatically and safely
        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }

        assert!(root.join(DB_FILES[0]).is_file());
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "my active db before crash"
        );
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_malformed_journal_handled_conservatively() {
        let root = scratch("malformed-journal");

        // 1. Path traversal attempt
        let journal_traversal = r#"{
            "phase": "UnresolvedRecovery",
            "rollback_rel_path": "../../evil",
            "replace_documents": false,
            "protected_db_files": ["her-flight-deck.db"],
            "protected_documents": false,
            "installed_db_files": [],
            "installed_documents": false,
            "failure_reason": null
        }"#;
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), journal_traversal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::BlockedUnresolved { reason, .. } => {
                assert!(
                    reason.contains("validation failed")
                        || reason.contains("Invalid rollback path"),
                    "{reason}"
                );
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        // 2. Corrupted JSON
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), b"{ corrupted json").unwrap();
        let decision2 = handle_startup_restore_in(&root).unwrap();
        match decision2 {
            StartupRestoreDecision::BlockedUnresolved { reason, .. } => {
                assert!(reason.contains("corrupted or invalid"), "{reason}");
            }
            other => panic!("Expected BlockedUnresolved, got {other:?}"),
        }

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn audit_startup_blocks_on_unresolved_and_allows_safe_states() {
        let root = scratch("startup-decision-matrix");

        // Safe case A: Staging refused before touching data
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::write(pending.join(DB_FILES[0]), b"not a sqlite db").unwrap();
        write_database(&root.join(DB_FILES[0]), "existing safe db");

        let decision_refused = handle_startup_restore_in(&root).unwrap();
        match decision_refused {
            StartupRestoreDecision::StagingRefusedUnchanged { reason } => {
                assert!(reason.contains("not usable"), "{reason}");
            }
            other => panic!("Expected StagingRefusedUnchanged, got {other:?}"),
        }
        // Active data is unchanged
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "existing safe db"
        );

        // Unsafe case: Unresolved recovery blocks startup
        let rollback = root.join("backups").join("before-restore-matrix");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "precious db");
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();
        std::fs::create_dir(root.join(DB_FILES[0])).unwrap(); // obstruction

        let journal = RestoreJournal {
            operation_id: "op-matrix-test".to_string(),
            phase: RestorePhase::UnresolvedRecovery,
            rollback_rel_path: "backups/before-restore-matrix".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![DB_FILES[0].to_string()],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: Some("obstruction".to_string()),
        };
        write_journal(&root, &journal).unwrap();

        let decision_unresolved = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision_unresolved,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    /// GEN-REL-02 (GENREL02-R11): a restore that committed, then was cut off
    /// before its cleanup finished, still forgets the replaced library's
    /// Gemini jobs on the next launch, before the restore journal goes.
    #[test]
    fn a_committed_restore_forgets_gemini_jobs_even_after_an_interruption() {
        let root = scratch("gemini-jobs-after-restore");
        write_database(&root.join(DB_FILES[0]), "restored committed db");
        let job_journal = root.join(crate::gemini_jobs::JOURNAL_FILE);
        std::fs::write(
            &job_journal,
            serde_json::json!({"schema": "hfd-gemini-jobs/1", "jobs": [{
                "id": "job-aaaaaaaaaaaaaaaaaaaaaaaa", "kind": "study-aid", "materialId": "mat-a",
                "relativePath": "documents/a.pdf", "contentSha256": "x", "stage": "ready",
                "createdAt": 0, "updatedAt": 0, "result": {"title": "Before the restore"}
            }]})
            .to_string(),
        )
        .unwrap();
        let journal = RestoreJournal {
            operation_id: "op-gemini-jobs".to_string(),
            phase: RestorePhase::Committed,
            rollback_rel_path: "backups/before-restore-gemini-jobs".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal).unwrap();

        // The job journal cannot be cleared yet: the restore journal stays, so
        // the next launch tries again.
        crate::gemini_jobs::FAIL_CLEAR_FOR_TESTS
            .lock()
            .unwrap()
            .insert(root.clone());
        assert_eq!(
            handle_startup_restore_in(&root).unwrap(),
            StartupRestoreDecision::RestoreCompleted
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).exists(),
            "kept for the next launch"
        );
        assert!(std::fs::read_to_string(&job_journal)
            .unwrap()
            .contains("Before the restore"));
        // GENREL02-R14: during this launch the old answer is neither offered
        // nor saveable, and nothing new can start.
        assert!(crate::gemini_jobs::with(&root, |j| j.list()).is_empty());
        assert_eq!(
            crate::gemini_jobs::with(&root, |j| j.acknowledge("job-aaaaaaaaaaaaaaaaaaaaaaaa")),
            Ok(false)
        );
        assert_eq!(
            crate::gemini_jobs::with(&root, |j| j.begin(
                crate::gemini_jobs::JobKind::StudyAid,
                "mat-a",
                "documents/a.pdf",
                "x",
                None
            )),
            Err(crate::gemini_jobs::RESTORING.to_string())
        );

        // Next launch, with the obstruction gone.
        crate::gemini_jobs::FAIL_CLEAR_FOR_TESTS
            .lock()
            .unwrap()
            .remove(&root);
        // A fresh process: the per-folder journal is read from disk again.
        crate::gemini_jobs::forget_open_for_tests(&root);
        assert_eq!(
            handle_startup_restore_in(&root).unwrap(),
            StartupRestoreDecision::RestoreCompleted
        );
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        let left = std::fs::read_to_string(&job_journal).unwrap_or_default();
        assert!(!left.contains("Before the restore"), "{left}");
        // Once cleared, the launch is normal again.
        assert!(crate::gemini_jobs::with(&root, |j| j.begin(
            crate::gemini_jobs::JobKind::StudyAid,
            "mat-a",
            "documents/a.pdf",
            "x",
            None
        ))
        .is_ok());
        crate::gemini_jobs::forget_open_for_tests(&root);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn audit_committed_activation_with_cleanup_failure_does_not_replay() {
        let root = scratch("cleanup-no-replay");
        write_database(&root.join(DB_FILES[0]), "restored committed db");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "should not be installed again");
        let plan = RestorePlan {
            operation_id: "op-committed-cleanup".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let journal = RestoreJournal {
            operation_id: "op-committed-cleanup".to_string(),
            phase: RestorePhase::Committed,
            rollback_rel_path: "backups/before-restore-committed".to_string(),
            replace_documents: false,
            original_documents_presence: None,
            protected_db_files: vec![],
            protected_documents: false,
            installed_db_files: vec![],
            installed_documents: false,
            original_db_artifacts: vec![],
            staged_db_artifacts: vec![],
            original_document_artifacts: vec![],
            staged_document_artifacts: vec![],
            failure_reason: None,
        };
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        // Active DB is STILL the committed restored db, NOT re-installed or rolled back
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "restored committed db"
        );
        assert!(!pending.exists());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn reviewer_recovered_restore_cleanup_failure_must_not_replay() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("review-recovered-cleanup");
        let elsewhere = scratch("review-recovered-cleanup-out");
        write_database(&root.join(DB_FILES[0]), "selected backup dataset");
        write_document(&root, "handbook.pdf", "selected backup document");
        let archive = elsewhere.join("selected.hfdbackup");
        write_complete_backup(&root, &archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current original dataset");
        write_document(&root, "handbook.pdf", "current original document");
        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        let mut held = None;
        let first_error = apply_pending_restore_in_with(&root, || {
            held = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(pending.join(DB_FILES[0]))
                    .unwrap(),
            );
            Err("injected activation failure with pending database locked against deletion".into())
        })
        .unwrap_err();
        let first_value = database_contents(&root.join(DB_FILES[0]));
        let first_document = document_contents(&root, "handbook.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).is_file();
        let pending_retained = pending.join(DB_FILES[0]).is_file();
        drop(held);
        let next = handle_startup_restore_in(&root).unwrap();
        let next_value = database_contents(&root.join(DB_FILES[0]));
        let next_document = document_contents(&root, "handbook.pdf");
        println!(
            "RECOVERED_REPLAY: first_error={first_error}; first_row={first_value}; first_document={first_document:?}; journal_retained={journal_retained}; pending_retained={pending_retained}; next={next:?}; next_row={next_value}; next_document={next_document:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert_eq!(
            next_value, "current original dataset",
            "A successfully rolled-back restore must remain cancelled after failed staging cleanup"
        );
        assert_eq!(next_document.as_deref(), Some("current original document"));
    }

    #[test]
    fn reviewer_unrecorded_wal_move_preserves_committed_rows() {
        let source = scratch("review-wal-source");
        let root = scratch("review-wal-move");
        write_database(&source.join(DB_FILES[0]), "checkpointed original row");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'committed row only in WAL'",
            [],
        )
        .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        for name in DB_FILES {
            if source.join(name).is_file() {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
        }
        let wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());
        drop(conn);
        let rollback = root.join("backups/before-restore-unrecorded-wal");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();
        let mut journal =
            RestoreJournal::new("backups/before-restore-unrecorded-wal".into(), false);
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        // Actual protection order: WAL rename succeeds, process exits before its journal update.
        std::fs::rename(root.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let wal_retained = [root.join(DB_FILES[1]), rollback.join(DB_FILES[1])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == wal_hash);
        let value = database_contents(&root.join(DB_FILES[0]));
        println!(
            "WAL_MOVE: decision={decision:?}; original_wal_retained={wal_retained}; row={value}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
        assert_eq!(
            value, "committed row only in WAL",
            "Rollback must preserve committed WAL data"
        );
    }

    #[test]
    fn reviewer_stale_rollback_journal_cannot_delete_returned_original() {
        let root = scratch("review-stale-rollback");
        write_database(
            &root.join(DB_FILES[0]),
            "original returned after failed journal update",
        );
        let original_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let rollback = root.join("backups/before-restore-stale-rollback");
        std::fs::create_dir_all(&rollback).unwrap();
        write_document(&rollback, "original.pdf", "original protected document");
        // Rollback's durable update failed, but its ignored error allowed the original DB
        // to return. A subsequent crash leaves the prior installed-files list on disk.
        let mut journal = RestoreJournal::new("backups/before-restore-stale-rollback".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        journal.installed_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let original_retained = [root.join(DB_FILES[0]), rollback.join(DB_FILES[0])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == original_hash);
        println!(
            "STALE_ROLLBACK: decision={decision:?}; original_database_retained={original_retained}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            original_retained,
            "A stale installed-files list must not delete the returned original database"
        );
    }

    #[cfg(windows)]
    #[test]
    fn reviewer_committed_cleanup_failure_must_not_replay() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("review-committed-cleanup");
        write_database(&root.join(DB_FILES[0]), "committed current dataset");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "obsolete pending dataset");
        let mut journal =
            RestoreJournal::new("backups/before-restore-committed-test".into(), false);
        journal.phase = RestorePhase::Committed;
        write_journal(&root, &journal).unwrap();
        let plan = RestorePlan {
            operation_id: journal.operation_id.clone(),
            kind: RestoreKind::Complete,
            source: "synthetic".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();
        // A genuine Windows filesystem failure: allow reads but deny deletion.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(pending.join(DB_FILES[0]))
            .unwrap();
        let first = handle_startup_restore_in(&root).unwrap();
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).is_file();
        let pending_retained = pending.join(DB_FILES[0]).is_file();
        drop(held);
        let second = handle_startup_restore_in(&root).unwrap();
        let value = database_contents(&root.join(DB_FILES[0]));
        println!(
            "CLEANUP_REPLAY: first={first:?}; committed_journal_retained={journal_retained}; pending_retained={pending_retained}; second={second:?}; row={value}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            value, "committed current dataset",
            "Cleanup failure must retain the commit decision across launches"
        );
    }

    #[test]
    fn reviewer_missing_journal_with_recovery_marker_blocks_startup() {
        let root = scratch("review-missing-journal");
        let rollback = root.join("backups/before-restore-journal-gap");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original stranded dataset");
        std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery").unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-journal-gap".into(), false);
        journal.phase = RestorePhase::UnresolvedRecovery;
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let replacement = serde_json::to_string_pretty(&journal).unwrap();
        std::fs::write(
            root.join(format!("{RESTORE_JOURNAL_FILE}.tmp-123")),
            replacement,
        )
        .unwrap();
        // Windows journal replacement deletes the old journal before renaming its temp file.
        std::fs::remove_file(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        println!(
            "MISSING_JOURNAL: decision={decision:?}; active_db_exists={}; recovery_db_exists={}",
            root.join(DB_FILES[0]).is_file(),
            rollback.join(DB_FILES[0]).is_file()
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A missing journal must not allow fresh-database startup over a known recovery set"
        );
    }

    #[test]
    fn reviewer_backups_parent_is_not_a_valid_recovery_folder() {
        let root = scratch("review-journal-parent");
        write_database(&root.join(DB_FILES[0]), "active unrelated dataset");
        let historical = root.join("backups/older-valid-safety-copy");
        std::fs::create_dir_all(&historical).unwrap();
        write_database(
            &historical.join(DB_FILES[0]),
            "valid historical safety copy",
        );
        let original_hash = sha256_digest(&std::fs::read(historical.join(DB_FILES[0])).unwrap());
        let journal = RestoreJournal::new("backups".into(), false);
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let retained = historical.join(DB_FILES[0]).is_file()
            && sha256_digest(&std::fs::read(historical.join(DB_FILES[0])).unwrap())
                == original_hash;
        println!("JOURNAL_PARENT: decision={decision:?}; historical_backup_retained={retained}");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            retained && matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Malformed journal must not delete the whole backups directory"
        );
    }

    #[test]
    fn reviewer_non_regular_journal_is_not_equivalent_to_absent() {
        let root = scratch("review-journal-directory");
        let rollback = root.join("backups/before-restore-nonregular-journal");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original stranded database");
        std::fs::write(rollback.join(".recovery-pending"), b"unresolved recovery").unwrap();
        std::fs::create_dir(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        println!(
            "NONREGULAR_JOURNAL: decision={decision:?}; active_db_exists={}",
            root.join(DB_FILES[0]).is_file()
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "An invalid journal path cannot be treated as no recovery"
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_legacy_restore_wal_is_not_mixed_with_returned_original() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round2-wal-active");
        let elsewhere = scratch("round2-wal-selected");
        write_database(&elsewhere.join(DB_FILES[0]), "selected checkpointed row");
        write_document(&elsewhere, "handbook.pdf", "selected document");
        let conn = Connection::open(elsewhere.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'selected WAL-only row'",
            [],
        )
        .unwrap();
        let archive_path = elsewhere.join("legacy-with-wal.hfdbackup");
        let mut zip = ZipWriter::new(File::create(&archive_path).unwrap());
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupManifest {
                format: ARCHIVE_FORMAT.into(),
                format_version: LEGACY_ARCHIVE_VERSION,
                app_version: "0.3.0".into(),
                created_at: 0,
                missing_at_export: vec![],
                detached_at_export: Vec::new(),
                schema_version: None,
                device_id: None,
                platform: None,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        add_file_to_archive(&mut zip, &elsewhere.join(DB_FILES[0]), DB_FILES[0]).unwrap();
        add_file_to_archive(&mut zip, &elsewhere.join(DB_FILES[1]), DB_FILES[1]).unwrap();
        add_file_to_archive(
            &mut zip,
            &elsewhere.join(DOCUMENTS_DIR).join("handbook.pdf"),
            "documents/handbook.pdf",
        )
        .unwrap();
        zip.finish().unwrap();
        drop(conn);
        write_database(&root.join(DB_FILES[0]), "current original row");
        // Original DB is checkpointed, with WAL mode retained but no WAL file.
        let original_conn = Connection::open(root.join(DB_FILES[0])).unwrap();
        original_conn
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        drop(original_conn);
        assert!(!root.join(DB_FILES[1]).exists());
        write_document(&root, "handbook.pdf", "current original document");
        stage_complete_restore_in(&root, &archive_path, "0.5.3").unwrap();
        assert!(root.join(RESTORE_PENDING_DIR).join(DB_FILES[1]).is_file());
        let mut held_documents = None;
        let first = apply_pending_restore_in_with(&root, || {
            // Lock the staged directory itself so the actual document rename fails,
            // after the selected DB and WAL have already installed.
            held_documents = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .custom_flags(0x02000000)
                    .open(root.join(RESTORE_PENDING_DIR).join(DOCUMENTS_DIR))
                    .unwrap(),
            );
            Ok(())
        })
        .unwrap_err();
        drop(held_documents);
        let second = handle_startup_restore_in(&root).unwrap();
        let wal_left = root.join(DB_FILES[1]).is_file();
        let value = database_contents(&root.join(DB_FILES[0]));
        let doc = document_contents(&root, "handbook.pdf");
        println!("ROUND2_MIXED_WAL: first_error={first}; decision={second:?}; restored_wal_left_with_original_db={wal_left}; row={value}; doc={doc:?}");
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert_eq!(
            value, "current original row",
            "A staged legacy WAL must never replay into the returned original database"
        );
        assert_eq!(doc.as_deref(), Some("current original document"));
    }

    #[cfg(windows)]
    #[test]
    fn round2_failed_terminal_journal_removal_cannot_discard_new_restore() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round2-new-stage");
        let elsewhere = scratch("round2-new-stage-out");
        let second_source = scratch("round2-new-stage-second-source");
        write_database(&root.join(DB_FILES[0]), "first selected row");
        let first_archive = elsewhere.join("first.hfdbackup");
        write_complete_backup(&root, &first_archive, "0.5.3").unwrap();
        write_database(
            &second_source.join(DB_FILES[0]),
            "second explicitly requested row",
        );
        let second_archive = elsewhere.join("second.hfdbackup");
        write_complete_backup(&second_source, &second_archive, "0.5.3").unwrap();
        write_database(&root.join(DB_FILES[0]), "current original row");
        stage_complete_restore_in(&root, &first_archive, "0.5.3").unwrap();
        let mut staged_db_lock = None;
        let _ = apply_pending_restore_in_with(&root, || {
            staged_db_lock = Some(
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(root.join(RESTORE_PENDING_DIR).join(DB_FILES[0]))
                    .unwrap(),
            );
            Err("injected first install failure".into())
        })
        .unwrap_err();
        drop(staged_db_lock);
        let old_id = read_journal(&root).unwrap().unwrap().operation_id;
        let held_journal = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(root.join(RESTORE_JOURNAL_FILE))
            .unwrap();
        let stage_result = stage_complete_restore_in(&root, &second_archive, "0.5.3");
        let new_id = if root.join(RESTORE_PENDING_DIR).join(RESTORE_PLAN).exists() {
            read_restore_plan(&root.join(RESTORE_PENDING_DIR)).operation_id
        } else {
            String::new()
        };
        let accepted = stage_result.is_ok();
        drop(held_journal);
        let decision = handle_startup_restore_in(&root).unwrap();
        let value = database_contents(&root.join(DB_FILES[0]));
        let pending_left = root.join(RESTORE_PENDING_DIR).exists();
        println!("ROUND2_NEW_STAGE: accepted={accepted}; old_id={old_id}; new_id={new_id}; decision={decision:?}; pending_left={pending_left}; row={value}");
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        std::fs::remove_dir_all(&second_source).unwrap();
        assert!(
            !accepted || value == "second explicitly requested row" || pending_left,
            "An old terminal operation must not silently delete an accepted new restore"
        );
    }

    #[test]
    fn round2_unidentified_regular_destination_is_not_deleted() {
        let root = scratch("round2-unidentified-db");
        write_database(&root.join(DB_FILES[0]), "unrelated replacement dataset");
        let unknown_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());
        let rollback = root.join("backups/before-restore-unidentified");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "protected original dataset");
        let mut journal = RestoreJournal::new("backups/before-restore-unidentified".into(), false);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.installed_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let preserved = [root.join(DB_FILES[0]), rollback.join(DB_FILES[0])]
            .iter()
            .any(|p| p.is_file() && sha256_digest(&std::fs::read(p).unwrap()) == unknown_hash);
        println!(
            "ROUND2_UNKNOWN_DB: decision={decision:?}; unrelated_database_preserved={preserved}"
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(preserved, "A filename and presence of a rollback file cannot establish that the active file is disposable staged data");
    }

    #[cfg(windows)]
    fn round2_make_junction(link: &Path, target: &Path) {
        let quote = |path: &Path| path.to_string_lossy().replace('\'', "''");
        let script = format!("$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null", quote(link), quote(target));
        let out = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "Could not create disposable junction: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_dangling_journal_is_not_treated_as_absent() {
        let root = scratch("round2-dangling-journal");
        let elsewhere = scratch("round2-dangling-journal-out");
        let target = elsewhere.join("empty-target");
        std::fs::create_dir(&target).unwrap();
        round2_make_junction(&root.join(RESTORE_JOURNAL_FILE), &target);
        std::fs::remove_dir(&target).unwrap();
        assert!(std::fs::symlink_metadata(root.join(RESTORE_JOURNAL_FILE)).is_ok());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        let decision = handle_startup_restore_in(&root).unwrap();
        println!("ROUND2_DANGLING_JOURNAL: decision={decision:?}");
        std::fs::remove_dir(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A dangling reparse point at the journal path is not absent state"
        );
    }

    #[cfg(windows)]
    #[test]
    fn round2_linked_recovery_documents_do_not_enter_active_storage() {
        let root = scratch("round2-linked-documents");
        let elsewhere = scratch("round2-linked-documents-out");
        write_document(&elsewhere, "external.txt", "external document sentinel");
        let rollback = root.join("backups/before-restore-linked-docs");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "protected original dataset");
        round2_make_junction(
            &rollback.join(DOCUMENTS_DIR),
            &elsewhere.join(DOCUMENTS_DIR),
        );
        let mut journal = RestoreJournal::new("backups/before-restore-linked-docs".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let active_link = root.join(DOCUMENTS_DIR).exists();
        let external_read = document_contents(&root, "external.txt");
        println!("ROUND2_LINKED_DOCS: decision={decision:?}; active_docs_exist={active_link}; external_read_from_active={external_read:?}");
        assert_eq!(
            document_contents(&elsewhere, "external.txt").as_deref(),
            Some("external document sentinel")
        );
        if root.join(DOCUMENTS_DIR).exists() {
            std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        }
        if rollback.join(DOCUMENTS_DIR).exists() {
            std::fs::remove_dir(rollback.join(DOCUMENTS_DIR)).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A linked original artifact must be rejected before it is moved into active storage"
        );
        assert!(!active_link);
    }

    #[cfg(windows)]
    #[test]
    fn round2_linked_recovery_database_directory_does_not_enter_active_storage() {
        let root = scratch("round2-linked-db");
        let elsewhere = scratch("round2-linked-db-out");
        let target = elsewhere.join("target_dir");
        std::fs::create_dir_all(&target).unwrap();
        let rollback = root.join("backups/before-restore-linked-db");
        std::fs::create_dir_all(&rollback).unwrap();
        round2_make_junction(&rollback.join(DB_FILES[0]), &target);
        let mut journal = RestoreJournal::new("backups/before-restore-linked-db".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files.push(DB_FILES[0].into());
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let active_exists = root.join(DB_FILES[0]).exists();
        if rollback.join(DB_FILES[0]).exists() {
            let _ = std::fs::remove_dir(rollback.join(DB_FILES[0]));
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&elsewhere).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Linked database path must be rejected"
        );
        assert!(!active_exists);
    }

    #[test]
    fn unidentified_document_and_sidecar_are_not_deleted() {
        let root = scratch("unidentified-doc-sidecar");
        write_database(&root.join(DB_FILES[0]), "active database");
        write_document(&root, "unrelated.pdf", "unrelated active document");
        let unknown_doc_hash =
            sha256_digest(&std::fs::read(root.join(DOCUMENTS_DIR).join("unrelated.pdf")).unwrap());
        std::fs::write(root.join(DB_FILES[1]), b"unrelated active WAL raw bytes").unwrap();
        let unknown_wal_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap());

        let rollback = root.join("backups/before-restore-doc-sidecar");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original protected db");
        write_document(&rollback, "original.pdf", "original document");

        let mut journal = RestoreJournal::new("backups/before-restore-doc-sidecar".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files.push(DB_FILES[0].into());
        journal.protected_documents = true;
        journal.installed_db_files.push(DB_FILES[0].into());
        journal.installed_db_files.push(DB_FILES[1].into());
        journal.installed_documents = true;
        // Notice: staged_db_artifacts does NOT contain the hash of root's DB_FILES[1]
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        // The unrelated WAL must not be deleted because it is unidentified!
        assert!(
            root.join(DB_FILES[1]).is_file()
                && sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap())
                    == unknown_wal_hash,
            "Unidentified WAL must be preserved"
        );
        // The unrelated document must also be preserved!
        assert!(
            root.join(DOCUMENTS_DIR).join("unrelated.pdf").is_file()
                && sha256_digest(
                    &std::fs::read(root.join(DOCUMENTS_DIR).join("unrelated.pdf")).unwrap()
                ) == unknown_doc_hash,
            "Unidentified document must be preserved"
        );
        // And startup must block on unresolved state rather than claiming full clean recovery
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unidentified sidecar must halt recovery with BlockedUnresolved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn matrix_interrupted_original_return_preserves_already_returned_files() {
        let source = scratch("matrix-source");
        let root = scratch("matrix-interrupted-return");
        write_database(&source.join(DB_FILES[0]), "checkpointed db");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original persistent database'",
            [],
        )
        .unwrap();
        assert!(source.join(DB_FILES[1]).is_file());
        // Put DB_FILES[0] in root (as if it has already returned)
        std::fs::copy(source.join(DB_FILES[0]), root.join(DB_FILES[0])).unwrap();
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        // Put DB_FILES[1] in rollback (still pending return)
        let rollback = root.join("backups/before-restore-matrix-return");
        std::fs::create_dir_all(&rollback).unwrap();
        std::fs::copy(source.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();
        let orig_wal_hash = sha256_digest(&std::fs::read(rollback.join(DB_FILES[1])).unwrap());
        drop(conn);

        let orig_ident_db = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: orig_hash.clone(),
            size: std::fs::metadata(root.join(DB_FILES[0])).unwrap().len(),
        };
        let orig_ident_wal = ArtifactIdentity {
            name: DB_FILES[1].to_string(),
            sha256: orig_wal_hash.clone(),
            size: std::fs::metadata(rollback.join(DB_FILES[1])).unwrap().len(),
        };

        let mut journal = RestoreJournal::new("backups/before-restore-matrix-return".into(), false);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].to_string(), DB_FILES[1].to_string()];
        journal.original_db_artifacts = vec![orig_ident_db, orig_ident_wal];
        write_journal(&root, &journal).unwrap();

        // Rerunning rollback on startup must detect that DB_FILES[0] matches the original identity,
        // preserve it, move DB_FILES[1] from rollback, and complete recovery safely!
        let decision = handle_startup_restore_in(&root).unwrap();
        match decision {
            StartupRestoreDecision::RolledBackRecovered { .. } => {}
            other => panic!("Expected RolledBackRecovered, got {other:?}"),
        }
        assert!(root.join(DB_FILES[1]).is_file());
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[1])).unwrap()),
            orig_wal_hash
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original persistent database"
        );
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
    }

    #[test]
    fn matrix_missing_original_artifact_blocks_recovery_even_if_same_named_file_exists() {
        let root = scratch("matrix-missing-original");
        let rollback = root.join("backups/before-restore-missing-original");
        std::fs::create_dir_all(&rollback).unwrap();
        // The rollback folder has a file with the right name, but DIFFERENT content than expected!
        write_database(&rollback.join(DB_FILES[0]), "corrupted or altered db");

        let orig_ident = ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
            size: 100,
        };

        let mut journal =
            RestoreJournal::new("backups/before-restore-missing-original".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].to_string()];
        journal.original_db_artifacts = vec![orig_ident];
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Hash mismatch on original artifact must block recovery"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn matrix_journal_unreadable_or_corrupt_phase_blocks_conservatively() {
        let root = scratch("matrix-corrupt-journal");
        let rollback = root.join("backups/before-restore-corrupt");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "precious database");

        std::fs::write(
            root.join(RESTORE_JOURNAL_FILE),
            br#"{"phase": "NonExistentPhase"}"#,
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unknown phase in journal must block startup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn round3_identity(path: &Path, name: &str) -> ArtifactIdentity {
        let bytes = std::fs::read(path).unwrap();
        ArtifactIdentity {
            name: name.into(),
            sha256: sha256_digest(&bytes),
            size: bytes.len() as u64,
        }
    }

    #[test]
    fn round3_changed_original_document_cannot_be_reported_recovered() {
        let root = scratch("round3-changed-original-doc");
        let rollback = root.join("backups/before-restore-round3-changed");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "original.pdf", "original document bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-changed".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("original.pdf"),
            b"altered document bytes!",
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let recovered_bytes = document_contents(&root, "original.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Must reject changed original document identity: {decision:?}, active={recovered_bytes:?}, journal_retained={journal_retained}");
    }

    #[test]
    fn round3_missing_original_document_cannot_be_reported_recovered() {
        let root = scratch("round3-missing-original-doc");
        let rollback = root.join("backups/before-restore-round3-missing");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "original.pdf", "original document bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-missing".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();
        std::fs::remove_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let original_missing = !root.join(DOCUMENTS_DIR).join("original.pdf").exists();
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Must reject missing original documents: {decision:?}, missing={original_missing}, journal_retained={journal_retained}");
    }

    #[test]
    fn round3_original_document_absence_must_not_leave_selected_documents() {
        let root = scratch("round3-original-doc-absence");
        let rollback = root.join("backups/before-restore-round3-absence");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original row without documents");
        let mut journal = RestoreJournal::new("backups/before-restore-round3-absence".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::write(
            root.join(DOCUMENTS_DIR).join("selected.pdf"),
            b"selected backup document",
        )
        .unwrap();
        journal.staged_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        journal.installed_documents = true;
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let selected_left = root.join(DOCUMENTS_DIR).join("selected.pdf").exists();
        let original_row = database_contents(&root.join(DB_FILES[0]));
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }) || !selected_left,
            "Cannot accept a mixture of returned original DB and selected documents: {decision:?}, selected_left={selected_left}, row={original_row}");
    }

    #[cfg(windows)]
    #[test]
    fn round3_active_document_junction_cannot_be_accepted_as_returned_original() {
        let root = scratch("round3-active-doc-junction");
        let external = scratch("round3-external-docs");
        let rollback = root.join("backups/before-restore-round3-junction");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "returned original row");
        write_document(&external, "original.pdf", "external sentinel");
        let mut journal =
            RestoreJournal::new("backups/before-restore-round3-junction".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_documents = true;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&external.join(DOCUMENTS_DIR)).unwrap();
        round2_make_junction(&root.join(DOCUMENTS_DIR), &external.join(DOCUMENTS_DIR));
        write_journal(&root, &journal).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let linked_active =
            is_symlink_or_reparse(&std::fs::symlink_metadata(root.join(DOCUMENTS_DIR)).unwrap());
        let external_bytes = document_contents(&external, "original.pdf");
        std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Active document junction must halt startup: {decision:?}, linked_active={linked_active}, external={external_bytes:?}");
    }

    #[test]
    fn round3_unknown_pending_owner_must_not_be_deleted_by_terminal_cleanup() {
        let root = scratch("round3-unknown-pending-owner");
        write_database(&root.join(DB_FILES[0]), "installed row");
        let rollback = root.join("backups/before-restore-round3-terminal");
        std::fs::create_dir_all(&rollback).unwrap();
        let mut journal =
            RestoreJournal::new("backups/before-restore-round3-terminal".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "known-terminal-owner".into();
        write_journal(&root, &journal).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "unidentified pending row");
        std::fs::write(pending.join(RESTORE_PLAN), b"{ corrupted ownership record").unwrap();
        let identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        let decision = handle_startup_restore_in(&root).unwrap();
        let pending_preserved = pending.join(DB_FILES[0]).is_file()
            && round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == identity;
        std::fs::remove_dir_all(&root).unwrap();
        assert!(pending_preserved,
            "Unknown ownership must not authorize deletion: {decision:?}, pending_preserved={pending_preserved}");
    }

    // =========================================================================
    // Task 1: Enforce original document identity and completeness
    // =========================================================================

    #[test]
    fn task1_missing_single_document_in_populated_dir_blocks() {
        let root = scratch("task1-missing-single-doc");
        let rollback = root.join("backups/before-restore-t1-single");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "doc1.pdf", "doc 1 bytes");
        write_document(&rollback, "doc2.pdf", "doc 2 bytes");
        let mut journal = RestoreJournal::new("backups/before-restore-t1-single".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Simulate single missing document in rollback
        std::fs::remove_file(rollback.join(DOCUMENTS_DIR).join("doc2.pdf")).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Missing single document in populated directory must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_changed_same_size_document_bytes_blocks() {
        let root = scratch("task1-changed-same-size");
        let rollback = root.join("backups/before-restore-t1-samesize");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "doc.pdf", "AAAA");
        let mut journal = RestoreJournal::new("backups/before-restore-t1-samesize".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Alter bytes with SAME size
        std::fs::write(rollback.join(DOCUMENTS_DIR).join("doc.pdf"), b"BBBB").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Changed same-size document bytes must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_nested_document_paths_verified() {
        let root = scratch("task1-nested-doc-paths");
        let rollback = root.join("backups/before-restore-t1-nested");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        let sub = rollback.join(DOCUMENTS_DIR).join("curriculum/phase1");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("lesson.pdf"), b"lesson bytes in nested path").unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t1-nested".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Nested document paths must be recovered and verified: {decision:?}"
        );
        let active_nested = root
            .join(DOCUMENTS_DIR)
            .join("curriculum/phase1/lesson.pdf");
        assert!(active_nested.is_file());
        assert_eq!(
            std::fs::read(active_nested).unwrap(),
            b"lesson bytes in nested path"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_missing_entire_document_directory_blocks() {
        let root = scratch("task1-missing-entire-docs-dir");
        let rollback = root.join("backups/before-restore-t1-nodir");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original row");
        write_document(&rollback, "test.pdf", "test content");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-nodir".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Remove entire documents directory in rollback
        std::fs::remove_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Missing entire original documents directory must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_interrupted_return_after_directory_rename_resumes_cleanly() {
        let root = scratch("task1-interrupted-after-rename");
        let rollback = root.join("backups/before-restore-t1-interrupted");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original row in active root");
        write_document(&root, "manual.pdf", "original manual content");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-interrupted".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // Rollback already has docs moved to root. Next startup must recognize all original files are back and succeed!
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Interrupted return with all originals in place must complete recovery cleanly: {decision:?}");
        assert!(root.join(DOCUMENTS_DIR).join("manual.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_repeated_startup_after_clearing_obstruction_succeeds() {
        let root = scratch("task1-repeated-startup-obstruction");
        let rollback = root.join("backups/before-restore-t1-obstruct");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original precious row");
        write_document(&rollback, "guide.pdf", "original guide bytes");

        // Obstruct active root
        write_database(&root.join(DB_FILES[0]), "obstruction row");

        let mut journal = RestoreJournal::new("backups/before-restore-t1-obstruct".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        write_journal(&root, &journal).unwrap();

        // First launch: blocked due to obstruction
        let decision1 = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision1,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        // Clear obstruction
        std::fs::remove_file(root.join(DB_FILES[0])).unwrap();

        // Second launch: succeeds cleanly!
        let decision2 = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(
                decision2,
                StartupRestoreDecision::RolledBackRecovered { .. }
            ),
            "Second launch after clearing obstruction must succeed: {decision2:?}"
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original precious row"
        );
        assert!(root.join(DOCUMENTS_DIR).join("guide.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 2: Handle original document absence without mixing datasets
    // =========================================================================

    #[test]
    fn task2_original_document_absence_uninstalls_selected_documents() {
        let root = scratch("task2-absence-uninstalls-selected");
        let rollback = root.join("backups/before-restore-t2-absence");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db without docs");

        // Staged document installed in root
        write_document(
            &root,
            "staged_selected.pdf",
            "staged selected document bytes",
        );
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-absence".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = false; // Original had NO documents
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover to original absence: {decision:?}"
        );
        assert!(
            !root.join(DOCUMENTS_DIR).exists(),
            "Documents directory must be removed to restore absence"
        );
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original db without docs"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_original_empty_document_dir_restored() {
        let root = scratch("task2-empty-dir-restored");
        let rollback = root.join("backups/before-restore-t2-empty");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db with empty docs");

        write_document(
            &root,
            "staged_selected.pdf",
            "staged selected document bytes",
        );
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-empty".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true; // Original HAD an empty documents directory
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover to original empty directory: {decision:?}"
        );
        assert!(
            root.join(DOCUMENTS_DIR).is_dir(),
            "Documents directory must exist"
        );
        assert!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR))
                .unwrap()
                .is_empty(),
            "Documents directory must be empty"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_original_populated_document_dir_restored() {
        let root = scratch("task2-populated-dir-restored");
        let rollback = root.join("backups/before-restore-t2-populated");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");
        write_document(&rollback, "orig1.pdf", "orig 1");
        write_document(&rollback, "orig2.pdf", "orig 2");

        write_document(&root, "staged1.pdf", "staged 1");
        let staged_ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-t2-populated".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.protected_documents = true;
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Must cleanly recover populated original documents: {decision:?}"
        );
        assert!(root.join(DOCUMENTS_DIR).join("orig1.pdf").is_file());
        assert!(root.join(DOCUMENTS_DIR).join("orig2.pdf").is_file());
        assert!(!root.join(DOCUMENTS_DIR).join("staged1.pdf").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_unrelated_active_document_preserved_and_blocks() {
        let root = scratch("task2-unrelated-doc-preserved");
        let rollback = root.join("backups/before-restore-t2-unrelated");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");

        write_document(&root, "staged1.pdf", "staged 1");
        write_document(&root, "unrelated_user_doc.pdf", "do not delete me!");
        let staged_ident = vec![round3_identity(
            &root.join(DOCUMENTS_DIR).join("staged1.pdf"),
            "staged1.pdf",
        )];

        let mut journal = RestoreJournal::new("backups/before-restore-t2-unrelated".into(), true);
        journal.phase = RestorePhase::Activating;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.installed_documents = true;
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.staged_document_artifacts = staged_ident;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unrelated active document must block recovery: {decision:?}"
        );
        assert!(
            root.join(DOCUMENTS_DIR)
                .join("unrelated_user_doc.pdf")
                .is_file(),
            "Unrelated document must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_overlapping_document_content_survives() {
        let root = scratch("task2-overlapping-doc");
        let rollback = root.join("backups/before-restore-t2-overlap");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(
            &root,
            "shared.pdf",
            "identical content in both original and staged",
        );

        let ident = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-t2-overlap".into(), true);
        journal.phase = RestorePhase::RollingBack;
        journal.original_db_artifacts = vec![round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = ident.clone();
        journal.staged_document_artifacts = ident;
        journal.installed_documents = true;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Overlapping document must not be deleted: {decision:?}"
        );
        assert!(root.join(DOCUMENTS_DIR).join("shared.pdf").is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 3: Fallible and no-follow inspection across the entire dataset
    // =========================================================================

    #[cfg(windows)]
    #[test]
    fn task3_linked_inventory_root_rejected() {
        let root = scratch("task3-linked-root");
        let external = scratch("task3-external-target");
        write_document(&external, "test.pdf", "external content");
        round2_make_junction(&root.join(DOCUMENTS_DIR), &external.join(DOCUMENTS_DIR));

        let res = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR));
        assert!(
            res.is_err(),
            "inventory_directory_artifacts must reject a junction as root"
        );
        std::fs::remove_dir(root.join(DOCUMENTS_DIR)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task3_linked_nested_child_rejected() {
        let root = scratch("task3-linked-child");
        let external = scratch("task3-external-child-target");
        let docs = root.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&docs).unwrap();
        write_document(&external, "nested.pdf", "external nested content");
        round2_make_junction(&docs.join("nested_junction"), &external.join(DOCUMENTS_DIR));

        let res = inventory_directory_artifacts(&docs);
        assert!(
            res.is_err(),
            "inventory_directory_artifacts must reject a nested junction"
        );
        std::fs::remove_dir(docs.join("nested_junction")).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task3_active_db_link_rejected() {
        let root = scratch("task3-linked-db");
        let external = scratch("task3-external-db");
        write_database(&external.join(DB_FILES[0]), "external db");

        let rollback = root.join("backups/before-restore-t3-db");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original precious db");

        let mut journal = RestoreJournal::new("backups/before-restore-t3-db".into(), false);
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        write_journal(&root, &journal).unwrap();

        // Make root.join(DB_FILES[0]) a junction pointing to directory external
        round2_make_junction(&root.join(DB_FILES[0]), &external);

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Active DB link must block recovery: {decision:?}"
        );
        std::fs::remove_dir(root.join(DB_FILES[0])).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[test]
    fn task3_journal_invalid_inventory_names_rejected() {
        let root = scratch("task3-invalid-journal-names");
        let mut journal = RestoreJournal::new("backups/before-restore-t3-invalid".into(), true);
        journal.phase = RestorePhase::Protected;
        // Inject traversal in document inventory
        journal.original_document_artifacts.push(ArtifactIdentity {
            name: "../traversal.pdf".into(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".into(),
            size: 10,
        });

        let validation_res = journal.validate(&root);
        assert!(
            validation_res.is_err(),
            "Traversal in document inventory must be rejected by validate"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 4: Strict pending deletion ownership
    // =========================================================================

    #[test]
    fn task4_terminal_cleanup_matching_id_committed() {
        let root = scratch("task4-matching-committed");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-matching-123".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-matching-123".into(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(
            !pending.exists(),
            "Pending directory with matching ID must be cleaned up"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted after cleanup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_matching_id_rolled_back() {
        let root = scratch("task4-matching-rolledback");
        write_database(&root.join(DB_FILES[0]), "recovered active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match-rb".into(), false);
        journal.phase = RestorePhase::RolledBack;
        journal.operation_id = "op-match-rb-456".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-match-rb-456".into(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::RolledBackRecovered { .. }
        ));
        assert!(
            !pending.exists(),
            "Pending directory with matching ID must be cleaned up"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted after cleanup"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_mismatched_id_refuses_deletion() {
        let root = scratch("task4-mismatched-id");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-mismatch".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-journal-789".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db from other op");
        let plan = RestorePlan {
            operation_id: "op-OTHER-different".into(),
            kind: RestoreKind::Complete,
            source: "backup2.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Mismatched operation ID must block and refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_corrupted_plan_refuses_deletion() {
        let root = scratch("task4-corrupt-plan-refuses");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-corrupt".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-modern-with-id".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db with corrupted plan");
        std::fs::write(pending.join(RESTORE_PLAN), b"{ corrupted json").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Corrupted plan with modern journal must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_empty_id_refuses_deletion() {
        let root = scratch("task4-empty-id-refuses");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-empty-id".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-modern-with-id".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db with empty id");
        let plan = RestorePlan {
            operation_id: String::new(),
            kind: RestoreKind::Complete,
            source: "backup.zip".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Empty plan ID with modern journal must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).is_file(),
            "Pending db must be preserved"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_terminal_cleanup_genuine_legacy_state() {
        let root = scratch("task4-legacy-cleanup");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-legacy".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = String::new(); // Legacy journal without operation_id
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "legacy staged db");
        // No plan in legacy pending either

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(
            !pending.exists(),
            "Legacy pending without plan must be cleaned up by legacy journal"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 5: Deterministic Fault Injection Matrix
    // =========================================================================

    #[test]
    fn task5_matrix_journal_temp_create_fault() {
        let root = scratch("task5-fault-temp-create");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalTempCreate);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Temp create fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_write_fault() {
        let root = scratch("task5-fault-write");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalWrite);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Write fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_sync_fault() {
        let root = scratch("task5-fault-sync");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalSync);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Sync fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_rename_fault() {
        let root = scratch("task5-fault-rename");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        let _guard = ScopedFault::set(InjectedFault::JournalRename);

        let res = write_journal(&root, &journal);
        assert!(res.is_err(), "Rename fault must fail write_journal");
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_journal_delete_fault() {
        let root = scratch("task5-fault-delete");
        let journal = RestoreJournal::new("backups/before-restore-fault".into(), false);
        write_journal(&root, &journal).unwrap();
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());

        let _guard = ScopedFault::set(InjectedFault::JournalDelete);
        let res = remove_journal(&root);
        assert!(res.is_err(), "Delete fault must fail remove_journal");
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must remain on delete failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_unreadable_journal_file_blocks_startup() {
        let root = scratch("task5-unreadable-journal");
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), b"not valid json").unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unreadable journal file must block startup: {decision:?}"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Unreadable journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_protect_move_fault_conserves_original_data() {
        let root = scratch("task5-fault-protect-move");
        write_database(&root.join(DB_FILES[0]), "original uncorrupted database");
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged new database");

        let _guard = ScopedFault::set(InjectedFault::ProtectDbRename(0));
        let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
        assert!(
            matches!(res, RestoreApplicationResult::RefusedUnchanged(_)),
            "Failure during protect move must result in RefusedUnchanged: {res:?}"
        );
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash,
            "Original database must remain intact after protect failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_install_move_fault_triggers_clean_rollback() {
        let root = scratch("task5-fault-install-move");
        write_database(
            &root.join(DB_FILES[0]),
            "original database before install failure",
        );
        let orig_hash = sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap());

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged new database");

        let _guard = ScopedFault::set(InjectedFault::InstallDbRename(0));
        let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
        assert!(
            matches!(res, RestoreApplicationResult::Recovered(_)),
            "Failure during install move must trigger successful recovery rollback: {res:?}"
        );
        assert_eq!(
            sha256_digest(&std::fs::read(root.join(DB_FILES[0])).unwrap()),
            orig_hash,
            "Original database must be restored after install failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_matrix_return_move_fault_conserves_all_files() {
        let root = scratch("task5-fault-return-move");
        let rollback = root.join("backups/before-restore-return-fault");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original database in rollback");

        let mut journal = RestoreJournal::new("backups/before-restore-return-fault".into(), false);
        journal.phase = RestorePhase::RollingBack;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        write_journal(&root, &journal).unwrap();

        let _guard = ScopedFault::set(InjectedFault::ReturnDbRename(0));
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Failure during return move must block startup: {decision:?}"
        );
        assert!(
            rollback.join(DB_FILES[0]).is_file(),
            "Original file must be preserved in rollback"
        );
        assert!(
            root.join(RESTORE_JOURNAL_FILE).is_file(),
            "Journal must be retained"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Round 4: Ported Regressions & Verified Fixes
    // =========================================================================

    #[test]
    fn round4_modern_terminal_missing_plan_preserves_unknown_pending() {
        let mut results = Vec::new();
        for phase in [RestorePhase::Committed, RestorePhase::RolledBack] {
            let root = scratch(&format!("round4-missing-plan-{phase:?}"));
            write_database(&root.join(DB_FILES[0]), "active original row");
            let mut journal =
                RestoreJournal::new("backups/before-restore-round4-missing-plan".into(), false);
            journal.phase = phase.clone();
            journal.operation_id = "known-modern-terminal-owner".into();
            write_journal(&root, &journal).unwrap();
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "unknown pending row");
            let original_pending = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
            assert!(!pending.join(RESTORE_PLAN).exists());
            let decision = handle_startup_restore_in(&root).unwrap();
            let preserved = pending.join(DB_FILES[0]).is_file()
                && round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == original_pending;
            results.push(format!(
                "phase={phase:?}, decision={decision:?}, pending_preserved={preserved}"
            ));
            std::fs::remove_dir_all(&root).unwrap();
        }
        assert!(
            results
                .iter()
                .all(|r| r.ends_with("pending_preserved=true")),
            "Missing plan does not establish modern deletion ownership: {results:?}"
        );
    }

    #[test]
    fn round4_empty_original_manifest_rejects_unidentified_document() {
        let root = scratch("round4-empty-original-manifest");
        let rollback = root.join("backups/before-restore-round4-empty");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(
            &rollback.join(DB_FILES[0]),
            "original row with empty document directory",
        );
        let mut journal = RestoreJournal::new("backups/before-restore-round4-empty".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentEmpty);
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts =
            inventory_directory_artifacts(&rollback.join(DOCUMENTS_DIR)).unwrap();
        assert!(journal.original_document_artifacts.is_empty());
        write_journal(&root, &journal).unwrap();
        // The formerly empty original directory now has content not in its recorded inventory.
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("unidentified.pdf"),
            b"unidentified document sentinel",
        )
        .unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let accepted_unknown = document_contents(&root, "unidentified.pdf");
        let journal_retained = root.join(RESTORE_JOURNAL_FILE).exists();
        std::fs::remove_dir_all(&root).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "A known-empty manifest must not disable complete-set verification: {decision:?}, active={accepted_unknown:?}, journal_retained={journal_retained}");
    }

    #[test]
    fn round4_document_protection_failure_recovers_on_next_launch() {
        let root = scratch("round4-protect-doc-failure");
        write_database(&root.join(DB_FILES[0]), "original protected row");
        write_document(&root, "original.pdf", "original protected document");
        let db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let doc_identity = round3_identity(
            &root.join(DOCUMENTS_DIR).join("original.pdf"),
            "original.pdf",
        );
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected backup row");
        write_document(&pending, "selected.pdf", "selected backup document");
        write_restore_plan(
            &pending,
            RestoreKind::Complete,
            "synthetic selected archive",
        )
        .unwrap();
        let first = {
            let _guard = ScopedFault::set(InjectedFault::ProtectDocsRename);
            apply_pending_restore_in_internal(&root, || Ok(())).unwrap()
        };
        let fault_observed =
            format!("{first:?}").contains("Injected test fault: ProtectDocsRename");
        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        let originals_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == db_identity
            && root.join(DOCUMENTS_DIR).join("original.pdf").is_file()
            && round3_identity(
                &root.join(DOCUMENTS_DIR).join("original.pdf"),
                "original.pdf",
            ) == doc_identity;
        let resolved = matches!(
            second,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        ) && matches!(
            third,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        );
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            fault_observed,
            "Fixture must exercise the document protection fault: {first:?}"
        );
        assert!(resolved && originals_preserved,
            "A cleared document protection failure must recover the conserved original dataset: first={first:?}, second={second:?}, third={third:?}, preserved={originals_preserved}");
    }

    #[cfg(windows)]
    #[test]
    fn round4_linked_pending_root_must_not_move_external_data() {
        let root = scratch("round4-linked-pending-root");
        let external = scratch("round4-external-pending-target");
        write_database(&root.join(DB_FILES[0]), "original active row");
        write_document(&root, "original.pdf", "original active document");
        let active_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        write_database(&external.join(DB_FILES[0]), "external sentinel row");
        write_document(&external, "external.pdf", "external document sentinel");
        write_restore_plan(
            &external,
            RestoreKind::Complete,
            "synthetic external ownership plan",
        )
        .unwrap();
        let external_db_identity = round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]);
        let pending = root.join(RESTORE_PENDING_DIR);
        round2_make_junction(&pending, &external);
        let decision = handle_startup_restore_in(&root).unwrap();
        let external_db_preserved = external.join(DB_FILES[0]).is_file()
            && round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]) == external_db_identity;
        let external_docs_preserved = document_contents(&external, "external.pdf")
            == Some("external document sentinel".into());
        let active_db_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db_identity;
        let active_row = if root.join(DB_FILES[0]).is_file() {
            Some(database_contents(&root.join(DB_FILES[0])))
        } else {
            None
        };
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_dir(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. })
            && external_db_preserved && external_docs_preserved && active_db_preserved,
            "Linked staging must be refused before following/moving external files: {decision:?}, external_db_preserved={external_db_preserved}, external_docs_preserved={external_docs_preserved}, active_db_preserved={active_db_preserved}, active_row={active_row:?}");
    }

    #[cfg(unix)]
    #[test]
    fn round4_linked_pending_root_must_not_move_external_data_unix() {
        let root = scratch("round4-linked-pending-root-unix");
        let external = scratch("round4-external-pending-target-unix");
        write_database(&root.join(DB_FILES[0]), "original active row");
        write_document(&root, "original.pdf", "original active document");
        let active_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        write_database(&external.join(DB_FILES[0]), "external sentinel row");
        write_document(&external, "external.pdf", "external document sentinel");
        write_restore_plan(
            &external,
            RestoreKind::Complete,
            "synthetic external ownership plan",
        )
        .unwrap();
        let external_db_identity = round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]);
        let pending = root.join(RESTORE_PENDING_DIR);
        std::os::unix::fs::symlink(&external, &pending).unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        let external_db_preserved = external.join(DB_FILES[0]).is_file()
            && round3_identity(&external.join(DB_FILES[0]), DB_FILES[0]) == external_db_identity;
        let external_docs_preserved = document_contents(&external, "external.pdf")
            == Some("external document sentinel".into());
        let active_db_preserved = root.join(DB_FILES[0]).is_file()
            && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db_identity;
        let active_row = if root.join(DB_FILES[0]).is_file() {
            Some(database_contents(&root.join(DB_FILES[0])))
        } else {
            None
        };
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_file(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. })
                && external_db_preserved
                && external_docs_preserved
                && active_db_preserved
                && active_row.as_deref() == Some("original active row"),
            "Linked staging must be refused before following/moving external files: {decision:?}, active_row={active_row:?}"
        );
    }

    // =========================================================================
    // Task 1: Staging/Pending Root Authorization
    // =========================================================================

    #[cfg(windows)]
    #[test]
    fn task1_linked_pending_root_without_documents() {
        let root = scratch("task1-linked-pending-no-docs");
        let external = scratch("task1-ext-no-docs");
        write_database(&root.join(DB_FILES[0]), "active row");
        write_database(&external.join(DB_FILES[0]), "ext row");
        write_restore_plan(&external, RestoreKind::Database, "db only").unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        round2_make_junction(&pending, &external);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(external.join(DB_FILES[0]).is_file());
        if std::fs::symlink_metadata(&pending).is_ok() {
            std::fs::remove_dir(&pending).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task1_linked_staging_root_refuses_staging() {
        let root = scratch("task1-linked-staging");
        let external = scratch("task1-ext-staging");
        let staging = root.join(RESTORE_STAGING_DIR);
        round2_make_junction(&staging, &external);
        let res = fresh_staging(&root);
        assert!(
            res.is_err(),
            "fresh_staging must refuse linked staging directory"
        );
        assert!(format!("{res:?}").contains("unsafe symlink or reparse point"));
        if std::fs::symlink_metadata(&staging).is_ok() {
            std::fs::remove_dir(&staging).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&external).unwrap();
    }

    #[test]
    fn task1_invalid_directory_type_pending_refuses_activation() {
        let root = scratch("task1-file-as-pending");
        write_database(&root.join(DB_FILES[0]), "active row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::write(&pending, b"not a directory").unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task1_ordinary_valid_pending_activation_succeeds() {
        let root = scratch("task1-valid-pending");
        write_database(&root.join(DB_FILES[0]), "old active row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "new restored row");
        write_restore_plan(&pending, RestoreKind::Database, "test archive").unwrap();
        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "new restored row"
        );
        assert!(!pending.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 2: Reconcile Unmoved Original Documents
    // =========================================================================

    #[test]
    fn task2_protection_failure_with_empty_documents_recovers() {
        let root = scratch("task2-protect-empty-docs");
        write_database(&root.join(DB_FILES[0]), "active db row");
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let db_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected row");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let first = {
            let _guard = ScopedFault::set(InjectedFault::ProtectDocsRename);
            apply_pending_restore_in_internal(&root, || Ok(())).unwrap()
        };
        assert!(format!("{first:?}").contains("Injected test fault: ProtectDocsRename"));
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            second,
            StartupRestoreDecision::RolledBackRecovered { .. }
                | StartupRestoreDecision::ProceedNormally
        ));
        assert_eq!(round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]), db_id);
        assert!(root.join(DOCUMENTS_DIR).is_dir());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task2_protection_failure_with_active_documents_modified_blocks() {
        let root = scratch("task2-protect-mod-docs");
        let rollback = root.join("backups/before-restore-t2-tamper");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db in rollback");
        write_document(&root, "orig.pdf", "tampered content");

        let mut journal = RestoreJournal::new("backups/before-restore-t2-tamper".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = vec![ArtifactIdentity {
            name: "orig.pdf".into(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".into(),
            size: 16,
        }];
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Modified active original document must block recovery: {decision:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 3: Known-Empty Manifest Enforces Empty Set
    // =========================================================================

    #[test]
    fn task3_empty_manifest_with_nested_unexpected_file_blocks() {
        let root = scratch("task3-empty-nested-blocks");
        let rollback = root.join("backups/before-restore-t3-nested");
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR)).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "original db");
        let mut journal = RestoreJournal::new("backups/before-restore-t3-nested".into(), true);
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_documents_presence = Some(OriginalDocumentsPresence::PresentEmpty);
        journal.protected_db_files = vec![DB_FILES[0].into()];
        journal.original_db_artifacts =
            vec![round3_identity(&rollback.join(DB_FILES[0]), DB_FILES[0])];
        journal.original_document_artifacts = vec![];
        write_journal(&root, &journal).unwrap();

        // Introduce nested unexpected file
        std::fs::create_dir_all(rollback.join(DOCUMENTS_DIR).join("subdir")).unwrap();
        std::fs::write(
            rollback.join(DOCUMENTS_DIR).join("subdir/nested.pdf"),
            b"unexpected nested",
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 4: Missing Plan Refuses Modern Terminal Cleanup
    // =========================================================================

    #[test]
    fn task4_modern_terminal_matching_plan_cleans_up() {
        let root = scratch("task4-matching-cleans-up");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-t4-match".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-matched-999".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        let plan = RestorePlan {
            operation_id: "op-matched-999".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    // =========================================================================
    // Task 5: Fault-Injection Matrix Coverage
    // =========================================================================

    #[test]
    fn task5_occurrence_second_journal_write_failure_recovers_with_expected_cleanup() {
        #[cfg(windows)]
        use std::os::windows::fs::OpenOptionsExt;
        // A Windows deny-delete handle retains pending cleanup. Without that handle,
        // successful rollback clears the journal on every supported platform.
        #[cfg(windows)]
        let cleanup_retained_cases = [false, true];
        #[cfg(not(windows))]
        let cleanup_retained_cases = [false];

        for cleanup_retained in cleanup_retained_cases {
            let root = scratch("task5-occurrence-journal");
            write_database(&root.join(DB_FILES[0]), "original active db");
            let orig_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "restored db");
            write_restore_plan(&pending, RestoreKind::Database, "test").unwrap();
            let staged_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
            let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();

            #[cfg(windows)]
            let lock = cleanup_retained.then(|| {
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(1)
                    .open(pending.join(DB_FILES[0]))
                    .unwrap()
            });

            // Fail on the 2nd journal write (Protected phase write)
            let _guard = ScopedFault::set_occurrence(InjectedFault::JournalWrite, 2);
            let res = apply_pending_restore_in_internal(&root, || Ok(())).unwrap();
            assert!(
                matches!(res, RestoreApplicationResult::RefusedUnchanged(ref reason)
            if reason.contains("JournalWrite")),
                "Unexpected restore result: {res:?}"
            );
            assert_eq!(
                ScopedFault::fired_count(),
                1,
                "Second write fault must fire once"
            );
            assert_eq!(
                round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
                orig_identity,
                "Original database must be restored before pending cleanup"
            );

            if cleanup_retained {
                let journal_on_disk = read_journal(&root)
                    .unwrap()
                    .expect("Blocked cleanup must retain a valid rollback journal");
                assert_eq!(journal_on_disk.phase, RestorePhase::RolledBack);
                assert_eq!(
                    round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]),
                    staged_identity
                );
                assert_eq!(
                    std::fs::read(pending.join(RESTORE_PLAN)).unwrap(),
                    plan_bytes
                );
            } else {
                assert!(
                    read_journal(&root).unwrap().is_none(),
                    "Completed cleanup must clear the journal"
                );
                assert!(
                    !pending.exists(),
                    "Completed cleanup must remove owned pending data"
                );
            }
            assert!(find_abandoned_temporary_journal_sibling(&root)
                .unwrap()
                .is_none());

            drop(_guard);
            #[cfg(windows)]
            drop(lock);

            // Repeat startup safely resolves/conserves original dataset
            let decision = handle_startup_restore_in(&root).unwrap();
            if cleanup_retained {
                assert!(matches!(
                    decision,
                    StartupRestoreDecision::RolledBackRecovered { .. }
                ));
            } else {
                assert_eq!(decision, StartupRestoreDecision::ProceedNormally);
            }
            assert_eq!(
                round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
                orig_identity
            );
            assert!(read_journal(&root).unwrap().is_none());
            assert!(!pending.exists());
            assert!(find_abandoned_temporary_journal_sibling(&root)
                .unwrap()
                .is_none());
            std::fs::remove_dir_all(&root).unwrap();
        }
    }

    #[test]
    fn task5_root_readdir_fault_observed_and_blocks_safely() {
        let root = scratch("task5-root-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let _guard = ScopedFault::set(InjectedFault::RootReadDir);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_id
        );
        drop(_guard);

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_backups_readdir_fault_observed_and_blocks_safely() {
        let root = scratch("task5-backups-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_id = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let _guard = ScopedFault::set(InjectedFault::BackupsReadDir);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_id
        );
        drop(_guard);

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_journal_read_fault_observed_and_blocks_safely() {
        let root = scratch("task5-journal-read-fault");
        write_database(&root.join(DB_FILES[0]), "active db");
        let journal = RestoreJournal::new("backups/before-restore-test".into(), false);
        write_journal(&root, &journal).unwrap();

        let _guard = ScopedFault::set(InjectedFault::JournalRead);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_plan_read_fault_observed_and_refuses_deletion() {
        let root = scratch("task5-plan-read-fault");
        write_database(&root.join(DB_FILES[0]), "active db");
        let mut journal = RestoreJournal::new("backups/before-restore-test".into(), false);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = "op-read-test".into();
        write_journal(&root, &journal).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "pending db");
        let plan = RestorePlan {
            operation_id: "op-read-test".into(),
            kind: RestoreKind::Complete,
            source: "test".into(),
        };
        std::fs::write(
            pending.join(RESTORE_PLAN),
            serde_json::to_string(&plan).unwrap(),
        )
        .unwrap();

        let _guard = ScopedFault::set(InjectedFault::PlanRead);
        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(ScopedFault::hits() >= 1);
        assert!(matches!(
            decision,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(pending.join(DB_FILES[0]).is_file());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task5_inventory_readdir_fault_observed_and_blocks() {
        let root = scratch("task5-inventory-readdir");
        write_database(&root.join(DB_FILES[0]), "active db");
        write_document(&root, "orig.pdf", "doc");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "restored db");
        write_document(&pending, "new.pdf", "new doc");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let _guard = ScopedFault::set(InjectedFault::InventoryReadDir);
        let res = apply_pending_restore_in_internal(&root, || Ok(()));
        assert!(ScopedFault::hits() >= 1);
        assert!(
            res.is_err()
                || matches!(
                    res,
                    Ok(RestoreApplicationResult::Unresolved { .. })
                        | Ok(RestoreApplicationResult::RefusedUnchanged(_))
                )
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task5_real_unreadable_journal_file_blocks_startup() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("task5-real-unreadable-journal");
        write_database(&root.join(DB_FILES[0]), "active db");
        let journal_path = root.join(RESTORE_JOURNAL_FILE);
        std::fs::write(&journal_path, b"valid journal text").unwrap();

        // Lock file with exclusive access (share_mode = 0 denies read/write/delete by others)
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&journal_path)
            .unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "OS denied read on journal file must block startup: {decision:?}"
        );

        drop(lock);
        std::fs::remove_dir_all(&root).unwrap();
    }
    // =========================================================================
    // ROUND 5 REGRESSIONS & FINITE CRITICAL FAILURE EVIDENCE
    // =========================================================================

    #[test]
    fn round5_journal_write_or_sync_failures_can_recover_on_restart() {
        let mut outcomes = Vec::new();
        for fault in [InjectedFault::JournalWrite, InjectedFault::JournalSync] {
            for occurrence in [1, 2] {
                let root = scratch("round5-initial-journal");
                write_database(&root.join(DB_FILES[0]), "original row");
                write_document(&root, "original.pdf", "original document");
                let original_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
                let original_docs =
                    inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
                let pending = root.join(RESTORE_PENDING_DIR);
                std::fs::create_dir_all(&pending).unwrap();
                write_database(&pending.join(DB_FILES[0]), "selected row");
                write_document(&pending, "selected.pdf", "selected document");
                write_restore_plan(&pending, RestoreKind::Complete, "synthetic test").unwrap();
                let guard = ScopedFault::set_occurrence(fault, occurrence);
                let first = apply_pending_restore_in_internal(&root, || Ok(()));
                let hits = ScopedFault::hits();
                let fired = ScopedFault::fired_count();
                drop(guard);
                let original_preserved = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0])
                    == original_db
                    && inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap()
                        == original_docs;
                let second = handle_startup_restore_in(&root).unwrap();
                let third = handle_startup_restore_in(&root).unwrap();
                let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                    && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
                println!("fault={fault:?}, occurrence={occurrence}, matching_calls={hits}, fired={fired}, first={first:?}, second={second:?}, third={third:?}, originals_preserved={original_preserved}");
                outcomes.push((
                    hits >= occurrence && fired >= 1 && original_preserved,
                    recovered,
                ));
                std::fs::remove_dir_all(&root).unwrap();
            }
        }
        assert!(
            outcomes.iter().all(|(safe, _)| *safe),
            "Fault must be reached and originals conserved"
        );
        assert!(outcomes.iter().all(|(_, recovered)| *recovered), "A cleared journal fault must not leave an untouched or successfully rolled-back profile permanently blocked: {outcomes:?}");
    }

    #[test]
    fn round5_legacy_pending_activation_does_not_leave_unverifiable_owner() {
        let mut outcomes = Vec::new();
        for old_plan in [false, true] {
            let root = scratch("round5-legacy-pending");
            write_database(&root.join(DB_FILES[0]), "original row");
            write_document(&root, "handbook.pdf", "original document");
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "selected legacy row");
            write_document(&pending, "handbook.pdf", "selected legacy document");
            if old_plan {
                std::fs::write(
                    pending.join(RESTORE_PLAN),
                    br#"{"kind":"complete","source":"legacy synthetic backup"}"#,
                )
                .unwrap();
            }
            let first = handle_startup_restore_in(&root).unwrap();
            let installed = database_contents(&root.join(DB_FILES[0]));
            let second = handle_startup_restore_in(&root).unwrap();
            let third = handle_startup_restore_in(&root).unwrap();
            let healthy = first == StartupRestoreDecision::RestoreCompleted
                && installed == "selected legacy row"
                && !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
            println!("old_plan={old_plan}, first={first:?}, second={second:?}, third={third:?}, installed={installed}");
            outcomes.push(healthy);
            std::fs::remove_dir_all(&root).unwrap();
        }
        assert!(outcomes.iter().all(|ok| *ok), "Supported legacy pending restore must remain launchable after actual activation, without weakening modern unknown-owner refusal");
    }

    #[cfg(windows)]
    #[test]
    fn round5_pending_cleanup_with_windows_lock_recovers_when_plan_survives() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("round5-partial-cleanup");
        write_database(&root.join(DB_FILES[0]), "committed selected row");
        write_document(&root, "handbook.pdf", "committed selected document");
        let active_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let active_docs = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        // The ownership record is created first. The later payload holds a real deny-delete handle.
        write_restore_plan(&pending, RestoreKind::Complete, "synthetic cleanup").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned leftover row");
        let mut journal = RestoreJournal::new("backups/before-restore-round5-cleanup".into(), true);
        journal.operation_id = plan.operation_id;
        journal.phase = RestorePhase::Committed;
        write_journal(&root, &journal).unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(pending.join(DB_FILES[0]))
            .unwrap();
        let first = handle_startup_restore_in(&root).unwrap();
        let plan_after_first = pending.join(RESTORE_PLAN).exists();
        let payload_after_first = pending.join(DB_FILES[0]).is_file();
        drop(lock);
        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        let active_preserved = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == active_db
            && inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap() == active_docs;
        let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
            && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
        println!("first={first:?}, plan_after_first={plan_after_first}, payload_after_first={payload_after_first}, second={second:?}, third={third:?}, active_preserved={active_preserved}");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            payload_after_first && active_preserved,
            "Real cleanup failure must preserve committed data and locked payload"
        );
        assert!(
            recovered,
            "Cleanup must recover once the real OS lock clears"
        );
    }

    #[test]
    fn round5_protection_failure_with_real_original_wal_and_shm_recovers() {
        let mut outcomes = Vec::new();
        for fault_index in [0, 1] {
            let source = scratch("round5-wal-source");
            write_database(&source.join(DB_FILES[0]), "original checkpointed row");
            let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
            conn.pragma_update(None, "journal_mode", "WAL").unwrap();
            conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
            conn.execute(
                "UPDATE audit_payload SET value = 'original committed WAL-only row'",
                [],
            )
            .unwrap();
            let root = scratch("round5-wal-active");
            // Capture a crashed-profile equivalent while the real committed WAL and SHM still exist.
            for name in DB_FILES {
                std::fs::copy(source.join(name), root.join(name)).unwrap();
            }
            drop(conn);
            let orig_db = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
            let orig_wal = round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]);
            let pending = root.join(RESTORE_PENDING_DIR);
            std::fs::create_dir_all(&pending).unwrap();
            write_database(&pending.join(DB_FILES[0]), "selected row");
            write_restore_plan(&pending, RestoreKind::Database, "synthetic test").unwrap();
            let guard = ScopedFault::set_occurrence(InjectedFault::ProtectDbRename(fault_index), 1);
            let first = handle_startup_restore_in(&root).unwrap();
            let hits = ScopedFault::hits();
            let fired = ScopedFault::fired_count();
            drop(guard);
            let second = handle_startup_restore_in(&root).unwrap();
            let third = handle_startup_restore_in(&root).unwrap();
            let conserved = root.join(DB_FILES[0]).is_file()
                && root.join(DB_FILES[1]).is_file()
                && round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]) == orig_db
                && round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]) == orig_wal;
            // Read only after all startup invocations, so SQLite cannot change the evidence between them.
            let row = database_contents(&root.join(DB_FILES[0]));
            let recovered = !matches!(second, StartupRestoreDecision::BlockedUnresolved { .. })
                && !matches!(third, StartupRestoreDecision::BlockedUnresolved { .. });
            println!("index={fault_index}, hits={hits}, fired={fired}, first={first:?}, second={second:?}, third={third:?}, db_wal_conserved={conserved}, row={row}");
            outcomes.push((
                hits > 0 && fired >= 1 && conserved && row == "original committed WAL-only row",
                recovered,
            ));
            std::fs::remove_dir_all(&root).unwrap();
            std::fs::remove_dir_all(&source).unwrap();
        }
        assert!(
            outcomes.iter().all(|(safe, _)| *safe),
            "Original DB and committed WAL-only row must survive protection failure"
        );
        assert!(outcomes.iter().all(|(_, recovered)| *recovered), "Ephemeral SHM cache cleanup must not permanently prevent return of original committed DB/WAL: {outcomes:?}");
    }

    #[test]
    fn task4_legacy_database_restore_without_operation_id_preserves_documents() {
        let root = scratch("task4-legacy-db-plan");
        write_database(&root.join(DB_FILES[0]), "original database content");
        write_document(&root, "handbook.pdf", "original document untouched");
        let orig_doc = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db content");
        std::fs::write(
            pending.join(RESTORE_PLAN),
            br#"{"kind":"database","source":"legacy db backup"}"#,
        )
        .unwrap();

        let first = handle_startup_restore_in(&root).unwrap();
        assert_eq!(first, StartupRestoreDecision::RestoreCompleted);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "selected db content"
        );
        assert_eq!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap(),
            orig_doc,
            "Original documents must remain untouched during database-only restore"
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_pending_cleanup_interrupted_after_plan_removed_recovers_if_staged_payload_matches() {
        let root = scratch("task4-interrupted-cleanup-matching");
        write_database(&root.join(DB_FILES[0]), "active db row");
        write_document(&root, "manual.pdf", "active doc content");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged leftover row");

        let db_bytes = std::fs::read(pending.join(DB_FILES[0])).unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-cleanup-test".into(), true);
        journal.operation_id = "modern-op-987".into();
        journal.phase = RestorePhase::Committed;
        journal.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: hex::encode(Sha256::digest(&db_bytes)),
            size: db_bytes.len() as u64,
        });
        write_journal(&root, &journal).unwrap();
        // Notice: pending has NO RESTORE_PLAN (simulating interruption where plan was removed first)

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted, "Matching staged manifest must prove ownership and complete cleanup even if plan is missing");
        assert!(!pending.exists(), "Pending directory must be cleaned up");

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::ProceedNormally);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_pending_cleanup_interrupted_with_unknown_payload_refuses_deletion() {
        let root = scratch("task4-interrupted-cleanup-unknown");
        write_database(&root.join(DB_FILES[0]), "active db row");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "unknown foreign row");

        let mut journal = RestoreJournal::new("backups/before-restore-unknown-test".into(), true);
        journal.operation_id = "modern-op-987".into();
        journal.phase = RestorePhase::Committed;
        // Staged manifest records a DIFFERENT hash
        journal.staged_db_artifacts.push(ArtifactIdentity {
            name: DB_FILES[0].to_string(),
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".to_string(),
            size: 1234,
        });
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(decision, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Unknown leftover payload must refuse deletion: {decision:?}"
        );
        assert!(
            pending.join(DB_FILES[0]).exists(),
            "Unknown payload must be conserved byte-for-byte"
        );
        assert_eq!(
            database_contents(&pending.join(DB_FILES[0])),
            "unknown foreign row"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_wal_selected_install_failure_uninstalls_wal_and_recovers_original() {
        let source = scratch("task4-wal-install-src");
        write_database(&source.join(DB_FILES[0]), "original base");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'original committed row in WAL'",
            [],
        )
        .unwrap();
        let root = scratch("task4-wal-install-root");
        for name in DB_FILES {
            std::fs::copy(source.join(name), root.join(name)).unwrap();
        }
        drop(conn);

        let staged_src = scratch("task4-wal-install-staged-src");
        write_database(&staged_src.join(DB_FILES[0]), "staged new base");
        let staged_conn = Connection::open(staged_src.join(DB_FILES[0])).unwrap();
        staged_conn
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        staged_conn
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        staged_conn
            .execute(
                "UPDATE audit_payload SET value = 'staged new row in WAL'",
                [],
            )
            .unwrap();
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::copy(staged_src.join(DB_FILES[0]), pending.join(DB_FILES[0])).unwrap();
        std::fs::copy(staged_src.join(DB_FILES[1]), pending.join(DB_FILES[1])).unwrap();
        drop(staged_conn);
        std::fs::remove_dir_all(&staged_src).unwrap();
        let staged_wal = std::fs::read(pending.join(DB_FILES[1])).unwrap();
        assert!(
            staged_wal.len() >= 32
                && (staged_wal[0..4] == [0x37, 0x7f, 0x06, 0x82]
                    || staged_wal[0..4] == [0x37, 0x7f, 0x06, 0x83]),
            "Selected WAL fixture must be genuine SQLite WAL format"
        );
        write_restore_plan(&pending, RestoreKind::Database, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::InstallDbRename(1));
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "InstallDbRename(1) fault must fire");
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. })
                || matches!(first, StartupRestoreDecision::RolledBackRecovered { .. })
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert!(!matches!(
            second,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(!matches!(
            third,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        let row = database_contents(&root.join(DB_FILES[0]));
        assert_eq!(
            row, "original committed row in WAL",
            "Original committed row must survive selected WAL install failure"
        );
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
    }

    #[test]
    fn task4_document_selected_install_failure_recovers_original_documents() {
        let root = scratch("task4-doc-install-root");
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(&root, "doc1.pdf", "original content 1");
        write_document(&root, "doc2.pdf", "original content 2");
        let orig_docs = inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db");
        write_document(&pending, "selected_doc.pdf", "selected content");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::InstallDocsRename);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "InstallDocsRename fault must fire");
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. })
                || matches!(first, StartupRestoreDecision::RolledBackRecovered { .. })
        );

        let second = handle_startup_restore_in(&root).unwrap();
        let third = handle_startup_restore_in(&root).unwrap();
        assert!(!matches!(
            second,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));
        assert!(!matches!(
            third,
            StartupRestoreDecision::BlockedUnresolved { .. }
        ));

        assert_eq!(
            inventory_directory_artifacts(&root.join(DOCUMENTS_DIR)).unwrap(),
            orig_docs,
            "Original documents must be fully recovered"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_journal_delete_failure_retries_safely_without_replay() {
        let root = scratch("task4-journal-del-fail");
        write_database(&root.join(DB_FILES[0]), "original db");
        write_document(&root, "original.pdf", "original doc");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "selected db");
        write_document(&pending, "selected.pdf", "selected doc");
        write_restore_plan(&pending, RestoreKind::Complete, "test").unwrap();

        let guard = ScopedFault::set(InjectedFault::JournalDelete);
        let _first = apply_pending_restore_in_internal(&root, || Ok(()));
        let fired = ScopedFault::fired_count();
        drop(guard);
        assert!(fired >= 1, "JournalDelete fault must fire");
        // Because journal delete failed, the journal file survives in terminal phase
        assert!(root.join(RESTORE_JOURNAL_FILE).is_file());
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "selected db");

        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(
            second,
            StartupRestoreDecision::RestoreCompleted,
            "Second launch must complete journal cleanup without replaying restore"
        );
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must now be removed"
        );

        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "selected db");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn task4_valid_canonical_journal_under_real_windows_lock_blocks_and_recovers() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = scratch("task4-valid-journal-lock");
        write_database(&root.join(DB_FILES[0]), "active db row");
        let rollback = root.join("backups/before-restore-lock-test");
        std::fs::create_dir_all(&rollback).unwrap();
        write_database(&rollback.join(DB_FILES[0]), "rollback db row");

        let active_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let mut journal = RestoreJournal::new("backups/before-restore-lock-test".into(), false);
        journal.operation_id = "op-valid-lock-test".into();
        journal.phase = RestorePhase::RolledBack;
        journal.original_db_artifacts.push(active_identity);
        write_journal(&root, &journal).unwrap();
        let journal_path = root.join(RESTORE_JOURNAL_FILE);
        assert!(
            journal_path.is_file(),
            "Canonical journal must exist on disk"
        );

        // Lock with share_mode = 0 (denies all read/write/delete by other processes)
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&journal_path)
            .unwrap();

        let first = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Startup must block under real OS file lock denying read"
        );

        // Release the lock
        drop(lock);

        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Startup must return RolledBackRecovered after lock is released: {second:?}"
        );

        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(database_contents(&root.join(DB_FILES[0])), "active db row");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn round6_cleanup_enumeration_error_must_preserve_ownership_plan() {
        fn set_list_denied(path: &Path, deny: bool) {
            let quoted = path.to_string_lossy().replace('\'', "''");
            let action = if deny {
                "AddAccessRule"
            } else {
                "RemoveAccessRuleSpecific"
            };
            let script = format!("$ErrorActionPreference='Stop'; $p='{quoted}'; $acl=[System.IO.Directory]::GetAccessControl($p); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::ListDirectory,[System.Security.AccessControl.InheritanceFlags]::None,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Deny); $acl.{action}($rule); [System.IO.Directory]::SetAccessControl($p,$acl)");
            let out = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "Could not configure isolated directory-list permission: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        struct ListPermissionGuard(PathBuf);
        impl Drop for ListPermissionGuard {
            fn drop(&mut self) {
                set_list_denied(&self.0, false);
            }
        }
        let root = scratch("round6-cleanup-enumeration");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned payload row");
        write_restore_plan(&pending, RestoreKind::Complete, "isolated permission test").unwrap();
        let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();
        let payload_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();
        let mut journal = RestoreJournal::new("backups/before-restore-round6-cleanup".into(), true);
        journal.phase = RestorePhase::Committed;
        journal.operation_id = plan.operation_id;
        journal.staged_db_artifacts.push(payload_identity.clone());
        set_list_denied(&pending, true);
        let permission_guard = ListPermissionGuard(pending.clone());
        let read_error = std::fs::read_dir(&pending).err().map(|e| e.kind());
        let ownership = verify_pending_cleanup_permission(&pending, &journal);
        let cleanup = remove_pending_directory_safely(&pending);
        let plan_preserved = std::fs::read(pending.join(RESTORE_PLAN)).ok().as_deref()
            == Some(plan_bytes.as_slice());
        let payload_preserved =
            round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]) == payload_identity;
        drop(permission_guard);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            read_error,
            Some(std::io::ErrorKind::PermissionDenied),
            "Must reach an actual OS directory enumeration error"
        );
        assert!(
            matches!(ownership, Ok(true)),
            "Plan reading remains permitted; directory listing is denied separately"
        );
        assert!(
            cleanup.is_err() && payload_preserved,
            "Failed cleanup must preserve its payload"
        );
        assert!(plan_preserved, "Failure to enumerate payload must not unlink the ownership plan before payload deletion is complete");
    }

    #[test]
    fn round6_cleanup_entry_read_fault_preserves_plan_and_recovers_on_restart() {
        let root = scratch("round6-entry-fault");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "owned payload");
        write_restore_plan(&pending, RestoreKind::Complete, "entry-fault-test").unwrap();
        let plan_bytes = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();

        let guard = ScopedFault::set(InjectedFault::PendingEntryRead);
        let cleanup_res = remove_pending_directory_safely(&pending);
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(fired >= 1, "PendingEntryRead fault must fire");
        assert!(
            cleanup_res.is_err(),
            "Cleanup must fail when entry read fails"
        );
        let plan_after = std::fs::read(pending.join(RESTORE_PLAN)).unwrap();
        assert_eq!(
            plan_after, plan_bytes,
            "Plan must survive failed entry reading"
        );
        assert!(
            pending.join(DB_FILES[0]).exists(),
            "Payload must survive failed entry reading"
        );

        // Now clear fault and retry cleanup directly
        let cleanup_retry = remove_pending_directory_safely(&pending);
        assert!(
            cleanup_retry.is_ok(),
            "Cleanup must succeed after fault clears"
        );
        assert!(
            !pending.exists(),
            "Pending directory must be completely removed"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn round6_cleanup_obstruction_during_startup_preserves_plan_and_clears_on_restart() {
        let root = scratch("round6-startup-obstruction");
        write_database(&root.join(DB_FILES[0]), "original committed db");
        let orig_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "restored db");
        let staged_identity = round3_identity(&pending.join(DB_FILES[0]), DB_FILES[0]);
        write_restore_plan(&pending, RestoreKind::Database, "startup-obstruction").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        // Prepare committed restore journal
        let mut journal = RestoreJournal::new("backups/test-backup".into(), false);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Committed;
        journal.staged_db_artifacts.push(staged_identity);
        write_journal(&root, &journal).unwrap();

        // Inject PendingEntryRead fault during startup cleanup
        let guard = ScopedFault::set(InjectedFault::PendingEntryRead);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "PendingEntryRead fault must fire during startup"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "Startup must block unresolved when pending cleanup fails: {first:?}"
        );
        assert!(
            pending.join(RESTORE_PLAN).exists(),
            "Plan must be preserved on disk"
        );

        // Second startup after fault clears: cleanup succeeds
        let second = handle_startup_restore_in(&root).unwrap();
        assert_eq!(second, StartupRestoreDecision::RestoreCompleted);
        assert!(!pending.exists(), "Pending directory must be deleted");
        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Journal must be deleted"
        );

        // Third startup: proceed normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "original committed db"
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_identity
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_prior_canonical_journal_preserved_on_write_sync_rename_failures() {
        let root = scratch("task4-prior-canonical-bytes");
        let mut initial_journal = RestoreJournal::new("backups/before-restore-test".into(), true);
        initial_journal.phase = RestorePhase::Protecting;
        write_journal(&root, &initial_journal).unwrap();

        let canonical_path = root.join(RESTORE_JOURNAL_FILE);
        let initial_bytes = std::fs::read(&canonical_path).unwrap();
        let initial_hash = hex::encode(Sha256::digest(&initial_bytes));

        let mut updated_journal = initial_journal.clone();
        updated_journal.phase = RestorePhase::Protected;

        let faults = [
            InjectedFault::JournalTempCreate,
            InjectedFault::JournalWrite,
            InjectedFault::JournalSync,
            InjectedFault::JournalRename,
        ];

        for fault in faults {
            let guard = ScopedFault::set(fault);
            let res = write_journal(&root, &updated_journal);
            let fired = ScopedFault::fired_count();
            drop(guard);

            assert!(fired >= 1, "Fault {fault:?} must fire: fired={fired}");
            assert!(res.is_err(), "Write must return Err on {fault:?}");

            // Prior canonical bytes and hash are completely unchanged!
            let current_bytes = std::fs::read(&canonical_path).unwrap();
            let current_hash = hex::encode(Sha256::digest(&current_bytes));
            assert_eq!(
                current_bytes, initial_bytes,
                "Canonical bytes must be unchanged on {fault:?}"
            );
            assert_eq!(
                current_hash, initial_hash,
                "Canonical hash must be unchanged on {fault:?}"
            );

            // No temporary siblings remain
            let abandoned = find_abandoned_temporary_journal_sibling(&root).unwrap();
            assert!(
                abandoned.is_none(),
                "No temporary sibling must remain after {fault:?}: found {abandoned:?}"
            );

            // Once fault is cleared, write succeeds
            write_journal(&root, &updated_journal).unwrap();
            let read_back = read_journal(&root).unwrap().unwrap();
            assert_eq!(read_back.phase, RestorePhase::Protected);

            // Reset back to initial for next fault iteration
            write_journal(&root, &initial_journal).unwrap();
        }

        std::fs::remove_dir_all(&root).unwrap();
    }

    fn find_abandoned_temporary_journal_sibling(
        dir: &Path,
    ) -> Result<Option<String>, std::io::Error> {
        let prefix = format!("{RESTORE_JOURNAL_FILE}.tmp-");
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) || name.starts_with(".tmp-") {
                return Ok(Some(name));
            }
        }
        Ok(None)
    }

    #[test]
    fn task4_temporary_sibling_detector_rejects_actual_prefix_leftover_negative_control() {
        let root = scratch("task4-temp-detector-negative-control");
        assert_eq!(
            find_abandoned_temporary_journal_sibling(&root).unwrap(),
            None,
            "Clean directory must have no temporary siblings"
        );

        let seeded_name = format!("{RESTORE_JOURNAL_FILE}.tmp-negative-control-leftover");
        let seeded_path = root.join(&seeded_name);
        std::fs::write(&seeded_path, b"deliberate unremoved temporary sibling").unwrap();
        assert!(
            seeded_path.is_file(),
            "Seeded temporary file must exist on disk"
        );

        let detected = find_abandoned_temporary_journal_sibling(&root).unwrap();
        assert_eq!(
            detected.as_deref(),
            Some(seeded_name.as_str()),
            "Detector must catch the real-prefix temporary journal sibling"
        );

        std::fs::remove_file(&seeded_path).unwrap();
        assert_eq!(
            find_abandoned_temporary_journal_sibling(&root).unwrap(),
            None,
            "Detector must clear after removing the seeded temporary file"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_wal_original_return_failure_preserves_committed_wal_and_recovers() {
        let source = scratch("c1-wal-return-source");
        write_database(&source.join(DB_FILES[0]), "base content");
        let conn = Connection::open(source.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'committed row in WAL only'",
            [],
        )
        .unwrap();

        let root = scratch("c1-wal-return-root");
        for name in [DB_FILES[0], DB_FILES[1]] {
            std::fs::copy(source.join(name), root.join(name)).unwrap();
        }
        drop(conn);
        std::fs::remove_dir_all(&source).unwrap();

        let wal_bytes = std::fs::read(root.join(DB_FILES[1])).unwrap();
        assert!(
            wal_bytes.len() >= 32
                && (wal_bytes[0..4] == [0x37, 0x7f, 0x06, 0x82]
                    || wal_bytes[0..4] == [0x37, 0x7f, 0x06, 0x83]),
            "Original WAL must be genuine SQLite WAL format"
        );
        let orig_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);
        let orig_wal_identity = round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]);

        let rollback = root.join("backups/before-restore-c1-wal");
        std::fs::create_dir_all(&rollback).unwrap();
        // Move original DB and WAL into rollback
        std::fs::rename(root.join(DB_FILES[0]), rollback.join(DB_FILES[0])).unwrap();
        std::fs::rename(root.join(DB_FILES[1]), rollback.join(DB_FILES[1])).unwrap();

        // Staged pending restore with distinct DB
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged restore content");
        write_restore_plan(&pending, RestoreKind::Database, "c1-wal-return").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-c1-wal".into(), false);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Protected;
        journal.protected_db_files = vec![DB_FILES[0].to_string(), DB_FILES[1].to_string()];
        journal.original_db_artifacts = vec![orig_db_identity.clone(), orig_wal_identity.clone()];
        write_journal(&root, &journal).unwrap();

        // Inject ReturnDbRename(1) during rollback: DB[0] returns, DB[1] (WAL) fails to return
        let guard = ScopedFault::set(InjectedFault::ReturnDbRename(1));
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "ReturnDbRename(1) fault must fire: fired={fired}"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "First startup must block unresolved when WAL return fails: {first:?}"
        );
        // Original DB returned to root, original WAL safely retained in rollback directory
        assert!(
            root.join(DB_FILES[0]).exists(),
            "DB[0] must have returned to root"
        );
        assert!(
            rollback.join(DB_FILES[1]).exists(),
            "WAL must be safely retained in rollback"
        );
        assert_eq!(
            round3_identity(&rollback.join(DB_FILES[1]), DB_FILES[1]),
            orig_wal_identity
        );

        // Second startup: fault is cleared, rollback resumes and returns remaining WAL
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Second startup must recover rolled back original data: {second:?}"
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]),
            orig_db_identity
        );
        assert_eq!(
            round3_identity(&root.join(DB_FILES[1]), DB_FILES[1]),
            orig_wal_identity
        );

        // Third startup: proceeds normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);

        // Verify SQLite can open and query the committed WAL-only row!
        let row = database_contents(&root.join(DB_FILES[0]));
        assert_eq!(
            row, "committed row in WAL only",
            "Committed WAL-only row must survive and be readable"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn task4_documents_original_return_failure_preserves_documents_and_recovers() {
        let root = scratch("c1-docs-return-root");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let rollback = root.join("backups/before-restore-c1-docs");
        let rollback_docs = rollback.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&rollback_docs).unwrap();

        // Two distinct original synthetic document payloads
        let doc1_path = rollback_docs.join("manual.pdf");
        let doc2_path = rollback_docs.join("checklist.txt");
        std::fs::write(&doc1_path, b"%PDF-1.4 original document bytes").unwrap();
        std::fs::write(&doc2_path, b"Preflight checklist: original items").unwrap();
        let doc1_identity = round3_identity(&doc1_path, "manual.pdf");
        let doc2_identity = round3_identity(&doc2_path, "checklist.txt");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        write_restore_plan(&pending, RestoreKind::Complete, "c1-docs-return").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-c1-docs".into(), true);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_db_artifacts = vec![orig_db_identity];
        journal.original_document_artifacts = vec![doc1_identity.clone(), doc2_identity.clone()];
        write_journal(&root, &journal).unwrap();

        // Inject ReturnDocsRename fault during rollback
        let guard = ScopedFault::set(InjectedFault::ReturnDocsRename);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "ReturnDocsRename fault must fire: fired={fired}"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "First startup must block unresolved when document return fails: {first:?}"
        );
        // Documents preserved in rollback folder
        assert_eq!(round3_identity(&doc1_path, "manual.pdf"), doc1_identity);
        assert_eq!(round3_identity(&doc2_path, "checklist.txt"), doc2_identity);
        assert!(
            !root.join(DOCUMENTS_DIR).exists(),
            "Active documents dir must not be partially created on failure"
        );

        // Second startup: fault cleared, rollback returns documents
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Second startup must recover rolled back documents: {second:?}"
        );
        assert_eq!(
            round3_identity(&root.join(DOCUMENTS_DIR).join("manual.pdf"), "manual.pdf"),
            doc1_identity
        );
        assert_eq!(
            round3_identity(
                &root.join(DOCUMENTS_DIR).join("checklist.txt"),
                "checklist.txt"
            ),
            doc2_identity
        );

        // Third startup: proceeds normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);

        std::fs::remove_dir_all(&root).unwrap();
    }

    struct M2ArchiveFixture(PathBuf);
    impl Drop for M2ArchiveFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn m2_archive_fixture() -> (M2ArchiveFixture, Connection) {
        static FIXTURE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let count = FIXTURE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "m2-archive-test-{}-{}-{}",
            std::process::id(),
            count,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let conn = Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for migration in crate::migrations() {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute_batch(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations VALUES(11);
             INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('mat','Synthetic','2026-10-04','2026-10-04');",
        )
        .unwrap();
        crate::practice_sessions::mark_root_ready(&root);
        crate::practice_sessions::save_practice_test_at(
            &root,
            "mat",
            "Synthetic",
            r#"[{"question":"Synthetic","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#,
            "synthetic",
        )
        .unwrap();
        (M2ArchiveFixture(root), conn)
    }

    fn m2_start(f: &M2ArchiveFixture, c: &Connection) -> serde_json::Value {
        let v: String = c
            .query_row("SELECT id FROM practice_test_versions", [], |r| r.get(0))
            .unwrap();
        crate::practice_sessions::save_practice_session_at(
            &f.0,
            &serde_json::json!({
                "action": "start_or_resume",
                "operationId": "10000000-0000-4000-8000-000000000001",
                "materialId": "mat",
                "versionId": v
            }),
        )
        .unwrap()
    }

    fn m2_response(
        f: &M2ArchiveFixture,
        c: &Connection,
        s: &serde_json::Value,
        revision: i64,
        op: &str,
    ) -> serde_json::Value {
        let item: String = c
            .query_row("SELECT id FROM practice_test_items", [], |r| r.get(0))
            .unwrap();
        crate::practice_sessions::save_practice_session_at(
            &f.0,
            &serde_json::json!({
                "action": "record_response",
                "operationId": op,
                "attemptId": s["attemptId"],
                "itemId": item,
                "expectedRevision": revision,
                "selectedIndex": 1,
                "isDontKnow": false
            }),
        )
        .unwrap()
    }

    #[test]
    fn astra_documents_metadata_failure_preserves_documents_and_recovers() {
        let root = scratch("astra-meta-return-root");
        write_database(&root.join(DB_FILES[0]), "active db");
        let orig_db_identity = round3_identity(&root.join(DB_FILES[0]), DB_FILES[0]);

        let rollback = root.join("backups/before-restore-astra-meta");
        let rollback_docs = rollback.join(DOCUMENTS_DIR);
        std::fs::create_dir_all(&rollback_docs).unwrap();

        // Two distinct original synthetic document payloads
        let doc1_path = rollback_docs.join("manual.pdf");
        let doc2_path = rollback_docs.join("checklist.txt");
        std::fs::write(&doc1_path, b"%PDF-1.4 original document bytes").unwrap();
        std::fs::write(&doc2_path, b"Preflight checklist: original items").unwrap();
        let doc1_identity = round3_identity(&doc1_path, "manual.pdf");
        let doc2_identity = round3_identity(&doc2_path, "checklist.txt");

        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        write_database(&pending.join(DB_FILES[0]), "staged db");
        write_restore_plan(&pending, RestoreKind::Complete, "astra-meta-return").unwrap();
        let plan = read_restore_plan_for_ownership(&pending).unwrap().unwrap();

        let mut journal = RestoreJournal::new("backups/before-restore-astra-meta".into(), true);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Protected;
        journal.protected_documents = true;
        journal.original_db_artifacts = vec![orig_db_identity];
        journal.original_document_artifacts = vec![doc1_identity.clone(), doc2_identity.clone()];
        write_journal(&root, &journal).unwrap();

        // Inject ReturnDocsMetadata fault during rollback
        let guard = ScopedFault::set(InjectedFault::ReturnDocsMetadata);
        let first = handle_startup_restore_in(&root).unwrap();
        let fired = ScopedFault::fired_count();
        drop(guard);

        assert!(
            fired >= 1,
            "ReturnDocsMetadata fault must fire: fired={fired}"
        );
        assert!(
            matches!(first, StartupRestoreDecision::BlockedUnresolved { .. }),
            "First startup must block unresolved when document return fails: {first:?}"
        );
        // Documents preserved in rollback folder
        assert_eq!(round3_identity(&doc1_path, "manual.pdf"), doc1_identity);
        assert_eq!(round3_identity(&doc2_path, "checklist.txt"), doc2_identity);
        assert!(
            !root.join(DOCUMENTS_DIR).exists(),
            "Active documents dir must not be partially created on failure"
        );

        // Second startup: fault cleared, rollback returns documents
        let second = handle_startup_restore_in(&root).unwrap();
        assert!(
            matches!(second, StartupRestoreDecision::RolledBackRecovered { .. }),
            "Second startup must recover rolled back documents: {second:?}"
        );
        assert_eq!(
            round3_identity(&root.join(DOCUMENTS_DIR).join("manual.pdf"), "manual.pdf"),
            doc1_identity
        );
        assert_eq!(
            round3_identity(
                &root.join(DOCUMENTS_DIR).join("checklist.txt"),
                "checklist.txt"
            ),
            doc2_identity
        );

        // Third startup: proceeds normally
        let third = handle_startup_restore_in(&root).unwrap();
        assert_eq!(third, StartupRestoreDecision::ProceedNormally);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn valid_schema_11_control_is_accepted() {
        let (f, _) = m2_archive_fixture();
        assert!(verify_application_database(&f.0.join("her-flight-deck.db")).is_ok());
    }

    #[test]
    fn missing_required_unique_index_is_refused() {
        let (f, c) = m2_archive_fixture();
        c.execute_batch("DROP INDEX uq_single_in_progress_attempt")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "archive without required single-attempt index was accepted"
        );
    }

    #[test]
    fn malformed_receipt_json_is_refused() {
        let (f, c) = m2_archive_fixture();
        m2_start(&f, &c);
        c.execute_batch("UPDATE practice_session_operations SET result_json='not-json'")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "archive with malformed receipt JSON was accepted"
        );
    }

    #[test]
    fn foreign_key_violation_is_refused() {
        let (f, c) = m2_archive_fixture();
        c.pragma_update(None, "foreign_keys", "OFF").unwrap();
        c.execute_batch("UPDATE practice_test_versions SET source_material_id='missing'")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "archive with missing source foreign key was accepted"
        );
    }

    #[test]
    fn frozen_key_score_is_derived() {
        let (f, c) = m2_archive_fixture();
        let s = m2_start(&f, &c);
        m2_response(&f, &c, &s, 0, "10000000-0000-4000-8000-000000000002");
        c.execute_batch("UPDATE practice_responses SET is_correct=1")
            .unwrap();
        let result = crate::practice_sessions::save_practice_session_at(
            &f.0,
            &serde_json::json!({
                "action": "complete_attempt",
                "operationId": "10000000-0000-4000-8000-000000000003",
                "attemptId": s["attemptId"],
                "expectedRevision": 1
            }),
        )
        .unwrap();
        assert_eq!(result["scorePercent"], serde_json::json!(0.0));
    }

    #[test]
    fn no_op_preserves_returned_answered_time() {
        let (f, c) = m2_archive_fixture();
        let s = m2_start(&f, &c);
        let first = m2_response(&f, &c, &s, 0, "10000000-0000-4000-8000-000000000002");
        std::thread::sleep(std::time::Duration::from_millis(20));
        let second = m2_response(&f, &c, &s, 1, "10000000-0000-4000-8000-000000000003");
        assert_eq!(first["answeredAt"], second["answeredAt"]);
    }

    #[test]
    fn receipt_empty_object_refused() {
        let (f, c) = m2_archive_fixture();
        m2_start(&f, &c);
        c.execute_batch("UPDATE practice_session_operations SET result_json='{}'")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "empty-object result was accepted"
        );
    }

    #[test]
    fn out_of_range_stored_response_refused() {
        let (f, c) = m2_archive_fixture();
        let s = m2_start(&f, &c);
        m2_response(&f, &c, &s, 0, "10000000-0000-4000-8000-000000000002");
        c.execute_batch("UPDATE practice_responses SET selected_index=99")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "selected_index=99 for two options was accepted"
        );
    }

    #[test]
    fn cross_material_attempt_refused() {
        let (f, c) = m2_archive_fixture();
        m2_start(&f, &c);
        c.execute_batch(
            "INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('other','Other synthetic','2026-10-04','2026-10-04');
             UPDATE practice_attempts SET source_material_id='other';",
        )
        .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "cross-material attempt owner was accepted"
        );
    }

    #[test]
    fn counterfeit_unique_index_refused() {
        let (f, c) = m2_archive_fixture();
        c.execute_batch(
            "DROP INDEX uq_single_in_progress_attempt;
             CREATE INDEX uq_single_in_progress_attempt ON practice_attempts(source_material_id);",
        )
        .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "same-name nonunique replacement was accepted"
        );
    }

    #[test]
    fn missing_version_column_refused() {
        let (f, c) = m2_archive_fixture();
        c.execute_batch("ALTER TABLE practice_test_versions DROP COLUMN model")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "missing version model column was accepted"
        );
    }

    #[test]
    fn null_completed_score_refused() {
        let (f, c) = m2_archive_fixture();
        let s = m2_start(&f, &c);
        m2_response(&f, &c, &s, 0, "10000000-0000-4000-8000-000000000002");
        crate::practice_sessions::save_practice_session_at(
            &f.0,
            &serde_json::json!({
                "action": "complete_attempt",
                "operationId": "10000000-0000-4000-8000-000000000003",
                "attemptId": s["attemptId"],
                "expectedRevision": 1
            }),
        )
        .unwrap();
        c.execute_batch("UPDATE practice_attempts SET score_percent=NULL")
            .unwrap();
        assert!(
            verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
            "null completed score was accepted"
        );
    }

    /// A legacy-format archive holding a real WAL-mode database and its WAL,
    /// with the WAL bytes passed through `edit` first. Returns (current root,
    /// archive path); the root holds her "current original row".
    fn sqlite_guard_fixture(label: &str, edit: impl Fn(Vec<u8>) -> Vec<u8>) -> (PathBuf, PathBuf) {
        let root = scratch(&format!("{label}-root"));
        let elsewhere = scratch(&format!("{label}-src"));
        write_database(&elsewhere.join(DB_FILES[0]), "selected checkpointed row");
        let conn = Connection::open(elsewhere.join(DB_FILES[0])).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute(
            "UPDATE audit_payload SET value = 'selected WAL-only row'",
            [],
        )
        .unwrap();
        let wal_bytes = edit(std::fs::read(elsewhere.join(DB_FILES[1])).unwrap());
        let edited = elsewhere.join("edited").join(DB_FILES[1]);
        std::fs::create_dir_all(edited.parent().unwrap()).unwrap();
        std::fs::write(&edited, wal_bytes).unwrap();
        let archive_path = elsewhere.join("guard.hfdbackup");
        let mut zip = ZipWriter::new(File::create(&archive_path).unwrap());
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(
            serde_json::to_string(&CompleteBackupManifest {
                format: ARCHIVE_FORMAT.into(),
                format_version: LEGACY_ARCHIVE_VERSION,
                app_version: "0.3.0".into(),
                created_at: 0,
                missing_at_export: vec![],
                detached_at_export: Vec::new(),
                schema_version: None,
                device_id: None,
                platform: None,
            })
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        add_file_to_archive(&mut zip, &elsewhere.join(DB_FILES[0]), DB_FILES[0]).unwrap();
        add_file_to_archive(&mut zip, &edited, DB_FILES[1]).unwrap();
        zip.finish().unwrap();
        drop(conn);
        write_database(&root.join(DB_FILES[0]), "current original row");
        (root, archive_path)
    }

    fn assert_refused_and_untouched(root: &Path, archive: &Path) {
        let err = stage_complete_restore_in(root, archive, "0.5.3").unwrap_err();
        assert!(
            err.contains("looks damaged") || err.contains("damaged"),
            "{err}"
        );
        assert!(!root.join(RESTORE_PENDING_DIR).exists());
        assert!(!root.join(DB_FILES[1]).exists());
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "current original row"
        );
    }

    #[test]
    fn sqlite_guard_matching_wal_still_restores() {
        let (root, archive) = sqlite_guard_fixture("sg-match", |wal| wal);
        stage_complete_restore_in(&root, &archive, "0.5.3").unwrap();
        apply_pending_restore_in(&root).unwrap();
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "selected WAL-only row"
        );
    }

    #[test]
    fn sqlite_guard_refuses_wal_with_different_page_size() {
        let (root, archive) = sqlite_guard_fixture("sg-size", |mut wal| {
            wal[8..12].copy_from_slice(&8192u32.to_be_bytes());
            wal
        });
        assert_refused_and_untouched(&root, &archive);
    }

    #[test]
    fn sqlite_guard_refuses_truncated_wal() {
        let (root, archive) = sqlite_guard_fixture("sg-short", |wal| wal[..20].to_vec());
        assert_refused_and_untouched(&root, &archive);
    }

    #[test]
    fn sqlite_guard_refuses_wal_with_bad_magic() {
        let (root, archive) = sqlite_guard_fixture("sg-magic", |mut wal| {
            wal[0] ^= 0xff;
            wal
        });
        assert_refused_and_untouched(&root, &archive);
    }

    #[test]
    fn sqlite_guard_refuses_mismatched_safety_copy() {
        let root = scratch("sg-local");
        write_database(&root.join(DB_FILES[0]), "current original row");
        let copy = backup_dir(&root).unwrap().join("manual-bad");
        std::fs::create_dir_all(&copy).unwrap();
        write_database(&copy.join(DB_FILES[0]), "copy row");
        let mut wal = vec![0u8; 64];
        wal[0..4].copy_from_slice(&0x377f_0682u32.to_be_bytes());
        wal[8..12].copy_from_slice(&1024u32.to_be_bytes());
        std::fs::write(copy.join(DB_FILES[1]), wal).unwrap();
        assert!(stage_local_restore_in(&root, "manual-bad").is_err());
        assert!(!root.join(RESTORE_PENDING_DIR).exists());
        assert_eq!(
            database_contents(&root.join(DB_FILES[0])),
            "current original row"
        );
    }

    #[test]
    fn valid_schema_11_archive_round_trip() {
        let (source_fixture, source_conn) = m2_archive_fixture();
        let s = m2_start(&source_fixture, &source_conn);
        m2_response(
            &source_fixture,
            &source_conn,
            &s,
            0,
            "10000000-0000-4000-8000-000000000002",
        );
        drop(source_conn);

        let backup_dir = scratch("schema-11-backup-out");
        let archive = backup_dir.join("schema11.hfdbackup");
        let info =
            create_consistent_complete_backup_with_retry(&source_fixture.0, &archive, "0.5.3")
                .unwrap();
        assert!(info.files >= 1);
        assert!(archive.is_file());

        let target_root = scratch("schema-11-restore-target");
        let staged = stage_complete_restore_in(&target_root, &archive, "0.5.3").unwrap();
        assert!(staged.files >= 1);

        apply_pending_restore_in(&target_root).unwrap();
        let restored_db = target_root.join(DB_FILES[0]);
        assert!(restored_db.is_file());
        assert!(verify_application_database(&restored_db).is_ok());

        let conn = Connection::open(&restored_db).unwrap();
        let version_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_test_versions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(version_count >= 1);
        let attempt_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_attempts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(attempt_count, 1);
        let response_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_responses", [], |r| r.get(0))
            .unwrap();
        assert_eq!(response_count, 1);

        let _ = std::fs::remove_dir_all(&backup_dir);
        let _ = std::fs::remove_dir_all(&target_root);
    }

    #[test]
    fn legacy_schema_10_archive_upgrade_round_trip() {
        let source_root = scratch("schema-10-source");
        let source_db = source_root.join(DB_FILES[0]);
        let conn = Connection::open(&source_db).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for migration in crate::migrations().iter().filter(|m| m.version <= 10) {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO _sqlx_migrations (version) VALUES (10);
             INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-10', 'Mat 10', '2026-10-01', '2026-10-01');
             INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at)
             VALUES ('mat-10', 'Title 10', '[{\"question\":\"Legacy Q\",\"options\":[\"A\",\"B\"],\"correctIndex\":0,\"explanation\":\"\",\"sourcePage\":null}]', 'local', 'synthetic', '2026-10-01', '2026-10-01');",
        )
        .unwrap();
        drop(conn);

        // Verify schema 10 source database passes validation
        assert!(verify_application_database(&source_db).is_ok());

        // Create backup of schema 10 database
        let backup_dir = scratch("schema-10-backup-out");
        let archive = backup_dir.join("schema10.hfdbackup");
        create_consistent_complete_backup_with_retry(&source_root, &archive, "0.5.3").unwrap();
        assert!(archive.is_file());

        // Restore into a target root
        let target_root = scratch("schema-10-upgrade-target");
        stage_complete_restore_in(&target_root, &archive, "0.5.3").unwrap();
        apply_pending_restore_in(&target_root).unwrap();

        let restored_db = target_root.join(DB_FILES[0]);
        assert!(verify_application_database(&restored_db).is_ok());

        // Apply migration 11 on the restored database
        let m11 = crate::migrations()
            .into_iter()
            .find(|m| m.version == 11)
            .unwrap();
        let conn = Connection::open(&restored_db).unwrap();
        conn.execute_batch(m11.sql).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations(version) VALUES (11);
             UPDATE _sqlx_migrations SET version = 11;",
        )
        .unwrap();
        drop(conn);

        // Run legacy conversion
        let converted = crate::practice_sessions::run_legacy_conversion_at(&target_root).unwrap();
        assert_eq!(converted, 1);

        // Now upgraded database must pass schema 11 invariant validation
        assert!(verify_application_database(&restored_db).is_ok());

        // Check active version created
        let conn = Connection::open(&restored_db).unwrap();
        let is_active: i64 = conn
            .query_row(
                "SELECT is_active FROM practice_test_versions WHERE source_material_id = 'mat-10'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(is_active, 1);

        let _ = std::fs::remove_dir_all(&source_root);
        let _ = std::fs::remove_dir_all(&backup_dir);
        let _ = std::fs::remove_dir_all(&target_root);
    }

    /// OFFLINE-03b r7 (a): her pre-authoring library survives the upgrade path.
    /// A schema-16 archive — one Gemini practice test with one completed
    /// attempt and one instructor-origin row — is backed up, staged, applied,
    /// and then takes the migrations it has not seen yet exactly as the app
    /// does on the next launch. The whole verification ladder passes on the
    /// upgraded database, the practice test reads back through the authoring
    /// reader with the content hash its version row already carried, the
    /// attempt survives and an authored test starts with an empty ledger.
    #[test]
    fn schema_16_archive_restores_and_upgrades_to_17() {
        let v1_questions = r#"[{"question":"Synthetic one","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#;
        let v2_questions = r#"[{"question":"Synthetic two","options":["A","B","C"],"correctIndex":2,"explanation":"Because C.","sourcePage":4}]"#;

        let source_root = scratch("schema-16-03b-source");
        let source_db = source_root.join(DB_FILES[0]);
        {
            let conn = Connection::open(&source_db).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            for migration in crate::migrations().iter().filter(|m| m.version <= 16) {
                conn.execute_batch(migration.sql).unwrap();
            }
            conn.execute_batch(
                "CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);
                 INSERT INTO _sqlx_migrations (version) VALUES (16);
                 INSERT INTO study_materials (id, title, created_at, updated_at)
                 VALUES ('mat-16', 'Synthetic sixteen', '2026-10-16T09:00:00.000Z', '2026-10-16T09:00:00.000Z');",
            )
            .unwrap();
        }

        // The test, one completed attempt against its first version, then a
        // regeneration. The instructor origin lands on the superseded version's
        // question, so the current test's hash stays the stored legacy hash.
        crate::practice_sessions::mark_root_ready(&source_root);
        crate::practice_sessions::save_practice_test_at(
            &source_root,
            "mat-16",
            "Synthetic sixteen",
            v1_questions,
            "synthetic",
        )
        .unwrap();
        let v1_id = {
            let conn = Connection::open(&source_db).unwrap();
            conn.query_row(
                "SELECT id FROM practice_test_versions WHERE source_material_id = 'mat-16' AND is_active = 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
        };
        let start = crate::practice_sessions::save_practice_session_at(
            &source_root,
            &serde_json::json!({
                "action": "start_or_resume",
                "operationId": "20000000-0000-4000-8000-000000000001",
                "materialId": "mat-16",
                "versionId": v1_id,
            }),
        )
        .unwrap();
        let v1_item = {
            let conn = Connection::open(&source_db).unwrap();
            conn.query_row(
                "SELECT id FROM practice_test_items WHERE version_id = ?1 ORDER BY ordinal",
                [&v1_id],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
        };
        crate::practice_sessions::save_practice_session_at(
            &source_root,
            &serde_json::json!({
                "action": "record_response",
                "operationId": "20000000-0000-4000-8000-000000000002",
                "attemptId": start["attemptId"],
                "itemId": v1_item.clone(),
                "expectedRevision": 0,
                "selectedIndex": 0,
                "isDontKnow": false,
            }),
        )
        .unwrap();
        crate::practice_sessions::save_practice_session_at(
            &source_root,
            &serde_json::json!({
                "action": "complete_attempt",
                "operationId": "20000000-0000-4000-8000-000000000003",
                "attemptId": start["attemptId"],
                "expectedRevision": 1,
            }),
        )
        .unwrap();
        crate::practice_sessions::save_practice_test_at(
            &source_root,
            "mat-16",
            "Synthetic sixteen",
            v2_questions,
            "synthetic",
        )
        .unwrap();
        let stored_hash = {
            let conn = Connection::open(&source_db).unwrap();
            let stored_hash: String = conn
                .query_row(
                    "SELECT content_hash FROM practice_test_versions WHERE source_material_id = 'mat-16' AND is_active = 1",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let v1_hash: String = conn
                .query_row(
                    "SELECT content_hash FROM practice_test_versions WHERE id = ?1",
                    [&v1_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_ne!(
                stored_hash, v1_hash,
                "the fixture must really span two versions"
            );
            conn.execute(
                "INSERT INTO practice_item_origins (item_id, origin) VALUES (?1, 'instructor')",
                [&v1_item],
            )
            .unwrap();
            stored_hash
        };

        // Still a schema-16 library: the ladder up to 16 accepts it.
        assert!(verify_application_database(&source_db).is_ok());

        let backup_dir = scratch("schema-16-03b-backup");
        let archive = backup_dir.join("schema16.hfdbackup");
        create_consistent_complete_backup_with_retry(&source_root, &archive, "0.6.0").unwrap();
        let target_root = scratch("schema-16-03b-target");
        stage_complete_restore_in(&target_root, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target_root).unwrap();
        let restored_db = target_root.join(DB_FILES[0]);
        assert!(restored_db.is_file());
        assert!(verify_application_database(&restored_db).is_ok());

        // The app's own upgrade step: every migration above the newest the
        // restored library records, in order, each one recorded as it lands.
        {
            let conn = Connection::open(&restored_db).unwrap();
            let applied: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(applied, 16);
            for migration in crate::migrations()
                .into_iter()
                .filter(|m| m.version > applied)
            {
                conn.execute_batch(migration.sql).unwrap();
                conn.execute(
                    "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
                    [migration.version],
                )
                .unwrap();
            }
        }

        // The whole ladder now runs the schema-17 authoring semantics too.
        assert!(
            verify_application_database(&restored_db).is_ok(),
            "a schema-16 archive upgraded to 17 must pass the application ladder"
        );

        let conn = Connection::open(&restored_db).unwrap();
        let current = crate::practice_authoring::read_current_snapshot(&conn, "mat-16")
            .unwrap()
            .expect("the restored practice test reads back through the authoring reader");
        assert_eq!(current.version_number, 2);
        assert_eq!(current.questions.len(), 1);
        assert_eq!(
            crate::practice_authoring::practice_content_hash(&current.questions),
            stored_hash,
            "the content hash must survive the archive and the upgrade unchanged"
        );
        let completed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM practice_attempts WHERE source_material_id = 'mat-16' AND status = 'completed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(completed, 1, "her completed attempt must survive");
        let origins: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_item_origins", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(origins, 1);
        assert!(
            current.retired.is_empty(),
            "a test she never authored starts with an empty ledger"
        );

        let _ = std::fs::remove_dir_all(&source_root);
        let _ = std::fs::remove_dir_all(&backup_dir);
        let _ = std::fs::remove_dir_all(&target_root);
    }

    // GEN-01b: disposable databases only; the same contract runs in both TS engines.
    fn pdf_kit_test_database(path: &Path, through: i64) {
        let conn = Connection::open(path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
            .unwrap();
        for migration in crate::migrations()
            .into_iter()
            .filter(|m| m.version <= through)
        {
            conn.execute_batch(migration.sql).unwrap();
            conn.execute(
                "INSERT INTO _sqlx_migrations VALUES (?1)",
                [migration.version],
            )
            .unwrap();
        }
    }

    fn pdf_kit_contract() -> serde_json::Value {
        serde_json::from_str(include_str!("../../fixtures/pdf-kit-validation/cases.json")).unwrap()
    }

    fn pdf_kit_seed(conn: &Connection) {
        for sql in pdf_kit_contract()["baseline"].as_array().unwrap() {
            conn.execute_batch(sql.as_str().unwrap()).unwrap();
        }
    }

    #[test]
    fn shared_pdf_kit_validation_contract_native_outcomes() {
        let contract = pdf_kit_contract();
        let mut mismatches = Vec::new();
        for case in contract["cases"].as_array().unwrap() {
            let root = scratch("pdf-kit-contract");
            let path = root.join(DB_FILES[0]);
            pdf_kit_test_database(&path, 18);
            {
                let conn = Connection::open(&path).unwrap();
                conn.pragma_update(None, "foreign_keys", "ON").unwrap();
                pdf_kit_seed(&conn);
                for sql in case["sql"].as_array().unwrap() {
                    conn.execute_batch(sql.as_str().unwrap()).unwrap();
                }
            }
            // Reopen: schema edits must take effect just as they do on app launch.
            let conn = Connection::open(&path).unwrap();
            let result = verify_schema_18_pdf_kit_semantics(&conn);
            let application = verify_application_database(&path);
            assert_eq!(
                application.is_ok(),
                result.is_ok(),
                "application ladder disagrees: {}",
                case["name"]
            );
            drop(conn);
            let outcome = if result.is_ok() { "accept" } else { "refuse" };
            if outcome != case["expect"].as_str().unwrap() {
                mismatches.push(format!("{}: {result:?}", case["name"]));
            }
            std::fs::remove_dir_all(root).unwrap();
        }
        assert!(mismatches.is_empty(), "{mismatches:#?}");
        assert!(contract["cases"].as_array().unwrap().len() >= 12);
    }

    #[test]
    fn schema_17_archive_restores_and_upgrades_to_18() {
        let root = scratch("kit17-source");
        let target = scratch("kit17-target");
        let path = root.join(DB_FILES[0]);
        pdf_kit_test_database(&path, 17);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('old','Synthetic','x','x')").unwrap();
        }
        assert!(verify_application_database(&path).is_ok());
        let backup_dir = scratch("kit-backup");
        let archive = backup_dir.join("schema17.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
        stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target).unwrap();
        let restored = target.join(DB_FILES[0]);
        assert!(verify_application_database(&restored).is_ok());
        {
            let conn = Connection::open(&restored).unwrap();
            assert_eq!(newest_migration_version(&conn).unwrap(), 17);
            assert_eq!(
                m3_count(
                    &conn,
                    "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'pdf_kit_%'",
                    &[]
                )
                .unwrap(),
                0
            );
            for migration in crate::migrations().into_iter().filter(|m| m.version > 17) {
                conn.execute_batch(migration.sql).unwrap();
                conn.execute(
                    "INSERT INTO _sqlx_migrations VALUES (?1)",
                    [migration.version],
                )
                .unwrap();
            }
            assert_eq!(
                newest_migration_version(&conn).unwrap(),
                crate::CURRENT_SCHEMA_VERSION
            );
            assert_eq!(
                m3_count(
                    &conn,
                    "SELECT COUNT(*) FROM study_materials WHERE id = 'old'",
                    &[]
                )
                .unwrap(),
                1
            );
            for table in ["pdf_kit_runs", "pdf_kit_item_sources"] {
                assert_eq!(
                    m3_count(&conn, &format!("SELECT COUNT(*) FROM {table}"), &[]).unwrap(),
                    0
                );
            }
        }
        assert!(verify_application_database(&restored).is_ok());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(backup_dir).unwrap();
        std::fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn schema_18_pdf_kit_archive_round_trip() {
        let root = scratch("kit18-source");
        let target = scratch("kit18-target");
        let path = root.join(DB_FILES[0]);
        pdf_kit_test_database(&path, 18);
        let before = {
            let conn = Connection::open(&path).unwrap();
            pdf_kit_seed(&conn);
            ["pdf_kit_runs", "pdf_kit_item_sources"].map(|table| {
                m3_rows(&conn, &format!("SELECT * FROM {table} ORDER BY rowid"), &[]).unwrap()
            })
        };
        let backup_dir = scratch("kit-backup");
        let archive = backup_dir.join("schema18.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
        stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target).unwrap();
        let restored = target.join(DB_FILES[0]);
        assert!(verify_application_database(&restored).is_ok());
        {
            let conn = Connection::open(&restored).unwrap();
            assert_eq!(newest_migration_version(&conn).unwrap(), 18);
            let after = ["pdf_kit_runs", "pdf_kit_item_sources"].map(|table| {
                m3_rows(&conn, &format!("SELECT * FROM {table} ORDER BY rowid"), &[]).unwrap()
            });
            assert_eq!(before, after);
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            conn.execute("DELETE FROM study_materials WHERE id = 'mat-kit'", [])
                .unwrap();
            for table in ["pdf_kit_runs", "pdf_kit_item_sources"] {
                assert_eq!(
                    m3_count(&conn, &format!("SELECT COUNT(*) FROM {table}"), &[]).unwrap(),
                    0
                );
            }
        }
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(backup_dir).unwrap();
        std::fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn faa_shelf_complete_backup_restores_books_addendum_notes_and_bookmarks() {
        use lopdf::{dictionary, Document, Object};
        let root = scratch("faa-shelf-source");
        let target = scratch("faa-shelf-target");
        let backup = scratch("faa-shelf-backup");
        let db = root.join(DB_FILES[0]);
        pdf_kit_test_database(&db, crate::CURRENT_SCHEMA_VERSION);
        std::fs::create_dir_all(root.join(DOCUMENTS_DIR)).unwrap();
        let conn = Connection::open(&db).unwrap();
        let mut copies = Vec::new();
        // Authored one-page PDFs, never real FAA publications. Include an older edition.
        for (index, reference, edition) in [
            (0, "Private Pilot Airplane ACS", "FAA-S-ACS-6B"),
            (1, "Private Pilot Airplane ACS", "FAA-S-ACS-6C"),
            (
                2,
                "Pilot’s Handbook of Aeronautical Knowledge (PHAK)",
                "FAA-H-8083-25C",
            ),
            (3, "PHAK addendum", "FAA-H-8083-25C · MOSAIC addendum"),
        ] {
            let mut pdf = Document::with_version("1.5");
            let pages = pdf.new_object_id();
            let page = pdf.add_object(dictionary! {
                "Type" => "Page", "Parent" => pages,
                "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
            });
            pdf.objects.insert(
                pages,
                Object::Dictionary(dictionary! {
                    "Type" => "Pages", "Count" => 1, "Kids" => vec![Object::Reference(page)],
                }),
            );
            let catalog = pdf.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
            pdf.trailer.set("Root", catalog);
            pdf.trailer.set(
                "Info",
                Object::Dictionary(dictionary! {
                    "Title" => Object::string_literal(format!("Synthetic shelf {index}")),
                }),
            );
            let mut bytes = Vec::new();
            pdf.save_to(&mut bytes).unwrap();
            let (hash, count) = crate::navigation::identity_of_bytes(&bytes).unwrap();
            let notes = format!(
                "FAA reference: {reference}\nSaved edition: {edition}\nLocal copy SHA-256: {hash}\nLocal copy pages: {count}\nEdition not checked.\nMy synthetic reference note."
            );
            let id = format!("shelf-{index}");
            let file = format!("faa-shelf-{index}.pdf");
            std::fs::write(root.join(DOCUMENTS_DIR).join(&file), &bytes).unwrap();
            conn.execute("INSERT INTO study_materials (id,title,material_type,review_status,notes,file_path,original_file_name,file_size,created_at,updated_at) VALUES (?1,?2,'reference','reference_only',?3,?4,'synthetic.pdf',?5,'2026-10-28','2026-10-28')",
                params![id, format!("Synthetic {edition}"), notes, file, bytes.len() as i64]).unwrap();
            conn.execute("INSERT INTO material_bookmarks (id,material_id,page_index,title,notes,status,created_at,updated_at) VALUES (?1,?2,1,'My place','Keep this note','unverified','now','now')",params![format!("bookmark-{index}"), id]).unwrap();
            copies.push((id, file, bytes, notes));
        }
        let before = m3_rows(&conn, "SELECT * FROM study_materials ORDER BY id", &[]).unwrap();
        let bookmarks =
            m3_rows(&conn, "SELECT * FROM material_bookmarks ORDER BY id", &[]).unwrap();
        drop(conn);
        let archive = backup.join("shelf.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
        stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target).unwrap();
        verify_application_database(&target.join(DB_FILES[0])).unwrap();
        let restored = Connection::open(target.join(DB_FILES[0])).unwrap();
        assert_eq!(
            before,
            m3_rows(&restored, "SELECT * FROM study_materials ORDER BY id", &[]).unwrap()
        );
        assert_eq!(
            bookmarks,
            m3_rows(
                &restored,
                "SELECT * FROM material_bookmarks ORDER BY id",
                &[]
            )
            .unwrap()
        );
        for (id, file, bytes, notes) in copies {
            assert_eq!(
                std::fs::read(target.join(DOCUMENTS_DIR).join(file)).unwrap(),
                bytes
            );
            let preview = crate::study_page_sources::preview_on(&restored, &target, &id)
                .unwrap()
                .unwrap();
            assert_eq!(preview.total_pages, 1);
            assert!(notes.contains(&preview.content_sha256));
        }
        drop(restored);
        for path in [root, target, backup] {
            std::fs::remove_dir_all(path).unwrap();
        }
    }

    #[test]
    fn acs_task_backup_round_trip_and_older_backup_upgrade() {
        for old in [false, true] {
            let root = scratch("acs-backup");
            let target = scratch("acs-target");
            let backup = scratch("acs-archive");
            let path = root.join(DB_FILES[0]);
            pdf_kit_test_database(
                &path,
                if old {
                    27
                } else {
                    crate::CURRENT_SCHEMA_VERSION
                },
            );
            let conn = Connection::open(&path).unwrap();
            conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('mat-a','Synthetic','now','now')", []).unwrap();
            let mut operation = serde_json::json!({
                "operationId":"fa000000-0000-4000-8000-0000000000e0", "sourceMaterialId":"mat-a",
                "reason":"create", "expected":null,
                "next":{"title":"Synthetic", "provider":"gemini", "model":"synthetic", "retired":[],
                    "questions":[{"identity":"fa000000-0000-4000-8000-0000000000e1", "question":"Synthetic question",
                        "options":["First","Second"], "correctIndex":0, "explanation":"Synthetic explanation", "sourcePage":null}]}
            });
            if !old {
                operation["next"]["questions"][0]["acsTask"] = serde_json::json!("PA.II.A");
            }
            crate::practice_authoring::save_practice_authoring_at(&root, &operation).unwrap();
            verify_application_connection(&conn).unwrap();
            drop(conn);
            let archive = backup.join("acs.hfdbackup");
            create_consistent_complete_backup_with_retry(&root, &archive, "0.6.6").unwrap();
            stage_complete_restore_in(&target, &archive, "0.6.6").unwrap();
            apply_pending_restore_in(&target).unwrap();
            let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
            if old {
                assert!(!crate::acs_tasks::table_exists(&conn).unwrap());
                for migration in crate::migrations().into_iter().filter(|m| m.version > 27) {
                    conn.execute_batch(migration.sql).unwrap();
                    conn.execute(
                        "INSERT INTO _sqlx_migrations VALUES (?1)",
                        [migration.version],
                    )
                    .unwrap();
                }
            }
            verify_application_connection(&conn).unwrap();
            let snapshot = crate::practice_authoring::read_current_snapshot(&conn, "mat-a")
                .unwrap()
                .unwrap();
            assert_eq!(
                snapshot.questions[0].acs_task.as_deref(),
                if old { None } else { Some("PA.II.A") }
            );
            if !old {
                conn.execute("UPDATE practice_item_acs_tasks SET acs_task='PA.II.Z'", [])
                    .unwrap();
                verify_application_connection(&conn).expect("unknown tag must not block restore");
                let snapshot = crate::practice_authoring::read_current_snapshot(&conn, "mat-a")
                    .unwrap()
                    .unwrap();
                assert_eq!(snapshot.questions[0].acs_task, None);
            }
            drop(conn);
            for path in [root, target, backup] {
                std::fs::remove_dir_all(path).unwrap();
            }
        }
    }

    #[test]
    fn backup_round_trip_keeps_kit_sources() {
        let root = scratch("kit-saved-source");
        let target = scratch("kit-saved-target");
        let path = root.join(DB_FILES[0]);
        pdf_kit_test_database(&path, crate::CURRENT_SCHEMA_VERSION);
        let before = {
            let mut conn = Connection::open(&path).unwrap();
            conn.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('mat-a','Synthetic','now','now')",[]).unwrap();
            let practice: serde_json::Value = serde_json::from_str(include_str!(
                "../../../src/testing/practiceAuthoringVectors.json"
            ))
            .unwrap();
            let op = &practice["scenarios"]
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["name"] == "pdf-kit-receipt-and-edit-lineage")
                .unwrap()["steps"][0]["operation"];
            crate::practice_authoring::execute_practice_authoring(&mut conn, op).unwrap();
            let study: serde_json::Value = serde_json::from_str(include_str!(
                "../../../src/testing/pdfKitStudySaveVectors.json"
            ))
            .unwrap();
            crate::study_sets::save_on(
                &mut conn,
                &crate::study_sets::decode_operation(&study[0]["operation"]).unwrap(),
                "2026-10-20T02:00:00.000Z",
            )
            .unwrap();
            [
                "pdf_kit_runs",
                "pdf_kit_item_sources",
                "practice_save_operations",
                "study_set_save_operations",
            ]
            .map(|t| m3_rows(&conn, &format!("SELECT * FROM {t} ORDER BY rowid"), &[]).unwrap())
        };
        assert_eq!(before[0].len(), 1);
        assert_eq!(before[1].len(), 2);
        assert_eq!(before[2].len(), 1);
        assert_eq!(before[3].len(), 1);
        verify_application_database(&path).unwrap();
        let backup = scratch("kit-saved-backup");
        let archive = backup.join("saved.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
        stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target).unwrap();
        verify_application_database(&target.join(DB_FILES[0])).unwrap();
        let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
        let after = [
            "pdf_kit_runs",
            "pdf_kit_item_sources",
            "practice_save_operations",
            "study_set_save_operations",
        ]
        .map(|t| m3_rows(&conn, &format!("SELECT * FROM {t} ORDER BY rowid"), &[]).unwrap());
        assert_eq!(before, after);
        drop(conn);
        for p in [root, target, backup] {
            std::fs::remove_dir_all(p).unwrap();
        }
    }

    #[test]
    fn tampered_schema_18_pdf_kit_archive_refused() {
        for sql in [
            "UPDATE pdf_kit_item_sources SET run_id = 'missing'",
            "UPDATE pdf_kit_runs SET content_sha256 = 'bad'",
            "UPDATE pdf_kit_item_sources SET content_hash = 'bad'",
            "UPDATE pdf_kit_item_sources SET page = 1001",
            "UPDATE pdf_kit_item_sources SET end_offset = start_offset",
        ] {
            let root = scratch("kit18-tampered");
            let target = scratch("kit18-refused-target");
            let path = root.join(DB_FILES[0]);
            pdf_kit_test_database(&path, 18);
            let backup_dir = scratch("kit-backup");
            let archive = backup_dir.join("tampered.hfdbackup");
            {
                let conn = Connection::open(&path).unwrap();
                pdf_kit_seed(&conn);
            }
            create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
            {
                let conn = Connection::open(&path).unwrap();
                conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
                conn.pragma_update(None, "ignore_check_constraints", "ON")
                    .unwrap();
                conn.execute_batch(sql).unwrap();
            }
            // Rebind archive integrity so refusal reaches database semantics,
            // rather than merely detecting changed ZIP bytes.
            let bytes = std::fs::read(&path).unwrap();
            rewrite_entry(&archive, DB_FILES[0], &bytes);
            let mut integrity: CompleteBackupIntegrity = {
                let mut zip = ZipArchive::new(File::open(&archive).unwrap()).unwrap();
                serde_json::from_reader(zip.by_name(ARCHIVE_INTEGRITY).unwrap()).unwrap()
            };
            let entry = integrity
                .files
                .iter_mut()
                .find(|e| e.path == DB_FILES[0])
                .unwrap();
            entry.bytes = bytes.len() as u64;
            entry.sha256 = sha256_digest(&bytes);
            rewrite_entry(
                &archive,
                ARCHIVE_INTEGRITY,
                &serde_json::to_vec(&integrity).unwrap(),
            );
            let conn = Connection::open(&path).unwrap();
            assert!(
                verify_schema_18_pdf_kit_semantics(&conn).is_err(),
                "accepted semantics: {sql}"
            );
            drop(conn);
            let error = inspect_archive(&target, &archive, "0.6.0").unwrap_err();
            assert!(
                !error.contains("integrity"),
                "did not reach the native database verifier: {error}"
            );
            assert!(
                stage_complete_restore_in(&target, &archive, "0.6.0").is_err(),
                "staged tampering: {sql}"
            );
            assert!(!target.join(DB_FILES[0]).exists());
            std::fs::remove_dir_all(root).unwrap();
            std::fs::remove_dir_all(backup_dir).unwrap();
            std::fs::remove_dir_all(target).unwrap();
        }
    }

    /// OFFLINE-03b r7 (b): an authored schema-17 archive round-trips whole.
    /// Create, edit (carrying the exact retirement record) and an instructor
    /// correction all go through `practice_authoring::save_practice_authoring_at`.
    /// The restored library reads back the same snapshot field for field and
    /// keeps every receipt and history row, and replaying the exact edit
    /// operation there is recognised as the same committed operation —
    /// `already_saved`, not a second version.
    #[test]
    fn schema_17_authored_archive_round_trip() {
        use crate::practice_authoring::{
            decode_question, practice_retirement_record, read_current_snapshot,
            retirement_record_value, save_practice_authoring_at, snapshot_value,
        };

        let identity_one = "e1000000-0000-4000-8000-000000000001";
        let identity_two = "e2000000-0000-4000-8000-000000000002";
        let question = |identity: &str, stem: &str, origin: Option<&str>| {
            let mut value = serde_json::json!({
                "question": stem,
                "options": ["An ATC clearance", "A flight plan only", "Nothing"],
                "correctIndex": 0,
                "explanation": "Clearance before entering.",
                "sourcePage": 12,
                "identity": identity,
            });
            if let Some(origin) = origin {
                value
                    .as_object_mut()
                    .unwrap()
                    .insert("origin".to_string(), serde_json::json!(origin));
            }
            value
        };
        let next = |questions: Vec<serde_json::Value>, retired: Vec<serde_json::Value>| {
            serde_json::json!({
                "title": "Class B study aid",
                "provider": "manual",
                "model": "",
                "questions": questions,
                "retired": retired,
            })
        };
        let operation = |operation_id: &str,
                         reason: &str,
                         expected: serde_json::Value,
                         next: Option<serde_json::Value>| {
            serde_json::json!({
                "operationId": operation_id,
                "sourceMaterialId": "mat-a",
                "reason": reason,
                "expected": expected,
                "next": next.unwrap_or(serde_json::Value::Null),
            })
        };
        let retirement = |question: &serde_json::Value, reason: &str| {
            retirement_record_value(&practice_retirement_record(
                &decode_question(question).unwrap(),
                reason,
            ))
        };
        let current_json = |root: &Path| -> serde_json::Value {
            let conn = Connection::open(root.join(DB_FILES[0])).unwrap();
            let value = read_current_snapshot(&conn, "mat-a")
                .unwrap()
                .map(|snapshot| snapshot_value(&snapshot))
                .unwrap_or(serde_json::Value::Null);
            drop(conn);
            value
        };
        let count = |conn: &Connection, sql: &str| -> i64 {
            conn.query_row(sql, [], |r| r.get(0)).unwrap()
        };

        let source_root = scratch("schema-17-03b-source");
        let source_db = source_root.join(DB_FILES[0]);
        {
            let conn = Connection::open(&source_db).unwrap();
            conn.pragma_update(None, "foreign_keys", "ON").unwrap();
            for migration in crate::migrations() {
                conn.execute_batch(migration.sql).unwrap();
            }
            conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
                .unwrap();
            for migration in crate::migrations() {
                conn.execute(
                    "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
                    [migration.version],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat-a', 'Class B clearances', '2026-10-19T09:00:00.000Z', '2026-10-19T09:00:00.000Z')",
                [],
            )
            .unwrap();
        }

        let first = question(identity_one, "What does entry into Class B require?", None);
        let second = question(identity_two, "What is the usual vertical limit?", None);
        save_practice_authoring_at(
            &source_root,
            &operation(
                "e0000000-0000-4000-8000-000000000001",
                "create",
                serde_json::Value::Null,
                Some(next(vec![first.clone(), second.clone()], vec![])),
            ),
        )
        .unwrap();

        let first_rewritten = question(
            identity_one,
            "What must you have before entering Class B?",
            None,
        );
        let edit = operation(
            "e0000000-0000-4000-8000-000000000002",
            "edit",
            current_json(&source_root),
            Some(next(
                vec![first_rewritten.clone(), second.clone()],
                vec![retirement(&first, "corrected")],
            )),
        );
        save_practice_authoring_at(&source_root, &edit).unwrap();

        let second_rewritten = question(
            identity_two,
            "Class B normally tops out at what altitude?",
            Some("instructor"),
        );
        save_practice_authoring_at(
            &source_root,
            &operation(
                "e0000000-0000-4000-8000-000000000003",
                "correct",
                current_json(&source_root),
                Some(next(
                    vec![first_rewritten, second_rewritten],
                    vec![
                        retirement(&first, "corrected"),
                        retirement(&second, "corrected"),
                    ],
                )),
            ),
        )
        .unwrap();

        let source_conn = Connection::open(&source_db).unwrap();
        let source_snapshot = read_current_snapshot(&source_conn, "mat-a").unwrap();
        let source_receipts = count(
            &source_conn,
            "SELECT COUNT(*) FROM practice_save_operations",
        );
        let source_history = count(
            &source_conn,
            "SELECT COUNT(*) FROM study_set_history WHERE kind = 'practice'",
        );
        drop(source_conn);
        assert!(verify_application_database(&source_db).is_ok());

        let backup_dir = scratch("schema-17-03b-backup");
        let archive = backup_dir.join("schema17.hfdbackup");
        create_consistent_complete_backup_with_retry(&source_root, &archive, "0.6.0").unwrap();
        let target_root = scratch("schema-17-03b-target");
        stage_complete_restore_in(&target_root, &archive, "0.6.0").unwrap();
        apply_pending_restore_in(&target_root).unwrap();
        let restored_db = target_root.join(DB_FILES[0]);
        assert!(verify_application_database(&restored_db).is_ok());

        let restored_conn = Connection::open(&restored_db).unwrap();
        let restored_snapshot = read_current_snapshot(&restored_conn, "mat-a").unwrap();
        assert_eq!(
            restored_snapshot, source_snapshot,
            "the restored authored test must equal the source field for field"
        );
        assert_eq!(
            count(
                &restored_conn,
                "SELECT COUNT(*) FROM practice_save_operations"
            ),
            source_receipts
        );
        assert_eq!(
            count(
                &restored_conn,
                "SELECT COUNT(*) FROM study_set_history WHERE kind = 'practice'"
            ),
            source_history
        );
        assert_eq!(source_receipts, 3);
        assert_eq!(source_history, 2);
        drop(restored_conn);

        // The exact edit operation replayed against the restored library is the
        // same committed operation, so it changes nothing and says so.
        let replay = save_practice_authoring_at(&target_root, &edit).unwrap();
        assert_eq!(replay.status, "already_saved");
        let after = Connection::open(&restored_db).unwrap();
        assert_eq!(
            count(&after, "SELECT COUNT(*) FROM practice_save_operations"),
            source_receipts
        );
        assert_eq!(
            read_current_snapshot(&after, "mat-a").unwrap(),
            restored_snapshot
        );
        drop(after);

        let _ = std::fs::remove_dir_all(&source_root);
        let _ = std::fs::remove_dir_all(&backup_dir);
        let _ = std::fs::remove_dir_all(&target_root);
    }

    #[test]
    fn interrupted_conversion_preserves_state_and_safe_retry() {
        let root = scratch("interrupted-conversion");
        let db_path = root.join(DB_FILES[0]);
        let conn = Connection::open(&db_path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for migration in crate::migrations() {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations(version) VALUES (11);
             INSERT INTO study_materials(id, title, created_at, updated_at) VALUES('mat-retry', 'Retry Title', '2026-10-04', '2026-10-04');
             INSERT INTO practice_tests(source_material_id, title, questions_json, provider, model, generated_at, updated_at)
             VALUES('mat-retry', 'Retry Test', '[{\"question\":\"Retry Q\",\"options\":[\"A\",\"B\"],\"correctIndex\":0,\"explanation\":\"\",\"sourcePage\":null}]', 'local', 'synthetic', '2026-10-04', '2026-10-04');",
        )
        .unwrap();

        // Inject trigger that aborts item insertion during conversion
        conn.execute_batch(
            "CREATE TRIGGER abort_conversion_items BEFORE INSERT ON practice_test_items
             BEGIN
                 SELECT RAISE(ABORT, 'synthetic interruption during conversion');
             END;",
        )
        .unwrap();
        drop(conn);

        // Attempt conversion: must fail and rollback cleanly
        let err = crate::practice_sessions::run_legacy_conversion_at(&root).unwrap_err();
        assert!(err.contains("synthetic interruption"));

        // Verify preserved prior state: nothing partially written into versions/items
        let conn = Connection::open(&db_path).unwrap();
        let ver_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_test_versions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            ver_count, 0,
            "Versions must be rolled back on conversion interruption"
        );
        let item_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_test_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            item_count, 0,
            "Items must be rolled back on conversion interruption"
        );
        let (migrated_at, legacy_err): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT legacy_migrated_at, legacy_error FROM practice_tests WHERE source_material_id = 'mat-retry'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(migrated_at.is_none());
        assert!(legacy_err.is_none());

        // Remove synthetic block and retry conversion safely
        conn.execute_batch("DROP TRIGGER abort_conversion_items;")
            .unwrap();
        drop(conn);

        let converted = crate::practice_sessions::run_legacy_conversion_at(&root).unwrap();
        assert_eq!(converted, 1, "Retry must convert successfully");

        // Verify safe retry completed
        let conn = Connection::open(&db_path).unwrap();
        let ver_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_test_versions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(ver_count, 1);
        let (migrated_at, legacy_err): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT legacy_migrated_at, legacy_error FROM practice_tests WHERE source_material_id = 'mat-retry'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(migrated_at.is_some());
        assert!(legacy_err.is_none());
        drop(conn);

        // Complete database now passes schema 11 verification
        assert!(verify_application_database(&db_path).is_ok());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn interrupted_restore_preserves_prior_state_and_safe_retry() {
        let (orig_fixture, orig_conn) = m2_archive_fixture();
        drop(orig_conn);
        let orig_hash = sha256_digest(&std::fs::read(orig_fixture.0.join(DB_FILES[0])).unwrap());

        // Create a new backup archive to restore
        let (new_fixture, new_conn) = m2_archive_fixture();
        let s = m2_start(&new_fixture, &new_conn);
        m2_response(
            &new_fixture,
            &new_conn,
            &s,
            0,
            "10000000-0000-4000-8000-000000000002",
        );
        drop(new_conn);

        let backup_dir = scratch("interrupted-restore-archive");
        let archive = backup_dir.join("new.hfdbackup");
        create_consistent_complete_backup_with_retry(&new_fixture.0, &archive, "0.5.3").unwrap();

        // Stage restore into orig_fixture
        stage_complete_restore_in(&orig_fixture.0, &archive, "0.5.3").unwrap();

        // 1. Interrupted restore due to fault during install
        {
            let _guard = ScopedFault::set(InjectedFault::InstallDbRename(0));
            let res = apply_pending_restore_in_internal(&orig_fixture.0, || Ok(())).unwrap();
            assert!(
                matches!(res, RestoreApplicationResult::Recovered(_)),
                "Interrupted restore must rollback and recover: {res:?}"
            );
        }

        // Verify original prior state is completely preserved
        assert_eq!(
            sha256_digest(&std::fs::read(orig_fixture.0.join(DB_FILES[0])).unwrap()),
            orig_hash,
            "Original database must be intact after interrupted restore"
        );

        // 2. Safe retry: stage again and apply without fault
        stage_complete_restore_in(&orig_fixture.0, &archive, "0.5.3").unwrap();
        let res_retry = apply_pending_restore_in_internal(&orig_fixture.0, || Ok(())).unwrap();
        assert!(
            matches!(res_retry, RestoreApplicationResult::Installed),
            "Safe retry must succeed and install: {res_retry:?}"
        );

        // Restored database is valid schema 11 and has the restored response
        let restored_db = orig_fixture.0.join(DB_FILES[0]);
        assert!(verify_application_database(&restored_db).is_ok());
        let conn = Connection::open(&restored_db).unwrap();
        let response_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM practice_responses", [], |r| r.get(0))
            .unwrap();
        assert_eq!(response_count, 1);

        let _ = std::fs::remove_dir_all(&backup_dir);
    }

    mod codex_m2_final_review {
        use super::*;
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        fn fixture() -> (Fixture, Connection) {
            let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "m2-codex-rereview-{}-{}-{}",
                std::process::id(),
                seq,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&root).unwrap();
            let c = Connection::open(root.join("her-flight-deck.db")).unwrap();
            c.pragma_update(None, "foreign_keys", "ON").unwrap();
            for m in crate::migrations() {
                c.execute_batch(m.sql).unwrap();
            }
            c.execute_batch(
                "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(11);INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('mat','Synthetic','2026-10-04','2026-10-04');",
            )
            .unwrap();
            crate::practice_sessions::mark_root_ready(&root);
            crate::practice_sessions::save_practice_test_at(
                &root,
                "mat",
                "Synthetic",
                r#"[{"question":"Synthetic","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#,
                "synthetic",
            )
            .unwrap();
            (Fixture(root), c)
        }
        fn start(f: &Fixture, c: &Connection) -> serde_json::Value {
            let v: String = c
                .query_row("SELECT id FROM practice_test_versions", [], |r| r.get(0))
                .unwrap();
            crate::practice_sessions::save_practice_session_at(
                &f.0,
                &serde_json::json!({"action":"start_or_resume","operationId":"20000000-0000-4000-8000-000000000001","materialId":"mat","versionId":v}),
            )
            .unwrap()
        }
        fn record(f: &Fixture, c: &Connection, s: &serde_json::Value) {
            let i: String = c
                .query_row("SELECT id FROM practice_test_items", [], |r| r.get(0))
                .unwrap();
            crate::practice_sessions::save_practice_session_at(
                &f.0,
                &serde_json::json!({"action":"record_response","operationId":"20000000-0000-4000-8000-000000000002","attemptId":s["attemptId"],"itemId":i,"expectedRevision":0,"selectedIndex":1,"isDontKnow":false}),
            )
            .unwrap();
        }
        #[test]
        fn unique_index_wrong_key_refused() {
            let (f, c) = fixture();
            c.execute_batch("DROP INDEX uq_single_in_progress_attempt;CREATE UNIQUE INDEX uq_single_in_progress_attempt ON practice_attempts(id) WHERE status = 'in_progress' AND source_material_id IS NOT NULL").unwrap();
            assert!(
                verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
                "same-name UNIQUE index on id was accepted instead of material key"
            );
        }
        #[test]
        fn no_op_ownership_trigger_refused() {
            let (f, c) = fixture();
            c.execute_batch("DROP TRIGGER trg_enforce_response_item_version_insert;CREATE TRIGGER trg_enforce_response_item_version_insert BEFORE INSERT ON practice_responses BEGIN SELECT 1;END;").unwrap();
            assert!(
                verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
                "same-name no-op ownership trigger was accepted"
            );
        }
        #[test]
        fn receipt_wrong_frozen_version_refused() {
            let (f, c) = fixture();
            start(&f, &c);
            c.execute_batch("UPDATE practice_session_operations SET result_json=json_set(result_json,'$.versionId','missing-version')").unwrap();
            assert!(
                verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
                "receipt result for wrong frozen version was accepted"
            );
        }
        #[test]
        fn in_progress_false_totals_refused() {
            let (f, c) = fixture();
            start(&f, &c);
            c.execute_batch("UPDATE practice_attempts SET total_questions=99,answered_count=88")
                .unwrap();
            assert!(
                verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),
                "one-question unfinished attempt with 99 total/88 answered was accepted"
            );
        }
        #[test]
        fn startup_conversion_and_native_write_refuse_invalid_state() {
            let (f, c) = fixture();
            let s = start(&f, &c);
            record(&f, &c, &s);
            c.execute_batch("UPDATE practice_responses SET selected_index=99")
                .unwrap();
            assert!(verify_application_database(&f.0.join("her-flight-deck.db")).is_err());
            let conversion = crate::practice_sessions::run_legacy_conversion_at(&f.0);
            let v: String = c
                .query_row("SELECT id FROM practice_test_versions", [], |r| r.get(0))
                .unwrap();
            let write = crate::practice_sessions::save_practice_session_at(
                &f.0,
                &serde_json::json!({"action":"start_or_resume","operationId":"20000000-0000-4000-8000-000000000003","materialId":"mat","versionId":v}),
            );
            assert!(
                conversion.is_err() || write.is_err(),
                "startup conversion and direct session write both succeed for validator-refused state"
            );
        }
    }

    #[test]
    fn only_a_completed_restore_asks_for_the_window_to_come_forward() {
        assert_eq!(
            startup_restore_outcome(StartupRestoreDecision::RestoreCompleted),
            Ok(true)
        );
        assert_eq!(
            startup_restore_outcome(StartupRestoreDecision::ProceedNormally),
            Ok(false)
        );
        assert_eq!(
            startup_restore_outcome(StartupRestoreDecision::StagingRefusedUnchanged {
                reason: "damaged".to_string()
            }),
            Ok(false)
        );
        assert_eq!(
            startup_restore_outcome(StartupRestoreDecision::RolledBackRecovered {
                reason: "disk full".to_string()
            }),
            Ok(false)
        );
    }

    #[test]
    fn an_unresolved_restore_still_blocks_startup() {
        let outcome = startup_restore_outcome(StartupRestoreDecision::BlockedUnresolved {
            reason: "active data obstructed".to_string(),
            recovery_folder: Some(PathBuf::from(
                "/tmp/hfd/backups/2026-10-16-035630-before-restore",
            )),
        });
        let message = outcome.expect_err("an ambiguous restore must block startup");
        assert!(message.starts_with("Startup blocked to prevent data loss: active data obstructed"));
        assert!(message.contains("2026-10-16-035630-before-restore"));
    }

    #[derive(Debug, PartialEq, Eq, Clone)]
    enum OpenerCall {
        Reveal(PathBuf),
        OpenPath(PathBuf),
    }

    #[derive(Default)]
    struct TestFolderOpener {
        calls: std::sync::Mutex<Vec<OpenerCall>>,
        fail_with: Option<String>,
    }

    impl FolderOpener for TestFolderOpener {
        fn reveal_item_in_dir(&self, path: &Path) -> Result<(), String> {
            self.calls
                .lock()
                .unwrap()
                .push(OpenerCall::Reveal(path.to_path_buf()));
            match &self.fail_with {
                Some(err) => Err(err.clone()),
                None => Ok(()),
            }
        }

        fn open_path(&self, path: &Path) -> Result<(), String> {
            self.calls
                .lock()
                .unwrap()
                .push(OpenerCall::OpenPath(path.to_path_buf()));
            match &self.fail_with {
                Some(err) => Err(err.clone()),
                None => Ok(()),
            }
        }
    }

    #[test]
    fn item_to_reveal_distinguishes_content_emptiness_and_errors() {
        let root = std::env::temp_dir().join(format!("hfd-reveal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // An empty folder has nothing inside, so the folder itself is selected in its parent.
        assert_eq!(item_to_reveal_in(&root).unwrap(), root);

        // Without the database, the first item in name order is selected.
        std::fs::create_dir_all(root.join("documents")).unwrap();
        std::fs::create_dir_all(root.join("backups")).unwrap();
        assert_eq!(item_to_reveal_in(&root).unwrap(), root.join("backups"));

        // The database is preferred whenever it is there.
        std::fs::write(root.join(DB_FILES[0]), b"db").unwrap();
        assert_eq!(item_to_reveal_in(&root).unwrap(), root.join(DB_FILES[0]));

        // A missing folder or inspection failure returns Err instead of None.
        assert!(item_to_reveal_in(&root.join("missing")).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn open_data_folder_routes_command_through_opener_adapter() {
        let root = scratch("open-routing.app");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // 1. Empty .app root on macOS reveals the directory itself (not open_path).
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, true, &opener);
        assert!(result.is_ok());
        assert_eq!(
            opener.calls.lock().unwrap().as_slice(),
            &[OpenerCall::Reveal(root.clone())]
        );

        // 2. Database-absent, nonempty root on macOS reveals the first child.
        std::fs::create_dir_all(root.join("documents")).unwrap();
        std::fs::create_dir_all(root.join("backups")).unwrap();
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, true, &opener);
        assert!(result.is_ok());
        assert_eq!(
            opener.calls.lock().unwrap().as_slice(),
            &[OpenerCall::Reveal(root.join("backups"))]
        );

        // 3. Database-present root on macOS reveals the database file.
        std::fs::write(root.join(DB_FILES[0]), b"db").unwrap();
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, true, &opener);
        assert!(result.is_ok());
        assert_eq!(
            opener.calls.lock().unwrap().as_slice(),
            &[OpenerCall::Reveal(root.join(DB_FILES[0]))]
        );

        // 4. Listing error on missing root returns an inspection error and dispatches nothing.
        let missing = root.join("missing_dir.app");
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&missing, true, &opener);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.starts_with(&format!("Could not open {}", missing.display())),
            "unexpected error: {err}"
        );
        assert!(
            opener.calls.lock().unwrap().is_empty(),
            "opener should not be called on listing error"
        );

        // 5. Non-macOS platforms route directly to open_path.
        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, false, &opener);
        assert!(result.is_ok());
        assert_eq!(
            opener.calls.lock().unwrap().as_slice(),
            &[OpenerCall::OpenPath(root.clone())]
        );

        // 6. Opener failure is formatted with "Could not open <root>: <err>".
        let opener = TestFolderOpener {
            calls: std::sync::Mutex::new(Vec::new()),
            fail_with: Some("access denied".to_string()),
        };
        let result = open_data_folder_with(&root, true, &opener);
        assert_eq!(
            result,
            Err(format!("Could not open {}: access denied", root.display()))
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn open_data_folder_handles_permission_denied_listing() {
        use std::os::unix::fs::PermissionsExt;

        let root = scratch("open-perm-denied.app");
        let child = root.join("child.txt");
        std::fs::write(&child, b"content").unwrap();

        struct PermissionGuard<'a>(&'a Path);
        impl Drop for PermissionGuard<'_> {
            fn drop(&mut self) {
                let _ = std::fs::set_permissions(self.0, std::fs::Permissions::from_mode(0o755));
                let _ = std::fs::remove_dir_all(self.0);
            }
        }

        let _guard = PermissionGuard(&root);
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o000)).unwrap();

        // If running as root (e.g. in some container environments), root can read 0o000 directories.
        if std::fs::read_dir(&root).is_ok() {
            // When running as root, permissions are ignored by the OS; skip assertion.
            return;
        }

        let opener = TestFolderOpener::default();
        let result = open_data_folder_with(&root, true, &opener);
        assert!(
            result.is_err(),
            "expected error for permission-denied directory"
        );
        let err = result.unwrap_err();
        let expected_prefix = format!("Could not open {}", root.display());
        assert!(
            err.starts_with(&expected_prefix),
            "expected error to start with '{expected_prefix}', got '{err}'"
        );
        assert!(
            opener.calls.lock().unwrap().is_empty(),
            "opener should not be called when listing fails with permission denied"
        );
    }
    include!("../homework_backup_tests.rs");
    include!("../visual_backup_tests.rs");
    include!("../faa_backup_tests.rs");
    include!("../oral_answers_backup_tests.rs");
    #[test]
    fn oral_scenarios_backup_round_trip_old_backup_and_newer_schema() {
        for old in [false, true] {
            let root = scratch("oral-backup");
            let target = scratch("oral-target");
            let backup = scratch("oral-archive");
            let path = root.join(DB_FILES[0]);
            if old {
                pdf_kit_test_database(&path, 24);
            } else {
                let mut conn = Connection::open(&path).unwrap();
                crate::oral_scenarios::tests::library_at(&conn);
                crate::oral_scenarios::execute(
                    &mut conn,
                    &crate::oral_scenarios::tests::create(1, 10, 11, "Scenario Alpha"),
                )
                .unwrap();
                verify_application_connection(&conn).unwrap();
            }
            let archive = backup.join("oral.hfdbackup");
            create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
            stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
            apply_pending_restore_in(&target).unwrap();
            let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
            if old {
                for m in crate::migrations().into_iter().filter(|m| m.version > 24) {
                    conn.execute_batch(m.sql).unwrap();
                    conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [m.version])
                        .unwrap();
                }
            }
            verify_application_connection(&conn).unwrap();
            let rows = m3_count(&conn, "SELECT COUNT(*) FROM oral_scenario_versions", &[]).unwrap();
            assert_eq!(rows, if old { 0 } else { 1 });
            if !old {
                conn.execute("UPDATE oral_scenario_versions SET prompt='Tampered'", [])
                    .unwrap();
                assert!(verify_application_connection(&conn).is_err());
                conn.execute(
                    "INSERT INTO _sqlx_migrations VALUES (?1)",
                    [crate::CURRENT_SCHEMA_VERSION + 1],
                )
                .unwrap();
                assert!(verify_application_connection(&conn)
                    .unwrap_err()
                    .contains("newer database format"));
            }
            drop(conn);
            for p in [root, target, backup] {
                std::fs::remove_dir_all(p).unwrap();
            }
        }
    }
    #[test]
    fn page_sources_current_backup_round_trip_and_old_backup_upgrade() {
        for old in [false, true] {
            let root = scratch("page-source-backup");
            let target = scratch("page-source-target");
            let backup = scratch("page-source-archive");
            let path = root.join(DB_FILES[0]);
            if old {
                pdf_kit_test_database(&path, 23);
            } else {
                let conn = crate::study_page_sources::tests::library(&root);
                let op = crate::study_page_sources::tests::operation(None);
                crate::study_sets::save_study_set_at(&root, &op).unwrap();
                // PDF-STUDY-01d: a practice question made from the same page note.
                use crate::study_page_sources::tests::{practice_op, question, NOTE_Q};
                let mut q = practice_op(
                    "5e700000-0000-4000-8000-0000000000b9",
                    "create",
                    serde_json::Value::Null,
                    vec![question(NOTE_Q, "Question", 0)],
                    serde_json::json!([]),
                    None,
                );
                q["pageSource"]["source"]["id"] =
                    serde_json::json!("5e700000-0000-4000-8000-0000000000ba");
                crate::practice_authoring::save_practice_authoring_at(&root, &q).unwrap();
                verify_application_connection(&conn).unwrap();
            }
            let archive = backup.join("sources.hfdbackup");
            create_consistent_complete_backup_with_retry(&root, &archive, "0.6.0").unwrap();
            stage_complete_restore_in(&target, &archive, "0.6.0").unwrap();
            apply_pending_restore_in(&target).unwrap();
            let conn = Connection::open(target.join(DB_FILES[0])).unwrap();
            if old {
                for m in crate::migrations().into_iter().filter(|m| m.version > 23) {
                    conn.execute_batch(m.sql).unwrap();
                    conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)", [m.version])
                        .unwrap();
                }
            }
            verify_application_connection(&conn).unwrap();
            for (table, current) in [("study_page_sources", 2), ("study_page_source_bindings", 3)] {
                assert_eq!(
                    m3_count(&conn, &format!("SELECT COUNT(*) FROM {table}"), &[]).unwrap(),
                    if old { 0 } else { current }
                );
            }
            if !old {
                let original_hash: String = conn
                    .query_row(
                        "SELECT content_fingerprint FROM study_page_source_bindings WHERE binding_kind='authored_card'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap();
                conn.execute(
                    "UPDATE study_page_source_bindings SET content_fingerprint=?1 WHERE binding_kind='authored_card'",
                    ["f".repeat(64)],
                )
                .unwrap();
                assert!(verify_application_connection(&conn).is_err());
                conn.execute(
                    "UPDATE study_page_source_bindings SET content_fingerprint=?1 WHERE binding_kind='authored_card'",
                    [original_hash],
                )
                .unwrap();
                assert_eq!(
                    m3_count(&conn, "SELECT COUNT(*) FROM study_page_source_bindings WHERE binding_kind IN ('authored_question','frozen_question')", &[]).unwrap(),
                    2
                );
                verify_application_connection(&conn).unwrap();
                conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
                conn.execute("UPDATE study_page_source_bindings SET source_id='5e700000-0000-4000-8000-999999999999'",[]).unwrap();
                assert!(verify_application_connection(&conn).is_err());
            }
            drop(conn);
            for p in [root, target, backup] {
                std::fs::remove_dir_all(p).unwrap();
            }
        }
    }
    fn legacy_archive_with_manifest(source: &Path, archive_path: &Path, extra: &str) {
        let json = format!(
            r#"{{"format":"{ARCHIVE_FORMAT}","formatVersion":{LEGACY_ARCHIVE_VERSION},"appVersion":"0.3.0","createdAt":0{extra}}}"#
        );
        let mut zip = ZipWriter::new(File::create(archive_path).unwrap());
        zip.start_file(ARCHIVE_MANIFEST, archive_options()).unwrap();
        zip.write_all(json.as_bytes()).unwrap();
        add_file_to_archive(&mut zip, &source.join(DB_FILES[0]), DB_FILES[0]).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn manifest_without_new_fields_still_inspects_and_restores() {
        let source = scratch("manifest-old-source");
        let target = scratch("manifest-old-target");
        write_database(&source.join(DB_FILES[0]), "old archive");
        let archive = source.join("old.hfdbackup");
        legacy_archive_with_manifest(&source, &archive, "");
        let info = inspect_archive(&target, &archive, "0.6.6").unwrap();
        assert_eq!(info.schema_version, None);
        assert_eq!(info.device_id, None);
        assert_eq!(info.platform, None);
        stage_complete_restore_in(&target, &archive, "0.6.6").unwrap();
        apply_pending_restore_in(&target).unwrap();
        assert!(target.join(DB_FILES[0]).is_file());
        std::fs::remove_dir_all(&source).unwrap();
        std::fs::remove_dir_all(&target).unwrap();
    }

    #[test]
    fn mac_will_not_restore_an_iphone_copy() {
        let source = scratch("ios-copy-source");
        let target = scratch("ios-copy-target");
        write_database(&source.join(DB_FILES[0]), "phone copy");
        let archive = source.join("phone.hfdbackup");
        legacy_archive_with_manifest(&source, &archive, r#","platform":"ios""#);
        let err = inspect_archive(&target, &archive, "0.6.7").unwrap_err();
        assert!(err.contains("iPhone's copy"), "{err}");
        assert!(stage_complete_restore_in(&target, &archive, "0.6.7").is_err());
        assert!(!target.join(".restore-staging").exists());
        assert!(!target.join(".restore-pending").exists());
        std::fs::remove_dir_all(&source).unwrap();
        std::fs::remove_dir_all(&target).unwrap();
    }

    #[test]
    fn manifest_new_fields_round_trip() {
        let root = scratch("manifest-fields-root");
        let out = scratch("manifest-fields-out");
        write_database(&root.join(DB_FILES[0]), "fields");
        Connection::open(root.join(DB_FILES[0]))
            .unwrap()
            .execute_batch(
                "CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT);
                 INSERT INTO app_metadata(key, value) VALUES ('device_id', 'dev-1');",
            )
            .unwrap();
        let archive = out.join("fields.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.6").unwrap();
        let info = inspect_archive(&root, &archive, "0.6.6").unwrap();
        assert_eq!(info.schema_version, Some(9));
        assert_eq!(info.device_id.as_deref(), Some("dev-1"));
        assert_eq!(info.platform.as_deref(), Some(std::env::consts::OS));
        assert_eq!(info.current_schema_version, crate::CURRENT_SCHEMA_VERSION);
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&out).unwrap();
    }

    #[test]
    fn manifest_device_id_is_none_without_app_metadata() {
        let root = scratch("manifest-nodevice-root");
        let out = scratch("manifest-nodevice-out");
        write_database(&root.join(DB_FILES[0]), "no metadata");
        let archive = out.join("nodevice.hfdbackup");
        create_consistent_complete_backup_with_retry(&root, &archive, "0.6.6").unwrap();
        let info = inspect_archive(&root, &archive, "0.6.6").unwrap();
        assert_eq!(info.device_id, None);
        assert_eq!(info.schema_version, Some(9));
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&out).unwrap();
    }

    #[test]
    fn newer_schema_version_in_manifest_is_refused_before_extraction() {
        let source = scratch("manifest-newer-source");
        let target = scratch("manifest-newer-target");
        write_database(&source.join(DB_FILES[0]), "newer");
        let archive = source.join("newer.hfdbackup");
        let newer = crate::CURRENT_SCHEMA_VERSION + 1;
        legacy_archive_with_manifest(&source, &archive, &format!(r#","schemaVersion":{newer}"#));
        let err = inspect_archive(&target, &archive, "0.6.6").unwrap_err();
        assert!(err.contains("Update the app"), "{err}");
        assert!(err.contains(&newer.to_string()), "{err}");
        assert!(stage_complete_restore_in(&target, &archive, "0.6.6").is_err());
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 0);
        std::fs::remove_dir_all(&source).unwrap();
        std::fs::remove_dir_all(&target).unwrap();
    }

    #[test]
    fn iphone_backup_dir_is_none_without_icloud_root() {
        let home = scratch("iph-none");
        assert!(iphone_backup_dir(&home).is_none());
        assert!(!home.join("Library").exists());
    }

    #[test]
    fn iphone_backup_dir_creates_subfolder_once() {
        let home = scratch("iph-dir");
        let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
        std::fs::create_dir_all(&icloud).unwrap();
        let first = iphone_backup_dir(&home).unwrap();
        std::fs::write(first.join("keep.txt"), b"x").unwrap();
        let second = iphone_backup_dir(&home).unwrap();
        assert_eq!(first, second);
        assert!(second.join("keep.txt").exists());
        assert_eq!(first, icloud.join("Her Flight Deck"));
    }

    #[test]
    fn iphone_backup_file_name_is_dated_and_has_extension() {
        let t = std::time::UNIX_EPOCH + Duration::from_secs(1_793_449_800);
        let name = iphone_backup_file_name(t);
        assert_eq!(name, "Her Flight Deck 2026-10-31 1230.hfdbackup");
        assert!(is_iphone_backup_name(&name));
        assert!(!is_iphone_backup_name(
            "her-flight-deck-2026-01-01.hfdbackup"
        ));
        assert!(!is_iphone_backup_name(
            "Her Flight Deck 2026-01-01 0900.hfdbackup.bak"
        ));
    }

    #[test]
    fn prune_keeps_three_newest_matching_files_and_ignores_others() {
        let dir = scratch("iph-prune");
        let base = std::time::SystemTime::now() - Duration::from_secs(10_000);
        let names = [
            "Her Flight Deck 2026-10-01 0900.hfdbackup",
            "Her Flight Deck 2026-10-02 0900.hfdbackup",
            "Her Flight Deck 2026-10-03 0900.hfdbackup",
            "Her Flight Deck 2026-10-04 0900.hfdbackup",
            "Her Flight Deck 2026-10-05 0900.hfdbackup",
        ];
        for (i, n) in names.iter().enumerate() {
            let f = File::create(dir.join(n)).unwrap();
            f.set_modified(base + Duration::from_secs(i as u64 * 100))
                .unwrap();
        }
        std::fs::write(dir.join("notes.txt"), b"n").unwrap();
        std::fs::write(dir.join("her-flight-deck-2026-01-01.hfdbackup"), b"o").unwrap();
        prune_iphone_backups(&dir, 3).unwrap();
        assert!(!dir.join(names[0]).exists());
        assert!(!dir.join(names[1]).exists());
        for n in &names[2..] {
            assert!(dir.join(n).exists());
        }
        assert!(dir.join("notes.txt").exists());
        assert!(dir.join("her-flight-deck-2026-01-01.hfdbackup").exists());
    }

    #[test]
    fn reveal_refuses_paths_outside_iphone_folder() {
        let home = scratch("iph-reveal");
        let dir = home.join("Her Flight Deck");
        std::fs::create_dir_all(&dir).unwrap();
        let inside = dir.join("Her Flight Deck 2026-10-31 1210.hfdbackup");
        std::fs::write(&inside, b"x").unwrap();
        let outside = home.join("other.hfdbackup");
        std::fs::write(&outside, b"x").unwrap();
        let opener = TestFolderOpener::default();
        assert!(reveal_iphone_backup_with(&dir, inside.to_str().unwrap(), &opener).is_ok());
        assert!(reveal_iphone_backup_with(&dir, outside.to_str().unwrap(), &opener).is_err());
        let sneaky = format!("{}/../other.hfdbackup", dir.display());
        assert!(reveal_iphone_backup_with(&dir, &sneaky, &opener).is_err());
        assert_eq!(opener.calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn start_fresh_replaces_db_with_empty_sqlite_and_removes_documents_and_backups() {
        let root = scratch("start-fresh-success");
        let db = root.join(DB_FILES[0]);
        write_database(&db, "active student training record");
        write_document(&root, "handbook.pdf", "sample chapter");
        write_document(&root, "notes/logbook.txt", "solo flight hours");
        let backups_folder = root.join(BACKUP_DIR).join("pre-upgrade-safety-copy");
        std::fs::create_dir_all(&backups_folder).unwrap();
        write_database(&backups_folder.join(DB_FILES[0]), "backup safety record");

        assert!(db.is_file());
        assert!(root.join(DOCUMENTS_DIR).join("handbook.pdf").is_file());
        assert!(backups_folder.join(DB_FILES[0]).is_file());

        stage_start_fresh_in(&root).unwrap();

        // Staging alone must not touch active data
        assert_eq!(database_contents(&db), "active student training record");
        assert!(root.join(DOCUMENTS_DIR).join("handbook.pdf").is_file());
        assert!(backups_folder.join(DB_FILES[0]).is_file());
        assert!(root.join(RESTORE_PENDING_DIR).join(DB_FILES[0]).is_file());

        apply_pending_restore_in(&root).unwrap();

        // 1. DB replaced by an empty valid SQLite file (not a 0-byte file, passes verify_sqlite_file)
        assert!(db.is_file());
        verify_sqlite_file(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 0);

        // 2. Documents gone
        assert!(
            !root.join(DOCUMENTS_DIR).exists()
                || std::fs::read_dir(root.join(DOCUMENTS_DIR))
                    .unwrap()
                    .next()
                    .is_none()
        );

        // 3. Backups gone
        assert!(!backups_folder.exists());
        assert!(
            !root.join(BACKUP_DIR).exists()
                || std::fs::read_dir(root.join(BACKUP_DIR))
                    .unwrap()
                    .next()
                    .is_none()
        );
        assert!(list_backups_in(&root).unwrap().is_empty());

        // 4. No .restore-* dirs left
        assert!(!root.join(RESTORE_STAGING_DIR).exists());
        assert!(!root.join(RESTORE_PENDING_DIR).exists());
        assert!(!root.join(RESTORE_JOURNAL_FILE).exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn start_fresh_install_failure_preserves_original_db_documents_and_backups() {
        let root = scratch("start-fresh-failure");
        let db = root.join(DB_FILES[0]);
        write_database(&db, "precious training record");
        write_document(&root, "handbook.pdf", "important study notes");
        let backups_folder = root.join(BACKUP_DIR).join("pre-upgrade-safety-copy");
        std::fs::create_dir_all(&backups_folder).unwrap();
        write_database(&backups_folder.join(DB_FILES[0]), "backup safety record");

        stage_start_fresh_in(&root).unwrap();

        let err =
            apply_pending_restore_in_with(&root, || Err("injected install failure".to_string()))
                .unwrap_err();
        assert!(err.contains("injected install failure"));

        // Original DB, documents AND backups must still be there
        assert_eq!(database_contents(&db), "precious training record");
        assert_eq!(
            document_contents(&root, "handbook.pdf").as_deref(),
            Some("important study notes")
        );
        assert!(backups_folder.join(DB_FILES[0]).is_file());
        assert_eq!(
            database_contents(&backups_folder.join(DB_FILES[0])),
            "backup safety record"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn start_fresh_staging_refuses_with_interrupted_journal_update_evidence() {
        let root = scratch("start-fresh-tmp-journal");
        write_database(&root.join(DB_FILES[0]), "normal record");
        let pending = root.join(RESTORE_PENDING_DIR);
        std::fs::create_dir_all(&pending).unwrap();
        std::fs::write(pending.join("keep.txt"), b"staged bytes").unwrap();
        std::fs::write(
            root.join(format!("{RESTORE_JOURNAL_FILE}.tmp123")),
            b"{partial",
        )
        .unwrap();

        let err = stage_start_fresh_in(&root).unwrap_err();
        assert!(err.contains("unresolved recovery"), "Error was: {err}");
        assert!(
            pending.join("keep.txt").is_file(),
            "pending must be untouched"
        );
        assert!(!root.join(RESTORE_STAGING_DIR).exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn start_fresh_staging_refuses_while_unreadable_restore_journal_exists() {
        let root = scratch("start-fresh-unreadable-journal");
        write_database(&root.join(DB_FILES[0]), "normal record");

        // Plant an unreadable/corrupted journal
        std::fs::write(root.join(RESTORE_JOURNAL_FILE), b"corrupted { not json").unwrap();

        let err = stage_start_fresh_in(&root).unwrap_err();
        assert!(
            err.contains("unreadable restore journal") || err.contains("invalid or unreadable"),
            "Error was: {err}"
        );

        // Staging directory must not have been left behind
        assert!(!root.join(RESTORE_STAGING_DIR).exists());
        assert!(!root.join(RESTORE_PENDING_DIR).exists());

        std::fs::remove_file(root.join(RESTORE_JOURNAL_FILE)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn start_fresh_apply_cleans_incoming_outbox_and_phone_work() {
        let root = scratch("start-fresh-cleanup-all");
        let db = root.join(DB_FILES[0]);
        write_database(&db, "precious training record");
        write_document(&root, "handbook.pdf", "important study notes");

        let backups_folder = root.join(BACKUP_DIR).join("pre-upgrade-safety-copy");
        std::fs::create_dir_all(&backups_folder).unwrap();
        write_database(&backups_folder.join(DB_FILES[0]), "backup safety record");

        let incoming_dir = root.join(INCOMING_DIR);
        std::fs::create_dir_all(&incoming_dir).unwrap();
        std::fs::write(
            incoming_dir.join("latest.hfdbackup"),
            b"incoming backup bytes",
        )
        .unwrap();
        std::fs::write(incoming_dir.join("stale.tmp"), b"incoming temp bytes").unwrap();

        let outbox_dir = root.join(crate::sync::send::OUTBOX_DIR);
        let outbox_changes = outbox_dir.join("changes").join("phone-device-1");
        std::fs::create_dir_all(&outbox_changes).unwrap();
        std::fs::write(outbox_changes.join("0-1-abcdef.json.gz"), b"change bytes").unwrap();

        let phone_work = root.join(crate::phone_work::PHONE_WORK_FILE);
        std::fs::write(&phone_work, b"{\"baselineAt\":\"2026-10-01T00:00:00Z\"}").unwrap();

        assert!(incoming_dir.join("latest.hfdbackup").is_file());
        assert!(outbox_changes.join("0-1-abcdef.json.gz").is_file());
        assert!(phone_work.is_file());
        assert!(backups_folder.join(DB_FILES[0]).is_file());

        stage_start_fresh_in(&root).unwrap();

        assert!(incoming_dir.join("latest.hfdbackup").is_file());
        assert!(outbox_changes.join("0-1-abcdef.json.gz").is_file());
        assert!(phone_work.is_file());

        apply_pending_restore_in(&root).unwrap();

        assert!(
            !incoming_dir.exists() || std::fs::read_dir(&incoming_dir).unwrap().next().is_none(),
            ".incoming directory must be empty after start fresh"
        );
        assert!(
            !outbox_dir.exists() || std::fs::read_dir(&outbox_dir).unwrap().next().is_none(),
            "outbox directory must be empty after start fresh"
        );
        assert!(
            !phone_work.exists(),
            "phone-work.json must be gone after start fresh"
        );
        assert!(!backups_folder.exists());
        assert!(
            !root.join(BACKUP_DIR).exists()
                || std::fs::read_dir(root.join(BACKUP_DIR))
                    .unwrap()
                    .next()
                    .is_none()
        );
        assert!(db.is_file());
        verify_sqlite_file(&db).unwrap();

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn start_fresh_incoming_symlink_pointing_outside_root_is_not_followed_unix() {
        let root = scratch("start-fresh-symlink-root");
        let outside = scratch("start-fresh-symlink-outside");

        let external_file = outside.join("vital-external-document.pdf");
        std::fs::write(&external_file, b"vital external data").unwrap();

        let db = root.join(DB_FILES[0]);
        write_database(&db, "active student training record");

        let incoming_dir = root.join(INCOMING_DIR);
        std::fs::create_dir_all(&incoming_dir).unwrap();

        let link_path = incoming_dir.join("linked.hfdbackup");
        std::os::unix::fs::symlink(&external_file, &link_path).unwrap();
        std::fs::write(
            incoming_dir.join("normal.hfdbackup"),
            b"normal backup bytes",
        )
        .unwrap();

        stage_start_fresh_in(&root).unwrap();
        apply_pending_restore_in(&root).unwrap();

        assert!(
            external_file.is_file(),
            "External symlink target outside root must not be deleted"
        );
        assert_eq!(
            std::fs::read(&external_file).unwrap(),
            b"vital external data"
        );
        assert!(db.is_file());
        verify_sqlite_file(&db).unwrap();

        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn start_fresh_crash_after_committed_finishes_cleanup_on_startup() {
        let root = scratch("start-fresh-crash-committed");
        let db = root.join(DB_FILES[0]);
        write_database(&db, "pre-reset training record");
        write_document(&root, "handbook.pdf", "study notes");

        let backups_folder = root.join(BACKUP_DIR).join("old-safety-copy");
        std::fs::create_dir_all(&backups_folder).unwrap();
        write_database(&backups_folder.join(DB_FILES[0]), "backup record");

        let incoming_dir = root.join(INCOMING_DIR);
        std::fs::create_dir_all(&incoming_dir).unwrap();
        std::fs::write(incoming_dir.join("latest.hfdbackup"), b"incoming bytes").unwrap();

        let outbox_dir = root.join(crate::sync::send::OUTBOX_DIR);
        let outbox_changes = outbox_dir.join("changes").join("phone-device-2");
        std::fs::create_dir_all(&outbox_changes).unwrap();
        std::fs::write(outbox_changes.join("1-2-xyz.json.gz"), b"change data").unwrap();

        let phone_work = root.join(crate::phone_work::PHONE_WORK_FILE);
        std::fs::write(&phone_work, b"{\"baselineAt\":\"2026-10-15T00:00:00Z\"}").unwrap();

        stage_start_fresh_in(&root).unwrap();

        let pending = root.join(RESTORE_PENDING_DIR);
        let plan: RestorePlan =
            serde_json::from_str(&std::fs::read_to_string(pending.join(RESTORE_PLAN)).unwrap())
                .unwrap();

        // Simulate crash right after journal is Committed and database installed:
        std::fs::rename(pending.join(DB_FILES[0]), root.join(DB_FILES[0])).unwrap();
        let _ = std::fs::remove_dir_all(root.join(DOCUMENTS_DIR));

        let mut journal = RestoreJournal::new("backups/before-restore-crash".into(), true);
        journal.operation_id = plan.operation_id.clone();
        journal.phase = RestorePhase::Committed;
        write_journal(&root, &journal).unwrap();

        let decision = handle_startup_restore_in(&root).unwrap();
        assert_eq!(decision, StartupRestoreDecision::RestoreCompleted);

        assert!(
            !root.join(RESTORE_JOURNAL_FILE).exists(),
            "Restore journal must be cleared after committed recovery finishes"
        );
        assert!(
            !pending.exists(),
            "Pending directory must be removed after committed recovery finishes"
        );
        assert!(
            !incoming_dir.exists() || std::fs::read_dir(&incoming_dir).unwrap().next().is_none(),
            ".incoming directory must be empty after startup recovery"
        );
        assert!(
            !outbox_dir.exists() || std::fs::read_dir(&outbox_dir).unwrap().next().is_none(),
            "outbox directory must be empty after startup recovery"
        );
        assert!(
            !phone_work.exists(),
            "phone-work.json must be gone after startup recovery"
        );
        assert!(!backups_folder.exists());
        assert!(
            !root.join(BACKUP_DIR).exists()
                || std::fs::read_dir(root.join(BACKUP_DIR))
                    .unwrap()
                    .next()
                    .is_none()
        );
        assert!(db.is_file());
        verify_sqlite_file(&db).unwrap();

        std::fs::remove_dir_all(&root).unwrap();
    }
}

mod material_video_link_tests {
    use super::*;

    #[test]
    fn schema_29_video_links_require_table_index_and_cascade() {
        let connection = get_reference_schema_connection().unwrap();
        verify_schema_29_video_links(&connection).unwrap();
        connection
            .execute_batch("DROP INDEX idx_material_video_links_material")
            .unwrap();
        assert!(verify_schema_29_video_links(&connection).is_err());

        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch(
                "ALTER TABLE material_video_links RENAME TO original_video_links;
                 CREATE TABLE material_video_links (
                   id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES study_materials(id),
                   url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
                   created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 DROP TABLE original_video_links;
                 CREATE INDEX idx_material_video_links_material ON material_video_links(material_id);",
            )
            .unwrap();
        assert!(verify_schema_29_video_links(&connection).is_err());
    }

    #[test]
    fn schema_29_links_survive_sqlite_backup_and_follow_material_deletion() {
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch(
                "INSERT INTO study_materials (id,title,material_type,topic,created_at,updated_at)
                 VALUES ('video-section','Synthetic section','study_guide','other','now','now');
                 INSERT INTO material_video_links VALUES
                 ('video','video-section','https://example.com/lesson','My lesson','now','now');",
            )
            .unwrap();
        let mut restored = Connection::open_in_memory().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&connection, &mut restored).unwrap();
            backup.step(-1).unwrap();
        }
        verify_schema_29_video_links(&restored).unwrap();
        let title: String = restored
            .query_row("SELECT title FROM material_video_links", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(title, "My lesson");
        restored
            .execute_batch(
                "PRAGMA foreign_keys=ON; DELETE FROM study_materials WHERE id='video-section';",
            )
            .unwrap();
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM material_video_links", &[]).unwrap(),
            0
        );
    }
}

#[cfg(test)]
mod library_folders_backup_tests {
    use super::*;

    #[test]
    fn schema_38_library_folders_require_tables_index_and_check() {
        let connection = get_reference_schema_connection().unwrap();
        verify_schema_38_library_folders(&connection).unwrap();

        // Dropping the index is refused with a clear message
        connection
            .execute_batch("DROP INDEX idx_library_placements_folder")
            .unwrap();
        let err = verify_schema_38_library_folders(&connection).unwrap_err();
        assert!(err.contains("Damaged library folders schema"));

        // Dropping a column from library_folders is refused with a clear message
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch("ALTER TABLE library_folders DROP COLUMN position")
            .unwrap();
        let err = verify_schema_38_library_folders(&connection).unwrap_err();
        assert!(err.contains("Damaged library folders schema"));

        // Dropping a column from library_placements is refused with a clear message
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch("ALTER TABLE library_placements DROP COLUMN position")
            .unwrap();
        let err = verify_schema_38_library_folders(&connection).unwrap_err();
        assert!(err.contains("Damaged library folders schema"));

        // Dropping a table is refused with a clear message
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch("DROP TABLE library_placements")
            .unwrap();
        let err = verify_schema_38_library_folders(&connection).unwrap_err();
        assert!(
            err.contains("The database is missing required table: library_placements")
                || err.contains("Damaged library folders schema")
        );

        // Recreating library_placements without ON DELETE CASCADE is refused with a clear message
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch(
                "ALTER TABLE library_placements RENAME TO original_placements;
                 CREATE TABLE library_placements (
                   material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id),
                   folder_id TEXT,
                   position INTEGER,
                   updated_at TEXT NOT NULL
                 );
                 DROP TABLE original_placements;
                 CREATE INDEX idx_library_placements_folder ON library_placements(folder_id);",
            )
            .unwrap();
        let err = verify_schema_38_library_folders(&connection).unwrap_err();
        assert!(err.contains("Damaged library folders schema"));

        // Dropping the name CHECK constraint is refused with a clear message
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch(
                "ALTER TABLE library_folders RENAME TO original_folders;
                 CREATE TABLE library_folders (
                   id TEXT PRIMARY KEY NOT NULL,
                   name TEXT NOT NULL,
                   position INTEGER NOT NULL,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 DROP TABLE original_folders;",
            )
            .unwrap();
        let err = verify_schema_38_library_folders(&connection).unwrap_err();
        assert!(err.contains("Damaged library folders schema"));
    }

    #[test]
    fn schema_38_folders_survive_sqlite_backup_and_follow_material_deletion() {
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at) VALUES
                   ('m1', 'Book 1', 'study_guide', 'other', 'now', 'now'),
                   ('m2', 'Book 2', 'study_guide', 'other', 'now', 'now'),
                   ('m3', 'Book 3', 'study_guide', 'other', 'now', 'now');
                 INSERT INTO library_folders (id, name, position, created_at, updated_at) VALUES
                   ('f1', 'Weather', 1, 'now', 'now'),
                   ('f2', 'Navigation', 2, 'now', 'now');
                 INSERT INTO library_placements (material_id, folder_id, position, updated_at) VALUES
                   ('m1', 'f1', 1, 'now'),
                   ('m2', 'f1', 2, 'now'),
                   ('m3', 'f2', 1, 'now');",
            )
            .unwrap();

        let mut restored = Connection::open_in_memory().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&connection, &mut restored).unwrap();
            backup.step(-1).unwrap();
        }

        verify_schema_38_library_folders(&restored).unwrap();
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM library_folders", &[]).unwrap(),
            2
        );
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM library_placements", &[]).unwrap(),
            3
        );

        restored
            .execute_batch("PRAGMA foreign_keys=ON; DELETE FROM study_materials WHERE id='m1';")
            .unwrap();

        assert_eq!(
            m3_count(
                &restored,
                "SELECT COUNT(*) FROM library_placements WHERE material_id='m1'",
                &[]
            )
            .unwrap(),
            0
        );
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM library_placements", &[]).unwrap(),
            2
        );
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM library_folders", &[]).unwrap(),
            2
        );
    }

    #[test]
    fn schema_37_backup_restores_and_migrates_to_empty_folders() {
        let connection = get_reference_schema_connection_through(37).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
                 INSERT INTO schema_migrations (version) VALUES (37);
                 PRAGMA foreign_keys=ON;
                 INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at) VALUES
                   ('m-old', 'Old Book', 'study_guide', 'other', 'now', 'now');",
            )
            .unwrap();

        let mut restored = Connection::open_in_memory().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&connection, &mut restored).unwrap();
            backup.step(-1).unwrap();
        }

        // Restored database at schema 37 passes verification
        verify_application_connection(&restored).unwrap();

        // Migrate to schema 38
        for m in crate::migrations().into_iter().filter(|m| m.version > 37) {
            restored.execute_batch(m.sql).unwrap();
            restored
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [m.version],
                )
                .unwrap();
        }

        verify_schema_38_library_folders(&restored).unwrap();
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM library_folders", &[]).unwrap(),
            0
        );
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM library_placements", &[]).unwrap(),
            0
        );
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM study_materials", &[]).unwrap(),
            1
        );
    }
}

#[cfg(test)]
mod practice_unchecked_backup_tests {
    use super::*;

    #[test]
    fn schema_39_requires_the_unchecked_column_and_its_check() {
        let connection = get_reference_schema_connection().unwrap();
        verify_schema_39_practice_unchecked(&connection).unwrap();
        connection
            .execute_batch(
                "INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at) VALUES ('m', 'T', 'study_guide', 'other', 'now', 'now');
                 INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, content_hash, created_at, is_active) VALUES ('v', 'm', 'k', 'T', 'h', 'now', 0);
                 INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index, unchecked) VALUES ('i', 'v', 0, 'Q', '[\"A\",\"B\"]', 0, 7);",
            )
            .unwrap();
        assert!(verify_schema_39_practice_unchecked(&connection)
            .unwrap_err()
            .contains("check flag"));
    }

    #[test]
    fn schema_38_backup_restores_and_migrates_with_every_question_checked() {
        let connection = get_reference_schema_connection_through(38).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
                 INSERT INTO schema_migrations (version) VALUES (38);
                 PRAGMA foreign_keys=ON;
                 INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at) VALUES
                   ('m-old', 'Old Book', 'study_guide', 'other', 'now', 'now');
                 INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, content_hash, created_at, is_active)
                   VALUES ('v', 'm-old', 'k', 'Old Book', 'h', 'now', 0);
                 INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index)
                   VALUES ('i', 'v', 0, 'Old question', '[\"A\",\"B\"]', 0);",
            )
            .unwrap();
        let mut restored = Connection::open_in_memory().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&connection, &mut restored).unwrap();
            backup.step(-1).unwrap();
        }
        // A schema-38 backup has no column and still passes verification.
        verify_application_connection(&restored).unwrap();
        for m in crate::migrations().into_iter().filter(|m| m.version > 38) {
            restored.execute_batch(m.sql).unwrap();
            restored
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [m.version],
                )
                .unwrap();
        }
        verify_schema_39_practice_unchecked(&restored).unwrap();
        assert_eq!(
            m3_count(
                &restored,
                "SELECT COUNT(*) FROM practice_test_items WHERE unchecked = 0",
                &[]
            )
            .unwrap(),
            1
        );
    }
}

#[cfg(test)]
mod timed_attempts_backup_tests {
    use super::*;

    const SEED: &str = "INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at) VALUES ('m', 'T', 'study_guide', 'other', 'now', 'now');
         INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, content_hash, created_at, is_active)
           VALUES ('v', 'm', 'k', 'T', 'h', 'now', 0);
         INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index)
           VALUES ('i', 'v', 0, 'Q', '[\"A\",\"B\"]', 0);";

    fn copy(connection: &Connection) -> Connection {
        let mut restored = Connection::open_in_memory().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(connection, &mut restored).unwrap();
            backup.step(-1).unwrap();
        }
        restored
    }

    #[test]
    fn schema_42_accepts_the_new_schema_and_round_trips_the_values() {
        let connection = get_reference_schema_connection().unwrap();
        verify_schema_42_timed_attempts(&connection).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
                 INSERT INTO schema_migrations (version) VALUES (42);",
            )
            .unwrap();
        connection.execute_batch(SEED).unwrap();
        connection
            .execute_batch(
                "INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, started_at, status, total_questions, timed_started_ms, timed_deadline_ms, timed_seconds_used)
                   VALUES ('a', 'v', 'm', 'T', 'now', 'in_progress', 1, 1000, 121000, 42);",
            )
            .unwrap();
        let restored = copy(&connection);
        verify_application_connection(&restored).unwrap();
        let row: (i64, i64, i64) = restored
            .query_row(
                "SELECT timed_started_ms, timed_deadline_ms, timed_seconds_used FROM practice_attempts WHERE id = 'a'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(row, (1000, 121000, 42));
    }

    #[test]
    fn schema_42_rejects_a_damaged_timer_value() {
        let connection = get_reference_schema_connection().unwrap();
        connection.execute_batch(SEED).unwrap();
        connection
            .execute_batch(
                "INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, started_at, status, total_questions, timed_started_ms)
                   VALUES ('a', 'v', 'm', 'T', 'now', 'in_progress', 1, 'soon');",
            )
            .unwrap();
        assert!(verify_schema_42_timed_attempts(&connection)
            .unwrap_err()
            .contains("timer"));
    }

    #[test]
    fn schema_41_backup_restores_and_migrates_with_null_timer_values() {
        let connection = get_reference_schema_connection_through(41).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
                 INSERT INTO schema_migrations (version) VALUES (41);",
            )
            .unwrap();
        connection.execute_batch(SEED).unwrap();
        connection
            .execute_batch(
                "INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, started_at, status, total_questions)
                   VALUES ('a', 'v', 'm', 'T', 'now', 'in_progress', 1);",
            )
            .unwrap();
        let restored = copy(&connection);
        // A schema-41 backup has no timer columns and still passes verification.
        verify_application_connection(&restored).unwrap();
        for m in crate::migrations().into_iter().filter(|m| m.version > 41) {
            restored.execute_batch(m.sql).unwrap();
            restored
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [m.version],
                )
                .unwrap();
        }
        verify_schema_42_timed_attempts(&restored).unwrap();
        let nulls = m3_count(
            &restored,
            "SELECT COUNT(*) FROM practice_attempts WHERE timed_started_ms IS NULL AND timed_deadline_ms IS NULL AND timed_seconds_used IS NULL",
            &[],
        )
        .unwrap();
        assert_eq!(nulls, 1);
    }
}

#[cfg(test)]
mod kit_queue_tests {
    use super::*;

    #[test]
    fn schema_36_kit_queue_requires_the_table_shape_and_holds_no_secrets() {
        let connection = get_reference_schema_connection().unwrap();
        verify_schema_36_kit_queue(&connection).unwrap();
        for (table, expected) in [
            ("kit_queue", "id,provider,created_at,state,consent_at"),
            (
                "kit_queue_item",
                "queue_id,position,material_id,source_sha256,status,request_id,job_id,updated_at",
            ),
        ] {
            let mut statement = connection
                .prepare(&format!(
                    "SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
                ))
                .unwrap();
            let names: Vec<String> = statement
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            assert_eq!(
                names.join(","),
                expected,
                "{table} holds ids, checksums and status only"
            );
        }
        connection
            .execute_batch("DROP TABLE kit_queue_item")
            .unwrap();
        assert!(verify_schema_36_kit_queue(&connection).is_err());
        let damaged = get_reference_schema_connection().unwrap();
        damaged
            .execute_batch(
                "DROP TABLE kit_queue_item;
                 CREATE TABLE kit_queue_item (queue_id TEXT NOT NULL, position INTEGER NOT NULL);",
            )
            .unwrap();
        assert!(verify_schema_36_kit_queue(&damaged).is_err());
        // Without the one-open-queue index two windows could both claim a queue.
        let unguarded = get_reference_schema_connection().unwrap();
        unguarded
            .execute_batch("DROP INDEX kit_queue_one_open")
            .unwrap();
        assert!(verify_schema_36_kit_queue(&unguarded).is_err());
        // A state or status CHECK that was dropped is refused too.
        let unchecked = get_reference_schema_connection().unwrap();
        unchecked
            .execute_batch(
                "DROP TABLE kit_queue_item;
                 CREATE TABLE kit_queue_item (
                   queue_id TEXT NOT NULL REFERENCES kit_queue(id) ON DELETE CASCADE,
                   position INTEGER NOT NULL, material_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
                   status TEXT NOT NULL, request_id TEXT, job_id TEXT, updated_at TEXT NOT NULL,
                   PRIMARY KEY (queue_id, position));",
            )
            .unwrap();
        assert!(verify_schema_36_kit_queue(&unchecked).is_err());
    }
}

#[cfg(test)]
mod student_pilot_steps_tests {
    use super::*;

    #[test]
    fn schema_30_student_pilot_steps_require_the_table_shape() {
        let connection = get_reference_schema_connection().unwrap();
        verify_schema_30_student_pilot_steps(&connection).unwrap();
        connection
            .execute_batch(
                "ALTER TABLE student_pilot_steps RENAME TO original_steps;
                 CREATE TABLE student_pilot_steps (step_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL);
                 DROP TABLE original_steps;",
            )
            .unwrap();
        assert!(verify_schema_30_student_pilot_steps(&connection).is_err());
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch("DROP TABLE student_pilot_steps")
            .unwrap();
        assert!(verify_schema_30_student_pilot_steps(&connection).is_err());
    }

    #[test]
    fn schema_30_ticks_survive_sqlite_backup() {
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch(
                "INSERT INTO student_pilot_steps VALUES ('medical','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');",
            )
            .unwrap();
        let mut restored = Connection::open_in_memory().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&connection, &mut restored).unwrap();
            backup.step(-1).unwrap();
        }
        verify_schema_30_student_pilot_steps(&restored).unwrap();
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM student_pilot_steps", &[]).unwrap(),
            1
        );
    }
}

#[cfg(test)]
mod faa_downloads_schema_tests {
    use super::*;

    #[test]
    fn schema_31_faa_downloads_require_the_table_shape() {
        let connection = get_reference_schema_connection().unwrap();
        verify_schema_31_faa_downloads(&connection).unwrap();
        connection
            .execute_batch(
                "ALTER TABLE faa_downloads RENAME TO original_downloads;
                 CREATE TABLE faa_downloads (material_id TEXT PRIMARY KEY, document_id TEXT NOT NULL);
                 DROP TABLE original_downloads;",
            )
            .unwrap();
        assert!(verify_schema_31_faa_downloads(&connection).is_err());
        let connection = get_reference_schema_connection().unwrap();
        connection
            .execute_batch("DROP TABLE faa_downloads")
            .unwrap();
        assert!(verify_schema_31_faa_downloads(&connection).is_err());
    }

    #[test]
    fn schema_31_downloads_survive_sqlite_backup_and_cascade() {
        let connection = get_reference_schema_connection().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        connection
            .execute_batch(&format!(
                "INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m','PHAK','now','now');
                 INSERT INTO faa_downloads VALUES ('m','phak-25c-full','https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/faa-h-8083-25c.pdf','FAA-H-8083-25C','{}',10,NULL,'now');",
                "a".repeat(64)
            ))
            .unwrap();
        assert!(connection
            .execute_batch("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('n','x','now','now'); INSERT INTO faa_downloads VALUES ('n','a','u','e','short',1,NULL,'now');")
            .is_err());
        let mut restored = Connection::open_in_memory().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&connection, &mut restored).unwrap();
            backup.step(-1).unwrap();
        }
        verify_schema_31_faa_downloads(&restored).unwrap();
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM faa_downloads", &[]).unwrap(),
            1
        );
        restored
            .execute_batch("PRAGMA foreign_keys=ON; DELETE FROM study_materials WHERE id='m'")
            .unwrap();
        assert_eq!(
            m3_count(&restored, "SELECT COUNT(*) FROM faa_downloads", &[]).unwrap(),
            0
        );
    }
}

#[cfg(test)]
mod card_fold_schema_tests {
    use super::*;
    use rusqlite::params;

    const FOLD: &str = "11111111-1111-4111-8111-111111111111";

    /// A reference schema with one material, version and card (`i1`).
    fn base() -> Connection {
        let c = get_reference_schema_connection().unwrap();
        c.execute_batch(
            "PRAGMA foreign_keys=ON;
             INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('m','T','2026-11-05T10:00:00.000Z','2026-11-05T10:00:00.000Z');
             INSERT INTO card_versions (id,source_material_id,content_hash,card_count,provider,created_at,is_active)
               VALUES ('v1','m','h',1,'import','2026-11-05T10:00:00.000Z',1);
             INSERT INTO card_items (id,version_id,ordinal,front,back) VALUES ('i1','v1',0,'f','b');",
        )
        .unwrap();
        c
    }

    fn fold(c: &Connection, id: &str, at: &str, generation: i64) {
        c.execute(
            "INSERT INTO card_review_event_folds (id,item_id,generation,rating,reviewed_at,device_id,changed_at,folded_at)
             VALUES (?1,'i1',?3,'good',?2,NULL,NULL,'2026-11-05T10:00:00.000Z')",
            params![id, at, generation],
        )
        .unwrap();
    }

    #[test]
    fn schema_35_accepts_a_sound_ledger_and_refuses_each_damaged_row() {
        let c = base();
        verify_schema_35_fold_semantics(&c).unwrap();
        fold(&c, FOLD, "2026-11-05T10:00:00.000Z", 0);
        verify_schema_35_fold_semantics(&c).unwrap();

        // Not a lower-case UUIDv4 id (fold id, case and shape).
        for bad in ["not-a-uuid", "AAAAAAAA-1111-4111-8111-111111111111"] {
            let c = base();
            fold(&c, bad, "2026-11-05T10:00:00.000Z", 0);
            assert!(verify_schema_35_fold_semantics(&c).is_err(), "{bad}");
        }
        // A timestamp that is not the 24-character form.
        let c = base();
        fold(&c, FOLD, "yesterday", 0);
        assert!(verify_schema_35_fold_semantics(&c).is_err());
        // A fold from a generation the material has not reached.
        let c = base();
        fold(&c, FOLD, "2026-11-05T10:00:00.000Z", 1);
        assert!(verify_schema_35_fold_semantics(&c).is_err());
        c.execute(
            "INSERT INTO card_review_generations (source_material_id, generation) VALUES ('m', 1)",
            [],
        )
        .unwrap();
        verify_schema_35_fold_semantics(&c).unwrap();
        // A fold id that is also a live rating event is accepted (the runtime ignores it).
        let c = base();
        fold(&c, FOLD, "2026-11-05T10:00:00.000Z", 0);
        c.execute(
            "INSERT INTO card_review_events (id,item_id,generation,rating,reviewed_at,scheduler_version,prior_state_json,next_state_json)
             VALUES (?1,'i1',0,'good','2026-11-05T10:00:00.000Z','simple-v1','null','{}')",
            [FOLD],
        )
        .unwrap();
        verify_schema_35_fold_semantics(&c).unwrap();
        // A fold whose card is missing (foreign keys off, as a damaged copy would be).
        let c = base();
        c.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
        c.execute(
            "INSERT INTO card_review_event_folds (id,item_id,generation,rating,reviewed_at,device_id,changed_at,folded_at)
             VALUES (?1,'gone',0,'good','2026-11-05T10:00:00.000Z',NULL,NULL,'2026-11-05T10:00:00.000Z')",
            [FOLD],
        )
        .unwrap();
        assert!(verify_schema_35_fold_semantics(&c).is_err());
        // The table itself damaged or missing.
        let c = base();
        c.execute_batch("DROP TABLE card_review_event_folds")
            .unwrap();
        assert!(verify_schema_35_fold_semantics(&c).is_err());
        let c = base();
        c.execute_batch(
            "DROP TABLE card_review_event_folds;
             CREATE TABLE card_review_event_folds (id TEXT PRIMARY KEY, item_id TEXT NOT NULL);",
        )
        .unwrap();
        assert!(verify_schema_35_fold_semantics(&c).is_err());
    }

    #[test]
    fn deleting_a_card_or_its_version_cascades_its_folds() {
        let c = base();
        fold(&c, FOLD, "2026-11-05T10:00:00.000Z", 0);
        c.execute("DELETE FROM card_items WHERE id = 'i1'", [])
            .unwrap();
        assert_eq!(
            m3_count(&c, "SELECT COUNT(*) FROM card_review_event_folds", &[]).unwrap(),
            0
        );
        let c = base();
        fold(&c, FOLD, "2026-11-05T10:00:00.000Z", 0);
        c.execute("DELETE FROM card_versions WHERE id = 'v1'", [])
            .unwrap();
        assert_eq!(
            m3_count(&c, "SELECT COUNT(*) FROM card_review_event_folds", &[]).unwrap(),
            0
        );
    }
}
