# Offline extraction memory check

This check uses synthetic PDFs from `scripts/generate-pdf-fixtures.mjs`: a
10-page checklist, a 1,050-page text manual, 60 illustrated pages (~54 MB),
a near-cap load and an over-cap load. The last two are one-page PDFs with
compressed cross-reference streams containing 38,000,000 and 150,000,000
free-object entries. They decode during document loading, before the page
content budget applies. Fixed Huffman encoding makes their bytes independent
of the host zlib version; the generator never allocates the full decoded stream.
The inputs are 1,676,036 and 6,614,022 bytes, well below 128 MiB. The near-cap
stream expands to 266,000,049 bytes and the over-cap stream to 1,050,000,049.
These are deliberate load-time stress cases, not typical handbook layouts.
It builds the production worker and a small supervisor probe in the release
profile, with extraction enabled only in a temporary target directory. The
script removes that directory on exit. It never starts the app or opens its
profile, cache or database. No installed build or release config is changed.

From the repository root on the owner's Mac (Apple M5, 32 GiB):

```sh
python3 /Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py \
  docs/evidence/offline-on2a-2026-10-21/baseline.txt \
  scripts/offline-extraction-pressure-check.sh baseline \
  docs/evidence/offline-on2a-2026-10-21/baseline
```

The reviewer runs pressure mode only after the owner agrees. Save other work
first. In a separate terminal, start the macOS tool at the warning level:

```sh
/usr/bin/memory_pressure -l warn
```

`warn` applies real memory pressure until macOS issues warning-level low-memory
notifications;
other apps may slow down as the OS reclaims memory. It is not a fixed free-RAM
quantity or a simulation of a particular minimum-spec Mac. `critical` may
close other apps, so it is not used. The measurement script never starts or
stops this tool. Leave it running while the reviewer runs, from the repo root:

```sh
python3 /Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py \
  docs/evidence/offline-on2a-2026-10-21/pressure.txt \
  scripts/offline-extraction-pressure-check.sh pressure \
  docs/evidence/offline-on2a-2026-10-21/pressure
```

Then press Control-C in the pressure-tool terminal. The script's `pressure`
label records operator-supplied conditions; it does not prove warning pressure
was present. The reviewer must record that separately.

Inspect `summary.json`, `summary.md`, the build/fixture logs and each file's
`.time.log` and `.probe.json`. `/usr/bin/time -l` records maximum resident set
size in bytes on macOS, including supervisor/worker child resource usage; the
production allocator's counted peak is recorded separately. The supervisor
accepts a result only after complete protocol validation, both pipes reach EOF
and a successful worker exit. Refusals publish no pages; the probe never writes
app state. Each worker has a 119-second supervisor deadline and the outer
watchdog kills/reaps its isolated process group at 120 seconds.

Pass requires exactly these five files and outcomes:

| File | Required outcome | Additional counted-memory check |
| --- | --- | --- |
| `synthetic-small-checklist.pdf` | `ok` | — |
| `synthetic-long-manual.pdf` | `ok` | — |
| `synthetic-illustrated-charts.pdf` | `ok` | — |
| `synthetic-near-cap.pdf` | `ok` | Counted peak between 300 and 500 MiB inclusive |
| `synthetic-over-cap.pdf` | `memory_limit` | Zero pages published |

Every input must be at most 128 MiB. Every run must have no crash, no partial
publication, no hang beyond 120 seconds and peak RSS at most 640 MiB (512 MiB
counted cap times 1.25). A `deadline` is a failure, as is an unexpected refusal
on any of the four success cases or success on the over-cap case. Missing or
extra synthetic fixtures, a missing RSS sample, a failed timing tool or an outer
watchdog failure fail acceptance. Other app state must remain untouched.
A nonzero exit is a failed check, not release authorization. The probe reports
counted peak only on success; its zero on `memory_limit` is a placeholder, not
a measured zero or the attempted allocation size.

Only baseline mode is run by this implementation round. In Codex's sandbox,
`/usr/bin/time -l` can fail with `sysctl kern.clockrate: Operation not permitted`
after the worker succeeds. Such a run keeps the worker outcome/counts but marks
RSS unavailable and fails acceptance. The reviewer must rerun outside that
sandbox; counted allocator bytes are not an RSS substitute. Measurements on this
M5 / 32 GiB Mac are weaker evidence than measurements on a minimum-spec Mac;
synthetic documents also do not establish every real-document workload. The
release switch enables both local PDF study kits and offline search and stays
off until the reviewer accepts the evidence in OFFLINE-ON-2.
