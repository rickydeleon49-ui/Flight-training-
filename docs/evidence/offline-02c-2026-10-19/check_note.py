#!/usr/bin/env python3
"""Post-edit reference check (addendum §6), run by the harness after every
committed slot edit, outside timing. Reads the edited note's committed title
and body as JSON on stdin and prints, per frozen query, whether the note
matches. It reuses the frozen generator's canonical/tokens/hit rules by
import, so generate.py (and its frozen hash) is unchanged."""
import importlib.util, json, sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('generate', Path(__file__).with_name('generate.py'))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)
note = json.load(sys.stdin)
queries = json.loads(Path(sys.argv[1]).read_text())['queries']
ts = gen.tokens(f"{note['title']}\n{note['body']}")
print(json.dumps([gen.hit(ts, q) for q in queries]))
