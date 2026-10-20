// @vitest-environment jsdom
/**
 * M2UI-R14: MaterialDetail's practice metadata reads (conversion status and
 * completed-history count) are owned, recoverable and read-only.
 *
 * Promoted from the read-recovery review diagnostic
 * (`codex-pr2-material-read-review.test.ts`): the real MaterialDetail inside
 * AppDataProvider over a disposable node:sqlite database, with only the SQL of
 * one metadata read made to fail. Extended with successful retry, the
 * retry lock, held old-route success/rejection and unmount. No real profile,
 * provider or network.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlValue } from "@/data/db";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider } from "@/state/AppDataContext";

import { MaterialDetail } from "./MaterialDetail";
import { usePracticeMetadata } from "./usePracticeMetadata";
import type { PracticeSessionRepository } from "@/data/repositories/practiceSessionRepository";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const CONVERSION_SQL = "SELECT legacy_migrated_at, legacy_error";
const HISTORY_SQL = "SELECT a.id AS attempt_id";
const RETRY = { name: "Retry practice status" };
const QUARANTINE = /contains malformed questions from an earlier version/;

let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

async function savedTest(id: string, title: string) {
  const repos = createRepositories(db);
  await repos.documents.create({ id, title });
  await repos.documents.savePracticeTest({
    provider: "gemini",
    sourceMaterialId: id,
    title: "Saved test",
    model: "synthetic",
    questions: [
      { question: "Saved synthetic question", options: ["A", "B"], correctIndex: 0, explanation: "Synthetic explanation", sourcePage: null },
    ],
  });
}

/** One completed attempt for `id`, through the real atomic session path. */
async function completeOnce(id: string) {
  const sessions = createRepositories(db).practiceSessions;
  const active = (await sessions.getActiveVersion(id))!;
  const started = await sessions.saveSessionAction({
    action: "start_or_resume",
    operationId: crypto.randomUUID(),
    materialId: id,
    versionId: active.version.id,
  });
  await sessions.saveSessionAction({
    action: "record_response",
    operationId: crypto.randomUUID(),
    attemptId: started.attemptId,
    itemId: active.items[0]!.id,
    expectedRevision: 0,
    selectedIndex: 0,
    isDontKnow: false,
  });
  await sessions.saveSessionAction({
    action: "complete_attempt",
    operationId: crypto.randomUUID(),
    attemptId: started.attemptId,
    expectedRevision: 1,
  });
}

