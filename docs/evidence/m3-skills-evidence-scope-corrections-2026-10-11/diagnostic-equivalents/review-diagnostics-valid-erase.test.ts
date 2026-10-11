/**
 * DERIVED from the frozen review diagnostic
 * docs/evidence/m3-skills-evidence-scope-review-2026-10-10/diagnostics/review-diagnostics.test.ts
 * with exactly ONE change, in [M3-R2a]'s setup: the erase request uses the
 * contract's `confirm:'erase'` instead of `expectedRevision:1` (erase_observation
 * takes exactly action, operationId, observationId, confirm). As frozen, that
 * setup is refused by the submitted decoder too, so the case never reached the
 * resurrection it targets. The frozen file is preserved unchanged.
 */
/** Frozen independent diagnostics. Run from the submitted pack's tests directory. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Engine, EngineName } from '../prototype/candidateEngine';
import { candidateReference } from '../prototype/candidateEngine';
import { validateSkillEvidenceState } from '../prototype/skillEvidenceValidation';
import { createEvidenceController, type EvidenceClient, type ObservationDraft } from '../prototype/evidenceController';
import type { EvidencePage, SkillEvidenceOutcome } from '../prototype/types';
import cases from '../fixtures/review-validation-cases.json';
import { candidateWithDebrief, observation, uuid } from './helpers';
const open: Engine[] = [];
afterEach(() => { for (const e of open.splice(0)) e.close(); });
function deferred<T>() { let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>{resolve=r}); return {promise,resolve}; }
async function setup(name:EngineName='node:sqlite') { const x=await candidateWithDebrief(name); open.push(x.engine); const client:EvidenceClient={page:i=>x.store.page(i),summary:i=>x.store.summary(i),act:a=>x.store.act(a),history:i=>x.store.history(i)}; return {...x,client}; }
const draft=(journalId:string,wording='First wording'):ObservationDraft=>({skillId:'builtin.normal_landing',journalId,sourceField:'none',wording,observedOn:'2026-10-01',attribution:'self_report',instructorName:''});
const n=(e:Engine)=>Number(e.query('SELECT COUNT(*) AS n FROM skill_observations')[0]!['n']);

describe('review: controller ownership',()=>{
 it('[M3-R1a] acknowledged save retains draft identity while its refresh is held',async()=>{
  const x=await setup(); const c=createEvidenceController(x.client,{newId:uuid}); await c.open('builtin.normal_landing');
  const held=deferred<EvidencePage>(); x.client.page=()=>held.promise; const write=vi.spyOn(x.client,'act');
  const first=c.submitObservation('d',draft(x.journalId)); await vi.waitFor(()=>expect(c.getState().notice).toBe('saved'));
  const second=c.submitObservation('d',draft(x.journalId));
  held.resolve({items:[],nextCursor:null}); await Promise.all([first,second]);
  expect(write).toHaveBeenCalledTimes(1); expect(n(x.engine)).toBe(1);
 });
 it('[M3-R1b] late A acknowledgment cannot clear B saving or publish A notice on B',async()=>{
  const x=await setup(); const c=createEvidenceController(x.client,{newId:uuid}); await c.open('builtin.normal_landing');
  const a=deferred<SkillEvidenceOutcome>(), b=deferred<SkillEvidenceOutcome>(); let calls=0;
  x.client.act=()=>++calls===1?a.promise:b.promise;
  const fa=c.submitObservation('A',draft(x.journalId)); await c.open('builtin.stalls');
  const fb=c.submitObservation('B',{...draft(x.journalId),skillId:'builtin.stalls'});
  a.resolve({status:'applied',result:{action:'create_observation',observationId:uuid(),revision:1}}); await fa;
  const afterA=c.getState(); b.resolve({status:'applied',result:{action:'create_observation',observationId:uuid(),revision:1}}); await fb;
  expect(afterA.saving).toBe(true); expect(afterA.notice).toBeNull();
 });
 it('[M3-R1c] refresh superseding a held older page releases its pagination lock',async()=>{
  const x=await setup(); const held=deferred<EvidencePage>(); let reads=0;
  x.client.page=()=>++reads===2?held.promise:Promise.resolve({items:[],nextCursor:'cursor'});
  const c=createEvidenceController(x.client,{newId:uuid}); await c.open('builtin.normal_landing');
  const more=c.loadMore(); await c.retryRead(); held.resolve({items:[],nextCursor:null}); await more;
  expect(c.getState().loadingMore).toBe(false);
  await c.loadMore(); expect(reads).toBe(4);
 });
 it('[M3-R2a] changed draft after unknown then erase cannot resurrect the erased save',async()=>{
  const x=await setup(); const real=x.client.act; x.client.act=async a=>{await real(a);throw new Error('lost acknowledgment')};
  const c=createEvidenceController(x.client,{newId:uuid}); await c.open('builtin.normal_landing');
  expect(await c.submitObservation('d',draft(x.journalId))).toBe(false); const id=c.draftIdentity('d')!;
  await x.store.act({action:'erase_observation',operationId:uuid(),observationId:id.observationId,confirm:'erase'});
  x.client.act=real; const write=vi.spyOn(x.client,'act');
  const result=await c.submitObservation('d',draft(x.journalId,'Edited unsaved wording'));
  expect(n(x.engine)).toBe(0); expect(write).not.toHaveBeenCalled(); expect(result).toBe(false);
 });
 it('[M3-R2b] empty history is not proof that a still-pending uncertain write did not land',async()=>{
  const x=await setup(); const real=x.client.act; let delayed: Parameters<EvidenceClient['act']>[0]|undefined;
  x.client.act=async a=>{delayed=a;throw new Error('transport stopped waiting; native work still pending')};
  const c=createEvidenceController(x.client,{newId:uuid}); await c.open('builtin.normal_landing');
  await c.submitObservation('d',draft(x.journalId)); x.client.act=real;
  await c.submitObservation('d',draft(x.journalId,'Different wording'));
  await real(delayed!);
  expect(n(x.engine)).toBe(1);
 });
});

describe.each(['node:sqlite','sql.js'] as const)('review: retained history and paging (%s)',name=>{
 it('[M3-R4] earliest wording remains reachable after 100 later revisions',async()=>{
  const x=await setup(name); const o=observation('builtin.normal_landing',x.journalId,{wording:'Earliest wording'}); await x.store.act(o);
  for(let revision=1;revision<=100;revision++) await x.store.act({action:'edit_observation',operationId:uuid(),observationId:o.observationId,expectedRevision:revision,wording:`Edit ${revision}`,observedOn:'2026-10-01',attribution:'self_report',instructorName:''});
  expect(Number(x.engine.query('SELECT COUNT(*) AS n FROM skill_observation_revisions')[0]!['n'])).toBe(101);
  expect((await x.store.history(o.observationId)).some(r=>r.revision===1&&r.wording==='Earliest wording')).toBe(true);
 });
 it('[M3-R7] a date edit between pages cannot return an already-seen observation twice',async()=>{
  const x=await setup(name); const a=observation('builtin.normal_landing',x.journalId,{observedOn:'2026-10-03'}), b=observation('builtin.normal_landing',x.journalId,{observedOn:'2026-10-02'}), d=observation('builtin.normal_landing',x.journalId,{observedOn:'2026-10-01'});
  for(const o of [a,b,d]) await x.store.act(o);
  const first=await x.store.page({skillId:a.skillId,limit:1}); expect(first.items[0]!.id).toBe(a.observationId);
  await x.store.act({action:'edit_observation',operationId:uuid(),observationId:a.observationId,expectedRevision:1,wording:a.wording,observedOn:'2026-09-30',attribution:a.attribution,instructorName:a.instructorName});
  const next=await x.store.page({skillId:a.skillId,limit:50,cursor:first.nextCursor!}).catch(error=>{if(error?.code==='STALE_CURSOR')return null;throw error;});
  if(next===null)return; // Explicitly refused stale pagination must restart; it cannot append duplicates.
  expect(next.items.some(i=>i.id===a.observationId)).toBe(false);
 });
});

describe.each(['node:sqlite','sql.js'] as const)('review: semantic restore (%s)',name=>{
 for(const entry of cases.cases) it(entry.name,async()=>{
  const x=await setup(name); for(const sql of [...cases.baseline,...entry.sql]) x.engine.exec(sql);
  const verdict=await validateSkillEvidenceState((s,p)=>x.engine.query(s,p),await candidateReference()).then(()=> 'accept',()=> 'refuse');
  expect(verdict).toBe(entry.expect);
 });
});
