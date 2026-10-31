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
async function open(before?: () => Promise<unknown>) {
  await repos.documents.create({id:"kit-material",title:"Synthetic PDF",filePath:"synthetic.pdf",originalFileName:"synthetic.pdf",fileSize:1000});
  await before?.();
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
it("says plainly what to do in each notice: read it, then save or discard it",async()=>{
  records=parts();await open();
  expect((await screen.findAllByText(/Read it below, then save or discard it. Each part is saved separately./)).length).toBe(3);
  expect(screen.queryByText(/Review this part before saving/)).toBeNull();
});
it("with no internet says so before the consent dialog and sends nothing",async()=>{
  await open();
  vi.spyOn(navigator,"onLine","get").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  expect(await screen.findByText("No internet right now. Press Make my study kit again when you're back online.")).toBeTruthy();
  expect(screen.queryByRole("dialog",{name:"Send this file to Google?"})).toBeNull();
  expect(calls).not.toHaveBeenCalled();
});
it("while kit drafts wait, asks her to save or discard them before the consent dialog",async()=>{
  records=parts();await open();
  await screen.findByRole("button",{name:"Save the new study guide"});
  fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  expect(await screen.findByText("Save or discard your study kit drafts first.")).toBeTruthy();
  expect(screen.queryByRole("dialog",{name:"Send this file to Google?"})).toBeNull();
  expect(calls).not.toHaveBeenCalled();
});
it("a kit whose only remaining part failed does not block a new kit",async()=>{
  records=[{...parts()[2]!,stage:"failed",result:undefined,error:"The practice question part could not be used."}];
  await open();
  expect(await screen.findByText(/The practice question part could not be used/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  const confirm=await screen.findByRole("dialog",{name:"Send this file to Google?"});
  fireEvent.click(within(confirm).getByRole("button",{name:"Make my study kit"}));
  await waitFor(()=>expect(calls).toHaveBeenCalledTimes(1));
  await screen.findByRole("button",{name:"Save the new study guide"});
});
it("over 150 pages without the page chooser points to Create study guide",async()=>{
  vi.mocked(pdf.canSplitPdfs).mockReturnValue(false);
  vi.mocked(pdf.inspectPdf).mockResolvedValue({pages:151,maxPagesPerSplit:150});
  await open();fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  expect(await screen.findByText("This PDF is over 150 pages. Use Create study guide, which makes the guide in parts.")).toBeTruthy();
  expect(screen.queryByText(/Use Choose fewer pages to send/)).toBeNull();
  expect(screen.queryByRole("dialog",{name:"Send this file to Google?"})).toBeNull();
  expect(calls).not.toHaveBeenCalled();
});
it("over 150 pages opens the existing chooser without sending",async()=>{
  vi.mocked(pdf.inspectPdf).mockResolvedValue({pages:151,maxPagesPerSplit:150});
  await open();fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  const chooser=await screen.findByRole("dialog",{name:/chapter/i});
  // One plain line in the chooser says what happens next.
  expect(within(chooser).getByText("The study kit reads up to 150 pages. Pick the pages you want — they become their own item in your library, then press Make my study kit there.")).toBeTruthy();
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
  // The sibling save changed the shared set, but she wrote nothing: the guide
  // keeps its plain Save (no review claiming her edits) and keeps the cards.
  expect(screen.queryByRole("button",{name:"Review the new study guide"})).toBeNull();
  expect(screen.queryByText(/items you wrote, corrected or deleted/)).toBeNull();
  fireEvent.click(await screen.findByRole("button",{name:"Save the new study guide"}));
  await waitFor(async()=>expect((await repos.documents.listAiStudySets())[0]?.sections).toHaveLength(1));
  expect(screen.queryByRole("dialog",{name:/Review the new/})).toBeNull();
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
  records=parts(); records[1]={...records[1]!,stage:"failed",result:undefined,error:"The flashcard part could not be used. Redo this part with Make new cards with Gemini."};
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

it("Save all three saves each part through its own save, in order",async()=>{
  records=parts();await open();
  fireEvent.click(await screen.findByRole("button",{name:"Save all three"}));
  await waitFor(()=>expect(records).toHaveLength(0));
  const set=(await repos.documents.listAiStudySets())[0];
  expect(set?.sections).toHaveLength(1);
  expect(set?.flashcards).toHaveLength(1);
  expect(await repos.documents.listPracticeTests()).toHaveLength(1);
  expect(screen.queryByRole("button",{name:"Save all three"})).toBeNull();
});
const savedTest=()=>repos.documents.savePracticeTest({provider:"gemini",sourceMaterialId:"kit-material",title:"Saved practice test",
  questions:[{question:"Saved?",options:["No","Yes"],correctIndex:1,explanation:"Saved.",sourcePage:1}],model:"gemini-3.5-flash"});
it("Save all three keeps the others saved when one part cannot be saved",async()=>{
  // A practice test saved after the kit started: that part cannot replace it.
  records=parts();await open(savedTest);
  fireEvent.click(await screen.findByRole("button",{name:"Save all three"}));
  await waitFor(async()=>expect((await repos.documents.listAiStudySets())[0]?.flashcards).toHaveLength(1));
  expect((await repos.documents.listAiStudySets())[0]?.sections).toHaveLength(1);
  await waitFor(()=>expect(records.map(r=>r.id)).toEqual(["job-aaaaaaaaaaaaaaaaaaaaaaaa#questions"]));
  expect(await screen.findByText(/Something newer was saved/)).toBeTruthy();
  expect((await repos.documents.listPracticeTests())[0]?.title).toBe("Saved practice test");
});
it("Save all three is not offered while a part failed",async()=>{
  records=parts(); records[2]={...records[2]!,stage:"failed",result:undefined,error:"The practice question part could not be used."};
  await open();
  await screen.findByRole("button",{name:"Save the new study guide"});
  expect(screen.queryByRole("button",{name:"Save all three"})).toBeNull();
});
it("holds Start practice test while kit drafts wait, so it is never beside Save",async()=>{
  records=parts();
  await open(async()=>{ await savedTest(); records[2]={...records[2]!,baseRevision:(await repos.documents.listPracticeTests())[0]!.updatedAt}; });
  expect(await screen.findByText("Save or discard your study kit drafts first, then start the practice test.")).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Start practice test"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Save all three"}));
  await waitFor(()=>expect(records).toHaveLength(0));
  expect(await screen.findByRole("button",{name:"Start practice test"})).toBeTruthy();
});
it("the consent dialog keeps Make my study kit as the primary action, last, beside Cancel",async()=>{
  await open();fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  const confirm=await screen.findByRole("dialog",{name:"Send this file to Google?"});
  const footer=confirm.querySelector(".dialog__footer")!;
  const names=[...footer.querySelectorAll("button")].map(b=>b.textContent);
  expect(names).toEqual(["Choose fewer pages to send","Cancel","Make my study kit"]);
  const make=within(confirm).getByRole("button",{name:"Make my study kit"});
  expect(make.className).toContain("button--primary");
  expect(within(confirm).getByRole("button",{name:"Choose fewer pages to send"}).className).toContain("button--secondary");
  expect(within(confirm).getByRole("button",{name:"Cancel"}).className).toContain("button--secondary");
  // Cancel and the real action share one group, so they never wrap apart.
  expect(make.parentElement).toBe(within(confirm).getByRole("button",{name:"Cancel"}).parentElement);
});
it("an earlier draft blocking the kit has a Show me button that focuses it",async()=>{
  const single={...parts()[2]!,id:"job-bbbbbbbbbbbbbbbbbbbbbbbb",requestId:"practice:1",draft:undefined} as service.GeminiJobRecord;
  records=[single];await open();
  await screen.findByRole("button",{name:"Save the new practice test"});
  fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  expect(await screen.findByText("Save or discard the earlier drafts first, then make a study kit.")).toBeTruthy();
  const scroll=vi.fn();
  const target=document.getElementById("material-practice-test")!;
  target.scrollIntoView=scroll;
  fireEvent.click(screen.getByRole("button",{name:"Show me"}));
  await waitFor(()=>expect(document.activeElement).toBe(target));
  expect(scroll).toHaveBeenCalled();
  expect(calls).not.toHaveBeenCalled();
});
it("kit drafts have no Show me button; their own notice says what to do",async()=>{
  records=parts();await open();
  await screen.findByRole("button",{name:"Save the new study guide"});
  fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  await screen.findByText("Save or discard your study kit drafts first.");
  expect(screen.queryByRole("button",{name:"Show me"})).toBeNull();
});
it("the practice questions draft hides answers until Show answers",async()=>{
  records=parts();await open();
  await screen.findByRole("button",{name:"Save the new practice test"});
  expect(screen.queryByText(/\(correct answer\)/)).toBeNull();
  expect(screen.queryByText("Lift acts upwards.")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Show answers"}));
  expect(screen.getByText("Lift (correct answer)")).toBeTruthy();
  expect(screen.getByText("Lift acts upwards.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Hide answers"}));
  expect(screen.queryByText(/\(correct answer\)/)).toBeNull();
});
it("ASK-FINAL 7: a repeat kit press says plainly it replaces saved parts, only when something is saved",async()=>{
  const note="This makes a new kit. When you save, it replaces your saved guide, flashcards or questions — your earlier versions stay in Previous versions.";
  await open();fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  let confirm=await screen.findByRole("dialog",{name:"Send this file to Google?"});
  expect(confirm.textContent).toContain("You review and save each part separately.");
  expect(confirm.textContent).not.toContain(note);
  fireEvent.click(within(confirm).getByRole("button",{name:"Cancel"}));
  cleanup();db.close();db=await createNodeSqliteDatabase();repos=createRepositories(db);
  await open(()=>repos.documents.saveAiStudySet({sourceMaterialId:"kit-material",title:"Saved",summary:"Saved guide",sections:[{heading:"Lift",body:"Lift supports flight."}],flashcards:[],sourceNotes:"",model:"test"}));
  fireEvent.click(screen.getByRole("button",{name:"Make my study kit"}));
  confirm=await screen.findByRole("dialog",{name:"Send this file to Google?"});
  expect(confirm.textContent).toContain(note);
});

it.each(["discard", "save"])("clears the kit refusal after the last draft is %s", async (action) => {
  records=[parts()[0]!]; await open();
  await screen.findByRole("button", {name:"Save the new study guide"});
  fireEvent.click(screen.getByRole("button", {name:"Make my study kit"}));
  expect(await screen.findByText("Save or discard your study kit drafts first.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: action === "discard" ? "Discard it" : "Save the new study guide"}));
  await waitFor(() => expect(records).toHaveLength(0));
  await waitFor(() => expect(screen.queryByText("Save or discard your study kit drafts first.")).toBeNull());
});
it("clears the earlier-draft refusal and Show me after its last draft is discarded", async () => {
  records=[{...parts()[2]!,id:"job-bbbbbbbbbbbbbbbbbbbbbbbb",requestId:"practice:1",draft:undefined}]; await open();
  await screen.findByRole("button", {name:"Save the new practice test"});
  fireEvent.click(screen.getByRole("button", {name:"Make my study kit"}));
  expect(await screen.findByRole("button", {name:"Show me"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Discard it"}));
  await waitFor(() => expect(records).toHaveLength(0));
  await waitFor(() => expect(screen.queryByText("Save or discard the earlier drafts first, then make a study kit.")).toBeNull());
  expect(screen.queryByRole("button", {name:"Show me"})).toBeNull();
});
