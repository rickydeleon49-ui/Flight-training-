//! Bounded PNG reads and immutable visual card sidecars. No paths cross IPC.
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Region {
    pub id: String,
    pub owner_material_id: String,
    pub image_material_id: Option<String>,
    pub image_sha256: String,
    pub image_width: i64,
    pub image_height: i64,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    pub rotation: i64,
}
type Check<T> = Result<T, String>;
const INVALID: &str = "This picture card is damaged or unavailable.";
pub const MAX_BYTES: usize = 10 * 1024 * 1024;
impl Region {
    pub fn hash(&self) -> String {
        crate::practice_sessions::compute_canonical_hash(
            &json!({"version":1,"ownerMaterialId":self.owner_material_id,"imageSha256":self.image_sha256,"imageWidth":self.image_width,"imageHeight":self.image_height,"x":self.x,"y":self.y,"w":self.w,"h":self.h,"rotation":self.rotation}),
        )
    }
    pub fn validate(&self) -> Check<()> {
        if !crate::card_reviews::is_lower_hex_64(&self.id)
            || !crate::card_reviews::is_lower_hex_64(&self.image_sha256)
            || self.owner_material_id.is_empty()
            || self.owner_material_id.len() > 200
            || self
                .image_material_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 200)
            || !(1..=4096).contains(&self.image_width)
            || !(1..=4096).contains(&self.image_height)
            || self.image_width * self.image_height > 4_000_000
            || self.x < 0
            || self.y < 0
            || self.w < 1
            || self.h < 1
            || self
                .x
                .checked_add(self.w)
                .map_or(true, |n| n > self.image_width)
            || self
                .y
                .checked_add(self.h)
                .map_or(true, |n| n > self.image_height)
            || ![0, 90, 180, 270].contains(&self.rotation)
        {
            return Err(INVALID.into());
        }
        if self.hash() != self.id {
            return Err("Damaged picture descriptor hash.".into());
        }
        Ok(())
    }
}
pub fn exists(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='visual_card_regions')",
        [],
        |r| r.get(0),
    )
    .unwrap_or(false)
}
pub fn frozen_id(conn: &Connection, item: &str) -> rusqlite::Result<Option<String>> {
    if !exists(conn) {
        return Ok(None);
    }
    conn.query_row(
        "SELECT region_id FROM card_item_visual_regions WHERE item_id=?1",
        [item],
        |r| r.get(0),
    )
    .optional()
}
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Region> {
    Ok(Region {
        id: r.get(0)?,
        owner_material_id: r.get(1)?,
        image_material_id: r.get(2)?,
        image_sha256: r.get(3)?,
        image_width: r.get(4)?,
        image_height: r.get(5)?,
        x: r.get(6)?,
        y: r.get(7)?,
        w: r.get(8)?,
        h: r.get(9)?,
        rotation: r.get(10)?,
    })
}
pub fn read_region(conn: &Connection, id: &str) -> Check<Region> {
    let r=conn.query_row("SELECT id,owner_material_id,image_material_id,image_sha256,image_width,image_height,x,y,w,h,rotation FROM visual_card_regions WHERE id=?1",[id],row).map_err(|_|INVALID)?;
    r.validate()?;
    Ok(r)
}
pub fn check_owner(conn: &Connection, id: &str, owner: &str) -> Check<Region> {
    let r = read_region(conn, id)?;
    if r.owner_material_id != owner {
        return Err(INVALID.into());
    }
    Ok(r)
}
/// Header/chunk twin of visualPng.ts. Check the complete bounded buffer before decoding.
pub fn inspect_png(bytes: &[u8]) -> Check<(i64, i64)> {
    let bad = || INVALID.to_string();
    if bytes.len() > MAX_BYTES
        || bytes.len() < 33
        || bytes[..8] != [137, 80, 78, 71, 13, 10, 26, 10]
    {
        return Err(bad());
    }
    let n = |p: usize| u32::from_be_bytes(bytes[p..p + 4].try_into().unwrap()) as usize;
    if n(8) != 13 || &bytes[12..16] != b"IHDR" {
        return Err(bad());
    }
    let (w, h) = (n(16), n(20));
    if w == 0 || h == 0 || w > 4096 || h > 4096 || w * h > 4_000_000 {
        return Err(bad());
    }
    let mut p = 8;
    let mut idat = false;
    while p + 12 <= bytes.len() {
        let len = n(p);
        if len > bytes.len() - p - 12 {
            return Err(bad());
        }
        let kind = &bytes[p + 4..p + 8];
        if kind == b"acTL" {
            return Err(bad());
        }
        if kind == b"IDAT" {
            idat = true;
        }
        if kind == b"IEND" {
            return if len == 0 && p + 12 == bytes.len() && idat {
                Ok((w as i64, h as i64))
            } else {
                Err(bad())
            };
        }
        p += len + 12;
    }
    Err(bad())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Picture {
    pub image_sha256: String,
    pub image_width: i64,
    pub image_height: i64,
    pub url: String,
}
pub fn image_on(conn: &Connection, root: &Path, material: &str) -> Check<Picture> {
    let relative: String = conn
        .query_row(
            "SELECT file_path FROM study_materials WHERE id=?1",
            [material],
            |r| r.get(0),
        )
        .map_err(|_| INVALID)?;
    let safe = crate::documents::safe_relative_path(&relative).map_err(|_| INVALID)?;
    let canonical_root = root.canonicalize().map_err(|_| INVALID)?;
    let dir = canonical_root
        .join("documents")
        .canonicalize()
        .map_err(|_| INVALID)?;
    if !dir.starts_with(&canonical_root) {
        return Err(INVALID.into());
    }
    let path = dir.join(safe).canonicalize().map_err(|_| INVALID)?;
    if !path.starts_with(&dir) {
        return Err(INVALID.into());
    }
    let file = std::fs::File::open(path).map_err(|_| INVALID)?;
    let meta = file.metadata().map_err(|_| INVALID)?;
    if !meta.is_file() || meta.len() > MAX_BYTES as u64 {
        return Err(INVALID.into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| INVALID)?;
    let (image_width, image_height) = inspect_png(&bytes)?;
    use base64::Engine;
    Ok(Picture {
        image_sha256: format!("{:x}", Sha256::digest(&bytes)),
        image_width,
        image_height,
        url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        ),
    })
}
pub fn verify_bytes(r: &Region, bytes: &[u8]) -> Check<()> {
    r.validate()?;
    let (w, h) = inspect_png(bytes)?;
    if w != r.image_width
        || h != r.image_height
        || format!("{:x}", Sha256::digest(bytes)) != r.image_sha256
    {
        return Err(INVALID.into());
    }
    Ok(())
}
pub fn verify_image(conn: &Connection, root: &Path, r: &Region) -> Check<()> {
    r.validate()?;
    let p = image_on(conn, root, r.image_material_id.as_deref().ok_or(INVALID)?)?;
    if p.image_sha256 != r.image_sha256
        || p.image_width != r.image_width
        || p.image_height != r.image_height
    {
        return Err(INVALID.into());
    }
    Ok(())
}
#[tauri::command]
pub async fn read_visual_image(
    app: tauri::AppHandle,
    material_id: String,
    region_id: Option<String>,
    owner_material_id: Option<String>,
) -> Check<Picture> {
    let root = crate::storage::app_root(&app).map_err(|_| INVALID)?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(root.join("her-flight-deck.db")).map_err(|_| INVALID)?;
        if let Some(id) = region_id {
            let r = check_owner(&conn, &id, owner_material_id.as_deref().ok_or(INVALID)?)?;
            if r.image_material_id.as_deref() != Some(&material_id) {
                return Err(INVALID.into());
            }
            verify_image(&conn, &root, &r)?;
        }
        image_on(&conn, &root, &material_id)
    })
    .await
    .map_err(|_| INVALID)?
}
pub fn write(tx: &Transaction<'_>, owner: &str, regions: &[Region], cards: &Value) -> Check<()> {
    let cards = cards.as_array().ok_or(INVALID)?;
    for r in regions {
        r.validate()?;
        if r.owner_material_id != owner
            || r.image_material_id.is_none()
            || !cards.iter().any(|c| c["visualRegionId"] == r.id)
        {
            return Err(INVALID.into());
        }
        let old: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM visual_card_regions WHERE id=?1)",
                [&r.id],
                |row| row.get(0),
            )
            .map_err(|_| INVALID)?;
        if old {
            if read_region(tx, &r.id)? != *r {
                return Err(INVALID.into());
            }
        } else {
            tx.execute("INSERT INTO visual_card_regions (id,owner_material_id,image_material_id,image_sha256,image_width,image_height,x,y,w,h,rotation) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![r.id,owner,r.image_material_id,r.image_sha256,r.image_width,r.image_height,r.x,r.y,r.w,r.h,r.rotation]).map_err(|_|INVALID)?;
        }
    }
    for c in cards {
        if let Some(id) = c.get("visualRegionId") {
            check_owner(tx, id.as_str().ok_or(INVALID)?, owner)?;
        }
    }
    let mut counts = std::collections::HashMap::<String, usize>::new();
    let mut all = cards.clone();
    let mut stmt = tx
        .prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id!=?1")
        .map_err(|_| INVALID)?;
    for text in stmt
        .query_map([owner], |r| r.get::<_, String>(0))
        .map_err(|_| INVALID)?
    {
        if let Value::Array(other) =
            serde_json::from_str(&text.map_err(|_| INVALID)?).map_err(|_| INVALID)?
        {
            all.extend(other);
        }
    }
    for c in all {
        if let Some(id) = c.get("visualRegionId") {
            let r = read_region(tx, id.as_str().ok_or(INVALID)?)?;
            let Some(image) = r.image_material_id else {
                continue;
            };
            let n = counts.entry(image).or_default();
            *n += 1;
            if *n > 20 {
                return Err(INVALID.into());
            }
        }
    }
    Ok(())
}
pub fn validate_references(conn: &Connection) -> Check<()> {
    let mut stmt = conn
        .prepare("SELECT id FROM visual_card_regions")
        .map_err(|_| INVALID)?;
    for id in stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| INVALID)?
    {
        read_region(conn, &id.map_err(|_| INVALID)?)?;
    }
    let mut counts = std::collections::HashMap::<String, usize>::new();
    let mut current = conn
        .prepare("SELECT flashcards_json FROM ai_study_sets")
        .map_err(|_| INVALID)?;
    for text in current
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| INVALID)?
    {
        if let crate::card_reviews::SavedCards::Ok(cards) =
            crate::card_reviews::parse_saved_cards(Some(&text.map_err(|_| INVALID)?))
        {
            for c in cards {
                if let Some(id) = c.visual_region_id {
                    let r = read_region(conn, &id)?;
                    let Some(image) = r.image_material_id else {
                        continue;
                    };
                    let n = counts.entry(image).or_default();
                    *n += 1;
                    if *n > 20 {
                        return Err(INVALID.into());
                    }
                }
            }
        }
    }
    let mut stmt=conn.prepare("SELECT source_material_id,flashcards_json FROM ai_study_sets UNION ALL SELECT material_id,json_extract(previous_json,'$.flashcards_json') FROM study_set_history WHERE kind='study_set'").map_err(|_|INVALID)?;
    for pair in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|_| INVALID)?
    {
        let (owner, text) = pair.map_err(|_| INVALID)?;
        match crate::card_reviews::parse_saved_cards(Some(&text)) {
            crate::card_reviews::SavedCards::Malformed => return Err(INVALID.into()),
            crate::card_reviews::SavedCards::Ok(cards) => {
                for c in cards {
                    if let Some(id) = c.visual_region_id {
                        check_owner(conn, &id, &owner)?;
                    }
                }
            }
            _ => {}
        }
    }
    let mut stmt=conn.prepare("SELECT b.region_id,v.source_material_id FROM card_item_visual_regions b JOIN card_items i ON i.id=b.item_id JOIN card_versions v ON v.id=i.version_id").map_err(|_|INVALID)?;
    for pair in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|_| INVALID)?
    {
        let (id, owner) = pair.map_err(|_| INVALID)?;
        check_owner(conn, &id, &owner)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "visual_cards_tests.rs"]
pub(crate) mod tests;
