import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Reviewer harness (finding R22): evaluate ONE pdfjs-dist entrypoint in ITS OWN process.
 * Importing the legacy and modern builds in a single process contaminates the modern build
 * (the legacy build supplies the Promise.try helper the modern build then finds), so one
 * process per entrypoint is mandatory for a valid comparison.
 *
 * Usage: node pdfjs-one-build.mjs <buildEntrypoint> <pdfjsPackageRoot> <fixturesDir>
 *   e.g. node pdfjs-one-build.mjs legacy/build/pdf.mjs \
 *        docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/scratch/pdfjs-engine/node_modules/pdfjs-dist \
 *        docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/fixtures
 */
const [build, root, fixtures] = process.argv.slice(2);
if (!build || !root || !fixtures) {
  console.error("usage: node pdfjs-one-build.mjs <buildEntrypoint> <pdfjsPackageRoot> <fixturesDir>");
  process.exit(64);
}
const pdfjs = await import(pathToFileURL(path.resolve(root, build)).href);
const cases = [["handbook_root_sample.pdf", 50], ["multi_page_sample.pdf", 10], ["single_page.pdf", 1], ["split_part_sample.pdf", 16], ["malformed_sample.pdf", null]];
const out = [];
for (const [f, expect] of cases) {
  let task = null;
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(fixtures, f))), disableWorker: true, isEvalSupported: false });
    const d = await task.promise;
    const n = d.numPages;
    await d.cleanup();
    out.push({ file: f, pageCount: n, matchesExpected: expect === null ? "LOADED-BUT-EXPECTED-REJECT" : n === expect });
  } catch (e) {
    out.push({ file: f, rejected: e.constructor.name, message: String(e.message).slice(0, 45), asExpected: expect === null ? e.constructor.name === "InvalidPDFException" : false });
  } finally {
    if (task) { try { await task.destroy(); } catch {} }
  }
}
const ok = out.every((o) => o.matchesExpected === true || o.asExpected === true);
console.log(JSON.stringify({ build, version: pdfjs.version, engine: process.version, status: ok ? "PASS" : "FAIL", out }, null, 1));
process.exit(ok ? 0 : 1);
