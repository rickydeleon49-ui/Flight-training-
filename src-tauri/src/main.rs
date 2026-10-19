// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The extraction worker is this binary in a separate process. Decide that
    // before Tauri starts, so worker mode never opens a window or database.
    if let Some(code) = her_flight_deck_lib::extraction::worker::dispatch(std::env::args_os()) {
        std::process::exit(code);
    }
    her_flight_deck_lib::run()
}
