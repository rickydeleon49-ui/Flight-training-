/**
 * System notifications through the Tauri notification plugin.
 *
 * Every call is safe: outside the app (browser mode, tests) it does nothing,
 * and a plugin error is swallowed so a missed notice never breaks a screen.
 * Permission is asked only from `askPermission()`, which a tap must call.
 */
import { isTauri } from "@/data";

type Plugin = typeof import("@tauri-apps/plugin-notification");

async function plugin(): Promise<Plugin | null> {
  if (!isTauri()) return null;
  try {
    return await import("@tauri-apps/plugin-notification");
  } catch {
    return null;
  }
}

/** True only when the system already lets this app show notifications. */
export async function canNotify(): Promise<boolean> {
  try {
    const p = await plugin();
    return p ? (await p.isPermissionGranted()) === true : false;
  } catch {
    return false;
  }
}

/** Ask the system for permission. Call only from an explicit tap. True when granted. */
export async function askPermission(): Promise<boolean> {
  try {
    const p = await plugin();
    if (!p) return false;
    if ((await p.isPermissionGranted()) === true) return true;
    return (await p.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Show a notice if permission is granted. Never throws; false when nothing was shown. */
export async function notify(title: string, body: string): Promise<boolean> {
  try {
    const p = await plugin();
    if (!p || (await p.isPermissionGranted()) !== true) return false;
    p.sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

const DAILY_ID = 41001;

/**
 * iPhone only: keep ONE repeating notice at HH:MM local time with the system
 * (it shows even when the app is closed). Replaces any earlier one. False when
 * nothing was scheduled (no permission, not in the app, or an error).
 */
export async function scheduleDaily(time: string, title: string, body: string): Promise<boolean> {
  try {
    const p = await plugin();
    if (!p || (await p.isPermissionGranted()) !== true) return false;
    const [hour, minute] = time.split(":").map(Number);
    if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return false;
    await p.cancel([DAILY_ID]);
    p.sendNotification({ id: DAILY_ID, title, body, schedule: p.Schedule.interval({ hour, minute }) });
    return true;
  } catch {
    return false;
  }
}

/** Remove the repeating daily notice, if any. Never throws. */
export async function cancelDaily(): Promise<void> {
  try {
    const p = await plugin();
    if (p) await p.cancel([DAILY_ID]);
  } catch {
    /* nothing to cancel */
  }
}
