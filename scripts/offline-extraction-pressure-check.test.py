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


FIXTURES = {
    "synthetic-small-checklist.pdf": "ok",
    "synthetic-long-manual.pdf": "ok",
    "synthetic-illustrated-charts.pdf": "ok",
    "synthetic-near-cap.pdf": "ok",
    "synthetic-over-cap.pdf": "memory_limit",
}


class PressureSummaryTests(unittest.TestCase):
    def run_check(self, *, rss=640 * 1024**2, outcome=None, partial=False, exit_code=0,
                  elapsed=1, timeout=False, files=None, malformed=False, overrides=None,
                  near_peak=400 * 1024**2, input_bytes=None):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            out, scratch = root / "output", root / "scratch"
            out.mkdir()
            (scratch / "fixtures").mkdir(parents=True)
            names = list(FIXTURES) if files is None else files
            for name in names:
                (scratch / "fixtures" / name).write_bytes(b"synthetic test input")
            stderr = b"RSS unavailable" if rss is None else f"{rss} maximum resident set size\n".encode()
            def make_child(command, **kwargs):
                name = Path(command[-2]).name
                actual = outcome or FIXTURES.get(name, "ok")
                result = dict(outcome=actual, pages=1 if actual == "ok" else 0,
                              partialPublish=partial, seconds=elapsed,
                              countedPeakBytes=near_peak if name == "synthetic-near-cap.pdf" else 10)
                result.update((overrides or {}).get(name, {}))
                stdout = b"invalid probe output" if malformed else json.dumps(result).encode()
                child = Mock(pid=999999, returncode=exit_code)
                if timeout:
                    child.communicate.side_effect = [subprocess.TimeoutExpired("probe", 120), (stdout, stderr)]
                else:
                    child.communicate.return_value = (stdout, stderr)
                return child
            times = iter([t for _ in range(len(names)) for t in (0, elapsed)])
            with patch.object(check.sys, "argv", ["check", "baseline", str(out), str(scratch)]), \
                 patch.object(check.subprocess, "Popen", side_effect=make_child) as spawn, \
                 patch.object(check.time, "monotonic", side_effect=lambda: next(times)), \
                 patch.object(check.os, "killpg") as kill, \
                 patch.object(check.platform, "platform", return_value="synthetic test host"), \
                 patch.object(check.platform, "machine", return_value="arm64"), \
                 contextlib.redirect_stdout(io.StringIO()):
                if input_bytes is None:
                    code = check.main()
                else:
                    original_stat = Path.stat
                    def stat(path, *args, **kwargs):
                        if path.suffix == ".pdf":
                            return Mock(st_size=input_bytes)
                        return original_stat(path, *args, **kwargs)
                    with patch.object(Path, "stat", stat):
                        code = check.main()
            summary = json.loads((out / "summary.json").read_text())
            self.assertEqual(len(summary["files"]), len(names))
            for call in spawn.call_args_list:
                self.assertEqual(call.args[0][:2], ["/usr/bin/time", "-l"])
                self.assertTrue(call.kwargs["start_new_session"])
            return code, summary, kill.call_count

    def test_five_expected_outcomes_at_rss_boundary_pass(self):
        code, summary, _ = self.run_check()
        self.assertEqual(code, 0)
        self.assertTrue(summary["passed"])

    def test_each_wrong_outcome_fails(self):
        for name, expected in FIXTURES.items():
            for outcome in ("ok", "memory_limit", "deadline", "crash"):
                if outcome == expected:
                    continue
                with self.subTest(name=name, outcome=outcome):
                    self.assertEqual(self.run_check(overrides={name: {"outcome": outcome}})[0], 1)

    def test_near_cap_counted_peak_range(self):
        for peak in (300 * 1024**2, 500 * 1024**2):
            self.assertEqual(self.run_check(near_peak=peak)[0], 0)
        for peak in (0, 300 * 1024**2 - 1, 500 * 1024**2 + 1):
            self.assertEqual(self.run_check(near_peak=peak)[0], 1)

    def test_over_cap_never_publishes_pages(self):
        self.assertEqual(self.run_check(overrides={"synthetic-over-cap.pdf": {"pages": 1}})[0], 1)

    def test_missing_extra_or_substituted_fixture_fails(self):
        names = list(FIXTURES)
        for files in (names[:-1], names + ["synthetic-extra.pdf"], names[:-1] + ["synthetic-extra.pdf"]):
            self.assertEqual(self.run_check(files=files)[0], 1)

    def test_input_size_cap(self):
        self.assertEqual(self.run_check(input_bytes=128 * 1024**2)[0], 0)
        self.assertEqual(self.run_check(input_bytes=128 * 1024**2 + 1)[0], 1)

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
        code, summary, kills = self.run_check(timeout=True, files=["synthetic-small-checklist.pdf"])
        self.assertEqual(code, 1)
        self.assertEqual(kills, 1)
        self.assertEqual(summary["files"][0]["outcome"], "crash")

    def test_bad_probe_output_fails(self):
        self.assertEqual(self.run_check(malformed=True)[0], 1)

    def test_empty_fixture_run_cannot_pass(self):
        self.assertEqual(self.run_check(files=[])[0], 1)


if __name__ == "__main__":
    unittest.main()
