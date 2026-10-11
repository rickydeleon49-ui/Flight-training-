#!/usr/bin/env node
// Fixed production policy. Scratch tests replace constants in a copied file, never environment switches.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const POLICY={uid:502,account:'hfdtest',workspace:'/Users/hfdtest/Downloads/hfd-schema13-workspace',applications:'/Users/hfdtest/Applications',kit:'/Users/Shared/hfd-schema13-kit-2026-10-08'};
const TOOLS={id:'/usr/bin/id',group:'/usr/sbin/dseditgroup',pgrep:'/usr/bin/pgrep',image:'/usr/bin/hdiutil',copy:'/bin/cp'};
const CANDIDATES={
 NEW:{file:'NEW-schema13-36a7b39-adhoc.dmg',folder:'HFD-NEW-36a7b39',dmg:'b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334',exe:'824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28'},
 OLD:{file:'OLD-schema12-2a6a415-adhoc.dmg',folder:'HFD-OLD-2a6a415',dmg:'ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62',exe:'2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a'}
};
const exists=p=>{try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
function plain(p){if(!path.isAbsolute(p)||path.normalize(p)!==p||/[\r\n]/.test(p))throw Error('unsafe path');let current='/';for(const part of p.split('/').filter(Boolean)){current=path.join(current,part);if(exists(current)&&fs.lstatSync(current).isSymbolicLink())throw Error(`symlink component ${current}`);}}
function ownedDir(p){plain(p);const s=fs.lstatSync(p);if(!s.isDirectory()||s.uid!==POLICY.uid)throw Error(`unsafe directory ownership ${p}`);fs.accessSync(p,fs.constants.W_OK);}
function regular(p){plain(p);const s=fs.lstatSync(p);if(!s.isFile()||s.nlink!==1)throw Error(`nonregular/aliased input ${p}`);}
const hash=p=>{regular(p);return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');};
let child,interrupted=false,signalSeen=false;
function tool(file,args){return new Promise((resolve,reject)=>{let out='',err='';const c=spawn(file,args,{stdio:['ignore','pipe','pipe'],detached:true});child=c;c.stdout.on('data',v=>out+=v);c.stderr.on('data',v=>err+=v);c.on('error',reject);c.on('close',(code,signal)=>{if(child===c)child=null;resolve({code,signal,out,err});});});}
async function checked(file,args){const r=await tool(file,args);if(r.code!==0||interrupted)throw Error(`command failed/interrupted: ${file} ${args.join(' ')} (exit ${r.code}, ${r.signal??''}) ${r.err}`);return r;}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(signalSeen)return;signalSeen=true;interrupted=true;if(child){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}});
let mount,attachAttempted=false,container;
try{
 const role=process.argv[2];if(process.argv.length!==3||!CANDIDATES[role])throw Error('choose exactly OLD or NEW');
 if(process.getuid()!==POLICY.uid)throw Error('must run in the approved account');
 const name=(await checked(TOOLS.id,['-un'])).out.trim();if(name!==POLICY.account)throw Error('wrong account');
 const group=await tool(TOOLS.group,['-o','checkmember','-m',POLICY.account,'admin']);if(group.code!==1)throw Error('admin membership or account inspection error');
 for(const args of [['-f','Her Flight Deck.app/Contents/MacOS/her-flight-deck'],['-x','her-flight-deck']]){const r=await tool(TOOLS.pgrep,args);if(r.code!==1)throw Error('app running or process inspection error');}
 if(interrupted)throw Error('interrupted');
 const run=process.env.HFD_RUN_ID;if(!/^run-[A-Za-z0-9_-]+$/.test(run??''))throw Error('explicit run ID required');
 const evidence=path.join(POLICY.workspace,'evidence',run);
 for(const p of [path.dirname(POLICY.workspace),POLICY.workspace,path.join(POLICY.workspace,'evidence'),evidence,POLICY.applications])ownedDir(p);
 const c=CANDIDATES[role],dmg=path.join(POLICY.kit,'installers',c.file);
 const receipt=path.join(evidence,`install-${role}.json`);plain(receipt);if(exists(receipt))throw Error('installation receipt exists; preserve this run');
 container=path.join(POLICY.applications,c.folder);plain(container);if(exists(container))throw Error('installation destination exists; preserve it');
 if(hash(dmg)!==c.dmg)throw Error('DMG hash mismatch; nothing mounted or copied');
 mount=fs.mkdtempSync(path.join(evidence,`mount-${role}-`));fs.chmodSync(mount,0o700);attachAttempted=true;
 await checked(TOOLS.image,['attach','-readonly','-nobrowse','-mountpoint',mount,dmg]);
 const app=path.join(mount,'Her Flight Deck.app'),binary=path.join(app,'Contents/MacOS/her-flight-deck');
 if(hash(binary)!==c.exe)throw Error('mounted executable hash mismatch; nothing copied');
 fs.mkdirSync(container,{mode:0o700});
 await checked(TOOLS.copy,['-R',app,container]);
 const installed=path.join(container,'Her Flight Deck.app/Contents/MacOS/her-flight-deck');
 if(hash(installed)!==c.exe)throw Error(`installed hash mismatch; preserve partial destination ${container}`);
 fs.writeFileSync(receipt,JSON.stringify({role,dmg,sha256:c.dmg,executableSha256:c.exe,destination:container,uid:process.getuid()},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(`OK: verified installation ${container}`);
}catch(e){console.error(`REFUSED: ${e.message}${container&&exists(container)?`; preserve task-owned destination ${container}`:''}`);process.exitCode=2;}
finally{
 if(attachAttempted){
  // Even a failed attach may have mounted a volume. Always attempt detach of this fresh point.
  try {
   const r=await tool(TOOLS.image,['detach',mount]);
   if(r.code!==0){console.error(`Cleanup: detach failed for ${mount}; inspect and detach this exact task mountpoint (${r.err})`);process.exitCode=2;}
  } catch(e) {console.error(`Cleanup: could not inspect/detach ${mount}: ${e.message}`);process.exitCode=2;}
 }
 if(mount){try{fs.rmdirSync(mount);}catch(e){console.error(`Cleanup: preserve mountpoint ${mount}: ${e.message}`);process.exitCode=2;}}
}
