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
  commitDeleteDocument,
  deleteDocument,
  DesktopOnlyError,
  documentErrorMessage,
  documentExists,
  openDocument,
  removeMaterialWithFile,
  revealDocument,
  rollbackDeleteDocument,
  stageDeleteDocument,
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

  it("stages document deletion in private trash inside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    expect(await stageDeleteDocument("mat-1.pdf")).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.isTauri.mockReturnValue(true);
    const mockStaged = {
      stagedId: "staged-123",
      originalRelativePath: "mat-1.pdf",
      alreadyMissing: false,
    };
    mocks.invoke.mockResolvedValueOnce(mockStaged);
    const result = await stageDeleteDocument("mat-1.pdf");
    expect(result).toEqual(mockStaged);
    expect(mocks.invoke).toHaveBeenCalledWith("stage_delete_document", { relativePath: "mat-1.pdf" });
  });

  it("rolls back staged document deletion inside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    await rollbackDeleteDocument("staged-123");
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.isTauri.mockReturnValue(true);
    await rollbackDeleteDocument("");
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValueOnce(undefined);
    await rollbackDeleteDocument("staged-123");
    expect(mocks.invoke).toHaveBeenCalledWith("rollback_delete_document", { stagedId: "staged-123" });
  });

  it("commits and purges staged document deletion inside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    await commitDeleteDocument("staged-123");
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.isTauri.mockReturnValue(true);
    await commitDeleteDocument("");
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValueOnce(undefined);
    await commitDeleteDocument("staged-123");
    expect(mocks.invoke).toHaveBeenCalledWith("commit_delete_document", { stagedId: "staged-123" });
  });
});

describe("recoverable deletion lifecycle", () => {
  it("leaves database record untouched if staging fails", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.invoke.mockRejectedValueOnce(
      new Error("Could not delete that document because it is currently open in another app.")
    );

    const mockRemoveDb = vi.fn().mockResolvedValue(undefined);
    const repos = { documents: { remove: mockRemoveDb } };
    const material = { id: "mat-locked", filePath: "locked.pdf" };

    await expect(removeMaterialWithFile(repos, material)).rejects.toThrow("open in another app");
    expect(mockRemoveDb).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("stage_delete_document", { relativePath: "locked.pdf" });
    expect(mocks.invoke).not.toHaveBeenCalledWith("rollback_delete_document", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("commit_delete_document", expect.anything());
  });

  it("calls rollback and rethrows DB error if record deletion fails", async () => {
    mocks.isTauri.mockReturnValue(true);
    const stagedInfo = {
      stagedId: "staged-err-1",
      originalRelativePath: "mat-fail.pdf",
      alreadyMissing: false,
    };
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "stage_delete_document") return Promise.resolve(stagedInfo);
      if (cmd === "rollback_delete_document") return Promise.resolve();
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });

    const dbError = new Error("SQLite lock failure");
    const mockRemoveDb = vi.fn().mockRejectedValue(dbError);
    const repos = { documents: { remove: mockRemoveDb } };
    const material = { id: "mat-1", filePath: "mat-fail.pdf" };

    await expect(removeMaterialWithFile(repos, material)).rejects.toThrow("SQLite lock failure");
    expect(mocks.invoke).toHaveBeenCalledWith("stage_delete_document", { relativePath: "mat-fail.pdf" });
    expect(mockRemoveDb).toHaveBeenCalledWith("mat-1");
    expect(mocks.invoke).toHaveBeenCalledWith("rollback_delete_document", { stagedId: "staged-err-1" });
    expect(mocks.invoke).not.toHaveBeenCalledWith("commit_delete_document", expect.anything());
  });

  it("calls commit when staging and record deletion succeed", async () => {
    mocks.isTauri.mockReturnValue(true);
    const stagedInfo = {
      stagedId: "staged-ok-1",
      originalRelativePath: "mat-ok.pdf",
      alreadyMissing: false,
    };
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "stage_delete_document") return Promise.resolve(stagedInfo);
      if (cmd === "commit_delete_document") return Promise.resolve();
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });

    const mockRemoveDb = vi.fn().mockResolvedValue(undefined);
    const repos = { documents: { remove: mockRemoveDb } };
    const material = { id: "mat-ok", filePath: "mat-ok.pdf" };

    await removeMaterialWithFile(repos, material);
    expect(mocks.invoke).toHaveBeenCalledWith("stage_delete_document", { relativePath: "mat-ok.pdf" });
    expect(mockRemoveDb).toHaveBeenCalledWith("mat-ok");
    expect(mocks.invoke).toHaveBeenCalledWith("commit_delete_document", { stagedId: "staged-ok-1" });
    expect(mocks.invoke).not.toHaveBeenCalledWith("rollback_delete_document", expect.anything());
  });

  it("deletes record without file calls when material has no filePath", async () => {
    mocks.isTauri.mockReturnValue(true);
    const mockRemoveDb = vi.fn().mockResolvedValue(undefined);
    const repos = { documents: { remove: mockRemoveDb } };
    const material = { id: "mat-no-file", filePath: null };

    await removeMaterialWithFile(repos, material);
    expect(mockRemoveDb).toHaveBeenCalledWith("mat-no-file");
    expect(mocks.invoke).not.toHaveBeenCalledWith("stage_delete_document", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("rollback_delete_document", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("commit_delete_document", expect.anything());
  });

  it("deletes record without commit when file was already missing", async () => {
    mocks.isTauri.mockReturnValue(true);
    const stagedInfo = {
      stagedId: "",
      originalRelativePath: "mat-missing.pdf",
      alreadyMissing: true,
    };
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "stage_delete_document") return Promise.resolve(stagedInfo);
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });

    const mockRemoveDb = vi.fn().mockResolvedValue(undefined);
    const repos = { documents: { remove: mockRemoveDb } };
    const material = { id: "mat-missing", filePath: "mat-missing.pdf" };

    await removeMaterialWithFile(repos, material);
    expect(mocks.invoke).toHaveBeenCalledWith("stage_delete_document", { relativePath: "mat-missing.pdf" });
    expect(mockRemoveDb).toHaveBeenCalledWith("mat-missing");
    expect(mocks.invoke).not.toHaveBeenCalledWith("commit_delete_document", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("rollback_delete_document", expect.anything());
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
