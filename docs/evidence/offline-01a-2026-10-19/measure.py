#!/usr/bin/env python3
"""OFFLINE-01a worker measurements: peak RSS against the allocator cap.

Generates synthetic, adversarial PDFs into a fresh scratch folder, runs the
release worker on each through /usr/bin/time -l, and records exit code,
classification evidence (the breach marker), wall time and peak RSS.
Observations only; nothing here is a bound.

  python3 measure.py --worker PATH --scratch NEW_DIR --out results.json
"""
import argparse, hashlib, json, os, subprocess, sys, time, zlib

MIB = 1024 * 1024
MARKER = b"HFD-EXTRACT-MEMORY-LIMIT\n"


def deflate_spaces(total, head=b""):
    """Compress `head` followed by spaces up to `total` bytes, streaming."""
    c = zlib.compressobj(6)
    out = [c.compress(head)]
    left = total - len(head)
    chunk = b" " * MIB
    while left > 0:
        n = min(left, MIB)
        out.append(c.compress(chunk[:n]))
        left -= n
    out.append(c.flush())
    return b"".join(out)


def pdf(objects, root_id):
    """Serialize numbered objects (1..n) with a classic xref table."""
    body = [b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n"]
    offsets = []
    pos = len(body[0])
    for i, obj in enumerate(objects, start=1):
        data = b"%d 0 obj\n" % i + obj + b"\nendobj\n"
        offsets.append(pos)
        body.append(data)
        pos += len(data)
    xref = [b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)]
    xref += [b"%010d 00000 n \n" % o for o in offsets]
    trailer = b"trailer\n<</Size %d/Root %d 0 R>>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, root_id, pos)
    return b"".join(body) + b"".join(xref) + trailer


def stream(dict_bytes, data):
    return b"<<" + dict_bytes + b"/Length %d>>\nstream\n" % len(data) + data + b"\nendstream"


FONT = b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>"


def doc_with_pages(contents_ids, extra_objects):
    """Pages object first; each page references a content object id."""
    n_extra = len(extra_objects)
    # Layout: 1 catalog, 2 pages, 3 font, 4.. extra objects, then pages.
    first_page = 4 + n_extra
    page_ids = list(range(first_page, first_page + len(contents_ids)))
    kids = b" ".join(b"%d 0 R" % p for p in page_ids)
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Count %d/Kids[%s]>>" % (len(page_ids), kids),
        FONT,
    ] + extra_objects
    for cid in contents_ids:
        objs.append(b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 3 0 R>>>>/Contents %d 0 R>>" % cid)
    return pdf(objs, 1)


def case_text():
    content = stream(b"", b"BT /F1 12 Tf 72 700 Td (Crosswind landing) Tj ET")
    return doc_with_pages([4], [content])


def case_bomb(decoded):
    data = deflate_spaces(decoded, b"BT /F1 12 Tf (x) Tj ET ")
    return doc_with_pages([4], [stream(b"/Filter/FlateDecode", data)])


def case_shared(pages, decoded):
    text = (b"BT /F1 9 Tf 20 800 Td (" + b"density altitude " * 8 + b") Tj ET\n") * (decoded // 160)
    data = zlib.compress(text, 6)
    return doc_with_pages([4] * pages, [stream(b"/Filter/FlateDecode", data)])


CASES = [
    ("text-1-page", case_text, None),
    ("content-bomb-64MiB-decoded", lambda: case_bomb(64 * MIB), None),
    ("content-bomb-1GiB-decoded", lambda: case_bomb(1024 * MIB), None),
    ("content-bomb-1GiB-cap-64MiB", lambda: case_bomb(1024 * MIB), 64 * MIB),
    ("shared-stream-400-pages-2MiB", lambda: case_shared(400, 2 * MIB), None),
]


def run(worker, path, sha, memory):
    request = {"path": path, "sha256": sha}
    if memory:
        request["limits"] = {"memoryBytes": memory}
    started = time.monotonic()
    p = subprocess.run(
        ["/usr/bin/time", "-l", worker, "--hfd-extract-worker"],
        input=json.dumps(request).encode(), capture_output=True, env={}, timeout=600,
    )
    wall = time.monotonic() - started
    rss = None
    for line in p.stderr.decode(errors="replace").splitlines():
        if "maximum resident set size" in line:
            rss = int(line.split()[0])
    frames = [json.loads(l) for l in p.stdout.decode(errors="replace").splitlines() if l.strip()]
    kinds = {}
    for f in frames:
        key = f.get("type") if f.get("type") != "page" else "page:" + f.get("outcome", "?")
        kinds[key] = kinds.get(key, 0) + 1
    return {
        "exit": p.returncode,
        "breachMarker": p.stderr.startswith(MARKER),
        "wallSeconds": round(wall, 3),
        "peakRssBytes": rss,
        "peakRssMiB": round(rss / MIB, 1) if rss else None,
        "frames": kinds,
        "lastFrame": frames[-1] if frames else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", required=True)
    ap.add_argument("--scratch", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.scratch, exist_ok=False)
    results = []
    for name, make, memory in CASES:
        data = make()
        path = os.path.join(a.scratch, name + ".pdf")
        with open(path, "wb") as f:
            f.write(data)
        sha = hashlib.sha256(data).hexdigest()
        r = run(a.worker, path, sha, memory)
        r.update({"case": name, "fileBytes": len(data), "memoryCapBytes": memory or 384 * MIB})
        if r["lastFrame"] and r["lastFrame"].get("type") == "page":
            r["lastFrame"] = {"type": "page", "outcome": r["lastFrame"].get("outcome")}
        results.append(r)
        print(json.dumps({k: r[k] for k in ("case", "exit", "breachMarker", "peakRssMiB", "wallSeconds", "frames")}))
    with open(a.out, "w") as f:
        json.dump({"worker": a.worker, "results": results}, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    sys.exit(main())
