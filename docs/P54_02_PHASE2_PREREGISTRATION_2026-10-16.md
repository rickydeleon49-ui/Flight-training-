# P54-02 phase 2: pre-registered limits, cases and targets

Committed **before** any phase 2 proof code ran or any measurement was taken. The proof report must quote these values unchanged. A miss is reported as a miss, never fixed by adjusting a value afterwards. All values are exploratory proof settings, **not owner-approved production defaults**.

## Worker limits and where each applies

| Limit | Value | Applies at | Kind |
| --- | --- | --- | --- |
| Input bytes | 128 MiB | Caller checks the file size before spawning. The worker reads through `take(limit + 1)` and refuses if more arrives. | Hard (pre-read) |
| Content identity | SHA-256 of the exact bytes read | The caller hashes the file when it takes ownership. The worker hashes what it parsed. Before publication the caller re-hashes the file at its path. All three must match. | Hard |
| Page output | 64 KiB of UTF-8 text per physical page | The worker checks after `lopdf::extract_text` returns. That is **post-allocation**, so this is a result-size refusal, not a memory bound. | Soft |
| Total result | 16 MiB of text per document | The worker stops emitting page text once the total would exceed this. | Soft (post-allocation) |
| IPC frame | 512 KiB per NDJSON line | Supervisor reader. JSON escaping can grow 64 KiB of control characters about 6×. | Hard (reader buffer) |
| IPC stream | 32 MiB per worker | Supervisor reader. On overflow it kills the worker. | Hard (reader buffer) |
| Deadline | 30 s per document; tests pass shorter values explicitly | Supervisor wall clock from spawn. On expiry it kills, reaps and records the pid and exit status. | Hard (time) |
| Worker memory | 512 MiB RSS | Attempt 1: `ulimit -v` before exec, enforcement recorded. Attempt 2: supervisor RSS watchdog that samples `ps` every 25 ms and kills when the limit is exceeded. | Reported as observed. The watchdog is sampled, so overshoot between samples is measured, not assumed away. |
| Concurrent workers | 2 | Supervisor admission. Further requests queue. | Hard |
| Retained results | 8 documents | Supervisor result store, least recently used. | Hard |

Rationale: 128 MiB covers large scanned or illustrated handbooks without letting an arbitrary file be read whole; real handbook sizes are still to be confirmed. 64 KiB per page is phase 1's proposal and is about 10× a dense text page. 30 s leaves room for a large, slow, debug-built document. Two workers keep a laptop responsive. Eight retained results cover one material plus recent switches.

## Required cases (pass/fail recorded per case)

**Extraction**
- Text pages in physical order despite reordered object ids.
- An image-only page reported as `no_extractable_text`; this is not proof that the page is a scan.
- A compressed oversized-text page refused at the page limit.
- A decompression bomb stopped by the deadline or the memory watchdog.
- A malformed file and a truncated file both reported as `malformed`.
- WinAnsi accented text (café).

Complex-font and CID/Unicode coverage is **explicitly not covered**: no licensed fixture is added, and no private PDF is read.

**Identity**
- A file replaced before the worker reads it is refused.
- A file replaced after the worker reads it but before publication is refused at the caller's re-check.
- A request or material change while a worker is held.
- An old success or error completing after supersession publishes nothing and starts no indexing.

**Lifecycle**
- Explicit cancellation and supersession kill and reap the worker, with the pid and exit status recorded.
- No live child remains; owned scratch is removed and nothing else is touched.

**Protocol**
- An oversized line, invalid UTF-8, malformed JSON, a stall, a non-zero exit and an exit without a result each settle as a bounded failure.
- Error text contains no path, content or credential.

**Admission**
- A third request waits while two workers run.
- The ninth retained result evicts the least recently used.

**Cache and semantics (native FTS5 in a disposable database, never the shared schema)**
- Literal words and phrases, punctuation, and FTS operator text treated literally.
- Query and result bounds.
- Accent, case and Unicode folding, asserted by result id.
- Plain-text excerpts of bounded size.
- A stale hash never offered as a destination.
- Index replacement, deletion and duplicate titles.
- An update cancelled while pending.
- A replacement after extraction but before publication.
- Reopen, rebuild, disposal on a synthetic restore, and recovery after a process killed mid-write.

## Measurement plan and targets

Measurement runs only after every case above passes. Debug build, Apple M5, Node 22. Each stage is reported separately: input load, PDF extraction, cold index, persist and reopen, warm query, and IPC parse. Process peak RSS comes from `/usr/bin/time -l` and is whole-process, not steady state. There is no native painted interaction and no IPC to a WebView; those stay pending.

**Datasets**
- **Generated PDFs:** 10, 100 and 300 text pages, plus the bomb.
- **Search corpora:** 100, 1,000 and 10,000 materials. The corpus generator is seeded. It draws from about 400 aviation and general terms, varies sentence lengths, and adds Unicode, accented and duplicate-title variants. It replaces phase 1's repeated-word corpus.

**Repeats:** 3 fresh processes per size, and 15 samples per query.

| Target (debug build) | Value |
| --- | --- |
| 300-page text PDF extraction in worker, wall time | ≤ 10 s |
| Same, worker peak RSS | ≤ 256 MiB |
| Bomb or stall stopped after deadline, then reaped | ≤ deadline + 500 ms |
| Worker spawn → first frame, no-op document, median | ≤ 100 ms |
| IPC NDJSON parse throughput | ≥ 50 MB/s |
| Cold FTS5 index, 10,000 materials | ≤ 3 s |
| Warm literal query at 10,000, p95 | ≤ 50 ms |
| Reopen the cache and run the first query at 10,000 | ≤ 300 ms |
| Whole-process peak RSS, 10,000 index run | ≤ 256 MiB |

These targets gate only this proof. Production budgets need a release build and native painted measurements, and the owner sets them.
