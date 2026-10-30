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
pub mod extraction;
mod safety_notices;

/// Counts requested allocation bytes; capped only in the extraction worker.
#[global_allocator]
static GLOBAL: extraction::alloc::Global = extraction::alloc::Global;

#[cfg(test)]
mod fake_gemini;
mod gemini;
mod gemini_ask;
mod gemini_ask_evidence;
mod gemini_budget;
mod gemini_cancel;
mod gemini_files;
mod gemini_jobs;
mod homework;
#[doc(hidden)]
pub mod lineage;
mod logging;
mod navigation;
mod oral_scenarios;
#[doc(hidden)]
pub mod pdf;
mod pdf_kit;
mod pdf_kit_sources;
pub mod pdf_study_kit;
#[cfg(test)]
mod pdf_study_kit_tests;
mod provider;
#[cfg(test)]
mod test_wait;
// Platform abstraction scaffolding for the iOS port. Not yet wired into any
// command — see `docs/ios/ARCHITECTURE.md` §3 and `platform.rs`'s own doc
// comment for why.
mod platform;
mod practice_authoring;
#[cfg(test)]
mod practice_authoring_tests;
mod practice_sessions;
mod repository_writes;
mod secrets;
mod skill_evidence;
mod storage;
mod study_export;
mod study_packet;
mod study_page_sources;
mod study_sets;
mod visual_cards;
mod weather;
mod window_placement;

use logging::log;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_window_state::{StateFlags, WindowExt};

/// The SQLite database lives in the app data directory, never the repository.
const DB_URL: &str = "sqlite:her-flight-deck.db";
pub(crate) const CURRENT_SCHEMA_VERSION: i64 = 27;

/// Schema migrations, applied in order on startup.
///
/// The SQL lives in `migrations/` so the TypeScript fallback database can
/// load exactly the same statements and the two can never drift apart.
#[doc(hidden)]
pub fn migrations() -> Vec<Migration> {
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
        Migration {
            version: 16,
            description: "manual_study",
            sql: include_str!("../migrations/0016_manual_study.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "practice_authoring",
            sql: include_str!("../migrations/0017_practice_authoring.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "pdf_kit_provenance",
            sql: include_str!("../migrations/0018_pdf_kit_provenance.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "study_set_save_receipts",
            sql: include_str!("../migrations/0019_study_set_save_receipts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "homework",
            sql: include_str!("../migrations/0020_homework.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "flight_schools",
            sql: include_str!("../migrations/0021_flight_schools.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "journal_school",
            sql: include_str!("../migrations/0022_journal_school.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "homework_answers",
            sql: include_str!("../migrations/0023_homework_answers.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "study_page_sources",
            sql: include_str!("../migrations/0024_study_page_sources.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "oral_scenarios",
            sql: include_str!("../migrations/0025_oral_scenarios.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "visual_card_regions",
            sql: include_str!("../migrations/0026_visual_card_regions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "faa_reference_copies",
            sql: include_str!("../migrations/0027_faa_reference_copies.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// After a restore restart, show the main window and activate the app. The
/// restart spawns the executable directly, so nothing else brings it to the
/// front and the restored app can appear hidden behind other windows.
fn bring_main_window_forward(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("Restore finished, but the main window was not found to bring forward.");
        return;
    };
    if let Err(error) = window.show() {
        log::warn!("Restore finished, but the window could not be shown: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("Restore finished, but the window could not be brought forward: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Do not create a webview (and therefore open SQLite) until the restore
    // gate passes. A blocked launch needs only a native dialog and its event loop.
    let mut context = tauri::generate_context!();
    let windows = context.config().app.windows.clone();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Size, position and maximized only: visibility and decorations stay
        // as `tauri.conf.json` sets them. The state file is in the app config
        // folder, which complete backups never include (allowlist).
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .setup(move |app| {
            logging::attach(app.handle());
            // A user-requested full restore is staged during the previous run
            // and installed here, before SQLite opens the database. Startup
            // blocks if an ambiguous restore cannot be safely resolved.
            let outcome = backup::handle_startup_restore(app.handle());
            let folder = app.path().app_config_dir().ok();
            let restored = match safety_notices::startup_gate(outcome, folder.as_deref()) {
                Ok(restored) => restored,
                Err(message) => {
                    safety_notices::show_blocked_startup(app.handle(), message);
                    return Ok(());
                }
            };

            // Before the frontend opens the database, and therefore before any
            // migration runs, copy it aside if this is a new version's first run.
            // The error text can name her data folder, so it is not logged.
            if backup::backup_if_upgraded(app.handle()).is_err() {
                log::error!("Could not make the safety copy before upgrading.");
            }

            // Clean up any interrupted staged deletions from previous runs.
            if documents::cleanup_staged_deletions(app.handle()).is_err() {
                log::warn!("Could not clean up staged deletions; will try again next launch.");
            }
            for window in &windows {
                if window.create {
                    let built = tauri::WebviewWindowBuilder::from_config(app, window)?.build()?;
                    // Created after the restore gate, so the window-state plugin's
                    // own restore can lose to the config's `center`; put her saved
                    // size and place back explicitly (student run 30 Oct).
                    let _ = built.restore_state(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    );
                }
            }
            window_placement::keep_main_window_reachable(app.handle());
            if restored {
                bring_main_window_forward(app.handle());
            }
            safety_notices::show_restore_outcome(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            weather::weather_session,
            weather::get_airport_weather,
            extraction::service::offline_content_readiness,
            extraction::service::prepare_offline_content,
            extraction::search_api::search_offline_content,
            extraction::search_api::verify_offline_destination,
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
            practice_authoring::save_practice_authoring_atomically,
            homework::save_homework_atomically,
            oral_scenarios::save_oral_scenario_operation,
            study_sets::save_study_set_atomically,
            repository_writes::replace_material_links_atomically,
            repository_writes::create_fund_goal_atomically,
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
            study_page_sources::preview_study_page_source,
            visual_cards::read_visual_image,
            navigation::open_navigation_document,
            documents::save_material_operation,
            debrief::save_debrief_operation,
            pdf::inspect_pdf,
            pdf::split_pdf,
            pdf::split_pdf_automatically,
            provider::provider_status,
            provider::select_provider,
            provider::configure_provider,
            provider::disconnect_provider,
            gemini::gemini_status,
            gemini::configure_gemini,
            gemini::disconnect_gemini,
            gemini::set_gemini_model,
            pdf_kit::prepare_pdf_study_kit,
            pdf_kit::get_pdf_study_kit,
            gemini::generate_study_aid,
            gemini::sections::queue_study_guide,
            gemini::sections::resume_study_guide,
            gemini::sections::restart_study_guide,
            gemini::generate_practice_test,
            gemini_ask::ask_gemini,
            gemini_ask::cancel_ask_gemini,
            gemini::gemini_jobs,
            gemini::acknowledge_gemini_job,
            gemini::cancel_gemini_job,
            backup::create_backup,
            backup::create_complete_backup,
            backup::inspect_complete_backup,
            backup::stage_complete_restore,
            backup::stage_local_restore,
            backup::restart_for_restore,
            backup::list_backups,
            safety_notices::upgrade_copy_failed,
            backup::data_directory,
            backup::open_data_folder,
            backup::app_version,
        ])
        .run(context);
    if result.is_err() {
        log::error!("Her Flight Deck could not open.");
    }
}
