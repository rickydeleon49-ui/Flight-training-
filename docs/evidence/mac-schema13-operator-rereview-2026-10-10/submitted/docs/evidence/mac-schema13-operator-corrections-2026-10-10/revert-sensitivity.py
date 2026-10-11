"""Revert sensitivity test runner for MACV-R7 and MACV-R8.
Proves that targeted reversions of our fixes flip the corresponding assertions
from PASS to FAIL.
"""
import pathlib
import tempfile
import subprocess
import json
import sys
import shutil

repo = pathlib.Path(__file__).resolve().parents[3]
helper_src = repo / 'scripts/mac-schema13-profile-snapshot.mjs'
op_src = pathlib.Path(__file__).parent / 'hfd-operator.sh'
op_diag = pathlib.Path(__file__).parent / 'operator-diagnostics.py'

reverts = []

def run_helper_diag(mutated_code):
    with tempfile.TemporaryDirectory() as tmp:
        m_path = pathlib.Path(tmp) / 'helper.mjs'
        m_path.write_text(mutated_code)
        
        diag_path = pathlib.Path('/tmp/test-helper-diag.mjs')
        res = subprocess.run(['/opt/homebrew/opt/node@22/bin/node', str(diag_path), str(m_path)],
                             capture_output=True, text=True)
        try:
            return json.loads(res.stdout)
        except Exception:
            return {'results': []}

def run_op_diag(mutated_code):
    with tempfile.TemporaryDirectory() as tmp:
        m_path = pathlib.Path(tmp) / 'hfd-operator.sh'
        m_path.write_text(mutated_code)
        m_path.chmod(0o755)
        
        diag_code = op_diag.read_text().replace(
            "source = pathlib.Path(__file__).parent / 'hfd-operator.sh'",
            f'source = pathlib.Path("{m_path}")'
        )
        res = subprocess.run([sys.executable, '-c', diag_code],
                             capture_output=True, text=True)
        try:
            return json.loads(res.stdout)
        except Exception:
            return {'results': []}

# -------------------------------------------------------------
# R7-M1: dseditgroup exit 2 treated as non-admin
# -------------------------------------------------------------
op_content = op_src.read_text()
m1 = op_content.replace(
    'elif [ "${status}" -eq 1 ]; then',
    'elif [ "${status}" -eq 1 ] || [ "${status}" -eq 2 ]; then'
)
assert m1 != op_content
res1 = run_op_diag(m1)
t1 = [r for r in res1.get('results', []) if 'account-inspection failure' in r['name']][0]
flipped1 = (t1['pass'] == False)
reverts.append({
    'id': 'R7-M1',
    'domain': 'MACV-R7',
    'targetAssertion': t1['name'],
    'flippedToFail': flipped1,
    'detail': 'dseditgroup exit 2 treated as non-admin'
})

# -------------------------------------------------------------
# R7-M2: traversal components allowed in source
# -------------------------------------------------------------
m2 = op_content.replace(
    '*"/../"* | *"/.." | "../"* | "..") die "source ${from} contains traversal components (..)" ;;',
    '*"/NEVER_MATCH"*) die "source ${from} contains traversal components (..)" ;;'
).replace(
    'if [ "${allowed}" != "true" ]; then',
    'allowed=true; if false; then'
)
assert m2 != op_content
res2 = run_op_diag(m2)
t2 = [r for r in res2.get('results', []) if 'dot-dot operands cannot escape' in r['name']][0]
flipped2 = (t2['pass'] == False)
reverts.append({
    'id': 'R7-M2',
    'domain': 'MACV-R7',
    'targetAssertion': t2['name'],
    'flippedToFail': flipped2,
    'detail': 'traversal components allowed in source'
})

# -------------------------------------------------------------
# R7-M3: symlink destination parent allowed to escape
# -------------------------------------------------------------
m3 = op_content.replace(
    'if [ -L "${to_parent}" ]; then die "destination parent ${to_parent} is a symlink; symlink parents cannot escape the policy root"; fi',
    '# symlink check removed'
).replace(
    'if [ "${allowed}" != "true" ]; then\n    die "destination ${to} (canonical ${c_to}) parent is outside policy root ${PROFILES_DIR}"',
    'allowed=true\n    if false; then\n    die "destination"'
)
assert m3 != op_content
res3 = run_op_diag(m3)
t3 = [r for r in res3.get('results', []) if 'symlink destination parent' in r['name']][0]
flipped3 = (t3['pass'] == False)
reverts.append({
    'id': 'R7-M3',
    'domain': 'MACV-R7',
    'targetAssertion': t3['name'],
    'flippedToFail': flipped3,
    'detail': 'symlink destination parent allowed to escape'
})

