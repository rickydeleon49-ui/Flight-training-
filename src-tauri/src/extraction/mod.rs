//! OFFLINE-01a: local text extraction in a separate, capped worker process,
//! and a content-addressed derived cache. See
//! docs/OFFLINE_01_INVENTORY_AND_PROPOSAL_2026-10-19.md.

pub mod alloc;
pub mod cache;
pub mod form_text;
pub mod inspect;
pub mod search;
pub mod search_api;
pub mod service;
pub mod supervisor;
pub mod worker;
