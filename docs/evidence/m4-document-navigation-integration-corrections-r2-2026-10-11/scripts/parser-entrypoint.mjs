#!/usr/bin/env node
/**
 * Reviewer/implementer harness: run ONE pdfjs entrypoint in ITS OWN process and report JSON.
 * One process per entrypoint is mandatory: the legacy bundle installs the Promise.try helper
 * globally, so importing it first makes the modern build appear to work on Node 22.
 *
 * Usage: node scripts/parser-entrypoint.mjs <legacy|modern>
 * Exit 0 when every fixture matches its expectation, 1 otherwise (or on an engine-level crash).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRealParserDemonstration, resolveEngine } from "../proof/realParserDemonstration.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(here, "..");
const entry = process.argv[2] ?? "legacy";

try {
  resolveEngine(entry); // fails loudly, naming this pack's install, before any import
  const result = await runRealParserDemonstration(path.join(packRoot, "fixtures"), { entry });
  const ok = result.results.every((r) => r.success);
  console.log(JSON.stringify({ runtime: result.runtime, version: result.version, entrypoint: result.entrypoint, engineRoot: result.engineRoot, results: result.results, corruption: result.corruptionDemonstration }, null, 1));
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(JSON.stringify({ runtime: `Node.js ${process.version}`, entry, status: "ENGINE_FAILURE", errorType: err.constructor.name, message: String(err.message).slice(0, 300) }, null, 1));
  process.exit(1);
}
