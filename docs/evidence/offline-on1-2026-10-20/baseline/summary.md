# Offline extraction: baseline

Owner Mac M5 / 32 GiB; weaker evidence than a minimum-spec Mac. Synthetic PDFs only.

RSS: macOS /usr/bin/time -l, supervisor plus worker child rusage; conservative process peak

| File | Outcome | Peak RSS MiB | Seconds | Pass |
| --- | --- | ---: | ---: | --- |
| synthetic-illustrated-charts.pdf | ok | unavailable | 0.665 | False |
| synthetic-long-manual.pdf | ok | unavailable | 0.241 | False |
| synthetic-small-checklist.pdf | ok | unavailable | 0.021 | False |

Pass criteria:

- Every synthetic file: ok, or clean memory_limit/deadline refusal; no crash.
- No partial publish: probe never writes a cache or app database; only fully validated results count as ok.
- No hang beyond 120 seconds (production supervisor deadline 119 s, outer watchdog 120 s).
- Peak RSS <= 640 MiB (512 MiB counted cap plus approximately 1.25x overhead).
- App state untouched: only temporary synthetic inputs/target and requested output directory are used.

Overall pass: False
