"""Sensitivity check: reintroduce each reviewed defect into the corrected proof
files one at a time, require corrections.test.mjs to fail, restore bytes."""
from pathlib import Path
import json, os, subprocess

here = Path(__file__).resolve().parent
proof = here.parent / 'm2-card-review-scope-2026-10-06' / 'proof'
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:' + env['PATH']
MUTATIONS = [
    ('Q1', 'reviewed SQL: every card compared with the end-of-day bound', 'cardQuery.mjs',
     '  AND ((s.step < 0 AND s.due_at <= :nowUtc)\n       OR (s.step >= 0 AND s.due_at < :nextLocalMidnightUtc))',
     '  AND s.due_at <= :nextLocalMidnightUtc'),
    ('Q2', 'reviewed SQL: material-only filter (no current-version binding)', 'cardQuery.mjs',
     'WHERE i.version_id = :versionId\n  AND s.source_material_id', 'WHERE :versionId IS NOT NULL\n  AND s.source_material_id'),
    ('G1', 'no generation barrier', 'contractModel.mjs',
     '  if (operation.expectedGeneration !== generation) throw new ContractRefusal("STALE_GENERATION");\n', ''),
    ('G2', 'erasure dereferences already tombstoned results', 'contractModel.mjs',
     '    if (value.materialId === materialId && !value.erased) {',
     '    if (value.result.itemId !== undefined && value.materialId === materialId) {'),
]
results = []
for ident, label, name, old, new in MUTATIONS:
    path = proof / name
    original = path.read_bytes()
    text = original.decode()
    assert text.count(old) == 1, ident
    try:
        path.write_text(text.replace(old, new))
        run = subprocess.run(['node', '--test', '--test-reporter=spec', 'corrections.test.mjs'], cwd=proof, env=env,
                             capture_output=True, text=True)
        (here / 'receipts' / f'mutation-{ident}.txt').write_text(run.stdout + run.stderr)
        failed = [line.strip() for line in run.stdout.splitlines() if line.strip().startswith('✖') and '[' in line]
    finally:
        path.write_bytes(original)
    results.append({'id': ident, 'mutation': label, 'file': name, 'exit': run.returncode, 'killed': run.returncode != 0,
                    'failing_cases': failed, 'restored': path.read_bytes() == original})
summary = {'all_killed': all(r['killed'] for r in results), 'all_restored': all(r['restored'] for r in results), 'mutations': results}
(here / 'mutation-results.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({'all_killed': summary['all_killed'], 'all_restored': summary['all_restored'],
                  'by_id': {r['id']: len(r['failing_cases']) for r in results}}))
