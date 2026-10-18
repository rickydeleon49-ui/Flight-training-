import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const source=process.env.M4_REVIEW_TARGET_PACK;
test('a signal-terminated install preserves its real signal in the execution record',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hfd-r39-review-'));
 try {
  const pack=path.join(root,'docs/evidence',path.basename(source));
  for(const rel of ['scripts/run_integration_proof.mjs','scripts/evidenceChecks.mjs','proof/realParserDemonstration.mjs','scratch/pdfjs-engine/package.json','scratch/pdfjs-engine/package-lock.json']){
   const to=path.join(pack,rel);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(source,rel),to);
  }
  assert.equal(spawnSync('git',['init','-q'],{cwd:root}).status,0);
  assert.equal(spawnSync('git',['-c','user.name=Review','-c','user.email=review@example.invalid','commit','--allow-empty','-qm','probe'],{cwd:root}).status,0);
  const bin=path.join(root,'test-adapter-bin');fs.mkdirSync(bin);
  const npm=path.join(bin,'npm');fs.writeFileSync(npm,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "10.9.9"; exit 0; fi\nkill -TERM $$\n');fs.chmodSync(npm,0o700);
  const env={...process.env,PATH:bin+':'+process.env.PATH};
  const control=spawnSync(npm,['ci'],{env,encoding:'utf8'});assert.equal(control.signal,'SIGTERM');
  const r=spawnSync(process.execPath,[path.join(pack,'scripts/run_integration_proof.mjs'),'--install','--engine-check-only'],{cwd:root,env,encoding:'utf8'});
  assert.equal(r.status,1,'a signal-terminated install must fail the runner');
  const record=JSON.parse(fs.readFileSync(path.join(pack,'scratch/pdfjs-engine/install-execution.json'),'utf8'));
  assert.equal(record.exit,null,'a signal termination has no normal exit code');
  assert.equal(record.signal,control.signal,'capture the real child signal instead of hard-coding null');
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
