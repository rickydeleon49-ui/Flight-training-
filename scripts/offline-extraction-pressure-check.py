"""Measure disposable production workers. Only generated fixtures are accepted."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time


EXPECTED_OUTCOMES = {
    "synthetic-small-checklist.pdf": "ok",
    "synthetic-long-manual.pdf": "ok",
    "synthetic-illustrated-charts.pdf": "ok",
    "synthetic-near-cap.pdf": "ok",
    "synthetic-over-cap.pdf": "memory_limit",
}


def main():
    mode, output, scratch = sys.argv[1:]
    out, temp = Path(output), Path(scratch)
    rows = []
    for pdf in sorted((temp / "fixtures").glob("synthetic-*.pdf")):
        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        # /usr/bin/time includes the supervisor and its worker's child rusage.
        # The production supervisor validates full protocol + EOF + exit before ok.
        command = ["/usr/bin/time", "-l", str(temp / "target/release/examples/offline_pressure_probe"),
                   str(temp / "target/release/her-flight-deck"), str(pdf), sha]
        started = time.monotonic()
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   cwd=temp, start_new_session=True)
        try:
            stdout, stderr = process.communicate(timeout=120)
            row = json.loads(stdout)
            if not isinstance(row, dict) or "outcome" not in row:
                raise ValueError("invalid probe result")
        except subprocess.TimeoutExpired:
            # Emergency watchdog: kill/reap the whole isolated process group, including worker.
            import signal
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
            row = {"outcome": "crash", "detail": "outer watchdog exceeded 120 seconds"}
        except ValueError:
            row = {"outcome": "crash", "detail": "invalid probe output"}
        (out / (pdf.stem + ".time.log")).write_bytes(stderr)
        (out / (pdf.stem + ".probe.json")).write_bytes(stdout)
        rss = re.search(rb"(\d+)\s+maximum resident set size", stderr)
        row.update(file=pdf.name, sha256=sha, bytes=pdf.stat().st_size,
                   wallSeconds=time.monotonic() - started,
                   peakRssBytes=int(rss[1]) if rss else None,
                   processExit=process.returncode,
                   measurementError="" if rss and process.returncode == 0 else "time/RSS measurement failed; inspect time log")
        row["pass"] = (row["outcome"] == EXPECTED_OUTCOMES.get(pdf.name)
                       and row["bytes"] <= 128 * 1024**2
                       and (pdf.name != "synthetic-near-cap.pdf"
                            or 300 * 1024**2 <= row.get("countedPeakBytes", 0) <= 500 * 1024**2)
                       and (pdf.name != "synthetic-over-cap.pdf" or row.get("pages") == 0)
                       and row.get("partialPublish") is False
                       and process.returncode == 0
                       and row["peakRssBytes"] is not None
                       and row["peakRssBytes"] <= 640 * 1024 * 1024
                       and row["wallSeconds"] <= 120)
        rows.append(row)
    criteria = ["Exactly the five named synthetic fixtures, each <= 128 MiB input.",
                "Checklist, long manual, illustrated charts and near-cap: ok; over-cap: memory_limit with zero pages. No deadline or crash passes.",
                "Near-cap counted peak: 300 to 500 MiB inclusive; RSS measured independently.",
                "No partial publish: probe never writes a cache or app database; only fully validated results count as ok.",
                "No hang beyond 120 seconds (production supervisor deadline 119 s, outer watchdog 120 s).",
                "Peak RSS <= 640 MiB (512 MiB counted cap plus approximately 1.25x overhead).",
                "App state untouched: only temporary synthetic inputs/target and requested output directory are used."]
    passed = {row["file"] for row in rows} == set(EXPECTED_OUTCOMES) and all(row["pass"] for row in rows)
    summary = dict(mode=mode, machine=platform.machine(), host=platform.platform(),
                   pressure="operator supplied warn" if mode == "pressure" else "none requested",
                   rssMethod="macOS /usr/bin/time -l, supervisor plus worker child rusage; conservative process peak",
                   passCriteria=criteria, files=rows, passed=passed,
                   evidenceLimit="Owner Mac M5 / 32 GiB; weaker evidence than a minimum-spec Mac. Synthetic PDFs only.")
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    lines = [f"# Offline extraction: {mode}", "", summary["evidenceLimit"], "",
             "RSS: " + summary["rssMethod"], "", "| File | Outcome | Counted peak MiB | Peak RSS MiB | Seconds | Pass |",
             "| --- | --- | ---: | ---: | ---: | --- |"]
    for row in rows:
        rss = f'{row["peakRssBytes"] / 1024**2:.2f}' if row["peakRssBytes"] is not None else "unavailable"
        counted = f'{row["countedPeakBytes"] / 1024**2:.2f}' if row["outcome"] == "ok" and "countedPeakBytes" in row else "unavailable"
        lines.append(f'| {row["file"]} | {row["outcome"]} | {counted} | {rss} | {row["wallSeconds"]:.3f} | {row["pass"]} |')
    lines += ["", "Pass criteria:", ""] + ["- " + item for item in criteria]
    lines += ["", f"Overall pass: {passed}", ""]
    (out / "summary.md").write_text("\n".join(lines))
    print(json.dumps(summary, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
