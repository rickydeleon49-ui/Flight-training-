# Old-writer backup fixture

`zip-2.4.2.hfdbackup` was generated before upgrading zip, using the
`backup.rs` writer at source revision `ff6d569` with the locked zip 2.4.2.
It contains only synthetic data: a schema-9 SQLite database with the
`audit_payload` value `fictional zip 2.4.2 record`, and
`documents/lesson.txt` containing `fictional crosswind notes` plus a newline.
The writer also included the manifest and SHA-256 integrity metadata.

Generation used a temporary test in `backup::tests`: `scratch`,
`write_database`, `write_document`, then
`write_complete_backup(&root, &destination, "0.6.7")`, followed by
`inspect_archive`. That test passed with zip 2.4.2 before the dependency
change; the generator was then replaced by the permanent read/restore test
`zip_2_4_2_backup_fixture_inspects_verifies_and_restores`.
Do not regenerate these bytes with the current writer: they independently
prove compatibility with the old dependency. Existing older-schema upgrade
tests remain unchanged.

SHA-256: `ebfe7fd4e30d4716afd727e8a17701662c67fd0b10b7f375ec9b839b01ddb6a1`.
