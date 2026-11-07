//! The import plan (design section 3): what happens to every item of a pack,
//! worked out against the library as it is now. It reads and never writes.
//!
//! Pass 1 gives each item an outcome in manifest order. Pass 2 resolves every
//! cross-item reference through those outcomes, so a reference points the same
//! way whichever order the manifest lists the two items in. The plan holds
//! decisions and material ids only; ids for cards, questions and runs are made
//! when the rows are written. The same plan is computed again inside the commit
//! transaction and must be equal, or the import is abandoned.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use super::guard::pack_sql;
use super::validate::{PackItem, ValidatedPack};

pub const MAX_CARDS_PER_PICTURE: usize = 20;

/// What a pack item does to the library.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// A new material is made for it.
    Add,
    /// Nothing is made; the item resolves to an existing or earlier material.
    Skip,
    /// A picture she removed: not brought back, resolves to nothing.
    Removed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Link {
    Added,
    Alias,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemPlan {
    pub decision: Decision,
    /// The material this item stands for (new, existing or earlier planned).
    pub material: Option<String>,
    /// The one provenance row W1/W2 allows: `(link, material)`. None for W3.
    pub row: Option<(Link, String)>,
    /// Row 3 (or P4): a second copy with the date suffix.
    pub second_copy: bool,
    /// Row 4: all copies of this identity were deleted; added back.
    pub readded: bool,
    pub parent: Option<String>,
    pub root: Option<String>,
    /// Kept picture regions: pack region id -> the material holding its image.
    pub regions: BTreeMap<String, String>,
    /// Pack ids of cards left out of the guide.
    pub dropped_cards: BTreeSet<String>,
    pub left_out: LeftOut,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LeftOut {
    pub removed: u64,
    pub changed: u64,
    pub over_capacity: u64,
    pub unusable: u64,
}

impl LeftOut {
    pub fn total(&self) -> u64 {
        self.removed + self.changed + self.over_capacity + self.unusable
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub items: Vec<ItemPlan>,
}

/// The receipt counts (design section 3, rev 6 and the Stage 2 rulings).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Totals {
    pub added: u64,
    pub added_guides: u64,
    pub added_documents: u64,
    pub added_pictures: u64,
    pub added_practice: u64,
    pub skipped: u64,
    pub new_versions: u64,
    pub readded: u64,
    pub cards_left_out: u64,
    pub cards_left_out_removed: u64,
}

impl Plan {
    pub fn totals(&self, pack: &ValidatedPack) -> Totals {
        let mut t = Totals::default();
        for (plan, item) in self.items.iter().zip(&pack.items) {
            t.cards_left_out += plan.left_out.total();
            t.cards_left_out_removed += plan.left_out.removed;
            if plan.decision != Decision::Add {
                t.skipped += 1;
                continue;
            }
            t.added += 1;
            let picture = item.manifest.kind == "picture";
            if item.json.guide.is_some() {
                t.added_guides += 1;
            }
            match item.manifest.kind.as_str() {
                "document" => t.added_documents += 1,
                "picture" => t.added_pictures += 1,
                _ => {}
            }
            if item.json.practice.is_some()
                && item.json.guide.is_none()
                && item.manifest.file.is_none()
            {
                t.added_practice += 1;
            }
            if !picture {
                if plan.second_copy {
                    t.new_versions += 1;
                }
                if plan.readded {
                    t.readded += 1;
                }
            }
        }
        t
    }
}

/* ------------------------------------------------------------------ */
/* Lookups L1-L4 (design section 3). All orderings are total.          */
/* ------------------------------------------------------------------ */

pub(super) struct Lookups<'a> {
    pub(super) conn: &'a Connection,
}

impl Lookups<'_> {
    fn material(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
    ) -> Result<Option<String>, String> {
        let sql = pack_sql(sql)?;
        self.conn
            .query_row(sql, params, |r| r.get::<_, String>(0))
            .optional()
            .map_err(|e| format!("Could not read the study pack records: {e}"))
    }

    fn exists(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<bool, String> {
        let sql = pack_sql(sql)?;
        self.conn
            .query_row(sql, params, |_| Ok(()))
            .optional()
            .map(|r| r.is_some())
            .map_err(|e| format!("Could not read the study pack records: {e}"))
    }

    /// L1: this identity's own live row with this revision. Oldest link wins.
    pub(super) fn l1(&self, ns: &str, id: &str, rev: &str) -> Result<Option<String>, String> {
        self.material(
            "SELECT material_id FROM study_pack_items
             WHERE namespace = ?1 AND item_id = ?2 AND revision = ?3 AND material_id IS NOT NULL
             ORDER BY imported_at, operation_id LIMIT 1",
            &[&ns, &id, &rev],
        )
    }

    /// L2: any live row with this revision. Oldest link wins.
    pub(super) fn l2(&self, rev: &str) -> Result<Option<String>, String> {
        self.material(
            "SELECT material_id FROM study_pack_items
             WHERE revision = ?1 AND material_id IS NOT NULL
             ORDER BY imported_at, operation_id, namespace, item_id LIMIT 1",
            &[&rev],
        )
    }

    /// L3: the identity's newest live row.
    pub(super) fn l3(&self, ns: &str, id: &str) -> Result<Option<String>, String> {
        self.material(
            "SELECT material_id FROM study_pack_items
             WHERE namespace = ?1 AND item_id = ?2 AND material_id IS NOT NULL
             ORDER BY imported_at DESC, operation_id DESC LIMIT 1",
            &[&ns, &id],
        )
    }

    pub(super) fn identity_known(&self, ns: &str, id: &str) -> Result<bool, String> {
        self.exists(
            "SELECT 1 FROM study_pack_items WHERE namespace = ?1 AND item_id = ?2 LIMIT 1",
            &[&ns, &id],
        )
    }

    pub(super) fn revision_known(&self, rev: &str) -> Result<bool, String> {
        self.exists(
            "SELECT 1 FROM study_pack_items WHERE revision = ?1 LIMIT 1",
            &[&rev],
        )
    }

    /// A live picture row of this identity with these bytes (any revision).
    pub(super) fn own_picture_bytes(
        &self,
        ns: &str,
        id: &str,
        sha: &str,
    ) -> Result<Option<String>, String> {
        self.material(
            "SELECT material_id FROM study_pack_items
             WHERE namespace = ?1 AND item_id = ?2 AND kind = 'picture' AND file_sha256 = ?3
               AND material_id IS NOT NULL
             ORDER BY imported_at, operation_id LIMIT 1",
            &[&ns, &id, &sha],
        )
    }

    pub(super) fn picture_bytes(&self, sha: &str) -> Result<Option<String>, String> {
        self.material(
            "SELECT material_id FROM study_pack_items
             WHERE kind = 'picture' AND file_sha256 = ?1 AND material_id IS NOT NULL
             ORDER BY imported_at, operation_id, namespace, item_id LIMIT 1",
            &[&sha],
        )
    }

    pub(super) fn picture_bytes_known(&self, sha: &str) -> Result<bool, String> {
        self.exists(
            "SELECT 1 FROM study_pack_items WHERE kind = 'picture' AND file_sha256 = ?1 LIMIT 1",
            &[&sha],
        )
    }
}

/* ------------------------------------------------------------------ */
/* Existing pictures                                                   */
/* ------------------------------------------------------------------ */

/// Pictures already used by cards in her library, and whether a picture she
/// has still holds the bytes a pack region names.
struct Pictures<'a> {
    conn: &'a Connection,
    root: &'a Path,
    usage: Option<HashMap<String, usize>>,
    checked: HashMap<(String, String), Held>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Held {
    Yes,
    /// Her file is a readable picture, but not the one the region names.
    Different,
    /// Missing, unreadable or not a usable PNG.
    Unusable,
}

impl<'a> Pictures<'a> {
    fn new(conn: &'a Connection, root: &'a Path) -> Self {
        Self {
            conn,
            root,
            usage: None,
            checked: HashMap::new(),
        }
    }

    /// Cards per image across every guide she has (the 20-card rule counts
    /// them all, `visual_cards::write`).
    fn used(&mut self, image: &str) -> Result<usize, String> {
        if self.usage.is_none() {
            let fail = |e: rusqlite::Error| format!("Could not read your picture cards: {e}");
            let mut map: HashMap<String, usize> = HashMap::new();
            let mut statement = self
                .conn
                .prepare(pack_sql(
                    "SELECT r.image_material_id, COUNT(*) \
                     FROM ai_study_sets s, \
                          json_each(CASE WHEN json_valid(s.flashcards_json) \
                                          AND json_type(s.flashcards_json) = 'array' \
                                    THEN s.flashcards_json ELSE '[]' END) c \
                     JOIN visual_card_regions r \
                       ON r.id = json_extract(c.value, '$.visualRegionId') \
                      AND json_type(c.value, '$.visualRegionId') = 'text' \
                     WHERE r.image_material_id IS NOT NULL \
                     GROUP BY r.image_material_id",
                )?)
                .map_err(fail)?;
            let rows = statement
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                .map_err(fail)?;
            for row in rows {
                let (image, count) = row.map_err(fail)?;
                map.insert(image, count as usize);
            }
            drop(statement);
            self.usage = Some(map);
        }
        Ok(self
            .usage
            .as_ref()
            .and_then(|m| m.get(image))
            .copied()
            .unwrap_or(0))
    }

    fn note_use(&mut self, image: &str) {
        if let Some(map) = self.usage.as_mut() {
            *map.entry(image.to_string()).or_default() += 1;
        }
    }

    /// Her file for this picture still has the region's bytes and size.
    fn holds_bytes(&mut self, material: &str, sha: &str, width: i64, height: i64) -> Held {
        let key = (material.to_string(), sha.to_string());
        if let Some(known) = self.checked.get(&key) {
            return *known;
        }
        let ok = (|| -> Result<Held, String> {
            let path: Option<String> = self
                .conn
                .query_row(
                    pack_sql("SELECT file_path FROM study_materials WHERE id = ?1")?,
                    [material],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .flatten();
            let Some(path) = path else {
                return Ok(Held::Unusable);
            };
            let docs = self.root.join("documents");
            let full = crate::documents::contained_document_path(&docs, &path)?;
            let meta = std::fs::symlink_metadata(&full).map_err(|e| e.to_string())?;
            if !meta.is_file() || meta.len() > crate::visual_cards::MAX_BYTES as u64 {
                return Ok(Held::Unusable);
            }
            let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
            let (w, h) = crate::visual_cards::inspect_png(&bytes)?;
            Ok(
                if w == width && h == height && hex::encode(Sha256::digest(&bytes)) == sha {
                    Held::Yes
                } else {
                    Held::Different
                },
            )
        })()
        .unwrap_or(Held::Unusable);
        self.checked.insert(key, ok);
        ok
    }
}

/* ------------------------------------------------------------------ */
/* Compute                                                             */
/* ------------------------------------------------------------------ */

#[derive(Clone)]
enum Outcome {
    Material(String),
    Removed,
}

/// Plan a validated pack against the library. `new_id` hands out the material
/// id for a pack ref (the same one every time it is asked for that ref).
pub fn compute(
    conn: &Connection,
    root: &Path,
    pack: &ValidatedPack,
    new_id: &mut dyn FnMut(&str) -> String,
) -> Result<Plan, String> {
    let look = Lookups { conn };
    let namespace = pack.manifest.namespace.as_str();
    let mut by_revision: HashMap<String, Outcome> = HashMap::new();
    let mut by_bytes: HashMap<String, Outcome> = HashMap::new();
    let mut items: Vec<ItemPlan> = Vec::with_capacity(pack.items.len());

    // Pass 1.
    for item in &pack.items {
        let m = &item.manifest;
        let revision = m.revision.as_str();
        let id = m.item_id.as_str();
        let picture = m.kind == "picture";
        let sha = m.file.as_ref().map(|f| f.sha256.as_str());
        let blank = ItemPlan {
            decision: Decision::Skip,
            material: None,
            row: None,
            second_copy: false,
            readded: false,
            parent: None,
            root: None,
            regions: BTreeMap::new(),
            dropped_cards: BTreeSet::new(),
            left_out: LeftOut::default(),
        };
        let skip_alias = |material: String| ItemPlan {
            material: Some(material.clone()),
            row: Some((Link::Alias, material)),
            ..blank.clone()
        };
        let add = |second_copy: bool, readded: bool, new_id: &mut dyn FnMut(&str) -> String| {
            let material = new_id(&m.item_ref);
            ItemPlan {
                decision: Decision::Add,
                material: Some(material.clone()),
                row: Some((Link::Added, material)),
                second_copy,
                readded,
                ..blank.clone()
            }
        };
        let plan = if !picture {
            if let Some(material) = look.l1(namespace, id, revision)? {
                // 1a: already here under this identity (W3: no row).
                ItemPlan {
                    material: Some(material),
                    ..blank.clone()
                }
            } else if let Some(material) = look.l2(revision)? {
                skip_alias(material) // 1b
            } else if let Some(Outcome::Material(material)) = by_revision.get(revision) {
                skip_alias(material.clone()) // 2
            } else if look.l3(namespace, id)?.is_some() {
                add(true, false, new_id) // 3: another version beside hers
            } else if look.identity_known(namespace, id)? || look.revision_known(revision)? {
                add(false, true, new_id) // 4: she deleted every copy
            } else {
                add(false, false, new_id) // 5
            }
        } else {
            let sha = sha.unwrap_or("");
            if let Some(material) = look.l1(namespace, id, revision)? {
                ItemPlan {
                    material: Some(material),
                    ..blank.clone()
                }
            } else if let Some(material) = look.l2(revision)? {
                skip_alias(material)
            } else if let Some(material) = look.own_picture_bytes(namespace, id, sha)? {
                skip_alias(material) // P1 by bytes under the same identity
            } else if let Some(material) = look.picture_bytes(sha)? {
                skip_alias(material) // P1 by bytes, another identity
            } else if let Some(outcome) = by_revision.get(revision).or_else(|| by_bytes.get(sha)) {
                match outcome {
                    Outcome::Material(material) => skip_alias(material.clone()), // P2
                    Outcome::Removed => ItemPlan {
                        decision: Decision::Removed,
                        ..blank.clone()
                    },
                }
            } else if look.revision_known(revision)?
                || look.picture_bytes_known(sha)?
                || (look.identity_known(namespace, id)? && look.l3(namespace, id)?.is_none())
            {
                ItemPlan {
                    decision: Decision::Removed, // P3: she removed it; not re-added
                    ..blank.clone()
                }
            } else if look.l3(namespace, id)?.is_some() {
                add(true, false, new_id) // P4
            } else {
                add(false, false, new_id) // P5
            }
        };
        let outcome = match &plan.material {
            Some(material) => Outcome::Material(material.clone()),
            None => Outcome::Removed,
        };
        by_revision.insert(revision.to_string(), outcome.clone());
        if picture {
            if let Some(sha) = sha {
                by_bytes.insert(sha.to_string(), outcome);
            }
        }
        items.push(plan);
    }

    // Pass 2: references, through the outcome map.
    let by_ref: HashMap<&str, Option<String>> = pack
        .items
        .iter()
        .zip(&items)
        .map(|(item, plan)| (item.manifest.item_ref.as_str(), plan.material.clone()))
        .collect();
    let in_this_pack: BTreeSet<String> = items
        .iter()
        .filter(|p| p.decision == Decision::Add)
        .filter_map(|p| p.material.clone())
        .collect();
    let mut pictures = Pictures::new(conn, root);
    for (item, plan) in pack.items.iter().zip(items.iter_mut()) {
        if plan.decision != Decision::Add {
            continue;
        }
        if let Some(lineage) = &item.json.lineage {
            let resolve = |reference: &Option<String>,
                           external: &Option<String>|
             -> Result<Option<String>, String> {
                if let Some(r) = reference {
                    return Ok(by_ref.get(r.as_str()).cloned().flatten());
                }
                if let Some(id) = external {
                    return look.l3(namespace, id);
                }
                Ok(None)
            };
            plan.parent = resolve(&lineage.parent_ref, &lineage.parent_item_id)?;
            plan.root = resolve(&lineage.root_ref, &lineage.root_item_id)?;
        }
        plan_pictures(item, plan, &by_ref, &in_this_pack, &mut pictures)?;
    }
    Ok(Plan { items })
}

fn plan_pictures(
    item: &PackItem,
    plan: &mut ItemPlan,
    by_ref: &HashMap<&str, Option<String>>,
    in_this_pack: &BTreeSet<String>,
    pictures: &mut Pictures<'_>,
) -> Result<(), String> {
    let (Some(guide), Some(regions)) = (&item.json.guide, &item.json.visual_regions) else {
        return Ok(());
    };
    let mut kept: BTreeMap<String, String> = BTreeMap::new();
    for card in &guide.flashcards {
        let Some(region_id) = &card.visual_region_id else {
            continue;
        };
        let Some(region) = regions.iter().find(|r| &r.id == region_id) else {
            plan.dropped_cards.insert(card.item_id.clone());
            plan.left_out.unusable += 1;
            continue;
        };
        let Some(Some(image)) = by_ref.get(region.image_ref.as_str()) else {
            plan.dropped_cards.insert(card.item_id.clone());
            plan.left_out.removed += 1;
            continue;
        };
        if !in_this_pack.contains(image) {
            // An existing picture: it must still hold the region's bytes.
            let held = pictures.holds_bytes(
                image,
                &region.image_sha256,
                region.image_width,
                region.image_height,
            );
            if held != Held::Yes {
                plan.dropped_cards.insert(card.item_id.clone());
                if held == Held::Different {
                    plan.left_out.changed += 1;
                } else {
                    plan.left_out.unusable += 1;
                }
                continue;
            }
        }
        if pictures.used(image)? >= MAX_CARDS_PER_PICTURE {
            plan.dropped_cards.insert(card.item_id.clone());
            plan.left_out.over_capacity += 1;
            continue;
        }
        pictures.note_use(image);
        kept.insert(region.id.clone(), image.clone());
    }
    plan.regions = kept;
    Ok(())
}
