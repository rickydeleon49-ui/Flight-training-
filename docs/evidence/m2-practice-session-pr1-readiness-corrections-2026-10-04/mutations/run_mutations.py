"""Mutation proof: undo each correction in turn, run its permanent tests, and
require them to fail; every mutated file is restored byte-for-byte and all
source hashes are re-verified at the end."""
from pathlib import Path
import hashlib, json, os, subprocess

root = Path('/Users/rickymac/code/Flight-training-pr70-integration')
out = Path(__file__).resolve().parent
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:' + env['PATH']
env['SDKROOT'] = '/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk'
VITEST = ['npx', 'vitest', 'run', 'src/data/practiceStartupValidation.test.ts']
def cargo(*filters):
    return ['cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--lib', '--', *filters, '--test-threads=1']

MUTATIONS = [
    ('T1', 'sql.js startup skips validation', 'src/data/sqlJsDb.ts',
     'await executeLegacyConversion(exec, run, query, undefined, () =>\n        validateApplicationDatabase(query, reference.query),\n      );',
     'await executeLegacyConversion(exec, run, query);', VITEST),
    ('T2', 'sql.js stores migrated bytes before conversion/validation (old order)', 'src/data/sqlJsDb.ts',
     '    await applyMigrations((sql) => db.run(sql), applied);\n',
     '    await applyMigrations((sql) => db.run(sql), applied);\n    store(exportBytes());\n', VITEST),
    ('T3', 'Node driver validates only after the conversion committed', 'src/data/testing/nodeSqliteDb.ts',
     'await executeLegacyConversion(exec, run, query, undefined, () =>\n      validateApplicationDatabase(query, referenceQuery),\n    );',
     'await executeLegacyConversion(exec, run, query);\n    await validateApplicationDatabase(query, referenceQuery);', VITEST),
    ('T4', 'TS validator ignores foreign-key definitions', 'src/data/practiceStateValidation.ts',
     'if (!same(await foreignKeyShapes(query, table), await foreignKeyShapes(reference, table))) {',
     'if (false) {', VITEST),
    ('T5', 'TS validator ignores CHECK constraints', 'src/data/practiceStateValidation.ts',
     'if (!same(checkConstraints(await tableSql(query, table)), checkConstraints(await tableSql(reference, table)))) {',
     'if (false) {', VITEST),
    ('T6', 'TS startup never runs the schema-11 practice validation', 'src/data/practiceStateValidation.ts',
     'if (newest >= 11) await validatePracticeState(query, reference);',
     'if (newest >= 99) await validatePracticeState(query, reference);', VITEST),
    ('T7', 'sql.js always re-stores an unchanged database at startup', 'src/data/sqlJsDb.ts',
     'if (!saved || !sameBytes(saved, lastStored)) {', 'if (saved || !saved) {', VITEST),
    ('R1', 'native verifier ignores foreign-key definitions', 'src-tauri/src/backup.rs',
     'if foreign_key_shapes(connection, table)? != foreign_key_shapes(&ref_conn, table)? {',
     'if false && foreign_key_shapes(connection, table)? != foreign_key_shapes(&ref_conn, table)? {',
     cargo('practice_sessions::tests')),
    ('R2', 'native verifier ignores CHECK constraints', 'src-tauri/src/backup.rs',
     '        if check_constraints(&table_sql(connection, table)?)\n',
     '        if false && check_constraints(&table_sql(connection, table)?)\n',
     cargo('practice_sessions::tests::shared_validation_contract')),
    ('R3', 'native conversion commits before validation (old order)', 'src-tauri/src/practice_sessions.rs',
     '    crate::backup::verify_application_connection(&tx)\n        .map_err(|e| format!("Semantic validation failed: {e}"))?;\n    tx.commit().map_err(|e| format!("Commit error: {e}"))?;\n',
     '    tx.commit().map_err(|e| format!("Commit error: {e}"))?;\n    drop(conn);\n    crate::backup::verify_application_database(&db_path)\n        .map_err(|e| format!("Semantic validation failed: {e}"))?;\n',
     cargo('practice_sessions::tests::failed_semantic_validation_rolls_back_legacy_conversion')),
    ('R4', 'native initialization keeps stale readiness on entry', 'src-tauri/src/practice_sessions.rs',
     '    unmark_root_ready(root);\n    let converted = convert_and_validate_at(root)?;',
     '    let converted = convert_and_validate_at(root)?;',
     cargo('practice_sessions::tests::early_conversion_error_revokes_stale_readiness')),
    ('R5', 'native initialization publishes readiness without the generation guard', 'src-tauri/src/practice_sessions.rs',
     '    if !mark_root_ready_at_generation(root, generation) {',
     '    if !{ let _ = generation; mark_root_ready(root); true } {',
     cargo('practice_sessions::tests::restore_during_initialization_does_not_publish_stale_readiness')),
]

def tracked_sources():
    names = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=root, text=True).splitlines()
    names += subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=root, text=True).splitlines()
    return sorted(p for p in set(names) if p.startswith(('src/', 'src-tauri/')) and (root / p).is_file())

before = {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in tracked_sources()}
results = []
for ident, label, rel, old, new, command in MUTATIONS:
    path = root / rel
    original = path.read_bytes()
    text = original.decode()
    assert text.count(old) == 1, f'{ident}: anchor not found exactly once'
    try:
        path.write_text(text.replace(old, new))
        with (out / f'{ident}.txt').open('w') as log:
            code = subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
    finally:
        path.write_bytes(original)
    results.append({'id': ident, 'mutation': label, 'file': rel, 'command': ' '.join(command), 'exit': code, 'killed': code != 0})
after = {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in tracked_sources()}
summary = {'all_killed': all(r['killed'] for r in results), 'all_source_restored': before == after, 'mutations': results}
(out / 'results.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({k: summary[k] for k in ('all_killed', 'all_source_restored')}), [(r['id'], r['exit']) for r in results])
