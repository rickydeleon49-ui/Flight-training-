"""Fail-before: rebuild the submitted MaterialDetail.tsx by reversing the R14
edit, prove it is byte-identical to the frozen review hash, then run the
frozen review diagnostic and the new permanent R14 cases against it. The
corrected file and temporary diagnostic are restored/removed in `finally`."""
from pathlib import Path
import hashlib, json, os, subprocess

root = Path('/Users/rickymac/code/Flight-training-pr70-integration')
out = Path(__file__).resolve().parent
review = 'docs/evidence/m2-practice-session-pr2-read-recovery-review-2026-10-06'
frozen = json.loads(subprocess.check_output(['git', 'show', f'origin/main:{review}/source-hashes.json'], cwd=root, text=True))
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:' + env['PATH']

target = root / 'src/pages/StudyLibrary/MaterialDetail.tsx'
corrected = target.read_bytes()
text = corrected.decode()
REVERSE = [
    ('import { PracticeTestPanel } from "./PracticeTestPanel";\nimport { usePracticeMetadata } from "./usePracticeMetadata";\n',
     'import { PracticeTestPanel } from "./PracticeTestPanel";\n'),
    ('  const [fileMissing, setFileMissing] = useState(false);\n',
     '  const [fileMissing, setFileMissing] = useState(false);\n  const [conversionStatus, setConversionStatus] = useState<{\n    legacyMigratedAt: string | null;\n    legacyError: string | null;\n  } | null>(null);\n  const [completedCount, setCompletedCount] = useState(0);\n'),
    ('''  const { metadata: practiceMetadata, retry: retryPracticeMetadata } = usePracticeMetadata(
    materialId,
    repositories?.practiceSessions,
  );
  const conversionStatus = practiceMetadata.phase === "loaded" ? practiceMetadata.conversionStatus : null;
  const completedCount = practiceMetadata.phase === "loaded" ? practiceMetadata.completedCount : 0;
''', '''  useEffect(() => {
    let cancelled = false;
    if (materialId && repositories?.practiceSessions) {
      void repositories.practiceSessions.getConversionStatus(materialId).then((status) => {
        if (!cancelled) setConversionStatus(status);
      });
      void repositories.practiceSessions.getCompletedHistory(materialId).then((items) => {
        if (!cancelled) setCompletedCount(items.length);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [materialId, repositories]);
'''),
]
for new, old in REVERSE:
    assert text.count(new) == 1, new[:50]
    text = text.replace(new, old)
start = text.index('                {practiceMetadata.phase === "failed" ? (')
end = text.index('                {conversionStatus?.legacyError === "MALFORMED_QUESTION" ? (')
submitted = (text[:start] + text[end:]).encode()
digest = hashlib.sha256(submitted).hexdigest()
results = {'rebuilt_submitted_sha256': digest,
           'matches_frozen_review_hash': digest == frozen['src/pages/StudyLibrary/MaterialDetail.tsx']}
assert results['matches_frozen_review_hash'], 'reconstruction differs from the frozen submission'

diagnostic = root / 'src/pages/StudyLibrary/codex-pr2-material-read-review.test.ts'
assert not diagnostic.exists()
try:
    target.write_bytes(submitted)
    diagnostic.write_text(subprocess.check_output(
        ['git', 'show', f'origin/main:{review}/codex-pr2-material-read-review.test.ts'], cwd=root, text=True))
    for name, files in [('frozen-diagnostic', [str(diagnostic.relative_to(root))]),
                        ('permanent-r14-cases', ['src/pages/StudyLibrary/PracticeMetadataReadRecovery.test.ts'])]:
        with (out / f'{name}.txt').open('w') as log:
            results[f'{name}_exit'] = subprocess.run(['npx', 'vitest', 'run', *files], cwd=root, env=env,
                                                     stdout=log, stderr=subprocess.STDOUT).returncode
finally:
    target.write_bytes(corrected)
    diagnostic.unlink(missing_ok=True)
results['corrected_source_restored'] = target.read_bytes() == corrected
(out / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results))
