/**
 * Strict desktop navigation adapters (M4S1-R2): a successful acknowledgement
 * must match the request it answers field by field; refusals stay readable
 * even when they carry newer state; anything else is STORAGE_FAILURE and
 * never a published success. Includes the two frozen review diagnostics
 * (docs/evidence/m4-slice1-partial-review-2026-10-16/diagnostics.mjs),
 * promoted to permanent tests with the request shapes updated for M4S1-R1.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { NavigationOperation, NavigationReadingState } from "@/domain/types";

import {
  invokeInspectNavigationIdentity,
  invokeNavigationOperation,
  invokeOpenNavigationDocument,
  isNavigationResultFor,
  nativeNavigationRefusal,
} from "./navigationShapes";
import { NAVIGATION_ERROR_MESSAGES, NavigationError, executeNavigationOperation } from "./navigationTransaction";

const A = "a".repeat(64);
const B = "b".repeat(64);

type Op<K extends NavigationOperation["kind"]> = Extract<NavigationOperation, { kind: K }>;

const commitOp: Op<"commit"> = { kind: "commit", materialId: "mat", generation: 4, contentSha256: A, physicalPage: 5, pageLabel: "3-1" };
const committedState: NavigationReadingState = {
  materialId: "mat", lastRequestedPage: 5, lastRequestedPageLabel: "3-1", confirmedRead: false,
  originatingContentSha256: A, status: "active", ownerGeneration: 4, updatedAt: "2026-10-16T00:00:00.000Z",
};
const setReadOp: Op<"set_read"> = { kind: "set_read", materialId: "mat", expectedContentSha256: A, expectedOwnerGeneration: 4, physicalPage: 5, confirmed: true };
const bookmarkOp: Op<"add_bookmark"> = {
  kind: "add_bookmark", materialId: "mat", expectedContentSha256: A, bookmarkId: "b1", physicalPage: 3, pageLabel: "iv", title: "Charts", notes: "n",
};
const bookmark = {
  id: "b1", materialId: "mat", physicalPage: 3, pageLabel: "iv", originatingContentSha256: A, title: "Charts", notes: "n",
  status: "verified", createdAt: "x", updatedAt: "x",
};

describe("a successful commit acknowledgement is bound to the request", () => {
  const success = (state: unknown) => ({ committed: true, reason: null, readingState: state });

  it("accepts exactly the requested tuple", () => {
    expect(isNavigationResultFor(commitOp, success(committedState))).toBe(true);
    expect(isNavigationResultFor({ ...commitOp, pageLabel: null }, success({ ...committedState, lastRequestedPageLabel: null }))).toBe(true);
  });

  it.each([
    ["material", { materialId: "other" }],
    ["physical page", { lastRequestedPage: 6 }],
    ["content hash", { originatingContentSha256: B }],
    ["missing origin", { originatingContentSha256: null }],
    ["printed label", { lastRequestedPageLabel: "3-2" }],
    ["dropped label", { lastRequestedPageLabel: null }],
    ["owner generation", { ownerGeneration: 5 }],
    ["drifted status", { status: "drifted" }],
    ["unverified status", { status: "unverified" }],
    ["confirmed read", { confirmedRead: true }],
    ["unsafe page", { lastRequestedPage: 2 ** 53 }],
    ["extra key", { extra: 1 }],
  ])("refuses a single corrupted field: %s", (_name, change) => {
    expect(isNavigationResultFor(commitOp, success({ ...committedState, ...change }))).toBe(false);
  });

  it("refuses a success with a reason or no state", () => {
    expect(isNavigationResultFor(commitOp, { committed: true, reason: "replayed", readingState: committedState })).toBe(false);
    expect(isNavigationResultFor(commitOp, { committed: true, reason: null, readingState: null })).toBe(false);
  });

  it("keeps refusals representable, including newer current state that differs from the request", () => {
    const newer = { ...committedState, lastRequestedPage: 9, ownerGeneration: 7, lastRequestedPageLabel: null, confirmedRead: true };
    for (const reason of ["superseded", "cancelled", "replayed", "unreserved", "identity_unknown", "identity_changed", "out_of_bounds"]) {
      expect(isNavigationResultFor(commitOp, { committed: false, reason, readingState: newer }), reason).toBe(true);
      expect(isNavigationResultFor(commitOp, { committed: false, reason, readingState: null }), reason).toBe(true);
    }
    expect(isNavigationResultFor(commitOp, { committed: false, reason: "nope", readingState: null })).toBe(false);
    expect(isNavigationResultFor(commitOp, { committed: false, reason: "superseded", readingState: { ...newer, materialId: "other" } })).toBe(false);
  });
});

describe("read confirmation and bookmark acknowledgements are bound to the request", () => {
  const confirmed = { ...committedState, confirmedRead: true };

  it("accepts the exact confirmation and clearing", () => {
    expect(isNavigationResultFor(setReadOp, confirmed)).toBe(true);
    expect(isNavigationResultFor({ ...setReadOp, confirmed: false }, committedState)).toBe(true);
  });

  it.each([
    ["confirmation not applied", { confirmedRead: false }],
    ["other content", { originatingContentSha256: B }],
    ["other generation", { ownerGeneration: 3 }],
    ["other page", { lastRequestedPage: 6 }],
    ["drifted", { status: "drifted" }],
    ["other material", { materialId: "other" }],
  ])("refuses a single corrupted confirmation field: %s", (_name, change) => {
    expect(isNavigationResultFor(setReadOp, { ...confirmed, ...change })).toBe(false);
  });

  it.each([
    ["id", { id: "b2" }],
    ["page", { physicalPage: 4 }],
    ["label", { pageLabel: null }],
    ["content", { originatingContentSha256: B }],
    ["title", { title: "Other" }],
    ["notes", { notes: "" }],
    ["status", { status: "drifted" }],
    ["material", { materialId: "other" }],
  ])("refuses a single corrupted bookmark field: %s", (_name, change) => {
    expect(isNavigationResultFor(bookmarkOp, bookmark)).toBe(true);
    expect(isNavigationResultFor(bookmarkOp, { ...bookmark, ...change })).toBe(false);
  });

  it("checks begin, cancel and delete results", () => {
    expect(isNavigationResultFor({ kind: "begin", materialId: "mat", supersedeGeneration: null }, { generation: 1 })).toBe(true);
    expect(isNavigationResultFor({ kind: "begin", materialId: "mat", supersedeGeneration: null }, { generation: 0 })).toBe(false);
    expect(isNavigationResultFor({ kind: "cancel", materialId: "mat", generation: 3 }, { cancelledGeneration: 3 })).toBe(true);
    expect(isNavigationResultFor({ kind: "cancel", materialId: "mat", generation: 3 }, { cancelledGeneration: 2 })).toBe(false);
    expect(isNavigationResultFor({ kind: "delete_bookmark", materialId: "mat", bookmarkId: "b1" }, { deleted: "yes" })).toBe(false);
  });
});

describe("native transport", () => {
  it("a mismatched success becomes STORAGE_FAILURE and is never returned", async () => {
    const call = vi.fn().mockResolvedValue({ committed: true, reason: null, readingState: { ...committedState, lastRequestedPage: 49 } });
    await expect(invokeNavigationOperation(commitOp, call)).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
    expect(call).toHaveBeenCalledWith("navigation_operation", { operation: commitOp });
  });

  it("allowlisted refusals keep their fixed message; anything else is STORAGE_FAILURE", async () => {
    await expect(invokeNavigationOperation(commitOp, vi.fn().mockRejectedValue({ code: "FILE_MISSING", message: NAVIGATION_ERROR_MESSAGES.FILE_MISSING })))
      .rejects.toMatchObject({ code: "FILE_MISSING", message: NAVIGATION_ERROR_MESSAGES.FILE_MISSING });
    for (const rejection of [
      { code: "FILE_MISSING", message: "/Users/someone/secret.pdf not found" },
      { code: "DESKTOP_ONLY", message: NAVIGATION_ERROR_MESSAGES.DESKTOP_ONLY },
      "disk I/O error",
      null,
    ]) {
      expect(nativeNavigationRefusal(rejection)).toMatchObject({ code: "STORAGE_FAILURE", message: NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE });
    }
    expect(nativeNavigationRefusal({ code: "OPEN_FAILED", message: NAVIGATION_ERROR_MESSAGES.OPEN_FAILED }).code).toBe("OPEN_FAILED");
  });

  it("the verified open and the inspector accept only answers for their own request", async () => {
    const good = vi.fn().mockResolvedValue({ materialId: "mat", contentSha256: A });
    await expect(invokeOpenNavigationDocument("mat", A, good)).resolves.toEqual({ materialId: "mat", contentSha256: A });
    expect(good).toHaveBeenCalledWith("open_navigation_document", { input: { materialId: "mat", expectedContentSha256: A } });
    await expect(invokeOpenNavigationDocument("mat", A, vi.fn().mockResolvedValue({ materialId: "mat", contentSha256: B }))).rejects.toBeInstanceOf(NavigationError);
    const identity = { materialId: "mat", contentSha256: A, totalPages: 3, verifiedAt: "x", changed: false };
    await expect(invokeInspectNavigationIdentity("mat", vi.fn().mockResolvedValue(identity))).resolves.toEqual(identity);
    await expect(invokeInspectNavigationIdentity("mat", vi.fn().mockResolvedValue({ ...identity, totalPages: 0 }))).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
    await expect(invokeInspectNavigationIdentity("mat", vi.fn().mockResolvedValue({ ...identity, materialId: "other" }))).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  });
});

describe("the frozen partial-review diagnostics, now permanent (M4S1-R1, M4S1-R2)", () => {
  // The exact diagnostics.mjs scenario on synthetic node:sqlite with every registered migration.
  async function scenario() {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    const dir = `${process.cwd()}/src-tauri/migrations`;
    for (const name of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(`${dir}/${name}`, "utf8"));
    db.prepare("INSERT INTO study_materials (id,title,material_type,topic,created_at,updated_at) VALUES ('mat','Synthetic','handbook','general','x','x')").run();
    db.prepare("INSERT INTO material_content_identities VALUES (?,?,?,?)").run("mat", A, 50, "x");
    const act = (input: unknown) =>
      executeNavigationOperation(
        (s) => void db.exec(s),
        (s, p) => void db.prepare(s).run(...(p as never[])),
        (s, p) => db.prepare(s).all(...(p as never[])) as Record<string, unknown>[],
        input,
      ) as Promise<Record<string, unknown>>;
    const first = (await act({ kind: "begin", materialId: "mat", supersedeGeneration: null })) as { generation: number };
    await act({ kind: "commit", materialId: "mat", generation: first.generation, contentSha256: A, physicalPage: 5, pageLabel: null });
    // Request shape updated for M4S1-R1: the held confirmation names the content and generation it saw.
    const staleConfirmation = { kind: "set_read", materialId: "mat", expectedContentSha256: A, expectedOwnerGeneration: first.generation, physicalPage: 5, confirmed: true };
    db.prepare("UPDATE material_content_identities SET content_sha256=? WHERE material_id=?").run(B, "mat");
    const second = (await act({ kind: "begin", materialId: "mat", supersedeGeneration: first.generation })) as { generation: number };
    const current = (await act({ kind: "commit", materialId: "mat", generation: second.generation, contentSha256: B, physicalPage: 5, pageLabel: null })) as {
      readingState: NavigationReadingState;
    };
    return { db, act, staleConfirmation, second, current };
  }

  it("stale content-A read confirmation must not confirm content B at the same page", async () => {
    const { db, act, staleConfirmation } = await scenario();
    const before = db.prepare("SELECT * FROM material_reading_state").all();
    await expect(act(staleConfirmation)).rejects.toMatchObject({ code: "STALE_STATE" });
    expect(db.prepare("SELECT * FROM material_reading_state").all()).toEqual(before);
    db.close();
  });

  it("successful commit adapter must reject a different saved page/hash/label/status", async () => {
    const { db, second, current } = await scenario();
    const request: Op<"commit"> = { kind: "commit", materialId: "mat", generation: second.generation, contentSha256: B, physicalPage: 5, pageLabel: null };
    const forged = {
      committed: true, reason: null,
      readingState: { ...current.readingState, lastRequestedPage: 49, originatingContentSha256: A, lastRequestedPageLabel: "wrong", status: "drifted", confirmedRead: true },
    };
    expect(isNavigationResultFor(request, forged)).toBe(false);
    expect(isNavigationResultFor(request, current)).toBe(true);
    db.close();
  });
});
