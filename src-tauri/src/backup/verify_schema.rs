//! Schema and semantic verification of application databases.

use super::*;

pub(super) fn normalize_sql(sql: &str) -> String {
    let mut clean = String::new();
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '-' && i + 1 < chars.len() && chars[i + 1] == '-' {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else {
            clean.push(chars[i]);
            i += 1;
        }
    }
    clean
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .to_ascii_lowercase()
}

pub(super) fn is_valid_uuid_v4(uuid_str: &str) -> bool {
    let bytes = uuid_str.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, &b) in bytes.iter().enumerate() {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            if b != b'-' {
                return false;
            }
        } else if i == 14 {
            if b != b'4' {
                return false;
            }
        } else if i == 19 {
            if !matches!(b, b'8' | b'9' | b'a' | b'b' | b'A' | b'B') {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

/// One foreign key: parent table, ordered (child, parent) column pairs, and
/// its ON UPDATE / ON DELETE / MATCH actions.
pub(super) type ForeignKeyShape = (
    String,
    Vec<(String, Option<String>)>,
    String,
    String,
    String,
);

/// A table's foreign keys in a comparable form, independent of declaration
/// order and identifier case.
pub(super) fn foreign_key_shapes(
    connection: &Connection,
    table: &str,
) -> Result<Vec<ForeignKeyShape>, String> {
    let mut stmt = connection
        .prepare(&format!(
            "SELECT id, \"table\", \"from\", \"to\", on_update, on_delete, \"match\"
             FROM pragma_foreign_key_list('{table}') ORDER BY id, seq"
        ))
        .map_err(|e| format!("Could not read foreign keys for {table}: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| format!("Could not query foreign keys for {table}: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not collect foreign keys for {table}: {e}"))?;
    let mut grouped: std::collections::BTreeMap<i64, ForeignKeyShape> =
        std::collections::BTreeMap::new();
    for (id, parent, from, to, on_update, on_delete, matching) in rows {
        let entry = grouped.entry(id).or_insert_with(|| {
            (
                parent.to_ascii_lowercase(),
                Vec::new(),
                on_update.to_ascii_uppercase(),
                on_delete.to_ascii_uppercase(),
                matching.to_ascii_uppercase(),
            )
        });
        entry.1.push((
            from.to_ascii_lowercase(),
            to.map(|column| column.to_ascii_lowercase()),
        ));
    }
    let mut shapes: Vec<ForeignKeyShape> = grouped.into_values().collect();
    shapes.sort();
    Ok(shapes)
}

/// The stored CREATE statement of a table.
pub(super) fn table_sql(connection: &Connection, table: &str) -> Result<String, String> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |r| r.get(0),
        )
        .map_err(|e| format!("Could not read the definition of {table}: {e}"))
}

/// The CHECK constraints of a CREATE TABLE statement, bounded to their
/// expressions with whitespace and identifier quoting removed and sorted, so
/// equivalent formatting compares equal while a missing or altered check does
/// not.
pub(super) fn check_constraints(sql: &str) -> Vec<String> {
    let chars: Vec<char> = normalize_sql(sql).chars().collect();
    let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut checks = Vec::new();
    let mut in_quote = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' {
            in_quote = !in_quote;
            i += 1;
            continue;
        }
        let at_check = !in_quote
            && chars[i..].starts_with(&['c', 'h', 'e', 'c', 'k'])
            && (i == 0 || !is_word(chars[i - 1]))
            && !chars.get(i + 5).is_some_and(|next| is_word(*next));
        if !at_check {
            i += 1;
            continue;
        }
        let mut j = i + 5;
        while chars.get(j) == Some(&' ') {
            j += 1;
        }
        if chars.get(j) != Some(&'(') {
            i += 5;
            continue;
        }
        let (mut depth, mut quoted, mut expression) = (0usize, false, String::new());
        while j < chars.len() {
            let d = chars[j];
            if d == '\'' {
                quoted = !quoted;
            } else if !quoted && d == '(' {
                depth += 1;
            } else if !quoted && d == ')' {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            if depth > 0 && !(depth == 1 && d == '(' && expression.is_empty()) {
                expression.push(d);
            }
            j += 1;
        }
        checks.push(
            expression
                .chars()
                .filter(|c| !c.is_whitespace() && *c != '"' && *c != '`')
                .collect(),
        );
        i = j + 1;
    }
    checks.sort();
    checks
}

pub(super) fn get_reference_schema_connection() -> Result<Connection, String> {
    get_reference_schema_connection_through(crate::CURRENT_SCHEMA_VERSION)
}

/// The reference schema as of one migration, for a contract a later
/// migration extended (0016 added `material_bookmarks.quote`), so a
/// database restored from an older backup is checked against its own version.
pub(super) fn get_reference_schema_connection_through(version: i64) -> Result<Connection, String> {
    let ref_conn = Connection::open_in_memory()
        .map_err(|e| format!("Could not open in-memory reference DB: {e}"))?;
    ref_conn
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Could not enable foreign keys on reference DB: {e}"))?;
    for m in crate::migrations()
        .into_iter()
        .filter(|m| m.version <= version)
    {
        ref_conn
            .execute_batch(m.sql)
            .map_err(|e| format!("Could not apply migrations to reference DB: {e}"))?;
    }
    Ok(ref_conn)
}

pub(crate) fn verify_application_database(path: &Path) -> Result<(), String> {
    verify_sqlite_file(path)?;
    // RUSTSEC-2026-0459: a mismatched -wal must be refused before SQLite opens it.
    crate::sqlite_guard::check_wal_pair(path)?;
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Could not open the database in that backup: {e}"))?;
    // `rusqlite` opens with no busy timeout of its own — unlike the app's
    // main connection pool, which gets one from its own driver by default —
    // so without this, a lock briefly held by an ordinary write elsewhere
    // (an autosave, a split saving its parts) fails this check immediately
    // instead of just waiting the moment out. Checking a live database, not
    // only a staged one, is exactly the case this matters for.
    let _ = connection.busy_timeout(BUSY_TIMEOUT);
    verify_application_connection(&connection)
}

/// The checks of `verify_application_database` on an already-open
/// connection. Initialization runs them on its own open transaction, so they
/// see the pending conversion before it commits.
pub(crate) fn verify_application_connection(connection: &Connection) -> Result<(), String> {
    verify_application_connection_with_ceiling(connection, crate::CURRENT_SCHEMA_VERSION)
}
pub(super) fn verify_application_connection_with_ceiling(
    connection: &Connection,
    supported: i64,
) -> Result<(), String> {
    let quick_check: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| format!("Could not check the database in that backup: {e}"))?;
    if quick_check != "ok" {
        return Err("The database in that backup is damaged or incomplete.".to_string());
    }

    for table in ["settings", "study_materials"] {
        let present: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .map_err(|e| format!("Could not inspect the database schema: {e}"))?;
        if present != 1 {
            return Err(format!(
                "That backup does not contain a Flight Deck database (missing {table})."
            ));
        }
    }

    let newest_migration = newest_migration_version(connection)?;
    if newest_migration > supported {
        return Err(
            "That backup was created by a newer database format. Update the app first.".to_string(),
        );
    }
    verify_practice_acs_tasks(connection, newest_migration >= 28)?;
    if newest_migration >= 11 {
        verify_schema_11_semantics(connection)?;
    }
    if newest_migration >= 12 {
        verify_schema_12_card_semantics(connection)?;
    }
    if newest_migration >= 13 {
        verify_schema_13_lineage_semantics(connection)?;
    }
    if newest_migration >= 14 {
        verify_schema_14_skill_evidence_semantics(connection)?;
    }
    if newest_migration >= 15 {
        verify_schema_15_navigation_semantics(connection)?;
    }
    if newest_migration >= 16 {
        verify_schema_16_manual_study_semantics(connection)?;
    }
    if newest_migration >= 17 {
        verify_schema_17_practice_authoring_semantics(connection)?;
    }
    if newest_migration >= 18 {
        verify_schema_18_pdf_kit_semantics(connection)?;
    }
    if newest_migration >= 19 {
        verify_schema_19_study_receipts(connection)?;
    }
    if newest_migration >= 24 {
        verify_schema_24_page_sources(connection)?;
    }
    if newest_migration >= 25 {
        verify_schema_25_oral_scenarios(connection)?;
    }
    if newest_migration >= 29 {
        verify_schema_29_video_links(connection)?;
    }
    if newest_migration >= 30 {
        verify_schema_30_student_pilot_steps(connection)?;
    }
    if newest_migration >= 31 {
        verify_schema_31_faa_downloads(connection)?;
    }
    if newest_migration >= 32 {
        verify_schema_32_oral_answers(connection)?;
    }
    if newest_migration >= 35 {
        verify_schema_35_fold_semantics(connection)?;
    }
    if newest_migration >= 36 {
        verify_schema_36_kit_queue(connection)?;
    }
    if newest_migration >= 37 {
        verify_schema_37_study_packs(connection)?;
    }
    if newest_migration >= 38 {
        verify_schema_38_library_folders(connection)?;
    }
    if newest_migration >= 39 {
        verify_schema_39_practice_unchecked(connection)?;
    }
    if newest_migration >= 42 {
        verify_schema_42_timed_attempts(connection)?;
    }
    if newest_migration >= 27 {
        verify_schema_27_faa_references(connection)?;
    }
    if newest_migration >= 26 {
        verify_schema_26_visual_cards(connection)?;
    }
    if newest_migration >= 20 {
        verify_schema_20_homework_semantics(connection)?;
    }
    Ok(())
}

/// Schema 20 homework contract; TS twin: `validateHomeworkState`.
/// All three engines exercise the shared homework fixtures after reopening.
pub(crate) fn verify_schema_20_homework_semantics(connection: &Connection) -> Result<(), String> {
    let version = newest_migration_version(connection)?.min(crate::CURRENT_SCHEMA_VERSION);
    let reference = get_reference_schema_connection_through(version)?;
    for table in [
        "homework_assignments",
        "homework_activities",
        "homework_runs",
        "homework_operations",
        "homework_history",
    ] {
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Homework tables do not match the migration contract.".into());
        }
    }
    for object in crate::homework::rows(&reference, "SELECT type,name,sql FROM sqlite_master WHERE tbl_name LIKE 'homework_%' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name", &[])? {
        let actual = crate::homework::rows(connection, "SELECT sql FROM sqlite_master WHERE type=? AND name=?", &[&object["type"].as_str().unwrap(), &object["name"].as_str().unwrap()])?;
        if actual.first().and_then(|v|v["sql"].as_str()).map(normalize_sql) != object["sql"].as_str().map(normalize_sql) {
            return Err("Homework indexes or history guards are missing.".into());
        }
    }
    crate::homework::validate_database(connection)
}

/// Older backups have no side table and remain untagged after upgrade.
pub(super) fn verify_practice_acs_tasks(
    connection: &Connection,
    required: bool,
) -> Result<(), String> {
    let present = crate::acs_tasks::table_exists(connection).map_err(|e| e.to_string())?;
    if !present {
        return if required {
            Err("Missing practice ACS task table.".into())
        } else {
            Ok(())
        };
    }
    let reference = get_reference_schema_connection()?;
    let table = "practice_item_acs_tasks";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || m3_count(
            connection,
            "SELECT COUNT(*) FROM pragma_foreign_key_check('practice_item_acs_tasks')",
            &[],
        )? != 0
    {
        return Err("Damaged practice ACS task table.".into());
    }
    // Tag values are NOT checked against today's catalog: a future ACS
    // edition must never make an older backup unrestorable. Unknown tags
    // simply read as untagged.
    Ok(())
}

pub(crate) fn verify_schema_29_video_links(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "material_video_links";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || m3_index_shape(connection, table, "idx_material_video_links_material")?
            != m3_index_shape(&reference, table, "idx_material_video_links_material")?
        || m3_count(
            connection,
            "SELECT COUNT(*) FROM pragma_foreign_key_check('material_video_links')",
            &[],
        )? != 0
    {
        return Err("Damaged video link schema.".into());
    }
    Ok(())
}

pub(crate) fn verify_schema_30_student_pilot_steps(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "student_pilot_steps";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
    {
        return Err("Damaged student pilot steps schema.".into());
    }
    Ok(())
}

pub(crate) fn verify_schema_31_faa_downloads(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "faa_downloads";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
    {
        return Err("Damaged FAA downloads schema.".into());
    }
    Ok(())
}

/// ORAL-01d: her finished oral answers, exactly as migrated, then the
/// version, ticks and timestamps checks in `oral_scenarios::validate_answers`.
pub(crate) fn verify_schema_32_oral_answers(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "oral_answers";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        || m3_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
    {
        return Err("Damaged oral answers schema.".into());
    }
    crate::oral_scenarios::validate_answers(connection)
}

/// SOURCE-01b: the local study-kit queue, exactly as migrated. It holds ids,
/// checksums and status only, and is not part of the sync ledger.
pub(crate) fn verify_schema_36_kit_queue(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["kit_queue", "kit_queue_item"] {
        let present = card_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )?;
        if present != 1 {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Damaged study kit queue schema.".into());
        }
    }
    // At most one open queue: the partial unique index, exactly as migrated.
    let index =
        |c: &Connection| card_index_sql(c, "kit_queue_one_open").map(|sql| normalize_sql(&sql));
    if index(connection).is_none() || index(connection) != index(&reference) {
        return Err("Damaged study kit queue schema.".into());
    }
    Ok(())
}

/// PACK-01: the study-pack provenance tables, exactly as migrated, then their
/// row rules (the TS twin is `validateStudyPackState`).
pub(crate) fn verify_schema_37_study_packs(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let damaged = || "Damaged study pack provenance.".to_string();
    for table in ["study_pack_imports", "study_pack_items", "study_pack_acks"] {
        let present = card_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )?;
        if present != 1 {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err(damaged());
        }
    }
    for index in [
        "idx_study_pack_items_identity",
        "idx_study_pack_items_revision",
        "idx_study_pack_items_file",
        "idx_study_pack_items_added",
    ] {
        let sql = |c: &Connection| card_index_sql(c, index).map(|sql| normalize_sql(&sql));
        if sql(connection).is_none() || sql(connection) != sql(&reference) {
            return Err(damaged());
        }
    }
    let bad = |sql: &str| -> Result<bool, String> { Ok(m3_count(connection, sql, &[])? != 0) };
    if bad("SELECT COUNT(*) FROM study_pack_imports
            WHERE added < 0 OR skipped < 0 OR new_versions < 0 OR readded < 0
               OR cards_left_out < 0 OR cards_left_out_removed < 0
               OR cards_left_out_removed > cards_left_out
               OR added_guides < 0 OR added_documents < 0 OR added_pictures < 0
               OR added_practice < 0
               OR added_guides > added OR added_documents > added
               OR added_pictures > added OR added_practice > added
               OR added < new_versions + readded + added_pictures
               OR length(committed_at) != 24
               OR typeof(added) != 'integer' OR typeof(skipped) != 'integer'")?
        || bad("SELECT COUNT(*) FROM study_pack_items i
                WHERE i.link NOT IN ('added', 'alias')
                   OR i.kind NOT IN ('document', 'picture', 'guide')
                   OR (i.kind = 'guide' AND i.file_sha256 IS NOT NULL)
                   OR (i.kind != 'guide' AND i.file_sha256 IS NULL)
                   OR length(i.revision) != 64 OR i.revision GLOB '*[^0-9a-f]*'
                   OR length(i.imported_at) != 24
                   OR NOT EXISTS (SELECT 1 FROM study_pack_imports r WHERE r.operation_id = i.operation_id)
                   OR (i.material_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM study_materials m WHERE m.id = i.material_id))")?
        || bad("SELECT COUNT(*) FROM (SELECT material_id FROM study_pack_items
                WHERE link = 'added' AND material_id IS NOT NULL
                GROUP BY material_id HAVING COUNT(*) > 1)")?
        || bad("SELECT COUNT(*) FROM study_pack_acks a
                WHERE NOT EXISTS (SELECT 1 FROM study_pack_imports r WHERE r.operation_id = a.operation_id)")?
    {
        return Err(damaged());
    }
    Ok(())
}

/// LIBRARY-ORG-01: her own library folders and placements, exactly as migrated.
pub(crate) fn verify_schema_38_library_folders(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["library_folders", "library_placements"] {
        let present = card_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )?;
        if present != 1 {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Damaged library folders schema.".into());
        }
    }
    if check_constraints(&table_sql(connection, "library_folders")?)
        != check_constraints(&table_sql(&reference, "library_folders")?)
        || m3_index_shape(
            connection,
            "library_placements",
            "idx_library_placements_folder",
        )? != m3_index_shape(
            &reference,
            "library_placements",
            "idx_library_placements_folder",
        )?
    {
        return Err("Damaged library folders schema.".into());
    }
    Ok(())
}

