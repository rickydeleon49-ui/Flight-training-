//! The window reopens where she left it (WINSTATE-01).
//!
//! The window-state plugin restores the saved position at startup. A visible
//! title bar alone does not mean the whole window fits: clamp its size and
//! position to a connected monitor’s work area once, immediately after restore.
//! This is never called from focus, move or file-dialog events.
//!
//! On macOS the restore's `set_position`/`set_size` are queued on the main
//! dispatch queue (tao `set_frame_top_left_point_async`), so during setup the
//! live frame is still the config's centered default. Judge the frame the
//! restore will produce (the saved state), never that stale default; any
//! correction is then queued after the restore and the saved place survives.

use std::collections::HashMap;

use serde::Deserialize;
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

/// The window-state plugin's saved entry (physical pixels; inner size).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub(crate) struct SavedWindow {
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

/// The saved entry for `label`, if the state file holds a usable one.
pub(crate) fn parse_saved(json: &str, label: &str) -> Option<SavedWindow> {
    let mut all: HashMap<String, SavedWindow> = serde_json::from_str(json).ok()?;
    all.remove(label)
        .filter(|saved| saved.width > 0 && saved.height > 0)
}

/// Same corner test the plugin uses before it restores a position.
fn corner_on(x: i32, y: i32, width: u32, height: u32, monitor: Rect) -> bool {
    let (x, y) = (i64::from(x), i64::from(y));
    let (right, bottom) = (x + i64::from(width), y + i64::from(height));
    [(x, y), (right, y), (x, bottom), (right, bottom)]
        .into_iter()
        .any(|(cx, cy)| {
            cx >= i64::from(monitor.x)
                && cx < monitor.right()
                && cy >= i64::from(monitor.y)
                && cy < monitor.bottom()
        })
}

/// The outer frame the window has once the queued restore has run.
/// `live` is the frame now (before the restore applies), `chrome` the
/// outer-minus-inner size, `monitors` the full monitor frames.
pub(crate) fn frame_after_restore(
    saved: Option<SavedWindow>,
    live: Rect,
    chrome: (u32, u32),
    monitors: &[Rect],
) -> Rect {
    let Some(saved) = saved else {
        return live;
    };
    let width = saved.width.saturating_add(chrome.0);
    let height = saved.height.saturating_add(chrome.1);
    let restores_position = monitors
        .iter()
        .any(|monitor| corner_on(saved.x, saved.y, saved.width, saved.height, *monitor));
    let (x, y) = if restores_position {
        (saved.x, saved.y)
    } else {
        (live.x, live.y)
    };
    Rect {
        x,
        y,
        width,
        height,
    }
}

