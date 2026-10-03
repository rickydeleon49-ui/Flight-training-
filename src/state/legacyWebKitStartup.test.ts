// @vitest-environment jsdom
/**
 * A fresh start on WebKit as old as macOS 12.0's: structuredClone,
 * crypto.randomUUID and the modal <dialog> methods are all removed. The real
 * provider initializes a new database (starter pack and toolkit defaults), and
 * a material is added through the real Study Library dialog.
 */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { StudyLibrary } from "@/pages/StudyLibrary/StudyLibrary";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { removeCapabilities } from "@/testing/capabilities";

let db: TestDatabase | null = null;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let restore: (() => void) | null = null;
let context: ReturnType<typeof useAppData> | null = null;
function Probe() {
  context = useAppData();
  return null;
}

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
  db?.close();
  db = null;
  context = null;
  sessionStorage.clear();
});

it("starts fresh and adds a material without structuredClone, randomUUID or modal dialogs", async () => {
  restore = removeCapabilities([
    [globalThis, "structuredClone"],
    [globalThis.crypto, "randomUUID"],
    [HTMLDialogElement.prototype, "showModal"],
    [HTMLDialogElement.prototype, "close"],
  ]);
  expect(typeof structuredClone).toBe("undefined");
  expect(typeof crypto.randomUUID).toBe("undefined");
  db = await createNodeSqliteDatabase();

  render(h(AppDataProvider, null,
    h(MemoryRouter, { initialEntries: ["/study"] },
      h(Probe),
      h(Routes, null, h(Route, { path: "/study", element: h(StudyLibrary) })))));
  await waitFor(() => expect(context?.status).toBe("ready"));
  expect(context!.error).toBeNull();
  expect(context!.data.toolkit).toEqual(DEFAULT_TOOLKIT_STATE);
  expect(context!.data.toolkit.readinessItems).not.toBe(DEFAULT_TOOLKIT_STATE.readinessItems);
  // The starter pack's records were created with fallback ids.
  const starterIds = [...context!.data.materials, ...context!.data.goals, ...context!.data.actions].map((r) => r.id);
  expect(starterIds.length).toBeGreaterThan(0);
  for (const id of starterIds) expect(id).toMatch(UUID_V4);

  const before = context!.data.materials.length;
  fireEvent.click(screen.getAllByRole("button", { name: /Add material/ })[0]!);
  const dialog = await screen.findByRole("dialog", { name: "Add to your library" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Synthetic legacy WebKit handout" } });
  fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Add material")!);

  await waitFor(() => expect(context!.data.materials).toHaveLength(before + 1));
  const added = context!.data.materials.find((m) => m.title === "Synthetic legacy WebKit handout")!;
  expect(added.id).toMatch(UUID_V4);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
