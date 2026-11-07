//! The read-only preview behind "Add study pack": what is in the file and how
//! much of it she already has. Nothing is written or staged.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use super::plan::{self, Decision};
use super::validate::validate_pack;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub guides: u64,
    pub cards: u64,
    pub questions: u64,
    pub videos: u64,
    pub documents: u64,
    /// Guides, PDFs and practice sets already in her library.
    pub already_in_library: u64,
}

pub fn inspect_study_pack_in(root: &Path, pack_path: &Path) -> Result<Preview, String> {
    let pack = validate_pack(pack_path)?;
    let conn = super::open_library(root, true, 5000)
        .map_err(|e| format!("Could not open your library: {e}"))?;
    let mut count = 0u64;
    let mut ids = |_: &str| {
        count += 1;
        format!("preview-{count}")
    };
    let plan = plan::compute(&conn, root, &pack, &mut ids)?;
    let already = pack
        .items
        .iter()
        .zip(&plan.items)
        .filter(|(item, p)| item.manifest.kind != "picture" && p.decision == Decision::Skip)
        .count() as u64;
    let c = &pack.manifest.counts;
    Ok(Preview {
        guides: c.guides,
        cards: c.cards,
        questions: c.questions,
        videos: c.videos,
        documents: c.documents,
        already_in_library: already,
    })
}
