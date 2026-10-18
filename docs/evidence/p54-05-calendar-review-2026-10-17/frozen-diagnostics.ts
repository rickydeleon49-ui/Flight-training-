import { describe, expect, it } from 'vitest';
import { makeEvent } from '@/testing/factories';
import { CalendarExportError, exportCalendarEvent } from './calendarExport';
const valid = makeEvent({ id: 'event-A', date: '2026-10-24', startTime: '10:00', endTime: '11:00' });
describe('Independent calendar boundary diagnostics', () => {
 it('cannot inject a calendar property through the stored event identifier', () => {
  const ics=exportCalendarEvent({...valid,id:'event-A\r\nATTENDEE:mailto:other@example.com'});
  expect(ics).not.toContain('\r\nATTENDEE:');
 });
 it.each([' 2026-10-24 ', '2026-10-24\r\n'])('refuses a noncanonical date %j rather than emitting malformed DTSTART', date => {
  expect(()=>exportCalendarEvent({...valid,date})).toThrow(CalendarExportError);
 });
 it('refuses an invalid export timestamp instead of emitting NaN',()=>{
  expect(()=>exportCalendarEvent(valid,{now:new Date(NaN)})).toThrow(CalendarExportError);
 });
 it.each([null,'23:30'])('refuses a generated end beyond the four-digit calendar range, start=%j', startTime=>{
  expect(()=>exportCalendarEvent({...valid,date:'9999-12-31',startTime,endTime:null})).toThrow(CalendarExportError);
 });
});