/// BL-21: `practice_test_items.unchecked` exactly as migrated (INTEGER NOT NULL DEFAULT 0,
/// only 0 or 1). A hand-edited or damaged value fails the backup instead of loading.
pub(crate) fn verify_schema_39_practice_unchecked(connection: &Connection) -> Result<(), String> {
    let damaged = || "Damaged practice question check flag.".to_string();
    let found: Option<(String, i64, Option<String>)> = connection
        .query_row(
            "SELECT type, [notnull], dflt_value FROM pragma_table_info('practice_test_items') WHERE name = 'unchecked'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to read practice_test_items columns: {e}"))?;
    let Some((kind, notnull, default)) = found else {
        return Err("Table practice_test_items missing required column: unchecked".to_string());
    };
    if !kind.eq_ignore_ascii_case("INTEGER") || notnull != 1 || default.as_deref() != Some("0") {
        return Err(damaged());
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM practice_test_items WHERE unchecked NOT IN (0, 1)",
        &[],
    )? != 0
    {
        return Err(damaged());
    }
    Ok(())
}

/// BL-106: the three timed-attempt columns on `practice_attempts` exactly as migrated
/// (nullable INTEGER, no default). Values must be whole numbers or NULL.
pub(crate) fn verify_schema_42_timed_attempts(connection: &Connection) -> Result<(), String> {
    for column in [
        "timed_started_ms",
        "timed_deadline_ms",
        "timed_seconds_used",
    ] {
        let found: Option<(String, i64)> = connection
            .query_row(
                "SELECT type, [notnull] FROM pragma_table_info('practice_attempts') WHERE name = ?1",
                [column],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to read practice_attempts columns: {e}"))?;
        let Some((kind, notnull)) = found else {
            return Err(format!(
                "Table practice_attempts missing required column: {column}"
            ));
        };
        if !kind.eq_ignore_ascii_case("INTEGER") || notnull != 0 {
            return Err("Damaged practice timer record.".to_string());
        }
        let bad = m3_count(
            connection,
            &format!(
                "SELECT COUNT(*) FROM practice_attempts WHERE {column} IS NOT NULL AND typeof({column}) <> 'integer'"
            ),
            &[],
        )?;
        if bad != 0 {
            return Err("Damaged practice timer record.".to_string());
        }
    }
    Ok(())
}

/// CARRY-3DEV: the local fold ledger `card_review_event_folds`, exactly as
/// migrated, then its row rules. A fold is never counted, so it has no receipt
/// rule. It is gated on schema 35 (not part of `CARD_TABLES`, which a
/// schema-34 backup must still pass).
pub(crate) fn verify_schema_35_fold_semantics(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "card_review_event_folds";
    let present = card_count(
        connection,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        &[&table],
    )?;
    if present != 1 {
        return Err(format!("The database is missing required table: {table}"));
    }
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
    {
        return Err("Damaged card fold ledger schema.".into());
    }
    let mut statement = connection
        .prepare(
            "SELECT f.id, f.reviewed_at, f.rating, f.generation,
                    (SELECT COUNT(*) FROM card_items i WHERE i.id = f.item_id),
                    COALESCE((SELECT g.generation FROM card_review_generations g
                              WHERE g.source_material_id = v.source_material_id), 0),
                    0
             FROM card_review_event_folds f
             LEFT JOIN card_items it ON it.id = f.item_id
             LEFT JOIN card_versions v ON v.id = it.version_id",
        )
        .map_err(|e| format!("Could not read the card fold ledger: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| format!("Could not read the card fold ledger: {e}"))?;
    for row in rows {
        // A fold id that is also a live event is not refused: the runtime
        // (`load_links`) ignores such a row, the live event always wins, and
        // nothing is counted from a fold, so it can hide no data. The startup
        // sweep deletes it.
        let (id, reviewed_at, rating, generation, item_rows, current, _) =
            row.map_err(|e| format!("Could not read the card fold ledger: {e}"))?;
        let owner = format!("Card fold {id}");
        if !is_valid_uuid_v4(&id) || id.bytes().any(|b| b.is_ascii_uppercase()) {
            return Err(format!("{owner} has an invalid id."));
        }
        card_timestamp(&reviewed_at, &owner)?;
        if !["again", "hard", "good", "easy"].contains(&rating.as_str()) {
            return Err(format!("{owner} has an unknown rating."));
        }
        if item_rows != 1 {
            return Err(format!("{owner} names a card that does not exist."));
        }
        if generation > current {
            return Err(format!("{owner} is from a future generation."));
        }
    }
    verify_pending_claims(connection, &reference)
}

/// CARRY-3DEV: `card_version_pending_claims` (device-local sync state, carried
/// with the backup like `sync_applied`/`sync_row_meta`): shape, then row rules.
pub(super) fn verify_pending_claims(
    connection: &Connection,
    reference: &Connection,
) -> Result<(), String> {
    let table = "card_version_pending_claims";
    let present = card_count(
        connection,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        &[&table],
    )?;
    if present != 1 {
        return Err(format!("The database is missing required table: {table}"));
    }
    if m3_columns(connection, table)? != m3_columns(reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(reference, table)?
        || check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(reference, table)?)
    {
        return Err("Damaged pending card version claims schema.".into());
    }
    let mut statement = connection
        .prepare(
            "SELECT id, changed_at, device_id, first_reviewed_at FROM card_version_pending_claims",
        )
        .map_err(|e| format!("Could not read the pending claims: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("Could not read the pending claims: {e}"))?;
    for row in rows {
        let (id, changed_at, device, first) =
            row.map_err(|e| format!("Could not read the pending claims: {e}"))?;
        let owner = format!("Pending claim {id}");
        if id.is_empty() || device.is_empty() {
            return Err(format!("{owner} is incomplete."));
        }
        card_timestamp(&changed_at, &owner)?;
        if let Some(first) = first {
            card_timestamp(&first, &owner)?;
        }
    }
    Ok(())
}

pub(crate) fn verify_schema_27_faa_references(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "faa_reference_copies";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || check_constraints(&table_sql(connection, table)?) != check_constraints(&table_sql(&reference, table)?)
        || m3_count(connection, "SELECT COUNT(*) FROM pragma_foreign_key_check('faa_reference_copies')", &[])? != 0
        || m3_count(connection, "SELECT COUNT(*) FROM faa_reference_copies WHERE typeof(material_id) != 'text' OR typeof(created_at) != 'text' OR reference_id NOT IN ('private-acs','phak','phak-addendum') OR typeof(edition) != 'text' OR length(edition)>200 OR typeof(content_sha256) != 'text' OR length(content_sha256)!=64 OR content_sha256 GLOB '*[^0-9a-f]*' OR typeof(total_pages) != 'integer' OR total_pages<1", &[])? != 0
    {
        return Err("Damaged FAA reference details.".into());
    }
    Ok(())
}

pub(crate) fn verify_schema_26_visual_cards(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["visual_card_regions", "card_item_visual_regions"] {
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Damaged picture card schema.".into());
        }
    }
    let actual: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='visual_regions_owner'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "Damaged picture index.")?;
    let expected: String = reference
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name='visual_regions_owner'",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "Damaged picture index.")?;
    if actual.as_deref().map(normalize_sql) != Some(normalize_sql(&expected)) {
        return Err("Damaged picture index.".into());
    }
    crate::visual_cards::validate_references(connection)?;
    Ok(())
}

pub(crate) fn verify_schema_24_page_sources(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["study_page_sources", "study_page_source_bindings"] {
        if m3_columns(connection, table)? != m3_columns(&reference, table)?
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Page sources do not match the migration contract.".into());
        }
    }
    for name in [
        "collect_study_page_sources",
        "erase_frozen_card_page_sources",
        "erase_material_card_page_sources",
    ] {
        let sql = "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?1";
        let actual: Option<String> = connection
            .query_row(sql, [name], |r| r.get(0))
            .optional()
            .map_err(|_| "Damaged page source guards.")?;
        let expected: String = reference
            .query_row(sql, [name], |r| r.get(0))
            .map_err(|_| "Damaged page source guards.")?;
        if actual.as_deref().map(normalize_sql) != Some(normalize_sql(&expected)) {
            return Err("Damaged page source guards.".into());
        }
    }
    let mut stmt=connection.prepare("SELECT b.owner_key,b.binding_kind,b.item_key,b.content_fingerprint,s.physical_page FROM study_page_source_bindings b JOIN study_page_sources s ON s.id=b.source_id").map_err(|_|"Page sources unavailable.")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .map_err(|_| "Page sources unavailable.")?;
    for row in rows {
        let (owner, kind, key, hash, page) = row.map_err(|_| "Damaged page source.")?;
        if kind == "frozen_card" {
            let card:Option<serde_json::Value>=connection.query_row("SELECT i.front,i.back,i.source_page,o.origin FROM card_items i JOIN card_versions v ON v.id=i.version_id LEFT JOIN card_item_origins o ON o.item_id=i.id WHERE i.id=?1 AND v.source_material_id=?2",rusqlite::params![key,owner],|r|Ok(serde_json::json!({"front":r.get::<_,String>(0)?,"back":r.get::<_,String>(1)?,"sourcePage":r.get::<_,Option<i64>>(2)?,"origin":r.get::<_,Option<String>>(3)?}))).optional().map_err(|_|"Damaged page source.")?;
            let card = card.map(|mut c| {
                if let Ok(Some(id)) = crate::visual_cards::frozen_id(connection, &key) {
                    c["visualRegionId"] = serde_json::json!(id);
                }
                c
            });
            if card.as_ref().map_or(true, |c| {
                crate::study_page_sources::fingerprint(c) != hash || c["sourcePage"] != page
            }) {
                return Err("Damaged frozen page source.".into());
            }
        } else if kind == "authored_card" {
            let mut candidates=connection.prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?1 UNION ALL SELECT json_extract(previous_json,'$.flashcards_json') FROM study_set_history WHERE material_id=?1 AND kind='study_set'").map_err(|_|"Damaged authored page source.")?;
            let rows = candidates
                .query_map([&owner], |r| r.get::<_, String>(0))
                .map_err(|_| "Damaged authored page source.")?;
            let mut found = false;
            for row in rows {
                let cards: serde_json::Value =
                    serde_json::from_str(&row.map_err(|_| "Damaged authored page source.")?)
                        .map_err(|_| "Damaged authored page source.")?;
                if cards.as_array().is_some_and(|a| {
                    a.iter().any(|c| {
                        c["itemId"] == key
                            && crate::study_page_sources::fingerprint(c) == hash
                            && c["sourcePage"] == page
                    })
                }) {
                    found = true;
                }
            }
            if !found {
                return Err("Damaged authored page source.".into());
            }
        } else if kind == "frozen_question" {
            verify_frozen_question_source(connection, &owner, &key, &hash, page)?;
        } else if kind == "authored_question" {
            verify_authored_question_source(connection, &owner, &key, &hash, page)?;
        } else {
            return Err("Unsupported page source binding.".into());
        }
    }
    Ok(())
}

/// A frozen question source must match its saved item exactly. An item that
/// is gone leaves an unreachable row that the next practice save collects.
pub(super) fn verify_frozen_question_source(
    connection: &Connection,
    owner: &str,
    key: &str,
    hash: &str,
    page: i64,
) -> Result<(), String> {
    let item: Option<(serde_json::Value, String)> = connection
        .query_row(
            "SELECT i.question_text,i.options_json,i.correct_index,i.explanation,i.source_page,o.origin,v.history_key FROM practice_test_items i JOIN practice_test_versions v ON v.id=i.version_id LEFT JOIN practice_item_origins o ON o.item_id=i.id WHERE i.id=?1",
            [key],
            |r| {
                let options: String = r.get(1)?;
                let mut q = serde_json::json!({
                    "question": r.get::<_, String>(0)?,
                    "options": serde_json::from_str::<serde_json::Value>(&options).unwrap_or(serde_json::Value::Null),
                    "correctIndex": r.get::<_, i64>(2)?,
                    "explanation": r.get::<_, String>(3)?,
                    "sourcePage": r.get::<_, Option<i64>>(4)?,
                });
                if let Some(origin) = r
                    .get::<_, Option<String>>(5)?
                    .filter(|o| o == "user" || o == "instructor")
                {
                    q["origin"] = serde_json::json!(origin);
                }
                Ok((q, r.get::<_, String>(6)?))
            },
        )
        .optional()
        .map_err(|_| "Damaged frozen page source.")?;
    let Some((question, history_key)) = item else {
        return Ok(());
    };
    if history_key != owner
        || question["sourcePage"] != page
        || crate::study_page_sources::question_fingerprint(&question) != hash
    {
        return Err("Damaged frozen page source.".into());
    }
    Ok(())
}

/// A question draft's source must match that question in the current test or
/// a preserved earlier version. A deleted material's drafts are collectable.
pub(super) fn verify_authored_question_source(
    connection: &Connection,
    owner: &str,
    key: &str,
    hash: &str,
    page: i64,
) -> Result<(), String> {
    let live: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM study_materials WHERE id=?1)",
            [owner],
            |r| r.get(0),
        )
        .map_err(|_| "Damaged authored page source.")?;
    if !live {
        return Ok(());
    }
    let mut snapshots = vec![
        crate::practice_authoring::read_current_snapshot(connection, owner)
            .map_err(|_| "Damaged authored page source.")?,
    ];
    let mut stmt = connection
        .prepare(
            "SELECT previous_json FROM study_set_history WHERE material_id=?1 AND kind='practice'",
        )
        .map_err(|_| "Damaged authored page source.")?;
    let rows = stmt
        .query_map([owner], |r| r.get::<_, String>(0))
        .map_err(|_| "Damaged authored page source.")?;
    for row in rows {
        let previous = row.map_err(|_| "Damaged authored page source.")?;
        snapshots.push(crate::practice_authoring::snapshot_from_history_row(
            &previous,
        ));
    }
    for snapshot in snapshots.iter().flatten() {
        for question in &snapshot.questions {
            let q = crate::practice_authoring::question_value(question);
            if question.identity == key
                && q["sourcePage"] == page
                && crate::study_page_sources::question_fingerprint(&q) == hash
            {
                return Ok(());
            }
        }
    }
    Err("Damaged authored page source.".into())
}
/// ORAL-01c: the three scenario tables exactly as migrated, then the codec,
/// hash, version-order and receipt checks in `oral_scenarios`.
pub(crate) fn verify_schema_25_oral_scenarios(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let newest = newest_migration_version(connection).unwrap_or(crate::CURRENT_SCHEMA_VERSION);
    for table in [
        "oral_scenarios",
        "oral_scenario_versions",
        "oral_save_operations",
    ] {
        // 0040 added follow_ups_json; an older backup is checked against its own version.
        let expected_columns: Vec<String> = m3_columns(&reference, table)?
            .into_iter()
            .filter(|c| {
                !(table == "oral_scenario_versions"
                    && newest < 40
                    && c.starts_with("follow_ups_json|"))
            })
            .collect();
        if m3_columns(connection, table)? != expected_columns
            || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
            || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
            || check_constraints(&table_sql(connection, table)?)
                != check_constraints(&table_sql(&reference, table)?)
            || m3_count(
                connection,
                &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
                &[],
            )? != 0
        {
            return Err("Damaged oral scenario schema.".into());
        }
    }
    let index = "idx_oral_scenario_order";
    let actual = m3_master_sql(connection, "index", index)?;
    let expected = m3_master_sql(&reference, "index", index)?;
    if actual.is_none() || actual.map(|s| normalize_sql(&s)) != expected.map(|s| normalize_sql(&s))
    {
        return Err("Damaged oral scenario order.".into());
    }
    crate::oral_scenarios::validate_database(connection)
}

pub(crate) fn verify_schema_19_study_receipts(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    let table = "study_set_save_operations";
    if m3_columns(connection, table)? != m3_columns(&reference, table)?
        || foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)?
        || m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)?
        || check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        || m3_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
    {
        return Err("Study set save receipts do not match the migration contract.".into());
    }
    let mut stmt=connection.prepare("SELECT operation_id,material_id,payload_json,payload_hash FROM study_set_save_operations").map_err(|_|"Study set save receipts unavailable.")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| "Study set save receipts unavailable.")?;
    for row in rows {
        let (id, material, payload, hash) =
            row.map_err(|_| "A study set save receipt is damaged.")?;
        let v: serde_json::Value =
            serde_json::from_str(&payload).map_err(|_| "A study set save receipt is damaged.")?;
        let operation = crate::study_sets::decode_operation(&v)
            .map_err(|_| "A study set save receipt is damaged.")?;
        if (operation.pdf_kit_sources.is_none()
            && operation.page_source.is_none()
            && operation.visual_regions.is_none())
            || operation.operation_id != id
            || operation.material_id != material
            || crate::practice_sessions::canonical_json(&operation.payload) != payload
            || crate::practice_sessions::compute_canonical_hash(&operation.payload) != hash
        {
            return Err("A study set save receipt is damaged.".into());
        }
    }
    Ok(())
}

