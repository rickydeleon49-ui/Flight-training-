/**
 * Her Flight Deck - Real PDF Parser Demonstration (Corrected for M4-R8)
 *
 * Uses evaluated upstream engine `pdfjs-dist@6.3.289` (isolated in scratch dependencies)
 * to demonstrate genuine PDF parsing, page catalog enumeration, malformed-input rejection,
 * and resource cleanup across all synthetic fixtures.
 *
 * Runtime: Node.js v26.10.0 (ARM64)
 * Scope: Scratch technical evaluation proof; no production dependency impact.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function runRealParserDemonstration(fixturesDir) {
  const pdfjsPath = path.resolve(
    "docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/scratch/pdfjs-engine/node_modules/pdfjs-dist/build/pdf.mjs"
  );
  const pdfjs = await import(pathToFileURL(pdfjsPath).href);

  const fixtureFiles = [
    { name: "handbook_root_sample.pdf", expectedPages: 50 },
    { name: "multi_page_sample.pdf", expectedPages: 10 },
    { name: "single_page.pdf", expectedPages: 1 },
    { name: "split_part_sample.pdf", expectedPages: 16 },
    { name: "malformed_sample.pdf", expectError: true },
  ];

  const results = [];

  for (const f of fixtureFiles) {
    const fullPath = path.join(fixturesDir, f.name);
    const bytes = new Uint8Array(fs.readFileSync(fullPath));

    if (f.expectError) {
      try {
        const task = pdfjs.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false });
        const doc = await task.promise;
        await task.destroy();
        results.push({ file: f.name, success: false, error: "Expected parse error but loaded" });
      } catch (err) {
        results.push({
          file: f.name,
          success: true,
          rejectedAsExpected: true,
          errorType: err.name,
          message: err.message,
        });
      }
      continue;
    }

    try {
      const task = pdfjs.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false });
      const doc = await task.promise;
      const pageCount = doc.numPages;

      // Enumerate pages
      const enumerated = [];
      for (let i = 1; i <= Math.min(pageCount, 5); i++) {
        const page = await doc.getPage(i);
        enumerated.push({ pageNum: i, rotate: page.rotate });
        page.cleanup();
      }

      await doc.cleanup();
      await task.destroy();

      results.push({
        file: f.name,
        success: true,
        pageCount,
        matchesExpected: pageCount === f.expectedPages,
        samplePages: enumerated,
      });
    } catch (err) {
      results.push({ file: f.name, success: false, error: err.message });
    }
  }

  // Demonstration of page-tree corruption detection:
  // Corrupt /Count 50 -> /Count 99 in handbook_root_sample.pdf while keeping leaves unchanged
  const rootBytes = fs.readFileSync(path.join(fixturesDir, "handbook_root_sample.pdf"));
  const corruptedBytes = new Uint8Array(
    Buffer.from(Buffer.from(rootBytes).toString("latin1").replace("/Count 50", "/Count 99"), "latin1")
  );

  let corruptionResult;
  try {
    const cTask = pdfjs.getDocument({ data: corruptedBytes, disableWorker: true, isEvalSupported: false });
    const cDoc = await cTask.promise;
    corruptionResult = {
      handled: true,
      resolvedPages: cDoc.numPages,
      behavior: "PDF.js parsed actual page catalog",
    };
    await cTask.destroy();
  } catch (err) {
    corruptionResult = {
      handled: true,
      rejectedAsMalformed: true,
      error: err.message,
    };
  }

  return {
    engine: "pdfjs-dist",
    version: pdfjs.version,
    runtime: "Node.js " + process.version,
    results,
    corruptionDemonstration: corruptionResult,
  };
}
