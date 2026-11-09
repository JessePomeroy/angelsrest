"""Guard against incomplete or unrelated results being reported as pilot evidence."""

import copy
import unittest

from check import implementation_report_ok


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


if __name__ == "__main__":
    unittest.main()