pub(crate) fn verify_schema_18_pdf_kit_semantics(connection: &Connection) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    for table in ["pdf_kit_runs", "pdf_kit_item_sources"] {
        if m3_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[m3_value(table)],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
        if m3_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
        {
            return Err(format!("Table {table} has rows that point at nothing."));
        }
    }
    if m3_index_shape(connection, "pdf_kit_runs", "idx_pdf_kit_runs_material")?
        != m3_index_shape(&reference, "pdf_kit_runs", "idx_pdf_kit_runs_material")?
    {
        return Err(
            "The database is missing required index: idx_pdf_kit_runs_material".to_string(),
        );
    }

    let is_hash = |value: &str| {
        value.len() == 64
            && value
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    };
    let mut runs = connection.prepare("SELECT run_id, content_sha256, selected_pages_json, extractor_version, algorithm_version, created_at FROM pdf_kit_runs").map_err(|e| e.to_string())?;
    let rows = runs
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (run_id, hash, encoded, _, _, _) = row.map_err(|e| e.to_string())?;
        if !is_valid_uuid_v4(&run_id) || run_id.bytes().any(|c| c.is_ascii_uppercase()) {
            return Err("A PDF kit has an invalid run identity.".to_string());
        }
        if !is_hash(&hash) {
            return Err("A PDF kit has an invalid source hash.".to_string());
        }
        let pages: Vec<u16> = serde_json::from_str(&encoded)
            .map_err(|_| "A PDF kit has invalid selected pages.".to_string())?;
        if serde_json::to_string(&pages).map_err(|e| e.to_string())? != encoded
            || pages.iter().any(|p| !(1..=1000).contains(p))
            || pages.windows(2).any(|p| p[0] >= p[1])
        {
            return Err("A PDF kit has invalid selected pages.".to_string());
        }
    }
    if m3_count(connection, "SELECT COUNT(*) FROM pdf_kit_item_sources s LEFT JOIN pdf_kit_runs r ON r.run_id = s.run_id LEFT JOIN study_materials m ON m.id = r.material_id WHERE r.run_id IS NULL OR m.id IS NULL", &[])? != 0 {
        return Err("A PDF kit source has no material.".to_string());
    }
    let mut sources = connection.prepare("SELECT item_kind, logical_id, content_hash, page, start_offset, end_offset, quote FROM pdf_kit_item_sources").map_err(|e| e.to_string())?;
    let rows = sources
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (kind, _, hash, page, start, end, quote) = row.map_err(|e| e.to_string())?;
        if !is_hash(&hash) {
            return Err("A PDF kit item has an invalid content hash.".to_string());
        }
        if !["summary", "section", "card", "question"].contains(&kind.as_str()) {
            return Err("A PDF kit item has an invalid kind.".to_string());
        }
        if !(1..=1000).contains(&page) || start < 0 || end <= start {
            return Err("A PDF kit source has invalid page offsets.".to_string());
        }
        if !(1..=2000).contains(&quote.chars().count()) {
            return Err("A PDF kit source has an invalid quote.".to_string());
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 17: authoring practice questions she writes herself          */
/* (TS twin: `validatePracticeAuthoringState`)                         */
/* ------------------------------------------------------------------ */

pub(crate) const PRACTICE_AUTHORING_TABLES: [&str; 1] = ["practice_save_operations"];

/// `AUTHORING_ACTIONS` in the TypeScript twin. Migration 0017 also declares a
/// CHECK over exactly these values, so no row can reach the receipts loop with
/// any other action.
pub(super) const PRACTICE_AUTHORING_ACTIONS: [&str; 6] = [
    "create",
    "edit",
    "correct",
    "regenerate",
    "restore",
    "remove",
];

/// The OFFLINE-03b contract: the receipts table exactly as migration 0017
/// defines it; the new columns on the two extended tables; receipts binding
/// material, action and the exact canonical payload bytes with a digest that
/// recomputes, decoded by the writer's own strict decoder; identities that are
/// unique per version and owned by one living material; retirement lists,
/// historical envelopes and the current mirror that decode and agree. Column
/// registration alone proves nothing. This is the native twin of
/// `validatePracticeAuthoringState` in `src/data/practiceStateValidation.ts`,
/// in the same order with the same checks; the shared accept/refuse fixture is
/// `src-tauri/fixtures/practice-authoring-validation/cases.json`.
pub(crate) fn verify_schema_17_practice_authoring_semantics(
    connection: &Connection,
) -> Result<(), String> {
    use crate::card_reviews::sha256_hex;
    use crate::practice_authoring::{
        decode_practice_operation, decode_practice_retirements, decode_practice_snapshot,
        read_current_snapshot,
    };
    use crate::practice_sessions::canonical_json;
    use rusqlite::types::Value as SqlValue;
    use serde_json::Value;

    // The authoring contract's UUID pattern is lowercase, so `is_valid_uuid_v4`
    // alone is not enough (TS `AUTHORING_UUID_V4` has no `i` flag).
    let is_authoring_uuid = |value: &str| {
        is_valid_uuid_v4(value) && !value.bytes().any(|byte| byte.is_ascii_uppercase())
    };
    let field = |row: &M3Row, key: &str| m3_field(row, key).unwrap_or_default();

    // 1. The receipt table, exactly as the registered migration defines it.
    let reference = get_reference_schema_connection()?;
    for table in PRACTICE_AUTHORING_TABLES {
        if m3_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[m3_value(table)],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
        if m3_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
        {
            return Err(format!("Table {table} has rows that point at nothing."));
        }
    }
    if m3_index_shape(
        connection,
        "practice_save_operations",
        "idx_practice_save_ops_material",
    )? != m3_index_shape(
        &reference,
        "practice_save_operations",
        "idx_practice_save_ops_material",
    )? {
        return Err(
            "The database is missing required index: idx_practice_save_ops_material".to_string(),
        );
    }

    // 2. The 0017 columns on the tables earlier migrations made.
    for (table, col_name, col_type, notnull) in [
        ("practice_tests", "retired_json", "TEXT", 1),
        ("practice_test_items", "logical_id", "TEXT", 0),
        ("practice_test_items", "replaces_id", "TEXT", 0),
    ] {
        let found: Option<(String, i64)> = connection
            .query_row(
                &format!(
                    "SELECT type, [notnull] FROM pragma_table_info('{table}') WHERE name = ?1"
                ),
                [col_name],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to read actual columns for {table}: {e}"))?;
        let Some((actual_type, actual_notnull)) = found else {
            return Err(format!("Table {table} missing required column: {col_name}"));
        };
        if !actual_type.eq_ignore_ascii_case(col_type) {
            return Err(format!(
                "Table {table} column {col_name} type mismatch: expected {col_type}, found {actual_type}"
            ));
        }
        if actual_notnull != notnull {
            return Err(format!(
                "Table {table} column {col_name} notnull mismatch: expected {notnull}, found {actual_notnull}"
            ));
        }
    }

    // 3. Receipts: exact canonical payload bytes, a digest that recomputes, a
    // typed result, and the whole operation decoded by the writer's own strict
    // decoder, bound row-for-row to the operation id, material and action it is
    // keyed by. A reused operation id is only ever the same committed
    // operation.
    for row in m3_rows(
        connection,
        "SELECT operation_id, material_id, action, payload_json, payload_hash, result_json \
         FROM practice_save_operations",
        &[],
    )? {
        let action = field(&row, "action");
        if !PRACTICE_AUTHORING_ACTIONS.contains(&action.as_str()) {
            return Err("A practice save receipt names an unknown action.".to_string());
        }
        let payload = field(&row, "payload_json");
        let Ok(operation) = serde_json::from_str::<Value>(&payload) else {
            return Err("A practice save receipt does not hold JSON.".to_string());
        };
        if canonical_json(&operation) != payload {
            return Err(
                "A practice save receipt does not hold its exact canonical payload bytes."
                    .to_string(),
            );
        }
        // Strict decode through the authoring writer's own decoder — one
        // decoder, not a second one that could drift.
        let Ok(decoded) = decode_practice_operation(&operation) else {
            return Err(
                "A practice save receipt does not hold a complete authoring operation.".to_string(),
            );
        };
        if decoded.operation_id != field(&row, "operation_id") {
            return Err(
                "A practice save receipt does not bind its operation id to its row key."
                    .to_string(),
            );
        }
        if decoded.material_id != field(&row, "material_id") || decoded.reason.as_str() != action {
            return Err(
                "A practice save receipt does not bind its material and action.".to_string(),
            );
        }
        if field(&row, "payload_hash") != sha256_hex(&payload) {
            return Err("A practice save receipt digest does not match its payload.".to_string());
        }
        let result = match serde_json::from_str::<Value>(&field(&row, "result_json")) {
            Ok(Value::Object(map)) => map,
            _ => return Err("A practice save receipt does not hold a typed result.".to_string()),
        };
        let mut keys: Vec<&str> = result.keys().map(String::as_str).collect();
        keys.sort_unstable();
        let expected_keys = if action == "remove" {
            "status"
        } else {
            "status,versionId"
        };
        if result.get("status").and_then(Value::as_str) != Some("saved")
            || keys.join(",") != expected_keys
        {
            return Err("A practice save receipt does not hold a typed result.".to_string());
        }
        if action != "remove"
            && !result
                .get("versionId")
                .and_then(Value::as_str)
                .is_some_and(is_authoring_uuid)
        {
            return Err("A practice save receipt does not name the version it saved.".to_string());
        }
    }

    // 4. Editor metadata: identities and replacements are UUID v4, unique per
    // version, never shared by two living materials, and a recorded
    // replacement always sits beside an origin.
    for row in m3_rows(
        connection,
        "SELECT logical_id, replaces_id FROM practice_test_items \
         WHERE logical_id IS NOT NULL OR replaces_id IS NOT NULL",
        &[],
    )? {
        for column in ["logical_id", "replaces_id"] {
            if let SqlValue::Null = m3_get(&row, column) {
                continue;
            }
            if !is_authoring_uuid(&field(&row, column)) {
                return Err(format!("A practice item carries a malformed {column}."));
            }
        }
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM (
            SELECT version_id, logical_id FROM practice_test_items
             WHERE logical_id IS NOT NULL GROUP BY version_id, logical_id HAVING COUNT(*) > 1)",
        &[],
    )? != 0
    {
        return Err("A practice version repeats one logical identity.".to_string());
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM (
            SELECT i.logical_id FROM practice_test_items i
              JOIN practice_test_versions v ON v.id = i.version_id
             WHERE i.logical_id IS NOT NULL AND v.source_material_id IS NOT NULL
             GROUP BY i.logical_id HAVING COUNT(DISTINCT v.source_material_id) > 1)",
        &[],
    )? != 0
    {
        return Err("Two study materials share one practice question identity.".to_string());
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM practice_test_items i
          WHERE i.replaces_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM practice_item_origins o WHERE o.item_id = i.id)",
        &[],
    )? != 0
    {
        return Err("A practice item records a replacement without an origin.".to_string());
    }

    // 5. Stored retirement lists and historical envelopes decode strictly.
    for row in m3_rows(connection, "SELECT retired_json FROM practice_tests", &[])? {
        let damaged = match serde_json::from_str::<Value>(&field(&row, "retired_json")) {
            Ok(value) => decode_practice_retirements(&value).is_err(),
            Err(_) => true,
        };
        if damaged {
            return Err("A practice test carries a damaged retirement list.".to_string());
        }
    }
    for row in m3_rows(
        connection,
        "SELECT previous_json FROM study_set_history WHERE kind = 'practice'",
        &[],
    )? {
        let damaged = match serde_json::from_str::<Value>(&field(&row, "previous_json")) {
            Ok(value) => decode_practice_snapshot(&value).is_err(),
            Err(_) => true,
        };
        if damaged {
            return Err("A saved practice history entry is not a valid snapshot.".to_string());
        }
    }

    // 6. The current mirror agrees with the active version, and every active
    // version of a living material has its mirror row.
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM practice_test_versions v
          WHERE v.is_active = 1 AND v.source_material_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM practice_tests t WHERE t.source_material_id = v.source_material_id)",
        &[],
    )? != 0
    {
        return Err("An active practice version has no current test row.".to_string());
    }
    for row in m3_rows(
        connection,
        "SELECT source_material_id, title, questions_json, provider, model, legacy_migrated_at \
         FROM practice_tests",
        &[],
    )? {
        let material_id = field(&row, "source_material_id");
        let current = read_current_snapshot(connection, &material_id)
            .map_err(|_| "The current practice test does not decode as a saved snapshot.")?;
        let Some(snapshot) = current else {
            // A mirror with no active version is legitimate only while the
            // legacy row is unconverted or quarantined (established
            // schema-11 states). Once marked migrated — the state the
            // authoring contract always writes together with its version —
            // the version must exist.
            if let SqlValue::Null = m3_get(&row, "legacy_migrated_at") {
                continue;
            }
            return Err("A migrated current practice test has no active version.".to_string());
        };
        if snapshot.title != field(&row, "title")
            || snapshot.provider != field(&row, "provider")
            || snapshot.model != field(&row, "model")
        {
            return Err("The current practice test disagrees with its active version.".to_string());
        }
        let Ok(mirrored) = serde_json::from_str::<Value>(&field(&row, "questions_json")) else {
            return Err("The current practice test does not hold JSON questions.".to_string());
        };
        let projected: Vec<Value> = snapshot
            .questions
            .iter()
            .map(|question| {
                serde_json::json!({
                    "question": question.question,
                    "options": question.options,
                    "correctIndex": question.correct_index,
                    "explanation": question.explanation,
                    "sourcePage": question.source_page,
                })
            })
            .collect();
        if canonical_json(&mirrored) != canonical_json(&Value::Array(projected)) {
            return Err(
                "The current practice test questions disagree with the active version.".to_string(),
            );
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 16: study material she makes herself                         */
/* (TS twin: `validateManualStudyState`)                               */
/* ------------------------------------------------------------------ */

pub(crate) const MANUAL_STUDY_TABLES: [&str; 5] = [
    "study_set_history",
    "card_version_origins",
    "card_item_origins",
    "practice_item_origins",
    "ai_study_sets",
];

/// The OFFLINE-03 contract: the history and origin tables, and the two new
/// study-set columns, exactly as migration 0016 defines them; rows that point
/// at real materials, cards and questions; and well-formed stored provenance.
/// Card origins are checked against their snapshot hashes in schema 12.
pub(crate) fn verify_schema_16_manual_study_semantics(
    connection: &Connection,
) -> Result<(), String> {
    let count = |sql: &str, params: &[&dyn rusqlite::ToSql]| -> Result<i64, String> {
        connection
            .query_row(sql, params, |r| r.get(0))
            .map_err(|e| format!("Could not check study set history: {e}"))
    };
    let reference = get_reference_schema_connection_through(16)?;
    for table in MANUAL_STUDY_TABLES {
        if count(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
        if count(
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )? != 0
        {
            return Err(format!("Table {table} has rows that point at nothing."));
        }
    }
    if m3_index_shape(connection, "study_set_history", "idx_study_set_history")?
        != m3_index_shape(&reference, "study_set_history", "idx_study_set_history")?
    {
        return Err("The database is missing required index: idx_study_set_history".to_string());
    }
    crate::study_sets::verify_stored_sets(connection)
}

/* ------------------------------------------------------------------ */
/* Schema 15: document navigation                                      */
/* (TS twin: `validateNavigationState`)                                */
/* ------------------------------------------------------------------ */

pub(crate) const NAVIGATION_TABLES: [&str; 4] = [
    "material_content_identities",
    "material_reading_state",
    "material_bookmarks",
    "material_operation_claims",
];

pub(crate) const NAVIGATION_INDEXES: [(&str, &str); 5] = [
    ("material_content_identities", "idx_material_content_sha"),
    ("material_reading_state", "idx_material_reading_state_owner"),
    ("material_bookmarks", "idx_material_bookmarks_material"),
    ("material_bookmarks", "idx_material_bookmarks_page"),
    ("material_bookmarks", "idx_material_bookmarks_hash"),
];

/// The navigation contract a restored or opened database must meet: the four
/// tables exactly as migration 0015 defines them, their indexes, rows that
/// point at real materials, and ownership that is internally consistent — a
/// cancelled token was issued, and a saved tuple belongs to an issued token.
pub(crate) fn verify_schema_15_navigation_semantics(connection: &Connection) -> Result<(), String> {
    let count = |sql: &str, params: &[&dyn rusqlite::ToSql]| -> Result<i64, String> {
        connection
            .query_row(sql, params, |r| r.get(0))
            .map_err(|e| format!("Could not check document navigation: {e}"))
    };
    let version = newest_migration_version(connection)
        .unwrap_or(crate::CURRENT_SCHEMA_VERSION)
        .max(15);
    let reference = get_reference_schema_connection_through(version)?;
    for table in NAVIGATION_TABLES {
        if count(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        if m3_columns(connection, table)? != m3_columns(&reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(&reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
        let orphans = count(
            &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
            &[],
        )?;
        if orphans != 0 {
            return Err(format!(
                "Table {table} has rows for study materials that no longer exist."
            ));
        }
    }
    for (table, index) in NAVIGATION_INDEXES {
        if m3_index_shape(connection, table, index)? != m3_index_shape(&reference, table, index)? {
            return Err(format!("The database is missing required index: {index}"));
        }
    }
    if count(
        "SELECT COUNT(*) FROM material_operation_claims WHERE cancelled_generation > reserved_generation",
        &[],
    )? != 0
    {
        return Err("A navigation claim cancels a request that was never issued.".to_string());
    }
    if count(
        "SELECT COUNT(*) FROM material_reading_state s
           LEFT JOIN material_operation_claims c ON c.material_id = s.material_id
          WHERE s.owner_generation > COALESCE(c.reserved_generation, 0)",
        &[],
    )? != 0
    {
        return Err(
            "A saved reading position belongs to a request that was never issued.".to_string(),
        );
    }
    if count(
        &format!(
            "SELECT COUNT(*) FROM (SELECT material_id FROM material_bookmarks GROUP BY material_id HAVING COUNT(*) > {})",
            crate::navigation::MAX_BOOKMARKS_PER_MATERIAL
        ),
        &[],
    )? != 0
    {
        return Err("A study material has more bookmarks than the app supports.".to_string());
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 14: skills and feedback evidence                             */
/* (TS twin: `validateSkillEvidenceState`)                             */
/* ------------------------------------------------------------------ */

pub(super) const SKILL_EVIDENCE_TABLES: [&str; 6] = [
    "skill_catalog_entries",
    "skill_catalog_revisions",
    "skill_observations",
    "skill_observation_revisions",
    "skill_self_assessments",
    "skill_evidence_operations",
];

pub(super) const SKILL_EVIDENCE_INDEXES: [(&str, &str); 6] = [
    ("skill_observations", "idx_skill_observations_page"),
    ("skill_observations", "idx_skill_observations_skill_page"),
    ("skill_observations", "idx_skill_observations_journal"),
    (
        "skill_observations",
        "idx_skill_observations_source_journal",
    ),
    ("skill_observations", "idx_skill_observations_action"),
    (
        "skill_evidence_operations",
        "idx_skill_evidence_operations_subject",
    ),
];

pub(super) const SKILL_EVIDENCE_TRIGGERS: [&str; 6] = [
    "trg_skill_catalog_revisions_no_update",
    "trg_skill_catalog_revisions_no_delete",
    "trg_skill_observation_revisions_no_update",
    "trg_skill_observation_revisions_no_partial_delete",
    "trg_skill_self_assessments_no_update",
    "trg_skill_self_assessments_no_delete",
];

pub(super) type M3Row = Vec<(String, rusqlite::types::Value)>;

pub(super) fn m3_rows(
    connection: &Connection,
    sql: &str,
    values: &[rusqlite::types::Value],
) -> Result<Vec<M3Row>, String> {
    let fail = |e: rusqlite::Error| format!("Could not check skill evidence: {e}");
    let mut statement = connection.prepare(sql).map_err(fail)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mapped = statement
        .query_map(rusqlite::params_from_iter(values.iter()), |r| {
            let mut out = Vec::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                out.push((name.clone(), r.get::<_, rusqlite::types::Value>(i)?));
            }
            Ok(out)
        })
        .map_err(fail)?;
    mapped.collect::<Result<Vec<_>, _>>().map_err(fail)
}

pub(super) fn m3_get<'a>(row: &'a M3Row, key: &str) -> &'a rusqlite::types::Value {
    row.iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v)
        .unwrap_or(&rusqlite::types::Value::Null)
}

/// Text form used for comparisons (TS `m3Str`): NULL stays None.
pub(super) fn m3_text(value: &rusqlite::types::Value) -> Option<String> {
    use rusqlite::types::Value as V;
    match value {
        V::Null => None,
        V::Integer(i) => Some(i.to_string()),
        V::Real(f) => Some(f.to_string()),
        V::Text(s) => Some(s.clone()),
        V::Blob(b) => Some(format!("{b:?}")),
    }
}

pub(super) fn m3_int(value: &rusqlite::types::Value) -> i64 {
    use rusqlite::types::Value as V;
    match value {
        V::Integer(i) => *i,
        V::Text(s) => s.parse().unwrap_or(-1),
        _ => -1,
    }
}

pub(super) fn m3_field(row: &M3Row, key: &str) -> Option<String> {
    m3_text(m3_get(row, key))
}

pub(super) fn m3_count(
    connection: &Connection,
    sql: &str,
    values: &[rusqlite::types::Value],
) -> Result<i64, String> {
    Ok(m3_rows(connection, sql, values)?
        .first()
        .map(|r| m3_int(&r[0].1))
        .unwrap_or(0))
}

pub(super) fn m3_value(text: &str) -> rusqlite::types::Value {
    rusqlite::types::Value::Text(text.to_string())
}

pub(super) fn m3_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    Ok(m3_rows(
        connection,
        &format!("SELECT name, type, \"notnull\" AS required, pk, dflt_value FROM pragma_table_info('{table}') ORDER BY name"),
        &[],
    )?
    .iter()
    .map(|r| {
        format!(
            "{}|{}|{}|{}|{}",
            m3_field(r, "name").unwrap_or_default(),
            m3_field(r, "type").unwrap_or_default().to_lowercase(),
            m3_int(m3_get(r, "required")),
            m3_int(m3_get(r, "pk")),
            m3_field(r, "dflt_value").unwrap_or_default()
        )
    })
    .collect())
}

pub(super) fn m3_key_indexes(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for r in m3_rows(
        connection,
        &format!(
            "SELECT name, origin FROM pragma_index_list('{table}') WHERE origin IN ('pk', 'u')"
        ),
        &[],
    )? {
        let name = m3_field(&r, "name").unwrap_or_default();
        let cols: Vec<String> = m3_rows(
            connection,
            &format!("SELECT name FROM pragma_index_info('{name}') ORDER BY seqno"),
            &[],
        )?
        .iter()
        .map(|c| m3_field(c, "name").unwrap_or_default())
        .collect();
        out.push(format!(
            "{}|{}",
            m3_field(&r, "origin").unwrap_or_default(),
            cols.join(",")
        ));
    }
    out.sort();
    Ok(out)
}

pub(super) fn m3_master_sql(
    connection: &Connection,
    kind: &str,
    name: &str,
) -> Result<Option<String>, String> {
    Ok(m3_rows(
        connection,
        "SELECT sql FROM sqlite_master WHERE type = ?1 AND name = ?2",
        &[m3_value(kind), m3_value(name)],
    )?
    .first()
    .and_then(|r| m3_field(r, "sql")))
}

pub(super) fn m3_index_shape(
    connection: &Connection,
    table: &str,
    index: &str,
) -> Result<Option<String>, String> {
    let listed = m3_rows(
        connection,
        &format!("SELECT \"unique\" AS uniq FROM pragma_index_list('{table}') WHERE name = ?1"),
        &[m3_value(index)],
    )?;
    let Some(first) = listed.first() else {
        return Ok(None);
    };
    let cols: Vec<String> = m3_rows(
        connection,
        &format!("SELECT name FROM pragma_index_info('{index}') ORDER BY seqno"),
        &[],
    )?
    .iter()
    .map(|c| m3_field(c, "name").unwrap_or_default())
    .collect();
    Ok(Some(format!(
        "{}|{}",
        m3_int(m3_get(first, "uniq")),
        cols.join(",")
    )))
}

/// The schema-14 contract a restored or opened database must meet: exact
/// shape (columns, defaults, foreign keys, CHECKs, keys, indexes, triggers),
/// the shipped built-in catalog, contiguous histories whose latest entry is
/// the head, legal catalog steps with unique active names (M3-R6), receipts
/// that own exactly the history they name (M3-R5), and history owned by its
/// receipt (M3-R9). Shared contract:
/// `fixtures/skill-evidence/validation-cases.json`.
pub(crate) fn verify_schema_14_skill_evidence_semantics(
    connection: &Connection,
) -> Result<(), String> {
    let reference = get_reference_schema_connection()?;
    verify_skill_evidence_against(connection, &reference)
}

pub(crate) fn verify_skill_evidence_against(
    connection: &Connection,
    reference: &Connection,
) -> Result<(), String> {
    use crate::skill_evidence::{
        decode_result, label_key, ResultValue, ASSESSMENT_ACTIONS, OBSERVATION_HISTORY_ACTIONS,
        SKILL_ACTIONS,
    };
    use rusqlite::types::Value as V;

    // 1. Exact shape.
    for table in SKILL_EVIDENCE_TABLES {
        let Some(sql) = m3_master_sql(connection, "table", table)? else {
            return Err(format!("The database is missing required table: {table}"));
        };
        let reference_sql = m3_master_sql(reference, "table", table)?.unwrap_or_default();
        if m3_columns(connection, table)? != m3_columns(reference, table)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&sql) != check_constraints(&reference_sql) {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
        if m3_key_indexes(connection, table)? != m3_key_indexes(reference, table)? {
            return Err(format!(
                "Table {table} keys do not match the registered migration contract."
            ));
        }
    }
    for (table, index) in SKILL_EVIDENCE_INDEXES {
        let Some(actual) = m3_index_shape(connection, table, index)? else {
            return Err(format!("The database is missing required index: {index}"));
        };
        if Some(actual) != m3_index_shape(reference, table, index)? {
            return Err(format!(
                "Index {index} does not match the registered migration contract."
            ));
        }
    }
    for trigger in SKILL_EVIDENCE_TRIGGERS {
        let Some(sql) = m3_master_sql(connection, "trigger", trigger)? else {
            return Err(format!(
                "The database is missing required trigger: {trigger}"
            ));
        };
        if normalize_sql(&sql)
            != normalize_sql(&m3_master_sql(reference, "trigger", trigger)?.unwrap_or_default())
        {
            return Err(format!(
                "Trigger {trigger} does not match the registered migration contract."
            ));
        }
    }

    // 2. Relationships hold (foreign keys are not re-checked by SQLite on restore).
    for table in SKILL_EVIDENCE_TABLES {
        if !m3_rows(
            connection,
            &format!("SELECT 1 FROM pragma_foreign_key_check('{table}') LIMIT 1"),
            &[],
        )?
        .is_empty()
        {
            return Err(format!(
                "Table {table} has a record pointing at something that does not exist."
            ));
        }
    }

    // 3. The built-in catalog is exactly the shipped one.
    let shipped = m3_rows(
        reference,
        "SELECT * FROM skill_catalog_revisions WHERE revision = 1 AND changed_by = 'catalog'",
        &[],
    )?;
    let builtins = m3_rows(
        connection,
        "SELECT id FROM skill_catalog_entries WHERE origin = 'builtin'",
        &[],
    )?;
    let shipped_ids: Vec<Option<String>> =
        shipped.iter().map(|r| m3_field(r, "skill_id")).collect();
    if builtins.len() != shipped.len()
        || builtins
            .iter()
            .any(|r| !shipped_ids.contains(&m3_field(r, "id")))
    {
        return Err("The built-in skill catalog does not match this version of the app.".into());
    }
    for r in &shipped {
        let id = m3_field(r, "skill_id").unwrap_or_default();
        let first = m3_rows(
            connection,
            "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = 1",
            &[m3_value(&id)],
        )?;
        let matches = first.first().map(|f| {
            [
                "label",
                "description",
                "topic",
                "status",
                "catalog_version",
                "changed_by",
                "changed_at",
            ]
            .iter()
            .all(|k| m3_field(f, k) == m3_field(r, k))
        });
        if matches != Some(true) {
            return Err(format!(
                "Built-in skill {id} does not match the shipped catalog."
            ));
        }
    }
    if m3_count(
        connection,
        "SELECT COUNT(*) FROM skill_catalog_entries WHERE origin = 'custom'",
        &[],
    )? > crate::skill_evidence::MAX_CUSTOM_SKILLS
    {
        return Err("There are more custom skills than this app supports.".into());
    }

    // 4. Skill history: contiguous, head equals latest, pinned built-in wording
    //    and catalog version, legal steps, unique active names.
    let mut active_names: Vec<(String, String)> = Vec::new();
    for skill in m3_rows(
        connection,
        "SELECT * FROM skill_catalog_entries ORDER BY id",
        &[],
    )? {
        let id = m3_field(&skill, "id").unwrap_or_default();
        let history = m3_rows(
            connection,
            "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 ORDER BY revision",
            &[m3_value(&id)],
        )?;
        if history.len() as i64 != m3_int(m3_get(&skill, "revision"))
            || history
                .iter()
                .enumerate()
                .any(|(i, h)| m3_int(m3_get(h, "revision")) != i as i64 + 1)
        {
            return Err(format!("Skill {id} has gaps in its history."));
        }
        let Some(latest) = history.last() else {
            return Err(format!("Skill {id} has gaps in its history."));
        };
        if ["label", "description", "topic", "status", "catalog_version"]
            .iter()
            .any(|k| m3_field(latest, k) != m3_field(&skill, k))
        {
            return Err(format!(
                "Skill {id} does not match its latest history entry."
            ));
        }
        let builtin = m3_field(&skill, "origin").as_deref() == Some("builtin");
        let reference_row = shipped
            .iter()
            .find(|r| m3_field(r, "skill_id").as_deref() == Some(id.as_str()));
        for (i, h) in history.iter().enumerate() {
            if let Some(r) = reference_row.filter(|_| builtin) {
                if ["label", "description", "topic", "catalog_version"]
                    .iter()
                    .any(|k| m3_field(h, k) != m3_field(r, k))
                {
                    return Err(format!("Built-in skill {id} changed its catalog wording."));
                }
            }
            if !builtin && !matches!(m3_get(h, "catalog_version"), V::Null) {
                return Err(format!("Custom skill {id} has a catalog version."));
            }
            if i == 0 {
                if !builtin
                    && (m3_field(h, "changed_by").as_deref() != Some("user")
                        || m3_field(h, "status").as_deref() != Some("active"))
                {
                    return Err(format!(
                        "Custom skill {id} did not start as an active skill of yours."
                    ));
                }
                continue;
            }
            let prev = &history[i - 1];
            if m3_field(h, "changed_by").as_deref() != Some("user") {
                return Err(format!(
                    "Skill {id} has a later revision that is not a recorded change."
                ));
            }
            let same_wording = ["label", "description", "topic"]
                .iter()
                .all(|k| m3_field(h, k) == m3_field(prev, k));
            let from = m3_field(prev, "status").unwrap_or_default();
            let to = m3_field(h, "status").unwrap_or_default();
            let legal = match (from.as_str(), to.as_str()) {
                ("active", "active") => !same_wording,
                ("active", "retired") | ("retired", "active") => same_wording,
                _ => false,
            };
            if !legal {
                return Err(format!(
                    "Skill {id} has a history step the app cannot make."
                ));
            }
        }
        if m3_field(&skill, "status").as_deref() == Some("active") {
            let key = label_key(&m3_field(&skill, "label").unwrap_or_default());
            if let Some((_, other)) = active_names.iter().find(|(k, _)| *k == key) {
                return Err(format!(
                    "Active skills {other} and {id} have the same name."
                ));
            }
            active_names.push((key, id));
        }
    }

    // 5. Observation history: contiguous, head equals latest, no relinking.
    for obs in m3_rows(connection, "SELECT * FROM skill_observations", &[])? {
        let id = m3_field(&obs, "id").unwrap_or_default();
        let history = m3_rows(
            connection,
            "SELECT * FROM skill_observation_revisions WHERE observation_id = ?1 ORDER BY revision",
            &[m3_value(&id)],
        )?;
        if history.len() as i64 != m3_int(m3_get(&obs, "revision"))
            || history
                .iter()
                .enumerate()
                .any(|(i, h)| m3_int(m3_get(h, "revision")) != i as i64 + 1)
        {
            return Err(format!("Observation {id} has gaps in its history."));
        }
        let Some(latest) = history.last() else {
            return Err(format!("Observation {id} has gaps in its history."));
        };
        if [
            "wording",
            "observed_on",
            "attribution",
            "instructor_name",
            "linked_action_id",
            "linked_action_title",
            "addressed_at",
        ]
        .iter()
        .any(|k| m3_field(&obs, k) != m3_field(latest, k))
        {
            return Err(format!(
                "Observation {id} does not match its latest history entry."
            ));
        }
        let journal = m3_field(&obs, "journal_id");
        if journal.is_some() && journal != m3_field(&obs, "source_journal_id") {
            return Err(format!(
                "Observation {id} points at a different debrief than it was recorded from."
            ));
        }
    }

    // 6. Self-assessment sequences are contiguous per skill and kind.
    for g in m3_rows(
        connection,
        "SELECT skill_id, kind, COUNT(*) AS n, MIN(sequence) AS lo, MAX(sequence) AS hi FROM skill_self_assessments GROUP BY skill_id, kind",
        &[],
    )? {
        if m3_int(m3_get(&g, "lo")) != 1 || m3_int(m3_get(&g, "hi")) != m3_int(m3_get(&g, "n")) {
            return Err(format!(
                "Skill {} has gaps in its {} history.",
                m3_field(&g, "skill_id").unwrap_or_default(),
                m3_field(&g, "kind").unwrap_or_default()
            ));
        }
    }

    // 7. Receipts: exact results naming their own subject, owning the history
    //    row of the kind their action writes; tombstones are non-content
    //    observation receipts whose subject is gone.
    let mut live: Vec<(String, String, String, i64)> = Vec::new();
    for op in m3_rows(
        connection,
        "SELECT * FROM skill_evidence_operations ORDER BY rowid",
        &[],
    )? {
        let id = m3_field(&op, "operation_id").unwrap_or_default();
        let action = m3_field(&op, "action").unwrap_or_default();
        let subject = m3_field(&op, "subject_id").unwrap_or_default();
        let present = m3_count(
            connection,
            "SELECT COUNT(*) FROM skill_observations WHERE id = ?1",
            &[m3_value(&subject)],
        )? > 0;
        if m3_int(m3_get(&op, "is_erased")) != 0 {
            if !OBSERVATION_HISTORY_ACTIONS.contains(&action.as_str()) {
                return Err(format!(
                    "Operation {id} is erased, but only observation changes can be erased."
                ));
            }
            if present {
                return Err(format!(
                    "Operation {id} says its observation was erased, but it is still here."
                ));
            }
            continue;
        }
        let value = decode_result(m3_field(&op, "result_json").as_deref(), &action, &subject)
            .map_err(|e| format!("Operation {id} has an invalid result: {e}"))?;
        let number = match value {
            ResultValue::Number(n) => n,
            ResultValue::Erased => 0,
        };
        live.push((id.clone(), action.clone(), subject.clone(), number));
        if SKILL_ACTIONS.contains(&action.as_str()) {
            let found = m3_rows(
                connection,
                "SELECT * FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = ?2",
                &[m3_value(&subject), V::Integer(number)],
            )?;
            let Some(row) = found.first().filter(|r| {
                m3_field(r, "operation_id").as_deref() == Some(id.as_str())
                    && m3_field(r, "changed_by").as_deref() == Some("user")
            }) else {
                return Err(format!(
                    "Operation {id} does not own the skill history it names."
                ));
            };
            let prev = if number > 1 {
                m3_rows(
                    connection,
                    "SELECT status FROM skill_catalog_revisions WHERE skill_id = ?1 AND revision = ?2",
                    &[m3_value(&subject), V::Integer(number - 1)],
                )?
                .first()
                .and_then(|r| m3_field(r, "status"))
            } else {
                None
            };
            let status = m3_field(row, "status").unwrap_or_default();
            let fits = match action.as_str() {
                "create_custom_skill" => subject.starts_with("custom.") && status == "active",
                "edit_custom_skill" => status == "active" && prev.as_deref() == Some("active"),
                "retire_skill" => status == "retired",
                _ => status == "active" && prev.as_deref() == Some("retired"),
            };
            if !fits {
                return Err(format!(
                    "Operation {id} names a skill change of a different kind."
                ));
            }
        } else if OBSERVATION_HISTORY_ACTIONS.contains(&action.as_str()) {
            if !present {
                return Err(format!(
                    "Operation {id} is a live record of an observation that is not here."
                ));
            }
            let found = m3_rows(
                connection,
                "SELECT change_kind, operation_id FROM skill_observation_revisions WHERE observation_id = ?1 AND revision = ?2",
                &[m3_value(&subject), V::Integer(number)],
            )?;
            let Some(row) = found
                .first()
                .filter(|r| m3_field(r, "operation_id").as_deref() == Some(id.as_str()))
            else {
                return Err(format!(
                    "Operation {id} does not own the observation history it names."
                ));
            };
            let kind = m3_field(row, "change_kind").unwrap_or_default();
            let fits = match action.as_str() {
                "create_observation" => kind == "created",
                "edit_observation" => kind == "edited",
                "link_action" => kind == "linked_action",
                "unlink_action" => kind == "unlinked_action",
                _ => kind == "marked_addressed" || kind == "cleared_addressed",
            };
            if !fits {
                return Err(format!(
                    "Operation {id} names an observation change of a different kind."
                ));
            }
        } else if ASSESSMENT_ACTIONS.contains(&action.as_str()) {
            let kind = if action == "set_status" {
                "status"
            } else {
                "confidence"
            };
            let found = m3_rows(
                connection,
                "SELECT id, operation_id FROM skill_self_assessments WHERE skill_id = ?1 AND kind = ?2 AND sequence = ?3",
                &[m3_value(&subject), m3_value(kind), V::Integer(number)],
            )?;
            let owned = found.first().map(|r| {
                m3_field(r, "operation_id").as_deref() == Some(id.as_str())
                    && m3_field(r, "id").as_deref() == Some(id.as_str())
            });
            if owned != Some(true) {
                return Err(format!(
                    "Operation {id} does not own the self-assessment it names."
                ));
            }
        } else {
            if present {
                return Err(format!(
                    "Operation {id} says it erased an observation that is still here."
                ));
            }
            if m3_count(
                connection,
                "SELECT COUNT(*) FROM skill_evidence_operations WHERE subject_id = ?1 AND is_erased = 0 AND action <> 'erase_observation'",
                &[m3_value(&subject)],
            )? > 0
            {
                return Err(format!(
                    "Operation {id} erased an observation whose earlier records were not cleared."
                ));
            }
        }
    }

    // 8. History -> receipt (M3-R9): every operation-owned history row has the
    //    live receipt that wrote it (same operation, action family, subject and
    //    revision or sequence). Catalog seeds need none.
    let owned = |operation: &V, families: &[&str], subject: &V, number: &V| -> bool {
        let Some(operation) = m3_text(operation) else {
            return false;
        };
        live.iter().any(|(id, action, s, n)| {
            *id == operation
                && families.contains(&action.as_str())
                && Some(s.clone()) == m3_text(subject)
                && *n == m3_int(number)
        })
    };
    for r in m3_rows(
        connection,
        "SELECT skill_id, revision, operation_id FROM skill_catalog_revisions WHERE changed_by = 'user' ORDER BY skill_id, revision",
        &[],
    )? {
        if !owned(
            m3_get(&r, "operation_id"),
            &SKILL_ACTIONS,
            m3_get(&r, "skill_id"),
            m3_get(&r, "revision"),
        ) {
            return Err(format!(
                "Skill {} revision {} has no matching operation record.",
                m3_field(&r, "skill_id").unwrap_or_default(),
                m3_int(m3_get(&r, "revision"))
            ));
        }
    }
    for r in m3_rows(
        connection,
        "SELECT observation_id, revision, operation_id FROM skill_observation_revisions ORDER BY observation_id, revision",
        &[],
    )? {
        if !owned(
            m3_get(&r, "operation_id"),
            &OBSERVATION_HISTORY_ACTIONS,
            m3_get(&r, "observation_id"),
            m3_get(&r, "revision"),
        ) {
            return Err(format!(
                "Observation {} revision {} has no matching operation record.",
                m3_field(&r, "observation_id").unwrap_or_default(),
                m3_int(m3_get(&r, "revision"))
            ));
        }
    }
    for r in m3_rows(
        connection,
        "SELECT skill_id, kind, sequence, operation_id FROM skill_self_assessments ORDER BY skill_id, kind, sequence",
        &[],
    )? {
        let action = if m3_field(&r, "kind").as_deref() == Some("status") {
            "set_status"
        } else {
            "set_confidence"
        };
        if !owned(
            m3_get(&r, "operation_id"),
            &[action],
            m3_get(&r, "skill_id"),
            m3_get(&r, "sequence"),
        ) {
            return Err(format!(
                "Skill {} {} entry {} has no matching operation record.",
                m3_field(&r, "skill_id").unwrap_or_default(),
                m3_field(&r, "kind").unwrap_or_default(),
                m3_int(m3_get(&r, "sequence"))
            ));
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 13: split lineage (TS twin: `validateSplitLineageState`)     */
/* ------------------------------------------------------------------ */

pub(super) const LINEAGE_TABLES: [&str; 2] = ["material_split_lineage", "split_operation_log"];
pub(super) const LINEAGE_INDEXES: [(&str, &str); 4] = [
    ("material_split_lineage", "idx_split_lineage_parent"),
    ("material_split_lineage", "idx_split_lineage_root"),
    ("split_operation_log", "idx_split_operation_source"),
    ("split_operation_log", "idx_split_operation_status"),
];

/// The split-lineage contract a restored or opened database must meet: the
/// tables exactly as migration 0013 defines them, its indexes, well-formed
/// fingerprints, and split records whose hash is the hash of their receipt.
pub(crate) fn verify_schema_13_lineage_semantics(connection: &Connection) -> Result<(), String> {
    use crate::card_reviews::{is_lower_hex_64, sha256_hex};
    let count = |sql: &str, params: &[&dyn rusqlite::ToSql]| -> Result<i64, String> {
        connection
            .query_row(sql, params, |r| r.get(0))
            .map_err(|e| format!("Could not check split lineage: {e}"))
    };
    let reference = get_reference_schema_connection()?;
    for table in LINEAGE_TABLES {
        if count(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        let columns = |c: &Connection| -> Result<Vec<(String, String, i64, i64)>, String> {
            let mut statement = c
                .prepare(&format!(
                    "SELECT name, type, [notnull], pk FROM pragma_table_info('{table}') ORDER BY name"
                ))
                .map_err(|e| format!("Could not inspect {table}: {e}"))?;
            let rows = statement
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?.to_ascii_lowercase(),
                        r.get(2)?,
                        r.get(3)?,
                    ))
                })
                .map_err(|e| format!("Could not inspect {table}: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Could not inspect {table}: {e}"));
            rows
        };
        if columns(connection)? != columns(&reference)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
    }
    for (table, index) in LINEAGE_INDEXES {
        if count(
            &format!("SELECT COUNT(*) FROM pragma_index_list('{table}') WHERE name = ?1"),
            &[&index],
        )? == 0
        {
            return Err(format!("The database is missing required index: {index}"));
        }
    }

    let mut statement = connection
        .prepare(
            "SELECT material_id, source_content_sha256, parent_content_sha256
               FROM material_split_lineage",
        )
        .map_err(|e| format!("Could not check split lineage: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| format!("Could not check split lineage: {e}"))?;
    for row in rows {
        let (material, root, parent) =
            row.map_err(|e| format!("Could not check split lineage: {e}"))?;
        for hash in [root, parent].into_iter().flatten() {
            if !is_lower_hex_64(&hash) {
                return Err(format!(
                    "Split part {material} has a malformed source fingerprint."
                ));
            }
        }
    }

    let mut statement = connection
        .prepare(
            "SELECT operation_id, receipt_hash, receipt_canonical_json FROM split_operation_log",
        )
        .map_err(|e| format!("Could not check split records: {e}"))?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Could not check split records: {e}"))?;
    for row in rows {
        let (operation, hash, canonical) =
            row.map_err(|e| format!("Could not check split records: {e}"))?;
        if !is_lower_hex_64(&hash) || operation != hash || sha256_hex(&canonical) != hash {
            return Err(format!(
                "Split record {operation} does not match its receipt."
            ));
        }
    }
    Ok(())
}

pub(crate) fn verify_schema_11_semantics(connection: &Connection) -> Result<(), String> {
    // 1. Foreign key check
    let mut fk_stmt = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|e| format!("Could not check foreign keys in that backup: {e}"))?;
    let mut fk_rows = fk_stmt
        .query([])
        .map_err(|e| format!("Could not run foreign key check: {e}"))?;
    if let Some(row) = fk_rows
        .next()
        .map_err(|e| format!("Could not read foreign key check: {e}"))?
    {
        let table: String = row.get(0).unwrap_or_default();
        let parent: String = row.get(2).unwrap_or_default();
        return Err(format!(
            "The database violates foreign key constraints between {table} and {parent}."
        ));
    }

    let ref_conn = get_reference_schema_connection()?;

    // 2. Validate tables, column types, nullability, and PKs against reference schema
    let practice_tables = [
        "practice_test_versions",
        "practice_test_items",
        "practice_attempts",
        "practice_responses",
        "practice_session_operations",
        "practice_tests",
    ];

    for table in practice_tables {
        let present: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            )
            .map_err(|e| format!("Could not inspect schema for {table}: {e}"))?;
        if present != 1 {
            return Err(format!("The backup is missing required table: {table}"));
        }

        let mut ref_stmt = ref_conn
            .prepare(&format!(
                "SELECT name, type, [notnull], pk FROM pragma_table_info('{table}')"
            ))
            .map_err(|e| format!("Failed to read ref columns for {table}: {e}"))?;
        let ref_cols: Vec<(String, String, i64, i64)> = ref_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| format!("Failed to query ref columns for {table}: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect ref columns error: {e}"))?;

        let mut conn_stmt = connection
            .prepare(&format!(
                "SELECT name, type, [notnull], pk FROM pragma_table_info('{table}')"
            ))
            .map_err(|e| format!("Failed to read actual columns for {table}: {e}"))?;
        let conn_cols: std::collections::HashMap<String, (String, i64, i64)> = conn_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                    ),
                ))
            })
            .map_err(|e| format!("Failed to query actual columns for {table}: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect actual columns error: {e}"))?;

        for (col_name, col_type, notnull, pk) in ref_cols {
            if table == "practice_tests"
                && !["legacy_migrated_at", "legacy_error"].contains(&col_name.as_str())
            {
                continue;
            }
            if table == "practice_test_items"
                && ["logical_id", "replaces_id"].contains(&col_name.as_str())
            {
                continue; // added by 0017; required by verify_schema_17_practice_authoring_semantics
            }
            if table == "practice_test_items" && col_name == "unchecked" {
                continue; // added by 0039; required by verify_schema_39_practice_unchecked
            }
            if table == "practice_attempts"
                && [
                    "timed_started_ms",
                    "timed_deadline_ms",
                    "timed_seconds_used",
                ]
                .contains(&col_name.as_str())
            {
                continue; // added by 0042; required by verify_schema_42_timed_attempts
            }
            let Some((actual_type, actual_notnull, actual_pk)) = conn_cols.get(&col_name) else {
                return Err(format!("Table {table} missing required column: {col_name}"));
            };
            if !actual_type.eq_ignore_ascii_case(&col_type) {
                return Err(format!(
                    "Table {table} column {col_name} type mismatch: expected {col_type}, found {actual_type}"
                ));
            }
            if *actual_notnull != notnull {
                return Err(format!(
                    "Table {table} column {col_name} notnull mismatch: expected {notnull}, found {actual_notnull}"
                ));
            }
            if *actual_pk != pk {
                return Err(format!(
                    "Table {table} column {col_name} pk mismatch: expected {pk}, found {actual_pk}"
                ));
            }
        }

        // Foreign-key definitions: `PRAGMA foreign_key_check` only checks rows
        // against definitions that exist, so a missing or altered definition
        // must be caught here, against the registered reference.
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&ref_conn, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&ref_conn, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
    }

    // 3. Required compound uniqueness constraints
    // practice_test_items: compound UNIQUE(version_id, ordinal)
    {
        let mut idx_stmt = connection
            .prepare("SELECT name, [unique] FROM pragma_index_list('practice_test_items')")
            .map_err(|e| format!("Inspect index list items: {e}"))?;
        let indexes: Vec<(String, i64)> = idx_stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("Query index list items: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect index list items: {e}"))?;

        let has_compound_unique = indexes.iter().any(|(idx_name, is_unique)| {
            if *is_unique != 1 {
                return false;
            }
            let mut info_stmt = match connection.prepare(&format!(
                "SELECT name FROM pragma_index_info('{idx_name}') ORDER BY seqno ASC"
            )) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let cols: Vec<String> = info_stmt
                .query_map([], |r| r.get(0))
                .ok()
                .map(|m| m.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
            cols == ["version_id", "ordinal"]
        });

        if !has_compound_unique {
            return Err("The backup table practice_test_items is missing compound UNIQUE constraint on (version_id, ordinal).".to_string());
        }
    }

    // practice_responses: compound UNIQUE(attempt_id, item_id)
    {
        let mut idx_stmt = connection
            .prepare("SELECT name, [unique] FROM pragma_index_list('practice_responses')")
            .map_err(|e| format!("Inspect index list responses: {e}"))?;
        let indexes: Vec<(String, i64)> = idx_stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("Query index list responses: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect index list responses: {e}"))?;

        let has_compound_unique = indexes.iter().any(|(idx_name, is_unique)| {
            if *is_unique != 1 {
                return false;
            }
            let mut info_stmt = match connection.prepare(&format!(
                "SELECT name FROM pragma_index_info('{idx_name}') ORDER BY seqno ASC"
            )) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let cols: Vec<String> = info_stmt
                .query_map([], |r| r.get(0))
                .ok()
                .map(|m| m.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
            cols == ["attempt_id", "item_id"]
        });

        if !has_compound_unique {
            return Err("The backup table practice_responses is missing compound UNIQUE constraint on (attempt_id, item_id).".to_string());
        }
    }

    // 4. Required partial unique indexes with key and predicate inspection
    let required_unique_indexes: &[(&str, &str, &[&str], &str)] = &[
        (
            "practice_test_versions",
            "uq_active_practice_version",
            &["source_material_id"],
            "is_active = 1",
        ),
        (
            "practice_attempts",
            "uq_single_in_progress_attempt",
            &["source_material_id"],
            "status = 'in_progress'",
        ),
    ];

    for &(table, index_name, expected_cols, where_clause) in required_unique_indexes {
        let unique_val: Option<i64> = connection
            .query_row(
                &format!("SELECT [unique] FROM pragma_index_list('{table}') WHERE name = ?1"),
                [index_name],
                |r| r.get(0),
            )
            .ok();

        match unique_val {
            Some(1) => {
                let mut info_stmt = connection
                    .prepare(&format!(
                        "SELECT name FROM pragma_index_info('{index_name}') ORDER BY seqno ASC"
                    ))
                    .map_err(|e| format!("Inspect index info {index_name}: {e}"))?;
                let cols: Vec<String> = info_stmt
                    .query_map([], |r| r.get(0))
                    .map_err(|e| format!("Query index info {index_name}: {e}"))?
                    .collect::<Result<_, _>>()
                    .map_err(|e| format!("Collect index info {index_name}: {e}"))?;

                if cols.as_slice() != expected_cols {
                    return Err(format!(
                        "The backup unique index {index_name} has invalid key columns: expected {expected_cols:?}, found {cols:?}"
                    ));
                }

                let sql: Option<String> = connection
                    .query_row(
                        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
                        [index_name],
                        |r| r.get(0),
                    )
                    .ok();
                if let Some(s) = sql {
                    let s_norm = s.to_ascii_lowercase();
                    if !s_norm.contains("unique")
                        || !s_norm.contains(&where_clause.to_ascii_lowercase())
                        || !s_norm.contains("source_material_id is not null")
                    {
                        return Err(format!(
                            "The backup unique index {index_name} does not match expected predicate."
                        ));
                    }
                }
            }
            Some(_) => {
                return Err(format!(
                    "The backup index {index_name} must be a UNIQUE index."
                ));
            }
            None => {
                return Err(format!(
                    "The backup is missing required unique index: {index_name}"
                ));
            }
        }
    }

    // Required secondary indexes with key column verification against reference schema
    let required_indexes = [
        ("practice_test_versions", "idx_practice_versions_history"),
        ("practice_test_items", "idx_practice_items_version"),
        ("practice_attempts", "idx_practice_attempts_material"),
        ("practice_attempts", "idx_practice_attempts_version"),
        ("practice_responses", "idx_practice_responses_attempt"),
        ("practice_session_operations", "idx_practice_ops_history"),
        ("practice_session_operations", "idx_practice_ops_attempt"),
    ];

    for (table, index_name) in required_indexes {
        let exists: bool = connection
            .query_row(
                &format!("SELECT 1 FROM pragma_index_list('{table}') WHERE name = ?1"),
                [index_name],
                |_| Ok(true),
            )
            .ok()
            .unwrap_or(false);
        if !exists {
            return Err(format!(
                "The backup is missing required index: {index_name}"
            ));
        }

        let mut ref_info = ref_conn
            .prepare(&format!(
                "SELECT name FROM pragma_index_info('{index_name}') ORDER BY seqno ASC"
            ))
            .map_err(|e| format!("Inspect ref index info {index_name}: {e}"))?;
        let ref_cols: Vec<String> = ref_info
            .query_map([], |r| r.get(0))
            .map_err(|e| format!("Query ref index info {index_name}: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect ref index info {index_name}: {e}"))?;

        let mut info_stmt = connection
            .prepare(&format!(
                "SELECT name FROM pragma_index_info('{index_name}') ORDER BY seqno ASC"
            ))
            .map_err(|e| format!("Inspect index info {index_name}: {e}"))?;
        let cols: Vec<String> = info_stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| format!("Query index info {index_name}: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect index info {index_name}: {e}"))?;

        if cols != ref_cols {
            return Err(format!(
                "Index {index_name} key columns mismatch: expected {ref_cols:?}, found {cols:?}"
            ));
        }
    }

    // 5. Relational orphaned records and cross-version validation
    let orphan_items: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_test_items i LEFT JOIN practice_test_versions v ON i.version_id = v.id WHERE v.id IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check orphan items: {e}"))?;
    if orphan_items > 0 {
        return Err(
            "The backup contains practice test items without a parent version.".to_string(),
        );
    }

    let orphan_attempts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_attempts a LEFT JOIN practice_test_versions v ON a.version_id = v.id WHERE v.id IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check orphan attempts: {e}"))?;
    if orphan_attempts > 0 {
        return Err("The backup contains practice attempts without a parent version.".to_string());
    }

    let orphan_responses: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_responses r
             LEFT JOIN practice_attempts a ON r.attempt_id = a.id
             LEFT JOIN practice_test_items i ON r.item_id = i.id
             WHERE a.id IS NULL OR i.id IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check orphan responses: {e}"))?;
    if orphan_responses > 0 {
        return Err(
            "The backup contains practice responses without a parent attempt or item.".to_string(),
        );
    }

    let cross_version: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_responses r
             JOIN practice_attempts a ON r.attempt_id = a.id
             JOIN practice_test_items i ON r.item_id = i.id
             WHERE a.version_id != i.version_id",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check cross-version responses: {e}"))?;
    if cross_version > 0 {
        return Err(
            "The backup contains practice responses referencing items from a different version."
                .to_string(),
        );
    }

    // Cross-material consistency:
    // Every attempt's source_material_id must match its version's source_material_id (if not detached)
    let cross_material: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_attempts a
             JOIN practice_test_versions v ON a.version_id = v.id
             WHERE (a.source_material_id IS NOT NULL AND (v.source_material_id IS NULL OR a.source_material_id != v.source_material_id))
                OR (a.source_material_id IS NULL AND v.source_material_id IS NOT NULL AND v.is_active = 1)",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check cross-material attempts: {e}"))?;
    if cross_material > 0 {
        return Err("The backup contains practice attempts whose material ownership does not match their version.".to_string());
    }

    let invalid_op_history: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_session_operations o
             JOIN practice_attempts a ON o.attempt_id = a.id
             JOIN practice_test_versions v ON a.version_id = v.id
             WHERE o.history_key != v.history_key",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check operation history keys: {e}"))?;
    if invalid_op_history > 0 {
        return Err("The backup contains operation receipts whose history_key does not match attempt version.".to_string());
    }

    let duplicate_active_versions: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM (
                 SELECT source_material_id FROM practice_test_versions
                 WHERE is_active = 1 AND source_material_id IS NOT NULL
                 GROUP BY source_material_id HAVING COUNT(*) > 1
             )",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check duplicate active versions: {e}"))?;
    if duplicate_active_versions > 0 {
        return Err(
            "The backup contains multiple active versions for the same study material.".to_string(),
        );
    }

    let duplicate_in_progress: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM (
                 SELECT source_material_id FROM practice_attempts
                 WHERE status = 'in_progress' AND source_material_id IS NOT NULL
                 GROUP BY source_material_id HAVING COUNT(*) > 1
             )",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check duplicate in-progress attempts: {e}"))?;
    if duplicate_in_progress > 0 {
        return Err(
            "The backup contains multiple in-progress attempts for the same study material."
                .to_string(),
        );
    }

    let detached_active: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM practice_test_versions WHERE source_material_id IS NULL AND is_active = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check detached version status: {e}"))?;
    if detached_active > 0 {
        return Err(
            "The backup contains detached practice test versions that are marked active."
                .to_string(),
        );
    }

    // 6. Validate every frozen version has 1..=200 complete items with contiguous zero-based ordinals
    let mut ver_stmt = connection
        .prepare("SELECT id FROM practice_test_versions")
        .map_err(|e| format!("Failed to query versions: {e}"))?;
    let ver_ids: Vec<String> = ver_stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| format!("Failed to read versions: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Collect versions error: {e}"))?;

    for ver_id in &ver_ids {
        let mut item_stmt = connection
            .prepare(
                "SELECT id, ordinal, question_text, options_json, correct_index, explanation, source_page
                 FROM practice_test_items WHERE version_id = ?1 ORDER BY ordinal ASC",
            )
            .map_err(|e| format!("Failed to prepare version items query: {e}"))?;
        type VersionItemRow = (String, i64, String, String, i64, String, Option<i64>);
        let items: Vec<VersionItemRow> = item_stmt
            .query_map([ver_id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            })
            .map_err(|e| format!("Query items error: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Collect items error: {e}"))?;

        if items.is_empty() || items.len() > 200 {
            return Err(format!(
                "Practice test version {ver_id} has invalid question count: {}",
                items.len()
            ));
        }

        for (expected_ordinal, item) in items.iter().enumerate() {
            let (
                item_id,
                ordinal,
                question_text,
                options_json,
                correct_index,
                explanation,
                source_page,
            ) = item;
            if *ordinal != expected_ordinal as i64 {
                return Err(format!(
                    "Item {item_id} in version {ver_id} has non-contiguous ordinal: expected {expected_ordinal}, found {ordinal}"
                ));
            }
            if question_text.trim().is_empty() || question_text.chars().count() > 10_000 {
                return Err(format!("Item {item_id} has invalid question text length"));
            }
            if explanation.chars().count() > 5_000 {
                return Err(format!(
                    "Item {item_id} has explanation exceeding 5000 characters"
                ));
            }
            if let Some(sp) = source_page {
                if !(1..=1_000).contains(sp) {
                    return Err(format!(
                        "Item {item_id} has out-of-bounds source page: {sp}"
                    ));
                }
            }

            let options: Vec<serde_json::Value> = serde_json::from_str(options_json)
                .map_err(|_| format!("Item {item_id} has invalid options JSON"))?;
            if options.len() < 2 || options.len() > 8 {
                return Err(format!(
                    "Item {item_id} has out-of-bounds option count: {}",
                    options.len()
                ));
            }
            for opt in &options {
                let opt_str = opt
                    .as_str()
                    .ok_or_else(|| format!("Item {item_id} options must be string values"))?;
                if opt_str.trim().is_empty() || opt_str.chars().count() > 1_000 {
                    return Err(format!("Item {item_id} has invalid option length"));
                }
            }
            if *correct_index < 0 || *correct_index as usize >= options.len() {
                return Err(format!(
                    "Item {item_id} has out-of-bounds correct index: {correct_index}"
                ));
            }
        }
    }

    // 7. Validate responses choice flags, selected_index upper bounds, and is_correct
    let mut resp_stmt = connection
        .prepare(
            "SELECT r.id, r.selected_index, r.is_dont_know, r.is_correct, i.options_json, i.correct_index, r.answered_at
             FROM practice_responses r
             JOIN practice_test_items i ON r.item_id = i.id",
        )
        .map_err(|e| format!("Failed to prepare responses check: {e}"))?;
    let resp_rows = resp_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| format!("Failed to query responses: {e}"))?;

    for r_res in resp_rows {
        let (resp_id, sel_idx, is_dk, is_cor, options_json, item_correct_index, answered_at) =
            r_res.map_err(|e| format!("Failed to read response row: {e}"))?;

        if answered_at.trim().is_empty() {
            return Err(format!(
                "Response {resp_id} has empty answered_at timestamp"
            ));
        }

        if is_dk == 1 {
            if sel_idx.is_some() || is_cor != 0 {
                return Err(format!(
                    "Response {resp_id} with is_dont_know=1 must have NULL selected_index and is_correct=0"
                ));
            }
        } else {
            let idx = sel_idx.ok_or_else(|| {
                format!(
                    "Response {resp_id} with is_dont_know=0 must have a non-null selected_index"
                )
            })?;
            if idx < 0 {
                return Err(format!(
                    "Response {resp_id} has negative selected_index: {idx}"
                ));
            }
            let options: Vec<serde_json::Value> =
                serde_json::from_str(&options_json).map_err(|_| {
                    format!("Response {resp_id} references item with invalid options JSON")
                })?;
            if idx as usize >= options.len() {
                return Err(format!(
                    "Response {resp_id} has selected_index {idx} out of bounds for {} options",
                    options.len()
                ));
            }
            let expected_cor = if idx == item_correct_index { 1 } else { 0 };
            if is_cor != expected_cor {
                return Err(format!(
                    "Response {resp_id} has incorrect is_correct value (stored: {is_cor}, expected: {expected_cor})"
                ));
            }
        }
    }

    // 8. Completed and in-progress attempt derivations, status, timestamps, and scores
    let mut stmt = connection
        .prepare(
            "SELECT id, version_id, status, started_at, completed_at, revision, total_questions,
                    answered_count, correct_count, incorrect_count, dont_know_count, score_percent
             FROM practice_attempts",
        )
        .map_err(|e| format!("Failed to prepare attempts query: {e}"))?;

    let attempt_rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
                r.get::<_, i64>(10)?,
                r.get::<_, Option<f64>>(11)?,
            ))
        })
        .map_err(|e| format!("Failed to query attempts: {e}"))?;

    for row_res in attempt_rows {
        let (
            att_id,
            ver_id,
            status,
            started_at,
            completed_at,
            revision,
            stored_total,
            stored_ans,
            stored_cor,
            stored_inc,
            stored_dk,
            stored_pct,
        ) = row_res.map_err(|e| format!("Failed to read attempt row: {e}"))?;

        if started_at.trim().is_empty() {
            return Err(format!("Attempt {att_id} has empty started_at timestamp"));
        }
        if revision < 0 {
            return Err(format!(
                "Attempt {att_id} has negative revision: {revision}"
            ));
        }
        if stored_ans < 0 || stored_cor < 0 || stored_inc < 0 || stored_dk < 0 {
            return Err(format!("Attempt {att_id} has negative counts"));
        }

        let actual_total: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM practice_test_items WHERE version_id = ?1",
                [&ver_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to count items: {e}"))?;

        let actual_ans: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?1",
                [&att_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to count responses: {e}"))?;

        if stored_ans > stored_total {
            return Err(format!(
                "Attempt {att_id} answered_count exceeds total_questions"
            ));
        }

        match status.as_str() {
            "in_progress" => {
                if completed_at.is_some() {
                    return Err(format!(
                        "In-progress attempt {att_id} must have NULL completed_at"
                    ));
                }
                if stored_total != actual_total {
                    return Err(format!(
                        "In-progress attempt {att_id} total_questions ({stored_total}) does not match frozen version ({actual_total})"
                    ));
                }
                if stored_ans != actual_ans {
                    return Err(format!(
                        "In-progress attempt {att_id} answered_count ({stored_ans}) does not match response count ({actual_ans})"
                    ));
                }
            }
            "completed" => {
                let comp_at = completed_at.ok_or_else(|| {
                    format!("The backup contains completed practice attempt {att_id} with no completion timestamp.")
                })?;
                if comp_at.trim().is_empty() {
                    return Err(format!("Attempt {att_id} has empty completed_at timestamp"));
                }

                let stored_score = stored_pct.ok_or_else(|| {
                    format!("Completed practice attempt {att_id} has null score_percent")
                })?;

                if stored_total != actual_total {
                    return Err("The backup contains a completed attempt whose total questions does not match its frozen version.".to_string());
                }

                if stored_ans != actual_ans {
                    return Err("The backup contains a completed practice attempt whose answered count does not match stored responses.".to_string());
                }

                let derived_cor: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM practice_responses r
                         JOIN practice_test_items i ON r.item_id = i.id
                         WHERE r.attempt_id = ?1 AND r.is_dont_know = 0 AND r.selected_index = i.correct_index",
                        [&att_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| format!("Failed to derive correct count: {e}"))?;

                let actual_dk: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?1 AND is_dont_know = 1",
                        [&att_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| format!("Failed to count dont_know: {e}"))?;

                let derived_inc: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM practice_responses r
                         JOIN practice_test_items i ON r.item_id = i.id
                         WHERE r.attempt_id = ?1 AND r.is_dont_know = 0 AND r.selected_index != i.correct_index",
                        [&att_id],
                        |r| r.get(0),
                    )
                    .map_err(|e| format!("Failed to derive incorrect count: {e}"))?;

                if stored_cor != derived_cor || stored_dk != actual_dk || stored_inc != derived_inc
                {
                    return Err("The backup contains completed practice attempt tallies that do not match stored responses.".to_string());
                }

                let expected_score = if actual_total > 0 {
                    ((derived_cor as f64 / actual_total as f64) * 1000.0).round() / 10.0
                } else {
                    0.0
                };

                // Exact match on the one-decimal grid (no 0.05 tolerance)
                if (stored_score - expected_score).abs() > 1e-6 {
                    return Err("The backup contains a completed practice attempt with inconsistent score percentage.".to_string());
                }
            }
            "abandoned" => {
                if completed_at.is_none() {
                    return Err(format!(
                        "Abandoned attempt {att_id} must have a completion timestamp"
                    ));
                }
                if stored_total != actual_total {
                    return Err(format!(
                        "Abandoned attempt {att_id} total_questions ({stored_total}) does not match frozen version ({actual_total})"
                    ));
                }
            }
            other => {
                return Err(format!("Attempt {att_id} has invalid status: {other}"));
            }
        }
    }

    // 9. Operations and receipts validation
    let mut op_stmt = connection
        .prepare(
            "SELECT operation_id, action, request_hash, applied_at, result_json, history_key, attempt_id, is_erased
             FROM practice_session_operations",
        )
        .map_err(|e| format!("Failed to prepare receipts query: {e}"))?;

    let op_rows = op_stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })
        .map_err(|e| format!("Failed to query receipts: {e}"))?;

    for row_res in op_rows {
        let (op_id, action, req_hash, applied_at, result_json, hist_key, att_id, is_erased) =
            row_res.map_err(|e| format!("Failed to read receipt: {e}"))?;

        if !is_valid_uuid_v4(&op_id) {
            return Err(format!("Operation receipt {op_id} is not a valid UUIDv4"));
        }

        if req_hash.len() != 64 || !req_hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!(
                "Operation receipt {op_id} has invalid request hash format"
            ));
        }

        if applied_at.trim().is_empty() || !applied_at.contains('T') || applied_at.len() < 19 {
            return Err(format!(
                "Operation receipt {op_id} has invalid ISO applied_at timestamp: {applied_at}"
            ));
        }

        if hist_key.trim().is_empty() || att_id.trim().is_empty() {
            return Err(
                "The backup contains operation receipts with missing required fields.".to_string(),
            );
        }

        if ![
            "start_or_resume",
            "record_response",
            "complete_attempt",
            "abandon_attempt",
            "retake_attempt",
            "erase_history",
        ]
        .contains(&action.as_str())
        {
            return Err(format!(
                "The backup contains operation receipt with unknown action: {action}"
            ));
        }

        let parsed_result: serde_json::Value =
            serde_json::from_str(&result_json).map_err(|_| {
                format!("The backup contains malformed receipt JSON in operation {op_id}")
            })?;

        if is_erased == 1 {
            if result_json != "null" || !parsed_result.is_null() {
                return Err("The backup contains erased operation receipts that still retain result content.".to_string());
            }
        } else {
            if parsed_result.is_null() {
                return Err(format!(
                    "The backup contains non-erased operation receipt {op_id} with null result."
                ));
            }

            let obj = parsed_result
                .as_object()
                .ok_or_else(|| format!("Operation receipt {op_id} result must be a JSON object"))?;

            if obj.is_empty() {
                return Err(format!(
                    "The backup contains empty-object result in operation receipt {op_id}"
                ));
            }

            if action == "erase_history" {
                let h_key = obj
                    .get("historyKey")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        format!("Operation receipt {op_id} erase_history missing historyKey")
                    })?;
                if h_key != hist_key {
                    return Err(format!(
                        "Operation receipt {op_id} erase_history historyKey ({h_key}) does not match receipt history_key ({hist_key})"
                    ));
                }
                let erased_field = obj.get("erased").and_then(|v| v.as_bool());
                if erased_field != Some(true) {
                    return Err(format!(
                        "Operation receipt {op_id} erase_history missing erased boolean flag"
                    ));
                }
                for forbidden in [
                    "selectedIndex",
                    "responses",
                    "questions",
                    "scorePercent",
                    "correctIndex",
                    "isCorrect",
                ] {
                    if obj.contains_key(forbidden) {
                        return Err("The backup contains erased operation receipts that still retain result content.".to_string());
                    }
                }
            } else {
                let res_attempt_id =
                    obj.get("attemptId")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            format!("Operation receipt {op_id} result is missing attemptId")
                        })?;
                if res_attempt_id != att_id {
                    return Err(format!(
                        "Operation receipt {op_id} result attemptId ({res_attempt_id}) does not match receipt attempt_id ({att_id})"
                    ));
                }

                let res_rev = obj
                    .get("revision")
                    .or_else(|| obj.get("currentRevision"))
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| {
                        format!("Operation receipt {op_id} result is missing revision")
                    })?;
                if res_rev < 0 {
                    return Err(format!(
                        "Operation receipt {op_id} result has negative revision"
                    ));
                }

                match action.as_str() {
                    "start_or_resume" | "retake_attempt" => {
                        let v_id =
                            obj.get("versionId")
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    format!(
                                        "Operation receipt {op_id} start result missing versionId"
                                    )
                                })?;
                        if v_id.trim().is_empty() {
                            return Err(format!(
                                "Operation receipt {op_id} start result has empty versionId"
                            ));
                        }
                        let attempt_version_id: Option<String> = connection
                            .query_row(
                                "SELECT version_id FROM practice_attempts WHERE id = ?1",
                                [&att_id],
                                |r| r.get(0),
                            )
                            .ok();
                        if let Some(expected_ver) = attempt_version_id {
                            if v_id != expected_ver {
                                return Err(format!(
                                "Operation receipt {op_id} start result versionId ({v_id}) does not match attempt frozen version ({expected_ver})"
                            ));
                            }
                        }
                        let status =
                            obj.get("status").and_then(|v| v.as_str()).ok_or_else(|| {
                                format!("Operation receipt {op_id} start result missing status")
                            })?;
                        if status != "in_progress" {
                            return Err(format!(
                                "Operation receipt {op_id} start result status must be in_progress"
                            ));
                        }
                    }
                    "record_response" => {
                        let ans_at =
                            obj.get("answeredAt")
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    format!(
                                    "Operation receipt {op_id} response result missing answeredAt"
                                )
                                })?;
                        if ans_at.trim().is_empty() {
                            return Err(format!(
                                "Operation receipt {op_id} response result has empty answeredAt"
                            ));
                        }
                    }
                    "complete_attempt" => {
                        let status =
                            obj.get("status").and_then(|v| v.as_str()).ok_or_else(|| {
                                format!("Operation receipt {op_id} complete result missing status")
                            })?;
                        if status != "completed" {
                            return Err(format!(
                            "Operation receipt {op_id} complete result status must be completed"
                        ));
                        }
                        let comp_at =
                            obj.get("completedAt")
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    format!(
                                    "Operation receipt {op_id} complete result missing completedAt"
                                )
                                })?;
                        if comp_at.trim().is_empty() {
                            return Err(format!(
                                "Operation receipt {op_id} complete result has empty completedAt"
                            ));
                        }
                        if obj.get("scorePercent").and_then(|v| v.as_f64()).is_none() {
                            return Err(format!(
                                "Operation receipt {op_id} complete result missing scorePercent"
                            ));
                        }
                        if obj.get("correctCount").and_then(|v| v.as_i64()).is_none()
                            || obj.get("incorrectCount").and_then(|v| v.as_i64()).is_none()
                            || obj.get("dontKnowCount").and_then(|v| v.as_i64()).is_none()
                            || obj
                                .get("unansweredCount")
                                .and_then(|v| v.as_i64())
                                .is_none()
                        {
                            return Err(format!(
                                "Operation receipt {op_id} complete result missing tallies"
                            ));
                        }
                    }
                    "abandon_attempt" => {
                        let status =
                            obj.get("status").and_then(|v| v.as_str()).ok_or_else(|| {
                                format!("Operation receipt {op_id} abandon result missing status")
                            })?;
                        if status != "abandoned" {
                            return Err(format!(
                                "Operation receipt {op_id} abandon result status must be abandoned"
                            ));
                        }
                        let comp_at =
                            obj.get("completedAt")
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    format!(
                                    "Operation receipt {op_id} abandon result missing completedAt"
                                )
                                })?;
                        if comp_at.trim().is_empty() {
                            return Err(format!(
                                "Operation receipt {op_id} abandon result has empty completedAt"
                            ));
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // 10. Required triggers with exact registered migration contract comparison
    for trigger_name in [
        "trg_enforce_response_item_version_insert",
        "trg_enforce_response_item_version_update",
        "trg_cleanup_material_delete",
    ] {
        let actual_sql: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
                [trigger_name],
                |r| r.get(0),
            )
            .ok();
        let Some(sql) = actual_sql else {
            return Err(format!(
                "The backup is missing required trigger: {trigger_name}"
            ));
        };

        let ref_sql: String = ref_conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
                [trigger_name],
                |r| r.get(0),
            )
            .map_err(|e| format!("Failed to read ref trigger {trigger_name}: {e}"))?;

        let norm_actual = normalize_sql(&sql);
        let norm_ref = normalize_sql(&ref_sql);
        if norm_actual != norm_ref {
            return Err(format!(
                "The backup trigger {trigger_name} does not match the registered migration contract."
            ));
        }

        if trigger_name.contains("enforce_response_item_version") {
            if !norm_actual.contains("raise(abort")
                || !norm_actual.contains("practice_attempts")
                || !norm_actual.contains("practice_test_items")
            {
                return Err(format!(
                    "Trigger {trigger_name} is missing required version enforcement logic."
                ));
            }
        } else if trigger_name == "trg_cleanup_material_delete"
            && (!norm_actual.contains("is_erased = 1")
                || !norm_actual.contains("delete from practice_attempts")
                || !norm_actual.contains("is_active = 0"))
        {
            return Err(format!(
                "Trigger {trigger_name} is missing required material deletion cleanup logic."
            ));
        }
    }

    Ok(())
}

