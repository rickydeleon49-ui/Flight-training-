import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSyntheticDatabase, T0 } from "./syntheticDataset.mjs";
import { getLibraryReviewDue, getLibraryRecentReviews, nextLocalMidnightUtc } from "./contractModel.mjs";

console.log("Building synthetic database at scale: 5,000 materials / 10,000 events...");
const { db } = buildSyntheticDatabase(5000, 10000);
const midUtc = nextLocalMidnightUtc(T0, "UTC");

function measuredRead(read) {
  const calls = [];
  const measured = {
    prepare(sql) {
      const s = db.prepare(sql);
      return Object.fromEntries(
        ["all", "get"].map((method) => [
          method,
          (...params) => {
            const r = s[method](...params);
            const rows = method === "all" ? r : r ? [r] : [];
            calls.push({
              sql: sql.replace(/\s+/g, " ").trim(),
              method,
              rows: rows.length,
              estimatedJsonUtf8Bytes: Buffer.byteLength(JSON.stringify(rows), "utf8"),
            });
            return r;
          },
        ])
      );
    },
  };
  const result = read(measured);
  return {
    result,
    returnedRows: result.materials?.length ?? result.rows?.length ?? 0,
    calls: calls.length,
    returnedSqlRows: calls.reduce((a, c) => a + c.rows, 0),
    estimatedJsonUtf8Bytes: calls.reduce((a, c) => a + c.estimatedJsonUtf8Bytes, 0),
    detail: calls,
  };
}

