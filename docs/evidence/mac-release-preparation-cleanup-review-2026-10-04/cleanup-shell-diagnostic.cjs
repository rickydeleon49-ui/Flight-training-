const {readFileSync,writeFileSync,mkdtempSync,mkdirSync,chmodSync,existsSync,rmSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
const {join}=require('node:path');
const {createRequire}=require('node:module');
const root='/Users/rickymac/code/Flight-training-pr70-integration';
const YAML=createRequire(root+'/package.json')('yaml');
const doc=YAML.parse(readFileSync(root+'/docs/evidence/mac-release-preparation-2026-10-04/proposed-release-workflow.yml','utf8'));
const steps=doc.jobs['build-macos'].steps;
const setup=steps.find(s=>s.name==='Prepare temporary signing keychain (macOS)').run;
const cleanup=steps.find(s=>s.name==='Clean up temporary signing credentials and keychain').run;
const observations=[];
for (const mode of ['local-shell-state-delete-failure','github-shell-state-delete-failure','github-shell-env-write-failure']) {
 const scratch=mkdtempSync('/tmp/hfd-cleanup-shell-review-');
 try {
  const bin=join(scratch,'bin'),runner=join(scratch,'runner');mkdirSync(bin);mkdirSync(runner);
  const state=join(runner,'hfd-orig-keychains.txt'),kc=join(runner,'hfd-signing.keychain-db'),auth=join(runner,'AuthKey.p8'),cert=join(runner,'cert.p12'),log=join(scratch,'calls.jsonl');
  const mock=`#!/opt/homebrew/opt/node@22/bin/node
const fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='list-keychains'){if(a.includes('-s')) process.exit(0);console.log('    "/synthetic/login.keychain-db"\\n    "/synthetic/Keychains With Spaces/extra.keychain"');}
if(a[0]==='create-keychain') fs.writeFileSync(a.at(-1),'synthetic keychain');
if(a[0]==='delete-keychain') fs.unlinkSync(a[1]);
`;
  writeFileSync(join(bin,'security'),mock);chmodSync(join(bin,'security'),0o755);
  writeFileSync(join(bin,'openssl'),'#!/bin/bash\nprintf "%s\\n" 0123456789abcdef0123456789abcdef\n');chmodSync(join(bin,'openssl'),0o755);
  writeFileSync(join(bin,'rm'),'#!/bin/bash\nfor a in "$@"; do\n  if [ "$MOCK_FAIL_STATE_RM" = 1 ] && [ "$a" = "$RUNNER_TEMP/hfd-orig-keychains.txt" ]; then\n    echo "synthetic state removal denied" >&2\n    exit 73\n  fi\ndone\nexec /bin/rm "$@"\n');chmodSync(join(bin,'rm'),0o755);
  const envfile=join(scratch,'github_env');writeFileSync(envfile,'');
  const env={...process.env,PATH:bin+':'+process.env.PATH,RUNNER_TEMP:runner,GITHUB_ENV:envfile,MOCK_LOG:log,APPLE_CERTIFICATE:Buffer.from('SYNTHETIC_CERT').toString('base64'),APPLE_CERTIFICATE_PASSWORD:'synthetic-password',APPLE_API_KEY_P8:'SYNTHETIC_P8'};
  if(mode.endsWith('env-write-failure')){rmSync(envfile);mkdirSync(envfile);}
  const setupFile=join(scratch,'setup.sh'),cleanupFile=join(scratch,'cleanup.sh');writeFileSync(setupFile,setup);writeFileSync(cleanupFile,cleanup);
  const s=spawnSync('/bin/bash',['--noprofile','--norc','-eo','pipefail',setupFile],{env,encoding:'utf8'});
  const cenv={...env,MOCK_FAIL_STATE_RM:mode.endsWith('state-delete-failure')?'1':'0'};
  const args=mode.startsWith('local-shell')?['-c',cleanup]:['--noprofile','--norc','-eo','pipefail',cleanupFile];
  const c=spawnSync('/bin/bash',args,{env:cenv,encoding:'utf8'});
  observations.push({mode,setupExit:s.status,cleanupExit:c.status,cleanupStdout:c.stdout,cleanupStderr:c.stderr,remaining:{keychain:existsSync(kc),state:existsSync(state),auth:existsSync(auth),cert:existsSync(cert)},securityCalls:existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(JSON.parse):[]});
 } finally {rmSync(scratch,{recursive:true,force:true});}
}
const out={syntheticOnly:true,realSecurityCommandsRun:false,sourceJob:'build-macos',observations};
writeFileSync('/tmp/hfd-release-cleanup-shell-observations.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
