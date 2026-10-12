-- Her Flight Deck — somewhere to just write something down.
--
-- Every other place a thought can go asks a question first: which lesson,
-- which material, which goal, which topic. That is the right shape for a
-- debrief and the wrong shape for "the school on the north field answers the
-- phone after four". A note asks nothing. A title she may leave blank, the
-- text itself, and a pin for the few worth keeping at the top.
--
-- Free text and nothing else on purpose: the moment a note needs a category
-- it stops being the place she can write without deciding anything first.

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The list is read pinned first, then most recently touched.
CREATE INDEX idx_notes_pinned_updated ON notes(pinned DESC, updated_at DESC);
