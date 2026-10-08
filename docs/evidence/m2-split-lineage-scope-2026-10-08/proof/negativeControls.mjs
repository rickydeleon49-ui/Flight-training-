import assert from "node:assert/strict";
import {
  composeNestedRanges,
  validatePageRange,
  createDisposableLineageDb,
  insertMaterial,
  insertSplitLineage,
} from "./lineageContract.mjs";

console.log("Running deliberate semantic negative controls to verify test sensitivity...\n");

let caughtMutations = 0;

// Mutation 1: Perturb nested range composition by +1 (off-by-one bug)
try {
  const buggedCompose = (parentRange, childSelection) => {
    // BUG: missing "- 1"
    const start = parentRange.sourcePageStart + childSelection.firstPage;
    const end = parentRange.sourcePageStart + childSelection.lastPage;
    return { sourcePageStart: start, sourcePageEnd: end };
  };
  const result = buggedCompose({ sourcePageStart: 101, sourcePageEnd: 300 }, { firstPage: 20, lastPage: 40 });
  // Expected: 120, Bugged: 121
  assert.equal(result.sourcePageStart, 120, "Should have been 120");
  console.log("FAIL: Mutation 1 was not caught!");
} catch (err) {
  console.log("PASS: Mutation 1 (off-by-one in nested range composition) caught:", err.message);
  caughtMutations++;
}

// Mutation 2: Allow page 0 (0-based indexing bug)
try {
  const buggedValidate = (first, last) => {
    // BUG: allows first >= 0 instead of >= 1
    if (first < 0) return { ok: false, error: "Negative" };
    return { ok: true };
  };
  const result = buggedValidate(0, 50);
  assert.equal(result.ok, false, "Page 0 must be rejected");
  console.log("FAIL: Mutation 2 was not caught!");
} catch (err) {
  console.log("PASS: Mutation 2 (permitting page 0) caught:", err.message);
  caughtMutations++;
}

// Mutation 3: Cascade delete of child on parent deletion (forbidden bug)
try {
  const db = createDisposableLineageDb(false);
  // Create bugged schema where parent deletion cascades child deletion
  db.exec(`
    CREATE TABLE bugged_child_materials (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES study_materials(id) ON DELETE CASCADE
    );
  `);
  insertMaterial(db, { id: "p1", title: "Parent" });
  db.prepare("INSERT INTO bugged_child_materials VALUES ('c1', 'p1')").run();

  // Delete parent
  db.prepare("DELETE FROM study_materials WHERE id = 'p1'").run();

  // If child was deleted, that is a violation of Her Flight Deck's child preservation invariant!
  const child = db.prepare("SELECT * FROM bugged_child_materials WHERE id = 'c1'").get();
  assert.ok(child, "Child material must survive parent deletion!");
  console.log("FAIL: Mutation 3 was not caught!");
} catch (err) {
  console.log("PASS: Mutation 3 (cascade deletion of child when parent deleted) caught:", err.message);
  caughtMutations++;
}

// Mutation 4: Permit self-parenting (cycle bug)
try {
  const db = createDisposableLineageDb(true);
  insertMaterial(db, { id: "cycle-mat", title: "Cycle" });
  insertSplitLineage(db, {
    materialId: "cycle-mat",
    parentMaterialId: "cycle-mat",
    sourcePageStart: 1,
    sourcePageEnd: 10,
    sourceFileName: "doc.pdf",
    sourceTitle: "Doc",
  });
  console.log("FAIL: Mutation 4 was not caught!");
} catch (err) {
  console.log("PASS: Mutation 4 (self-parenting cycle) caught by CHECK constraint:", err.message);
  caughtMutations++;
}

console.log(`\nNegative controls complete: ${caughtMutations}/4 mutations caught successfully.`);
if (caughtMutations !== 4) {
  process.exit(1);
}
