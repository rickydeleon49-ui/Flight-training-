//! Frozen independent semantic restore diagnostics, plus valid controls.
use m3_skills_evidence_native::*;
use rusqlite::Connection;
use serde_json::Value;
fn run(index: usize) {
 let path=format!("{}/../fixtures/review-validation-cases.json",env!("CARGO_MANIFEST_DIR"));
 let fixtures:Value=serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
 let case=&fixtures["cases"][index];let conn=Connection::open_in_memory().unwrap();
 migrate(&conn,Some(CANDIDATE)).unwrap();
 for sql in fixtures["baseline"].as_array().unwrap().iter().chain(case["sql"].as_array().unwrap().iter()){conn.execute_batch(sql.as_str().unwrap()).unwrap();}
 let verdict=if verify_schema_14_skill_evidence_semantics(&conn,&reference().unwrap()).is_ok(){"accept"}else{"refuse"};
 assert_eq!(verdict,case["expect"].as_str().unwrap(),"{}",case["name"]);
}
#[test]fn r5_foreign_receipt_result(){run(0)}
#[test]fn r6a_later_builtin_relabel(){run(1)}
#[test]fn r6b_normalized_active_label_collision(){run(2)}
#[test]fn control_valid_candidate(){run(3)}
#[test]fn control_builtin_retirement(){run(4)}