fn fits_inside(window: Rect, screen: Rect) -> bool {
    window.x >= screen.x
        && window.y >= screen.y
        && window.right() <= screen.right()
        && window.bottom() <= screen.bottom()
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

/// Clamp both axes to the connected screen’s work area.
fn fit_on(window: Rect, screen: Rect, min: (u32, u32)) -> Rect {
    let axis = |origin: i32, size: u32, screen_origin: i32, space: u32, min: u32| {
        let size = size.max(min).min(space);
        let last = i64::from(screen_origin) + i64::from(space) - i64::from(size);
        let origin =
            i64::from(origin).clamp(i64::from(screen_origin), last.max(i64::from(screen_origin)));
        (i32::try_from(origin).unwrap_or(screen_origin), size)
    };
    let (x, width) = axis(window.x, window.width, screen.x, screen.width, min.0);
    let (y, height) = axis(window.y, window.height, screen.y, screen.height, min.1);
    Rect {
        x,
        y,
        width,
        height,
    }
}

/// Where the window should be instead, or `None` when it is already fine.
/// `screens` are work areas with the primary screen first; `min` is the
/// minimum size in physical pixels.
pub(crate) fn corrected_placement(window: Rect, screens: &[Rect], min: (u32, u32)) -> Option<Rect> {
    // A window wholly inside a work area, at least the minimum size, stays put.
    if window.width >= min.0
        && window.height >= min.1
        && screens.iter().any(|screen| fits_inside(window, *screen))
    {
        return None;
    }
    let width = window.width.max(min.0);
    let height = window.height.max(min.1);
    let sized = Rect {
        width,
        height,
        ..window
    };
    // Prefer the screen holding most of the title bar when displays meet.
    if let Some(screen) = screens
        .iter()
        .filter(|screen| is_reachable(sized, **screen))
        .max_by_key(|screen| {
            let (width, height) = title_strip_overlap(sized, **screen);
            width * height
        })
    {
        let fitted = fit_on(sized, *screen, min);
        return (fitted != window).then_some(fitted);
    }
    let screen = *screens.first()?;
    let width = width.min(screen.width);
    let height = height.min(screen.height);
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

/// The plugin's saved state for the main window, read from its own file
/// (unchanged on disk until exit, so it is what the plugin restores).
fn read_saved(app: &AppHandle) -> Option<SavedWindow> {
    use tauri_plugin_window_state::AppHandleExt;
    let path = app.path().app_config_dir().ok()?.join(app.filename());
    parse_saved(&std::fs::read_to_string(path).ok()?, "main")
}

/// Bring the main window back on-screen if the restored state left it
/// partly off-screen (for example, its monitor was unplugged).
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
    let saved = read_saved(app);
    if saved.is_some_and(|saved| saved.maximized) {
        // The queued restore maximizes it; nothing to clamp.
        return;
    }
    let primary = window.primary_monitor().ok().flatten();
    let frames: Vec<Rect> = monitors
        .iter()
        .map(|monitor| Rect {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect();
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
    // Outer and inner sizes differ by the title bar; keep that difference.
    let inner = window.inner_size().unwrap_or(size);
    let extra_w = size.width.saturating_sub(inner.width);
    let extra_h = size.height.saturating_sub(inner.height);
    let live = Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let current = frame_after_restore(saved, live, (extra_w, extra_h), &frames);
    let Some(fixed) = corrected_placement(current, &screens, min) else {
        return;
    };
    let resized = fixed.width != current.width || fixed.height != current.height;
    if resized {
        // A smaller connected screen takes priority over the usual minimum.
        if let Err(error) = window.set_min_size(Some(PhysicalSize::new(
            min.0.min(fixed.width.saturating_sub(extra_w)).max(1),
            min.1.min(fixed.height.saturating_sub(extra_h)).max(1),
        ))) {
            crate::logging::log::warn!("Could not adjust the minimum window size: {error}");
        }
        if let Err(error) = window.set_size(PhysicalSize::new(
            fixed.width.saturating_sub(extra_w).max(1),
            fixed.height.saturating_sub(extra_h).max(1),
        )) {
            crate::logging::log::warn!("Could not resize the window to fit: {error}");
        }
    }
    let moved = fixed.x != current.x || fixed.y != current.y;
    // Pin the top-left after a resize too: AppKit's setContentSize keeps the
    // bottom-left corner, which would shift the top edge.
    if moved || resized {
        if let Err(error) = window.set_position(PhysicalPosition::new(fixed.x, fixed.y)) {
            crate::logging::log::warn!("Could not move the window back on-screen: {error}");
        } else if moved {
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
            height: 1600,
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
    fn a_window_partly_off_the_edge_is_clamped() {
        // Most of it hangs off the right edge, but 400 px of title bar show.
        assert_eq!(
            corrected_placement(window(2480, 200), &[LAPTOP], MIN),
            Some(window(240, 200))
        );
    }

    #[test]
    fn each_edge_fits_inside_the_visible_work_area() {
        for saved in [window(-100, 100), window(100, 1000), window(100, 30)] {
            let fixed = corrected_placement(saved, &[LAPTOP], MIN).unwrap();
            assert!(fixed.x >= LAPTOP.x && fixed.y >= LAPTOP.y);
            assert!(fixed.right() <= LAPTOP.right() && fixed.bottom() <= LAPTOP.bottom());
        }
    }

    #[test]
    fn a_connected_screen_left_of_primary_keeps_the_window_there() {
        let left = Rect {
            x: -3000,
            y: -100,
            width: 3000,
            height: 2000,
        };
        let fixed = corrected_placement(window(-2000, 100), &[LAPTOP, left], MIN).unwrap();
        assert_eq!(fixed, window(-2640, 100));
    }

    #[test]
    fn a_window_on_an_unplugged_screen_comes_back_centered_on_the_primary_one() {
        let saved = Rect {
            height: 1760,
            ..window(4000, 300)
        };
        let fixed = corrected_placement(saved, &[LAPTOP], MIN).unwrap();
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
    fn a_window_larger_than_its_screen_shrinks_to_fit_it() {
        // Saved on a big external monitor that shared the laptop's origin.
        let big = Rect {
            x: 0,
            y: 50,
            width: 3400,
            height: 2000,
        };
        let fixed = corrected_placement(big, &[LAPTOP], MIN).unwrap();
        assert_eq!(fixed, LAPTOP);
        assert!(is_reachable(fixed, LAPTOP));
    }

    #[test]
    fn a_too_tall_window_lower_down_moves_up_to_fit() {
        let tall = Rect {
            x: 100,
            y: 300,
            width: 2000,
            height: 2000,
        };
        let fixed = corrected_placement(tall, &[LAPTOP], MIN).unwrap();
        assert_eq!(
            fixed,
            Rect {
                x: 100,
                y: 50,
                width: 2000,
                height: 1750,
            }
        );
    }

    #[test]
    fn a_screen_smaller_than_the_minimum_still_fits_the_whole_window() {
        let small_screen = Rect {
            x: 0,
            y: 25,
            width: 1000,
            height: 1200,
        };
        let big = Rect {
            x: 400,
            y: 300,
            width: 3000,
            height: 2000,
        };
        let fixed = corrected_placement(big, &[small_screen], MIN).unwrap();
        assert_eq!(
            fixed,
            Rect {
                x: 0,
                y: 25,
                width: 1000,
                height: 1200,
            }
        );
        assert!(is_reachable(fixed, small_screen));
        // Already in place: nothing more to do next launch.
        assert_eq!(corrected_placement(fixed, &[small_screen], MIN), None);
    }

    // A 1470x956 pt Retina Mac (scale 2) with the Dock at the bottom.
    const MAC_MONITOR: Rect = Rect {
        x: 0,
        y: 0,
        width: 2940,
        height: 1912,
    };
    const MAC_WORK: Rect = Rect {
        x: 0,
        y: 66,
        width: 2940,
        height: 1676,
    };
    const MAC_MIN: (u32, u32) = (1200, 1400);
    const TITLE_BAR: (u32, u32) = (0, 56);
    // The config's 1320x880 pt window centered by `center: true`, before the
    // queued restore has applied (what `outer_position` reads during setup).
    const CENTERED_DEFAULT: Rect = Rect {
        x: 150,
        y: 66,
        width: 2640,
        height: 1816,
    };

    fn saved(x: i32, y: i32, width: u32, height: u32) -> Option<SavedWindow> {
        Some(SavedWindow {
            x,
            y,
            width,
            height,
            maximized: false,
        })
    }

    #[test]
    fn a_fully_on_screen_saved_window_is_never_moved_or_resized() {
        // Saved at (20, 33) pt, 600x780 pt inner: wholly inside the work area.
        let frame = frame_after_restore(
            saved(40, 66, 1200, 1560),
            CENTERED_DEFAULT,
            TITLE_BAR,
            &[MAC_MONITOR],
        );
        assert_eq!(
            frame,
            Rect {
                x: 40,
                y: 66,
                width: 1200,
                height: 1616
            }
        );
        assert_eq!(corrected_placement(frame, &[MAC_WORK], MAC_MIN), None);
        // Before WIN-RESTORE-01 the clamp judged the stale centered frame and
        // resized/moved it, overriding the restore that was still queued.
        assert!(corrected_placement(CENTERED_DEFAULT, &[MAC_WORK], MAC_MIN).is_some());
    }

    #[test]
    fn saved_positions_round_trip_unchanged_at_scale_two() {
        // Odd physical coordinates (half points at scale 2) and other screens.
        for (x, y) in [(41, 67), (40, 66), (1, 301), (299, 125)] {
            let frame = frame_after_restore(
                saved(x, y, 1201, 1301),
                CENTERED_DEFAULT,
                TITLE_BAR,
                &[MAC_MONITOR],
            );
            assert_eq!((frame.x, frame.y), (x, y));
            let min = (1201, 1357);
            assert_eq!(
                corrected_placement(frame, &[MAC_WORK], min),
                None,
                "({x}, {y})"
            );
        }
        let external = Rect {
            x: 2940,
            y: 0,
            width: 3840,
            height: 2160,
        };
        let frame = frame_after_restore(
            saved(3001, 101, 2000, 1500),
            CENTERED_DEFAULT,
            TITLE_BAR,
            &[MAC_MONITOR, external],
        );
        assert_eq!(
            corrected_placement(frame, &[MAC_WORK, external], MAC_MIN),
            None
        );
    }

    #[test]
    fn a_saved_window_partly_below_the_work_area_keeps_its_left_edge() {
        // The QA layout: 600x821 pt at (20, 33) pt reaches 11 pt behind the Dock.
        let frame = frame_after_restore(
            saved(40, 66, 1200, 1642),
            CENTERED_DEFAULT,
            TITLE_BAR,
            &[MAC_MONITOR],
        );
        let fixed = corrected_placement(frame, &[MAC_WORK], MAC_MIN).unwrap();
        assert_eq!(
            fixed,
            Rect {
                x: 40,
                y: 66,
                width: 1200,
                height: 1676
            }
        );
    }

    #[test]
    fn without_a_restorable_saved_state_the_live_frame_is_judged() {
        assert_eq!(
            frame_after_restore(None, CENTERED_DEFAULT, TITLE_BAR, &[MAC_MONITOR]),
            CENTERED_DEFAULT
        );
        // Saved on an unplugged screen: the plugin keeps the live position.
        let frame = frame_after_restore(
            saved(9000, 9000, 1200, 1500),
            CENTERED_DEFAULT,
            TITLE_BAR,
            &[MAC_MONITOR],
        );
        assert_eq!((frame.x, frame.y), (150, 66));
        assert_eq!((frame.width, frame.height), (1200, 1556));
    }

    #[test]
    fn the_saved_state_file_is_parsed_like_the_plugin_writes_it() {
        let json = r#"{"main":{"width":1200,"height":1642,"x":40,"y":66,"prev_x":150,"prev_y":66,"maximized":false,"visible":true,"decorated":true,"fullscreen":false}}"#;
        assert_eq!(parse_saved(json, "main"), saved(40, 66, 1200, 1642));
        assert_eq!(parse_saved(json, "other"), None);
        assert_eq!(
            parse_saved(r#"{"main":{"width":0,"height":0}}"#, "main"),
            None
        );
        assert_eq!(parse_saved("not json", "main"), None);
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
