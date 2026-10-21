"""Scratch-only named-test mutation receipts; never changes worktree guards or test assertions."""
import hashlib, json, os, shutil, subprocess, tempfile
from pathlib import Path
ROOT=Path.cwd()
OUT=ROOT/'docs/evidence/hw01b-2026-10-21/r2/mutations'
OUT.mkdir(parents=True,exist_ok=True)
SCRATCH=Path(tempfile.mkdtemp(prefix='hw01b-r2-'))
for name in ['src','src-tauri']:
    shutil.copytree(ROOT/name,SCRATCH/name,ignore=shutil.ignore_patterns('target','target-*'))
for pattern in ['package*.json','tsconfig*.json','vite.config.ts','index.html']:
    for p in ROOT.glob(pattern): shutil.copy2(p,SCRATCH/p.name)
(SCRATCH/'docs').symlink_to(ROOT/'docs')
(SCRATCH/'node_modules').symlink_to((ROOT/'node_modules').resolve())
# Tauri embeds the built frontend during compilation.
if (ROOT/'dist').exists(): (SCRATCH/'dist').symlink_to(ROOT/'dist')
originals={}
def edit(name, changes):
    p=SCRATCH/name; raw=p.read_text(); originals[name]=raw
    for old,new in changes:
        assert raw.count(old)==1,(name,old,raw.count(old))
        raw=raw.replace(old,new)
    p.write_text(raw)

