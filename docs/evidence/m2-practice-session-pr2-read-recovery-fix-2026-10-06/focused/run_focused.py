"""Pass-after and joint focused run (assignment step 3): the frozen review
diagnostic (temporarily copied in, removed in `finally`), the permanent R14
cases, the ImportStudyPacketDialog suite and the affected MaterialDetail /
practice / offline suites together, plus the timeout-allowed CLI case."""
from pathlib import Path
import json, os, re, subprocess

root = Path('/Users/rickymac/code/Flight-training-pr70-integration')
out = Path(__file__).resolve().parent
review = 'docs/evidence/m2-practice-session-pr2-read-recovery-review-2026-10-06'
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:' + env['PATH']
S = 'src/pages/StudyLibrary/'
JOINT = [S + 'codex-pr2-material-read-review.test.ts', S + 'PracticeMetadataReadRecovery.test.ts',
         S + 'ImportStudyPacketDialog.test.ts', S + 'MaterialDetailOffline.test.ts', S + 'MaterialDetailImport.test.ts',
         S + 'MaterialDetailGemini.test.ts', S + 'PracticeTestPanel.test.ts', S + 'PracticeSessionPR2.test.ts',
         S + 'PracticeSessionPR2Corrections.test.ts', S + 'PracticeSessionPR2Finish.test.ts',
         'src/data/practiceEraseDurability.test.ts', 'src/data/practiceSessionContract.test.ts',
         'src/data/practiceStartupValidation.test.ts']
diagnostic = root / JOINT[0]
assert not diagnostic.exists()
results = {}
try:
    diagnostic.write_text(subprocess.check_output(
        ['git', 'show', f'origin/main:{review}/codex-pr2-material-read-review.test.ts'], cwd=root, text=True))
    for name, command in [('joint-focused', ['npx', 'vitest', 'run', *JOINT]),
                          ('cli-timeout-case', ['npx', 'vitest', 'run', 'src/logic/macReadinessPreflight.test.ts'])]:
        log = out / f'{name}.txt'
        with log.open('w') as handle:
            handle.write(f'$ {" ".join(command)}\n')
            handle.flush()
            code = subprocess.run(command, cwd=root, env=env, stdout=handle, stderr=subprocess.STDOUT).returncode
        body = log.read_text()
        tests = re.findall(r'Tests\s+(.*)', body)
        results[name] = {'exit': code, 'tests': tests[-1].strip() if tests else None,
                         'unhandled_reported': 'Unhandled Error' in body or 'unhandled error' in body}
finally:
    diagnostic.unlink(missing_ok=True)
results['temporary_diagnostic_removed'] = not diagnostic.exists()
(out / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results))