async function persistedCounts() {
  const [row] = await db.select<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM practice_attempts) AS attempts,
            (SELECT COUNT(*) FROM practice_responses) AS responses,
            (SELECT COUNT(*) FROM practice_session_operations) AS receipts,
            (SELECT COUNT(*) FROM practice_test_versions) AS versions`,
  );
  return row;
}

interface Deferred {
  promise: Promise<never>;
  resolveWith: (value: unknown) => void;
  reject: (error: Error) => void;
}
function deferred(): Deferred {
  let resolveWith!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((res, rej) => {
    resolveWith = res as (value: unknown) => void;
    reject = rej;
  });
  return { promise, resolveWith, reject };
}

/**
 * Route `select` through `decide`: return a value to replace the real read
 * (a rejected or held promise), or undefined to run it for real.
 */
function interceptSelects(decide: (sql: string, params: SqlValue[]) => Promise<unknown> | undefined) {
  const real = db.select.bind(db);
  return vi.spyOn(db, "select").mockImplementation((async (sql: string, params: SqlValue[] = []) => {
    const replacement = decide(sql, params);
    return replacement ?? real(sql, params);
  }) as typeof db.select);
}

let navigate: NavigateFunction;
function Navigator() {
  navigate = useNavigate();
  return null;
}

function renderDetail(id: string) {
  return render(
    h(
      AppDataProvider,
      null,
      h(
        MemoryRouter,
        { initialEntries: [`/study/${id}`] },
        h(Navigator),
        h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })),
      ),
    ),
  );
}

const countedHistoryLink = () => screen.queryByRole("link", { name: /View practice history \(\d+\)/ });

beforeEach(async () => {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set("airline_starter_pack", "skipped-for-test");
  await savedTest("read-target", "Synthetic read target");
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: "", choice: "standard" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(false);
});

afterEach(async () => {
  cleanup();
  // Let any settled-but-unreported rejection surface before asserting none.
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off("unhandledRejection", onUnhandled);
  vi.restoreAllMocks();
  db.close();
  expect(unhandled).toEqual([]);
});

describe("M2UI-R14 MaterialDetail practice metadata reads", () => {
  for (const target of ["conversion", "history"] as const) {
    it(`[R14] a ${target} read rejection shows sanitized, visible read-only recovery and no unhandled error`, async () => {
      let failedReads = 0;
      interceptSelects((sql) => {
        const match = sql.includes(target === "conversion" ? CONVERSION_SQL : HISTORY_SQL);
        if (!match) return undefined;
        failedReads += 1;
        return Promise.reject(new Error(`Synthetic ${target} metadata read failure /private/raw/path SQLITE_IOERR`));
      });
      renderDetail("read-target");
      await screen.findByRole("heading", { name: "Synthetic read target" });
      await waitFor(() => expect(failedReads).toBeGreaterThan(0));
      expect(await screen.findByRole("button", RETRY)).toBeTruthy();
      expect(screen.getByText(/Practice status couldn’t be checked just now/)).toBeTruthy();
      // Unknown count is not zero: history stays reachable, without a number.
      expect(screen.getByRole("link", { name: "View practice history" }).getAttribute("href")).toBe(
        "/study/history/read-target",
      );
      expect(countedHistoryLink()).toBeNull();
      // A failed status read is never presented as a quarantine verdict either.
      expect(screen.queryByText(QUARANTINE)).toBeNull();
      // Sanitized: nothing of the raw failure reaches the page.
      expect(document.body.textContent).not.toMatch(/Synthetic .* failure|SQLITE|\/private\/raw/);
      // The saved test stays on screen through its own loader.
      expect(await screen.findByText("Saved synthetic question")).toBeTruthy();
    });
  }

  it("Retry performs only metadata reads and shows the real count; no write or provider call", async () => {
    await completeOnce("read-target");
    const before = await persistedCounts();
    let failNext = true;
    const statements: string[] = [];
    interceptSelects((sql) => {
      if (sql.includes(HISTORY_SQL) && failNext) {
        failNext = false;
        return Promise.reject(new Error("Synthetic history failure"));
      }
      return undefined;
    });
    renderDetail("read-target");
    const retry = await screen.findByRole("button", RETRY);

    const execute = vi.spyOn(db, "execute");
    const sessionWrite = vi.spyOn(db, "savePracticeSessionAtomically");
    const testWrite = vi.spyOn(db, "savePracticeAuthoringAtomically");
    const importWrite = vi.spyOn(db, "saveStructuredImportAtomically");
    const generateTest = vi.spyOn(geminiService, "generatePracticeTest");
    const generateAid = vi.spyOn(geminiService, "generateStudyAid");
    const select = vi.mocked(db.select);
    select.mockClear();
    fireEvent.click(retry);

    expect(await screen.findByRole("link", { name: "View practice history (1)" })).toBeTruthy();
    expect(screen.queryByRole("button", RETRY)).toBeNull();
    expect(screen.queryByText(/Practice status couldn’t be checked/)).toBeNull();
    for (const [sql] of select.mock.calls) statements.push(sql);
    expect(statements.filter((sql) => sql.includes(CONVERSION_SQL))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes(HISTORY_SQL))).toHaveLength(1);
    for (const spy of [execute, sessionWrite, testWrite, importWrite, generateTest, generateAid]) {
      expect(spy).not.toHaveBeenCalled();
    }
    vi.mocked(db.select).mockRestore();
    expect(await persistedCounts()).toEqual(before);
  });

  it("Retry after a failed status read restores the quarantine warning for malformed legacy practice", async () => {
    await db.execute(
      "UPDATE practice_tests SET legacy_error = 'MALFORMED_QUESTION' WHERE source_material_id = 'read-target'",
    );
    let failNext = true;
    interceptSelects((sql) => {
      if (sql.includes(CONVERSION_SQL) && failNext) {
        failNext = false;
        return Promise.reject(new Error("Synthetic conversion failure"));
      }
      return undefined;
    });
    renderDetail("read-target");
    fireEvent.click(await screen.findByRole("button", RETRY));
    expect(await screen.findByText(QUARANTINE)).toBeTruthy();
    expect(screen.queryByRole("button", RETRY)).toBeNull();
  });

  it("a second Retry while one is in flight sends no extra reads, and the held result still publishes", async () => {
    let held: Deferred | null = null;
    let conversionReads = 0;
    let failFirst = true;
    interceptSelects((sql) => {
      if (!sql.includes(CONVERSION_SQL)) return undefined;
      conversionReads += 1;
      if (failFirst) {
        failFirst = false;
        return Promise.reject(new Error("Synthetic conversion failure"));
      }
      held = deferred();
      return held.promise;
    });
    renderDetail("read-target");
    const retry = await screen.findByRole("button", RETRY);
    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(conversionReads).toBe(2);
    await act(async () => {
      held!.resolveWith([{ legacy_migrated_at: "2026-10-06T10:00:00.000Z", legacy_error: null }]);
    });
    await waitFor(() => expect(screen.queryByRole("button", RETRY)).toBeNull());
    expect(conversionReads).toBe(2);
  });

  it("a held old-route success cannot set the new material's history count", async () => {
    await completeOnce("read-target");
    await savedTest("other", "Synthetic other material");
    await completeOnce("other");
    const held = deferred();
    interceptSelects((sql, params) =>
      sql.includes(HISTORY_SQL) && params.includes("read-target") ? held.promise : undefined,
    );
    renderDetail("read-target");
    await screen.findByRole("heading", { name: "Synthetic read target" });
    await act(async () => navigate("/study/other"));
    expect(await screen.findByRole("link", { name: "View practice history (1)" })).toBeTruthy();
    await act(async () => {
      held.resolveWith([{ attempt_id: "late-1" }, { attempt_id: "late-2" }, { attempt_id: "late-3" }]);
      await Promise.resolve();
    });
    // The new material keeps its own established count; the late one is ignored.
    expect(screen.getByRole("link", { name: "View practice history (1)" })).toBeTruthy();
    expect(screen.queryByRole("button", RETRY)).toBeNull();
  });

  it("a held old-route rejection neither shows recovery on the new material nor goes unhandled", async () => {
    await savedTest("other", "Synthetic other material");
    await completeOnce("other");
    const held = deferred();
    interceptSelects((sql, params) =>
      sql.includes(CONVERSION_SQL) && params.includes("read-target") ? held.promise : undefined,
    );
    renderDetail("read-target");
    await screen.findByRole("heading", { name: "Synthetic read target" });
    await act(async () => navigate("/study/other"));
    expect(await screen.findByRole("link", { name: "View practice history (1)" })).toBeTruthy();
    await act(async () => {
      held.reject(new Error("Synthetic late failure"));
      await Promise.resolve();
    });
    expect(screen.getByRole("link", { name: "View practice history (1)" })).toBeTruthy();
    expect(screen.queryByRole("button", RETRY)).toBeNull();
    expect(screen.queryByText(/Practice status couldn’t be checked/)).toBeNull();
  });

  it("a new material clears the previous material's failure while its own reads load", async () => {
    await savedTest("other", "Synthetic other material");
    interceptSelects((sql, params) =>
      sql.includes(CONVERSION_SQL) && params.includes("read-target")
        ? Promise.reject(new Error("Synthetic conversion failure"))
        : undefined,
    );
    renderDetail("read-target");
    await screen.findByRole("button", RETRY);
    await act(async () => navigate("/study/other"));
    await screen.findByRole("heading", { name: "Synthetic other material" });
    expect(screen.queryByRole("button", RETRY)).toBeNull();
  });

  it("reads still in flight at unmount settle without an unhandled rejection", async () => {
    const heldConversion = deferred();
    const heldHistory = deferred();
    interceptSelects((sql) =>
      sql.includes(CONVERSION_SQL) ? heldConversion.promise : sql.includes(HISTORY_SQL) ? heldHistory.promise : undefined,
    );
    const view = renderDetail("read-target");
    await screen.findByRole("heading", { name: "Synthetic read target" });
    view.unmount();
    await act(async () => {
      heldConversion.reject(new Error("Synthetic failure after unmount"));
      heldHistory.resolveWith([]);
      await Promise.resolve();
    });
  });
});

/*
 * MaterialDetail remounts its page per material (keyed by id), so a route
 * change leaves the old request on an unmounted hook. Within one mounted page
 * the effect can still rerun for the same material when the repositories
 * object is replaced; request ownership is what stops the older read from
 * overwriting the newer one there.
 */
describe("usePracticeMetadata request ownership within one mounted page", () => {
  /** A repository whose two reads are each answered by the test. */
  function heldRepository() {
    const conversion = deferred();
    const history = deferred();
    const repository = {
      getConversionStatus: () => conversion.promise,
      getCompletedHistory: () => history.promise,
    } as unknown as PracticeSessionRepository;
    return { repository, conversion, history };
  }

  it("an older request's late success cannot overwrite the newer request's result", async () => {
    const first = heldRepository();
    const second = heldRepository();
    const { result, rerender } = renderHook(({ repo }) => usePracticeMetadata("mat", repo), {
      initialProps: { repo: first.repository },
    });
    rerender({ repo: second.repository });
    await act(async () => {
      second.conversion.resolveWith(null);
      second.history.resolveWith([{}]);
    });
    expect(result.current.metadata).toMatchObject({ phase: "loaded", completedCount: 1 });
    await act(async () => {
      first.conversion.resolveWith({ legacyMigratedAt: null, legacyError: "MALFORMED_QUESTION" });
      first.history.resolveWith([{}, {}, {}]);
    });
    expect(result.current.metadata).toEqual({ phase: "loaded", materialId: "mat", conversionStatus: null, completedCount: 1 });
  });

  it("an older request's late failure cannot replace the newer request's result", async () => {
    const first = heldRepository();
    const second = heldRepository();
    const { result, rerender } = renderHook(({ repo }) => usePracticeMetadata("mat", repo), {
      initialProps: { repo: first.repository },
    });
    rerender({ repo: second.repository });
    await act(async () => {
      second.conversion.resolveWith(null);
      second.history.resolveWith([]);
    });
    await act(async () => {
      first.conversion.reject(new Error("Synthetic late failure"));
    });
    expect(result.current.metadata).toMatchObject({ phase: "loaded", completedCount: 0 });
  });

  it("Retry is available again once the newer request settles, even if an older one is still held", async () => {
    const first = heldRepository();
    const failing = {
      getConversionStatus: () => Promise.reject(new Error("Synthetic failure")),
      getCompletedHistory: () => Promise.resolve([]),
    } as unknown as PracticeSessionRepository;
    const { result, rerender } = renderHook(({ repo }) => usePracticeMetadata("mat", repo), {
      initialProps: { repo: first.repository },
    });
    rerender({ repo: failing });
    await waitFor(() => expect(result.current.metadata.phase).toBe("failed"));
    const reads = vi.spyOn(failing, "getConversionStatus");
    act(() => result.current.retry());
    expect(reads).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.metadata.phase).toBe("failed"));
    await act(async () => {
      first.conversion.resolveWith(null);
      first.history.resolveWith([]);
    });
    expect(result.current.metadata.phase).toBe("failed");
  });
});
