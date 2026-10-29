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
        // The restore preview counts current cards whose picture is gone (deleted image or
        // missing file); the frozen version from before the edit is history, not counted.
        let preview=inspect_archive(&target,&archive,"0.6.0").unwrap();
        assert_eq!((info.unavailable_pictures,preview.unavailable_pictures),if state=="edited" {(0,0)} else {(1,1)});
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
    // A healthy backup whose picture bytes are swapped inside the archive (with
    // rebound integrity) is damage, and a restore refuses it.
    let healthy=dest.join("healthy.hfdbackup");
    create_consistent_complete_backup_with_retry(&root,&healthy,"0.6.0").unwrap();
    let mut bytes=PNG.to_vec();bytes[40]^=1;
    rebind_archive_entry(&healthy,"documents/panel.png",&bytes);
    let target=scratch("visual-refusals-target");
    assert!(stage_complete_restore_in(&target,&healthy,"0.6.0").is_err());
    let _=std::fs::remove_dir_all(target);
    // The same change on disk is declared when the backup is made: the backup
    // still completes and the preview says the picture is unavailable.
    std::fs::write(root.join("documents/panel.png"),&bytes).unwrap();
    let info=create_consistent_complete_backup_with_retry(&root,&dest.join("declared.hfdbackup"),"0.6.0").unwrap();
    assert_eq!(info.unavailable_pictures,1);
    assert_eq!(read_manifest(&dest.join("declared.hfdbackup")).detached_at_export,vec!["panel.png".to_string()]);
    std::fs::write(root.join("documents/panel.png"),PNG).unwrap();
    conn.execute("INSERT INTO _sqlx_migrations VALUES (?1)",[crate::CURRENT_SCHEMA_VERSION+1]).unwrap();assert!(verify_application_connection(&conn).unwrap_err().contains("newer"));conn.execute("DELETE FROM _sqlx_migrations WHERE version>?1",[crate::CURRENT_SCHEMA_VERSION]).unwrap();
    conn.execute("DELETE FROM card_item_visual_regions",[]).unwrap();assert!(verify_application_connection(&conn).is_err());
    let _=std::fs::remove_dir_all(root);let _=std::fs::remove_dir_all(dest);
}

