#!/bin/bash
# Starting-state and unchanged-anchor verification for the helper/operator-kit correction round.
#   usage: bash verify-anchors.sh <repo-root>
set -uo pipefail
REPO="${1:?repo root}"
NODE="${NODE:-/opt/homebrew/opt/node@22/bin/node}"
cd "$REPO" || exit 1

echo "# Anchor verification — $(date -u +%Y-%m-%dT%H:%M:%SZ)Z"
echo
echo "## 1. The 28 paths the re-review froze (docs/evidence/mac-schema13-preparation-rereview-2026-10-08/submitted-hashes.json)"
echo "##    verified BEFORE any edit in this round and re-verified now; the helper is the only"
echo "##    tracked path this round changes, so its own entry is expected to differ."
"$NODE" --input-type=module -e '
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const repo = process.cwd();
const want = JSON.parse(fs.readFileSync("/Users/rickymac/code/.qwen/tmp/macv2/submitted-hashes.json", "utf8"));
const hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
let match = 0; const diffs = [];
for (const [rel, h] of Object.entries(want)) {
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) { diffs.push(`${rel}: MISSING`); continue; }
  if (hash(p) === h) match++; else diffs.push(`${rel}: now ${hash(p)}`);
}
console.log(`entries=${Object.keys(want).length} match=${match} differing=${diffs.length}`);
for (const d of diffs) console.log("  " + d);
'
echo
echo "## 2. The 13 production source anchors from the previous preparation review"
"$NODE" --input-type=module -e '
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const { execFileSync } = await import("node:child_process");
const manifest = JSON.parse(execFileSync("git", ["show", "origin/main:docs/evidence/mac-schema13-preparation-review-2026-10-08/source-hashes.json"], { encoding: "utf8" }));
const entries = manifest.hashes ?? manifest;
let match = 0, total = 0; const diffs = [];
for (const [rel, h] of Object.entries(entries)) {
  if (typeof h !== "string" || h.length !== 64) continue;
  total++;
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) { diffs.push(`${rel}: MISSING`); continue; }
  const got = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  if (got === h) match++; else diffs.push(`${rel}: now ${got}`);
}
console.log(`anchors=${total} match=${match} differing=${diffs.length}`);
for (const d of diffs) console.log("  " + d);
'
echo
echo "## 3. Accepted local candidates (MACV-R3 closed: verified in place, never rebuilt)"
/usr/bin/shasum -a 256 \
  /Users/rickymac/code/.qwen/tmp/schema13-candidates/NEW-schema13-36a7b39-adhoc.dmg \
  /Users/rickymac/code/.qwen/tmp/schema13-candidates/OLD-schema12-2a6a415-adhoc.dmg \
  /Users/Shared/hfd-schema13-kit-2026-10-08/installers/NEW-schema13-36a7b39-adhoc.dmg \
  /Users/Shared/hfd-schema13-kit-2026-10-08/installers/OLD-schema12-2a6a415-adhoc.dmg
echo "expected NEW b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334"
echo "expected OLD ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62"
echo
echo "## 4. Previously rejected originals and prior evidence packs still present"
/usr/bin/shasum -a 256 \
  /Users/rickymac/code/.qwen/tmp/schema13-candidates/NEW-schema13-36a7b39.dmg \
  /Users/rickymac/code/.qwen/tmp/schema13-candidates/OLD-schema12-2a6a415.dmg 2>/dev/null || echo "(originals list unavailable)"
/bin/ls -1 docs/evidence/mac-schema13-verification-2026-10-08 \
           docs/evidence/mac-schema13-preparation-corrections-2026-10-08 2>/dev/null | /usr/bin/head -20
echo
echo "## 5. Exact working-tree state"
echo "HEAD: $(git rev-parse HEAD)"
echo "origin/main: $(git rev-parse origin/main)"
echo "staged entries: $(git diff --cached --name-only | wc -l | tr -d ' ')"
echo "modified/untracked (top level):"
git status --short
echo
echo "## 6. Toolchain"
echo "node: $("$NODE" --version)  ($(dirname "$NODE"))"
echo "npm: $(PATH="$(dirname "$NODE"):$PATH" npm --version 2>/dev/null || echo n/a)"
echo "platform: $(uname -mr)"
