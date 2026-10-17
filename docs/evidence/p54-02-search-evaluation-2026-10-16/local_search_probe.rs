//! Disposable P54-02 measurement only; no application/profile access.
use lopdf::{content::{Content, Operation}, dictionary, Document, Object, Stream};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, time::Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record { id: String, material_id: String, physical_page: Option<u32>, content_sha256: String, title: String, body: String }
fn ms(start: Instant) -> f64 { start.elapsed().as_secs_f64() * 1000.0 }
fn capability() -> Value {
    let db = Connection::open_in_memory().unwrap();
    let version: String = db.query_row("SELECT sqlite_version()", [], |r| r.get(0)).unwrap();
    let mut stmt = db.prepare("PRAGMA compile_options").unwrap();
    let options: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    let created = db.execute_batch("CREATE VIRTUAL TABLE probe USING fts5(body)");
    json!({"runtime":"actual Cargo-locked rusqlite/libsqlite3-sys shared with Tauri SQL plugin", "sqliteVersion":version,"fts5":created.is_ok(),"fts5Error":created.err().map(|e|e.to_string()),"compileOptions":options})
}
fn synthetic_pdf() -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages = doc.new_object_id();
    let font = doc.add_object(dictionary! { "Type"=>"Font", "Subtype"=>"Type1", "BaseFont"=>"Helvetica" });
    let image = doc.add_object(Stream::new(dictionary! {"Type"=>"XObject","Subtype"=>"Image","Width"=>1,"Height"=>1,"ColorSpace"=>"DeviceRGB","BitsPerComponent"=>8},vec![0,0,0]));
    let resources = doc.add_object(dictionary! { "Font"=>dictionary! {"F1"=>font}, "XObject"=>dictionary! {"Im1"=>image} });
    // Logical page order deliberately differs from object-id allocation order.
    let ids = [doc.new_object_id(),doc.new_object_id(),doc.new_object_id()];
    let order = [ids[2],ids[0],ids[1]];
    let large = "crosswind ".repeat(100_000);
    for (number,id) in order.into_iter().enumerate() {
        let operations = if number == 1 { vec![Operation::new("Do",vec![Object::Name(b"Im1".to_vec())])] }
        else { vec![Operation::new("BT",vec![]),Operation::new("Tf",vec![Object::Name(b"F1".to_vec()),12.into()]),Operation::new("Tj",vec![Object::string_literal(if number==0 {"SOURCE_ALPHA_SYNTHETIC".to_string()} else {format!("SOURCE_BETA_SYNTHETIC {large}")})]),Operation::new("ET",vec![])] };
        let content = doc.add_object(Stream::new(dictionary! {},Content {operations}.encode().unwrap()));
        doc.objects.insert(id,dictionary! {"Type"=>"Page","Parent"=>pages,"Contents"=>content}.into());
    }
    doc.objects.insert(pages,dictionary! {"Type"=>"Pages","Kids"=>order.into_iter().map(Object::Reference).collect::<Vec<_>>(),"Count"=>3,"Resources"=>resources,"MediaBox"=>vec![0.into(),0.into(),612.into(),792.into()]}.into());
    let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages});
    doc.trailer.set("Root",catalog);doc.compress();
    let mut bytes=Vec::new();doc.save_to(&mut bytes).unwrap();bytes
}
fn extraction() -> Value {
    let bytes=synthetic_pdf();let sha=hex::encode(Sha256::digest(&bytes));let begin=Instant::now();
    let doc=Document::load_mem(&bytes).unwrap();
    let mut results=Vec::new();
    for (physical,_) in doc.get_pages() {
        let text=doc.extract_text(&[physical]).unwrap();
        if physical==1 {assert!(text.contains("SOURCE_ALPHA_SYNTHETIC"));assert!(!text.contains("SOURCE_BETA"));}
        if physical==2 {assert!(text.trim().is_empty());}
        if physical==3 {assert!(text.contains("SOURCE_BETA_SYNTHETIC"));assert!(text.len()>65_536);}
        results.push(json!({"physicalPage":physical,"contentSha256":sha,"extractedBytes":text.len(),"status":if text.trim().is_empty(){"no_extractable_text"}else if text.len()>65_536{"over_proposed_output_budget_after_allocation"}else{"text"}}));
    }
    json!({"dependency":"lopdf0.42.0 exact existing lock","fixture":"generated Helvetica text/image-only/compressed oversized-text pages; not a real handbook corpus","pdfBytes":bytes.len(),"sha256":sha,"pages":results,"parseAndExtractMs":ms(begin),"malformedRefused":Document::load_mem(b"not a PDF").is_err(),"hardExtractionAllocationBoundProven":false,"reason":"extract_text allocates the complete page text before a caller can enforce an output budget; cancellation/memory isolation need separate proof"})
}
fn count(db:&Connection,query:&str)->usize {db.query_row("SELECT count(*) FROM search WHERE search MATCH ?1",[query],|r|r.get(0)).unwrap()}
fn bench(input:&Path,destination:&Path)->Value {
    assert!(!destination.exists(),"scratch database must be new");
    let begin=Instant::now();let docs:Vec<Record>=serde_json::from_slice(&fs::read(input).unwrap()).unwrap();let load=ms(begin);
    fs::OpenOptions::new().create_new(true).write(true).open(destination).unwrap();
    let mut db=Connection::open(destination).unwrap();let begin=Instant::now();
    db.execute_batch("CREATE VIRTUAL TABLE search USING fts5(record_id UNINDEXED,title,body,material_id UNINDEXED,physical_page UNINDEXED,content_sha256 UNINDEXED)").unwrap();
    {let tx=db.transaction().unwrap();{let mut insert=tx.prepare("INSERT INTO search(record_id,title,body,material_id,physical_page,content_sha256) VALUES (?1,?2,?3,?4,?5,?6)").unwrap();
    for d in &docs {insert.execute(params![d.id,d.title,d.body,d.material_id,d.physical_page,d.content_sha256]).unwrap();}}tx.commit().unwrap();}
    let cold=ms(begin);let mut search=Vec::new();
    for query in ["crosswind","density altitude","metar","café","cafe"] {
        // Quoted literal AND terms, never raw user FTS syntax. Bound parameters.
        let escaped=query.split_whitespace().map(|term|format!("\"{}\"",term.replace('"',"\"\""))).collect::<Vec<_>>().join(" AND ");
        let hits=count(&db,&escaped);let mut samples=Vec::new();let mut last_ids=Vec::new();
        let mut stmt=db.prepare("SELECT record_id,bm25(search) FROM search WHERE search MATCH ?1 ORDER BY bm25(search)").unwrap();
        for _ in 0..15 {let begin=Instant::now();let ids:Vec<(String,f64)>=stmt.query_map([&escaped],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().map(Result::unwrap).collect();assert_eq!(ids.len(),hits);samples.push(ms(begin));last_ids=ids;}
        let mut ids=last_ids.into_iter().map(|(id,_)|id).collect::<Vec<_>>();ids.sort();let digest=hex::encode(Sha256::digest(ids.join("\n").as_bytes()));
        search.push(json!({"query":query,"hits":hits,"idsSha256":digest,"samplesMs":samples}));
    }
    let begin=Instant::now();let prefix=count(&db,"\"crossw\"*");let prefix_ms=ms(begin);
    assert_eq!(count(&db,"uniqueoldmarker"),1);
    db.execute("UPDATE search SET title='Changed synthetic',body='uniquenewmarker',content_sha256=?1 WHERE record_id=?2",params!["b".repeat(64),docs[0].id]).unwrap();
    assert_eq!(count(&db,"uniqueoldmarker"),0);assert_eq!(count(&db,"uniquenewmarker"),1);
    let hash:String=db.query_row("SELECT content_sha256 FROM search WHERE record_id=?1",[&docs[0].id],|r|r.get(0)).unwrap();assert_eq!(hash,"b".repeat(64));
    db.execute("DELETE FROM search WHERE record_id=?1",[&docs[0].id]).unwrap();assert_eq!(count(&db,"uniquenewmarker"),0);
    let d=&docs[0];db.execute("INSERT INTO search(record_id,title,body,material_id,physical_page,content_sha256) VALUES (?1,?2,?3,?4,?5,?6)",params![d.id,d.title,d.body,d.material_id,d.physical_page,d.content_sha256]).unwrap();assert_eq!(count(&db,"uniqueoldmarker"),1);
    let bytes=fs::metadata(destination).unwrap().len();drop(db);
    let reopened=Connection::open(destination).unwrap();assert_eq!(count(&reopened,"uniqueoldmarker"),1);drop(reopened);
    fs::remove_file(destination).unwrap();
    json!({"engine":"actual native SQLite FTS5","buildMode":"Cargo debug; not a release performance claim","records":docs.len(),"corpusLoadMs":load,"coldIndexMs":cold,"persistentDatabaseBytes":bytes,"search":search,"prefix":{"query":"crossw","hits":prefix,"ms":prefix_ms},"fuzzy":"not configured or measured","updateDeleteReopenProof":true})
}
fn main() {
    let args:Vec<String>=std::env::args().collect();
    let result=match args.get(1).map(String::as_str) {Some("capability")=>capability(),Some("extraction")=>extraction(),Some("bench")=>bench(Path::new(&args[2]),Path::new(&args[3])),_=>panic!("capability | extraction | bench CORPUS NEW_SCRATCH_DB")};
    println!("{}",serde_json::to_string_pretty(&result).unwrap());
}