/* ------------------------------------------------------------------ */
/* Schema 12: card reviews (TS twin: `validateCardReviewState`)        */
/* ------------------------------------------------------------------ */

pub(super) const CARD_TABLES: [&str; 6] = [
    "card_review_generations",
    "card_versions",
    "card_items",
    "card_review_state",
    "card_review_events",
    "card_review_operations",
];

pub(super) fn card_count(
    connection: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<i64, String> {
    connection
        .query_row(sql, params, |r| r.get(0))
        .map_err(|e| format!("Could not check card reviews: {e}"))
}

pub(super) fn card_timestamp(value: &str, owner: &str) -> Result<i64, String> {
    crate::card_reviews::parse_iso_ms(value)
        .ok_or_else(|| format!("{owner} has a malformed timestamp."))
}

pub(super) fn card_json_object(
    text: &str,
    owner: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(map)) => Ok(map),
        Ok(_) => Err(format!("{owner} must be a JSON object.")),
        Err(_) => Err(format!("{owner} has malformed JSON.")),
    }
}

pub(super) fn card_exact_keys(
    map: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
    owner: &str,
) -> Result<(), String> {
    if map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key)) {
        Ok(())
    } else {
        Err(format!("{owner} has unexpected fields."))
    }
}

/// A JSON value that JavaScript's `Number.isInteger` accepts, as an i64.
pub(super) fn card_json_int(value: Option<&serde_json::Value>) -> Option<i64> {
    match value {
        Some(serde_json::Value::Number(n)) => n.as_i64().or_else(|| {
            n.as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15)
                .map(|f| f as i64)
        }),
        _ => None,
    }
}

