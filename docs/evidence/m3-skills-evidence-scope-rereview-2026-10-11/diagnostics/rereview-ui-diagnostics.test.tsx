// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it } from 'vitest';
import type { Engine } from '../prototype/candidateEngine';
import type { EvidenceClient } from '../prototype/evidenceController';
import { SkillEvidenceSpecimen } from '../prototype/SkillEvidenceSpecimen';
import { candidateWithDebrief,uuid } from './helpers';
const engines:Engine[]=[];afterEach(()=>{cleanup();for(const e of engines.splice(0))e.close()});
describe.each(['date','attribution','instructor name'] as const)('whole draft acknowledgment (%s)',field=>{
 it('[M3-R8] changed metadata while saving preserves the unsaved complete draft',async()=>{
  const x=await candidateWithDebrief();engines.push(x.engine);let release!:()=>void;const gate=new Promise<void>(r=>{release=r});
  const client:EvidenceClient={page:i=>x.store.page(i),summary:i=>x.store.summary(i),act:async a=>{await gate;return x.store.act(a)},history:i=>x.store.history(i)};
  render(<SkillEvidenceSpecimen client={client} skills={await x.store.skills()} debrief={{journalId:x.journalId,date:'2026-10-01',title:'Pattern work'}} newId={uuid} initialSkillId='builtin.normal_landing'/>);
  await screen.findByText(/No observations for this skill yet/);
  const text=screen.getByLabelText('What was said or noticed') as HTMLTextAreaElement;
  fireEvent.change(text,{target:{value:'Keep the complete draft'}});fireEvent.click(screen.getByRole('button',{name:'Save observation'}));
  if(field==='date')fireEvent.change(screen.getByLabelText('Date observed'),{target:{value:'2026-10-02'}});
  if(field==='attribution')fireEvent.click(screen.getByLabelText(/Me \(my own observation\)/));
  if(field==='instructor name')fireEvent.change(screen.getByLabelText('Instructor name (optional)'),{target:{value:'Different instructor'}});
  await act(async()=>{release()});await screen.findByText('Saved.');
  await waitFor(()=>expect(text.value).toBe('Keep the complete draft'));
  expect(screen.getByRole('button',{name:'Replace the saved wording with this'})).toBeTruthy();
 });
});
