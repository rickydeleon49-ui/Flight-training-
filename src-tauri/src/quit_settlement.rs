//! Settling her work before the app quits (QUIT-01).
//!
//! Cmd-Q, the app menu's Quit, the red close button and Cmd-W all come here.
//! The frontend is asked once to finish what is waiting (a deletion still in
//! its Undo window, queued database writes) and to say when it is done. The
//! app then exits, or after two seconds at most: quitting never hangs and
//! never exits twice. Editor drafts are already in storage before any of this
//! starts, so nothing here has to save typing.
//!
//! Logout and shutdown reach the app as a plain `terminate:` that cannot be
//! delayed; they behave like a crash (drafts still survive).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// The event the frontend listens for.
pub const SETTLE_EVENT: &str = "settle-before-quit";
/// The longest quitting waits for the frontend.
pub const SETTLE_LIMIT: Duration = Duration::from_millis(2000);
/// The id of our own Quit menu item.
pub const QUIT_MENU_ID: &str = "quit";

/// One quit at a time: the first request wins, later ones are ignored.
#[derive(Default)]
pub struct Settlement {
    quitting: AtomicBool,
    tx: Mutex<Option<SyncSender<()>>>,
}

impl Settlement {
    /// Start quitting. `None` when a quit is already under way.
    pub fn request(&self) -> Option<Receiver<()>> {
        if self
            .quitting
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return None;
        }
        let (tx, rx) = sync_channel(1);
        if let Ok(mut slot) = self.tx.lock() {
            *slot = Some(tx);
        }
        Some(rx)
    }

    /// The frontend has finished; wake the waiting quit. Harmless at any time.
    pub fn settle(&self) {
        let sender = self.tx.lock().ok().and_then(|mut slot| slot.take());
        if let Some(tx) = sender {
            let _ = tx.try_send(());
        }
    }
}

/// Wait for the frontend, but never longer than `limit`.
pub fn wait(rx: Receiver<()>, limit: Duration) {
    let _ = rx.recv_timeout(limit);
}

/// Ask the frontend to settle, then exit once: on its answer or after the limit.
pub fn begin_quit<R: Runtime>(app: &AppHandle<R>) {
    let Some(rx) = app.state::<Settlement>().request() else {
        return;
    };
    if app.emit(SETTLE_EVENT, ()).is_err() {
        app.exit(0);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        wait(rx, SETTLE_LIMIT);
        app.exit(0);
    });
}

/// The frontend's answer to `settle-before-quit`.
#[tauri::command]
pub fn settled_before_quit(state: State<'_, Settlement>) {
    state.settle();
}

/// Tauri's default macOS menu, item for item (tauri 2.11 `Menu::default`),
/// with one change: Quit is our own item, so Cmd-Q can settle first.
/// Without the Edit menu, copy and paste would stop working in the window.
#[cfg(target_os = "macos")]
pub fn app_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    };

    let pkg_info = handle.package_info();
    let config = handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    let quit = MenuItem::with_id(
        handle,
        QUIT_MENU_ID,
        format!("Quit {}", pkg_info.name),
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    let window_menu = Submenu::with_id_and_items(
        handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;
    let help_menu = Submenu::with_id_and_items(handle, HELP_SUBMENU_ID, "Help", true, &[])?;

    Menu::with_items(
        handle,
        &[
            &Submenu::with_items(
                handle,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(handle, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::services(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                handle,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(handle, None)?],
            )?,
            &Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                handle,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(handle, None)?],
            )?,
            &window_menu,
            &help_menu,
        ],
    )
}
