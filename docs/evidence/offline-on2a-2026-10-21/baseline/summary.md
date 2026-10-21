# Offline extraction: baseline

Owner Mac M5 / 32 GiB; weaker evidence than a minimum-spec Mac. Synthetic PDFs only.

RSS: macOS /usr/bin/time -l, supervisor plus worker child rusage; conservative process peak

| File | Outcome | Counted peak MiB | Peak RSS MiB | Seconds | Pass |
| --- | --- | ---: | ---: | ---: | --- |
| synthetic-illustrated-charts.pdf | ok | 115.88 | unavailable | 0.545 | False |
| synthetic-long-manual.pdf | ok | 4.85 | unavailable | 0.142 | False |
| synthetic-near-cap.pdf | ok | 412.74 | unavailable | 0.192 | False |
| synthetic-over-cap.pdf | memory_limit | unavailable | unavailable | 0.325 | False |
| synthetic-small-checklist.pdf | ok | 0.07 | unavailable | 0.014 | False |

Pass criteria:

- Exactly the five named synthetic fixtures, each <= 128 MiB input.
- Checklist, long manual, illustrated charts and near-cap: ok; over-cap: memory_limit with zero pages. No deadline or crash passes.
- Near-cap counted peak: 300 to 500 MiB inclusive; RSS measured independently.
- No partial publish: probe never writes a cache or app database; only fully validated results count as ok.
- No hang beyond 120 seconds (production supervisor deadline 119 s, outer watchdog 120 s).
- Peak RSS <= 640 MiB (512 MiB counted cap plus approximately 1.25x overhead).
- App state untouched: only temporary synthetic inputs/target and requested output directory are used.

Overall pass: False
