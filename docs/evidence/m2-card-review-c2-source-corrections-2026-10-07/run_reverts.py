"""Revert each C2SRC fix alone in an isolated scratch copy and run the tests that must catch it."""
import hashlib, json, os, subprocess, sys
root, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
env = dict(os.environ, PATH="/opt/homebrew/opt/node@22/bin:" + os.environ["PATH"])
VARIANTS = {
  "V1-R1-metadata-key": ("src/pages/StudyLibrary/StudyLibrary.tsx", [(
    "  const { data, dataRevision, mutate, repositories } = useAppData();",
    """  const { data, mutate, repositories } = useAppData();
  // REVERTED: the submitted metadata key (id, updatedAt, topic, priority; set updatedAt and card count).
  const legacyKey = JSON.stringify([
    data.materials.map((m) => [m.id, m.updatedAt, m.topic, m.priority]),
    data.aiStudySets.map((set) => [set.sourceMaterialId, set.updatedAt, set.flashcards.length]),
  ]);
  let dataRevision = 0;
  for (let i = 0; i < legacyKey.length; i++) dataRevision = (Math.imul(dataRevision, 31) + legacyKey.charCodeAt(i)) | 0;""")],
    ["src/pages/StudyLibrary/StudyLibraryReviews.test.ts", "src/pages/StudyLibrary/C2SourceReviewDiagnostic.test.ts"]),
  "V2-R2-copied-row": ("src/pages/StudyLibrary/StudyLibraryHistory.tsx", [(
    """  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const inspecting = inspectingId === null ? null : (state.rows.find((row) => row.id === inspectingId) ?? null);
  useEffect(() => {
    if (inspectingId !== null && inspecting === null) setInspectingId(null);
  }, [inspectingId, inspecting]);""",
    """  // REVERTED: the submitted independent copy of the row.
  const [inspecting, setInspecting] = useState<LibraryRecentReviewEntry | null>(null);
  useEffect(() => {}, []);"""),
    ("onClick={() => setInspectingId(row.id)}>", "onClick={() => setInspecting(row)}>"),
    ("onClose={() => setInspectingId(null)} />", "onClose={() => setInspecting(null)} />")],
    ["src/pages/StudyLibrary/StudyLibraryReviews.test.ts", "src/pages/StudyLibrary/C2SourceReviewDiagnostic.test.ts"]),
  "V3-revision-advances-for-obsolete-load": ("src/state/AppDataContext.tsx", [(
    """      refreshPublished.current = true;
      publish(loaded);
    }""",
    """      refreshPublished.current = true;
      publish(loaded);
    } else {
      // REVERTED: an obsolete load also advances the revision.
      setSnapshot((current) => ({ ...current, revision: current.revision + 1 }));
    }""")],
    ["src/state/appDataRevision.test.ts"]),
}
results = {}
for name, (path, pairs, tests) in VARIANTS.items():
    full = os.path.join(root, path)
    original = open(full, "rb").read()
    digest = hashlib.sha256(original).hexdigest()
    text = original.decode()
    for a, b in pairs:
        assert text.count(a) == 1, (name, a)
        text = text.replace(a, b)
    open(full, "w").write(text)
    try:
        run = subprocess.run(["npx", "vitest", "run", *tests], cwd=root, env=env, capture_output=True, text=True)
    finally:
        open(full, "wb").write(original)
    assert hashlib.sha256(open(full, "rb").read()).hexdigest() == digest
    log = run.stdout + run.stderr
    open(os.path.join(out, name + ".txt"), "w").write(log)
    import re
    failed = sorted(set(re.findall(r"× (.+?) \d+ms", re.sub(r"\x1b\[[0-9;]*m", "", log))))
    results[name] = {"file": path, "tests": tests, "exit": run.returncode, "failed": failed, "restored_sha256": digest}
    print(name, "exit", run.returncode, "failed", len(failed))
json.dump(results, open(os.path.join(out, "revert-results.json"), "w"), indent=2)
