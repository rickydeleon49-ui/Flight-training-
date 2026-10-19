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


def deflate_stream(head, pad_total, tail=b"", fill=b" "):
    """Compress head + fill*... + tail, streaming, to `pad_total` decoded bytes."""
    c = zlib.compressobj(6)
    out = [c.compress(head)]
    left = pad_total - len(head) - len(tail)
    chunk = fill * MIB
    while left > 0:
        n = min(left, MIB)
        out.append(c.compress(chunk[:n]))
        left -= n
    out.append(c.compress(tail))
    out.append(c.flush())
    return b"".join(out)


def xref_stream_pdf(direct, in_objstm=None, xref_pad=0):
    """Objects 1..n written directly, optionally one object (n+1) stored in
    an object stream (n+2), and a cross-reference stream (last) whose data
    may be padded with `xref_pad` zero bytes."""
    body = [b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n"]
    pos = len(body[0])
    offsets = {}
    n = len(direct)
    for i, obj in enumerate(direct, start=1):
        data = b"%d 0 obj\n" % i + obj + b"\nendobj\n"
        offsets[i] = pos
        body.append(data)
        pos += len(data)
    entries = {}
    if in_objstm is not None:
        inner_id, stm_id = n + 1, n + 2
        head = b"%d 0 " % inner_id
        data = in_objstm(head)
        obj = b"%d 0 obj\n" % stm_id + stream(b"/Type/ObjStm/N 1/First %d/Filter/FlateDecode" % len(head), data) + b"\nendobj\n"
        offsets[stm_id] = pos
        body.append(obj)
        pos += len(obj)
        entries[inner_id] = (2, stm_id, 0)
        xref_id = n + 3
    else:
        xref_id = n + 1
    offsets[xref_id] = pos
    size = xref_id + 1
    rows = []
    for i in range(size):
        if i == 0:
            rows.append(bytes([0]) + (0).to_bytes(4, "big") + (65535).to_bytes(2, "big"))
        elif i in entries:
            t, a2, b2 = entries[i]
            rows.append(bytes([t]) + a2.to_bytes(4, "big") + b2.to_bytes(2, "big"))
        else:
            rows.append(bytes([1]) + offsets[i].to_bytes(4, "big") + (0).to_bytes(2, "big"))
    raw = b"".join(rows)
    data = deflate_stream(raw, len(raw) + xref_pad, fill=b"\0") if xref_pad else zlib.compress(raw, 6)
    xref = b"%d 0 obj\n" % xref_id + stream(b"/Type/XRef/Size %d/W[1 4 2]/Root 1 0 R/Filter/FlateDecode" % size, data) + b"\nendobj\n"
    body.append(xref)
    return b"".join(body) + b"startxref\n%d\n%%%%EOF\n" % pos


def basic_direct():
    return [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Count 1/Kids[4 0 R]>>",
        FONT,
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 3 0 R>>>>/Contents 5 0 R>>",
        stream(b"", b"BT /F1 12 Tf 72 700 Td (ok) Tj ET"),
    ]


def case_objstm_bomb(decoded):
    return xref_stream_pdf(basic_direct(), in_objstm=lambda head: deflate_stream(head + b"<</Filler (", decoded, tail=b")>>"))


def case_xref_bomb(decoded):
    return xref_stream_pdf(basic_direct(), xref_pad=decoded)


def case_deep_nesting(depth):
    nested = b"[" * depth + b"]" * depth
    objs = basic_direct()
    objs[0] = b"<</Type/Catalog/Pages 2 0 R/Deep " + nested + b">>"
    return pdf(objs, 1)


def case_many_objects(count):
    filler = [b"<</K %d/V (small value %d)>>" % (i, i) for i in range(count)]
    objs = basic_direct() + filler
    return pdf(objs, 1)


def case_many_pages(pages, text_bytes):
    words = b"weight balance density altitude crosswind "
    contents = []
    for i in range(pages):
        text = (b"BT /F1 9 Tf 20 800 Td (" + words * (text_bytes // len(words) // 4) + b" %d) Tj ET\n" % i) * 4
        contents.append(stream(b"/Filter/FlateDecode", zlib.compress(text, 6)))
    ids = list(range(4, 4 + pages))
    return doc_with_pages(ids, contents)


CASES = [
    ("text-1-page", case_text, None),
    ("content-bomb-64MiB-decoded", lambda: case_bomb(64 * MIB), None),
    ("content-bomb-1GiB-decoded", lambda: case_bomb(1024 * MIB), None),
    ("content-bomb-1GiB-cap-64MiB", lambda: case_bomb(1024 * MIB), 64 * MIB),
    ("shared-stream-400-pages-2MiB", lambda: case_shared(400, 2 * MIB), None),
    ("object-stream-bomb-1GiB-at-load", lambda: case_objstm_bomb(1024 * MIB), None),
    ("xref-stream-bomb-1GiB-at-load", lambda: case_xref_bomb(1024 * MIB), None),
    ("deep-nesting-200000", lambda: case_deep_nesting(200_000), None),
    ("many-objects-300000", lambda: case_many_objects(300_000), None),
    ("churn-2000-distinct-pages", lambda: case_many_pages(2000, 3000), None),
    ("text-1000-pages-3KB", lambda: case_many_pages(1000, 3000), None),
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
        "countedPeakBytes": next((f.get("peakBytes") for f in frames if f.get("type") == "end"), None),
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
        print(json.dumps({k: r[k] for k in ("case", "exit", "breachMarker", "peakRssMiB", "countedPeakBytes", "wallSeconds", "frames")}))
    with open(a.out, "w") as f:
        json.dump({"worker": a.worker, "results": results}, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    sys.exit(main())
