//! Her Flight Deck — Tauri application entry point.
//!
//! The Rust side stays deliberately thin: it owns private file storage and
//! database setup, while product logic lives in the TypeScript layer behind
//! repository abstractions.

mod backup;
mod card_library;
mod card_reviews;
mod debrief;
mod documents;
mod gemini;
mod lineage;
mod pdf;
// Platform abstraction scaffolding for the iOS port. Not yet wired into any
// command — see `docs/ios/ARCHITECTURE.md` §3 and `platform.rs`'s own doc
// comment for why.
mod platform;
mod practice_sessions;
mod secrets;
mod storage;
mod study_packet;

use tauri_plugin_sql::{Migration, MigrationKind};

/// The SQLite database lives in the app data directory, never the repository.
const DB_URL: &str = "sqlite:her-flight-deck.db";
pub(crate) const CURRENT_SCHEMA_VERSION: i64 = 13;

/// Schema migrations, applied in order on startup.
///
/// The SQL lives in `migrations/` so the TypeScript fallback database can
/// load exactly the same statements and the two can never drift apart.
pub(crate) fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/0001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "profile_details",
            sql: include_str!("../migrations/0002_profile_details.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "personal_note",
            sql: include_str!("../migrations/0003_personal_note.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "app_metadata",
            sql: include_str!("../migrations/0004_app_metadata.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "flight_log",
            sql: include_str!("../migrations/0005_flight_log.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "pilot_toolkit",
            sql: include_str!("../migrations/0006_pilot_toolkit.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "ai_study",
            sql: include_str!("../migrations/0007_ai_study.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "notes",
            sql: include_str!("../migrations/0008_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "practice_tests",
            sql: include_str!("../migrations/0009_practice_tests.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "debrief_links",
            sql: include_str!("../migrations/0010_debrief_links.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "practice_sessions",
            sql: include_str!("../migrations/0011_practice_sessions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "card_reviews",
            sql: include_str!("../migrations/0012_card_reviews.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "split_source_lineage",
            sql: include_str!("../migrations/0013_split_source_lineage.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .setup(|app| {
            // A user-requested full restore is staged during the previous run
            // and installed here, before SQLite opens the database. Startup
            // blocks if an ambiguous restore cannot be safely resolved.
            backup::handle_startup_restore(app.handle())
                .map_err(Box::<dyn std::error::Error>::from)?;

            // Before the frontend opens the database, and therefore before any
            // migration runs, copy it aside if this is a new version's first run.
            if let Err(error) = backup::backup_if_upgraded(app.handle()) {
                eprintln!("Could not back up before upgrading: {error}");
            }

            // Clean up any interrupted staged deletions from previous runs.
            if let Err(error) = documents::cleanup_staged_deletions(app.handle()) {
                eprintln!("Could not clean up staged deletions: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            documents::import_document,
            documents::document_path,
            documents::document_exists,
            documents::delete_document,
            documents::stage_delete_document,
            documents::rollback_delete_document,
            documents::commit_delete_document,
            documents::check_library,
            documents::reattach_unlinked_file,
            documents::import_unlinked_file,
            documents::trash_unlinked_file,
            documents::save_split_materials,
            lineage::save_split_batch,
            lineage::cancel_split_batch,
            lineage::reconcile_split_batch,
            lineage::fingerprint_stored_documents,
            study_packet::pick_study_packet,
            study_packet::save_structured_study_material_atomically,
            practice_sessions::save_practice_session_atomically,
            practice_sessions::erase_practice_history_atomically,
            practice_sessions::save_practice_test_atomically,
            practice_sessions::remove_practice_test_atomically,
            practice_sessions::run_practice_legacy_conversion,
            card_reviews::save_card_review_atomically,
            card_library::get_library_review_due,
            card_library::get_library_recent_reviews,
            documents::save_material_operation,
            debrief::save_debrief_operation,
            pdf::inspect_pdf,
            pdf::split_pdf,
            pdf::split_pdf_automatically,
            gemini::gemini_status,
            gemini::configure_gemini,
            gemini::disconnect_gemini,
            gemini::generate_study_aid,
            gemini::generate_practice_test,
            backup::create_backup,
            backup::create_complete_backup,
            backup::inspect_complete_backup,
            backup::stage_complete_restore,
            backup::stage_local_restore,
            backup::restart_for_restore,
            backup::list_backups,
            backup::data_directory,
            backup::app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Her Flight Deck");
}
