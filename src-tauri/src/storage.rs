//! The one folder that holds everything of hers.
//!
//! `tauri-plugin-sql` resolves a `sqlite:` URL against the application's
//! *config* directory, so that is where the database lives. Documents and
//! backups deliberately use the same root rather than the data directory,
//! which on Linux is a different place entirely — one folder is what makes
//! "back this up and you have everything" true, and what the interface
//! promises her.
//!
//! On macOS and Windows the two resolve to the same path anyway
//! (`~/Library/Application Support/<id>` and `%APPDATA%\<id>`); Linux is the
//! platform where getting this wrong is silent.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Root of everything the application stores, created if needed.
pub fn app_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not resolve the application data directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create the application data directory: {e}"))?;
    Ok(dir)
}
