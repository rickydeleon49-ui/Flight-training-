// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { MaterialDetail } from "./MaterialDetail";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as service from "@/services/gemini";
import * as pdf from "@/services/pdf";
import * as documents from "@/services/documents";
let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
let records: service.GeminiJobRecord[];
let calls: ReturnType<typeof vi.spyOn>;
let repos: ReturnType<typeof createRepositories>;
function Ready() { return useAppData().status === "ready" ? h(Routes, null, h(Route, {path:"/study/:materialId",element:h(MaterialDetail)})) : null; }
async function open() {
  await repos.documents.create({id:"kit-material",title:"Synthetic PDF",filePath:"synthetic.pdf",originalFileName:"synthetic.pdf",fileSize:1000});
  render(h(AppDataProvider, null, h(MemoryRouter,{initialEntries:["/study/kit-material"]},h(Ready))));
  await waitFor(()=>expect((screen.getByRole("button",{name:"Make my study kit"}) as HTMLButtonElement).disabled).toBe(false));
}
function parts(): service.GeminiJobRecord[] {
  const aid = {title:"Study kit",summary:"",sections:[{heading:"Lift",body:"Lift supports flight.\n\nSource pages: 1."}],flashcards:[],sourceNotes:"Check the FAA and instructor.",model:"gemini-3.5-flash"};
  return ([ ["guide","study-aid",aid], ["cards","study-aid",{...aid,sections:[],flashcards:[{front:"What supports flight?",back:"Lift.",sourcePage:1}]}], ["questions","practice-test",{title:"Practice questions",model:aid.model,questions:[{question:"What supports flight?",options:["Lift","Drag","Weight"],correctIndex:0,explanation:"Lift acts upwards.",sourcePage:1}]}] ] as const).map(([part,kind,result]) => ({id:`job-aaaaaaaaaaaaaaaaaaaaaaaa#${part}`,kind,materialId:"kit-material",relativePath:"synthetic.pdf",requestId:part === "cards" ? "flashcards:study-kit:1" : "study-kit:1",contentSha256:"",stage:"ready",createdAt:1,updatedAt:1,baseRevision:null,result:result as unknown as service.GeneratedStudyAid,draft:{kind:"study-kit-part"}}));
}
beforeEach(async () => {
  localStorage.clear(); records=[]; db=await createNodeSqliteDatabase(); repos=createRepositories(db);
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  vi.spyOn(service,"getGeminiStatus").mockResolvedValue({configured:true,model:"gemini-3.5-flash",choice:"standard"});
  vi.spyOn(service,"listGeminiJobs").mockImplementation(async()=>records);
  vi.spyOn(service,"watchGeminiJobs").mockResolvedValue(()=>{});
  vi.spyOn(service,"watchGeminiProgress").mockResolvedValue(()=>{});
  vi.spyOn(service,"acknowledgeGeminiJob").mockImplementation(async id=>{records=records.filter(r=>r.id!==id);return true;});
  vi.spyOn(documents,"canHandleFiles").mockReturnValue(true);
  vi.spyOn(documents,"documentExists").mockResolvedValue(true);
  vi.spyOn(pdf,"canSplitPdfs").mockReturnValue(true);
  vi.spyOn(pdf,"inspectPdf").mockResolvedValue({pages:10,maxPagesPerSplit:150});
  calls=vi.spyOn(service,"generateStudyKit").mockImplementation(async()=>{records=parts();return {parts:{},jobId:"job-aaaaaaaaaaaaaaaaaaaaaaaa",checkpointed:true};});
});
afterEach(()=>{cleanup();db.close();vi.restoreAllMocks();});
it("offers one main action with its short line and keeps all single actions",async()=>{
  await open();
  expect(screen.getByText("Makes a basic study guide, flashcards and practice questions in one go. You review everything before it's saved.")).toBeTruthy();
  expect(screen.getByRole("button",{name:"Create study guide"})).toBeTruthy();
  expect(screen.getByRole("button",{name:/Make new cards with Gemini/})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Create practice test"})).toBeTruthy();
});
it("over 150 pages opens the existing chooser without sending",async()=>{
  vi.mocked(pdf.inspectPdf).mockResolvedValue({pages:151,maxPagesPerSplit:150});
  await open();fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  expect(await screen.findByText(/Choose up to 150 pages first/)).toBeTruthy();
  expect(await screen.findByRole("dialog",{name:/chapter/i})).toBeTruthy();
  expect(calls).not.toHaveBeenCalled();
});
it("one request produces three review drafts, saves none automatically, and each part can be saved independently",async()=>{
  await open();fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  const confirm=await screen.findByRole("dialog",{name:"Send this file to Google?"});
  fireEvent.click(within(confirm).getByRole("button",{name:"Make my study kit"}));
  await screen.findByRole("button",{name:"Save the new study guide"});
  expect(calls).toHaveBeenCalledTimes(1);
  expect(await repos.documents.listAiStudySets()).toHaveLength(0);
  expect(await repos.documents.listPracticeTests()).toHaveLength(0);
  expect(screen.getByRole("button",{name:"Save the new flashcards"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Save the new practice test"})).toBeTruthy();
  expect(screen.getByText("Lift supports flight.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Save the new flashcards"}));
  await waitFor(async()=>expect((await repos.documents.listAiStudySets())[0]?.flashcards).toHaveLength(1));
  expect(records).toHaveLength(2);
  // The sibling save changed the shared set. Guide review reads that exact set
  // and preserves the cards, instead of failing stale or replacing them.
  fireEvent.click(await screen.findByRole("button",{name:"Review the new study guide"}));
  await waitFor(()=>expect((screen.getByRole("button",{name:"Save the reviewed study guide"}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button",{name:"Save the reviewed study guide"}));
  await waitFor(async()=>expect((await repos.documents.listAiStudySets())[0]?.sections).toHaveLength(1));
  expect((await repos.documents.listAiStudySets())[0]?.flashcards).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:"Save the new practice test"}));
  await waitFor(async()=>expect(await repos.documents.listPracticeTests()).toHaveLength(1));
  expect(calls).toHaveBeenCalledTimes(1);
  expect(records).toHaveLength(0);
});
it("reopens each part in the same review areas after a restart",async()=>{
  records=parts();await open();
  expect(await screen.findByRole("button",{name:"Save the new study guide"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Save the new flashcards"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Save the new practice test"})).toBeTruthy();
  expect(calls).not.toHaveBeenCalled();
});

it("keeps the paid drafts in the window if the journal checkpoint could not be written", async () => {
  vi.mocked(service.generateStudyKit).mockImplementation(async () => ({
    parts: {guide:{answer:parts()[0]!.result as service.GeneratedStudyAid}, cards:{answer:parts()[1]!.result as service.GeneratedStudyAid}, questions:{answer:parts()[2]!.result as service.GeneratedPracticeTest}},
    checkpointed:false,jobId:null,contentSha256:"",
  }));
  await open(); fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  const confirm=await screen.findByRole("dialog",{name:"Send this file to Google?"});
  fireEvent.click(within(confirm).getByRole("button",{name:"Make my study kit"}));
  await screen.findByRole("button",{name:"Save the new study guide"});
  expect(screen.getAllByText(/Keep this window open until you save or discard it/)).toHaveLength(3);
  expect(await repos.documents.listAiStudySets()).toHaveLength(0);
  expect(screen.getByRole("button",{name:"Save the new practice test"})).toBeTruthy();
});
it("shows a failed part beside the two kept drafts and leaves its single action available",async()=>{
  records=parts(); records[1]={...records[1]!,stage:"failed",result:undefined,error:"The flashcard part could not be used. Redo this part with Make new cards."};
  await open();
  expect(await screen.findByText(/The flashcard part could not be used/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"Save the new study guide"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Save the new practice test"})).toBeTruthy();
  expect((screen.getByRole("button",{name:/Make new cards with Gemini/}) as HTMLButtonElement).disabled).toBe(false);
});

it("cancels the one kit request without saving or automatically resending it", async () => {
  let reject!: (error: unknown) => void;
  vi.mocked(service.generateStudyKit).mockImplementation(() => new Promise((_, no) => { reject = no; }));
  const cancel = vi.spyOn(service,"cancelGeminiJob").mockResolvedValue({cancelled:true,stage:"cancelled"});
  await open(); fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  const confirm=await screen.findByRole("dialog",{name:"Send this file to Google?"});
  fireEvent.click(within(confirm).getByRole("button",{name:"Make my study kit"}));
  await waitFor(()=>expect(calls).toHaveBeenCalledTimes(1));
  expect(screen.getAllByText("Making your study kit…").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  await waitFor(()=>expect(cancel).toHaveBeenCalledTimes(1));
  expect(cancel.mock.calls[0]?.[0].requestId).toBe(calls.mock.calls[0]?.[3]);
  await act(async()=>reject(service.GEMINI_CANCELLED_MESSAGE));
  await screen.findByRole("button",{name:"Try again"});
  expect(await repos.documents.listAiStudySets()).toHaveLength(0);
  expect(calls).toHaveBeenCalledTimes(1);
});

it("keeps an interrupted kit stopped until she explicitly asks to try again",async()=>{
  records=[{...parts()[0]!,id:"job-aaaaaaaaaaaaaaaaaaaaaaaa",kind:"study-kit",stage:"interrupted",result:undefined,draft:undefined}];
  await open();
  expect(await screen.findByText(/Creating a new study kit was interrupted/)).toBeTruthy();
  expect(calls).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Try again"}));
  const confirm=await screen.findByRole("dialog",{name:"Send this file to Google?"});
  expect(calls).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole("button",{name:"Make my study kit"}));
  await screen.findByRole("button",{name:"Save the new flashcards"});
  expect(calls).toHaveBeenCalledTimes(1);
});
