# Offline extraction memory check

This check uses synthetic PDFs from `scripts/generate-pdf-fixtures.mjs`: a
10-page checklist, a 1,050-page text manual and 60 illustrated pages (~54 MB).
It builds the production worker and a small supervisor probe in the release
profile, with extraction enabled only in a temporary target directory. The
script removes that directory on exit. It never starts the app or opens its
profile, cache or database. No installed build or release config is changed.

From the repository root on the owner's Mac (Apple M5, 32 GiB):

```sh
python3 /Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py \
  docs/evidence/offline-on1-2026-10-20/baseline.log \
  scripts/offline-extraction-pressure-check.sh baseline \
  docs/evidence/offline-on1-2026-10-20/baseline
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
  docs/evidence/offline-on1-2026-10-20/pressure.log \
  scripts/offline-extraction-pressure-check.sh pressure \
  docs/evidence/offline-on1-2026-10-20/pressure
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

Pass requires every file to finish `ok`, `memory_limit` or `deadline`, no crash,
no partial publication, no hang beyond 120 seconds, peak RSS at most 640 MiB
(512 MiB cap plus ~1.25× overhead), and other app state untouched. A missing RSS
sample or outer watchdog failure fails the check. A nonzero exit is a failed
check, not release authorization.

Only baseline mode is run by this implementation round. In Codex's sandbox,
`/usr/bin/time -l` can fail with `sysctl kern.clockrate: Operation not permitted`
after the worker succeeds. Such a run keeps the worker outcome/counts but marks
RSS unavailable and fails acceptance. The reviewer must rerun outside that
sandbox; counted allocator bytes are not an RSS substitute. Measurements on this
M5 / 32 GiB Mac are weaker evidence than measurements on a minimum-spec Mac;
synthetic documents also do not establish every real-document workload. The
release switch enables both local PDF study kits and offline search and stays
off until the reviewer accepts the evidence in OFFLINE-ON-2.
