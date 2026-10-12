use m3_skills_evidence_native::*;
use rusqlite::Connection;
use serde_json::Value;
#[test]
fn r9_operation_owned_history_requires_its_receipt(){
 let conn=Connection::open_in_memory().unwrap();migrate(&conn,Some(CANDIDATE)).unwrap();
 let fixtures:Value=serde_json::from_str(&std::fs::read_to_string(format!("{}/../fixtures/validation-cases.json",env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
 for sql in fixtures["baseline"].as_array().unwrap(){conn.execute_batch(sql.as_str().unwrap()).unwrap();}
 let refdb=reference().unwrap();verify_schema_14_skill_evidence_semantics(&conn,&refdb).unwrap();
 conn.execute("DELETE FROM skill_evidence_operations WHERE operation_id='00000000-0000-4000-8000-0000000000a2'",[]).unwrap();
 assert!(verify_schema_14_skill_evidence_semantics(&conn,&refdb).is_err(),"missing receipt left its observation history accepted");
}
#[test]
fn control_valid_populated_fixture(){
 let conn=Connection::open_in_memory().unwrap();migrate(&conn,Some(CANDIDATE)).unwrap();
 let fixtures:Value=serde_json::from_str(&std::fs::read_to_string(format!("{}/../fixtures/validation-cases.json",env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
 for sql in fixtures["baseline"].as_array().unwrap(){conn.execute_batch(sql.as_str().unwrap()).unwrap();}
 verify_schema_14_skill_evidence_semantics(&conn,&reference().unwrap()).unwrap();
}
