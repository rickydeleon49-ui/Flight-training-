#!/usr/bin/env python3
"""Reintroduce one C2 defect at a time, run its targeted tests, record the
outcome, and restore the file byte-for-byte (SHA-256 checked). SQL text
mutations keep every placeholder, so a failure is semantic, not a binding
error. Run 1 (receipts/mutations-run1) used a crashing R2 variant; this run
replaces it with a semantic one and adds C3. Run from the repository root after the gate."""
import hashlib, json, os, subprocess

EVID = "docs/evidence/m2-card-review-c2-implementation-2026-10-07"
sdk = subprocess.run(["xcrun", "--sdk", "macosx", "--show-sdk-path"], capture_output=True, text=True).stdout.strip()
ENV = dict(os.environ, PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:" + os.environ["PATH"], SDKROOT=sdk)
V = "npx vitest run "
MUTATIONS = [
    ("E1", "paused/flagged cards counted as due or new (C1 semantics lost)", "src/logic/cardLibrary.ts",
     "    if (state && (state.suspended || state.flagged)) continue;\n", "",
     V + "src/logic/cardLibrary.test.ts src/data/cardLibraryReader.test.ts -t 'paused|follows the C1'"),
    ("E2", "Again cards judged by the end-of-day boundary", "src/logic/cardLibrary.ts",
     "const due = state.step < 0 ? state.dueAt <= nowUtc : state.dueAt < nextLocalMidnightUtc;",
     "const due = state.dueAt < nextLocalMidnightUtc;",
     V + "src/data/cardLibraryReader.test.ts -t 'exact instant'"),
    ("R1", "a failed parse refunds its work reservation", "src/data/cardLibraryReader.ts",
     "        if (parsed.status === \"ok\") {\n          ledger.reconcile(parsed.cards.length);\n          admitted.push(",
     "        if (parsed.status !== \"ok\") ledger.attemptedCards -= 500;\n        if (parsed.status === \"ok\") {\n          ledger.reconcile(parsed.cards.length);\n          admitted.push(",
     V + "src/data/cardLibraryReader.test.ts -t 'work reservations'"),
    ("R2", "leftover candidates re-shown without revalidating eligibility", "src/data/cardLibraryReader.ts",
     "            if (matchesDueFilter(entry, statusFilter)) page.push(entry);",
     "            page.push(entry);",
     V + "src/data/cardLibraryReader.test.ts -t 'revalidated'"),
    ("C1", "controller ownership ignores the generation", "src/pages/StudyLibrary/deferredReviewRead.ts",
     "const owns = () => !this.disposed && this.operation?.token === token && this.state.generation === generation;",
     "const owns = () => !this.disposed;",
     V + "src/pages/StudyLibrary/deferredReviewRead.test.ts"),
    ("C2", "Retry dispatches live state instead of the failed snapshot", "src/pages/StudyLibrary/deferredReviewRead.ts",
     "return failed.kind === \"page\" ? this.dispatchPage(failed.options, failed.cursor) : this.dispatchEnrich(failed.options, failed.targets);",
     "return failed.kind === \"page\" ? this.dispatchPage(this.state.options, this.state.cursor) : this.dispatchEnrich(this.state.options, failed.targets);",
     V + "src/pages/StudyLibrary/deferredReviewRead.test.ts -t 'Retry repeats'"),
    ("C3", "Retry does nothing (failed read never repeated)", "src/pages/StudyLibrary/deferredReviewRead.ts",
     "    if (!failed || failed.generation !== this.state.generation || this.operation) return Promise.resolve();",
     "    if (failed || !failed) return Promise.resolve();",
     V + "src/pages/StudyLibrary/deferredReviewRead.test.ts -t 'Retry repeats|most recent live failure'"),
    ("N1", "native reader counts paused/flagged cards", "src-tauri/src/card_library.rs",
     "            if s.suspended || s.flagged {\n                continue;\n            }",
     "            if false && (s.suspended || s.flagged) {\n                continue;\n            }",
     "cargo test --locked --manifest-path src-tauri/Cargo.toml card_library::tests::shared_card_library_contract"),
]
os.makedirs(f"{EVID}/receipts/mutations", exist_ok=True)
results = []
for mid, what, path, old, new, cmd in MUTATIONS:
    original = open(path, "rb").read()
    before = hashlib.sha256(original).hexdigest()
    text = original.decode()
    assert text.count(old) == 1, (mid, "anchor not unique", text.count(old))
    open(path, "w").write(text.replace(old, new))
    try:
        r = subprocess.run(cmd, shell=True, env=ENV, capture_output=True, text=True)
        out, code = r.stdout + r.stderr, r.returncode
    finally:
        open(path, "wb").write(original)
    after = hashlib.sha256(open(path, "rb").read()).hexdigest()
    with open(f"{EVID}/receipts/mutations/{mid}.txt", "w") as f:
        f.write(f"mutation {mid}: {what}\nfile {path}\n$ {cmd}\n{out}\nexit {code}\n")
    results.append({"id": mid, "defect": what, "file": path, "command": cmd, "exit": code, "killed": code != 0, "restored": before == after, "sha256": before})
    print(mid, "killed" if code != 0 else "SURVIVED", "restored" if before == after else "NOT RESTORED")
with open(f"{EVID}/mutation-results.json", "w") as f:
    json.dump(results, f, indent=2)
    f.write("\n")
