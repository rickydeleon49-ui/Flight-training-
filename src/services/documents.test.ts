import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("@/data", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: mocks.openPath,
  revealItemInDir: mocks.revealItemInDir,
}));

import {
  cleanupDocuments,
  deleteDocument,
  DesktopOnlyError,
  documentErrorMessage,
  documentExists,
  openDocument,
  revealDocument,
} from "./documents";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(false);
  mocks.invoke.mockReset();
  mocks.openPath.mockReset();
  mocks.revealItemInDir.mockReset();
});

describe("document desktop errors", () => {
  it("keeps string errors returned by the desktop shell", () => {
    expect(documentErrorMessage("No default PDF application is installed.", "fallback")).toBe(
      "No default PDF application is installed.",
    );
  });

  it("uses the fallback only when no useful detail was returned", () => {
    expect(documentErrorMessage(null, "That file could not be opened.")).toBe(
      "That file could not be opened.",
    );
  });
});

describe("document open and reveal path lifecycle", () => {
  it("refuses to open or reveal a document without the desktop application", async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(openDocument("test.pdf")).rejects.toThrow(DesktopOnlyError);
    await expect(revealDocument("test.pdf")).rejects.toThrow(DesktopOnlyError);
  });

  it("resolves the document path and passes the exact absolute path to openPath", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
      if (command === "document_path" && args.relativePath === "mat-1.pdf") {
        return Promise.resolve("C:\\AppData\\documents\\mat-1.pdf");
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    await openDocument("mat-1.pdf");

    expect(mocks.invoke).toHaveBeenCalledWith("document_path", { relativePath: "mat-1.pdf" });
    expect(mocks.openPath).toHaveBeenCalledWith("C:\\AppData\\documents\\mat-1.pdf");
  });

  it("resolves the document path and passes the exact absolute path to revealItemInDir", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockImplementation((command: string, args: Record<string, unknown>) => {
      if (command === "document_path" && args.relativePath === "mat-1.pdf") {
        return Promise.resolve("C:\\AppData\\documents\\mat-1.pdf");
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    await revealDocument("mat-1.pdf");

    expect(mocks.invoke).toHaveBeenCalledWith("document_path", { relativePath: "mat-1.pdf" });
    expect(mocks.revealItemInDir).toHaveBeenCalledWith("C:\\AppData\\documents\\mat-1.pdf");
  });

  it("checks document existence only inside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    expect(await documentExists("mat-1.pdf")).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockResolvedValueOnce(true);
    expect(await documentExists("mat-1.pdf")).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("document_exists", { relativePath: "mat-1.pdf" });
  });

  it("deletes a document only inside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    await deleteDocument("mat-1.pdf");
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockResolvedValueOnce(undefined);
    await deleteDocument("mat-1.pdf");
    expect(mocks.invoke).toHaveBeenCalledWith("delete_document", { relativePath: "mat-1.pdf" });
  });
});

describe("generated document cleanup", () => {
  it("attempts every file and reports each one that remains", async () => {
    const attempted: string[] = [];
    const failed = await cleanupDocuments(["one.pdf", "two.pdf", "three.pdf"], async (path) => {
      attempted.push(path);
      if (path !== "two.pdf") throw new Error("injected delete failure");
    });

    expect(attempted).toEqual(["one.pdf", "two.pdf", "three.pdf"]);
    expect(failed).toEqual(["one.pdf", "three.pdf"]);
  });
});
