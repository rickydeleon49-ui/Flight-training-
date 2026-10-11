// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import type { Engine } from '../prototype/candidateEngine';
import type { EvidenceClient } from '../prototype/evidenceController';
import { SkillEvidenceSpecimen } from '../prototype/SkillEvidenceSpecimen';
import { candidateWithDebrief,uuid } from './helpers';
const open:Engine[]=[];
afterEach(()=>{cleanup();for(const e of open.splice(0))e.close()});
async function setup(){const x=await candidateWithDebrief();open.push(x.engine);const client:EvidenceClient={page:i=>x.store.page(i),summary:i=>x.store.summary(i),act:a=>x.store.act(a),history:i=>x.store.history(i)};return {...x,client,skills:await x.store.skills()};}
it('[M3-R3] real React StrictMode replay finishes the live evidence load',async()=>{
 const x=await setup(); render(<StrictMode><SkillEvidenceSpecimen client={x.client} skills={x.skills} debrief={null} newId={uuid} initialSkillId='builtin.normal_landing'/></StrictMode>);
 await waitFor(()=>expect(screen.queryByText('No observations for this skill yet. Add one from a lesson debrief.')).not.toBeNull());
});
it('[M3-R2c] discovering an earlier save does not discard the newly edited unsaved wording',async()=>{
 const x=await setup();const real=x.client.act;x.client.act=async a=>{await real(a);throw new Error('lost acknowledgment')};
 render(<SkillEvidenceSpecimen client={x.client} skills={x.skills} debrief={{journalId:x.journalId,date:'2026-10-01',title:'Pattern work'}} newId={uuid} initialSkillId='builtin.normal_landing'/>);
 await screen.findByText(/No observations for this skill yet/);
 const text=screen.getByLabelText('What was said or noticed') as HTMLTextAreaElement;
 fireEvent.change(text,{target:{value:'Earlier wording'}});fireEvent.click(screen.getByRole('button',{name:'Save observation'}));await screen.findByRole('alert');
 x.client.act=real; fireEvent.change(text,{target:{value:'New unsaved wording'}});fireEvent.click(screen.getByRole('button',{name:'Save observation'}));
 await screen.findByText('Your earlier save had already gone through, so it was kept.');
 await waitFor(()=>expect(text.value).toBe('New unsaved wording'));
});
