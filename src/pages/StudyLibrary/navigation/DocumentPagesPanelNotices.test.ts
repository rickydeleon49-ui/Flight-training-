// @vitest-environment jsdom
/**
 * NAV-UI-01: the pages panel's notices belong to the repository and material
 * an action started on. The same panel stays mounted while its repository is
 * replaced (A, 50 pages, then B, 70 pages); a check or removal held under A
 * that finishes afterwards must say nothing over B, while a check under the
 * current repository still announces a change or failure. Repositories are
 * deterministic stand-ins over the real navigation hook and controller; no
 * file, reader, profile or provider is used.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NavigationRepository } from "@/data/repositories/navigationRepository";
import type { InspectedNavigationIdentity, NavigationBookmark, NavigationState } from "@/domain/types";
import { NavigationError } from "@/data/navigationTransaction";
import { makeMaterial } from "@/testing/factories";

import { DocumentPagesPanel } from "./DocumentPagesPanel";

let current: NavigationRepository;
vi.mock("@/state/AppDataContext", () => ({ useOptionalAppData: () => ({ repositories: { navigation: current } }) }));

const material = makeMaterial({ id: "m", filePath: "synthetic.pdf" });
const props = { material, fileMissing: false, restoring: false, onRestore: () => {} };
const CHANGED = "This file changed since it was last checked. Places saved for the earlier version are marked.";
const OLD_FAILURE = "Synthetic old-context failure";

const bookmark: NavigationBookmark = {
  id: "bm",
  materialId: "m",
  physicalPage: 3,
  pageLabel: null,
  originatingContentSha256: "a".repeat(64),
  title: "Airspace chart",
  notes: "",
  status: "verified",
  createdAt: "x",
  updatedAt: "x",
};

function state(totalPages: number, bookmarks: NavigationBookmark[] = []): NavigationState {
  const hash = (totalPages === 50 ? "a" : "b").repeat(64);
  return { materialId: "m", identity: { materialId: "m", contentSha256: hash, totalPages, verifiedAt: "x" }, readingState: null, bookmarks };
}

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function repo(totalPages: number, options: { inspect?: Promise<InspectedNavigationIdentity>; remove?: Promise<void>; bookmarks?: NavigationBookmark[] } = {}) {
  return {
    supported: () => true,
    canCheckFiles: () => true,
    inspect: () => options.inspect ?? Promise.resolve({ ...state(totalPages).identity!, changed: false }),
    operation: async (op: { kind: string }) => {
      if (op.kind === "delete_bookmark" && options.remove) await options.remove;
      return state(totalPages, options.bookmarks);
    },
  } as unknown as NavigationRepository;
}

afterEach(cleanup);

async function switchToB(view: ReturnType<typeof render>) {
  current = repo(70);
  view.rerender(h(DocumentPagesPanel, props));
  await screen.findByText("This PDF has 70 pages.");
}

describe("NAV-UI-01: a retired action announces nothing over the current repository", () => {
  it.each(["success", "failure"] as const)("a held check's %s from repository A is not shown over B", async (outcome) => {
    const held = gate<InspectedNavigationIdentity>();
    current = repo(50, { inspect: held.promise });
    const view = render(h(DocumentPagesPanel, props));
    await screen.findByText("This PDF has 50 pages.");
    fireEvent.click(screen.getByRole("button", { name: "Check pages" }));

    await switchToB(view);
    await act(async () => {
      if (outcome === "success") held.resolve({ ...state(50).identity!, changed: true });
      else held.reject(new NavigationError("FILE_MISSING", OLD_FAILURE));
    });

    expect(screen.getByText("This PDF has 70 pages.")).toBeTruthy();
    expect(screen.queryByText(CHANGED)).toBeNull();
    expect(screen.queryByText(OLD_FAILURE)).toBeNull();
  });

  it("a held bookmark removal that fails under A is not shown over B", async () => {
    const held = gate<void>();
    current = repo(50, { remove: held.promise, bookmarks: [bookmark] });
    const view = render(h(DocumentPagesPanel, props));
    await screen.findByText("This PDF has 50 pages.");
    fireEvent.click(screen.getByRole("button", { name: "Remove bookmark Airspace chart" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove this bookmark?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));

    await switchToB(view);
    await act(async () => held.reject(new NavigationError("STORAGE_FAILURE", OLD_FAILURE)));

    expect(screen.getByText("This PDF has 70 pages.")).toBeTruthy();
    expect(screen.queryByText(OLD_FAILURE)).toBeNull();
  });

  it("a notice already shown for A is cleared when the repository changes", async () => {
    current = repo(50, { inspect: Promise.resolve({ ...state(50).identity!, changed: true }) });
    const view = render(h(DocumentPagesPanel, props));
    await screen.findByText("This PDF has 50 pages.");
    fireEvent.click(screen.getByRole("button", { name: "Check pages" }));
    await screen.findByText(CHANGED);

    await switchToB(view);

    expect(screen.queryByText(CHANGED)).toBeNull();
  });

  it("a check finishing after the panel is gone does nothing", async () => {
    const held = gate<InspectedNavigationIdentity>();
    current = repo(50, { inspect: held.promise });
    const view = render(h(DocumentPagesPanel, props));
    await screen.findByText("This PDF has 50 pages.");
    fireEvent.click(screen.getByRole("button", { name: "Check pages" }));

    view.unmount();
    await act(async () => held.resolve({ ...state(50).identity!, changed: true }));

    expect(screen.queryByText(CHANGED)).toBeNull();
  });
});

describe("NAV-UI-01 controls: the current repository still reports", () => {
  it("a check under the current repository announces a changed file", async () => {
    const held = gate<InspectedNavigationIdentity>();
    current = repo(50);
    const view = render(h(DocumentPagesPanel, props));
    await screen.findByText("This PDF has 50 pages.");
    current = repo(70, { inspect: held.promise });
    view.rerender(h(DocumentPagesPanel, props));
    await screen.findByText("This PDF has 70 pages.");

    fireEvent.click(screen.getByRole("button", { name: "Check pages" }));
    await act(async () => held.resolve({ ...state(70).identity!, changed: true }));

    await screen.findByText(CHANGED);
  });

  it("a check under the current repository shows its failure", async () => {
    const held = gate<InspectedNavigationIdentity>();
    current = repo(50, { inspect: held.promise });
    render(h(DocumentPagesPanel, props));
    await screen.findByText("This PDF has 50 pages.");

    fireEvent.click(screen.getByRole("button", { name: "Check pages" }));
    await act(async () => held.reject(new NavigationError("FILE_MISSING", "Synthetic current failure")));

    await waitFor(() => expect(screen.getByText("Synthetic current failure")).toBeTruthy());
  });
});
