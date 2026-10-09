"""Revert one essential split-lineage guard at a time in an isolated copy; the named test must fail."""
import hashlib, json, os, subprocess, sys
root, out, target = sys.argv[1], sys.argv[2], sys.argv[3]
env = dict(os.environ)
env["PATH"] = "/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:" + env["PATH"]
env["SDKROOT"] = subprocess.run(["xcrun", "--sdk", "macosx", "--show-sdk-path"], capture_output=True, text=True).stdout.strip()
env["CARGO_TARGET_DIR"] = target
cargo = ["cargo", "test", "--locked", "--manifest-path", "src-tauri/Cargo.toml"]
V = [
  ("S1-receipt-hash-check-skipped", "src-tauri/src/lineage.rs",
   [("    if computed != receipt.receipt_hash || computed != receipt.operation_id {", "    if false {"),
    ("    if recorded_hash != computed || recorded_source.as_deref() != Some(&core.source_material_id) {", "    if false {")],
   cargo + ["an_edited_or_unrecorded_receipt_saves_nothing"], "an_edited_or_unrecorded_receipt_saves_nothing"),
  ("S2-nested-snapshot-recheck-removed", "src-tauri/src/lineage.rs",
   [("        if !unchanged {", "        if !unchanged && false {")],
   cargo + ["a_parent_whose_lineage_changed_after_the_split_is_refused"], "a_parent_whose_lineage_changed_after_the_split_is_refused"),
  ("S3-reissue-resets-the-record", "src-tauri/src/lineage.rs",
   [("            \"INSERT INTO split_operation_log (", "            \"INSERT OR REPLACE INTO split_operation_log ("),
    ("              WHERE NOT EXISTS (SELECT 1 FROM split_operation_log WHERE operation_id = ?1)\",", "\",")],
   cargo + ["a_cancelled_split_stays_cancelled_and_cannot_be_saved"], "a_cancelled_split_stays_cancelled_and_cannot_be_saved"),
  ("S4-hash-nullness-tier-heuristic", "src/logic/splitLineage.ts",
   [("  return lineage.nestedLevel === 1 && lineage.parentPageStart === null;", "  return lineage.parentContentSha256 === null;")],
   ["npx", "vitest", "run", "src/logic/splitLineage.test.ts"], "a matching original never vouches for a parent whose fingerprint is unknown"),
  ("S5-receipt-shape-allows-extra-provenance", "src/data/splitLineageShapes.ts",
   [("  const own = Object.keys(value);\n  return own.length === keys.length && keys.every((key) => key in value);", "  return keys.every((key) => key in value);")],
   ["npx", "vitest", "run", "src/data/splitLineageShapes.test.ts"], "refuses extra provenance"),
]
results = []
for name, path, edits, command, expected in V:
    full = os.path.join(root, path)
    original = open(full, "rb").read()
    digest = hashlib.sha256(original).hexdigest()
    text = original.decode()
    for a, b in edits:
        assert text.count(a) == 1, (name, a)
        text = text.replace(a, b)
    open(full, "w").write(text)
    try:
        run = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True)
    finally:
        open(full, "wb").write(original)
    restored = hashlib.sha256(open(full, "rb").read()).hexdigest() == digest
    log = run.stdout + run.stderr
    open(os.path.join(out, name + ".txt"), "w").write(log)
    caught = run.returncode != 0 and expected in log and ("FAILED" in log or "×" in log or "FAIL" in log)
    results.append({"variant": name, "file": path, "command": " ".join(command), "exit": run.returncode,
                    "expected_failing_test": expected, "caught": caught, "restored_sha256": digest, "restored": restored})
    print(name, "exit", run.returncode, "caught", caught, "restored", restored)
json.dump(results, open(os.path.join(out, "sensitivity-results.json"), "w"), indent=2)
sys.exit(0 if all(r["caught"] and r["restored"] for r in results) else 1)
