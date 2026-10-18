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
#[cfg(test)]
mod fake_gemini;
mod gemini;
mod gemini_files;
mod gemini_jobs;
mod lineage;
mod navigation;
mod pdf;
// Platform abstraction scaffolding for the iOS port. Not yet wired into any
// command — see `docs/ios/ARCHITECTURE.md` §3 and `platform.rs`'s own doc
// comment for why.
mod platform;
mod practice_sessions;
mod secrets;
mod skill_evidence;
mod storage;
mod study_export;
mod study_packet;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

/// The SQLite database lives in the app data directory, never the repository.
const DB_URL: &str = "sqlite:her-flight-deck.db";
pub(crate) const CURRENT_SCHEMA_VERSION: i64 = 15;

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
        Migration {
            version: 14,
            description: "skills_evidence",
            sql: include_str!("../migrations/0014_skills_evidence.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "document_navigation",
            sql: include_str!("../migrations/0015_document_navigation.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// After a restore restart, show the main window and activate the app. The
/// restart spawns the executable directly, so nothing else brings it to the
/// front and the restored app can appear hidden behind other windows.
fn bring_main_window_forward(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("Restore finished, but the main window was not found to bring forward.");
        return;
    };
    if let Err(error) = window.show() {
        eprintln!("Restore finished, but the window could not be shown: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("Restore finished, but the window could not be brought forward: {error}");
    }
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
            let restored = backup::handle_startup_restore(app.handle())
                .map_err(Box::<dyn std::error::Error>::from)?;
            if restored {
                bring_main_window_forward(app.handle());
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
            study_export::save_study_export,
            study_packet::save_structured_study_material_atomically,
            practice_sessions::save_practice_session_atomically,
            practice_sessions::erase_practice_history_atomically,
            practice_sessions::save_practice_test_atomically,
            practice_sessions::remove_practice_test_atomically,
            practice_sessions::run_practice_legacy_conversion,
            card_reviews::save_card_review_atomically,
            card_library::get_library_review_due,
            card_library::get_library_recent_reviews,
            skill_evidence::save_skill_evidence_action,
            skill_evidence::read_skill_evidence_page,
            skill_evidence::read_skill_summary,
            skill_evidence::list_skills,
            skill_evidence::read_observation_history,
            navigation::navigation_operation,
            navigation::inspect_navigation_identity,
            navigation::open_navigation_document,
            documents::save_material_operation,
            debrief::save_debrief_operation,
            pdf::inspect_pdf,
            pdf::split_pdf,
            pdf::split_pdf_automatically,
            gemini::gemini_status,
            gemini::configure_gemini,
            gemini::disconnect_gemini,
            gemini::set_gemini_model,
            gemini::generate_study_aid,
            gemini::generate_practice_test,
            gemini::gemini_jobs,
            gemini::acknowledge_gemini_job,
            backup::create_backup,
            backup::create_complete_backup,
            backup::inspect_complete_backup,
            backup::stage_complete_restore,
            backup::stage_local_restore,
            backup::restart_for_restore,
            backup::list_backups,
            backup::data_directory,
            backup::open_data_folder,
            backup::app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Her Flight Deck");
}
