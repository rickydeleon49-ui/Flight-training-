//! The on-disk change file: canonical JSON, gzipped, named by its hash.

use std::io::{Read, Write};

use flate2::read::GzDecoder;
use flate2::{Compression, GzBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::card_reviews::parse_iso_ms;
use crate::practice_sessions::canonical_json;
use crate::sync::tables;

pub(crate) const CHANGE_FORMAT_VERSION: u32 = 1;
/// Largest inflated change file we will read.
pub(crate) const MAX_DECODED_BYTES: u64 = 64 * 1024 * 1024;
/// A file stamped further ahead than this is still applied, with a warning.
const FUTURE_SLACK_MS: i64 = 5 * 60 * 1000;
const SUFFIX: &str = ".json.gz";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangeSet {
    pub format_version: u32,
    pub schema_version: i64,
    pub device_id: String,
    pub app_version: String,
    pub created_at: String,
    pub from_seq: i64,
    pub to_seq: i64,
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Change {
    pub seq: i64,
    pub table: String,
    pub row_id: String,
    pub op: Op,
    pub changed_at: String,
    pub row: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Op {
    Insert,
    Update,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EncodedChangeFile {
    pub bytes: Vec<u8>,
    pub sha256: String,
    pub file_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DecodedChangeFile {
    pub set: ChangeSet,
    /// `createdAt` is more than five minutes ahead of this device's clock.
    pub created_in_future: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ChangeFileError {
    BadDeviceId,
    DuplicateSeq,
    Compress,
    NameMismatch,
    TooLarge,
    Malformed,
    FormatTooNew,
    SchemaTooNew,
    UnknownTable(String),
}

impl std::fmt::Display for ChangeFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadDeviceId => f.write_str("the device id is not a safe name"),
            Self::DuplicateSeq => f.write_str("two changes share a sequence number"),
            Self::Compress => f.write_str("the change file could not be packed"),
            Self::NameMismatch => f.write_str("the change file does not match its name"),
            Self::TooLarge => f.write_str("the change file is too large"),
            Self::Malformed => f.write_str("the change file is not valid"),
            Self::FormatTooNew => f.write_str("the change file format is newer than this app"),
            Self::SchemaTooNew => f.write_str("the change file needs a newer version of the app"),
            Self::UnknownTable(name) => {
                let plain = !name.is_empty()
                    && name.len() <= 64
                    && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_');
                if plain {
                    write!(f, "the change file names an unknown table ({name})")
                } else {
                    f.write_str("the change file names an unknown table")
                }
            }
        }
    }
}

impl std::error::Error for ChangeFileError {}

pub(crate) fn valid_device_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

pub(crate) fn folder(device_id: &str) -> String {
    format!("changes/{device_id}")
}

/// `<from>-<to>-<first 12 hex of the SHA-256 of the gzipped bytes>.json.gz`.
pub(crate) fn file_name(_device_id: &str, from_seq: i64, to_seq: i64, sha256: &str) -> String {
    let short = sha256.get(..12).unwrap_or(sha256);
    format!("{from_seq}-{to_seq}-{short}{SUFFIX}")
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub(crate) fn encode(set: &ChangeSet) -> Result<EncodedChangeFile, ChangeFileError> {
    if !valid_device_id(&set.device_id) {
        return Err(ChangeFileError::BadDeviceId);
    }
    let mut sorted = set.clone();
    sorted.changes.sort_by_key(|c| c.seq);
    if sorted.changes.windows(2).any(|w| w[0].seq == w[1].seq) {
        return Err(ChangeFileError::DuplicateSeq);
    }
    validate(&sorted)?;
    let value = serde_json::to_value(&sorted).map_err(|_| ChangeFileError::Malformed)?;
    let json = canonical_json(&value);
    // Fixed mtime and OS byte so equal sets give identical bytes anywhere.
    let mut gz = GzBuilder::new()
        .mtime(0)
        .operating_system(255)
        .write(Vec::new(), Compression::default());
    gz.write_all(json.as_bytes())
        .map_err(|_| ChangeFileError::Compress)?;
    let bytes = gz.finish().map_err(|_| ChangeFileError::Compress)?;
    let sha256 = sha256_hex(&bytes);
    let file_name = file_name(&set.device_id, set.from_seq, set.to_seq, &sha256);
    Ok(EncodedChangeFile {
        bytes,
        sha256,
        file_name,
    })
}

/// Shared by `encode` and `decode`; expects `changes` sorted by `seq`.
fn validate(set: &ChangeSet) -> Result<(), ChangeFileError> {
    if set.from_seq < 1
        || set.to_seq < set.from_seq
        || set.schema_version < 1
        || set.changes.is_empty()
        || set.changes.windows(2).any(|w| w[0].seq >= w[1].seq)
        || set
            .changes
            .iter()
            .any(|c| c.seq < set.from_seq || c.seq > set.to_seq)
    {
        return Err(ChangeFileError::Malformed);
    }
    for change in &set.changes {
        let Some(sync_table) = tables::table(&change.table) else {
            return Err(ChangeFileError::UnknownTable(change.table.clone()));
        };
        if change.row_id.is_empty()
            || change.row_id.len() > 256
            || parse_iso_ms(&change.changed_at).is_none()
            || (change.op == Op::Delete) != change.row.is_none()
        {
            return Err(ChangeFileError::Malformed);
        }
        if let Some(row) = &change.row {
            if row.get(sync_table.primary_key).and_then(Value::as_str)
                != Some(change.row_id.as_str())
            {
                return Err(ChangeFileError::Malformed);
            }
        }
    }
    Ok(())
}

/// `<from>-<to>-<sha12>.json.gz` taken apart; `None` for any other shape.
pub(crate) fn parse_name(name: &str) -> Option<(i64, i64, &str)> {
    let stem = name.strip_suffix(SUFFIX)?;
    let mut parts = stem.splitn(3, '-');
    let from = parts.next()?.parse().ok()?;
    let to = parts.next()?.parse().ok()?;
    let sha = parts.next()?;
    Some((from, to, sha))
}

pub(crate) fn decode(
    bytes: &[u8],
    file_name: &str,
    local_schema: i64,
    now: &str,
) -> Result<DecodedChangeFile, ChangeFileError> {
    let (name_from, name_to, name_sha) =
        parse_name(file_name).ok_or(ChangeFileError::NameMismatch)?;
    if name_sha.len() != 12 || sha256_hex(bytes)[..12] != *name_sha {
        return Err(ChangeFileError::NameMismatch);
    }
    // Read at most cap + 1 bytes, so an inflate bomb never fully inflates.
    let mut inflated = Vec::new();
    GzDecoder::new(bytes)
        .take(MAX_DECODED_BYTES + 1)
        .read_to_end(&mut inflated)
        .map_err(|_| ChangeFileError::Malformed)?;
    if inflated.len() as u64 > MAX_DECODED_BYTES {
        return Err(ChangeFileError::TooLarge);
    }
    let value: Value = serde_json::from_slice(&inflated).map_err(|_| ChangeFileError::Malformed)?;
    drop(inflated);
    let version = value
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or(ChangeFileError::Malformed)?;
    if version > u64::from(CHANGE_FORMAT_VERSION) {
        return Err(ChangeFileError::FormatTooNew);
    }
    let schema = value
        .get("schemaVersion")
        .and_then(Value::as_i64)
        .ok_or(ChangeFileError::Malformed)?;
    if schema > local_schema {
        return Err(ChangeFileError::SchemaTooNew);
    }
    let set: ChangeSet = serde_json::from_value(value).map_err(|_| ChangeFileError::Malformed)?;
    if !valid_device_id(&set.device_id) {
        return Err(ChangeFileError::BadDeviceId);
    }
    if set.from_seq != name_from || set.to_seq != name_to {
        return Err(ChangeFileError::NameMismatch);
    }
    validate(&set)?;
    let created = parse_iso_ms(&set.created_at).ok_or(ChangeFileError::Malformed)?;
    let now_ms = parse_iso_ms(now).ok_or(ChangeFileError::Malformed)?;
    Ok(DecodedChangeFile {
        created_in_future: created > now_ms.saturating_add(FUTURE_SLACK_MS),
        set,
    })
}
