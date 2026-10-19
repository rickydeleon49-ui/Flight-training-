#!/usr/bin/env python3
"""OFFLINE-01c: run the release extraction worker over real, public-domain
FAA handbooks and record per-page coverage, memory and time.

The corpus is downloaded separately (URLs and SHA-256 in corpus.txt) and kept
outside Git. Observations only; nothing here is a bound.

  python3 corpus.py --worker PATH --corpus DIR --out results.json
"""
import argparse, hashlib, json, os, subprocess, sys, time

MIB = 1024 * 1024
MARKER = b"HFD-EXTRACT-MEMORY-LIMIT\n"


def run(worker, path, sha, memory=None):
    request = {"path": path, "sha256": sha}
    if memory:
        request["limits"] = {"memoryBytes": memory}
    started = time.monotonic()
    p = subprocess.run(
        ["/usr/bin/time", "-l", worker, "--hfd-extract-worker"],
        input=json.dumps(request).encode(), capture_output=True, env={}, timeout=900,
    )
    wall = time.monotonic() - started
    rss = None
    for line in p.stderr.decode(errors="replace").splitlines():
        if "maximum resident set size" in line:
            rss = int(line.split()[0])
    frames = [json.loads(l) for l in p.stdout.decode(errors="replace").splitlines() if l.strip()]
    pages = [f for f in frames if f.get("type") == "page"]
    counts, text_bytes, samples, errors = {}, 0, [], {}
    for f in pages:
        counts[f["outcome"]] = counts.get(f["outcome"], 0) + 1
        text_bytes += len(f.get("text", "").encode())
        if f.get("error"):
            errors[f["error"]] = errors.get(f["error"], 0) + 1
    # A few short samples from text pages spread through the document.
    text_pages = [f for f in pages if f["outcome"] == "text"]
    for f in text_pages[:: max(1, len(text_pages) // 4)][:4]:
        t = " ".join(f["text"].split())
        samples.append({"page": f["index"], "excerpt": t[:160]})
    start = next((f for f in frames if f.get("type") == "start"), None)
    end = next((f for f in frames if f.get("type") == "end"), None)
    err = next((f for f in frames if f.get("type") == "error"), None)
    return {
        "exit": p.returncode,
        "breachMarker": p.stderr.startswith(MARKER),
        "result": "success" if end else ("reported:" + err["code"] if err else ("memory_limit" if p.stderr.startswith(MARKER) else "worker_failed")),
        "pages": start["pages"] if start else None,
        "outcomes": counts,
        "pageErrors": errors,
        "textBytes": text_bytes,
        "countedPeakBytes": end.get("peakBytes") if end else None,
        "peakRssMiB": round(rss / MIB, 1) if rss else None,
        "wallSeconds": round(wall, 2),
        "samples": samples,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--memory", type=int, default=None, help="optional lower cap in bytes")
    a = ap.parse_args()
    entries = []
    with open(os.path.join(a.corpus, "corpus.txt")) as f:
        for line in f:
            name, size, sha, url = line.split()
            entries.append((name, int(size), sha, url))
    results = []
    for name, size, sha, url in entries:
        path = os.path.join(a.corpus, name)
        with open(path, "rb") as fh:
            assert hashlib.sha256(fh.read()).hexdigest() == sha, name
        r = run(a.worker, path, sha, a.memory)
        r.update({"file": name, "bytes": size, "sha256": sha, "url": url})
        results.append(r)
        print(json.dumps({k: r[k] for k in ("file", "result", "pages", "outcomes", "textBytes", "countedPeakBytes", "peakRssMiB", "wallSeconds")}), flush=True)
    with open(a.out, "w") as f:
        json.dump({"worker": a.worker, "memoryCap": a.memory or 384 * MIB, "results": results}, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    sys.exit(main())