edit('src-tauri/src/homework.rs',[
 ('const LIMIT:', 'pub(crate) fn mutant(name: &str) -> bool { std::env::var("HFD_HW_MUTANT").ok().as_deref() == Some(name) }\nconst LIMIT:'),
 ('if let Some(receipt) = receipts.first() {','if let Some(receipt) = receipts.first().filter(|_| !mutant("retry")) {'),
 ('if receipt["request_json"] != raw || receipt["request_hash"] != hash {','if !mutant("conflict") && (receipt["request_json"] != raw || receipt["request_hash"] != hash) {'),
 ('if assignment\n        .map(', 'if !mutant("stale") && assignment\n        .map('),
 ('Some(p) => {\n                        p["source"]', 'Some(p) => {\n                        mutant("source") || p["source"]'),
 ('conn.execute("UPDATE homework_activities SET position=position+? WHERE assignment_id=? AND removed_at IS NULL",params![offset,id]).map_err(|e|e.to_string())?;', 'if !mutant("reorder") { conn.execute("UPDATE homework_activities SET position=position+? WHERE assignment_id=? AND removed_at IS NULL",params![offset,id]).map_err(|e|e.to_string())?; }'),
 ('        conn.execute(\n            "INSERT INTO homework_history VALUES (?,?,?,?,?,?)",','        if !(mutant("reopen") && op["changeKind"] == "reopen") { conn.execute(\n            "INSERT INTO homework_history VALUES (?,?,?,?,?,?)",'),
 ('        Ok(result)\n    };','        }\n        Ok(result)\n    };'),
 ('if all && !positions.is_empty() {','if all && (mutant("empty") || !positions.is_empty()) {'),
 ('    decode_operation(op).map_err(|_| error("INVALID"))?;\n    let tx = conn', '    decode_operation(op).map_err(|_| error("INVALID"))?;\n    if mutant("history") { conn.execute_batch("DROP TRIGGER homework_history_no_update; DROP TRIGGER homework_history_no_delete").unwrap(); }\n    if mutant("rollback") { return apply(conn,op); }\n    let tx = conn'),
])
edit('src-tauri/src/backup.rs',[
 ('if newest_migration > supported {','if !crate::homework::mutant("older") && (newest_migration > supported || (crate::homework::mutant("archive") && newest_migration >= 20)) {'),
 ('pub(crate) fn verify_schema_20_homework_semantics(connection: &Connection) -> Result<(), String> {','pub(crate) fn verify_schema_20_homework_semantics(connection: &Connection) -> Result<(), String> {\n    if crate::homework::mutant("validator") { return Ok(()); }'),
])
edit('src-tauri/src/lib.rs',[
 ('sql: include_str!("../migrations/0020_homework.sql"),','sql: if crate::homework::mutant("upgrade") { "" } else { include_str!("../migrations/0020_homework.sql") },'),
])
edit('src/data/homeworkTransaction.ts',[
 ('type Run =','const mutant = (name: string) => process.env.HFD_HW_MUTANT === name;\ntype Run ='),
 ('if (receipt) {','if (receipt && !mutant("retry")) {'),
 ('if (receipt.request_json !== raw || receipt.request_hash !== hash)', 'if (!mutant("conflict") && (receipt.request_json !== raw || receipt.request_hash !== hash))'),
 ('await run("UPDATE homework_activities SET position=position+? WHERE assignment_id=? AND removed_at IS NULL", [offset, op.assignmentId]);','if (!mutant("reorder")) await run("UPDATE homework_activities SET position=position+? WHERE assignment_id=? AND removed_at IS NULL", [offset, op.assignmentId]);'),
 ('await run("INSERT INTO homework_history VALUES (?,?,?,?,?,?)",', 'if (!(mutant("reopen") && op.changeKind === "reopen")) await run("INSERT INTO homework_history VALUES (?,?,?,?,?,?)",'),
 ('exec("ROLLBACK");','if (!mutant("rollback")) exec("ROLLBACK");'),
 ('  exec("BEGIN IMMEDIATE");','  if (mutant("history")) exec("DROP TRIGGER homework_history_no_update; DROP TRIGGER homework_history_no_delete");\n  exec("BEGIN IMMEDIATE");'),
])
edit('src/domain/homework.ts',[
 ('const all = active.length > 0 && active.every', 'const all = (process.env.HFD_HW_MUTANT === "empty" || active.length > 0) && active.every'),
])
edit('src/data/practiceStateValidation.ts',[
 ('export async function validateHomeworkState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {', 'export async function validateHomeworkState(query: ValidationQuery, reference: ValidationQuery): Promise<void> {\n  if (process.env.HFD_HW_MUTANT === "validator") return;'),
])
edit('src/data/migrations.ts',[
 ('{ version: 20, description: "homework", sql: homework }','{ version: 20, description: "homework", sql: process.env.HFD_HW_MUTANT === "upgrade" ? "" : homework }'),
])
edit('src/data/sqlJsDb.ts',[
 ('        store(lastStored);', '        if (process.env.HFD_HW_MUTANT !== "skip-store") store(lastStored);'),
 ('      restoreLastStored();\n      throw durabilityError', '      if (process.env.HFD_HW_MUTANT !== "persistence") restoreLastStored();\n      throw durabilityError'),
])
# The mutation source is inspectable, with no changes to any test assertion.
import difflib
(OUT/'scratch.patch').write_text(''.join(''.join(difflib.unified_diff(raw.splitlines(True),(SCRATCH/name).read_text().splitlines(True),fromfile=name,tofile=name)) for name,raw in originals.items()))
(OUT/'scratch.json').write_text(json.dumps({'scratch':str(SCRATCH),'original_sha256':{n:hashlib.sha256(v.encode()).hexdigest() for n,v in originals.items()}},indent=2)+'\n')
runner='/Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py'
env=dict(os.environ,PATH='/opt/homebrew/opt/node@22/bin:'+os.environ['PATH'])
results=json.loads((OUT/'results.json').read_text()) if os.environ.get('HW_NATIVE_ONLY') else []
def run(kind,mutant,test,file=None):
    e=dict(env,HFD_HW_MUTANT=mutant)
    if kind=='native':
        e.update(SDKROOT='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk',CARGO_TARGET_DIR=str(ROOT/'src-tauri/target'),CARGO_NET_OFFLINE='true')
        cmd=['cargo','test','--locked',test,'--no-fail-fast'];cwd=SCRATCH/'src-tauri'
    else:
        cmd=['node',str(ROOT/'node_modules/vitest/vitest.mjs'),'run',file,'--configLoader','runner','-t',test];cwd=SCRATCH
    log=OUT/f'{kind}-v2-{mutant}-{test.replace(" ","_")[:65]}.log'
    code=subprocess.run(['python3',runner,str(log),*cmd],cwd=cwd,env=e).returncode
    raw=log.read_text(); assertion_failure=('test result: FAILED' in raw if kind=='native' else 'Failed Tests' in raw)
    results.append({'kind':kind,'mutant':mutant,'test':test,'exit':code,'assertion_failure':assertion_failure,'log':str(log.relative_to(ROOT))})
    (OUT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    assert code!=0 and assertion_failure,results[-1]

native=[('validator','shared_homework_validation_contract_native_outcomes'),('rollback','homework_rollback_midwrite_leaves_nothing'),('retry','homework_retry_same_operation_returns_original'),('conflict','homework_changed_payload_same_operation_refused'),('stale','homework_two_connections_one_winner_one_stale'),('source','homework_source_deleted_keeps_assignment_and_history'),('reorder','homework_reorder_keeps_ids_and_evidence'),('reopen','homework_reopen_preserves_prior_cycle_completion'),('empty','homework_empty_assignment_never_completes'),('history','homework_history_append_only'),('upgrade','schema_19_archive_upgrades_to_20'),('archive','schema_20_homework_archive_round_trip'),('validator','tampered_schema_20_homework_archive_refused'),('older','older_app_rejects_schema_20_backup')]
frontend=[('validator','after close/reopen','homeworkValidationParity'),*[(m,t,'homeworkContract') for m,t in native[1:4]+native[6:10]],('upgrade','populated 19 to 20','homeworkUpgrade'),('skip-store','interrupted browser upgrade','homeworkUpgrade'),('persistence','homework final persistence failure','homeworkUpgrade')]
try:
    if not os.environ.get('HW_NATIVE_ONLY'):
        for mutant,test,file in frontend: run('ts',mutant,test,f'src/data/{file}.test.ts')
    for mutant,test in native: run('native',mutant,test)
finally:
    for name,raw in originals.items(): (SCRATCH/name).write_text(raw)
    assert all((ROOT/name).read_text()==raw for name,raw in originals.items()),'worktree drift during mutation'
    (OUT/'restored.txt').write_text('All scratch sources restored exactly; worktree guards unchanged.\n')
print(f'PROVED {sum(r["assertion_failure"] for r in results)} assertion-failure receipts; {len(results)} total runs including setup failures; scratch restored: {SCRATCH}')
