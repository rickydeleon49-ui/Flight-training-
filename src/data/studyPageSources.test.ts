import {afterEach,describe,it,expect,vi} from "vitest";
vi.mock("sql.js/dist/sql-wasm.wasm?url",()=>({default:`${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`}));
import {createNodeSqliteDatabase,type TestDatabase} from "./testing/nodeSqliteDb";
import {createSqlJsDatabase} from "./sqlJsDb";
import {documentRepository} from "./repositories/documentRepository";
import {cardReviewRepository} from "./repositories/cardReviewRepository";
import {validateApplicationDatabase} from "./practiceStateValidation";
import type {SqlDatabase} from "./db";
import type {StudySetSaveOperation} from "./studySetTransaction";
import {cardSourceFingerprint,readCardPageSource} from "./studyPageSources";
const id=()=>crypto.randomUUID();
const hash="a".repeat(64);
let opened:TestDatabase[]=[];
afterEach(()=>{opened.forEach(d=>d.close());opened=[];vi.unstubAllGlobals();});
async function setup(engine:string) {
 vi.stubGlobal("localStorage",{getItem:()=>null,setItem:()=>{}});
 const db:SqlDatabase=engine==="node" ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
 if(engine==="node") opened.push(db as TestDatabase);
 const docs=documentRepository(db);
 await docs.create({id:"m",title:"Synthetic book"});
 const bid=id();
 await db.execute("INSERT INTO material_bookmarks (id,material_id,page_index,page_label,originating_content_sha256,title,notes,status,created_at,updated_at) VALUES (?,?,3,'iv',?,'Exact title','Exact notes', 'verified','x','x')",[bid,"m",hash]);
 const bookmark={id:bid,materialId:"m",physicalPage:3,pageLabel:"iv",originatingContentSha256:hash,title:"Exact title",notes:"Exact notes",status:"verified" as const,createdAt:"x",updatedAt:"x"};
 const op:StudySetSaveOperation={operationId:id(),materialId:"m",reason:"create",expected:null,next:{title:"Cards",summary:"",summaryOrigin:null,sections:[],flashcards:[{itemId:"card-one",front:bookmark.title,back:bookmark.notes,sourcePage:3,origin:"user"}],sourceNotes:"",provider:"manual",model:"",retired:[]},pageSource:{source:{id:id(),materialId:"m",materialTitle:"Synthetic book",contentSha256:hash,physicalPage:3,printedLabel:"iv"},bookmark,preview:null,itemId:"card-one"}};
 return {db,docs,op};
}
for(const engine of ["node","sql.js"]) describe(`bookmark cards ${engine}`,()=>{
 it("creates a card-only set, binds full retry payload, and appends without changing the bookmark",async()=>{
  const {db,docs,op}=await setup(engine);
  const before=await db.select("SELECT * FROM material_bookmarks");
  expect(await docs.saveStudySet(op)).toEqual({status:"saved"});
  expect(await docs.saveStudySet(op)).toEqual({status:"already_saved"});
  const changed=structuredClone(op);changed.pageSource!.source.printedLabel="v";changed.pageSource!.bookmark.pageLabel="v";
  await expect(docs.saveStudySet(changed)).rejects.toMatchObject({code:"CONFLICT"});
  const read=(await docs.readStudySetForEdit("m"))!;
  expect(read.set.flashcards[0]?.pageSource).toMatchObject({materialTitle:"Synthetic book",physicalPage:3,printedLabel:"iv",contentSha256:hash});
  const {pageSource: _source, ...plain}=op;
  await docs.saveStudySet({...plain,operationId:id(),reason:"edit",expected:read.stored,next:{...op.next!,flashcards:[...op.next!.flashcards,{front:"Next",back:"Answer",sourcePage:null,itemId:"second",origin:"user"}]}});
  expect((await docs.listAiStudySets())[0]?.flashcards).toHaveLength(2);
  expect(await db.select("SELECT * FROM material_bookmarks")).toEqual(before);
  expect(await db.select("SELECT * FROM study_set_save_operations")).toHaveLength(1);
 });
 it("accepts an unparseable preview without replacing the original source hash",async()=>{
  const {docs,op}=await setup(engine);
  op.pageSource!.preview={contentSha256:"b".repeat(64),totalPages:0};
  await docs.saveStudySet(op);
  expect((await docs.listAiStudySets())[0]!.flashcards[0]!.pageSource?.contentSha256).toBe(hash);
 });
 it("rejects incomplete snapshots and unexpected private fields before writing",async()=>{
  const {db,docs,op}=await setup(engine);
  for(const key of ["pageLabel","originatingContentSha256","status","createdAt"]) {
    const invalid=structuredClone(op);delete (invalid.pageSource!.bookmark as unknown as Record<string,unknown>)[key];
    await expect(docs.saveStudySet(invalid)).rejects.toMatchObject({code:"INVALID_ARGUMENT"});
  }
  const invalid=structuredClone(op);Object.assign(invalid.pageSource!.bookmark,{externalPath:"unwanted synthetic field"});
  await expect(docs.saveStudySet(invalid)).rejects.toMatchObject({code:"INVALID_ARGUMENT"});
  expect(await db.select("SELECT * FROM ai_study_sets")).toEqual([]);
 });
 it("refuses empty or oversized card fields without truncation or writes",async()=>{
  const {db,docs,op}=await setup(engine);
  for(const [front,back] of [["","Answer"],["Question",""],["Q".repeat(1001),"Answer"],["Question","A".repeat(2001)]]) {
    const invalid=structuredClone(op);invalid.next!.flashcards[0]!.front=front!;invalid.next!.flashcards[0]!.back=back!;
    await expect(docs.saveStudySet(invalid)).rejects.toMatchObject({code:"INVALID_ARGUMENT"});
  }
  for(const t of ["ai_study_sets","study_page_sources","study_set_save_operations"]) expect(await db.select(`SELECT * FROM ${t}`)).toEqual([]);
 });
 it("refuses stale note and stale set without leaving sources or receipts",async()=>{
  const {db,docs,op}=await setup(engine);
  await db.execute("UPDATE material_bookmarks SET notes='Changed' WHERE material_id='m'");
  await expect(docs.saveStudySet(op)).rejects.toMatchObject({code:"SOURCE_CHANGED"});
  for(const t of ["ai_study_sets","study_page_sources","study_page_source_bindings","study_set_save_operations","study_set_history"]) expect(await db.select(`SELECT * FROM ${t}`)).toEqual([]);
 });
 it("rolls card and history back when source storage fails",async()=>{
  const {db,op}=await setup(engine);
  await db.execute("CREATE TRIGGER reject_page_source BEFORE INSERT ON study_page_sources BEGIN SELECT RAISE(ABORT,'synthetic disk full'); END;");
  await expect(documentRepository(db).saveStudySet(op)).rejects.toMatchObject({code:"STORAGE_ERROR"});
  expect(await db.select("SELECT * FROM ai_study_sets")).toEqual([]);
  expect(await db.select("SELECT * FROM study_set_save_operations")).toEqual([]);
 });
 it("keeps sources through edits, correction lineage, deletion and history restore; changed page detaches",async()=>{
  const {db,docs,op}=await setup(engine);await docs.saveStudySet(op);
  let read=(await docs.readStudySetForEdit("m"))!;
  const next={...op.next!,flashcards:[{...op.next!.flashcards[0]!,itemId:"corrected",replaces:"card-one",front:"Edited",origin:"instructor" as const}]};
  await docs.saveStudySet({operationId:id(),materialId:"m",reason:"correct",expected:read.stored,next});
  read=(await docs.readStudySetForEdit("m"))!;expect(read.set.flashcards[0]?.pageSource?.printedLabel).toBe("iv");
  await docs.saveStudySet({operationId:id(),materialId:"m",reason:"edit",expected:read.stored,next:{...next,flashcards:[{...next.flashcards[0]!,sourcePage:4}]}});
  expect((await docs.listAiStudySets())[0]?.flashcards[0]?.pageSource).toBeUndefined();
  read=(await docs.readStudySetForEdit("m"))!;
  await docs.saveStudySet({operationId:id(),materialId:"m",reason:"restore",expected:read.stored,next:op.next});
  expect((await docs.listAiStudySets())[0]?.flashcards[0]?.pageSource).toBeTruthy();
  await db.execute("DELETE FROM material_bookmarks");
  expect((await docs.listAiStudySets())[0]?.flashcards[0]?.pageSource).toBeTruthy();
  await validateApplicationDatabase((sql,p)=>db.select(sql,p),(sql,p)=>db.select(sql,p));
  await docs.remove("m");
  expect(await db.select("SELECT * FROM study_page_sources")).toEqual([]);
  expect(await db.select("SELECT * FROM study_page_source_bindings")).toEqual([]);
 });
 it("binds identical cards by ordered logical IDs and rejects corrupt authored fingerprints",async()=>{
  const {db,docs,op}=await setup(engine);
  op.next!.flashcards.push({...op.next!.flashcards[0]!,itemId:"two"});
  await docs.saveStudySet(op);
  const reviews=cardReviewRepository(db);const snap=await reviews.getCardReviewSnapshot("m");if(snap.current.status!=="ok")throw Error();
  await reviews.saveAction({action:"rate",operationId:id(),materialId:"m",versionContentHash:snap.current.contentHash,itemId:snap.current.items[0]!.itemId,expectedGeneration:0,expectedRevision:0,rating:"good"});
  const query=(sql:string,p:import("./db").SqlValue[])=>db.select<Record<string,unknown>>(sql,p);
  expect(await readCardPageSource(query,"m","frozen_card",snap.current.items[0]!.itemId,op.next!.flashcards[0]!)).toBeTruthy();
  expect(await readCardPageSource(query,"m","frozen_card",snap.current.items[1]!.itemId,op.next!.flashcards[1]!)).toBeUndefined();
  await db.execute("UPDATE study_page_source_bindings SET content_fingerprint=? WHERE binding_kind='authored_card'",["f".repeat(64)]);
  await expect(validateApplicationDatabase(query,query)).rejects.toThrow("Damaged authored page source");
 });
 it("keeps a source with the exact ordered wording across an interleaved save",async()=>{
  const {db,docs,op}=await setup(engine);await docs.saveStudySet(op);
  const expected=(await docs.readStudySetForEdit("m"))!.stored;
  const card={...op.next!.flashcards[0]!,itemId:"changed",front:"New wording"};
  const sid=id();
  await db.execute("INSERT INTO study_page_sources SELECT ?,source_material_id,material_title,?,physical_page,printed_label,bookmark_id,created_at FROM study_page_sources LIMIT 1",[sid,"b".repeat(64)]);
  await db.execute("INSERT INTO study_page_source_bindings VALUES (?,'m','authored_card','changed',?)",[sid,await cardSourceFingerprint(card)]);
  const original=db.select.bind(db);let interleaved=false;
  db.select=async function<T>(sql:string,params:import("./db").SqlValue[]=[]):Promise<T[]> {
    const rows=await original<T>(sql,params);
    if(!interleaved && sql.startsWith("SELECT flashcards_json FROM ai_study_sets")) {
      interleaved=true;
      await docs.saveStudySet({operationId:id(),materialId:"m",reason:"edit",expected,next:{...op.next!,flashcards:[card]}});
    }
    return rows;
  };
  const snap=await cardReviewRepository(db).getCardReviewSnapshot("m");if(snap.current.status!=="ok")throw Error();
  expect(snap.current.items[0]!.front).toBe("Exact title");
  expect(snap.current.items[0]!.pageSource?.contentSha256).toBe(hash);
  db.select=original;
 });
 it("conflicting current and retained frozen sources are unverified before any new review write",async()=>{
  const {db,docs,op}=await setup(engine);await docs.saveStudySet(op);
  const reviews=cardReviewRepository(db);const snap=await reviews.getCardReviewSnapshot("m");if(snap.current.status!=="ok")throw Error();
  await reviews.saveAction({action:"rate",operationId:id(),materialId:"m",versionContentHash:snap.current.contentHash,itemId:snap.current.items[0]!.itemId,expectedGeneration:0,expectedRevision:0,rating:"good"});
  const sid=id();
  await db.execute("INSERT INTO study_page_sources SELECT ?,source_material_id,material_title,content_sha256,physical_page,'v',bookmark_id,created_at FROM study_page_sources LIMIT 1",[sid]);
  await db.execute("DELETE FROM study_page_source_bindings WHERE binding_kind='authored_card'");
  await db.execute("INSERT INTO study_page_source_bindings VALUES (?,'m','authored_card','card-one',?)",[sid,await cardSourceFingerprint(op.next!.flashcards[0]!)]);
  const after=await reviews.getCardReviewSnapshot("m");if(after.current.status!=="ok")throw Error();
  expect(after.current.items[0]!.pageSource?.contentSha256).toBeNull();
  expect(await db.select("SELECT * FROM card_review_events")).toHaveLength(1);
 });
 it("freezes ordered duplicate cards without changing version hashes, and conflicting sources become unverified",async()=>{
  const {db,docs,op}=await setup(engine);await docs.saveStudySet(op);
  const reviews=cardReviewRepository(db);const snap=await reviews.getCardReviewSnapshot("m");if(snap.current.status!=="ok")throw Error();
  await reviews.saveAction({action:"rate",operationId:id(),materialId:"m",versionContentHash:snap.current.contentHash,itemId:snap.current.items[0]!.itemId,expectedGeneration:0,expectedRevision:0,rating:"good"});
  const frozen=await readCardPageSource((sql,p)=>db.select(sql,p),"m","frozen_card",snap.current.items[0]!.itemId,op.next!.flashcards[0]!);
  expect(frozen?.physicalPage).toBe(3);
  await db.execute("INSERT INTO study_page_sources SELECT ?,source_material_id,material_title,?,physical_page,printed_label,bookmark_id,created_at FROM study_page_sources LIMIT 1",[id(),"b".repeat(64)]);
  await db.execute("INSERT INTO study_page_source_bindings SELECT s.id,'m','frozen_card',?,? FROM study_page_sources s WHERE s.content_sha256=?",[snap.current.items[0]!.itemId,await cardSourceFingerprint(op.next!.flashcards[0]!),"b".repeat(64)]);
  expect((await readCardPageSource((sql,p)=>db.select(sql,p),"m","frozen_card",snap.current.items[0]!.itemId,op.next!.flashcards[0]!))?.contentSha256).toBeNull();
  await validateApplicationDatabase((sql,p)=>db.select(sql,p),(sql,p)=>db.select(sql,p));
 });
});
