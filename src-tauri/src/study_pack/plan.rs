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
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::format::{ItemJson, ManifestFile};
use super::guard::pack_sql;
use super::revision;
use super::titles;
use super::validate::{PackItem, ValidatedPack};

pub const MAX_CARDS_PER_PICTURE: usize = 20;

/// What a pack item does to the library.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// A new material is made for it.
    Add,
    /// Nothing is made; the item resolves to an existing material that was
    /// just checked to be identical, or to an earlier item of this pack.
    Skip,
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
    /// Row 3 (or P4): another version of an item she has.
    pub second_copy: bool,
    /// The label added to the titles, such as ` (from study pack)`. Never
    /// on a picture.
    pub label: Option<String>,
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
                if plan.readded {
                    t.readded += 1;
                } else if plan.second_copy || plan.label.is_some() {
                    t.new_versions += 1;
                }
            }
        }
        t
    }
}

/// One item the student is told about by name: skipped, or added with
/// something left out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedItem {
    pub title: String,
    pub reason: String,
}

fn cards(n: u64, why: &str) -> String {
    let what = if n == 1 {
        "picture card"
    } else {
        "picture cards"
    };
    format!("{n} {what} left out ({why})")
}

impl Plan {
    /// Every skipped item and everything left out, by title, with a reason.
    pub fn named(&self, pack: &ValidatedPack) -> Vec<SkippedItem> {
        let added: BTreeSet<&str> = self
            .items
            .iter()
            .filter(|p| p.decision == Decision::Add)
            .filter_map(|p| p.material.as_deref())
            .collect();
        let mut out = Vec::new();
        for (plan, item) in self.items.iter().zip(&pack.items) {
            let mut title = titles::stored(&item.json.title, plan.label.as_deref());
            if title.is_empty() {
                title = "Untitled".to_string();
            }
            let mut name = |reason: String| {
                out.push(SkippedItem {
                    title: title.clone(),
                    reason,
                })
            };
            if plan.decision != Decision::Add {
                let earlier = plan.material.as_deref().is_some_and(|m| added.contains(m));
                name(if earlier {
                    "same as another item in this study pack".to_string()
                } else {
                    "already in your library".to_string()
                });
                continue;
            }
            let l = plan.left_out;
            for (n, why) in [
                (l.over_capacity, "the picture already has 20 cards"),
                (l.unusable, "its picture can't be read"),
                (l.changed, "its picture changed"),
                (l.removed, "its picture isn't in this pack"),
            ] {
                if n > 0 {
                    name(cards(n, why));
                }
            }
            if let Some(lineage) = &item.json.lineage {
                let asked = |r: &Option<String>, id: &Option<String>| r.is_some() || id.is_some();
                if (asked(&lineage.parent_ref, &lineage.parent_item_id) && plan.parent.is_none())
                    || (asked(&lineage.root_ref, &lineage.root_item_id) && plan.root.is_none())
                {
                    name("added without its link to the book it came from".to_string());
                }
            }
        }
        out
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

    /// Every material the query names, in its order, each once.
    fn materials(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<Vec<String>, String> {
        let fail = |e: rusqlite::Error| format!("Could not read the study pack records: {e}");
        let mut statement = self.conn.prepare(pack_sql(sql)?).map_err(fail)?;
        let rows = statement
            .query_map(params, |r| r.get::<_, String>(0))
            .map_err(fail)?;
        let mut out: Vec<String> = Vec::new();
        for row in rows {
            let material = row.map_err(fail)?;
            if !out.contains(&material) {
                out.push(material);
            }
        }
        Ok(out)
    }

    /// The normalized, lower-case titles of every material she has.
    fn live_titles(&self) -> Result<BTreeSet<String>, String> {
        let fail = |e: rusqlite::Error| format!("Could not read your library: {e}");
        let mut statement = self
            .conn
            .prepare(pack_sql("SELECT title FROM study_materials")?)
            .map_err(fail)?;
        let rows = statement
            .query_map([], |r| r.get::<_, Option<String>>(0))
            .map_err(fail)?;
        let mut out = BTreeSet::new();
        for row in rows {
            out.insert(title_key(&row.map_err(fail)?.unwrap_or_default()));
        }
        Ok(out)
    }

    fn exists(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<bool, String> {
        let sql = pack_sql(sql)?;
        self.conn
            .query_row(sql, params, |_| Ok(()))
            .optional()
            .map(|r| r.is_some())
            .map_err(|e| format!("Could not read the study pack records: {e}"))
    }

    /// L1: this identity's own live rows with this revision, oldest link first.
    pub(super) fn l1(&self, ns: &str, id: &str, rev: &str) -> Result<Vec<String>, String> {
        self.materials(
            "SELECT material_id FROM study_pack_items
             WHERE namespace = ?1 AND item_id = ?2 AND revision = ?3 AND material_id IS NOT NULL
             ORDER BY imported_at, operation_id",
            &[&ns, &id, &rev],
        )
    }

    /// L2: any live rows with this revision, oldest link first.
    pub(super) fn l2(&self, rev: &str) -> Result<Vec<String>, String> {
        self.materials(
            "SELECT material_id FROM study_pack_items
             WHERE revision = ?1 AND material_id IS NOT NULL
             ORDER BY imported_at, operation_id, namespace, item_id",
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

    /// Live picture rows of this identity with these bytes (any revision).
    pub(super) fn own_picture_bytes(
        &self,
        ns: &str,
        id: &str,
        sha: &str,
    ) -> Result<Vec<String>, String> {
        self.materials(
            "SELECT material_id FROM study_pack_items
             WHERE namespace = ?1 AND item_id = ?2 AND kind = 'picture' AND file_sha256 = ?3
               AND material_id IS NOT NULL
             ORDER BY imported_at, operation_id",
            &[&ns, &id, &sha],
        )
    }

    pub(super) fn picture_bytes(&self, sha: &str) -> Result<Vec<String>, String> {
        self.materials(
            "SELECT material_id FROM study_pack_items
             WHERE kind = 'picture' AND file_sha256 = ?1 AND material_id IS NOT NULL
             ORDER BY imported_at, operation_id, namespace, item_id",
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
                       ON r.id = CASE WHEN c.type = 'object' THEN \
                                   CASE WHEN json_type(c.value, '$.visualRegionId') = 'text' \
                                        THEN json_extract(c.value, '$.visualRegionId') END \
                                 END \
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

/// Her material read fresh from disk (files re-hashed), or None when it
/// can't be read in full. Cached per material for one plan.
type Fresh = Option<(String, ItemJson, Option<ManifestFile>)>;

fn title_key(title: &str) -> String {
    titles::normalize(title).to_lowercase()
}

/// True when her material, read fresh, holds exactly this item's content.
/// Only what import itself does to an item is allowed for: whitespace in
/// titles, a label it added, a blank title read back as "Untitled", and
/// questions keeping their first known ACS task.
fn same_content(item: &PackItem, fresh: &Fresh) -> bool {
    let Some((kind, mine, file)) = fresh else {
        return false;
    };
    if kind != &item.manifest.kind {
        return false;
    }
    let mut pack = item.json.clone();
    let mut mine = mine.clone();
    let unlabel = |stored: &mut String, wanted: &str| {
        let n = titles::normalize(stored);
        if n == wanted || titles::without_label(&n) == Some(wanted) {
            *stored = wanted.to_string();
        }
    };
    pack.title = titles::normalize(&pack.title);
    if pack.title.is_empty() {
        pack.title = "Untitled".to_string();
    }
    unlabel(&mut mine.title, &pack.title);
    if let Some(g) = pack.guide.as_mut() {
        g.title = titles::normalize(&g.title);
        if let Some(mg) = mine.guide.as_mut() {
            unlabel(&mut mg.title, &g.title);
        }
    }
    if let Some(p) = pack.practice.as_mut() {
        p.title = titles::normalize(&p.title);
        for q in &mut p.questions {
            q.acs_tasks = q
                .acs_tasks
                .first()
                .and_then(|t| crate::acs_tasks::normalize(t))
                .into_iter()
                .collect();
        }
        if let Some(mp) = mine.practice.as_mut() {
            unlabel(&mut mp.title, &p.title);
        }
    }
    revision::revision_of(&item.manifest.kind, &pack, item.manifest.file.as_ref())
        == revision::revision_of(kind, &mine, file.as_ref())
}

/// Plan a validated pack against the library. `new_id` hands out the material
/// id for a pack ref (the same one every time it is asked for that ref).
///
/// An item is skipped only when a material she has, read fresh now, is
/// identical to it (or an earlier item of this pack is). Everything else is
/// added, beside her material and never over it.
pub fn compute(
    conn: &Connection,
    root: &Path,
    pack: &ValidatedPack,
    new_id: &mut dyn FnMut(&str) -> String,
) -> Result<Plan, String> {
    let look = Lookups { conn };
    let namespace = pack.manifest.namespace.as_str();
    let mut by_revision: HashMap<String, String> = HashMap::new();
    let mut by_bytes: HashMap<String, String> = HashMap::new();
    let mut fresh: HashMap<String, Fresh> = HashMap::new();
    let mut pictures = Pictures::new(conn, root);
    let mut taken = look.live_titles()?;
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
            label: None,
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
        let skip_own = |material: String| ItemPlan {
            material: Some(material), // 1a: no row (W3)
            ..blank.clone()
        };
        let mut add = |second_copy: bool, readded: bool, label: Option<String>| {
            let material = new_id(&m.item_ref);
            ItemPlan {
                decision: Decision::Add,
                material: Some(material.clone()),
                row: Some((Link::Added, material)),
                second_copy,
                label,
                readded,
                ..blank.clone()
            }
        };
        let plan = if !picture {
            let mut proven = |candidates: Vec<String>| -> Result<(Option<String>, bool), String> {
                let tried = !candidates.is_empty();
                for material in candidates {
                    let fresh = fresh
                        .entry(material.clone())
                        .or_insert_with(|| super::export::fresh_item(conn, root, &material).ok());
                    if same_content(item, fresh) {
                        return Ok((Some(material), tried));
                    }
                }
                Ok((None, tried))
            };
            let (own, tried_own) = proven(look.l1(namespace, id, revision)?)?;
            let (any, tried_any) = if own.is_some() {
                (None, false)
            } else {
                proven(look.l2(revision)?)?
            };
            if let Some(material) = own {
                skip_own(material) // 1a, just proven identical
            } else if let Some(material) = any {
                skip_alias(material) // 1b, just proven identical
            } else if let Some(material) = by_revision.get(revision) {
                skip_alias(material.clone()) // 2: an earlier item of this pack
            } else if tried_own || tried_any {
                // She changed it after import: hers stays, the pack's is added.
                let label = pick_label(&mut taken, &item.json.title, None);
                add(false, false, label)
            } else if look.l3(namespace, id)?.is_some() {
                let updated = titles::suffix(&pack.manifest.created_at);
                let label = pick_label(&mut taken, &item.json.title, Some(updated));
                add(true, false, label) // 3: another version beside hers
            } else if look.identity_known(namespace, id)? || look.revision_known(revision)? {
                let label = pick_label(&mut taken, &item.json.title, None);
                add(false, true, label) // 4: she deleted every copy
            } else {
                let label = pick_label(&mut taken, &item.json.title, None);
                add(false, false, label) // 5
            }
        } else {
            let sha = sha.unwrap_or("");
            let (width, height) = m
                .file
                .as_ref()
                .map_or((0, 0), |f| (f.width.unwrap_or(0), f.height.unwrap_or(0)));
            let mut holds = |candidates: Vec<String>| {
                candidates
                    .into_iter()
                    .find(|c| pictures.holds_bytes(c, sha, width, height) == Held::Yes)
            };
            if let Some(material) = holds(look.l1(namespace, id, revision)?) {
                skip_own(material)
            } else if let Some(material) = holds(look.l2(revision)?) {
                skip_alias(material)
            } else if let Some(material) = holds(look.own_picture_bytes(namespace, id, sha)?) {
                skip_alias(material) // P1 by bytes under the same identity
            } else if let Some(material) = holds(look.picture_bytes(sha)?) {
                skip_alias(material) // P1 by bytes, another identity
            } else if let Some(material) = by_revision.get(revision).or_else(|| by_bytes.get(sha)) {
                skip_alias(material.clone()) // P2
            } else if look.l3(namespace, id)?.is_some() {
                add(true, false, None) // P4
            } else if look.revision_known(revision)?
                || look.picture_bytes_known(sha)?
                || look.identity_known(namespace, id)?
            {
                add(false, true, None) // P3: she removed it; it comes back
            } else {
                add(false, false, None) // P5
            }
        };
        if let Some(material) = &plan.material {
            by_revision
                .entry(revision.to_string())
                .or_insert_with(|| material.clone());
            if picture {
                if let Some(sha) = sha {
                    by_bytes
                        .entry(sha.to_string())
                        .or_insert_with(|| material.clone());
                }
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

/// The label for an added item: the first of `first` (if any), then ` (from
/// study pack)`, ` (from study pack 2)`, ... whose stored title no material
/// has yet. No label when the title is free (and `first` is None) or blank.
fn pick_label(taken: &mut BTreeSet<String>, title: &str, first: Option<String>) -> Option<String> {
    if titles::normalize(title).is_empty() {
        return None;
    }
    let mut candidates = vec![first];
    let mut n = 1;
    loop {
        for label in candidates.drain(..) {
            let key = title_key(&titles::stored(title, label.as_deref()));
            if taken.insert(key) {
                return label;
            }
        }
        candidates.push(Some(titles::from_pack(n)));
        n += 1;
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picture_use_counts_only_object_cards_with_a_text_region() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE ai_study_sets (id TEXT PRIMARY KEY, flashcards_json TEXT);
             CREATE TABLE visual_card_regions (id TEXT PRIMARY KEY, image_material_id TEXT);
             INSERT INTO visual_card_regions VALUES ('r1', 'img-a'), ('r2', 'img-b');",
        )
        .unwrap();
        let sets = [
            r#"[{"visualRegionId":"r1"},{"visualRegionId":"r1"},{"front":"plain"}]"#,
            // Plain strings, a string that looks like a card, a number id.
            r#"["just text","{\"visualRegionId\":\"r2\"}",{"visualRegionId":7}]"#,
            r#"{"visualRegionId":"r2"}"#,
            "not json",
        ];
        for (n, text) in sets.iter().enumerate() {
            conn.execute(
                "INSERT INTO ai_study_sets VALUES (?1, ?2)",
                rusqlite::params![n.to_string(), text],
            )
            .unwrap();
        }
        conn.execute("INSERT INTO ai_study_sets VALUES ('null', NULL)", [])
            .unwrap();
        let root = std::path::PathBuf::new();
        let mut pictures = Pictures::new(&conn, &root);
        assert_eq!(pictures.used("img-a").unwrap(), 2);
        assert_eq!(pictures.used("img-b").unwrap(), 0);
    }
}
