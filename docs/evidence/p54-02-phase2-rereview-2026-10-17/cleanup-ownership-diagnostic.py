"""Add one build-time race to the submitted disposable runner fixture."""
import json, sys
from pathlib import Path

package = Path(sys.argv[1]).resolve()
test = package / 'test_run_phase2.py'
text = test.read_text()
needle = "            elif cmd[:2] == ['cargo', 'build']:\n"
assert text.count(needle) == 1
adapter = '''                if scenario == 'source_and_example_changed':
                    replacement = b'new work from the other writer\\n'
                    (repo / 'src-tauri/examples/p54_worker_proof.rs').write_bytes(replacement)
                    (runner_copy.parent / 'p54_worker_proof.rs').write_bytes(replacement)
'''
namespace = {'__file__': str(test), '__name__': 'review_cleanup_race'}
exec(compile(text.replace(needle, needle + adapter), str(test), 'exec'), namespace)
result = namespace['run_runner']('source_and_example_changed')
out = Path(sys.argv[2])
assert not out.exists()
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: result[k] for k in ('exit', 'exampleLeft', 'scratchKept')}, indent=2))
