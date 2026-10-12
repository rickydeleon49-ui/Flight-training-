import { afterEach, describe, expect, it } from 'vitest';
import type { Engine } from '../prototype/candidateEngine';
import { createEvidenceController, type EvidenceClient } from '../prototype/evidenceController';
import { candidateWithDebrief, observation, uuid } from './helpers';
const engines:Engine[]=[];
afterEach(()=>{for(const e of engines.splice(0))e.close()});
async function setup(name:'node:sqlite'|'sql.js'='node:sqlite'){const x=await candidateWithDebrief(name);engines.push(x.engine);const client:EvidenceClient={page:i=>x.store.page(i),summary:i=>x.store.summary(i),act:a=>x.store.act(a),history:i=>x.store.history(i)};return {...x,client};}
describe.each(['node:sqlite','sql.js'] as const)('remaining receipt ownership (%s)',name=>{
 it('[M3-R9] receipt removal cannot leave an accepted operation-owned history orphan',async()=>{
  const x=await setup(name),o=observation('builtin.normal_landing',x.journalId);await x.store.act(o);
  await x.store.validate();x.engine.run('DELETE FROM skill_evidence_operations WHERE operation_id=?',[o.operationId]);
  await expect(x.store.validate()).rejects.toThrow();
 });
});
it('[M3-R10] confirmed erased history discards loaded text and cursor',async()=>{
 const x=await setup();const o=observation('builtin.normal_landing',x.journalId,{wording:'Private history wording'});await x.store.act(o);
 await x.store.act({action:'edit_observation',operationId:uuid(),observationId:o.observationId,expectedRevision:1,wording:'Latest private wording',observedOn:o.observedOn,attribution:o.attribution,instructorName:o.instructorName});
 const c=createEvidenceController(x.client,{newId:uuid,historyPageSize:1});await c.open(o.skillId);await c.openHistory(o.observationId);
 expect(c.getState().history!.items).toHaveLength(1);expect(c.getState().history!.nextCursor).not.toBeNull();
 await x.store.act({action:'erase_observation',operationId:uuid(),observationId:o.observationId,confirm:'erase'});
 await c.loadOlderHistory();expect(c.getState().history!.error).toBe('This observation was erased.');
 expect(c.getState().history!.items).toEqual([]);expect(c.getState().history!.nextCursor).toBeNull();
 expect(c.getState().items.some(i=>i.id===o.observationId)).toBe(false);
});
it('[control] a temporary older-history read error preserves loaded history for retry',async()=>{
 const x=await setup(),o=observation('builtin.normal_landing',x.journalId);await x.store.act(o);
 await x.store.act({action:'edit_observation',operationId:uuid(),observationId:o.observationId,expectedRevision:1,wording:'Latest safe wording',observedOn:o.observedOn,attribution:o.attribution,instructorName:o.instructorName});
 const c=createEvidenceController(x.client,{newId:uuid,historyPageSize:1});await c.open(o.skillId);await c.openHistory(o.observationId);
 const old=c.getState().history!;x.client.history=()=>Promise.reject(new Error('temporary read outage'));await c.loadOlderHistory();
 expect(c.getState().history!.items).toEqual(old.items);expect(c.getState().history!.nextCursor).toBe(old.nextCursor);
});
