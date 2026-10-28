#[test]
fn visual_complete_backup_restores_bytes_frozen_bindings_ratings_and_missing_images() {
    use crate::visual_cards::tests::{library,operation,region,rate,PNG};
    for state in ["edited","missing","deleted"] {
        let root=scratch("visual-source");let target=scratch("visual-target");let backups=scratch("visual-archive");
        let conn=library(&root);let r=region();crate::study_sets::save_study_set_at(&root,&operation(&r)).unwrap();rate(&root,&conn,31);
        let mut next=r.clone();next.rotation=270;next.id=next.hash();
        let mut edit=operation(&next);edit["operationId"]=serde_json::json!("5e700000-0000-4000-8000-000000000008");edit["reason"]=serde_json::json!("edit");edit["expected"]=crate::visual_cards::tests::expected(&conn);
        crate::study_sets::save_study_set_at(&root,&edit).unwrap();rate(&root,&conn,32);
        if state=="missing" {std::fs::remove_file(root.join("documents/panel.png")).unwrap();}
        if state=="deleted" {let staged=crate::documents::stage_delete_document_in(&root,"panel.png").unwrap();conn.execute("DELETE FROM study_materials WHERE id='image'",[]).unwrap();crate::documents::commit_delete_document_in(&root,&staged.staged_id).unwrap();}
        let archive=backups.join("visual.hfdbackup");
        let info=create_consistent_complete_backup_with_retry(&root,&archive,"0.6.0").unwrap();
        assert_eq!(info.missing_documents,if state=="missing" {vec!["panel.png".to_string()]} else {vec![]});
        stage_complete_restore_in(&target,&archive,"0.6.0").unwrap();apply_pending_restore_in(&target).unwrap();
        let restored=Connection::open(target.join(DB_FILES[0])).unwrap();verify_application_connection(&restored).unwrap();
        for(table,n)in [("visual_card_regions",2),("card_item_visual_regions",2),("card_review_events",2),("study_set_history",1)] {assert_eq!(restored.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|r|r.get::<_,i64>(0)).unwrap(),n);}
        if state=="edited" {assert_eq!(std::fs::read(target.join("documents/panel.png")).unwrap(),PNG);}
        else if state=="deleted" {assert!(crate::visual_cards::read_region(&restored,&r.id).unwrap().image_material_id.is_none());}
        let _=std::fs::remove_dir_all(root);let _=std::fs::remove_dir_all(target);let _=std::fs::remove_dir_all(backups);
    }
}
#[test]
fn visual_backup_refuses_swapped_bytes_dangling_frozen_links_and_newer_schema() {
    use crate::visual_cards::tests::{library,operation,region,rate,PNG};
    let root=scratch("visual-refusals");let dest=scratch("visual-refusals-archive");let conn=library(&root);let r=region();crate::study_sets::save_study_set_at(&root,&operation(&r)).unwrap();rate(&root,&conn,40);
    let mut bytes=PNG.to_vec();bytes[40]^=1;std::fs::write(root.join("documents/panel.png"),bytes).unwrap();
    assert!(create_consistent_complete_backup_with_retry(&root,&dest.join("bad.hfdbackup"),"0.6.0").is_err());
    std::fs::write(root.join("documents/panel.png"),PNG).unwrap();
    conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)",[crate::CURRENT_SCHEMA_VERSION+1]).unwrap();assert!(verify_application_connection(&conn).unwrap_err().contains("newer"));conn.execute("DELETE FROM _sqlx_migrations WHERE version>?1",[crate::CURRENT_SCHEMA_VERSION]).unwrap();
    conn.execute("DELETE FROM card_item_visual_regions",[]).unwrap();assert!(verify_application_connection(&conn).is_err());
    let _=std::fs::remove_dir_all(root);let _=std::fs::remove_dir_all(dest);
}
