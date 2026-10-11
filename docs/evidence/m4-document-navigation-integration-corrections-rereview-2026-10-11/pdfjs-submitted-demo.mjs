import { runRealParserDemonstration } from "./submitted/realParserDemonstration.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reviewer harness (finding R22): execute the SUBMITTED demonstration unchanged and report its
 * real exit behaviour on the current engine.
 *
 * The submitted module resolves its pdfjs engine with path.resolve() against the process CWD,
 * pointing at the PREVIOUS round's scratch install, so this harness must be run with CWD set to a
 * checkout that contains that untracked node_modules (the implementation worktree). That coupling
 * is the finding: a clean clone of main cannot execute this step at all.
 *
 * Usage: cd <worktree-with-scratch-node_modules> && node <thisFile> <fixturesDir>
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = process.argv[2] ?? path.join(here, "fixtures");
const result = await runRealParserDemonstration(path.resolve(fixtures));
console.log(JSON.stringify({ engine: result.runtime, version: result.version, allFixturesSuccess: result.results.every((r) => r.success), corruption: result.corruptionDemonstration }, null, 1));
console.log("DEMONSTRATION COMPLETED NORMALLY");
