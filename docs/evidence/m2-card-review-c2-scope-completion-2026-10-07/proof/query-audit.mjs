import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSyntheticDatabase, T0 } from "./syntheticDataset.mjs";
import { getLibraryReviewDue, getLibraryRecentReviews, nextLocalMidnightUtc } from "./contractModel.mjs";

console.log("Building synthetic database at scale: 5,000 materials / 10,000 events...");
const { db } = buildSyntheticDatabase(5000, 10000);

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
    returnedRows: result.materials?.length ?? result.rows.length,
    calls: calls.length,
    returnedSqlRows: calls.reduce((a, c) => a + c.rows, 0),
    estimatedJsonUtf8Bytes: calls.reduce((a, c) => a + c.estimatedJsonUtf8Bytes, 0),
    detail: calls,
  };
}

try {
  const audit = {
    node: process.version,
    sqlite: process.versions.sqlite,
    due: measuredRead((m) =>
      getLibraryReviewDue(m, { nowUtc: T0, nextLocalMidnightUtc: nextLocalMidnightUtc(T0, "UTC"), limit: 50 })
    ),
    history: measuredRead((m) => getLibraryRecentReviews(m, { limit: 20 })),
  };

  const outDir = resolve(fileURLToPath(import.meta.url), "../../receipts");
  const auditJsonPath = resolve(outDir, "query-audit.json");
  const auditTxtPath = resolve(outDir, "query-audit.txt");

  writeFileSync(auditJsonPath, JSON.stringify(audit, null, 2) + "\n");

  let txtOutput = `=== C2 COMPLETED SQL QUERY & ROW AUDIT ===\n`;
  txtOutput += `Node: ${audit.node}, SQLite: ${audit.sqlite}\n\n`;
  for (const [key, val] of Object.entries(audit)) {
    if (typeof val === "object") {
      txtOutput += `--- ${key.toUpperCase()} QUERY PIPELINE ---\n`;
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
  console.log(txtOutput);
} finally {
  db.close();
}
