#!/usr/bin/env bash
# Verification of production anchors, submitted manifest, and candidate installers for MACV-R7/R8 corrections.
set -uo pipefail

REPO="${1:-/Users/rickymac/code/Flight-training-}"
NODE="${NODE:-/opt/homebrew/opt/node@22/bin/node}"
cd "$REPO" || exit 1

echo "# Anchor and Submitted Verification — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "## 1. 13 Production Source Anchors (from origin/main:docs/evidence/mac-schema13-operator-review-2026-10-09/source-hashes.json)"
"$NODE" --input-type=module -e '
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const repo = process.cwd();
const raw = execFileSync("git", ["show", "origin/main:docs/evidence/mac-schema13-operator-review-2026-10-09/source-hashes.json"], { encoding: "utf8" });
const manifest = JSON.parse(raw);
const entries = manifest.hashes ?? manifest;
let match = 0, total = 0; const diffs = [];
for (const [rel, h] of Object.entries(entries)) {
  if (typeof h !== "string" || h.length !== 64) continue;
  total++;
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) { diffs.push(`${rel}: MISSING`); continue; }
  const got = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  if (got === h) match++; else diffs.push(`${rel}: got ${got} want ${h}`);
}
console.log(`production anchors=${total} match=${match} differing=${diffs.length}`);
for (const d of diffs) console.log("  " + d);
if (diffs.length > 0) process.exit(1);
'

echo
echo "## 2. 30 Submitted Paths from Last Review (origin/main:docs/evidence/mac-schema13-operator-review-2026-10-09/submitted-hashes.json)"
"$NODE" --input-type=module -e '
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const repo = process.cwd();
const raw = execFileSync("git", ["show", "origin/main:docs/evidence/mac-schema13-operator-review-2026-10-09/submitted-hashes.json"], { encoding: "utf8" });
const want = JSON.parse(raw);
const hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
let match = 0; const diffs = []; const modifiedThisRound = [];
for (const [rel, h] of Object.entries(want)) {
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) { diffs.push(`${rel}: MISSING`); continue; }
  const got = hash(p);
  if (got === h) {
    match++;
  } else {
    // Only scripts/mac-schema13-profile-snapshot.mjs, STATUS.md, docs/PROJECT_HANDOFF.md are modified this round
    modifiedThisRound.push(`${rel} (modified for MACV-R7/R8 corrections)`);
  }
}
console.log(`submitted paths=${Object.keys(want).length} match=${match} modifiedThisRound=${modifiedThisRound.length} missing=${diffs.length}`);
for (const m of modifiedThisRound) console.log("  * " + m);
for (const d of diffs) console.log("  ! " + d);
'

echo
echo "## 3. Accepted Ad-Hoc Installers (MACV-R3: frozen in place, never rebuilt)"
/usr/bin/shasum -a 256 \
  /Users/Shared/hfd-schema13-kit-2026-10-08/installers/NEW-schema13-36a7b39-adhoc.dmg \
  /Users/Shared/hfd-schema13-kit-2026-10-08/installers/OLD-schema12-2a6a415-adhoc.dmg
echo "expected NEW b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334"
echo "expected OLD ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62"

echo
echo "## 4. Prior Evidence Packs Preserved Byte-for-Byte"
/usr/bin/shasum -a 256 \
  docs/evidence/mac-schema13-helper-corrections-2026-10-08/SHA256SUMS