fn rebind_archive_entry(archive:&Path,name:&str,bytes:&[u8]){
    rewrite_entry(archive,name,bytes);
    let mut integrity:CompleteBackupIntegrity={let mut zip=ZipArchive::new(File::open(archive).unwrap()).unwrap();serde_json::from_reader(zip.by_name(ARCHIVE_INTEGRITY).unwrap()).unwrap()};
    let entry=integrity.files.iter_mut().find(|e|e.path==name).unwrap();entry.bytes=bytes.len() as u64;entry.sha256=sha256_digest(bytes);
    rewrite_entry(archive,ARCHIVE_INTEGRITY,&serde_json::to_vec(&integrity).unwrap());
}
fn read_manifest(archive:&Path)->CompleteBackupManifest{
    let mut zip=ZipArchive::new(File::open(archive).unwrap()).unwrap();serde_json::from_reader(zip.by_name(ARCHIVE_MANIFEST).unwrap()).unwrap()
}
#[test]
fn picture_material_file_cannot_be_replaced_or_removed_but_metadata_edits_stay(){
    use crate::visual_cards::tests::{library,operation,region,PNG};
    let root=scratch("picture-lock");let conn=library(&root);crate::study_sets::save_study_set_at(&root,&operation(&region())).unwrap();
    std::fs::write(root.join("documents/other.png"),PNG).unwrap();
    for file in [serde_json::Value::Null,serde_json::json!("other.png")] {
        let op:crate::documents::MaterialSaveOperation=serde_json::from_value(serde_json::json!({"mode":"update","id":"image","fields":{"filePath":file}})).unwrap();
        assert_eq!(crate::documents::save_material_operation_at(&root,&op).unwrap_err(),crate::documents::PICTURE_FILE_LOCKED);
    }
    let op:crate::documents::MaterialSaveOperation=serde_json::from_value(serde_json::json!({"mode":"update","id":"image","fields":{"title":"Renamed panel","filePath":"panel.png"}})).unwrap();
    crate::documents::save_material_operation_at(&root,&op).unwrap();
    let row:(String,Option<String>)=conn.query_row("SELECT title,file_path FROM study_materials WHERE id='image'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(row,("Renamed panel".into(),Some("panel.png".into())));
    drop(conn);let _=std::fs::remove_dir_all(root);
}
#[test]
fn picture_material_already_swapped_or_removed_still_backs_up_and_restores(){
    use crate::visual_cards::tests::{library,operation,region,PNG};
    for state in ["removed","replaced"] {
        let root=scratch("picture-broken");let target=scratch("picture-broken-target");let backups=scratch("picture-broken-archive");
        // Two cards crop the same region; one has been rated (frozen binding).
        let conn=library(&root);let mut op=operation(&region());let mut second=op["next"]["flashcards"][0].clone();second["itemId"]=serde_json::json!("cover-2");second["front"]=serde_json::json!("Which label is on top?");op["next"]["flashcards"].as_array_mut().unwrap().push(second);
        crate::study_sets::save_study_set_at(&root,&op).unwrap();crate::visual_cards::tests::rate(&root,&conn,50);
        // The state a 0.6.1/0.6.2 "Remove" or "Choose file" left behind.
        let mut other=PNG.to_vec();other[40]^=1;std::fs::write(root.join("documents/other.png"),&other).unwrap();
        if state=="removed" {conn.execute("UPDATE study_materials SET file_path=NULL WHERE id='image'",[]).unwrap();std::fs::remove_file(root.join("documents/other.png")).unwrap();std::fs::remove_file(root.join("documents/panel.png")).unwrap();}
        else {conn.execute("UPDATE study_materials SET file_path='other.png' WHERE id='image'",[]).unwrap();std::fs::remove_file(root.join("documents/panel.png")).unwrap();}
        let archive=backups.join("broken.hfdbackup");
        let info=create_consistent_complete_backup_with_retry(&root,&archive,"0.6.3").unwrap();
        assert_eq!(info.unavailable_pictures,2,"{state}");
        stage_complete_restore_in(&target,&archive,"0.6.3").unwrap();apply_pending_restore_in(&target).unwrap();
        let restored=Connection::open(target.join(DB_FILES[0])).unwrap();verify_application_connection(&restored).unwrap();
        assert_eq!(restored.query_row("SELECT COUNT(*) FROM visual_card_regions",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        if state=="replaced" {assert_eq!(std::fs::read(target.join("documents/other.png")).unwrap(),other);}
        drop(conn);drop(restored);
        for path in [root,target,backups] {let _=std::fs::remove_dir_all(path);}
    }
}
#[test]
fn picture_reattach_accepts_only_the_recorded_picture(){
    use crate::visual_cards::tests::{library,operation,region,PNG};
    let root=scratch("picture-reattach");let conn=library(&root);crate::study_sets::save_study_set_at(&root,&operation(&region())).unwrap();
    std::fs::remove_file(root.join("documents/panel.png")).unwrap();
    let mut other=PNG.to_vec();other[40]^=1;std::fs::write(root.join("documents/other.png"),&other).unwrap();
    assert_eq!(crate::documents::reattach_unlinked_file_in(&root,"image","other.png").unwrap_err(),crate::documents::PICTURE_FILE_LOCKED);
    std::fs::write(root.join("documents/moved.png"),PNG).unwrap();
    crate::documents::reattach_unlinked_file_in(&root,"image","moved.png").unwrap();
    assert_eq!(conn.query_row("SELECT file_path FROM study_materials WHERE id='image'",[],|r|r.get::<_,String>(0)).unwrap(),"moved.png");
    drop(conn);let _=std::fs::remove_dir_all(root);
}