pub(super) fn card_json_str(value: Option<&serde_json::Value>) -> Option<&str> {
    match value {
        Some(serde_json::Value::String(s)) => Some(s),
        _ => None,
    }
}

/// A stored `simple-v1` schedule: exact fields, the step's delay from the review time.
pub(super) fn card_check_schedule(
    map: &serde_json::Map<String, serde_json::Value>,
    owner: &str,
) -> Result<(), String> {
    card_exact_keys(
        map,
        &[
            "dueAt",
            "lapses",
            "lastReviewedAt",
            "reps",
            "schedulerVersion",
            "step",
        ],
        owner,
    )?;
    if card_json_str(map.get("schedulerVersion")) != Some(crate::card_reviews::SCHEDULER_VERSION) {
        return Err(format!("{owner} has an unknown scheduler version."));
    }
    let step = card_json_int(map.get("step"))
        .filter(|s| (-1..=7).contains(s))
        .ok_or_else(|| format!("{owner} has an invalid step."))?;
    let reps = card_json_int(map.get("reps"));
    let lapses = card_json_int(map.get("lapses"));
    if !matches!((reps, lapses), (Some(r), Some(l)) if r >= 1 && l >= 0) {
        return Err(format!("{owner} has invalid counts."));
    }
    let last = card_timestamp(
        card_json_str(map.get("lastReviewedAt")).unwrap_or(""),
        owner,
    )?;
    let due = card_timestamp(card_json_str(map.get("dueAt")).unwrap_or(""), owner)?;
    if Some(due - last) != crate::card_reviews::step_delay_ms(step) {
        return Err(format!(
            "{owner} has a due time inconsistent with its step."
        ));
    }
    Ok(())
}

