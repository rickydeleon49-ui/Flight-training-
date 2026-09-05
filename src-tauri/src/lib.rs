//! Her Flight Deck — Tauri application entry point.
//!
//! The Rust side stays deliberately thin: it owns private file storage and
//! database setup, while product logic lives in the TypeScript layer behind
//! repository abstractions.

mod backup;
mod documents;
mod storage;

use tauri_plugin_sql::{Migration, MigrationKind};

/// The SQLite database lives in the app data directory, never the repository.
const DB_URL: &str = "sqlite:her-flight-deck.db";

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
            // Before the frontend opens the database, and therefore before any
            // migration runs, copy it aside if this is a new version's first run.
            if let Err(error) = backup::backup_if_upgraded(app.handle()) {
                eprintln!("Could not back up before upgrading: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            documents::import_document,
            documents::document_path,
            documents::document_exists,
            documents::delete_document,
            documents::clear_documents,
            backup::create_backup,
            backup::list_backups,
            backup::data_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Her Flight Deck");
}
