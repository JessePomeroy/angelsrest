"""Guard against incomplete or unrelated results being reported as pilot evidence."""

import copy
import contextlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from check import command, implementation_report_ok, main


def passing_report(bridge_only=False):
    counts = {"intake.bridge.test.ts": 12}
    if not bridge_only:
        counts.update({"checkoutSnapshotReservations.test.ts": 29,
                       "orders.test.ts": 178, "commerceIntakeInbox.test.ts": 30})
    return {
        "success": True, "numTotalTests": sum(counts.values()),
        "numPassedTests": sum(counts.values()), "numFailedTests": 0,
        "numPendingTests": 0, "numTodoTests": 0, "numFailedTestSuites": 0,
        "testResults": [{"name": f"/temporary-copy/{name}", "assertionResults": [
            {"status": "passed", "failureMessages": [], "fullName": f"probe {i}"}
            for i in range(count)]} for name, count in counts.items()],
    }


def mutation_report():
    data = passing_report(bridge_only=True)
    data.update(success=False, numPassedTests=0, numFailedTests=3,
                numPendingTests=9, numFailedTestSuites=4)
    assertions = data["testResults"][0]["assertionResults"]
    for test in assertions:
        test["status"] = "skipped"
    for test, scope in zip(assertions[:3], ["hub platform", "tenant platform", "tenant connected"]):
        test.update(status="failed",
                    fullName=f"'{scope}' fresh order route retries converge after a lost reply",
                    failureMessages=["AssertionError: expected array to have a length of 1 but got 2"])
    return data


class ImplementationReportTests(unittest.TestCase):
    def test_complete_baseline_and_restored_reports_pass(self):
        for bridge_only in [False, True]:
            self.assertTrue(implementation_report_ok(passing_report(bridge_only), 0,
                                                     bridge_only=bridge_only))

    def test_success_with_a_skipped_probe_is_rejected(self):
        for bridge_only in [False, True]:
            data = passing_report(bridge_only)
            data["numPassedTests"] -= 1
            data["numPendingTests"] = 1
            data["testResults"][0]["assertionResults"][0]["status"] = "skipped"
            self.assertFalse(implementation_report_ok(data, 0, bridge_only=bridge_only))

    def test_success_with_an_omitted_suite_is_rejected(self):
        data = passing_report()
        removed = data["testResults"].pop()
        data["numTotalTests"] -= len(removed["assertionResults"])
        data["numPassedTests"] = data["numTotalTests"]
        self.assertFalse(implementation_report_ok(data, 0))

    def test_success_with_no_report_is_rejected(self):
        self.assertFalse(implementation_report_ok({}, 0))

    def test_exact_three_scope_mutation_control_passes(self):
        self.assertTrue(implementation_report_ok(mutation_report(), 1, True, True))

    def test_unrelated_mutation_failure_is_rejected(self):
        data = mutation_report()
        data["testResults"][0]["assertionResults"][0]["failureMessages"] = ["Setup failed"]
        self.assertFalse(implementation_report_ok(data, 1, True, True))

    def test_repeated_scope_does_not_replace_a_missing_scope(self):
        data = mutation_report()
        assertions = data["testResults"][0]["assertionResults"]
        assertions[1] = copy.deepcopy(assertions[0])
        self.assertFalse(implementation_report_ok(data, 1, True, True))

    def test_missing_filtered_tests_is_rejected(self):
        data = mutation_report()
        data["testResults"][0]["assertionResults"].pop()
        self.assertFalse(implementation_report_ok(data, 1, True, True))


class CommandCleanupTests(unittest.TestCase):
    def test_timeout_stops_the_recorded_descendant(self):
        with tempfile.TemporaryDirectory(prefix="order-intake-timeout-test-") as folder:
            receipt = Path(folder) / "pids.json"
            leader = """import json, os, subprocess, sys, time
from pathlib import Path
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)", sys.argv[1]])
Path(sys.argv[1]).write_text(json.dumps([os.getpid(), child.pid]))
print("child started", flush=True)
time.sleep(300)
"""

            def running(pid):
                try:
                    state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
                    return state not in {"Z", "X"}
                except FileNotFoundError:
                    return False

            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    command([sys.executable, "-c", leader, receipt], cwd=folder, timeout=2)
                pids = json.loads(receipt.read_text())
                deadline = time.monotonic() + 2
                while any(running(pid) for pid in pids) and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertFalse(any(running(pid) for pid in pids), pids)
            finally:
                # A failing regression must not leak its own synthetic process.
                if receipt.exists():
                    for pid in json.loads(receipt.read_text()):
                        try:
                            if str(receipt).encode() in Path(f"/proc/{pid}/cmdline").read_bytes():
                                os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        except FileNotFoundError:
                            pass

    def test_timeout_is_reported_as_incomplete(self):
        with tempfile.TemporaryDirectory(prefix="order-intake-timeout-result-") as folder:
            output = Path(folder) / "evidence"
            with patch("sys.argv", ["check.py", "--out", str(output)]), \
                    patch("check.source_snapshot", return_value={}), \
                    patch("check.command", side_effect=subprocess.TimeoutExpired("synthetic-check", 2)), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(), 1)
            self.assertEqual(json.loads((output / "summary.json").read_text())["status"], "incomplete")


if __name__ == "__main__":
    unittest.main()
