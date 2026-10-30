// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

/**
 * QUIT-01: when the Rust side asks to settle before quitting, a deletion in
 * its Undo window is carried out, queued writes finish, and only then is the
 * answer sent — and it is sent even when something failed.
 */
let db: TestDatabase;
const log: string[] = [];
let quitHandler: (() => void) | null = null;

vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    if (event === "settle-before-quit") quitHandler = handler;
    return () => {
      if (event === "settle-before-quit") quitHandler = null;
    };
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    log.push(`invoke:${command}`);
    return [];
  }),
}));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}

async function mount() {
  render(h(AppDataProvider, null, h(Probe)));
  await waitFor(() => expect(context.status).toBe("ready"));
  await waitFor(() => expect(quitHandler).not.toBeNull());
}
/** The close request, as the Rust side sends it. */
function requestQuit() {
  act(() => quitHandler!());
}
const settled = () => log.filter((entry) => entry === "invoke:settled_before_quit").length;

beforeEach(async () => {
  log.length = 0;
  quitHandler = null;
  db = await createNodeSqliteDatabase();
});

afterEach(() => {
  cleanup();
  db.close();
  vi.clearAllMocks();
});

describe("settling before quit", () => {
  it("carries out a deletion still in its Undo window, then answers", async () => {
    await mount();
    act(() => {
      context.deleteWithUndo({
        label: "Synthetic item",
        ids: ["synthetic-id"],
        run: async () => {
          log.push("deleted");
        },
      });
    });
    expect(context.pendingDelete).not.toBeNull();
    requestQuit();
    await waitFor(() => expect(settled()).toBe(1));
    expect(log.indexOf("deleted")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("deleted")).toBeLessThan(log.indexOf("invoke:settled_before_quit"));
    await waitFor(() => expect(context.pendingDelete).toBeNull());
  });

  it("waits for writes already queued before answering", async () => {
    await mount();
    let finish!: () => void;
    void context.mutate(() => new Promise<void>((resolve) => {
      finish = () => {
        log.push("write finished");
        resolve();
      };
    }));
    requestQuit();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled()).toBe(0);
    finish();
    await waitFor(() => expect(settled()).toBe(1));
    expect(log.indexOf("write finished")).toBeLessThan(log.indexOf("invoke:settled_before_quit"));
  });

  it("answers when nothing is waiting", async () => {
    await mount();
    requestQuit();
    await waitFor(() => expect(settled()).toBe(1));
  });

  it("answers even when the deletion fails", async () => {
    await mount();
    act(() => {
      context.deleteWithUndo({
        label: "Synthetic item",
        ids: ["synthetic-id"],
        run: async () => {
          log.push("delete failed");
          throw new Error("synthetic failure");
        },
      });
    });
    requestQuit();
    await waitFor(() => expect(settled()).toBe(1));
    expect(log).toContain("delete failed");
  });

  it("a second close request while settling does nothing more", async () => {
    await mount();
    requestQuit();
    requestQuit();
    await waitFor(() => expect(settled()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled()).toBe(1);
  });
});
