//! Her Flight Deck — Tauri application entry point.
//!
//! The Rust side stays deliberately thin: it owns private file storage and
//! database setup, while product logic lives in the TypeScript layer behind
//! repository abstractions.

mod backup;
mod documents;
mod gemini;
mod pdf;
// Platform abstraction scaffolding for the iOS port. Not yet wired into any
// command — see `docs/ios/ARCHITECTURE.md` §3 and `platform.rs`'s own doc
// comment for why.
mod platform;
mod secrets;
mod storage;

use tauri_plugin_sql::{Migration, MigrationKind};

/// The SQLite database lives in the app data directory, never the repository.
const DB_URL: &str = "sqlite:her-flight-deck.db";
pub(crate) const CURRENT_SCHEMA_VERSION: i64 = 9;

/// Schema migrations, applied in order on startup.
///
/// The SQL lives in `migrations/` so the TypeScript fallback database can
/// load exactly the same statements and the two can never drift apart.
fn migrations() -> Vec<Migration> {
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
            // and installed here, before SQLite opens the database.
            if let Err(error) = backup::apply_pending_restore(app.handle()) {
                eprintln!("Could not restore the selected backup: {error}");
            }

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
            documents::save_split_materials,
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
