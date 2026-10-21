# OFFLINE-ON-2: memory-pressure run on the owner's Mac (owner OK 2026-10-21): PASS

## Machine

Apple M5, 32 GiB. This is weaker evidence than a minimum-spec Mac.

## Pressure

`/usr/bin/memory_pressure -l warn`, under a cleanup trap. `kern.memorystatus_vm_pressure_level` was **2 (warn)** from 06:40:11 to 06:44:07, with about 40% free. The level was recorded every 10 s in `pressure-levels.txt`. HW-01d's Codex gate was also running concurrently, adding load.

## Script

`offline-extraction-pressure-check.sh pressure`: overall PASS.

| File | Outcome | RSS MiB |
| --- | --- | ---: |
| illustrated-charts | ok | 113.8 |
| long-manual | ok | 15.3 |
| near-cap | ok | 268.6 (counted 412.7) |
| over-cap | memory_limit | 428.1 |
| small-checklist | ok | 10.0 |

Every file finished in 1.05 s or less, within the 640 MiB limit, with no crash and no partial publish. `memory_pressure` was stopped afterwards.