# -------------------------------------------------------------
# R7-M4: whitespace splitting on record path (breaks Application Support)
# -------------------------------------------------------------
old_parse = """    while IFS='=' read -r key val || [ -n "$key" ]; do
      case "$key" in
        FORMAT) rec_format="$val" ;;
        RUN_ID) rec_run_id="$val" ;;
        OP_ID) rec_op_id="$val" ;;
        TIMESTAMP) rec_timestamp="$val" ;;
        CANONICAL_PATH) rec_path="$val" ;;
        ORIGINAL_MODE) rec_mode="$val" ;;
        DEV_INO) rec_dev_ino="$val" ;;
      esac
    done < "${record}" """
# Revert to old read -r
m4 = op_content.replace(
    'while IFS=\'=\' read -r key val',
    'read -r rec_path rec_mode < "${record}"\n    rec_format="hfd-backup-mode-record/1"\n    rec_dev_ino="$target_dev_ino"\n    while false; read -r key val'
)
assert m4 != op_content
res4 = run_op_diag(m4)
t4 = [r for r in res4.get('results', []) if 'Application Support spaces' in r['name']][0]
flipped4 = (t4['pass'] == False)
reverts.append({
    'id': 'R7-M4',
    'domain': 'MACV-R7',
    'targetAssertion': t4['name'],
    'flippedToFail': flipped4,
    'detail': 'whitespace splitting on record path'
})

# -------------------------------------------------------------
# R8-M1: ignored schema-13 table content digests in unchanged
# -------------------------------------------------------------
helper_content = helper_src.read_text()
m5 = helper_content.replace(
    'if (ta.rowCount !== tb.rowCount || ta.sha256 !== tb.sha256) {',
    'if (false && (ta.rowCount !== tb.rowCount || ta.sha256 !== tb.sha256)) {'
)
assert m5 != helper_content, 'M5 replacement failed'
res5 = run_helper_diag(m5)
t5 = [r for r in res5.get('results', []) if 'added pending operation' in r['name']][0]
flipped5 = (t5['pass'] == False)
reverts.append({
    'id': 'R8-M1',
    'domain': 'MACV-R8',
    'targetAssertion': t5['name'],
    'flippedToFail': flipped5,
    'detail': 'ignored schema-13 table content digests in unchanged'
})

# -------------------------------------------------------------
# R8-M2: ignored 0013 index set in upgrade contract
# -------------------------------------------------------------
m6 = helper_content.replace(
    'const missingRequired = SCHEMA13_OBJECTS.filter(n => !added.includes(n)).sort();',
    'const missingRequired = [];'
)
assert m6 != helper_content, 'M6 replacement failed'
res6 = run_helper_diag(m6)
t6 = [r for r in res6.get('results', []) if 'upgrade requires all indexes' in r['name']][0]
flipped6 = (t6['pass'] == False)
reverts.append({
    'id': 'R8-M2',
    'domain': 'MACV-R8',
    'targetAssertion': t6['name'],
    'flippedToFail': flipped6,
    'detail': 'ignored 0013 index set in upgrade contract'
})

# -------------------------------------------------------------
# R8-M3: ignored 0013 index set in restore contract
# -------------------------------------------------------------
m7 = helper_content.replace(
    'const missingRequired = SCHEMA13_OBJECTS.filter(n => !afterNames.has(n)).sort();',
    'const missingRequired = [];'
)
assert m7 != helper_content, 'M7 replacement failed'
res7 = run_helper_diag(m7)
t7 = [r for r in res7.get('results', []) if 'restore requires all indexes' in r['name']][0]
flipped7 = (t7['pass'] == False)
reverts.append({
    'id': 'R8-M3',
    'domain': 'MACV-R8',
    'targetAssertion': t7['name'],
    'flippedToFail': flipped7,
    'detail': 'ignored 0013 index set in restore contract'
})

# Summary output
all_passed = all(r['flippedToFail'] for r in reverts)
out = {
    'schema': 'hfd-revert-sensitivity/1',
    'totalReverts': len(reverts),
    'allFlippedToFail': all_passed,
    'reverts': reverts
}
print(json.dumps(out, indent=2))
sys.exit(0 if all_passed else 1)
