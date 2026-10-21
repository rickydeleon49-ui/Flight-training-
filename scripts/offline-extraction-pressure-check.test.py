"""Harness acceptance checks with fake child output; never build or run a worker."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import sys
sys.dont_write_bytecode = True
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("pressure_check", Path(__file__).with_name("offline-extraction-pressure-check.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class PressureSummaryTests(unittest.TestCase):
    def run_check(self, *, rss=640 * 1024**2, outcome="ok", partial=False, exit_code=0,
                  elapsed=1, timeout=False, files=3, malformed=False):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            out, scratch = root / "output", root / "scratch"
            out.mkdir()
            (scratch / "fixtures").mkdir(parents=True)
            for i in range(files):
                (scratch / "fixtures" / f"synthetic-{i}.pdf").write_bytes(b"synthetic test input")
            result = dict(outcome=outcome, pages=1 if outcome == "ok" else 0,
                          partialPublish=partial, seconds=elapsed, countedPeakBytes=10)
            stdout = b"invalid probe output" if malformed else json.dumps(result).encode()
            stderr = b"RSS unavailable" if rss is None else f"{rss} maximum resident set size\n".encode()
            child = Mock(pid=999999, returncode=exit_code)
            child.communicate.side_effect = [subprocess.TimeoutExpired("probe", 120), (stdout, stderr)] if timeout else None
            if not timeout:
                child.communicate.return_value = (stdout, stderr)
            times = iter([t for _ in range(files) for t in (0, elapsed)])
            with patch.object(check.sys, "argv", ["check", "baseline", str(out), str(scratch)]), \
                 patch.object(check.subprocess, "Popen", return_value=child) as spawn, \
                 patch.object(check.time, "monotonic", side_effect=lambda: next(times)), \
                 patch.object(check.os, "killpg") as kill, \
                 patch.object(check.platform, "platform", return_value="synthetic test host"), \
                 patch.object(check.platform, "machine", return_value="arm64"), \
                 contextlib.redirect_stdout(io.StringIO()):
                code = check.main()
            summary = json.loads((out / "summary.json").read_text())
            self.assertEqual(len(summary["files"]), files)
            for call in spawn.call_args_list:
                self.assertEqual(call.args[0][:2], ["/usr/bin/time", "-l"])
                self.assertTrue(call.kwargs["start_new_session"])
            return code, summary, kill.call_count

    def test_boundary_and_clean_refusals_pass(self):
        for outcome in ("ok", "memory_limit", "deadline"):
            with self.subTest(outcome=outcome):
                code, summary, _ = self.run_check(outcome=outcome)
                self.assertEqual(code, 0)
                self.assertTrue(summary["passed"])

    def test_rss_over_cap_fails(self):
        self.assertEqual(self.run_check(rss=640 * 1024**2 + 1)[0], 1)

    def test_missing_rss_never_substitutes_counted_allocations(self):
        code, summary, _ = self.run_check(rss=None)
        self.assertEqual(code, 1)
        self.assertEqual(summary["files"][0]["outcome"], "ok")
        self.assertIsNone(summary["files"][0]["peakRssBytes"])

    def test_timing_tool_failure_preserves_worker_outcome_but_fails_acceptance(self):
        code, summary, _ = self.run_check(exit_code=1)
        self.assertEqual(code, 1)
        self.assertEqual(summary["files"][0]["outcome"], "ok")

    def test_crash_partial_publish_or_over_deadline_fail(self):
        for options in (dict(outcome="crash"), dict(partial=True), dict(elapsed=120.01)):
            with self.subTest(options=options):
                self.assertEqual(self.run_check(**options)[0], 1)

    def test_outer_watchdog_kills_group_and_does_not_claim_clean_deadline(self):
        # One file keeps this fault injection to one mocked child.
        code, summary, kills = self.run_check(timeout=True, files=1)
        self.assertEqual(code, 1)
        self.assertEqual(kills, 1)
        self.assertEqual(summary["files"][0]["outcome"], "crash")

    def test_bad_probe_output_fails(self):
        self.assertEqual(self.run_check(malformed=True)[0], 1)

    def test_empty_fixture_run_cannot_pass(self):
        self.assertEqual(self.run_check(files=0)[0], 1)


if __name__ == "__main__":
    unittest.main()
