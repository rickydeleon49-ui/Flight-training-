#!/usr/bin/env python3
"""Reintroduce one reviewed defect at a time into the C1 source, run the
targeted tests, record the outcome, and restore the file byte-for-byte.
Every mutation keeps the SQL placeholder count, so a failure is semantic,
not a binding error (run 1's Q1 broke that rule; see receipts/mutations-run1-invalid-Q1).
Run from the repository root after the gate. Writes mutation-results.json and
receipts/mutations/<id>.txt."""
import hashlib, json, os, subprocess

EVID = "docs/evidence/m2-card-review-c1-2026-10-06"
ENV = dict(os.environ, PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:" + os.environ["PATH"],
           SDKROOT="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk")
VITEST = "npx vitest run "
MUTATIONS = [
    ("Q1", "Again cards use the end-of-day bound (CRS-R1 timing)", "src/data/repositories/cardReviewRepository.ts",
     "((s.step < 0 AND s.due_at <= ?) OR (s.step >= 0 AND s.due_at < ?))", "((s.due_at <= ? OR 1) AND s.due_at < ?)",
     None),
    ("Q2", "due query filters by material only, not the current version (CRS-R1 ownership)", "src/data/repositories/cardReviewRepository.ts",
     "WHERE i.version_id = ? AND", "WHERE (i.version_id = ? OR 1) AND", None),
    ("G1", "browser/test transaction without the generation barrier (CRS-R2)", "src/data/cardReviewTransaction.ts",
     'if (action.expectedGeneration !== generation) refuse("STALE_GENERATION");', "", None),
    ("G2", "native transaction without the generation barrier (CRS-R2)", "src-tauri/src/card_reviews.rs",
     "if action.expected_generation() != generation {", "if action.expected_generation() != generation && false {", "cargo"),
    ("U1", "UI forgets the pending payload after an unknown outcome (no same-request Try again)", "src/pages/StudyLibrary/useCardReview.ts",
     '          setPending({ action, status: "unknown" });', "          setPending(null);", None),
    ("U2", "UI unlocks after an acknowledged write even when the refresh fails", "src/pages/StudyLibrary/useCardReview.ts",
     "if (!ok) setLocked(true);", "setLocked(false);", None),
]
TARGETS = {
    "Q1": VITEST + "src/data/cardReviewContract.test.ts -t 'promoted 1'",
    "Q2": VITEST + "src/data/cardReviewContract.test.ts -t 'promoted 2'",
    "G1": VITEST + "src/data/cardReviewContract.test.ts -t 'promoted 3|promoted 4'",
    "G2": "cargo test --locked --manifest-path src-tauri/Cargo.toml card_reviews::tests::reset_racing card_reviews::tests::a_pre_reset",
    "U1": VITEST + "src/pages/StudyLibrary/CardReviewPanel.test.ts -t 'lost acknowledgement'",
    "U2": VITEST + "src/pages/StudyLibrary/CardReviewPanel.test.ts -t 'refresh fails'",
}
os.makedirs(f"{EVID}/receipts/mutations", exist_ok=True)
results = []
for mid, what, path, old, new, _ in MUTATIONS:
    original = open(path, "rb").read()
    before = hashlib.sha256(original).hexdigest()
    text = original.decode()
    assert text.count(old) == 1, (mid, "anchor not unique")
    open(path, "w").write(text.replace(old, new))
    try:
        cmd = TARGETS[mid]
        if mid == "G2":
            # cargo accepts one filter; run both names.
            runs = [subprocess.run(f"cargo test --locked --manifest-path src-tauri/Cargo.toml {name}", shell=True, env=ENV, capture_output=True, text=True)
                    for name in ("reset_racing_a_queued_rating", "a_pre_reset_revision_1_request")]
            out = "".join(r.stdout + r.stderr for r in runs)
            code = max(r.returncode for r in runs)
            cmd = "cargo test … reset_racing_a_queued_rating; cargo test … a_pre_reset_revision_1_request"
        else:
            r = subprocess.run(cmd, shell=True, env=ENV, capture_output=True, text=True)
            out, code = r.stdout + r.stderr, r.returncode
    finally:
        open(path, "wb").write(original)
    after = hashlib.sha256(open(path, "rb").read()).hexdigest()
    with open(f"{EVID}/receipts/mutations/{mid}.txt", "w") as f:
        f.write(f"mutation {mid}: {what}\nfile {path}\n$ {cmd}\n{out}\nexit {code}\n")
    results.append({"id": mid, "defect": what, "file": path, "command": cmd, "exit": code,
                    "killed": code != 0, "restored": before == after, "sha256": before})
    print(mid, "killed" if code != 0 else "SURVIVED", "restored" if before == after else "NOT RESTORED")
json.dump(results, open(f"{EVID}/mutation-results.json", "w"), indent=2)
open(f"{EVID}/mutation-results.json", "a").write("\n")