pub(super) fn card_index_sql(connection: &Connection, index: &str) -> Option<String> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
            [index],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
}

pub(super) fn card_index_columns(
    connection: &Connection,
    index: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT name FROM pragma_index_info('{index}') ORDER BY seqno ASC"
        ))
        .map_err(|e| format!("Could not inspect index {index}: {e}"))?;
    let columns = statement
        .query_map([], |r| r.get(0))
        .map_err(|e| format!("Could not inspect index {index}: {e}"))?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| format!("Could not inspect index {index}: {e}"));
    columns
}

/// The schema-12 card-review contract, run by startup initialization and
/// archive inspection. Every rule matches `validateCardReviewState` in
/// `src/data/practiceStateValidation.ts`; the shared accept/refuse fixture is
/// `src-tauri/fixtures/card-validation/cases.json`.
pub(crate) fn verify_schema_12_card_semantics(connection: &Connection) -> Result<(), String> {
    use crate::card_reviews::{
        canonical_cards_json, is_lower_hex_64, is_valid_card_text, sha256_hex, step_delay_ms,
        CanonicalCard, FLAG_REASONS, ITEM_ACTIONS, MAX_BACK_CHARS, MAX_FRONT_CHARS,
        MAX_SOURCE_PAGE, SCHEDULER_VERSION,
    };
    let uuid_v4 =
        |value: &str| is_valid_uuid_v4(value) && !value.bytes().any(|b| b.is_ascii_uppercase());

    {
        let mut fk = connection
            .prepare("PRAGMA foreign_key_check")
            .map_err(|e| format!("Could not check foreign keys: {e}"))?;
        let mut rows = fk
            .query([])
            .map_err(|e| format!("Could not check foreign keys: {e}"))?;
        if rows
            .next()
            .map_err(|e| format!("Could not check foreign keys: {e}"))?
            .is_some()
        {
            return Err("The database violates foreign key constraints.".to_string());
        }
    }
    let reference = get_reference_schema_connection()?;

    // 1. Tables, columns, foreign keys and CHECK constraints against the reference.
    for table in CARD_TABLES {
        if card_count(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            &[&table],
        )? != 1
        {
            return Err(format!("The database is missing required table: {table}"));
        }
        let columns = |c: &Connection| -> Result<Vec<(String, String, i64, i64)>, String> {
            let mut statement = c
                .prepare(&format!(
                    "SELECT name, type, [notnull], pk FROM pragma_table_info('{table}') ORDER BY name"
                ))
                .map_err(|e| format!("Could not inspect {table}: {e}"))?;
            let rows = statement
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?.to_ascii_lowercase(),
                        r.get(2)?,
                        r.get(3)?,
                    ))
                })
                .map_err(|e| format!("Could not inspect {table}: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Could not inspect {table}: {e}"));
            rows
        };
        if columns(connection)? != columns(&reference)? {
            return Err(format!(
                "Table {table} columns do not match the registered migration contract."
            ));
        }
        if foreign_key_shapes(connection, table)? != foreign_key_shapes(&reference, table)? {
            return Err(format!(
                "Table {table} foreign keys do not match the registered migration contract."
            ));
        }
        if check_constraints(&table_sql(connection, table)?)
            != check_constraints(&table_sql(&reference, table)?)
        {
            return Err(format!(
                "Table {table} CHECK constraints do not match the registered migration contract."
            ));
        }
    }

    // 2. Uniqueness and indexes.
    for (table, expected) in [
        ("card_versions", ["source_material_id", "content_hash"]),
        ("card_items", ["version_id", "ordinal"]),
    ] {
        let mut statement = connection
            .prepare(&format!(
                "SELECT name, [unique], partial FROM pragma_index_list('{table}')"
            ))
            .map_err(|e| format!("Could not inspect indexes of {table}: {e}"))?;
        let indexes = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| format!("Could not inspect indexes of {table}: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not inspect indexes of {table}: {e}"))?;
        let mut found = false;
        for (name, unique, partial) in indexes {
            if unique == 1 && partial == 0 && card_index_columns(connection, &name)? == expected {
                found = true;
            }
        }
        if !found {
            return Err(format!(
                "Table {table} is missing compound UNIQUE constraint on ({}).",
                expected.join(", ")
            ));
        }
    }
    let active_unique: Option<i64> = connection
        .query_row(
            "SELECT [unique] FROM pragma_index_list('card_versions') WHERE name = 'uq_active_card_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    if active_unique != Some(1) {
        return Err(
            "The database is missing required unique index: uq_active_card_version".to_string(),
        );
    }
    for (table, index) in [
        ("card_versions", "uq_active_card_version"),
        ("card_review_state", "idx_card_state_due"),
        ("card_review_events", "idx_card_events_item"),
        ("card_review_operations", "idx_card_ops_material"),
    ] {
        if card_count(
            connection,
            &format!("SELECT COUNT(*) FROM pragma_index_list('{table}') WHERE name = ?1"),
            &[&index],
        )? == 0
        {
            return Err(format!("The database is missing required index: {index}"));
        }
        match (
            card_index_sql(connection, index),
            card_index_sql(&reference, index),
        ) {
            (Some(mine), Some(theirs)) if normalize_sql(&mine) == normalize_sql(&theirs) => {}
            _ => {
                return Err(format!(
                    "Index {index} does not match the registered migration contract."
                ))
            }
        }
    }

    // 3. The deletion trigger.
    {
        let trigger = |c: &Connection| -> Option<String> {
            c.query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_card_ops_material_delete'",
                [],
                |r| r.get(0),
            )
            .ok()
        };
        let Some(mine) = trigger(connection) else {
            return Err(
                "The database is missing required trigger: trg_card_ops_material_delete"
                    .to_string(),
            );
        };
        if trigger(&reference).map(|s| normalize_sql(&s)) != Some(normalize_sql(&mine)) {
            return Err(
                "The trigger trg_card_ops_material_delete does not match the registered migration contract."
                    .to_string(),
            );
        }
    }

    // 4. Ownership.
    for (sql, problem) in [
        (
            "SELECT COUNT(*) FROM card_review_state s
             JOIN card_items i ON i.id = s.item_id JOIN card_versions v ON v.id = i.version_id
             WHERE s.source_material_id != v.source_material_id",
            "card review state owned by a material other than its card's",
        ),
        (
            "SELECT COUNT(*) FROM (SELECT source_material_id FROM card_versions WHERE is_active = 1
             GROUP BY source_material_id HAVING COUNT(*) > 1)",
            "more than one active card version for a material",
        ),
    ] {
        if card_count(connection, sql, &[])? > 0 {
            return Err(format!("The database contains {problem}."));
        }
    }

    // 5. Identity: every snapshot is recomputable from its stored text.
    type VersionRow = (String, String, String, i64, String, Option<String>);
    let versions: Vec<VersionRow> = {
        let mut statement = connection
            .prepare("SELECT id, source_material_id, content_hash, card_count, created_at, first_reviewed_at FROM card_versions")
            .map_err(|e| format!("Could not read card versions: {e}"))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })
            .map_err(|e| format!("Could not read card versions: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read card versions: {e}"))?;
        rows
    };
    // Schema 16 keeps who wrote each card beside its snapshot; a card's
    // origin is part of its hash, so it is read back for the recomputation.
    let has_origins = card_count(
        connection,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'card_item_origins'",
        &[],
    )? == 1;
    let item_sql = if has_origins {
        "SELECT i.id, i.ordinal, i.front, i.back, i.source_page, o.origin FROM card_items i
         LEFT JOIN card_item_origins o ON o.item_id = i.id
         WHERE i.version_id = ?1 ORDER BY i.ordinal ASC"
    } else {
        "SELECT id, ordinal, front, back, source_page, NULL FROM card_items WHERE version_id = ?1 ORDER BY ordinal ASC"
    };
    for (version_id, material_id, content_hash, card_count_value, created_at, first_reviewed_at) in
        versions
    {
        let owner = format!("Card version {version_id}");
        card_timestamp(&created_at, &owner)?;
        if let Some(first) = &first_reviewed_at {
            card_timestamp(first, &owner)?;
        }
        if sha256_hex(&format!("{material_id}\u{0}{content_hash}")) != version_id {
            return Err(format!(
                "{owner} cannot be recomputed from its material and content."
            ));
        }
        let mut statement = connection
            .prepare(item_sql)
            .map_err(|e| format!("Could not read cards: {e}"))?;
        let items = statement
            .query_map([&version_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(|e| format!("Could not read cards: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read cards: {e}"))?;
        if items.len() as i64 != card_count_value {
            return Err(format!("{owner} card_count does not match its cards."));
        }
        let mut cards = Vec::with_capacity(items.len());
        for (expected, (item_id, ordinal, front, back, source_page, origin)) in
            items.into_iter().enumerate()
        {
            if ordinal != expected as i64 {
                return Err(format!("Card {item_id} has a non-contiguous ordinal."));
            }
            if sha256_hex(&format!("{version_id}\u{0}{expected}")) != item_id {
                return Err(format!("Card {item_id} cannot be recomputed."));
            }
            if !is_valid_card_text(&front, MAX_FRONT_CHARS)
                || !is_valid_card_text(&back, MAX_BACK_CHARS)
            {
                return Err(format!("Card {item_id} has invalid text."));
            }
            if source_page.is_some_and(|p| !(1..=MAX_SOURCE_PAGE).contains(&p)) {
                return Err(format!("Card {item_id} has an out-of-bounds source page."));
            }
            cards.push(CanonicalCard {
                visual_region_id: crate::visual_cards::frozen_id(connection, &item_id)
                    .map_err(|_| "Damaged visual sidecar.")?,
                front,
                back,
                source_page,
                origin,
            });
        }
        if sha256_hex(&canonical_cards_json(&cards)) != content_hash {
            return Err(format!("{owner} content hash does not match its cards."));
        }
        if has_origins {
            let expected = crate::card_reviews::version_origin(
                &crate::card_reviews::card_version(&material_id, &cards).items,
            );
            let stored: Option<String> = connection
                .query_row(
                    "SELECT origin FROM card_version_origins WHERE version_id = ?1",
                    [&version_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| format!("Could not read card origins: {e}"))?;
            if stored.as_deref() != expected {
                return Err(format!("{owner} origin does not match its cards."));
            }
        }
    }

    // 6. Generations of existing materials (a missing row is generation 0).
    let generations: HashMap<String, i64> = {
        let mut statement = connection
            .prepare("SELECT source_material_id, generation FROM card_review_generations")
            .map_err(|e| format!("Could not read review generations: {e}"))?;
        let rows = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("Could not read review generations: {e}"))?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| format!("Could not read review generations: {e}"))?;
        rows
    };
    let generation_of = |material: &str| generations.get(material).copied().unwrap_or(0);

    // 7. Receipts: typed by action; tombstones keep routing metadata only.
    let mut live_rates: HashMap<String, String> = HashMap::new();
    type ReceiptRow = (
        String,
        String,
        String,
        i64,
        String,
        String,
        i64,
        Option<String>,
    );
    let receipts: Vec<ReceiptRow> = {
        let mut statement = connection
            .prepare("SELECT operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json FROM card_review_operations")
            .map_err(|e| format!("Could not read card receipts: {e}"))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })
            .map_err(|e| format!("Could not read card receipts: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read card receipts: {e}"))?;
        rows
    };
    for (
        operation_id,
        action,
        material_id,
        generation,
        request_hash,
        applied_at,
        is_erased,
        result_json,
    ) in receipts
    {
        let owner = format!("Card review receipt {operation_id}");
        if !uuid_v4(&operation_id) {
            return Err(format!("{owner} is not a valid UUIDv4."));
        }
        if !is_lower_hex_64(&request_hash) {
            return Err(format!("{owner} has an invalid request hash."));
        }
        card_timestamp(&applied_at, &owner)?;
        if crate::card_reviews::js_trim(&material_id).is_empty() {
            return Err(format!("{owner} has no material."));
        }
        if is_erased == 1 {
            if result_json.is_some() {
                return Err(format!("{owner} is erased but still holds a result."));
            }
            continue;
        }
        let Some(result_json) = result_json else {
            return Err(format!("{owner} is live but has no result."));
        };
        let result = card_json_object(&result_json, &owner)?;
        let current = generation_of(&material_id);
        if action == "reset" {
            card_exact_keys(&result, &["action", "generation", "materialId"], &owner)?;
            if card_json_str(result.get("action")) != Some("reset")
                || card_json_str(result.get("materialId")) != Some(material_id.as_str())
            {
                return Err(format!("{owner} result does not match its receipt."));
            }
            if card_json_int(result.get("generation")) != Some(generation + 1) {
                return Err(format!(
                    "{owner} result generation is not the captured generation plus one."
                ));
            }
            if generation + 1 != current {
                return Err(format!(
                    "{owner} is a live reset older than the current generation."
                ));
            }
            continue;
        }
        if !ITEM_ACTIONS.contains(&action.as_str()) {
            return Err(format!("{owner} has an unknown action."));
        }
        card_exact_keys(
            &result,
            &[
                "action",
                "dueAt",
                "flag",
                "generation",
                "itemId",
                "reviewedAt",
                "revision",
                "suspended",
            ],
            &owner,
        )?;
        if card_json_str(result.get("action")) != Some(action.as_str())
            || card_json_int(result.get("generation")) != Some(generation)
        {
            return Err(format!("{owner} result does not match its receipt."));
        }
        if generation > current {
            return Err(format!(
                "{owner} has a generation above its material's current generation."
            ));
        }
        if generation < current {
            return Err(format!(
                "{owner} is a live item receipt from before the latest reset."
            ));
        }
        let Some(item_id) = card_json_str(result.get("itemId")).filter(|id| is_lower_hex_64(id))
        else {
            return Err(format!("{owner} result names no card."));
        };
        if card_count(
            connection,
            "SELECT COUNT(*) FROM card_items i JOIN card_versions v ON v.id = i.version_id
             WHERE i.id = ?1 AND v.source_material_id = ?2",
            &[&item_id, &material_id],
        )? != 1
        {
            return Err(format!(
                "{owner} result names a card that is not this material's."
            ));
        }
        if !card_json_int(result.get("revision")).is_some_and(|r| r >= 1)
            || matches!(result.get("revision"), Some(serde_json::Value::Bool(_)))
        {
            return Err(format!("{owner} result has an invalid revision."));
        }
        let nullable_instant = |key: &str| -> Result<bool, String> {
            match result.get(key) {
                Some(serde_json::Value::Null) => Ok(false),
                Some(serde_json::Value::String(s)) => card_timestamp(s, &owner).map(|_| true),
                _ => Err(format!("{owner} has a malformed timestamp.")),
            }
        };
        let has_due = nullable_instant("dueAt")?;
        let has_review = nullable_instant("reviewedAt")?;
        if !matches!(result.get("suspended"), Some(serde_json::Value::Bool(_))) {
            return Err(format!("{owner} result has an invalid paused flag."));
        }
        match result.get("flag") {
            Some(serde_json::Value::Null) => {}
            Some(serde_json::Value::String(flag)) if FLAG_REASONS.contains(&flag.as_str()) => {}
            _ => return Err(format!("{owner} result has an invalid flag.")),
        }
        if action == "rate" {
            if !has_review || !has_due {
                return Err(format!("{owner} rating result has no review time."));
            }
            live_rates.insert(operation_id.clone(), item_id.to_string());
        } else if has_review {
            return Err(format!("{owner} non-rating result has a review time."));
        }
    }

    // 8. Events: immutable ratings of the current generation, each with its receipt.
    let mut events_by_item: HashMap<String, Vec<serde_json::Map<String, serde_json::Value>>> =
        HashMap::new();
    type EventRow = (String, String, i64, String, String, String, String, String);
    let events: Vec<EventRow> = {
        let mut statement = connection
            .prepare(
                "SELECT e.id, e.item_id, e.generation, e.reviewed_at, e.scheduler_version, e.prior_state_json, e.next_state_json, v.source_material_id
                 FROM card_review_events e JOIN card_items i ON i.id = e.item_id JOIN card_versions v ON v.id = i.version_id",
            )
            .map_err(|e| format!("Could not read rating events: {e}"))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })
            .map_err(|e| format!("Could not read rating events: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read rating events: {e}"))?;
        rows
    };
    for (
        id,
        item_id,
        generation,
        reviewed_at,
        scheduler_version,
        prior_json,
        next_json,
        material_id,
    ) in events
    {
        let owner = format!("Card review event {id}");
        if !uuid_v4(&id) {
            return Err(format!("{owner} is not a valid UUIDv4."));
        }
        let current = generation_of(&material_id);
        if generation > current {
            return Err(format!(
                "{owner} has a generation above its material's current generation."
            ));
        }
        if generation < current {
            return Err(format!("{owner} is from before the latest reset."));
        }
        if live_rates.get(&id) != Some(&item_id) {
            return Err(format!("{owner} has no matching live rating receipt."));
        }
        if scheduler_version != SCHEDULER_VERSION {
            return Err(format!("{owner} has an unknown scheduler version."));
        }
        card_timestamp(&reviewed_at, &owner)?;
        let next = card_json_object(&next_json, &owner)?;
        card_check_schedule(&next, &owner)?;
        if card_json_str(next.get("lastReviewedAt")) != Some(reviewed_at.as_str()) {
            return Err(format!(
                "{owner} next state does not match its review time."
            ));
        }
        if prior_json != "null" {
            card_check_schedule(&card_json_object(&prior_json, &owner)?, &owner)?;
        }
        events_by_item.entry(item_id).or_default().push(next);
    }

    // 9. Projection against its events.
    type StateRow = (
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
        i64,
        i64,
        i64,
    );
    let states: Vec<StateRow> = {
        let mut statement = connection
            .prepare("SELECT item_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, revision FROM card_review_state")
            .map_err(|e| format!("Could not read review state: {e}"))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })
            .map_err(|e| format!("Could not read review state: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Could not read review state: {e}"))?;
        rows
    };
    let mut with_state: HashSet<String> = HashSet::new();
    for (item_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, revision) in
        states
    {
        let owner = format!("Card review state {item_id}");
        if scheduler_version != SCHEDULER_VERSION {
            return Err(format!("{owner} has an unknown scheduler version."));
        }
        let events = events_by_item
            .get(&item_id)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        with_state.insert(item_id.clone());
        let (Some(due_at), Some(last_reviewed_at)) = (due_at.as_ref(), last_reviewed_at.as_ref())
        else {
            if !events.is_empty() {
                return Err(format!("{owner} is never rated but has rating events."));
            }
            if due_at.is_some() != last_reviewed_at.is_some() {
                return Err(format!("{owner} has a due time without a review time."));
            }
            continue;
        };
        let due_ms = card_timestamp(due_at, &owner)?;
        let last_ms = card_timestamp(last_reviewed_at, &owner)?;
        if Some(due_ms - last_ms) != step_delay_ms(step) {
            return Err(format!(
                "{owner} has a due time inconsistent with its step."
            ));
        }
        if events.len() as i64 != reps {
            return Err(format!("{owner} reps does not match its rating events."));
        }
        if revision < events.len() as i64 {
            return Err(format!("{owner} revision is below its rating count."));
        }
        let mut reps_seen: Vec<i64> = events
            .iter()
            .filter_map(|n| card_json_int(n.get("reps")))
            .collect();
        reps_seen.sort_unstable();
        if reps_seen.len() != events.len()
            || reps_seen
                .iter()
                .enumerate()
                .any(|(i, r)| *r != i as i64 + 1)
        {
            return Err(format!("{owner} rating events do not form one history."));
        }
        let Some(latest) = events
            .iter()
            .find(|n| card_json_int(n.get("reps")) == Some(reps))
        else {
            return Err(format!("{owner} does not match its latest rating event."));
        };
        if card_json_int(latest.get("step")) != Some(step)
            || card_json_str(latest.get("dueAt")) != Some(due_at.as_str())
            || card_json_str(latest.get("lastReviewedAt")) != Some(last_reviewed_at.as_str())
            || card_json_int(latest.get("lapses")) != Some(lapses)
        {
            return Err(format!("{owner} does not match its latest rating event."));
        }
    }
    for item_id in events_by_item.keys() {
        if !with_state.contains(item_id) {
            return Err(format!(
                "Card {item_id} has rating events but no review state."
            ));
        }
    }
    Ok(())
}
