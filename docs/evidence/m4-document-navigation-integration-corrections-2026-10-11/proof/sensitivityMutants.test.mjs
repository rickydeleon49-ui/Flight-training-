/**
 * Her Flight Deck - Disposable Module Mutation Sensitivity Verification
 * M4-R12: Actual disposable module-copy guard reversions tested by unchanged regressions.
 *
 * Guarantees:
 * 1. Live source files are hashed before testing.
 * 2. Unchanged baseline regression runs against clean source -> PASS (exit 0).
 * 3. 5 disposable module copies are created in isolated temp directories with one guard reverted.
 * 4. Unchanged regressions are run against each mutant -> FAIL with exact named AssertionError.
 * 5. Temp directories are destroyed.
 * 6. Live source files are re-hashed and asserted identical -> 0 worktree modifications.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const PROOF_DIR = path.resolve(
  "docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/proof"
);

const SOURCE_FILES = [
  "contractModel.mjs",
  "persistenceProtocol.mjs",
  "openerController.mjs",
];

function hashFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getInitialSourceHashes() {
  const hashes = {};
  for (const f of SOURCE_FILES) {
    hashes[f] = hashFile(path.join(PROOF_DIR, f));
  }
  return hashes;
}

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

// ----------------------------------------------------------------------
// Unchanged Regression Suite Functions (run against both clean & mutants)
// ----------------------------------------------------------------------

async function regressionM4R9Totals(contractModel) {
  const res = contractModel.parsePageReference(42, {
    provenance: "physical_index",
    totalPages: undefined,
  });
  assert.equal(
    res.isResolved,
    false,
    "[M4-R9] totalPages undefined must not resolve"
  );
}

async function regressionM4R9Lineage(contractModel) {
  const firstLevelLineage = {
    materialId: "split_01",
    rootMaterialId: "root_01",
    parentMaterialId: null,
    sourcePageStart: 101,
    sourcePageEnd: 116,
    sourceTotalPages: 200,
    parentPageStart: null,
    parentPageEnd: null,
    parentTotalPages: null,
    childPageCount: 16,
    nestedLevel: 1,
  };
  const res = contractModel.translateSplitCoordinates(
    { direction: "child_to_root", page: 3 },
    firstLevelLineage
  );
  assert.equal(
    res.success,
    true,
    "[M4-R9] first-level lineage must allow root navigation"
  );
}

async function regressionM4R10Atomic(contractModel, persistenceProtocol) {
  const db = new DatabaseSync(":memory:");
  try {
    const dir = path.resolve("src-tauri/migrations");
    const names = fs
      .readdirSync(dir)
      .filter((p) => p.endsWith(".sql") && Number(p.slice(0, 4)) <= 13)
      .sort();
    for (const p of names) db.exec(fs.readFileSync(path.join(dir, p), "utf8"));
    const protocol = new persistenceProtocol.DocumentPersistenceProtocol(db);
    protocol.applyCandidateDdl(
      fs.readFileSync(
        path.resolve(
          "docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/candidate/candidate_migration_0015.sql"
        ),
        "utf8"
      )
    );
    db.exec(`
      INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
      VALUES ('m_test', 'Test Material', 'study_guide', 'general', 'x', 'x');
    `);
    protocol.saveContentIdentity("m_test", SHA_A, 50);
    protocol.addBookmark({
      id: "b_test",
      materialId: "m_test",
      pageIndex: 42,
      originatingContentSha256: SHA_A,
      title: "Bookmark 42",
    });
    protocol.saveReadingState("m_test", 42, { contentSha256: SHA_A });

    // Atomic replacement
    protocol.saveContentIdentity("m_test", SHA_B, 10);

    const bmk = db.prepare("SELECT status FROM material_bookmarks WHERE id='b_test'").get();
    assert.equal(
      bmk.status,
      "unverified",
      "[M4-R10] bookmark must not remain verified after content replacement"
    );
  } finally {
    db.close();
  }
}

async function regressionM4R11HeldSaveFence(openerController) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE progress (id TEXT PRIMARY KEY, page INTEGER)");

  let releaseOld;
  const oldHeldPromise = new Promise((r) => (releaseOld = r));

  const c = new openerController.OpenerController({
    injectedOpener: async () => {},
    injectedPersistence: async (id, page) => {
      if (page === 42) await oldHeldPromise;
      db.prepare(
        "INSERT INTO progress VALUES (?,?) ON CONFLICT(id) DO UPDATE SET page=excluded.page"
      ).run(id, page);
    },
  });

  const material = {
    id: "m_fence",
    title: "Doc",
    filePath: "doc.pdf",
    contentSha256: SHA_A,
    totalPages: 50,
  };

  try {
    const oldReq = c.requestOpen(material, 42);
    await Promise.resolve();
    const newReq = await c.requestOpen(material, 3);
    assert.equal(newReq.success, true);

    releaseOld();
    const oldResult = await oldReq;
    assert.equal(oldResult.success, false);

    const finalRow = db.prepare("SELECT page FROM progress WHERE id='m_fence'").get();
    assert.equal(
      finalRow.page,
      3,
      "[M4-R11] database must remain at page 3 after obsolete page 42 completes"
    );
  } finally {
    db.close();
  }
}

async function regressionM4R11ContentScoping(openerController) {
  const c = new openerController.OpenerController({
    injectedOpener: async (f) => {
      if (f === "new.pdf") throw new Error("File not found");
    },
  });
  const material = {
    id: "m_scope",
    title: "Doc",
    filePath: "doc.pdf",
    contentSha256: SHA_A,
    totalPages: 50,
  };

  await c.requestOpen(material, 42);

  const res = await c.requestOpen(
    { ...material, filePath: "new.pdf", contentSha256: SHA_B, totalPages: 10 },
    3
  );
  assert.equal(
    res.lastRequestedPage,
    null,
    "[M4-R11] new content B cannot inherit page 42 from content A"
  );
  assert.equal(
    c.lastRequestedPage,
    null,
    "[M4-R11] controller getter cannot leak page 42 from content A"
  );
}

// ----------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------

test("[sensitivity] clean baseline modules pass all regression checks (exit 0)", async () => {
  const contractModel = await import(pathToFileURL(path.join(PROOF_DIR, "contractModel.mjs")).href);
  const persistenceProtocol = await import(
    pathToFileURL(path.join(PROOF_DIR, "persistenceProtocol.mjs")).href
  );
  const openerController = await import(
    pathToFileURL(path.join(PROOF_DIR, "openerController.mjs")).href
  );

  await regressionM4R9Totals(contractModel);
  await regressionM4R9Lineage(contractModel);
  await regressionM4R10Atomic(contractModel, persistenceProtocol);
  await regressionM4R11HeldSaveFence(openerController);
  await regressionM4R11ContentScoping(openerController);
});

test("[sensitivity] actual disposable module mutations fail unchanged regressions (exit 1)", async () => {
  const initialHashes = getInitialSourceHashes();

  const mutantDefinitions = [
    {
      id: "MUTANT_1_ALLOW_MALFORMED_TOTALS",
      file: "contractModel.mjs",
      revertPattern: 'if (!isSafeTotal) {\n        return {\n          isResolved: false,\n          physicalIndex: null,\n          isPureIndex: true,\n          rawNumber: input,\n          pageLabel: null,\n          provenance: "physical_index",\n          error: "Physical destination requires trusted safe totalPages >= 1",\n        };\n      }',
      replacement: '// REVERTED GUARD: allow undefined totalPages\n      if (false) {}',
      runner: async (modules) => regressionM4R9Totals(modules.contractModel),
      expectedError: "[M4-R9] totalPages undefined must not resolve",
    },
    {
      id: "MUTANT_2_REJECT_NULLABLE_PARENT",
      file: "contractModel.mjs",
      revertPattern: 'if (!checkSafeInt(lineage.sourcePageStart) || !checkSafeInt(lineage.sourcePageEnd)) {',
      replacement: 'if (!lineage.parentMaterialId) return { success: false, error: "REVERTED: rejected nullable parent" };\n    if (!checkSafeInt(lineage.sourcePageStart) || !checkSafeInt(lineage.sourcePageEnd)) {',
      runner: async (modules) => regressionM4R9Lineage(modules.contractModel),
      expectedError: "[M4-R9] first-level lineage must allow root navigation",
    },
    {
      id: "MUTANT_3_OMIT_ATOMIC_INVALIDATION",
      file: "persistenceProtocol.mjs",
      revertPattern: 'this.db.prepare(`\n        UPDATE material_bookmarks\n        SET status = \'unverified\', updated_at = ?\n        WHERE material_id = ?\n          AND (originating_content_sha256 != ? OR page_index > ? OR page_index < 1)\n      `).run(now, materialId, canonicalSha256, totalPages);',
      replacement: '// REVERTED GUARD: skip bookmark invalidation in replacement transaction',
      runner: async (modules) => regressionM4R10Atomic(modules.contractModel, modules.persistenceProtocol),
      expectedError: "[M4-R10] bookmark must not remain verified after content replacement",
    },
    {
      id: "MUTANT_4_DISABLE_HELD_SAVE_FENCE",
      file: "openerController.mjs",
      revertPattern: 'if (newerPage !== undefined && newerPage !== targetPage && this.injectedPersistence) {\n        try {\n          await this.injectedPersistence(material.id, newerPage, {\n            label: pageLabel,\n            contentSha256: material.contentSha256,\n            intentId: currentFence,\n          });\n        } catch {\n          // Ignore secondary repair errors\n        }\n      }',
      replacement: '// REVERTED GUARD: skip post-persistence fence enforcement',
      runner: async (modules) => regressionM4R11HeldSaveFence(modules.openerController),
      expectedError: "[M4-R11] database must remain at page 3 after obsolete page 42 completes",
    },
    {
      id: "MUTANT_5_IGNORE_CONTENT_PROGRESS_SCOPE",
      file: "openerController.mjs",
      revertPattern: '    const key = `${materialId}:${contentSha256 || "unknown"}`;\n    return this.readingStateByContent.get(key)?.lastRequestedPage ?? null;',
      replacement: '    return (this.readingStateByMaterial && this.readingStateByMaterial.get(materialId))?.lastRequestedPage ?? null;',
      setupReplacement: {
        pattern: '      const contentKey = `${material.id}:${material.contentSha256 || "unknown"}`;\n      this.readingStateByContent.set(contentKey, {',
        replacement: '      this.readingStateByMaterial = this.readingStateByMaterial || new Map();\n      this.readingStateByMaterial.set(material.id, {',
      },
      runner: async (modules) => regressionM4R11ContentScoping(modules.openerController),
      expectedError: "[M4-R11] new content B cannot inherit page 42 from content A",
    },
  ];

  for (const m of mutantDefinitions) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hfd-mutant-${m.id}-`));

    try {
      // 1. Copy modules to disposable directory
      for (const f of SOURCE_FILES) {
        fs.copyFileSync(path.join(PROOF_DIR, f), path.join(tmpDir, f));
      }

      // 2. Apply single guard reversion to the disposable copy
      const targetCopyPath = path.join(tmpDir, m.file);
      const originalCode = fs.readFileSync(targetCopyPath, "utf8");
      assert.ok(
        originalCode.includes(m.revertPattern),
        `Revert pattern for ${m.id} must exist in disposable copy`
      );
      let mutatedCode = m.replaceAll
        ? originalCode.replaceAll(m.revertPattern, m.replacement)
        : originalCode.replace(m.revertPattern, m.replacement);
      if (m.setupReplacement) {
        mutatedCode = mutatedCode.replace(m.setupReplacement.pattern, m.setupReplacement.replacement);
      }
      fs.writeFileSync(targetCopyPath, mutatedCode, "utf8");

      // 3. Dynamically import disposable copies
      const modules = {
        contractModel: await import(
          pathToFileURL(path.join(tmpDir, "contractModel.mjs")).href + `?t=${Date.now()}`
        ),
        persistenceProtocol: await import(
          pathToFileURL(path.join(tmpDir, "persistenceProtocol.mjs")).href + `?t=${Date.now()}`
        ),
        openerController: await import(
          pathToFileURL(path.join(tmpDir, "openerController.mjs")).href + `?t=${Date.now()}`
        ),
      };

      // 4. Run unchanged regression against mutated copy -> MUST throw AssertionError!
      let caughtError = null;
      try {
        await m.runner(modules);
      } catch (err) {
        caughtError = err;
      }

      assert.ok(
        caughtError,
        `Mutant ${m.id} was expected to fail unchanged regression, but passed!`
      );
      assert.ok(
        caughtError instanceof assert.AssertionError,
        `Expected AssertionError for ${m.id}, got ${caughtError?.name}: ${caughtError?.message}`
      );
      assert.ok(
        caughtError.message.includes(m.expectedError),
        `AssertionError for ${m.id} must mention '${m.expectedError}'; got '${caughtError.message}'`
      );
    } finally {
      // 5. Clean up temporary directory
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 6. Verify that clean source files were untouched
  const finalHashes = getInitialSourceHashes();
  for (const f of SOURCE_FILES) {
    assert.equal(
      finalHashes[f],
      initialHashes[f],
      `Source file ${f} must remain 100% untouched after sensitivity runs`
    );
  }
});
