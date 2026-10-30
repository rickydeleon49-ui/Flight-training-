/**
 * Settling her work before the app quits (QUIT-01).
 *
 * When she quits or closes the window, the Rust side asks once for pending
 * work to finish and waits at most two seconds for the answer. Browser mode
 * has no native quit, so both calls do nothing there.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { isTauri } from "@/data";

/** Run `handler` when the app is about to quit. Returns a function that stops listening. */
export async function onSettleBeforeQuit(handler: () => void | Promise<void>): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen("settle-before-quit", () => {
    void handler();
  });
}

/** Tell the Rust side that pending work is done and the app may quit now. */
export async function reportSettled(): Promise<void> {
  if (!isTauri()) return;
  await invoke("settled_before_quit");
}
