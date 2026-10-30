//! The window reopens where she left it (WINSTATE-01).
//!
//! `tauri-plugin-window-state` saves the main window's size, position and
//! maximized state in the app config folder and puts them back when the
//! window is created. It only moves the window to the saved position when
//! one of the window's corners still lands on a connected screen, otherwise
//! it leaves the window where `tauri.conf.json` puts it (centered). A single
//! corner can still mean a window almost entirely off-screen, and a saved
//! size could be below the configured minimum, so after the plugin has run
//! `keep_main_window_reachable` makes sure the title bar can be grabbed on
//! some screen and the minimum size holds. It never changes anything when
//! the window is already fine.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

/// Physical pixels of the window's top edge treated as its title bar.
const TITLE_BAR_STRIP: u32 = 40;
/// How much of that strip must be on one screen for her to drag it.
const MIN_REACHABLE_WIDTH: u32 = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn right(&self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }
    fn bottom(&self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }
}

/// Width and height of the overlap of the window's title strip with `screen`.
fn title_strip_overlap(window: Rect, screen: Rect) -> (i64, i64) {
    let strip_bottom = i64::from(window.y) + i64::from(window.height.min(TITLE_BAR_STRIP));
    let width = window.right().min(screen.right()) - i64::from(window.x.max(screen.x));
    let height = strip_bottom.min(screen.bottom()) - i64::from(window.y.max(screen.y));
    (width, height)
}

fn is_reachable(window: Rect, screen: Rect) -> bool {
    let (width, height) = title_strip_overlap(window, screen);
    width >= i64::from(MIN_REACHABLE_WIDTH.min(window.width)) && height > 0
}

/// Where the window should be instead, or `None` when it is already fine.
/// `screens` are work areas with the primary screen first; `min` is the
/// minimum size in physical pixels.
pub(crate) fn corrected_placement(window: Rect, screens: &[Rect], min: (u32, u32)) -> Option<Rect> {
    let width = window.width.max(min.0);
    let height = window.height.max(min.1);
    let sized = Rect {
        width,
        height,
        ..window
    };
    if screens.iter().any(|screen| is_reachable(sized, *screen)) {
        return (sized != window).then_some(sized);
    }
    let screen = *screens.first()?;
    let width = width.min(screen.width).max(min.0);
    let height = height.min(screen.height).max(min.1);
    let centered = |origin: i32, space: u32, size: u32| {
        let offset = i64::from(space.saturating_sub(size) / 2);
        i32::try_from(i64::from(origin) + offset).unwrap_or(origin)
    };
    Some(Rect {
        x: centered(screen.x, screen.width, width),
        y: centered(screen.y, screen.height, height),
        width,
        height,
    })
}

/// Bring the main window back on-screen if the restored state left it
/// unreachable (for example, its monitor was unplugged).
pub fn keep_main_window_reachable(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let (Ok(position), Ok(size), Ok(scale)) = (
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
    ) else {
        return;
    };
    let Ok(monitors) = window.available_monitors() else {
        return;
    };
    let primary = window.primary_monitor().ok().flatten();
    let mut screens: Vec<Rect> = Vec::new();
    for monitor in primary.iter().chain(monitors.iter()) {
        let area = monitor.work_area();
        let screen = Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        };
        if !screens.contains(&screen) {
            screens.push(screen);
        }
    }
    let configured = app.config().app.windows.iter().find(|w| w.label == "main");
    let min_logical = (
        configured.and_then(|w| w.min_width).unwrap_or(0.0),
        configured.and_then(|w| w.min_height).unwrap_or(0.0),
    );
    let min = (
        (min_logical.0 * scale).ceil() as u32,
        (min_logical.1 * scale).ceil() as u32,
    );
    let current = Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let Some(fixed) = corrected_placement(current, &screens, min) else {
        return;
    };
    if fixed.width != current.width || fixed.height != current.height {
        // Outer and inner sizes differ by the title bar; keep that difference.
        let inner = window.inner_size().unwrap_or(size);
        let extra_w = size.width.saturating_sub(inner.width);
        let extra_h = size.height.saturating_sub(inner.height);
        if let Err(error) = window.set_size(PhysicalSize::new(
            fixed.width.saturating_sub(extra_w).max(1),
            fixed.height.saturating_sub(extra_h).max(1),
        )) {
            crate::logging::log::warn!("Could not resize the window to fit: {error}");
        }
    }
    if fixed.x != current.x || fixed.y != current.y {
        if let Err(error) = window.set_position(PhysicalPosition::new(fixed.x, fixed.y)) {
            crate::logging::log::warn!("Could not move the window back on-screen: {error}");
        } else {
            crate::logging::log::info!("Moved the window back onto a connected screen.");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: Rect = Rect {
        x: 0,
        y: 50,
        width: 2880,
        height: 1750,
    };
    const EXTERNAL_RIGHT: Rect = Rect {
        x: 2880,
        y: 0,
        width: 3840,
        height: 2160,
    };
    const MIN: (u32, u32) = (1200, 1400);

    fn window(x: i32, y: i32) -> Rect {
        Rect {
            x,
            y,
            width: 2640,
            height: 1760,
        }
    }

    #[test]
    fn a_window_on_screen_is_left_alone() {
        assert_eq!(corrected_placement(window(100, 120), &[LAPTOP], MIN), None);
        assert_eq!(
            corrected_placement(window(3000, 100), &[LAPTOP, EXTERNAL_RIGHT], MIN),
            None
        );
    }

    #[test]
    fn a_window_partly_off_the_edge_but_grabbable_is_left_alone() {
        // Most of it hangs off the right edge, but 400 px of title bar show.
        assert_eq!(corrected_placement(window(2480, 200), &[LAPTOP], MIN), None);
    }

    #[test]
    fn a_window_on_an_unplugged_screen_comes_back_centered_on_the_primary_one() {
        let fixed = corrected_placement(window(4000, 300), &[LAPTOP], MIN).unwrap();
        assert_eq!(fixed.width, 2640);
        assert_eq!(fixed.height, 1750);
        assert_eq!(fixed.x, 120);
        assert_eq!(fixed.y, 50);
        assert!(is_reachable(fixed, LAPTOP));
    }

    #[test]
    fn only_a_sliver_of_corner_on_screen_still_comes_back() {
        // Its bottom-left corner touches the screen; the title bar does not.
        let fixed = corrected_placement(window(2860, -1700), &[LAPTOP], MIN).unwrap();
        assert!(is_reachable(fixed, LAPTOP));
    }

    #[test]
    fn a_title_bar_above_the_screen_top_comes_back() {
        let fixed = corrected_placement(window(100, -30), &[LAPTOP], MIN).unwrap();
        assert!(is_reachable(fixed, LAPTOP));
    }

    #[test]
    fn a_saved_size_below_the_minimum_grows_to_it() {
        let small = Rect {
            x: 100,
            y: 100,
            width: 400,
            height: 300,
        };
        let fixed = corrected_placement(small, &[LAPTOP], MIN).unwrap();
        assert_eq!((fixed.x, fixed.y), (100, 100));
        assert_eq!((fixed.width, fixed.height), MIN);
    }

    #[test]
    fn no_screen_information_changes_nothing() {
        assert_eq!(corrected_placement(window(9000, 9000), &[], MIN), None);
    }

    #[test]
    fn the_plugin_restores_only_size_position_and_maximized() {
        let lib = include_str!("lib.rs").replace("\r\n", "\n");
        assert!(lib.contains(
            "with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)"
        ));
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = &config["app"]["windows"][0];
        assert_eq!(main["minWidth"], 600);
        assert_eq!(main["minHeight"], 700);
    }
}
