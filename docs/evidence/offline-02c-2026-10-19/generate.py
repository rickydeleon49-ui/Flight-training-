#!/usr/bin/env python3
"""Freeze the OFFLINE-02c saved-content corpus and expected hits BEFORE timing.

Addendum rev 4 §6. Inputs: PHAK worker frames (hash-recorded; kept outside
Git). Output: a synthetic her-flight-deck.db plus expected identities from an
independent reference scan that never runs SQLite FTS. Fixed seed.
The canonical/tokens/hit rules are the OFFLINE-02a reference, unchanged.
"""
import argparse, collections, hashlib, json, random, re, sqlite3, unicodedata
from pathlib import Path

SEED = 20261019
SLOT = "zzeditslot"
MARK = "editmarker"
MAX_OCTETS = 24 * 1024 * 1024


def canonical(s):
    return ''.join(' ' if unicodedata.category(c) == 'Cc' else c
                   for c in unicodedata.normalize('NFKC', s) if c not in '')


def tokens(s):
    s = ''.join(c for c in unicodedata.normalize('NFD', canonical(s).lower()) if unicodedata.category(c) != 'Mn')
    return re.findall(r'[^\W_]+', s, re.UNICODE)


def hit(ts, q):
    terms = re.findall(r'"([^"]+)"|(\S+)', q)
    return all(any(ts[i:i + len(w)] == w for i in range(len(ts) - len(w) + 1))
               for a, b in terms if (w := tokens(a or b)))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', type=Path, required=True, help='PHAK worker NDJSON frames')
    ap.add_argument('--frames-sha256', required=True)
    ap.add_argument('--out', type=Path, required=True, help='directory for the corpus (outside Git)')
    ap.add_argument('--manifest', type=Path, required=True)
    a = ap.parse_args()
    raw = a.frames.read_bytes()
    assert sha(raw) == a.frames_sha256, 'frames hash mismatch'
    pages = [json.loads(l) for l in raw.splitlines()]
    pages = [p for p in pages if p.get('type') == 'page' and p.get('outcome') == 'text']
    freq = collections.Counter(t for p in pages for t in tokens(p['text']))
    vocab = sorted(w for w in freq if SLOT not in w and MARK not in w)
    weights = [freq[w] for w in vocab]
    rng = random.Random(SEED)

    def words(lo, hi):
        return ' '.join(rng.choices(vocab, weights=weights, k=rng.randint(lo, hi)))

    a.out.mkdir(parents=True, exist_ok=True)
    db_path = a.out / 'her-flight-deck.db'
    if db_path.exists():
        db_path.unlink()
    db = sqlite3.connect(db_path)
    db.executescript("""
      PRAGMA journal_mode = WAL;
      CREATE TABLE study_materials (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE ai_study_sets (source_material_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '', sections_json TEXT NOT NULL DEFAULT '[]',
        flashcards_json TEXT NOT NULL DEFAULT '[]', source_notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE practice_test_versions (id TEXT PRIMARY KEY, source_material_id TEXT, is_active INTEGER NOT NULL);
      CREATE TABLE practice_test_items (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, question_text TEXT NOT NULL,
        options_json TEXT NOT NULL, correct_index INTEGER NOT NULL, explanation TEXT NOT NULL DEFAULT '');
      CREATE TABLE card_versions (id TEXT PRIMARY KEY, source_material_id TEXT NOT NULL, is_active INTEGER NOT NULL);
      CREATE TABLE card_items (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, front TEXT NOT NULL, back TEXT NOT NULL);
      CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '');
      CREATE TABLE questions (id TEXT PRIMARY KEY, text TEXT NOT NULL, material_id TEXT, answer TEXT NOT NULL DEFAULT '');
    """)
    # Every indexed record, as the native rebuild indexes it (§1):
    # (kind, group material or None, record id, text).
    indexed = []
    octets = 0
    for m in range(1, 101):
        mid = f'm{m:03}'
        db.execute('INSERT INTO study_materials VALUES (?, ?)', (mid, f'Generated study material {m:03}'))
        summary = words(40, 120)
        sections = [{'heading': words(3, 8), 'body': words(100, 600)} for _ in range(20)]
        cards = [{'front': words(5, 60), 'back': words(5, 60), 'sourcePage': None} for _ in range(200)]
        sj, cj = json.dumps(sections), json.dumps(cards)
        db.execute('INSERT INTO ai_study_sets (source_material_id, summary, sections_json, flashcards_json) VALUES (?, ?, ?, ?)',
                   (mid, summary, sj, cj))
        octets += len(summary.encode()) + len(sj.encode()) + len(cj.encode())
        indexed.append(('summary', mid, 'summary', summary))
        indexed += [('guide', mid, str(i), f"{s['heading']}\n{s['body']}") for i, s in enumerate(sections)]
        indexed += [('card', mid, str(i), f"{c['front']}\n{c['back']}") for i, c in enumerate(cards)]
        for active in (1, 0):
            vid = f'{mid}-v{active}'
            db.execute('INSERT INTO practice_test_versions VALUES (?, ?, ?)', (vid, mid, active))
            for q in range(50):
                stem = words(10, 40)
                options = json.dumps([words(2, 12) for _ in range(4)])
                explanation = words(20, 80)
                qid = f'{vid}-q{q:02}'
                db.execute('INSERT INTO practice_test_items VALUES (?, ?, ?, ?, 0, ?)', (qid, vid, stem, options, explanation))
                if active:
                    octets += len(stem.encode())
                    indexed.append(('practice', mid, qid, stem))
        # A review snapshot: never indexed.
        db.execute('INSERT INTO card_versions VALUES (?, ?, 1)', (f'{mid}-c', mid))
        db.execute('INSERT INTO card_items VALUES (?, ?, ?, ?)', (f'{mid}-ci', f'{mid}-c', words(5, 60), words(5, 60)))
    for n in range(1000):
        nid = f'n{n:04}'
        title, body = words(2, 10), words(20, 800)
        if n == 0:
            body += ' ' + SLOT
        db.execute('INSERT INTO notes VALUES (?, ?, ?)', (nid, title, body))
        octets += len(title.encode()) + len(body.encode())
        indexed.append(('note', None, nid, f'{title}\n{body}'))
    for q in range(500):
        qid = f'q{q:03}'
        text, answer = words(8, 60), words(0, 120)
        linked = f'm{(q % 100) + 1:03}' if q % 2 else None
        db.execute('INSERT INTO questions VALUES (?, ?, ?, ?)', (qid, text, linked, answer))
        octets += len(text.encode()) + len(answer.encode())
        indexed.append(('question', None, qid, f'{text}\n{answer}'))
    octets += sum(len(f'Generated study material {m:03}'.encode()) for m in range(1, 101))
    db.commit()
    db.close()
    assert octets < MAX_OCTETS, f'corpus {octets} bytes is not under 24 MiB'

    toks = [(k, g, r, tokens(t)) for k, g, r, t in indexed]
    occ = collections.Counter()
    for *_, ts in toks:
        occ.update(set(ts))
    count = collections.Counter(t for *_, ts in toks for t in ts)
    rare = 'isogonic' if 1 <= occ['isogonic'] <= 3 else min(
        w for w, n in occ.items() if 1 <= n <= 3 and w.isascii() and w.isalpha() and len(w) <= 64)
    worst = min(count, key=lambda w: (-count[w], w))
    queries = ['aircraft', rare, '"density altitude"', 'wind shear final approach runway landing pilot airspeed', 'zzqxv', worst]
    for q in queries:
        assert SLOT not in q and MARK not in q, q
    # The slot is the fixed note's last token; replacing it with any scheduled
    # marker leaves every frozen query's expected membership unchanged.
    slot_note = next(x for x in toks if x[2] == 'n0000')
    assert slot_note[3][-1] == SLOT
    for n in range(1, 401):
        edited = slot_note[3][:-1] + [f'{MARK}{n}']
        for q in queries:
            assert hit(slot_note[3], q) == hit(edited, q), (n, q)

    expected = {}
    for qi, q in enumerate(queries):
        expected[str(qi)] = sorted([k, g or '', r] for k, g, r, ts in toks if hit(ts, q))
    exp_bytes = (json.dumps(expected, separators=(',', ':')) + '\n').encode()
    (a.out / 'expected.json').write_bytes(exp_bytes)
    manifest = {
        'seed': SEED,
        'generatorSha256': sha(Path(__file__).read_bytes()),
        'framesSha256': a.frames_sha256,
        'corpusSha256': sha(db_path.read_bytes()),
        'expectedSha256': sha(exp_bytes),
        'canonicalOctets': octets,
        'records': len(indexed),
        'queries': queries,
        'rareWord': rare,
        'worstWord': worst,
        'expectedCounts': {k: len(v) for k, v in expected.items()},
        'slot': {'note': 'n0000', 'token': SLOT, 'marker': MARK + '<n>', 'checkedMarkers': 400},
        'schedule': {'freshProcesses': 3, 'perQuery': [
            {'mode': 'rebuild', 'warmups': 3, 'samples': 15},
            {'mode': 'cached', 'warmups': 3, 'samples': 15}],
            'order': 'query types in list order; rebuild then cached'},
        'percentiles': 'nearest-rank',
        'targets': {'coldRebuildMs': 1000, 'cachedP50Ms': 20, 'cachedP95Ms': 50,
                    'rebuildP95Ms': 1200, 'rssBytes': 268435456, 'responseBytes': 65536},
    }
    a.manifest.write_text(json.dumps(manifest, indent=1) + '\n')
    print(json.dumps({k: manifest[k] for k in ('canonicalOctets', 'records', 'queries', 'expectedCounts')}))


if __name__ == '__main__':
    main()
