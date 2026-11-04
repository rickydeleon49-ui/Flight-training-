//! Replay of card ratings through the live scheduler (D4 ordering).

use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::card_reviews::{self, CardSchedule, SchedulerRefusal};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewEvent {
    pub id: String,
    pub item_id: String,
    /// Provenance supplied by the caller from the durable per-row origin (S-2b
    /// `sync_row_meta.device_id`), never from the exporter's current device id.
    pub device_id: String,
    pub generation: i64,
    pub rating: String,
    pub reviewed_at: String,
    pub scheduler_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReplayError {
    Scheduler(SchedulerRefusal),
    MixedItems,
    BadTime,
    BadGeneration,
    ConflictingDuplicate,
}

impl std::fmt::Display for ReplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Scheduler(_) => "the scheduler refused a review",
            Self::MixedItems => "reviews for more than one card were mixed",
            Self::BadTime => "a review time could not be read",
            Self::BadGeneration => "a review has an invalid generation",
            Self::ConflictingDuplicate => "two review events share an id but differ",
        })
    }
}

/// D4 order: `(reviewed_at, device_id, event_id)`. An unreadable time sorts
/// first; `replay_item` refuses such events before it ever sorts.
pub(crate) fn order_key(e: &ReviewEvent) -> (i64, &str, &str) {
    (
        card_reviews::parse_iso_ms(&e.reviewed_at).unwrap_or(i64::MIN),
        e.device_id.as_str(),
        e.id.as_str(),
    )
}

/// The schedule for one card after replaying its events. Identical duplicate
/// ids count once; the same id with differing fields is refused. The barrier is
/// `max(local_generation, highest event generation)`: only events at the
/// barrier replay (older ones were reset away). Returns the schedule only:
/// `suspended`/`flag` are LWW columns that S-2c carries over from the local
/// `card_review_state` row; replay never clears them.
pub(crate) fn replay_item(
    events: &[ReviewEvent],
    local_generation: i64,
) -> Result<Option<CardSchedule>, ReplayError> {
    if local_generation < 0 || events.iter().any(|e| e.generation < 0) {
        return Err(ReplayError::BadGeneration);
    }
    if let Some(first) = events.first() {
        if events.iter().any(|e| e.item_id != first.item_id) {
            return Err(ReplayError::MixedItems);
        }
    }
    let mut seen: HashMap<&str, &ReviewEvent> = HashMap::new();
    let mut unique: Vec<&ReviewEvent> = Vec::new();
    for e in events {
        match seen.get(e.id.as_str()) {
            Some(prev) if *prev != e => return Err(ReplayError::ConflictingDuplicate),
            Some(_) => {}
            None => {
                seen.insert(e.id.as_str(), e);
                unique.push(e);
            }
        }
    }
    let barrier = unique
        .iter()
        .map(|e| e.generation)
        .max()
        .map_or(local_generation, |m| m.max(local_generation));
    let mut kept: Vec<&ReviewEvent> = unique
        .into_iter()
        .filter(|e| e.generation == barrier)
        .collect();
    if kept.is_empty() {
        return Ok(None);
    }
    if kept
        .iter()
        .any(|e| e.scheduler_version != card_reviews::SCHEDULER_VERSION)
    {
        return Err(ReplayError::Scheduler(
            SchedulerRefusal::UnsupportedSchedulerVersion,
        ));
    }
    if kept
        .iter()
        .any(|e| card_reviews::parse_iso_ms(&e.reviewed_at).is_none())
    {
        return Err(ReplayError::BadTime);
    }
    kept.sort_by(|a, b| order_key(a).cmp(&order_key(b)));
    let mut prior: Option<CardSchedule> = None;
    for e in kept {
        let next = card_reviews::schedule_card(prior.as_ref(), &e.rating, &e.reviewed_at)
            .map_err(ReplayError::Scheduler)?;
        prior = Some(next);
    }
    Ok(prior)
}

/// Decode a `card_review_events` row as `read_row_json` produces it. Extra
/// columns are ignored; a missing or mistyped one gives `None`.
pub(crate) fn event_from_row(row: &Map<String, Value>, device_id: &str) -> Option<ReviewEvent> {
    let text = |key: &str| row.get(key).and_then(Value::as_str).map(str::to_string);
    Some(ReviewEvent {
        id: text("id")?,
        item_id: text("item_id")?,
        device_id: device_id.to_string(),
        generation: row.get("generation")?.as_i64()?,
        rating: text("rating")?,
        reviewed_at: text("reviewed_at")?,
        scheduler_version: text("scheduler_version")?,
    })
}