try {
  // Page 1 due read
  const duePage1 = measuredRead((m) =>
    getLibraryReviewDue(m, { nowUtc: T0, nextLocalMidnightUtc: midUtc, limit: 50, candidateBatchBudget: 250 })
  );

  // Page 2 continuation due read
  const duePage2 = measuredRead((m) =>
    getLibraryReviewDue(m, {
      nowUtc: T0,
      nextLocalMidnightUtc: midUtc,
      limit: 50,
      candidateBatchBudget: 250,
      cursor: duePage1.result.nextCursor,
    })
  );

  // Filtered due read (due_today)
  const dueFilter = measuredRead((m) =>
    getLibraryReviewDue(m, {
      nowUtc: T0,
      nextLocalMidnightUtc: midUtc,
      limit: 50,
      statusFilter: "due_today",
      topic: "aerodynamics",
    })
  );

  // History page 1
  const historyPage1 = measuredRead((m) => getLibraryRecentReviews(m, { limit: 20 }));

  // History page 2
  const historyPage2 = measuredRead((m) =>
    getLibraryRecentReviews(m, { limit: 20, cursor: historyPage1.result.next })
  );

  // History filtered by topic
  const historyFiltered = measuredRead((m) =>
    getLibraryRecentReviews(m, { limit: 20, topic: "aerodynamics" })
  );

  // History enrichment only (target-only, no event querying)
  const historyEnrichmentOnly = measuredRead((m) =>
    getLibraryRecentReviews(m, {
      enrichmentOnly: true,
      enrichMaterialIds: ["mat-aero-01", "mat-airspace-04"],
    })
  );

  // History combined: event page + targeted enrichment
  const historyCombined = measuredRead((m) =>
    getLibraryRecentReviews(m, {
      limit: 20,
      enrichMaterialIds: ["mat-aero-01", "mat-airspace-04"],
    })
  );

  const audit = {
    node: process.version,
    sqlite: process.versions.sqlite,
    due_page1: {
      returnedRows: duePage1.returnedRows,
      calls: duePage1.calls,
      returnedSqlRows: duePage1.returnedSqlRows,
      estimatedJsonUtf8Bytes: duePage1.estimatedJsonUtf8Bytes,
      detail: duePage1.detail,
    },
    due_page2_continuation: {
      returnedRows: duePage2.returnedRows,
      calls: duePage2.calls,
      returnedSqlRows: duePage2.returnedSqlRows,
      estimatedJsonUtf8Bytes: duePage2.estimatedJsonUtf8Bytes,
      detail: duePage2.detail,
    },
    due_filtered_due_today: {
      returnedRows: dueFilter.returnedRows,
      calls: dueFilter.calls,
      returnedSqlRows: dueFilter.returnedSqlRows,
      estimatedJsonUtf8Bytes: dueFilter.estimatedJsonUtf8Bytes,
      detail: dueFilter.detail,
    },
    history_page1: {
      returnedRows: historyPage1.returnedRows,
      calls: historyPage1.calls,
      returnedSqlRows: historyPage1.returnedSqlRows,
      estimatedJsonUtf8Bytes: historyPage1.estimatedJsonUtf8Bytes,
      detail: historyPage1.detail,
    },
    history_page2_continuation: {
      returnedRows: historyPage2.returnedRows,
      calls: historyPage2.calls,
      returnedSqlRows: historyPage2.returnedSqlRows,
      estimatedJsonUtf8Bytes: historyPage2.estimatedJsonUtf8Bytes,
      detail: historyPage2.detail,
    },
    history_filtered_topic: {
      returnedRows: historyFiltered.returnedRows,
      calls: historyFiltered.calls,
      returnedSqlRows: historyFiltered.returnedSqlRows,
      estimatedJsonUtf8Bytes: historyFiltered.estimatedJsonUtf8Bytes,
      detail: historyFiltered.detail,
    },
    history_enrichment_only: {
      returnedRows: historyEnrichmentOnly.returnedRows,
      calls: historyEnrichmentOnly.calls,
      returnedSqlRows: historyEnrichmentOnly.returnedSqlRows,
      estimatedJsonUtf8Bytes: historyEnrichmentOnly.estimatedJsonUtf8Bytes,
      detail: historyEnrichmentOnly.detail,
    },
    history_combined_page_plus_target: {
      returnedRows: historyCombined.returnedRows,
      calls: historyCombined.calls,
      returnedSqlRows: historyCombined.returnedSqlRows,
      estimatedJsonUtf8Bytes: historyCombined.estimatedJsonUtf8Bytes,
      detail: historyCombined.detail,
    },
  };

  const outDir = resolve(fileURLToPath(import.meta.url), "../../receipts");
  const auditJsonPath = resolve(outDir, "query-audit.json");
  const auditTxtPath = resolve(outDir, "query-audit.txt");
  const auditExitPath = resolve(outDir, "query-audit.exit");

  writeFileSync(auditJsonPath, JSON.stringify(audit, null, 2) + "\n");

  let txtOutput = `=== C2 COMPLETED SQL QUERY & PIPELINE AUDIT (FINAL CONTRACT MODEL) ===\n`;
  txtOutput += `Node: ${audit.node}, SQLite: ${audit.sqlite}\n\n`;
  for (const [key, val] of Object.entries(audit)) {
    if (typeof val === "object" && val.detail) {
      txtOutput += `--- ${key.toUpperCase()} ---\n`;
      txtOutput += `Returned Results: ${val.returnedRows}\n`;
      txtOutput += `SQL Calls: ${val.calls}\n`;
      txtOutput += `Returned SQL Rows: ${val.returnedSqlRows}\n`;
      txtOutput += `Estimated SQL Result JSON UTF-8 Bytes: ${val.estimatedJsonUtf8Bytes}\n`;
      txtOutput += `Executed Statements:\n`;
      val.detail.forEach((call, idx) => {
        txtOutput += `  [${idx + 1}] method: ${call.method}, rows: ${call.rows}, bytes: ${call.estimatedJsonUtf8Bytes}\n`;
        txtOutput += `      SQL: ${call.sql}\n`;
      });
      txtOutput += `\n`;
    }
  }

  writeFileSync(auditTxtPath, txtOutput);
  writeFileSync(auditExitPath, "0\n");
  console.log(txtOutput);
} finally {
  db.close();
}
