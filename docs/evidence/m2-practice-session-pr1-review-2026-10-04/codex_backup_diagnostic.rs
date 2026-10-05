#[cfg(test)]
mod codex_m2_review {
    use super::*;
    struct Fixture(PathBuf);
    impl Drop for Fixture {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
    fn fixture() -> (Fixture, Connection) {
        let root=std::env::temp_dir().join(format!("m2-codex-review-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        let conn=Connection::open(root.join("her-flight-deck.db")).unwrap();
        conn.pragma_update(None,"foreign_keys","ON").unwrap();
        for migration in crate::migrations(){conn.execute_batch(migration.sql).unwrap();}
        conn.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(11);INSERT INTO study_materials(id,title,created_at,updated_at) VALUES('mat','Synthetic','2026-10-04','2026-10-04');").unwrap();
        crate::practice_sessions::save_practice_test_at(&root,"mat","Synthetic",r#"[{"question":"Synthetic","options":["A","B"],"correctIndex":0,"explanation":"","sourcePage":null}]"#,"synthetic").unwrap();
        (Fixture(root),conn)
    }
    fn start(f: &Fixture,c: &Connection) -> serde_json::Value {
        let v:String=c.query_row("SELECT id FROM practice_test_versions",[],|r|r.get(0)).unwrap();
        crate::practice_sessions::save_practice_session_at(&f.0,&serde_json::json!({"action":"start_or_resume","operationId":"10000000-0000-4000-8000-000000000001","materialId":"mat","versionId":v})).unwrap()
    }
    fn response(f:&Fixture,c:&Connection,s:&serde_json::Value,revision:i64,op:&str)->serde_json::Value {
        let item:String=c.query_row("SELECT id FROM practice_test_items",[],|r|r.get(0)).unwrap();
        crate::practice_sessions::save_practice_session_at(&f.0,&serde_json::json!({"action":"record_response","operationId":op,"attemptId":s["attemptId"],"itemId":item,"expectedRevision":revision,"selectedIndex":1,"isDontKnow":false})).unwrap()
    }
    #[test] fn valid_schema_11_control_is_accepted(){let(f,_)=fixture();assert!(verify_application_database(&f.0.join("her-flight-deck.db")).is_ok());}
    #[test] fn missing_required_unique_index_is_refused(){let(f,c)=fixture();c.execute_batch("DROP INDEX uq_single_in_progress_attempt").unwrap();assert!(verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),"archive without required single-attempt index was accepted");}
    #[test] fn malformed_receipt_json_is_refused(){let(f,c)=fixture();start(&f,&c);c.execute_batch("UPDATE practice_session_operations SET result_json='not-json'").unwrap();assert!(verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),"archive with malformed receipt JSON was accepted");}
    #[test] fn foreign_key_violation_is_refused(){let(f,c)=fixture();c.pragma_update(None,"foreign_keys","OFF").unwrap();c.execute_batch("UPDATE practice_test_versions SET source_material_id='missing'").unwrap();assert!(verify_application_database(&f.0.join("her-flight-deck.db")).is_err(),"archive with missing source foreign key was accepted");}
    #[test] fn frozen_key_score_is_derived(){let(f,c)=fixture();let s=start(&f,&c);response(&f,&c,&s,0,"10000000-0000-4000-8000-000000000002");c.execute_batch("UPDATE practice_responses SET is_correct=1").unwrap();let result=crate::practice_sessions::save_practice_session_at(&f.0,&serde_json::json!({"action":"complete_attempt","operationId":"10000000-0000-4000-8000-000000000003","attemptId":s["attemptId"],"expectedRevision":1})).unwrap();assert_eq!(result["scorePercent"],serde_json::json!(0.0));}
    #[test] fn no_op_preserves_returned_answered_time(){let(f,c)=fixture();let s=start(&f,&c);let first=response(&f,&c,&s,0,"10000000-0000-4000-8000-000000000002");std::thread::sleep(std::time::Duration::from_millis(20));let second=response(&f,&c,&s,1,"10000000-0000-4000-8000-000000000003");assert_eq!(first["answeredAt"],second["answeredAt"]);}
}
